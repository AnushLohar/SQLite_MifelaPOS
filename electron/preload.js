const { contextBridge, ipcRenderer } = require('electron');

console.log("🔌 Preload script initializing...");

// 1. Static Configuration & Identifiers
contextBridge.exposeInMainWorld('__app_id', 'electron-mifela-inventory');
contextBridge.exposeInMainWorld('__initial_auth_token', null);

// 2. Local SQLite Database Bridge
contextBridge.exposeInMainWorld('dbAPI', {
  getProducts: () => ipcRenderer.invoke('db:getProducts'),
  getCustomers: () => ipcRenderer.invoke('db:getCustomers'),
  getTransactionsSince: (isoDate) => ipcRenderer.invoke('db:getTransactionsSince', isoDate),
  getPendingCheques: () => ipcRenderer.invoke('db:getPendingCheques'),
  processSale: (payload) => ipcRenderer.invoke('db:processSale', payload),
  updateChequeStatus: (txId, status, date) => ipcRenderer.invoke('db:updateChequeStatus', txId, status, date),
  getTransactionsForCustomer: (customerId) => ipcRenderer.invoke('db:getTransactionsForCustomer', customerId),
  executeLedgerMerge: (payload) => ipcRenderer.invoke('db:executeLedgerMerge', payload),
  undoLedgerMerge: (txId) => ipcRenderer.invoke('db:undoLedgerMerge', txId),
  // 🚀 NEW: The Offline Customer/Ledger Routes
  savePartnerWithOpeningBalance: (payload) => ipcRenderer.invoke('db:savePartner', payload),
  processFinancialTransaction: (payload) => ipcRenderer.invoke('db:processFinancialTransaction', payload),
  updateLoyaltyTokens: (id, tokens) => ipcRenderer.invoke('db:updateLoyaltyTokens', id, tokens),
  deleteCustomer: (id) => ipcRenderer.invoke('db:deleteCustomer', id),
  resetPartnerAccount: (id) => ipcRenderer.invoke('db:resetPartnerAccount', id),
  runDirectoryCleanup: (type) => ipcRenderer.invoke('db:runDirectoryCleanup', type),
  logTelemetry: (eventName, data) => ipcRenderer.invoke('db:logTelemetry', eventName, data),
  getSupplierByPhone: (phone) => ipcRenderer.invoke('db:getSupplierByPhone', phone),
  getSupplierByGSTIN: (gstin) => ipcRenderer.invoke('db:getSupplierByGSTIN', gstin),
  getEntityByGSTIN: (gstin) => ipcRenderer.invoke('db:getEntityByGSTIN', gstin),
  executeBatch: (ops) => ipcRenderer.invoke('db:executeBatch', ops),
  getDoc: (col, id) => ipcRenderer.invoke('db:getDoc', col, id),
  deleteDoc: (col, id) => ipcRenderer.invoke('db:deleteDoc', col, id),
});

// 3. Core System & Application API
contextBridge.exposeInMainWorld('electronAPI', {
  // --- System & Hardware ---
  getMachineId: () => ipcRenderer.invoke('system:get-machine-id'),
  getLocalIP: () => ipcRenderer.invoke('system:get-local-ip'),
  getAppId: () => 'electron-mifela-inventory',
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  quitApp: () => ipcRenderer.send('quit-app'),
  writeLog: (filename, content) => ipcRenderer.send('log:write', { filename, content }),
  provisionSecurity: (data) => ipcRenderer.invoke('security:provision', data),
  // 🚀 NEW: Asymmetric Security Enclave
  getSecurityState: () => ipcRenderer.invoke('security:get-state'),
  provisionTerminal: (data) => ipcRenderer.invoke('security:provision', data),
  signChallenge: () => ipcRenderer.invoke('security:sign-challenge'),
  extendLicense: () => ipcRenderer.invoke('security:extend-license'),
  getDoc: (col, id) => ipcRenderer.invoke('db:getDoc', col, id),
  saveStoreSettings: (storeId, settings) => ipcRenderer.invoke('db:save-store-settings', { storeId, settings }),
  // --- Local Auth Token Management ---
  saveToken: (token) => ipcRenderer.invoke('auth:save-token', token),
  getToken: () => ipcRenderer.invoke('auth:get-token'),
  deleteToken: () => ipcRenderer.invoke('auth:delete-token'),
  onAuthToken: (callback) => {
    const subscription = (_event, token) => callback(token);
    ipcRenderer.on('mifela-auth-token', subscription);
    return () => ipcRenderer.removeListener('mifela-auth-token', subscription);
  },

  // --- Payment Verification (Razorpay Gateway Redirect) ---
  onPaymentVerified: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('mifela-payment-verified', subscription);
    return () => ipcRenderer.removeListener('mifela-payment-verified', subscription);
  },

  // --- Printing (Direct Shortcut) ---
  getPrinters: () => ipcRenderer.invoke('print:get-printers'),
  printSilent: (options) => ipcRenderer.invoke('print:job', options),
  // 🚀 THE FIX: Raw ESC/POS byte-stream printing used by the TSC adapter
  printRaw: (options) => ipcRenderer.invoke('print:raw', options),

  // --- Auto-Updater Controls ---
  updater: {
    // 🚀 ADD THIS LINE TO FIX THE CRASH:
    getVersion: () => ipcRenderer.invoke('app:get-version'),

    check: () => ipcRenderer.send('check-for-updates'),
    startDownload: () => ipcRenderer.send('start-update-download'),
    installNow: () => ipcRenderer.send('install-update-now'),
    restartToUpdate: () => ipcRenderer.send('restart-to-update'),
    // 🚀 THE FIX: Direct install shortcut used by Updater.js & app.js
    install: () => ipcRenderer.send('install-update-now'),
    onEvent: (callback) => {
      const subscription = (_event, type, data) => callback(type, data);
      ipcRenderer.on('updater-event', subscription);
      return () => ipcRenderer.removeListener('updater-event', subscription);
    }
  },
  login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
  getLicenceState: () => ipcRenderer.invoke('licence:getState')
});

// 4. Dedicated Printing API
contextBridge.exposeInMainWorld('printAPI', {
  printJob: (data) => ipcRenderer.invoke('print:job', data),
  getPrinters: () => ipcRenderer.invoke('print:get-printers')
});

// 5. Hardware Document Scanner API
contextBridge.exposeInMainWorld('scannerAPI', {
  onNewScan: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('scanner:new-file', subscription);
    return () => ipcRenderer.removeListener('scanner:new-file', subscription);
  }
});

console.log("✅ Preload script loaded. APIs exposed.");