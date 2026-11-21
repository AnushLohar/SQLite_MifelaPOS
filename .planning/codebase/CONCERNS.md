# Codebase Concerns

**Analysis Date:** 2026-11-21  
**Focus:** concerns  
**Method:** Static review of `electron/`, `src/`, `index.html`, `package.json`; confirmed against the working-tree diff and recent commits (`7029448 21 nov`, `282c65e 17nov.05`, `1824018 14nov`).

---

## Summary

| Severity | Count | Areas |
|----------|-------|-------|
| Critical | 0 | — |
| High | 2 | Hardcoded Firebase key; broad `db:executeBatch` table access |
| Medium | 3 | Stock can go negative, exposed IPC surface, read errors masked as `[]` |
| Low | 2 | No linting, CSP still allows `unsafe-inline` |

---

## Previously Critical concerns — now resolved

| Concern | Status | Evidence |
|---------|--------|----------|
| C1: License verification crash (broken DB import) | Fixed | `licenseVerifier.js` rewritten; no longer imports `connection.js`/`getDB` |
| C2: No DB tables on fresh installs | Fixed | `initKnex()` → `initSchema()` creates all tables incl. `security_config`, `local_users`, `licence_data` |
| H1: Dual database layer (better-sqlite3 + knex) | Fixed | `better-sqlite3`/`better-sqlite3-multiple-ciphers` removed from `dependencies`; `connection.js` deleted; knex/sqlite3 is the single driver |
| C3: Print worker sandbox bypass | Fixed | `createPrintWorker` now uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, loads `printBlank.html` (not `data:` URL), bridges via `printPreload.js` |

---

## High Concerns

### H1. Firebase configuration hardcoded in client-side bundle

**Issue:** `src/app.js` embeds the full Firebase config (API key, authDomain, projectId, storageBucket, messagingSenderId, appId) directly in the shipped JavaScript bundle. This key is extracted by anyone who inspects the app (asar archive) and can be abused against the Firebase project.

**Files:** `src/app.js` (Firebase config block)

**Impact:** Key exfiltration, unauthorized Firebase access, potential billing abuse or data exposure.

**Fix approach:** Move Firebase configuration out of the client bundle. Provide it at runtime via a secure config file or environment variable, or restrict the API key with HTTP referrer / app-check restrictions in the Firebase console.

---

### H2. `db:executeBatch` allows arbitrary table writes

**Issue:** `db:executeBatch` in `electron/database/controllers.js` accepts raw `{ col, type, data, id }` ops from the renderer. Table names are whitelisted (`ALLOWED_TABLES`) but any column/value in `data` is written unsanitized, including JSON blobs and the `_isIncrement` escape hatch. Any renderer code with XSS can write arbitrary rows to `products`, `customers`, `transactions`, `licence_data`, etc.

**Files:** `electron/database/controllers.js` (`db:executeBatch`, `resolveTable`, `ALLOWED_TABLES`)

**Impact:** Malicious renderer can modify/delete any table row, corrupt stock, ledger, or licence data.

**Fix approach:** Validate op payloads (allowed columns per table, types, forbid writes to sensitive tables like `licence_data`/`security_config` from the renderer).

---

## Medium Concerns

### M1. Stock can go negative (no availability check)

**Issue:** `db:processSale` decrements `stockLevel` for every sold item without verifying that sufficient stock exists:

```js
await trx('products').where({ id: item.id }).decrement('stockLevel', item.quantity);
```

There is no guard against `stockLevel - quantity < 0`, so overselling is possible.

**Files:** `electron/database/controllers.js` (`db:processSale`)

**Impact:** Negative inventory, inaccurate stock records, oversold items.

**Fix approach:** Add a pre-check inside the transaction that reads current `stockLevel` and aborts if `stockLevel < item.quantity`.

---

### M2. Excessive IPC surface exposed to renderer

**Issue:** `electron/preload.js` exposes a very broad set of IPC invocations through `dbAPI`, `electronAPI`, `printAPI`, and `scannerAPI`, including raw printer byte-stream access (`printRaw`), raw file save dialogs (`system:save-file`), log writing (`log:write`), auto-update triggers, and raw DB batch operations (`executeBatch`). There is no per-call authorization — any renderer code can invoke any handler. (DB write handlers are guarded by `authorize()` requiring `ACTIVE` licence state, but reads and most system/print channels are not.)

**Files:** `electron/preload.js`, `electron/main.js` (`registerIpcHandlers`)

**Impact:** Compromised renderer (e.g., via XSS) gains direct access to filesystem, printer hardware, update mechanism, and arbitrary DB writes.

**Fix approach:** Minimize the exposed API surface to only what the UI needs, and add authorization checks inside IPC handlers where sensitive operations are performed.

---

### M3. Database read errors silently masked (empty-array returns)

**Issue:** Multiple read handlers in `electron/database/controllers.js` catch errors and return `[]` (or `null`), so callers cannot distinguish "no data" from "query failed":

- `db:getProducts` → `[]`
- `db:getTransactionsSince` → `[]`
- `db:getPendingCheques` → `[]`
- `db:getDoc` → `null`

Write handlers re-throw, but reads silently mask schema errors, connection failures, and table-missing errors.

**Files:** `electron/database/controllers.js` (read handlers)

**Impact:** Failed reads look like empty datasets; UI shows nothing with no error surfaced; debugging is difficult; data-loss scenarios go unnoticed.

**Fix approach:** Return structured results `{ success, data, error }` from IPC handlers, or at minimum log and surface errors to the renderer instead of masking them.

---

## Low Concerns

### L1. No linting or formatting configuration

**Issue:** No ESLint, Prettier, or editorconfig is configured. Code style is inconsistent across the codebase.

**Files:** Project-wide

**Impact:** Inconsistent style, higher chance of syntax/scope bugs slipping through review.

**Fix approach:** Add ESLint + Prettier with a pre-commit hook.

---

### L2. Weak Content Security Policy in index.html

**Issue:** `index.html` still uses `'unsafe-inline'` in `script-src` and `style-src`. Hardening was applied (removed `'unsafe-eval'`, dropped several connect-src entries, added `object-src 'none'` and `base-uri 'self'`), but `unsafe-inline` remains.

**Files:** `index.html` (CSP meta tag)

**Impact:** Easier exploitation of any XSS injection; inline scripts can execute.

**Fix approach:** Tighten the CSP to remove `unsafe-inline`, use nonces or hashes for required inline scripts.

---

## Already Addressed (do not re-open)

| Concern | Status | Evidence |
|---------|--------|----------|
| C1/C2/C3/H1 (see resolved table above) | Fixed | knex migration + schema init + print worker sandbox |
| Database raw `better-sqlite3` queries | Migrated to Knex.js | `controllers.js` uses `getKnex()`; `main.js` imports `initKnex` |

---

## Frontend framework note (observation, not a defect)

The frontend is vanilla JavaScript + Tailwind, not React. No React import exists anywhere in `src/` or `index.html`.

---

*Concerns audit: 2026-11-21*
