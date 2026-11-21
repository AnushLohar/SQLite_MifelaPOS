# Phase 1 — Hardening & Security Fixes Research

## Requirement Overview
Source: `.planning/REQUIREMENTS.md` — 6 items (SEC-01 through ACC-01)

This document records the technical approach for each requirement, including files to touch, exact code locations, edge cases/risks, and whether the decision is a one-way door.

---

## SEC-01: CSP in index.html removes unsafe-inline from script-src and style-src

**Technical approach:**
- Remove `'unsafe-inline'` from the `script-src` directive in the Content-Security-Policy meta tag in `index.html`.
- Remove `'unsafe-inline'` from the `style-src` directive in the same meta tag.
- All inline scripts/styles currently break; replace with hashed or nonce-based CSP where needed, or migrate inline code to external resources.

**Files to touch:**
- `index.html` — line 11 (`script-src`) and line 44 (`style-src`) in the `<meta http-equiv="Content-Security-Policy">` tag.

**Exact code location before:**
```html
script-src 'self' 'unsafe-inline' blob:
  https://cdn.jsdelivr.net
  https://unpkg.com
  ...
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
```

**After (proposed):**
```html
script-src 'self' blob:
  https://cdn.jsdelivr.net
  https://unpkg.com
  ...
style-src 'self' https://fonts.googleapis.com;
```

**Edge cases / risks:**
- Inline event handlers (e.g., `onclick=`) will break — must be moved to addEventListener.
- Inline `<style>` blocks or `style=` attributes will break — migrate to CSS classes.
- Chart.js and other third-party libs may rely on `eval` or inline styles; verify compatibility.
- The `blob:` source may be needed for dynamic code generation; keep if used.

**One-way-door decision:** Yes. Changing CSP is a one-way security hardening. If an inline script must run, it must be moved to an external resource or given a hash/nonce. Rolling back requires re-adding `'unsafe-inline'`, which re-introduces the vulnerability.

---

## SEC-02: db:executeBatch rejects writes to licence_data and security_config from renderer

**Technical approach:**
- Remove `'licence_data'` and `'security_config'` from the `ALLOWED_TABLES` Set in `electron/database/controllers.js`.
- Add a guard in the `db:executeBatch` handler: if `op.col` resolves to a table in `{ 'licence_data', 'security_config' }`, throw an error rejecting the operation.
- All `db:executeBatch` callers from the renderer must not target these tables; the handler will reject them.

**Files to touch:**
- `electron/database/controllers.js` — lines 9-17 (`ALLOWED_TABLES` Set) and lines 510-578 (`db:executeBatch` handler).

**Exact code location before (ALLOWED_TABLES):**
```js
const ALLOWED_TABLES = new Set([
  'products',
  'customers',
  'transactions',
  'security_config',
  'store_settings',
  'local_users',
  'licence_data',
]);
```

**After (ALLOWED_TABLES):**
```js
const ALLOWED_TABLES = new Set([
  'products',
  'customers',
  'transactions',
  'store_settings',
  'local_users',
]);
```

**Exact code location before (executeBatch guard — inside the try block, before or after resolveTable):**
Add after `const tableName = resolveTable(op.col);` (line 514):
```js
// Reject writes to sensitive system tables from renderer
if (tableName === 'licence_data' || tableName === 'security_config') {
  throw new Error(`Table access denied: ${tableName}`);
}
```

**Edge cases / risks:**
- If any internal handler legitimately writes to `licence_data` (e.g., `security:provision` in main.js), ensure it uses a different IPC method (e.g., `security:provision` directly on ipcMain, not via `db:executeBatch`).
- The `resolveTable` function currently maps `'directory_merchants'` → `'customers'`. The guard must run after `resolveTable` so the actual resolved table name is checked.
- Existing read handlers that reference these tables (e.g., `db:getProducts` does not touch them, but future code might) must be migrated.

**One-way-door decision:** Yes. Removing tables from the whitelist prevents any future renderer write to these tables via `db:executeBatch`. If a legitimate main-process write is needed, it should use a dedicated IPC handler (as `security:provision` already does), not the batch pathway.

---

## SEC-03: db:executeBatch validates allowed columns per table before writing

**Technical approach:**
- Define per-table column whitelists in `electron/database/controllers.js` (e.g., `COLUMNS_PER_TABLE` object mapping table name → set of allowed column names).
- In the `db:executeBatch` handler, after resolving the table name, check every key in `op.data` against the whitelist for that table. If any key is not in the allowed set, throw an error.
- This prevents column-injection attacks where a renderer sends `op.data` with arbitrary column names (e.g., `op.data = { password: '...' }` or `op.data = { stockLevel: -1000 }`).

**Files to touch:**
- `electron/database/controllers.js` — after the `ALLOWED_TABLES` definition (after line 17), add a `COLUMNS_PER_TABLE` constant.

**Exact code location (proposed COLUMNS_PER_TABLE):**
```js
const COLUMNS_PER_TABLE = {
  products: new Set(['id', 'name', 'sku', 'barcode', 'price', 'cost', 'stockLevel', 'lowStockThreshold', 'data']),
  customers: new Set(['id', 'name', 'phone', 'type', 'dues', 'loyaltyPoints', 'data']),
  transactions: new Set(['id', 'invoiceId', 'locationId', 'type', 'timestamp', 'paymentMethod', 'total', 'data']),
  store_settings: new Set(['id', 'data']),
  local_users: new Set(['id', 'username', 'password_hash', 'role', 'is_active', 'firebase_uid']),
};
```

**Inside executeBatch, after `const tableName = resolveTable(op.col);` (line 514):**
Add validation loop:
```js
// Validate that op.data only contains allowed columns for this table
const allowedCols = COLUMNS_PER_TABLE[tableName];
if (allowedCols) {
  for (const key of Object.keys(op.data || {})) {
    if (!allowedCols.has(key)) {
      throw new Error(`Column "${key}" not allowed for table "${tableName}"`);
    }
  }
}
```

**Edge cases / risks:**
- If `op.type` is `'delete'`, there is no `op.data` — the guard should only run for `'set'`/`'update'` types.
- Adding new columns to tables requires updating this whitelist — a maintenance consideration.
- The `data` field (JSON blob) is treated as opaque; we do not validate keys inside the serialized JSON blob itself, only top-level keys in `op.data`.

**One-way-door decision:** Yes. Column whitelisting is a security boundary; opening it later (adding columns) requires a code change and redeployment. It prevents a class of injection attacks but adds a constraint on data structure.

---

## COR-01: db:processSale aborts when stockLevel < item.quantity (no negative stock)

**Technical approach:**
- In the `db:processSale` handler (`electron/database/controllers.js`, lines 102-151), before decrementing product stock (line 119-121), check that `stockLevel >= item.quantity`.
- If any item would cause negative stock, abort the entire transaction (throw error or return failure).
- The check should read the current `stockLevel` from the products table and compare against `item.quantity` before calling `.decrement()`.

**Files to touch:**
- `electron/database/controllers.js` — the `db:processSale` handler (lines 102-151).

**Exact code location before (stock decrement):**
```js
for (const item of transaction.items) {
    if (item.type !== 'homemade') {
        await trx('products')
            .where({ id: item.id })
            .decrement('stockLevel', item.quantity);
    }
}
```

**After (with stock guard):**
```js
for (const item of transaction.items) {
    if (item.type !== 'homemade') {
        // Guard: prevent negative stock
        const product = await trx('products')
            .where({ id: item.id })
            .select('stockLevel')
            .first();
        const currentStock = product ? parseFloat(product.stockLevel) || 0 : 0;
        if (currentStock < item.quantity) {
            throw new Error(`Insufficient stock for product id ${item.id}: current=${currentStock}, requested=${item.quantity}`);
        }
        await trx('products')
            .where({ id: item.id })
            .decrement('stockLevel', item.quantity);
    }
}
```

**Edge cases / risks:**
- `homemade` items are skipped (already existing behavior) — the guard respects that.
- If a product ID doesn't exist in the DB, `currentStock` defaults to 0, which would cause an abort if `item.quantity > 0` — this is intentional (can't sell what doesn't exist).
- Race condition: between the SELECT and DECREMENT, another transaction could decrement stock. For Phase 1, the sequential check is acceptable; a fully atomic approach would use a DB-level check constraint or `WHERE stockLevel >= ?` in the decrement itself.
- The error is thrown inside a `knex.transaction`, so the entire sale rolls back — correct behavior.

**One-way-door decision:** Yes. This changes the sales correctness contract: sales that would result in negative stock are now rejected. Existing workflows must ensure stock levels are maintained. Rolling back requires re-adding the check, which would again reject negative-stock sales.

---

## COR-02: DB read handlers return structured { success, data, error } instead of masking errors as []/null

**Technical approach:**
- Identify all `ipcMain.handle` read handlers in `electron/database/controllers.js` that currently return `[]` or `null` on error (or on empty results).
- Change each to return `{ success: false, data: null, error: "<message>" }` on failure, and `{ success: true, data: <result> }` on success.
- Keep existing empty-result behavior (returning `[]` or `null` for no rows) as `{ success: true, data: [] }` or `{ success: true, data: null }` — but do not mask errors as empty data.

**Files to touch:**
- `electron/database/controllers.js` — all read handlers.

**Exact code location before (example — db:getProducts):**
```js
ipcMain.handle('db:getProducts', async () => {
    try {
        const rows = await knex('products').select('data');
        return rows.map(r => JSON.parse(r.data));
    } catch (e) {
        console.error("Failed to fetch products:", e);
        return [];  // ← masks error as empty array
    }
});
```

**After:**
```js
ipcMain.handle('db:getProducts', async () => {
    try {
        const rows = await knex('products').select('data');
        return { success: true, data: rows.map(r => JSON.parse(r.data)) };
    } catch (e) {
        console.error("Failed to fetch products:", e);
        return { success: false, data: null, error: "Failed to fetch products: " + e.message };
    }
});
```

**List of handlers to change (all read handlers returning []/null on error):**
1. `db:getProducts` (line 40-48) — return `[]` → structured
2. `db:getTransactionsSince` (line 50-61) — return `[]` → structured
3. `db:getPendingCheques` (line 63-74) — return `[]` → structured
4. `db:getTransactionsForCustomer` (line 175-183) — throw `e` currently; wrap in structured
5. `db:getSupplierByPhone` (line 409-421) — return `null` → structured
6. `db:getSupplierByGSTIN` (line 423-435) — return `null` → structured
7. `db:getDoc` (line 446-452) — return `null` → structured
8. `db:getMonthlyAttendance` (line 497-508) — return `{}` → structured
9. `db:logTelemetry` (line 437-444) — already returns `{ success: true/false }` — keep as-is

**Edge cases / risks:**
- Callers receiving plain `[]` or `null` must be updated to check `result.success` first. This is a contract change.
- `db:logTelemetry` already returns `{ success: true/false }` — it's already structured; no change needed.
- Read handlers that `throw e` (like `db:getTransactionsForCustomer`) should be changed to return structured error instead of throwing, so the IPC layer consistently returns objects.
- The `db:getPendingCheques` handler has a `catch` that logs and returns `[]` — change to structured error.

**One-way-door decision:** Yes. This changes the IPC contract between main and renderer. All callers must be updated to handle `{ success, data, error }`. Once deployed, reverting would require reverting all callers too — a broader change than the original fix.

---

## ACC-01: User role resolved from authenticated session, not client-controlled localStorage

**Technical approach:**
- Change `getUserRole()` in `src/store/state.js` to resolve the role from the authenticated session (e.g., from the IPC `auth:login` response or from a session stored in a non-client-controllable location) rather than parsing `localStorage.getItem('mifela_user_session')`.
- The `localStorage.getItem('mifela_user_session')` is client-controllable and currently the source of `userRole`. Replace it with a value set by the auth service during login, passed from the main process via the IPC bridge.
- In practice: have `auth:login` (in `electron/main.js`, line 533-535) return the role, and `setStoreAndUserRefs` receives it as a parameter. The `getUserRole` function should prioritize the in-memory `_userRole` set by `setStoreAndUserRefs` over any localStorage fallback.

**Files to touch:**
- `src/store/state.js` — the `getUserRole` function (lines 87-95) and `setStoreAndUserRefs` (lines 142-160).
- `electron/main.js` — the `auth:login` handler (lines 533-535) to pass role through.

**Exact code location before (getUserRole):**
```js
export const getUserRole = () => {
    if (userRole) return userRole;
    try {
        const session = JSON.parse(localStorage.getItem('mifela_user_session') || '{}');
        return session.role || 'staff'; // Default to restricted role
    } catch {
        return 'staff';
    }
};
```

**After:**
```js
export const getUserRole = () => {
    // Priority 1: in-memory role set by setStoreAndUserRefs (from authenticated session)
    if (userRole) return userRole;
    // Priority 2: no client-controllable fallback — return most restrictive default
    return 'staff';
};
```

**Exact code location before (setStoreAndUserRefs — relevant portion):**
```js
export function setStoreAndUserRefs(uid, sid, role, assignedLoc = 'main') {
    // Map state to offline bypasses and sync to localStorage
    _userId = uid || 'admin_sys';
    _storeId = sid || 'DEFAULT_STORE';
    _userRole = role || 'staff';
    _userAssignedLocationId = assignedLoc;
    _currentLocationId = assignedLoc;

    userId = _userId;
    storeId = _storeId;
    userRole = _userRole;
    userAssignedLocationId = _userAssignedLocationId;
    currentLocationId = _currentLocationId;

    localStorage.setItem('mifela_active_user', userId);
    localStorage.setItem('mifela_active_store', storeId);
    console.log(`✅ Offline State Initialized: Role=${_userRole}, Location=${assignedLoc}`);
}
```

**The `auth:login` in main.js currently calls `LocalAuthService.login(username, password)`** — this should be modified to return the role, and `setStoreAndUserRefs` should be called with the role from the login result.

**Edge cases / risks:**
- If the auth service fails to return a role, the fallback `'staff'` is the most restrictive role — safe default.
- Any code that currently depends on `localStorage.getItem('mifela_user_session')` to infer role will break — must be updated to use `getUserRole()` instead.
- The `getUserId` function (line 86) also uses `localStorage.getItem('mifela_active_user')` — this is less critical for access control but should ideally also come from the authenticated session. This research focuses on `getUserRole`.
- If `setStoreAndUserRefs` is never called (e.g., cold start without login), `getUserRole` returns `'staff'` — safe default.

**One-way-door decision:** Yes. Shifting role resolution from localStorage to an authenticated session is a security hardening. If the auth flow is broken or missing, the app defaults to `'staff'` (restricted), which is the safe direction. Reverting would require reintroducing the localStorage fallback, which re-introduces the client-control vulnerability.

---

## Summary Table

| Req | Approach | Files | Key Change | One-way-door |
|-----|----------|-------|------------|--------------|
| SEC-01 | Remove `'unsafe-inline'` from CSP | `index.html` | CSP meta tag directives | Yes |
| SEC-02 | Remove licence_data/security_config from ALLOWED_TABLES | `controllers.js` | ALLOWED_TABLES set + guard in executeBatch | Yes |
| SEC-03 | Add column whitelists per table in executeBatch | `controllers.js` | COLUMNS_PER_TABLE + validation loop | Yes |
| COR-01 | Stock check before decrement in processSale | `controllers.js` | SELECT stockLevel + compare before DECREMENT | Yes |
| COR-02 | Structured error returns from read handlers | `controllers.js` | All read handlers: `{success, data, error}` | Yes |
| ACC-01 | Role from session not localStorage | `state.js` + `main.js` | `getUserRole()` prioritizes in-memory `_userRole` | Yes |