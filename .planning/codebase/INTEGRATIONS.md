# External Integrations

**Analysis Date:** 2026-11-18
**Focus:** tech

## APIs & External Services

**Generative AI:**
- Google Gemini API (`@google/generative-ai`) — AI receipt/data extraction used by the scanner bridge.

**Payments:**
- Razorpay (`razorpay`) — Payment processing. Redirects handled via custom `mifela://payment-verified` protocol (`electron/main.js` `open-url` handler).

**Cloud / Auth:**
- Firebase Auth (`firebase/auth`) — Remote user authentication.
- Firebase Firestore (`firebase/firestore`) — Cloud document store for offline-first sync.
- Firebase project: `mifela-pos-sqlite` (config hardcoded in `src/app.js`).

**Monitoring / Error Tracking:**
- Sentry (`browser.sentry-cdn.com`, `o515678.ingest.sentry.io`) — Error tracking (referenced in CSP; not yet wired in source).
- `electron-log` — Local file logging.

## Data Storage

**Databases:**
- SQLite via `better-sqlite3-multiple-ciphers` (local encrypted database) at `<userData>/mifela_pos_v1.db`.
- Firebase Firestore (remote sync).
- Query builder: Knex.js (`knex`) over SQLite.

**File Storage:**
- Local filesystem only (exports, logs, scanned files in `~/Documents/MifelaScans`).

**Caching:** None.

## Authentication & Identity

**Auth Provider:** Firebase Auth.
**License model:** Local RSA/AES "security enclave" (`electron/security/licenseVerifier.js`) with hardware fingerprint binding and 30-day verification windows, stored in `security_config` table.

## Monitoring & Observability

**Error Tracking:** Sentry (CSP only; instrumentation not confirmed in source).
**Logs:** `electron-log` (main process), `db:logTelemetry` IPC handler, `log:write` file logger.

## CI/CD & Deployment

**Hosting:** Desktop bundle distribution via `electron-builder`.
**Publish:** Generic provider.
**CI Pipeline:** GitHub Actions workflows (`.github/workflows/`).
**Targets:** Windows (NSIS x64), macOS (DMG + zip). Asar enabled; `electron-dist` obfuscated backend.

## Environment Configuration

**Required env vars:** Standard runtime configs.
**Secrets location:** Stored locally / environment variables (`.env` deleted in commit `c49c4e3`; secrets scrubbed in `3a46b9d`).

**Hardcoded in source:** Firebase config (API key etc.) in `src/app.js`.

## Webhooks & Callbacks

**Incoming:** None.
**Outgoing:** None (Razorpay uses redirect deep-links rather than webhooks).

## CSP (index.html)

Restrictive Content Security Policy allowing scripts/styles from `self`, `cdn.jsdelivr.net`, `unpkg.com`, Google APIs, Razorpay, Sentry, and Sardine; connects to Googleapis/Cloudfunctions, localhost:5173 (Vite HMR), ipify/ipapi.co, Groq API, Razorpay, Sentry, Sardine.

---

*Integration audit: 2026-11-18*
