# Codebase Concerns

**Analysis Date:** 2026-11-18  
**Focus:** concerns  
**Method:** Static review of `electron/`, `src/`, `index.html`, `package.json`; confirmed against the working-tree diff (`git diff --stat`) and recent commits (`1824018 14nov`, `dc29258 13nov`).

---

## Summary

| Severity | Count | Areas |
|----------|-------|-------|
| Critical | 1 | Print worker security bypass |
| High | 1 | Hardcoded Firebase key |
| Medium | 3 | Stock can go negative, exposed preload API surface, no IPC input validation |
| Low | 3 | No tests, no linting, CSP unsafe-inline/unsafe-eval |

---

## Critical Concerns

### C1. License verification crashes at runtime (broken DB import)

**Issue:** `electron/security/licenseVerifier.js` imports `getDB` from `../database/connection.js` (the `better-sqlite3` layer) and calls `getDB().prepare(...)`. But `electron/main.js` no longer calls `initDB()` from `connection.js` — it now calls `initKnex()` from `knex.js`. On any install, `getDB()` throws `"Database not initialized! Call initDB first."`, so `verifyLocalState()`, `executeChallenge()`, and `updateVerificationDate()` all throw. The terminal can never be activated, verified, or re-licensed.

**Files:**
- `electron/security/licenseVerifier.js` (lines 3, 33, 42, 63, 92)
- `electron/database/connection.js` (dead after knex migration — never invoked)
- `electron/main.js` (no longer calls `initDB`)

**Impact:** License activation, verification, and challenge-signing are non-functional. Users cannot unlock the terminal.

**Fix approach:** Either (a) repoint `licenseVerifier.js` to the knex instance (`getKnex` from `./knex.js`) and rewrite the SQL to knex queries against `security_config`, or (b) keep `better-sqlite3` for the security enclave and call `initDB()` alongside `initKnex()` in `main.js`. Also ensure the `security_config` table is created on startup.

---

### C2. No database tables are created on fresh installs (dead schema init)

**Issue:** `electron/database/connection.js` is the only module that runs `CREATE TABLE IF NOT EXISTS` for `products`, `customers`, `transactions`, and `security_config`. After the knex migration, `main.js` no longer calls `initDB()`, and `electron/database/controllers.js` (knex) never creates any table. On a clean install the DB file is created by knex but with zero tables, so every query (`db:getProducts`, `db:processSale`, etc.) fails with `SQLITE_ERROR: no such table`.

**Files:**
- `electron/database/connection.js` (schema init, now never invoked)
- `electron/main.js` (calls `initKnex` only)
- `electron/database/controllers.js` (knex queries, no table creation)

**Impact:** Application is non-functional out of the box; all data read/write operations fail.

**Fix approach:** Move the schema creation into the knex initialization path (`initKnex` in `knex.js` or a bootstrap step in `registerDBHandlers`) so tables exist before any query runs, using `knex.schema.createTableIfNotExists`.

---

### C3. Print worker disables sandbox isolation (XSS / RCE vector)

**Issue:** `createPrintWorker()` in `electron/main.js` creates a headless `BrowserWindow` with:

```js
webPreferences: {
  nodeIntegration: true,
  contextIsolation: false,
  ...
}
```

and loads renderer-controlled HTML via `data:text/html;charset=utf-8,${encodeURIComponent(html)}` (from `print:job` and `print:raw` IPC handlers). With `contextIsolation: false` and `nodeIntegration: true`, any script injected into the printed HTML gets full Node.js access in the main-process context.

**Files:**
- `electron/main.js` (`createPrintWorker`, lines 482-496; `print:job` handler, lines 236-269; `print:raw` handler, lines 314-379)

**Impact:** Arbitrary code execution in the Electron main process via malicious print content. This is the highest-severity security exposure in the codebase.

**Fix approach:** Run the print worker with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and pass print content through a preload bridge rather than raw `data:` URLs. Sanitize HTML before rendering.

---

## High Concerns

### H1. Dual database layer (better-sqlite3 + knex/sqlite3) on the same file

**Issue:** The project depends on both `better-sqlite3` (via `connection.js`) and `sqlite3`/`knex` (via `knex.js`), and both open `mifela_pos_v1.db` in `app.getPath('userData')`. They are separate library instances with separate connection pools, locks, and transaction semantics. Concurrent writes (e.g., a knex `processSale` transaction overlapping a better-sqlite3 `security_config` write) can corrupt the SQLite database or raise `SQLITE_BUSY`.

**Files:**
- `electron/database/connection.js`
- `electron/database/knex.js`
- `electron/security/licenseVerifier.js` (uses better-sqlite3)
- `electron/database/controllers.js` (uses knex)

**Impact:** Database corruption under concurrent access; unpredictable locking errors.

**Fix approach:** Consolidate to a single database driver. Prefer knex (already migrated for controllers) and repoint `licenseVerifier.js` to it. Remove `better-sqlite3`/`connection.js` from the runtime path.

---

### H2. Firebase configuration hardcoded in client-side bundle

**Issue:** `src/app.js` embeds the full Firebase config (API key, authDomain, projectId, storageBucket, messagingSenderId, appId) directly in the shipped JavaScript bundle:


This key is extracted by anyone who inspects the app (asar archive) and can be abused against the Firebase project.

**Files:**
- `src/app.js` (lines 29-36)

**Impact:** Key exfiltration, unauthorized Firebase access, potential billing abuse or data exposure.

**Fix approach:** Move Firebase configuration out of the client bundle. Provide it at runtime via a secure config file or environment variable, or restrict the API key with HTTP referrer / app-check restrictions in the Firebase console.

---

### H3. Role-based access control is fully bypassed

**Issue:** `src/store/state.js` hard-codes every authorization check:

- `getUserRole = () => 'admin'` ("🚀 FORCE ADMIN GLOBALLY")
- `getCurrentUserPlan = () => 'unlocked'` ("🚀 FORCE ENTERPRISE")
- `hasPermission = (role, viewName) => true` ("🚀 THE FIX: Always return true to bypass the Reports and Staff permission walls")

`src/app.js` also runs `injectOfflineBypasses()`, which forcibly upgrades any existing local session to `role: 'admin'`.

**Files:**
- `src/store/state.js` (lines 10, 44-53, 85-87, 319-321)
- `src/app.js` (lines 83-99)

**Impact:** All role gates (Reports, Staff, Settings, admin-only actions) are ineffective. Any local user gains full terminal access.

**Fix approach:** Restore real role resolution from the authenticated session (Firebase auth token / license payload), remove the hard-coded `admin` returns, and enforce `hasPermission` against the actual user role.

---

### H4. Database errors are silently swallowed (empty-array masking)

**Issue:** Multiple read handlers in `electron/database/controllers.js` catch errors and return `[]` (or `null`), so callers cannot distinguish "no data" from "query failed":

- `db:getProducts` → returns `[]`
- `db:getTransactionsSince` → returns `[]`
- `db:getPendingCheques` → returns `[]`
- `db:getDoc` → returns `null`

Write handlers re-throw, but reads silently mask schema errors, connection failures, and table-missing errors (which, per concern C2, happen on fresh installs).

**Files:**
- `electron/database/controllers.js` (read handlers)

**Impact:** Failed reads look like empty datasets; UI shows nothing with no error surfaced; debugging is difficult; data-loss scenarios go unnoticed.

**Fix approach:** Return structured results `{ success, data, error }` from IPC handlers, or at minimum log and surface errors to the renderer instead of masking them.

---

## Medium Concerns

### M1. Stock can go negative (no availability check)

**Issue:** `db:processSale` decrements `stockLevel` for every sold item without verifying that sufficient stock exists:

```js
await trx('products').where({ id: item.id }).decrement('stockLevel', item.quantity);
```

There is no guard against `stockLevel - quantity < 0`, so overselling is possible.

**Files:**
- `electron/database/controllers.js` (`db:processSale`, lines 88-94)

**Impact:** Negative inventory, inaccurate stock records, oversold items.

**Fix approach:** Add a pre-check inside the transaction that reads current `stockLevel` and aborts if `stockLevel < item.quantity`.

---

### M2. Excessive IPC surface exposed to renderer

**Issue:** `electron/preload.js` exposes a very broad set of IPC invocations through `dbAPI`, `electronAPI`, `printAPI`, and `scannerAPI`, including raw printer byte-stream access (`printRaw`), raw file save dialogs (`system:save-file`), log writing (`log:write`), auto-update triggers, and raw DB batch operations (`executeBatch`). There is no per-call authorization — any renderer code can invoke any handler.

**Files:**
- `electron/preload.js`
- `electron/main.js` (`registerIpcHandlers`)

**Impact:** Compromised renderer (e.g., via XSS) gains direct access to filesystem, printer hardware, update mechanism, and arbitrary DB writes.

**Fix approach:** Minimize the exposed API surface to only what the UI needs, and add authorization checks inside IPC handlers where sensitive operations are performed.

---

### M3. No input validation on IPC handler arguments

**Issue:** IPC handlers such as `db:processSale`, `db:executeBatch`, `db:runDirectoryCleanup`, `print:job`, and `system:save-file` accept raw arguments from the renderer with no schema validation. `executeBatch` in particular allows arbitrary `set`/`update`/`delete` operations on any table, including column-free JSON blobs.

**Files:**
- `electron/database/controllers.js`
- `electron/main.js`

**Impact:** Malformed or malicious payloads can cause crashes, partial updates, or unintended data modification/deletion.

**Fix approach:** Validate all IPC arguments (required fields, types, allowed tables/ops) before acting on them.

---

## Low Concerns

### L1. No automated testing

**Issue:** No test framework, no test files (`.test.js`/`.spec.js`), and no CI test step are present (confirmed by `TESTING.md`). The entire `src/` and `electron/` directories are untested.

**Impact:** High regression risk during refactors (e.g., the knex migration introduced concerns C1/C2 without test coverage to catch them).

**Fix approach:** Add Vitest/Jest with unit tests for `controllers.js` handlers and `licenseVerifier.js`, plus integration tests for critical paths (`processSale`, `executeLedgerMerge`).

---

### L2. No linting or formatting configuration

**Issue:** No ESLint, Prettier, or editorconfig is configured. Code style is inconsistent across the codebase.

**Files:** Project-wide

**Impact:** Inconsistent style, higher chance of syntax/scope bugs slipping through review.

**Fix approach:** Add ESLint + Prettier with a pre-commit hook.

---

### L3. Weak Content Security Policy in index.html

**Issue:** `index.html` uses `'unsafe-inline'` and `'unsafe-eval'` in `script-src`, weakening XSS protection for the renderer process.

**Files:**
- `index.html` (CSP meta tag)

**Impact:** Easier exploitation of any XSS injection; inline scripts can execute.

**Fix approach:** Tighten the CSP to remove `unsafe-inline` and `unsafe-eval`, use nonces or hashes for required inline scripts.

---

## Already Addressed (do not re-open)

| Concern | Status | Evidence |
|---------|--------|----------|
| Database: raw `better-sqlite3` queries | Migrated to Knex.js query builder | `controllers.js` now uses `getKnex()`; `main.js` imports `initKnex` (diff `1824018`) |
| C1: License verification crash | Fixed | `licenseVerifier.js` repointed to `getKnex()`; async methods awaited in `main.js` |
| C2: No DB tables on fresh installs | Fixed | `initKnex()` in `knex.js` runs `createTableIfNotExists` for all tables incl. `security_config` |
| H1: Dual database layer | Fixed | `connection.js` deleted; `better-sqlite3`/`better-sqlite3-multiple-ciphers` removed from `package.json` |
| Obfuscation reliance | Documented risk, not a code defect | `javascript-obfuscator` in build scripts; obfuscation is not security |

---

## Frontend framework note (observation, not a defect)

Earlier documentation described the frontend as React; the codebase is actually vanilla JavaScript. No React import exists anywhere in `src/` or `index.html`. `ARCHITECTURE.md` should be corrected to reflect vanilla JS + Tailwind.

---

## Recommended Remediation Order

1. **C3** — Harden the print worker (`contextIsolation`, `sandbox`, no raw `data:` URLs).
2. **H2** — Remove the hardcoded Firebase key from the client bundle.
3. **H3** — Restore real role-based access control.
4. **H4** — Surface DB errors instead of returning empty arrays.
5. **M1/M2/M3** — Stock guard, reduced IPC surface, IPC argument validation.
6. **L1/L2/L3** — Add testing, linting, and tighten CSP.

---

*Concerns audit: 2026-11-18*
