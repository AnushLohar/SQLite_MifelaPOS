# Architecture

**Analysis Date:** 2026-11-18
**Focus:** tech

## Overview

Mifela POS is an Electron desktop application structured as a hybrid: a secure Electron main process (Node.js) handling native OS/hardware features and local data, coupled with a Vite-built, vanilla-JavaScript single-page application (SPA) for the point-of-sale and inventory interface. The frontend communicates with the main process through a `contextBridge`-scoped IPC preload script.

## Architectural Layers

### 1. Presentation Layer (Renderer Process)
- **Path:** `src/`, `index.html`
- **Tech:** Vanilla JavaScript (ESM), Tailwind CSS, HTML
- **Responsibility:** UI rendering, client-side validation, navigation state, POS billing screen, inventory view, customer/supplier records, dashboard charts, printing triggers.
- **Not React:** despite earlier documentation, the frontend is plain DOM-manipulating JavaScript, not React.
- **Key files:** `src/app.js` (application root/entry), `src/components/*.js` (feature modules), `src/store/state.js` (global state + event bus), `src/store/listeners.js` (realtime sync listeners), `src/utils/*` (helpers), `src/services/*` (auth/network/usage), `src/printing/*` (print engine/adapters).

### 2. Bridge / IPC Layer
- **Path:** `electron/preload.js`
- **Responsibility:** Exposes scoped APIs to the renderer via `contextBridge.exposeInMainWorld`: `window.dbAPI` (database), `window.electronAPI` (system/security/printing/updater), `window.printAPI`, `window.scannerAPI`. Context isolation is enabled; `nodeIntegration: false`.

### 3. Native & Backend Layer (Main Process)
- **Path:** `electron/`
- **Tech:** Node.js, SQLite (Knex.js + better-sqlite3-multiple-ciphers), SerialPort/usb
- **Responsibility:** File system access, local encrypted database queries, thermal/ESC-POS printing (direct USB-serial/TCP bytes plus HTML print worker), auto-updates, license verification, hardware fingerprinting, scanner hot-folder.
- **Key files:** `electron/main.js` (app lifecycle + IPC handlers), `electron/database/knex.js` (Knex connection), `electron/database/controllers.js` (DB IPC handlers), `electron/database/connection.js` (schema bootstrap), `electron/security/licenseVerifier.js` (RSA/AES license enclave), `electron/security/fingerprint.js` (machine fingerprint), `electron/telemetry/logger.js` (logging), `electron/UniversalPrintEngine.js` (print engine).

### 4. Data Access Layer
- SQLite database file stored at `<userData>/mifela_pos_v1.db`.
- Tables: `products`, `customers`, `transactions`, `security_config`. Much of the row payload is stored as JSON in a `data` TEXT column, queried with `json_extract`/`json_set` via Knex.
- Schema bootstrapped by `connection.js` (`better-sqlite3`); queries executed by `controllers.js` via Knex (`knex.js`).

### 5. Cloud Sync & Auth Layer
- **Path:** `functions/`, `src/services/auth.js`, `src/services/network.js`, `src/services/usage.js`
- **Tech:** Firebase Auth, Firestore, Cloud Functions
- **Responsibility:** Remote user authentication, license validation, offline-first data synchronization.
- Firebase config is hardcoded in `src/app.js` (project `mifela-pos-sqlite`).

### 6. Payments
- Razorpay integration via `mifela://payment-verified` deep-link protocol handled in `electron/main.js` (`app.on('open-url'`).

---

*Architecture analysis: 2026-11-18*
