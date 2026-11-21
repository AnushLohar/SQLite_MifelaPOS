# Mifela POS — Security Architecture

**Analysis Date:** 2026-11-21  
**Focus Area:** arch

---

## 1. Overview

Mifela POS is a desktop application that enforces **terminal-level licensing** through offline-first asymmetric cryptography (Ed25519). The security model centers on binding a licence to a specific physical machine via a hardware fingerprint, storing a signed licence payload in SQLite, and verifying possession/validity through `LicenceStateManager`. All security-sensitive code runs in the **Electron main process** (Node.js), isolated from the renderer via `contextIsolation`, `sandbox`, and `contextBridge`.

---

## 2. Security Layers

| Layer | Mechanism | Files |
|-------|-----------|-------|
| Process isolation | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` | `electron/main.js` (createWindow, createPrintWorker) |
| Print worker isolation | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, loads `printBlank.html` (not `data:` URL), bridge via `printPreload.js` | `electron/main.js`, `electron/printPreload.js`, `electron/printBlank.html` |
| API surface | `contextBridge.exposeInMainWorld` — scoped APIs only | `electron/preload.js` |
| Token storage | Electron `safeStorage.encryptString` at `userData/auth_token.enc` | `electron/main.js` (auth handlers) |
| Licence storage | Ed25519-signed payload in `licence_data` SQLite table | `electron/services/LicenceStateManager.js`, `electron/database/schema.js` |
| Hardware identity | SHA-256 of motherboard UUID / IOPlatformUUID / machine-id / MAC fallback | `electron/security/fingerprint.js` |
| Signature verification | Ed25519 `crypto.verify` over licence payload | `electron/security/licenseVerifier.js` |
| IPC exposure | Only `invoke` (promise, serializable) and `send` (one-way) channels, no arbitrary code execution | `electron/preload.js`, `electron/main.js` |
| App integrity | Startup hash check of critical files vs build-time manifest; refuses to start if tampered | `electron/security/integrity.js` |
| Obfuscation | Frontend: `vite-plugin-javascript-obfuscator`; Backend: `javascript-obfuscator` | `vite.config.js`, `package.json` |

---

## 3. Hardware Fingerprinting

`electron/security/fingerprint.js` — `getHardwareFingerprint()`:

- **Windows:** `wmic csproduct get uuid` + `wmic cpu get processorid` + `wmic diskdrive get serialnumber`
- **macOS:** `ioreg -d2 -c IOPlatformExpertDevice` → `IOPlatformUUID`
- **Linux:** `/etc/machine-id` or `/var/lib/dbus/machine-id`
- **Fallback:** first non-internal MAC address; then `hostname + totalmem + CPU model`

Output: SHA-256 hex digest, uppercased.

Used to bind the licence payload to the terminal (`payload.hardwareId` must match current machine fingerprint).

---

## 4. Licence Verification

`electron/security/licenseVerifier.js` — `LicenseManager`:

- `verifySignature(payload, signatureBase64)` — Ed25519 `crypto.verify(null, payloadBuffer, PUBLIC_KEY, signatureBuffer)`. Returns boolean. Public key is the server-side verification key (shippable in client).

`electron/services/LicenceStateManager.js` — `LicenceStateManager.evaluateCurrentState()`:

1. Reads `licence_data` first row. No record → `UNACTIVATED`.
2. Parses `licence_payload`; verifies Ed25519 signature. Invalid → `INVALID`.
3. Anti-tamper: `payload.hardwareId` must equal `getHardwareFingerprint()`. Mismatch → `HARDWARE_MISMATCH`.
4. If `payload.status === 'REVOKED'` → `REVOKED`.
5. If `payload.subscriptionExpiryDate` passed → `EXPIRED`.
6. 90-day offline verification deadline: if `now > nextVerificationDue` → `VERIFICATION_PENDING`; if within 7 days → `VERIFICATION_DUE`.
7. Otherwise → `ACTIVE`.

Returned statuses: `ACTIVE`, `UNACTIVATED`, `INVALID`, `HARDWARE_MISMATCH`, `REVOKED`, `EXPIRED`, `VERIFICATION_PENDING`, `VERIFICATION_DUE`.

### 4.1 Provisioning (`security:provision`)

Called by renderer after payment verified. Fetches signed licence payload from Firebase Callable `verifyNodeLicense` (POST `{ data: { fingerprint } }`), then writes to `licence_data` (`licence_payload`, `signature`, `next_verification_due`, `status: 'ACTIVE'`).

### 4.2 Background re-verification (`BackgroundVerificationScheduler`)

On connectivity restore (`ConnectivityMonitor`), calls `verifyNodeLicense` via REST, overwrites `licence_data` with the new signed payload, and sends `security:license-restored` or `security:license-revoked` to the renderer UI.

---

## 5. Offline Local Auth

`electron/services/LocalAuthService.js` — `LocalAuthService.login(username, password)`:

- Looks up user in `local_users` (`username`, `is_active: true`).
- `bcrypt.compare(password, user.password_hash)`.
- On success returns `{ token: randomBytes(32).hex, user: { id, username, role } }`.
- IPC channel `auth:login` in `electron/main.js`.

---

## 6. Renderer Security Posture

The renderer (Vite SPA) has **no direct Node.js access**. It can only call the exposed APIs:

- `window.dbAPI`, `window.electronAPI`, `window.printAPI`, `window.scannerAPI`
- Each maps to a single IPC `invoke`/`send` with typed arguments.

DB write handlers are guarded by `authorize()` (licence must be `ACTIVE`). Read handlers are not authorized.

`contextIsolation: true` prevents prototype-pollution attacks on `window` from leaking into the main process. `sandbox: true` further restricts renderer capabilities.

---

## 7. Known Security Concerns

| Concern | Detail |
|---------|--------|
| **Obfuscation ≠ security** | Frontend/backend source is obfuscated at build time, but all licensing and business logic runs on the client device under user control. Obfuscation raises reverse-engineering cost only. |
| **Hardcoded Firebase config** | API key and project IDs embedded in `src/app.js` (visible to anyone who can read the app bundle). (CONCERNS H1) |
| **No database encryption at rest** | SQLite file in `userData` is plain; customer/transaction data readable from disk. |
| **`db:executeBatch` broad write surface** | Any renderer code can write to whitelisted tables (`products`, `customers`, `transactions`, `licence_data`, etc.) unsanitized. (CONCERNS H2) |
| **Read errors masked** | Read handlers return `[]`/`null`, hiding failures. (CONCERNS M3) |
| **Role/location bypasses** | `src/store/state.js` defaults role to `staff` from localStorage; `hasPermission()` is a real matrix now (not hard-coded true), but role is sourced from localStorage which is client-controlled. |
| **Licence token replay** | Offline token is self-contained (expiry + fingerprint); no server-side revocation check when offline. A copied payload works on the same machine until expiry. |
| **Private key / signature key** | Ed25519 public key shipped in client; private key remains server-side. |

---

## 8. Security Controls Summary

| Control | Status | Notes |
|---------|--------|-------|
| Context isolation | Enabled | `contextIsolation: true`, `nodeIntegration: false` |
| Sandbox | Enabled | `sandbox: true` in main window + print worker |
| Narrow IPC surface | Partially | Preload exposes fixed API objects; `executeBatch` still broad |
| Token encryption at rest | Yes | `safeStorage.encryptString` |
| Licence signature verification | Yes | Ed25519, server public key |
| Hardware binding | Yes | Fingerprint in payload + `LicenceStateManager` check |
| Online challenge/response / re-verification | Yes | Via Firebase Callable `verifyNodeLicense` |
| App integrity check | Yes | `integrity.js` startup hash vs manifest |
| Database encryption | No | Plain SQLite file |
| RBAC / authorization | Partial | `authorize()` guards DB writes on `ACTIVE` licence; role from localStorage |
| Automated security testing | No | Partial (vitest exists but no security tests) |

---

*Security analysis: 2026-11-21 — focus: arch*
