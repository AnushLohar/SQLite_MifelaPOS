# Mifela POS — Security Architecture

**Analysis Date:** 2026-11-18  
**Focus Area:** arch

---

## 1. Overview

Mifela POS is a desktop application that enforces **terminal-level licensing** through hardware-bound asymmetric cryptography. The security model centers on binding a license to a specific physical machine via a hardware fingerprint, storing an RSA key pair encrypted under a key derived from that fingerprint, and verifying possession of the private key through a challenge/response protocol with a cloud service.

All security-sensitive code runs in the **Electron main process** (Node.js), isolated from the renderer via `contextIsolation`, `sandbox`, and `contextBridge`.

---

## 2. Security Layers

| Layer | Mechanism | Files |
|-------|-----------|-------|
| Process isolation | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` | `electron/main.js` (createWindow) |
| API surface | `contextBridge.exposeInMainWorld` — narrow, scoped APIs only | `electron/preload.js` |
| Token storage | Electron `safeStorage.encryptString` at `userData/auth_token.enc` | `electron/main.js` (auth handlers) |
| License keys | RSA-2048 key pair; private key AES-256-GCM encrypted with hardware-fingerprint-derived key | `electron/security/licenseVerifier.js` |
| Hardware identity | SHA-256 of motherboard UUID / IOPlatformUUID / machine-id / MAC fallback | `electron/security/fingerprint.js` |
| License verification | Challenge/response: cloud issues challenge, device signs with private key, cloud verifies | `src/services/auth.js` + Cloud Functions |
| IPC exposure | Only `invoke` (promise, serializable) and `send` (one-way) channels, no arbitrary code execution | `electron/preload.js`, `electron/main.js` |
| Obfuscation | Frontend: `vite-plugin-javascript-obfuscator`; Backend: `javascript-obfuscator` | `vite.config.js`, `package.json` |

---

## 3. Hardware Fingerprinting

`electron/security/fingerprint.js` — `getHardwareFingerprint()`:

- **Windows:** `wmic csproduct get uuid` + `wmic cpu get processorid` + `wmic diskdrive get serialnumber`
- **macOS:** `ioreg -d2 -c IOPlatformExpertDevice` → `IOPlatformUUID`
- **Linux:** `/etc/machine-id` or `/var/lib/dbus/machine-id`
- **Fallback:** first non-internal MAC address; then `hostname + totalmem + CPU model`

Output: SHA-256 hex digest, uppercased.

Used to derive the AES key that encrypts the RSA private key, and to bind the offline license token to the terminal.

---

## 4. License Key Management

`electron/security/licenseVerifier.js` — `LicenseManager` class:

### 4.1 Provisioning (`generateAndStoreKeys`)
1. Compute hardware fingerprint.
2. Generate RSA-2048 key pair (SPKI public / PKCS8 private PEM).
3. Derive AES-256-GCM key from `fingerprint.substring(0, 64)` (hex-decoded to 32 bytes).
4. Generate random 12-byte IV; encrypt private key PEM with AES-256-GCM.
5. Store in `security_config` table: `iv`, `data` (ciphertext base64), `tag` (auth tag base64), plus `publicKey`, `email`, `storeName`, `nextVerificationDate` (= now + 30 days).
6. Returns `{ publicKey, email, storeName, fingerprint }`.

### 4.2 State check (`verifyLocalState`)
- Reads `security_config` where `id = 'SYSTEM_LICENSE'`.
- No record → `UNPROVISIONED`.
- `now > nextVerificationDate` → `VERIFICATION_REQUIRED`.
- Otherwise → `ACTIVE`.
- DB error → `DATABASE_ERROR`.

### 4.3 Challenge signing (`executeChallenge`)
1. Look up `encryptedPrivateKey` from `security_config`.
2. Derive AES key from the **passed** hardware fingerprint (first 64 hex chars).
3. Decrypt private key with AES-256-GCM (IV + auth tag from stored record).
4. If decryption fails → throw "Local hardware signature failed. Possible clone."
5. Sign `challengeHex` with SHA256/RSA using the private key → return base64 signature.

### 4.4 License extension (`updateVerificationDate`)
- Sets `nextVerificationDate = now + 30 days`.

---

## 5. Offline License Token

`src/services/auth.js` — `verifyLocalLicense()`:

- Reads encrypted token from `electronAPI.getToken()` (`userData/auth_token.enc`).
- Validates JWT-like format (3 base64 parts).
- Checks `payload.expiresAt` (time-based expiration).
- Checks `payload.fingerprint` === `electronAPI.getMachineId()` (hardware binding).
- Checks `payload.email` against local `mifela_sys_details` (identity binding).
- On any failure: deletes token, returns `{ valid: false, reason }`.
- On success: builds local user object (role forced to `'admin'`), stores in `mifela_local_user`.

`activateSoftware(token)`:
- If token is a short raw code (< 50 chars, no dots), redeems via Cloud Function `redeemTerminalToken` (sends token + hardwareId + email), receives `licenseKey` JWT.
- Saves token via `electronAPI.saveToken` (encrypted at rest).
- Re-verifies locally.

---

## 6. Challenge/Response Verification (online)

`src/services/auth.js` — `executeSilentVerification()`:

1. `POST { email }` → Cloud Function `requestChallenge` → receives `challengeHex`.
2. `window.electronAPI.signChallenge(challengeHex)` → IPC `security:sign-challenge` → `LicenseManager.executeChallenge` → base64 signature.
3. `POST { email, signature, challenge }` → Cloud Function `verifyChallenge`.
4. If OK → `window.electronAPI.extendLicense()` (+30 days).

Cloud Functions (`functions/index.js`): `requestChallenge`, `verifyChallenge`, `redeemTerminalToken`.

---

## 7. Renderer Security Posture

The renderer (Vite SPA) has **no direct Node.js access**. It can only call the exposed APIs:

- `window.dbAPI`, `window.electronAPI`, `window.printAPI`, `window.scannerAPI`
- Each maps to a single IPC `invoke`/`send` with typed arguments.

`contextIsolation: true` prevents prototype-pollution attacks on `window` from leaking into the main process. `sandbox: true` further restricts renderer capabilities.

---

## 8. Known Security Concerns

| Concern | Detail |
|---------|--------|
| **Obfuscation ≠ security** | Frontend/backend source is obfuscated at build time, but all licensing and business logic runs on the client device under user control. Obfuscation raises reverse-engineering cost only. |
| **Hardcoded Firebase config** | API key and project IDs embedded in `src/app.js` (visible to anyone who can read the app bundle). |
| **No database encryption at rest** | SQLite file in `userData` is plain; customer/transaction data readable from disk. `better-sqlite3-multiple-ciphers` is a dependency but not used by the knex path. |
| **Role/location bypasses** | `src/store/state.js` forces `role='admin'`, `location='main'` globally; `hasPermission()` always returns `true`. Authorization is effectively disabled. |
| **License token replay** | Offline token is self-contained (expiry + fingerprint); no server-side revocation check when offline. A copied token works on the same machine until expiry. |
| **Private key bound to fingerprint only** | If hardware changes (e.g., NIC replacement), fingerprint-derived AES key fails to decrypt the private key ("Possible clone" error) — legitimate hardware changes can break licensing. |

---

## 9. Security Controls Summary

| Control | Status | Notes |
|---------|--------|-------|
| Context isolation | Enabled | `contextIsolation: true`, `nodeIntegration: false` |
| Sandbox | Enabled | `sandbox: true` in main window |
| Narrow IPC surface | Yes | Preload exposes fixed API objects only |
| Token encryption at rest | Yes | `safeStorage.encryptString` |
| Private key encryption | Yes | AES-256-GCM, fingerprint-derived key |
| Hardware binding | Yes | Fingerprint in token + key derivation |
| Online challenge/response | Yes | Via Cloud Functions (when online) |
| Database encryption | No | Plain SQLite file |
| RBAC / authorization | No | Role forced to admin; permissions always true |
| Automated security testing | No | No test suite |

---

*Security analysis: 2026-11-18 — focus: arch*
