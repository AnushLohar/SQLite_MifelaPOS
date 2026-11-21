# Architecture

**Analysis Date:** 2026-11-21

## Overview

Mifela POS is an Electron desktop application structured as a hybrid: a secure Electron main process (Node.js) handling native OS/hardware features, local encrypted data, and offline-first licensing, coupled with a Vite-built, vanilla-JavaScript single-page application (SPA) for the point-of-sale and inventory interface. The frontend communicates with the main process through a `contextBridge`-scoped IPC preload script.

## Architectural Layers

### 1. Presentation Layer (Renderer Process)

- **Path:** `src/`, `index.html`
- **Tech:** Vanilla JavaScript (ESM), Tailwind CSS, HTML
- **Responsibility:** UI rendering, client-side validation, navigation state, POS billing screen, inventory view, customer/supplier records, dashboard charts, printing triggers.
- **Not React:** plain DOM-manipulating JavaScript.
- **Key files:** `src/app.js` (application root/entry), `src/components/*.js` (feature modules), `src/store/state.js` (global state + event bus), `src/store/listeners.js` (realtime sync listeners), `src/utils/*` (helpers), `src/services/*` (auth/network/usage), `src/printing/*` (print engine/adapters).

### 2. Bridge / IPC Layer

- **Path:** `electron/preload.js`, `electron/printPreload.js`
- **Responsibility:** Exposes scoped APIs to the renderer via `contextBridge.exposeInMainWorld`: `window.dbAPI` (database), `window.electronAPI` (system/security/printing/updater/auth), `window.printAPI`, `window.scannerAPI`. Context isolation is enabled; `nodeIntegration: false`. The print worker window uses a separate isolated preload (`printPreload.js`) exposing only `printBridge`.

### 3. Native & Backend Layer (Main Process)

- **Path:** `electron/`
- **Tech:** Node.js, SQLite (Knex.js + sqlite3), SerialPort/usb
- **Responsibility:** File system access, local encrypted database queries, thermal/ESC-POS printing (direct USB-serial/TCP bytes plus HTML print worker), auto-updates, license verification, hardware fingerprinting, app integrity check, scanner hot-folder.
- **Key files:** `electron/main.js` (app lifecycle + IPC handlers), `electron/database/knex.js` (Knex connection + schema init), `electron/database/controllers.js` (DB IPC handlers), `electron/database/schema.js` (schema migrations), `electron/security/licenseVerifier.js` (Ed25519 signature verification), `electron/security/fingerprint.js` (machine fingerprint), `electron/security/integrity.js` (app integrity verification at startup), `electron/telemetry/logger.js` (logging), `electron/UniversalPrintEngine.js`, `electron/printPreload.js` (print worker bridge), `electron/printBlank.html` (print worker blank page).

### 4. Services Layer (Main Process)

- **Path:** `electron/services/`
- **Tech:** Node.js, Knex, bcryptjs
- **Responsibility:** Offline-first licensing and local auth.
- **Key files:**
  - `LicenceStateManager.js` — `evaluateCurrentState()`: checks `licence_data` record, verifies Ed25519 signature, binds hardwareId to machine fingerprint, checks revocation/expiry/90-day offline verification deadline. Returns `ACTIVE`/`UNACTIVATED`/`INVALID`/`HARDWARE_MISMATCH`/`REVOKED`/`EXPIRED`/`VERIFICATION_PENDING`/`VERIFICATION_DUE`.
  - `LocalAuthService.js` — `login(username, password)`: bcrypt verify against `local_users`, returns session token + user.
  - `ConnectivityMonitor.js` — polls DNS (`1.1.1.1`) every 30s, emits `online`/`offline`.
  - `BackgroundVerificationScheduler.js` — on connectivity restore, calls Firebase Callable `verifyNodeLicense` via REST, overwrites `licence_data` with signed payload, emits `security:license-restored` / `security:license-revoked`.

### 5. Data Access Layer

- SQLite database file stored at `<userData>/mifela_pos_v1.db`.
- Single driver: Knex.js over `sqlite3` (async). Tables: `products`, `customers`, `transactions`, `security_config`, `store_settings`, `local_users`, `licence_data`. Much of the row payload is stored as JSON in a `data` TEXT column, queried with `json_extract`/`json_set` via Knex.
- Schema bootstrapped by `initKnex()` → `initSchema()` (`CREATE TABLE IF NOT EXISTS` for all tables) on `app.whenReady()`.
- **Removed:** `better-sqlite3`/`connection.js` (dual-driver path). `security_config` table still created by schema but no longer used by license verification (superseded by `licence_data`).

### 6. Cloud Sync & Auth Layer

- **Path:** `functions/`, `src/services/auth.js`, `src/services/network.js`, `src/services/usage.js`
- **Tech:** Firebase Auth, Firestore, Cloud Functions
- **Responsibility:** Remote user authentication, license validation, offline-first data synchronization.
- Firebase config is hardcoded in `src/app.js` (project `mifela-pos-sqlite`).
- Cloud Functions (`functions/index.js`): `requestChallenge`, `verifyChallenge`, `redeemTerminalToken`; plus Firebase Callable `verifyNodeLicense` (used by `BackgroundVerificationScheduler` and `security:provision`).

### 7. Payments

- Razorpay integration via `mifela://payment-verified` deep-link protocol handled in `electron/main.js` (`app.on('open-url'`).

### 8. App Integrity

- `electron/security/integrity.js` — `verifyAppIntegrity()`: at startup, hashes critical files (`main.js`, `preload.js`, `database/controllers.js`, `database/knex.js`, `security/licenseVerifier.js`, `security/fingerprint.js`, `services/LicenceStateManager.js`, `services/BackgroundVerificationScheduler.js`) and compares against a build-time manifest (`dist/integrity-manifest.json`). Refuses to start on mismatch. Skipped in dev (no manifest).

---

*Architecture analysis: 2026-11-21*
