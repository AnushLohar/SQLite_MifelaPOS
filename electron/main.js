

// ── at the top of electron/main.js ─────────────────────────────────────
import { app, BrowserWindow, session, ipcMain, safeStorage, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import crypto from 'crypto';
import electronLog from 'electron-log';
import pkg from 'electron-updater';                 // CommonJS → get the whole package
const { autoUpdater } = pkg;                       // named export from the package
import { initKnex } from './database/knex.js';   // <-- Knex connection
import { registerDBHandlers } from './database/controllers.js';
import { LicenseManager } from './security/licenseVerifier.js';
import { getHardwareFingerprint } from './security/fingerprint.js';
// electron‑updater is a CommonJS module → import the whole package first
import { createRequire } from 'module';
import LocalAuthService from './services/LocalAuthService.js';
import LicenceStateManager from './services/LicenceStateManager.js';
import ConnectivityMonitor from './services/ConnectivityMonitor.js';
const require = createRequire(import.meta.url);
// ---------------------------------------------------------------
//  Paths & constants
// ---------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_DATA_PATH = app.getPath('userData');
const TOKEN_PATH = path.join(USER_DATA_PATH, 'auth_token.enc');

// ---------------------------------------------------------------
//  Global state
// ---------------------------------------------------------------
let mainWindow = null;
let printWorker = null;
let isQuitting = false;
let handlersRegistered = false;   // guard against double registration

// ---------------------------------------------------------------
//  Process‑wide error handling
// ---------------------------------------------------------------
process.on('uncaughtException', (error) => {
  electronLog.error('🔥 UNCAUGHT FATAL ERROR:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  electronLog.error('🔥 UNHANDLED PROMISE REJECTION:', promise, 'reason:', reason);
});

// ---------------------------------------------------------------
//  App lifecycle
// ---------------------------------------------------------------
app.on('before-quit', () => {
  isQuitting = true;
});

app.disableHardwareAcceleration();
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('log-level', '3');
app.commandLine.appendSwitch('lang', 'en-IN');

// ---------------------------------------------------------------
//  Single‑instance lock
// ---------------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // default protocol handling
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('mifela', process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient('mifela');
  }

  // Register payment verification protocol for Razorpay redirects
  // This allows posgateway.mifela.com to redirect back to mifela://payment-verified
  if (process.platform === 'darwin') {
    // macOS: protocol is handled via app.on('open-url') above
  } else if (process.platform === 'win32') {
    // Windows: protocol handling via open-url should work with setAsDefaultProtocolClient
  } else {
    // Linux: protocol handling via open-url should work with setAsDefaultProtocolClient
  }

  // open‑url handling (e.g., deep links with auth token)
  app.on('open-url', (event, url) => {
    event.preventDefault();
    const urlObj = new URL(url);

    // Handle payment verification redirect from posgateway.mifela.com
    if (urlObj.pathname === '/payment-verified') {
      const paymentId = urlObj.searchParams.get('payment_id');
      const orderId = urlObj.searchParams.get('order_id');
      const signature = urlObj.searchParams.get('signature');
      const status = urlObj.searchParams.get('status');
      const error = urlObj.searchParams.get('error');

      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.webContents.send('mifela-payment-verified', {
          paymentId,
          orderId,
          signature,
          status,
          error
        });
      }
      return;
    }

    // Handle auth token (existing)
    const token = urlObj.searchParams.get('token');
    if (token && mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.webContents.send('mifela-auth-token', token);
    }
  });

  // ---------------------------------------------------------------
  //  When the app is ready – initialise everything
  // ---------------------------------------------------------------
  app.whenReady().then(() => {
    // 1️⃣ Initialise SQLite (now that initKnex is imported)
    try {
      initKnex();                         // <-- will succeed
      registerDBHandlers();
      electronLog.info('✅ Database connected and IPC handlers registered.');
    } catch (dbError) {
      electronLog.error('❌ FATAL: DB init failed', dbError);
    }

    // 2️⃣ Register IPC handlers (guarded)
    registerIpcHandlers();

    // 3️⃣ Create UI
    createWindow();
    createPrintWorker();

    // 4️⃣ Auto‑updater (only when packaged)
    if (app.isPackaged) setupAutoUpdater(mainWindow);

    // 5️⃣ Scanner hot‑folder (dev only)
    if (!app.isPackaged) setupScannerIPC(mainWindow);

  });
}


function registerIpcHandlers() {
  if (handlersRegistered) return;   // ← prevent double‑registration
  ipcMain.handle('app:get-version', () => app.getVersion());

  // ---- security/get-state -------------------------------------------------
  ipcMain.handle('security:get-state', async () => {
    // Route the old UI startup check to our new Offline State Manager
    const state = await LicenceStateManager.evaluateCurrentState();

    // Return in an object format in case the legacy UI expects it
    return { status: state.toLowerCase() };
  });

  // ---- security:provision (Legacy Activation Stub) ------------------
  ipcMain.handle('security:provision', async (_, { email, storeName }) => {
    // Stubbed to prevent UI crashes during migration. 
    // In the new architecture, activation will happen via the new workflow.
    return { success: true, data: { message: "Migrated to offline-first licensing" } };
  });

  // ---- security:sign-challenge (Legacy Stub) ------------------------
  ipcMain.handle('security:sign-challenge', async (_, challengeHex) => {
    return { success: true, signature: "offline-first-migration-stub" };
  });

  // ---- license extension (Legacy Stub) ------------------------------------
  ipcMain.handle('security:extend-license', async () => {
    return { success: true };
  });



  // ---- auth token ---------------------------------------------------------
  ipcMain.handle('auth:save-token', async (_, token) => {
    if (!safeStorage.isEncryptionAvailable()) return false;
    try {
      const enc = safeStorage.encryptString(token);
      fs.writeFileSync(TOKEN_PATH, enc);
      return true;
    } catch (_) {
      return false;
    }
  });

  ipcMain.handle('auth:get-token', async () => {
    if (!fs.existsSync(TOKEN_PATH) || !safeStorage.isEncryptionAvailable())
      return null;
    try {
      return safeStorage.decryptString(fs.readFileSync(TOKEN_PATH));
    } catch (_) {
      fs.unlinkSync(TOKEN_PATH);
      return null;
    }
  });

  ipcMain.handle('auth:delete-token', async () => {
    try {
      if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
      return true;
    } catch (_) {
      return false;
    }
  });



  // ---- printing -----------------------------------------------------------
  ipcMain.handle('print:get-printers', async () => {
    return mainWindow?.webContents.getPrintersAsync();
  });

  ipcMain.handle('print:job', async (_, args) => {
    const isObject = typeof args === 'object' && args !== null;
    const content = isObject ? args.content : args;
    const printerName = isObject ? (args.printerName || '') : '';
    const silentPrint = isObject ? (String(args.silent) !== 'false') : true;

    if (!printWorker) createPrintWorker();

    // Sanitize HTML: strip <script> tags and inline event handlers to prevent XSS
    const sanitizedHtml = content.includes('<!DOCTYPE html>')
      ? content
      : `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${content}</body></html>`;
    const safeHtml = sanitizeHtml(sanitizedHtml);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Print worker did not respond in time'));
      }, 10000);

      const onRenderResult = (_event, result) => {
        clearTimeout(timeoutId);
        printWorker.webContents.removeListener('ipc-message', onRenderResult);
        if (result.success) {
          resolve({ success: true });
        } else {
          reject(new Error(result.error || 'Print failed'));
        }
      };

      printWorker.webContents.once('did-finish-load', () => {
        // Send the sanitized HTML to the print page via the preload bridge
        printWorker.webContents.send('print:render-html', safeHtml, {
          silent: silentPrint,
          deviceName: printerName.trim() !== '' ? printerName : undefined,
          color: false,
          printBackground: true,
          margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
        });
      });

      printWorker.webContents.on('ipc-message', onRenderResult);

      // Load a blank local page (not a data: URL with renderer-controlled HTML)
      printWorker.loadFile(path.join(__dirname, 'printBlank.html'));
    });
  });

  // ---- system get‑machine‑id ---------------------------------------------
  ipcMain.handle('system:get-machine-id', () => {
    const interfaces = os.networkInterfaces();
    let mac = '';
    for (const key in interfaces) {
      const iface = interfaces[key].find((d) => !d.internal && d.mac !== '00:00:00:00:00:00');
      if (iface) {
        mac = iface.mac;
        break;
      }
    }
    if (!mac) mac = os.hostname();
    return crypto.createHash('sha256').update(mac).digest('hex');
  });

  // ---- system get-local-ip (used by the dashboard) -----------------------
  ipcMain.handle('system:get-local-ip', () => {
    const interfaces = os.networkInterfaces();
    for (const key in interfaces) {
      for (const iface of interfaces[key]) {
        if (!iface.internal && iface.family === 'IPv4') return iface.address;
      }
    }
    return '127.0.0.1';
  });

  // ---- file save (CSV / report exports) ----------------------------------
  ipcMain.handle('system:save-file', async (_, { buffer, fileName }) => {
    try {
      const { dialog } = require('electron');
      const savePath = await dialog.showSaveDialog(mainWindow, {
        title: 'Save File',
        defaultPath: fileName || 'export.csv',
      });
      if (savePath.canceled || !savePath.filePath) return { success: false, canceled: true };
      fs.writeFileSync(savePath.filePath, Buffer.from(buffer));
      return { success: true, path: savePath.filePath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ------------------------------------------------------------------
  //  Print security helpers
  // ------------------------------------------------------------------

  // Strip <script> tags and inline event handlers to prevent XSS in the print worker
  function sanitizeHtml(html) {
    if (typeof html !== 'string') return '';
    return html
      // Remove <script>...</script> blocks
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      // Remove inline event handlers (onclick, onerror, onload, etc.)
      .replace(/\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|\S+)/gi, '')
      // Remove javascript: URLs
      .replace(/javascript\s*:/gi, '')
      // Remove <style> blocks containing expression() (IE legacy XSS vector)
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  }

  // Render sanitized HTML in the isolated print worker and report back the result
  ipcMain.handle('print:render', async (_, html, options) => {
    if (!printWorker || printWorker.isDestroyed()) {
      return { success: false, error: 'Print worker not available' };
    }
    try {
      await printWorker.webContents.print({
        silent: options.silent !== undefined ? options.silent : true,
        deviceName: options.deviceName || undefined,
        color: options.color !== undefined ? options.color : false,
        printBackground: options.printBackground !== undefined ? options.printBackground : true,
        margins: options.margins || { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
      });
      return { success: true };
    } catch (e) {
      console.error('Electron Print failed:', e);
      return { success: false, error: e.message };
    }
  });

  // ---- raw printer byte-stream (ESC/POS / TSC) ---------------------------
  ipcMain.handle('print:raw', async (_, { data, printerName }) => {
    // 🚀 THE FIX: Thermal printers (TSC/Zebra/ESC-POS) speak a byte protocol,
    // not HTML. Electron's print() cannot emit raw bytes, so we drive the
    // physical interface directly: USB-serial for com ports, TCP for network
    // printers, and fall back to the HTML print worker otherwise.
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'latin1');

    // 1. Network printer (IP:port or hostname)
    const ipMatch = String(printerName || '').match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
    if (ipMatch) {
      const net = require('net');
      return new Promise((resolve) => {
        const socket = net.connect(Number(ipMatch[2]), ipMatch[1], () => {
          socket.write(bytes, () => socket.end());
          resolve({ success: true });
        });
        socket.on('error', (e) => resolve({ success: false, error: e.message }));
        setTimeout(() => resolve({ success: false, error: 'raw print timed out' }), 8000);
      });
    }

    // 2. USB / serial printer
    const lowerName = String(printerName || '').toLowerCase();
    const isSerial = /com\d+|tty\.usb|usbmodem|serial|serialport/i.test(lowerName);
    if (isSerial) {
      try {
        const SerialPort = require('serialport');
        const port = new SerialPort({ path: printerName, baudRate: 9600, autoOpen: false });
        return new Promise((resolve) => {
          port.open((err) => {
            if (err) return resolve({ success: false, error: err.message });
            port.write(bytes, (werr) => {
              port.close(() => { });
              resolve(werr ? { success: false, error: werr.message } : { success: true });
            });
          });
          port.on('error', (e) => resolve({ success: false, error: e.message }));
        });
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    // 3. Fallback: render the raw payload as a monospace document and print it
    if (!printWorker) createPrintWorker();
    const safeHtml = sanitizeHtml(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:monospace;font-size:8px;margin:0;padding:0;white-space:pre;">${escapeHtmlForPrint(String(data))}</body></html>`);
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Print worker did not respond in time'));
      }, 10000);

      printWorker.webContents.once('did-finish-load', () => {
        printWorker.webContents.send('print:render-html', safeHtml, {
          silent: true,
          deviceName: printerName && printerName.trim() !== '' ? printerName : undefined,
          color: false,
          printBackground: true,
          margins: { marginType: 'none' },
        });
      });

      printWorker.webContents.once('ipc-message', (_event, result) => {
        clearTimeout(timeoutId);
        if (result.success) {
          resolve({ success: true });
        } else {
          reject(new Error(result.error || 'Raw print failed'));
        }
      });

      printWorker.loadFile(path.join(__dirname, 'printBlank.html'));
    });
  });

  // ---- logging ------------------------------------------------------------
  ipcMain.handle('log:write', async (_, { filename, content }) => {
    const logPath = path.join(app.getPath('userData'), 'logs', filename);
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logPath, content + '\n');
  });

  // ---- auto-updater controls ---------------------------------------------
  ipcMain.on('check-for-updates', async (event) => {
    try {
      if (!app.isPackaged) {
        setTimeout(() => event.sender.send('updater-event', 'update-not-available', {}), 1000);
        return;
      }
      await autoUpdater.checkForUpdates();
    } catch (e) {
      event.sender.send('updater-event', 'error', e.message);
    }
  });

  ipcMain.on('start-update-download', () => {
    autoUpdater.downloadUpdate();
  });

  ipcMain.on('install-update-now', async () => {
    isQuitting = true;
    if (global.scannerWatcher) { try { await global.scannerWatcher.close(); } catch (e) { } }
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 500);
  });

  ipcMain.on('restart-to-update', () => {
    isQuitting = true;
    autoUpdater.quitAndInstall(true, true);
  });

  // (add any other handlers you need here – keep them inside this function)
  handlersRegistered = true;   // ← mark as registered
}

// ---------------------------------------------------------------
//  Window creation
// ---------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    icon: path.join(__dirname, 'public/mifela_inve.ico'),
    show: false,
    backgroundColor: '#f9fafb',
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      partition: 'persist:mifela_v2',
      enableRemoteModule: false,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (!isQuitting) app.quit();
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
    mainWindow.webContents.setZoomFactor(1);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (app.isPackaged) {
      setupAutoUpdater(mainWindow);
    }
    setupScannerIPC(mainWindow);
  });
}

// ---------------------------------------------------------------
//  Print worker (headless window for silent printing)
// ---------------------------------------------------------------
function createPrintWorker() {
  printWorker = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'printPreload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  printWorker.on('closed', () => {
    printWorker = null;
    if (!isQuitting) createPrintWorker();
  });
}

// ---------------------------------------------------------------
//  Auto‑updater setup
// ---------------------------------------------------------------
function setupAutoUpdater(win) {
  autoUpdater.logger = electronLog;
  autoUpdater.logger.transports.file.level = 'info';

  const safeSend = (channel, eventName, data) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, eventName, data);
  };

  autoUpdater.on('checking-for-update', () =>
    safeSend('updater-event', 'checking-for-update', null)
  );
  autoUpdater.on('update-available', (info) =>
    safeSend('updater-event', 'update-available', info)
  );
  autoUpdater.on('update-not-available', (info) =>
    safeSend('updater-event', 'update-not-available', info)
  );
  autoUpdater.on('download-progress', (progress) =>
    safeSend('updater-event', 'download-progress', progress)
  );
  autoUpdater.on('update-downloaded', (info) => {
    if (app.getVersion() === info.version) return;
    safeSend('updater-event', 'update-downloaded', info);
  });
  autoUpdater.on('error', (err) => {
    electronLog.info('AutoUpdater offline or error:', err.message);
    safeSend('updater-event', 'error', 'We couldn\'t download the update right now. Please check your internet connection.');
  });
}

// ---------------------------------------------------------------
//  Scanner hot‑folder (dev only)
// ---------------------------------------------------------------
function setupScannerIPC(win) {
  const chokidar = require('chokidar');
  const scanDir = path.join(app.getPath('documents'), 'MifelaScans');

  if (!fs.existsSync(scanDir)) fs.mkdirSync(scanDir, { recursive: true });

  global.scannerWatcher = chokidar.watch(scanDir, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
  });

  global.scannerWatcher.on('error', (err) => console.error(`Watcher error: ${err}`));

  global.scannerWatcher.on('add', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.pdf'].includes(ext)) {
      try {
        const base64Data = fs.readFileSync(filePath, { encoding: 'base64' });
        win.webContents.send('scanner:new-file', {
          path: filePath,
          base64: base64Data,
          fileName: path.basename(filePath),
        });
      } catch (e) {
        console.error('Failed to read scanned file:', e);
      }
    }
  });
}
const monitor = new ConnectivityMonitor();
monitor.start();
monitor.on('online', () => {
  // Trigger background background sync logic here
  console.log('Network connected: Triggering silent licence verification...');
});

// IPC Handlers for UI
ipcMain.handle('auth:login', async (event, username, password) => {
  return await LocalAuthService.login(username, password);
});

ipcMain.handle('licence:getState', async () => {
  return await LicenceStateManager.evaluateCurrentState();
});