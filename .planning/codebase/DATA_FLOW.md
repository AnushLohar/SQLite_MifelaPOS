# Mifela POS — Data Flow & IPC Reference

**Analysis Date:** 2026-11-21  
**Focus Area:** arch

---

## 1. Overview

This document maps the end-to-end data flows and IPC (Inter-Process Communication) channels between the renderer process (frontend SPA) and the main process (Electron/Node.js backend).

All main-process-to-renderer communication crosses the **preload bridge** (`electron/preload.js`) via Electron `contextBridge` and `ipcRenderer`/`ipcMain`. The print worker window uses a separate isolated preload (`electron/printPreload.js`).

---

## 2. IPC Channel Registry

### 2.1 Database channels (`db:*`) — handled in `electron/database/controllers.js`

| Channel | Direction | Preload method | Main handler | Description |
|---------|-----------|----------------|--------------|-------------|
| `db:getProducts` | invoke | `dbAPI.getProducts()` | `ipcMain.handle('db:getProducts')` | Fetch all products |
| `db:getTransactionsSince` | invoke | `dbAPI.getTransactionsSince(isoDate)` | `ipcMain.handle('db:getTransactionsSince')` | Transactions after a timestamp |
| `db:getPendingCheques` | invoke | `dbAPI.getPendingCheques()` | `ipcMain.handle('db:getPendingCheques')` | CHEQUE payments with status PENDING |
| `db:processSale` | invoke | `dbAPI.processSale(payload)` | `ipcMain.handle('db:processSale')` | Transactional sale (insert tx, decrement stock, update customer). Guarded by `authorize()`. |
| `db:updateChequeStatus` | invoke | `dbAPI.updateChequeStatus(txId, status, date)` | `ipcMain.handle('db:updateChequeStatus')` | Mark a cheque CLEARED/BOUNCED. Authorized. |
| `db:getTransactionsForCustomer` | invoke | `dbAPI.getTransactionsForCustomer(customerId)` | `ipcMain.handle('db:getTransactionsForCustomer')` | Customer's transaction history |
| `db:executeLedgerMerge` | invoke | `dbAPI.executeLedgerMerge(payload)` | `ipcMain.handle('db:executeLedgerMerge')` | Merge multiple ledger records into one. Authorized. |
| `db:undoLedgerMerge` | invoke | `dbAPI.undoLedgerMerge(mergedTxId)` | `ipcMain.handle('db:undoLedgerMerge')` | Restore archived records from a merge. Authorized. |
| `db:savePartner` | invoke | `dbAPI.savePartnerWithOpeningBalance(payload)` | `ipcMain.handle('db:savePartner')` | Upsert customer + opening-balance transaction. Authorized. |
| `db:processFinancialTransaction` | invoke | `dbAPI.processFinancialTransaction(payload)` | `ipcMain.handle('db:processFinancialTransaction')` | Standalone financial transaction + customer dues. Authorized. |
| `db:updateLoyaltyTokens` | invoke | `dbAPI.updateLoyaltyTokens(id, tokens)` | `ipcMain.handle('db:updateLoyaltyTokens')` | Increment customer loyalty points. Authorized. |
| `db:deleteCustomer` | invoke | `dbAPI.deleteCustomer(id)` | `ipcMain.handle('db:deleteCustomer')` | Delete a customer. Authorized. |
| `db:resetPartnerAccount` | invoke | `dbAPI.resetPartnerAccount(id)` | `ipcMain.handle('db:resetPartnerAccount')` | Reset dues/loyalty, delete customer's transactions. Authorized. |
| `db:runDirectoryCleanup` | invoke | `dbAPI.runDirectoryCleanup(type)` | `ipcMain.handle('db:runDirectoryCleanup')` | Merge duplicate customers by phone. Authorized. |
| `db:getSupplierByPhone` | invoke | `dbAPI.getSupplierByPhone(phone)` | `ipcMain.handle('db:getSupplierByPhone')` | Lookup supplier/dealer/store by phone |
| `db:getSupplierByGSTIN` | invoke | `dbAPI.getSupplierByGSTIN(gstin)` | `ipcMain.handle('db:getSupplierByGSTIN')` | Lookup supplier by GSTIN |
| `db:executeBatch` | invoke | `dbAPI.executeBatch(ops)` | `ipcMain.handle('db:executeBatch')` | Batched set/update/delete across tables. Authorized. Broad surface (CONCERNS H2). |
| `db:getDoc` | invoke | `dbAPI.getDoc(col, id)` / `electronAPI.getDoc` | `ipcMain.handle('db:getDoc')` | Generic document fetch |
| `db:deleteDoc` | invoke | `dbAPI.deleteDoc(col, id)` | `ipcMain.handle('db:deleteDoc')` | Generic document delete. Authorized. |
| `db:save-store-settings` | invoke | `electronAPI.saveStoreSettings(storeId, settings)` | `ipcMain.handle('db:save-store-settings')` | Upsert store settings (creates table if missing). Authorized. |
| `db:logTelemetry` | invoke | `dbAPI.logTelemetry(action, data)` | `ipcMain.handle('db:logTelemetry')` | Local-only telemetry log |
| `db:getProductByBarcode` | invoke | (not in preload; direct) | `ipcMain.handle('db:getProductByBarcode')` | Lookup product by barcode or SKU |
| `db:adjustStockAtomic` | invoke | (not in preload; direct) | `ipcMain.handle('db:adjustStockAtomic')` | Atomic stock increment |
| `db:saveAttendance` | invoke | (not in preload; direct) | `ipcMain.handle('db:saveAttendance')` | Attendance persistence (renderer-driven). Authorized. |
| `db:getMonthlyAttendance` | invoke | (not in preload; direct) | `ipcMain.handle('db:getMonthlyAttendance')` | Monthly attendance read |

### 2.2 System channels (`system:*`) — handled in `electron/main.js`

| Channel | Direction | Preload method | Description |
|---------|-----------|----------------|-------------|
| `system:get-machine-id` | invoke | `electronAPI.getMachineId()` | SHA-256 of primary MAC / hostname fallback |
| `system:get-local-ip` | invoke | `electronAPI.getLocalIP()` | First non-internal IPv4 address |
| `system:save-file` | invoke | (used internally) | Save dialog + write buffer to user-chosen path |

### 2.3 Security channels (`security:*`) — handled in `electron/main.js`

| Channel | Direction | Preload method | Description |
|---------|-----------|----------------|-------------|
| `security:get-state` | invoke | `electronAPI.getSecurityState()` | Licence state via `LicenceStateManager.evaluateCurrentState()` |
| `security:provision` | invoke | `electronAPI.provisionSecurity(data)` / `provisionTerminal` | Activate terminal: fetch signed licence payload from `verifyNodeLicense`, write `licence_data` |
| `security:sign-challenge` | invoke | `electronAPI.signChallenge()` | (legacy) sign challenge |
| `security:extend-license` | invoke | `electronAPI.extendLicense()` | (legacy) extend licence |

### 2.4 Auth channels (`auth:*`) — handled in `electron/main.js`

| Channel | Direction | Preload method | Description |
|---------|-----------|----------------|-------------|
| `auth:save-token` | invoke | `electronAPI.saveToken(token)` | Encrypt token via `safeStorage`, write to `userData/auth_token.enc` |
| `auth:get-token` | invoke | `electronAPI.getToken()` | Read + decrypt token; delete on failure |
| `auth:delete-token` | invoke | `electronAPI.deleteToken()` | Remove token file |
| `auth:login` | invoke | `electronAPI.login(username, password)` | `LocalAuthService.login` (bcrypt vs `local_users`) |

### 2.5 Licence channels (`licence:*`) — handled in `electron/main.js`

| Channel | Direction | Preload method | Description |
|---------|-----------|----------------|-------------|
| `licence:getState` | invoke | `electronAPI.getLicenceState()` | `LicenceStateManager.evaluateCurrentState()` |

### 2.6 Printing channels (`print:*`) — handled in `electron/main.js`

| Channel | Direction | Preload method | Description |
|---------|-----------|----------------|-------------|
| `print:get-printers` | invoke | `electronAPI.getPrinters()` / `printAPI.getPrinters()` | OS printer list via `webContents.getPrintersAsync()` |
| `print:job` | invoke | `electronAPI.printSilent(options)` / `printAPI.printJob` | Render `printBlank.html` in sandboxed print worker, send HTML via `print:render-html`, call `webContents.print()` |
| `print:raw` | invoke | `electronAPI.printRaw(options)` | Raw ESC/POS byte-stream to USB serial / TCP / HTML fallback |

**Print worker bridge (`print:render-html` / `print:render-result`):** main → worker sends sanitized HTML over `ipc-message` (`print:render-html`); worker preload (`printBridge.print`) invokes `print:render` back to main; worker sends result via `print:render-result`. No renderer-controlled `data:` URLs; `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.

### 2.7 Auto-updater channels (`electron/main.js`)

| Channel | Direction | Preload method | Description |
|---------|-----------|----------------|-------------|
| `app:get-version` | invoke | `electronAPI.updater.getVersion()` | `app.getVersion()` |
| `check-for-updates` | send | `electronAPI.updater.check()` | Trigger `autoUpdater.checkForUpdates()` |
| `start-update-download` | send | `electronAPI.updater.startDownload()` | `autoUpdater.downloadUpdate()` |
| `install-update-now` | send | `electronAPI.updater.installNow()` / `install` | `autoUpdater.quitAndInstall()` |
| `restart-to-update` | send | `electronAPI.updater.restartToUpdate()` | `autoUpdater.quitAndInstall()` |
| `updater-event` | send (main→renderer) | `electronAPI.updater.onEvent(cb)` | Status events |

### 2.8 Deep-link / protocol events (main→renderer, no IPC invoke)

| Event | Source | Renderer listener | Description |
|-------|--------|-------------------|-------------|
| `mifela-payment-verified` | `app.on('open-url')` `/payment-verified` | `electronAPI.onPaymentVerified(cb)` | Razorpay redirect payload |
| `mifela-auth-token` | `app.on('open-url')` `?token=` | `electronAPI.onAuthToken(cb)` | Auth token from deep link |
| `scanner:new-file` | `chokidar` hot-folder add | `scannerAPI.onNewScan(cb)` | New scanned document |
| `security:license-restored` | `BackgroundVerificationScheduler` | renderer listener | UI unlock after background verification |
| `security:license-revoked` | `BackgroundVerificationScheduler` | renderer listener | UI lock on revocation |
| `updater-event` | `autoUpdater` events | `electronAPI.updater.onEvent(cb)` | Update status |

---

## 3. Key Data Flows

### 3.1 POS Sale (transactional, authorized)

```
Renderer (pos.js)
    │ handleCheckout()
    │ window.dbAPI.processSale({ transaction, customerUpdate })
    ▼
Preload (preload.js)
    │ ipcRenderer.invoke('db:processSale', payload)
    ▼
Main (controllers.js registerDBHandlers)
    │ authorize() → LicenceStateManager.evaluateCurrentState() !== 'ACTIVE' throws
    │ knex.transaction(async trx => {
    │   trx('transactions').insert({...})
    │   for each item: trx('products').decrement('stockLevel', qty)  [skip homemade]
    │   if customerUpdate: upsert customer (dues, loyaltyPoints)
    │ })
    ▼
Returns { success: true }
Renderer updates cart UI, prints invoice, shows toast
```

### 3.2 Licence verification (offline / online)

```
Renderer (app.js initializeAuth)
    │ window.electronAPI.getSecurityState()
    ▼
Preload → ipcRenderer.invoke('security:get-state')
    ▼
Main → LicenceStateManager.evaluateCurrentState()
    │ reads licence_data, verifies Ed25519 signature, hardware binding,
    │ revocation, expiry, 90-day offline deadline
    │
    ├─ ACTIVE ───► proceed to app UI
    ├─ VERIFICATION_DUE / VERIFICATION_PENDING ───► warn / require online sync
    ├─ INACTIVATED / UNACTIVATED ───► show activation UI
    ├─ INVALID / HARDWARE_MISMATCH / REVOKED / EXPIRED ───► block
```

Background re-verification: `ConnectivityMonitor` detects online → `BackgroundVerificationScheduler.runSilentVerification()` → `fetch verifyNodeLicense` → overwrite `licence_data` → send `security:license-restored` / `security:license-revoked` to renderer.

### 3.3 Printing (invoice / thermal)

```
Renderer (app.js executePrint)
    │ reads localStorage printer config
    │ window.electronAPI.printSilent({ content, printerName, pageSize, silent })
    ▼
Preload → ipcRenderer.invoke('print:job', options)
    ▼
Main (main.js)
    │ createPrintWorker() → sandboxed BrowserWindow loads printBlank.html
    │ printWorker.webContents.send('print:render-html', content, {...})
    │ printBridge.print(html, options) → ipcRenderer.invoke('print:render')
    │ webContents.print({ silent, deviceName, ... })
    ▼
Physical printer
```

Raw ESC/POS variant:
```
print:raw → match IP:port → net.Socket.write(bytes)
           or match COM/tty → serialport.write(bytes)
           or fallback → HTML print worker
```

### 3.4 Cloud sync (Firebase listeners)

```
src/store/listeners.js startAllListeners()
    │ setupUserSettingsListener()   → onSnapshot(userSettingsRef)
    │ setupStoresListener()         → onSnapshot(collection or doc) [artifacts/{appId}/stores]
    │ setupInventoryStatsListener() → onSnapshot(productsRef) → computes lowStock/expired/valueAtRisk
    │ setupGlobalListeners()        → onSnapshot(marketing doc) → shows marketing modal
    ▼
Each listener writes to window.__inventoryStats / dispatches CustomEvent
    │ updates local state via setDashboardWidgets, setConvenienceFee, setCurrency, setPlan
    │ re-renders dashboard when visible
```

### 3.5 Deep-link payment verification

```
Browser (Razorpay) → redirect mifela://payment-verified?payment_id=&order_id=&signature=&status=
    ▼
electron/main.js app.on('open-url')
    ▼
mainWindow.webContents.send('mifela-payment-verified', {paymentId, orderId, signature, status, error})
    ▼
Renderer electronAPI.onPaymentVerified(cb)
```

### 3.6 Local auth login

```
Renderer → electronAPI.login(username, password)
    ▼
ipcMain.handle('auth:login') → LocalAuthService.login
    │ knex('local_users').where({ username, is_active: true }).first()
    │ bcrypt.compare(password, user.password_hash)
    ▼
Returns { token, user: { id, username, role } }
```

---

## 4. Database Schema (SQLite)

File: `userData/mifela_pos_v1.db`

**products** — id TEXT PK, locationId TEXT, name TEXT, sku TEXT, barcode TEXT, price REAL, cost REAL, stockLevel REAL, lowStockThreshold REAL, data TEXT
**customers** — id TEXT PK, name TEXT, phone TEXT, type TEXT, dues REAL DEFAULT 0, loyaltyPoints INTEGER DEFAULT 0, data TEXT
**transactions** — id TEXT PK, invoiceId TEXT, locationId TEXT, type TEXT, timestamp TEXT, paymentMethod TEXT, total REAL, data TEXT
**security_config** — id TEXT PK, email TEXT, storeName TEXT, encryptedPrivateKey TEXT, publicKey TEXT, nextVerificationDate TEXT (legacy, unused by licence verification)
**store_settings** — id TEXT PK, data TEXT
**local_users** — id UUID PK, username TEXT unique, password_hash TEXT, role TEXT DEFAULT 'user', is_active BOOLEAN DEFAULT true, firebase_uid TEXT
**licence_data** — id TEXT PK, licence_payload TEXT, signature TEXT, last_verified_at TIMESTAMP, next_verification_due TIMESTAMP, status TEXT DEFAULT 'UNACTIVATED'

---

## 5. Concurrency Notes

- All `db:*` writes that mutate multiple rows use `knex.transaction()` for atomicity.
- Read handlers return parsed JSON from `data` column (JSON document store pattern inside SQLite).
- `safeStorage.encryptString`/`decryptString` used for auth token at rest.
- Single SQLite driver (knex/sqlite3); no cross-driver locking.

---

*Data flow analysis: 2026-11-21 — focus: arch*
