# Mifela POS — Database Architecture

**Analysis Date:** 2026-11-21  
**Focus Area:** arch

---

## 1. Overview

Mifela POS uses a **local-first SQLite database** as its primary data store. All point-of-sale, inventory, customer, and transaction data lives on the device. Cloud synchronization (Firebase Firestore) is secondary and used for settings, store config, and optional cross-device sync.

There is now a **single SQLite access path** (the dual-driver concern H1 is resolved):

| Access path | Module | Driver | Style | Used by |
|-------------|--------|--------|-------|---------|
| Knex.js (async) | `electron/database/knex.js` + `controllers.js` + `schema.js` | `sqlite3` (via knex) | Promise-based, async/await | All app data IPC handlers, schema init, services |

The database file: `userData/mifela_pos_v1.db`.

`better-sqlite3`/`connection.js` and `better-sqlite3-multiple-ciphers` have been removed from runtime dependencies.

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

Schema is created by `initKnex()` → `initSchema()` in `electron/database/knex.js` (using `CREATE TABLE IF NOT EXISTS`), with migration definitions in `electron/database/schema.js`. Runs on `app.whenReady()` before any query.

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

### 3.4 `security_config` (legacy)

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | PRIMARY KEY ('SYSTEM_LICENSE') |
| email | TEXT | |
| storeName | TEXT | |
| encryptedPrivateKey | TEXT | |
| publicKey | TEXT | PEM |
| nextVerificationDate | TEXT | ISO string |

Still created by schema but **no longer used** by license verification (superseded by `licence_data`).

### 3.5 `store_settings` (created lazily)

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | PRIMARY KEY |
| data | TEXT | JSON |

Created on first `db:save-store-settings` call if missing. Used for vault, printer config, currency, tax rate, etc.

### 3.6 `local_users` (NEW)

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PRIMARY KEY |
| username | TEXT | not nullable, unique |
| password_hash | TEXT | not nullable (bcrypt) |
| role | TEXT | DEFAULT 'user' |
| is_active | BOOLEAN | DEFAULT true |
| firebase_uid | TEXT | nullable |

Used by `LocalAuthService.login`.

### 3.7 `licence_data` (NEW)

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | PRIMARY KEY |
| licence_payload | TEXT | not nullable (JSON string) |
| signature | TEXT | not nullable (Ed25519) |
| last_verified_at | TIMESTAMP | |
| next_verification_due | TIMESTAMP | |
| status | TEXT | DEFAULT 'UNACTIVATED' |

Used by `LicenceStateManager` for offline-first licence verification. Written by `security:provision` and `BackgroundVerificationScheduler`.

---

## 4. Access Layer

### 4.1 Knex.js (`electron/database/knex.js`)

```js
initKnex(dbPath)   // creates singleton knex instance (sqlite3 client), runs initSchema()
getKnex()          // returns singleton, throws if not initialized
```

Database file path uses `app.getPath('userData')`. Configured with `useNullAsDefault: true`.

### 4.2 Controllers (`electron/database/controllers.js`)

`registerDBHandlers()` registers every `db:*` IPC handler. Patterns:

- **Authorization:** `authorize()` calls `LicenceStateManager.evaluateCurrentState()` and throws unless state is `ACTIVE`. Applied to all write/mutation handlers (`processSale`, `processFinancialTransaction`, `savePartner`, `executeLedgerMerge`, `undoLedgerMerge`, `deleteCustomer`, `resetPartnerAccount`, `runDirectoryCleanup`, `executeBatch`, `updateLoyaltyTokens`, `updateChequeStatus`, `save-store-settings`, `saveAttendance`, `deleteDoc`). Read handlers are NOT authorized.
- **Fetch handlers** — `knex('table').select('data')`, rows mapped via `JSON.parse(r.data)`. Errors return `[]` (non-critical reads).
- **Write handlers** — wrapped in `knex.transaction(async trx => { ... })` for atomicity. Errors are re-thrown.
- **JSON document store** — most tables store the full object as JSON in the `data` column, with a few denormalized columns (total, timestamp, type, etc.) indexed for querying.
- **JSON querying** — `whereRaw("json_extract(data, '$.path') = ?", [value])` used for queries inside JSON documents (cheque status, customer ID, payment method).
- **Table whitelist** — `ALLOWED_TABLES` + `resolveTable()` restrict renderer-driven table access to `products`, `customers`, `transactions`, `security_config`, `store_settings`, `local_users`, `licence_data`. `directory_merchants` maps to `customers`.

Notable handlers:
- `db:processSale` — transactional: insert transaction, decrement stock per non-homemade item, upsert customer dues/loyalty. (No stock-availability guard — see CONCERNS.md M1.)
- `db:executeLedgerMerge` — merges N transactions into one `MERGED_LEDGER` record, deletes originals, keeps `_archivedRecords`.
- `db:runDirectoryCleanup` — groups customers by last-10-digits of phone, keeps oldest as primary, merges dues/points, deletes duplicates, repoints transactions.
- `db:executeBatch` — generic batched set/update/delete across whitelisted tables with `_isIncrement` support. (Broad surface — see CONCERNS.md H2.)
- `db:adjustStockAtomic` — single `increment('stockLevel', qtyChange)` for atomic stock correction.

### 4.3 Services (data-adjacent)

- `LicenceStateManager.evaluateCurrentState()` — reads `licence_data`, verifies Ed25519 signature, hardware binding, revocation/expiry/offline deadline.
- `LocalAuthService.login(username, password)` — bcrypt verify against `local_users`, returns session token.

---

## 5. Data Flow Patterns

### Write (sale)

```
Renderer → dbAPI.processSale → ipcMain 'db:processSale'
  → authorize() (licence must be ACTIVE)
  → knex.transaction:
      insert transactions (id, invoiceId, type, timestamp, paymentMethod, total, data)
      for each item: products.decrement('stockLevel', qty)  [skip type==='homemade']
      if customerUpdate: upsert customer (dues, loyaltyPoints)
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
- Single SQLite driver (knex/sqlite3) now; no cross-driver locking concerns.

---

## 7. Migrations & Schema Evolution

- `electron/database/schema.js` — Knex migration-style `up`/`down` functions (`local_users`, `licence_data`).
- `knex.js` `initSchema()` uses `CREATE TABLE IF NOT EXISTS` — additive, non-destructive schema initialization.
- `store_settings` table is self-creating on first write.
- No formal migration versioning table detected.

---

## 8. Encryption & Security

- Database file itself is **not encrypted at rest** (plain SQLite). `better-sqlite3-multiple-ciphers` removed from dependencies.
- `licence_data.licence_payload` is a signed JSON payload (Ed25519 signature stored in `signature` column); not encrypted.
- Auth token encrypted via Electron `safeStorage.encryptString` at `userData/auth_token.enc`.
- Password hashes in `local_users` use bcrypt.

---

## 9. Known Concerns

| Concern | Detail |
|---------|--------|
| No encryption at rest | DB file is plain SQLite; sensitive data readable from userData |
| No migration versioning | Schema evolves via `CREATE TABLE IF NOT EXISTS` only; no migration tracking |
| JSON document store | Most data buried in `data` TEXT column; queries on JSON require `json_extract` |
| Read errors masked | Read handlers return `[]`/`null` on error (CONCERNS.md M3) |
| `executeBatch` broad surface | Arbitrary table writes from renderer (CONCERNS.md H2) |
| No automated test coverage for controllers | See TESTING.md |

---

*Database analysis: 2026-11-21 — focus: arch*
