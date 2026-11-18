# Mifela POS — Data Flow & IPC Reference

**Analysis Date:** 2026-11-18  
**Focus Area:** arch

---

## 1. Overview

This document maps the end-to-end data flows and IPC (Inter-Process Communication) channels between the renderer process (frontend SPA) and the main process (Electron/Node.js backend).

All main-process-to-renderer communication crosses the **preload bridge** (`electron/preload.js`) via Electron `contextBridge` and `ipcRenderer`/`ipcMain`.

---

## 2. IPC Channel Registry

### 2.1 Database channels (`db:*`) — handled in `electron/database/controllers.js`

| Channel | Direction | Preload method | Main handler | Description |
|---------|-----------|----------------|--------------|-------------|
| `db:getProducts` | invoke | `dbAPI.getProducts()` | `ipcMain.handle('db:getProducts')` | Fetch all products (`SELECT data FROM products`) |
| `db:getTransactionsSince` | invoke | `dbAPI.getTransactionsSince(isoDate)` | `ipcMain.handle('db:getTransactionsSince')` | Transactions after a timestamp |
| `db:getPendingCheques` | invoke | `dbAPI.getPendingCheques()` | `ipcMain.handle('db:getPendingCheques')` | CHEQUE payments with status PENDING |
| `db:processSale` | invoke | `dbAPI.processSale(payload)` | `ipcMain.handle('db:processSale')` | Transactional sale (insert tx, decrement stock, update customer) |
| `db:updateChequeStatus` | invoke | `dbAPI.updateChequeStatus(txId, status, date)` | `ipcMain.handle('db:updateChequeStatus')` | Mark a cheque CLEARED/BOUNCED |
| `db:getTransactionsForCustomer` | invoke | `dbAPI.getTransactionsForCustomer(customerId)` | `ipcMain.handle('db:getTransactionsForCustomer')` | Customer's transaction history |
| `db:executeLedgerMerge` | invoke | `dbAPI.executeLedgerMerge(payload)` | `ipcMain.handle('db:executeLedgerMerge')` | Merge multiple ledger records into one |
| `db:undoLedgerMerge` | invoke | `dbAPI.undoLedgerMerge(mergedTxId)` | `ipcMain.handle('db:undoLedgerMerge')` | Restore archived records from a merge |
| `db:savePartner` | invoke | `dbAPI.savePartnerWithOpeningBalance(payload)` | `ipcMain.handle('db:savePartner')` | Upsert customer + opening-balance transaction |
| `db:processFinancialTransaction` | invoke | `dbAPI.processFinancialTransaction(payload)` | `ipcMain.handle('db:processFinancialTransaction')` | Standalone financial transaction + customer dues |
| `db:updateLoyaltyTokens` | invoke | `dbAPI.updateLoyaltyTokens(id, tokens)` | `ipcMain.handle('db:updateLoyaltyTokens')` | Increment customer loyalty points |
| `db:deleteCustomer` | invoke | `dbAPI.deleteCustomer(id)` | `ipcMain.handle('db:deleteCustomer')` | Delete a customer |
| `db:resetPartnerAccount` | invoke | `dbAPI.resetPartnerAccount(id)` | `ipcMain.handle('db:resetPartnerAccount')` | Reset dues/loyalty, delete customer's transactions |
| `db:runDirectoryCleanup` | invoke | `dbAPI.runDirectoryCleanup(type)` | `ipcMain.handle('db:runDirectoryCleanup')` | Merge duplicate customers by phone |
| `db:getSupplierByPhone` | invoke | `dbAPI.getSupplierByPhone(phone)` | `ipcMain.handle('db:getSupplierByPhone')` | Lookup supplier/dealer/store by phone |
| `db:getSupplierByGSTIN` | invoke | `dbAPI.getSupplierByGSTIN(gstin)` | `ipcMain.handle('db:getSupplierByGSTIN')` | Lookup supplier by GSTIN |
| `db:executeBatch` | invoke | `dbAPI.executeBatch(ops)` | `ipcMain.handle('db:executeBatch')` | Batched set/update/delete across tables |
| `db:getDoc` | invoke | `dbAPI.getDoc(col, id)` / `electronAPI.getDoc` | `ipcMain.handle('db:getDoc')` | Generic document fetch (directory_merchants → customers) |
| `db:deleteDoc` | invoke | `dbAPI.deleteDoc(col, id)` | `ipcMain.handle('db:deleteDoc')` | Generic document delete |
| `db:saveStoreSettings` | invoke | `electronAPI.saveStoreSettings(...)` | `ipcMain.handle('db:saveStoreSettings')` | Upsert store settings (creates table if missing) |
| `db:logTelemetry` | invoke | `dbAPI.logTelemetry(action, data)` | `ipcMain.handle('db:logTelemetry')` | Local-only telemetry log (console.log) |
| `db:getProductByBarcode` | invoke | (not in preload; direct) | `ipcMain.handle('db:getProductByBarcode')` | Lookup product by barcode or SKU |
| `db:adjustStockAtomic` | invoke | (not in preload; direct) | `ipcMain.handle('db:adjustStockAtomic')` | Atomic stock increment |

### 2.2 System channels (`system:*`) — handled in `electron/main.js`

| Channel | Direction | Preload method | Description |
|---------|-----------|----------------|-------------|
| `system:get-machine-id` | invoke | `electronAPI.getMachineId()` | SHA-256 of primary MAC / hostname fallback |
| `system:get-local-ip` | invoke | `electronAPI.getLocalIP()` | First non-internal IPv4 address |
| `system:save-file` | invoke | (used internally) | Save dialog + write buffer to user-chosen path |

### 2.3 Security channels (`security:*`) — handled in `electron/main.js`

| Channel | Direction | Preload method | Description |
|---------|-----------|----------------|-------------|
| `security:get-state` | invoke | `electronAPI.getSecurityState()` | License state: UNPROVISIONED / VERIFICATION_REQUIRED / ACTIVE |
| `security:provision` | invoke | `electronAPI.provisionSecurity(data)` / `provisionTerminal` | Generate & store RSA key pair, encrypted by fingerprint |
| `security:sign-challenge` | invoke | `electronAPI.signChallenge(challengeHex)` | Sign challenge with device-encrypted private key |
| `security:extend-license` | invoke | `electronAPI.extendLicense()` | Push nextVerificationDate +30 days |

### 2.4 Auth channels (`auth:*`) — handled in `electron/main.js`

| Channel | Direction | Preload method | Description |
|---------|-----------|----------------|-------------|
| `auth:save-token` | invoke | `electronAPI.saveToken(token)` | Encrypt token via `safeStorage`, write to `userData/auth_token.enc` |
| `auth:get-token` | invoke | `electronAPI.getToken()` | Read + decrypt token; delete on failure |
| `auth:delete-token` | invoke | `electronAPI.deleteToken()` | Remove token file |

### 2.5 Printing channels (`print:*`) — handled in `electron/main.js`

| Channel | Direction | Preload method | Description |
|---------|-----------|----------------|-------------|
| `print:get-printers` | invoke | `electronAPI.getPrinters()` / `printAPI.getPrinters()` | OS printer list via `webContents.getPrintersAsync()` |
| `print:job` | invoke | `electronAPI.printSilent(options)` / `printAPI.printJob` | Render HTML in hidden print worker, call `webContents.print()` |
| `print:raw` | invoke | `electronAPI.printRaw(options)` | Raw ESC/POS byte-stream to USB serial / TCP / HTML fallback |

### 2.6 Auto-updater channels (`electron/main.js`)

| Channel | Direction | Preload method | Description |
|---------|-----------|----------------|-------------|
| `app:get-version` | invoke | `electronAPI.updater.getVersion()` | `app.getVersion()` |
| `check-for-updates` | send | `electronAPI.updater.check()` | Trigger `autoUpdater.checkForUpdates()` |
| `start-update-download` | send | `electronAPI.updater.startDownload()` | `autoUpdater.downloadUpdate()` |
| `install-update-now` | send | `electronAPI.updater.install()` / `installNow` | `autoUpdater.quitAndInstall()` |
| `restart-to-update` | send | `electronAPI.updater.restartToUpdate()` | `autoUpdater.quitAndInstall()` |
| `updater-event` | send (main→renderer) | `electronAPI.updater.onEvent(cb)` | Status events: checking / available / not-available / progress / downloaded / error |

### 2.7 Deep-link / protocol events (main→renderer, no IPC invoke)

| Event | Source | Renderer listener | Description |
|-------|--------|-------------------|-------------|
| `mifela-payment-verified` | `app.on('open-url')` `/payment-verified` | `electronAPI.onPaymentVerified(cb)` | Razorpay redirect payload |
| `mifela-auth-token` | `app.on('open-url')` `?token=` | `electronAPI.onAuthToken(cb)` | Auth token from deep link |
| `scanner:new-file` | `chokidar` hot-folder add | `scannerAPI.onNewScan(cb)` | New scanned document |
| `updater-event` | `autoUpdater` events | `electronAPI.updater.onEvent(cb)` | Update status |

---

## 3. Key Data Flows

### 3.1 POS Sale (transactional)

```
Renderer (pos.js)
    │ handleCheckout()
    │ window.dbAPI.processSale({ transaction, customerUpdate })
    ▼
Preload (preload.js)
    │ ipcRenderer.invoke('db:processSale', payload)
    ▼
Main (controllers.js registerDBHandlers)
    │ knex.transaction(async trx => {
    │   trx('transactions').insert({...})
    │   for each item: trx('products').decrement('stockLevel', qty)  [skip homemade]
    │   if customerUpdate: upsert customer (dues, loyaltyPoints)
    │ })
    ▼
Returns { success: true } ───┐
                             ▼
Renderer updates cart UI, prints invoice, shows toast
```

### 3.2 License verification (offline / online)

```
Renderer (app.js initializeAuth)
    │ window.electronAPI.getSecurityState()
    ▼
Preload → ipcRenderer.invoke('security:get-state')
    ▼
Main → LicenseManager.verifyLocalState()
    │
    ├─ UNPROVISIONED ───► show activation UI
    │
    ├─ VERIFICATION_REQUIRED (online)
    │    │ fetch challenge from Cloud Function requestChallenge
    │    │ window.electronAPI.signChallenge(challengeHex)
    │    │   → security:sign-challenge → LicenseManager.executeChallenge
    │    │    (decrypts RSA private key with fingerprint-derived AES key, signs)
    │    │ POST signature to Cloud Function verifyChallenge
    │    │ window.electronAPI.extendLicense()  (+30 days)
    │
    └─ VERIFICATION_REQUIRED (offline) ──► error: connect to internet
    │
    └─ ACTIVE ───► proceed to app UI
```

### 3.3 Printing (invoice / thermal)

```
Renderer (app.js executePrint)
    │ reads localStorage printer config (mifela_printer_config, mifela_smart_printers)
    │ window.electronAPI.printSilent({ content, printerName, pageSize, silent })
    ▼
Preload → ipcRenderer.invoke('print:job', options)
    ▼
Main (main.js)
    │ hidden print worker BrowserWindow loads data:text/html
    │ webContents.print({ silent, deviceName, color:false, printBackground:true, margins })
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

---

## 4. Database Schema (SQLite)

File: `userData/mifela_pos_v1.db`

**products**
- id TEXT PK, locationId TEXT, name TEXT, sku TEXT, barcode TEXT, price REAL, cost REAL, stockLevel REAL, lowStockThreshold REAL, data TEXT
- Indexes: `idx_products_barcode`, `idx_products_sku`

**customers**
- id TEXT PK, name TEXT, phone TEXT, type TEXT, dues REAL DEFAULT 0, loyaltyPoints INTEGER DEFAULT 0, data TEXT

**transactions**
- id TEXT PK, invoiceId TEXT, locationId TEXT, type TEXT, timestamp TEXT, paymentMethod TEXT, total REAL, data TEXT
- Index: `idx_transactions_timestamp`

**security_config** (better-sqlite3 sync connection, used by LicenseManager)
- id TEXT PK, email TEXT, storeName TEXT, encryptedPrivateKey TEXT, publicKey TEXT, nextVerificationDate TEXT

**store_settings** (created lazily)
- id TEXT PK, data TEXT

---

## 5. Concurrency Notes

- All `db:*` writes that mutate multiple rows use `knex.transaction()` for atomicity (`processSale`, `processFinancialTransaction`, `executeLedgerMerge`, `undoLedgerMerge`, `savePartner`, `resetPartnerAccount`, `runDirectoryCleanup`, `executeBatch`).
- Read handlers return parsed JSON from `data` column (JSON document store pattern inside SQLite).
- `safeStorage.encryptString`/`decryptString` used for auth token at rest.

---

*Data flow analysis: 2026-11-18 — focus: arch*
