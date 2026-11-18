# Mifela POS — Database Architecture

**Analysis Date:** 2026-11-18  
**Focus Area:** arch

---

## 1. Overview

Mifela POS uses a **local-first, encrypted SQLite database** as its primary data store. All point-of-sale, inventory, customer, and transaction data lives on the device. Cloud synchronization (Firebase Firestore) is secondary and used for settings, store config, and optional cross-device sync.

There are **two concurrent SQLite access paths** in the codebase:

| Access path | Module | Driver | Style | Used by |
|-------------|--------|--------|-------|---------|
| Knex.js (async) | `electron/database/knex.js` + `controllers.js` | `sqlite3` (via knex) | Promise-based, async/await | All app data IPC handlers |
| better-sqlite3 (sync) | `electron/database/connection.js` | `better-sqlite3` | Synchronous | `LicenseManager` (security_config) |

Both point to the same database file: `userData/mifela_pos_v1.db`.

---

## 2. Database Location

```
dbPath = app.getPath('userData') + '/mifela_pos_v1.db'
```

`userData` is the Electron user data directory (persists across app updates, OS-specific):
- Windows: `%APPDATA%\Mifela`
- macOS: `~/Library/Application Support/Mifela`
- Linux: `~/.config/Mifela`

---

## 3. Schema

### 3.1 `products`

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | PRIMARY KEY |
| locationId | TEXT | |
| name | TEXT | |
| sku | TEXT | indexed |
| barcode | TEXT | indexed |
| price | REAL | |
| cost | REAL | |
| stockLevel | REAL | decremented on sale |
| lowStockThreshold | REAL | reorder point |
| data | TEXT | JSON document (full product record) |

Indexes: `idx_products_barcode(barcode)`, `idx_products_sku(sku)`

### 3.2 `customers`

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | PRIMARY KEY |
| name | TEXT | |
| phone | TEXT | |
| type | TEXT | customer / supplier / dealer / store |
| dues | REAL | DEFAULT 0 |
| loyaltyPoints | INTEGER | DEFAULT 0 |
| data | TEXT | JSON document (full customer record) |

### 3.3 `transactions`

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | PRIMARY KEY |
| invoiceId | TEXT | |
| locationId | TEXT | |
| type | TEXT | SALE, PURCHASE, PAYMENT_RECEIVED, PAYMENT_MADE, REFUND, MERGED_LEDGER, SYSTEM |
| timestamp | TEXT | ISO string, indexed |
| paymentMethod | TEXT | Cash, Card, CHEQUE, UPI, MERGED, ... |
| total | REAL | |
| data | TEXT | JSON document (full transaction record incl. items, customer, chequeDetails) |

Index: `idx_transactions_timestamp(timestamp)`

### 3.4 `security_config` (better-sqlite3 sync connection)

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | PRIMARY KEY ('SYSTEM_LICENSE') |
| email | TEXT | |
| storeName | TEXT | |
| encryptedPrivateKey | TEXT | JSON {iv, data, tag} AES-256-GCM encrypted |
| publicKey | TEXT | PEM |
| nextVerificationDate | TEXT | ISO string |

Used by `LicenseManager` for asymmetric license verification.

### 3.5 `store_settings` (created lazily)

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | PRIMARY KEY |
| data | TEXT | JSON |

Created on first `db:saveStoreSettings` call if missing. Used for vault, printer config, currency, tax rate, etc.

---

## 4. Access Layer

### 4.1 Knex.js (`electron/database/knex.js`)

```js
initKnex()      // creates singleton knex instance (sqlite3 client)
getKnex()       // returns singleton, throws if not initialized
```

Database file path uses `app.getPath('userData')`. Configured with `useNullAsDefault: true`.

### 4.2 Controllers (`electron/database/controllers.js`)

`registerDBHandlers()` registers every `db:*` IPC handler. Patterns:

- **Fetch handlers** — `knex('table').select('data')`, rows mapped via `JSON.parse(r.data)`. Errors return `[]` (non-critical reads).
- **Write handlers** — wrapped in `knex.transaction(async trx => { ... })` for atomicity. Errors are re-thrown.
- **JSON document store** — most tables store the full object as JSON in the `data` column, with a few denormalized columns (total, timestamp, type, etc.) indexed for querying.
- **JSON querying** — `whereRaw("json_extract(data, '$.path') = ?", [value])` used for queries inside JSON documents (cheque status, customer ID, payment method).

Notable handlers:
- `db:processSale` — transactional: insert transaction, decrement stock per non-homemade item, upsert customer dues/loyalty.
- `db:executeLedgerMerge` — merges N transactions into one `MERGED_LEDGER` record, deletes originals, keeps `_archivedRecords`.
- `db:runDirectoryCleanup` — groups customers by last-10-digits of phone, keeps oldest as primary, merges dues/points, deletes duplicates, repoints transactions.
- `db:executeBatch` — generic batched set/update/delete across products/customers/transactions with `_isIncrement` support.

### 4.3 better-sqlite3 (`electron/database/connection.js`)

```js
initDB()   // creates Database instance + runs CREATE TABLE IF NOT EXISTS schema
getDB()    // returns singleton, throws if not initialized
```

Synchronous API (`db.prepare(...).run(...)`, `.get(...)`). Used exclusively by `LicenseManager` for `security_config`.

---

## 5. Data Flow Patterns

### Write (sale)
```
Renderer → dbAPI.processSale → ipcMain 'db:processSale'
  → knex.transaction:
      insert transactions (id, invoiceId, type, timestamp, paymentMethod, total, data)
      for each item: products.decrement('stockLevel', qty)  [skip type==='homemade']
      if customer: customers.insert (new) OR customers.increment dues/loyalty (existing)
  → { success: true }
```

### Read (products)
```
Renderer → dbAPI.getProducts → ipcMain 'db:getProducts'
  → knex('products').select('data')
  → rows.map(r => JSON.parse(r.data))
  → array of product objects
```

### Query inside JSON (pending cheques)
```
knex('transactions').select('*')
  .whereRaw("json_extract(data, '$.summary.paymentMethod') = ?", ['CHEQUE'])
  .andWhereRaw("json_extract(data, '$.summary.chequeDetails.status') = ?", ['PENDING'])
```

---

## 6. Concurrency & Atomicity

- Multi-row mutations use `knex.transaction()` → all-or-nothing.
- `db:adjustStockAtomic` uses a single `increment('stockLevel', qtyChange)` for atomic stock correction.
- Reads are not wrapped in transactions (best-effort, return `[]` on error).
- Two different SQLite drivers (knex async + better-sqlite3 sync) open the same file; no cross-driver locking coordination beyond SQLite's built-in locking. `security_config` (sync driver) is written only during license provisioning/verification, low contention.

---

## 7. Migrations & Schema Evolution

- `src/utils/migrations.js` — migration utilities (content not fully reviewed; referenced for schema evolution).
- `connection.js` uses `CREATE TABLE IF NOT EXISTS` — additive, non-destructive schema initialization.
- `store_settings` table is self-creating on first write.
- No formal migration versioning table detected.

---

## 8. Encryption & Security

- Database file itself is **not encrypted at rest** (plain SQLite). `better-sqlite3-multiple-ciphers` is a dependency (suggesting cipher support was considered) but `knex.js` uses plain `sqlite3` client.
- `security_config.encryptedPrivateKey` is AES-256-GCM encrypted; key derived from hardware fingerprint (first 64 hex chars of SHA-256).
- Auth token encrypted via Electron `safeStorage.encryptString` at `userData/auth_token.enc`.

---

## 9. Known Concerns

| Concern | Detail |
|---------|--------|
| Dual drivers | knex (async) and better-sqlite3 (sync) both open the same DB file without explicit lock coordination |
| No encryption at rest | DB file is plain SQLite; sensitive data (customer info, transaction history) is readable from userData |
| No migration versioning | Schema evolves via `CREATE TABLE IF NOT EXISTS` only; no migration tracking |
| JSON document store | Most data buried in `data` TEXT column; queries on JSON require `json_extract` (no schema enforcement) |
| No automated tests | No test coverage for database layer (`TESTING.md`) |

---

*Database analysis: 2026-11-18 — focus: arch*
