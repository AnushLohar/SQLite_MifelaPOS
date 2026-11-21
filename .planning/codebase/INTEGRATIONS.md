# External Integrations

**Analysis Date:** 2026-11-21

## APIs & External Services

**Generative AI:**
- Google Gemini API (`@google/generative-ai`) — AI receipt/data extraction used by the scanner bridge.

**Payments:**
- Razorpay (`razorpay`) — Payment processing. Redirects handled via custom `mifela://payment-verified` protocol (`electron/main.js` `open-url` handler).

**Cloud / Auth:**
- Firebase Auth (`firebase/auth`) — Remote user authentication.
- Firebase Firestore (`firebase/firestore`) — Cloud document store for offline-first sync.
- Firebase project: `mifela-pos-sqlite` (config hardcoded in `src/app.js`).
- Firebase Callable `verifyNodeLicense` (`asia-south1-mifela-pos-sqlite.cloudfunctions.net`) — used by `security:provision` and `BackgroundVerificationScheduler` via raw `fetch` (REST), avoiding the Firebase SDK in the main process.

**Monitoring / Error Tracking:**
- Sentry (`browser.sentry-cdn.com`, `o515678.ingest.sentry.io`) — Error tracking (referenced in CSP; not yet wired in source).
- `electron-log` — Local file logging.

## Data Storage

**Databases:**
- SQLite via `sqlite3` (through Knex.js) — local database at `<userData>/mifela_pos_v1.db`.
- Firebase Firestore (remote sync).
- Query builder: Knex.js (`knex`) over SQLite.

**File Storage:**
- Local filesystem only (exports, logs, scanned files in `~/Documents/MifelaScans`).

**Caching:** None.

## Authentication & Identity

**Auth Provider:** Firebase Auth (cloud) + `LocalAuthService` (local bcrypt users in `local_users` table).

**License model:** Offline-first Ed25519 signature verification. `licence_data` table stores signed payload + signature; `LicenceStateManager` verifies signature, hardware binding, revocation, expiry, and 90-day offline verification deadline. Background re-verification via Firebase Callable when online.

## Monitoring & Observability

**Error Tracking:** Sentry (CSP only; instrumentation not confirmed in source).
**Logs:** `electron-log` (main process), `db:logTelemetry` IPC handler, `log:write` file logger.

## CI/CD & Deployment

**Hosting:** Desktop bundle distribution via `electron-builder`.
**Publish:** Generic provider.
**CI Pipeline:** GitHub Actions workflows (`.github/workflows/`).
**Targets:** Windows (NSIS x64), macOS (DMG + zip). Asar enabled; `electron-dist` obfuscated backend. Startup app-integrity check refuses to run if critical files are patched.

## Environment Configuration

**Required env vars:** Standard runtime configs.
**Secrets location:** Stored locally / environment variables (`.env` deleted in commit `c49c4e3`; secrets scrubbed in `3a46b9d`).

**Hardcoded in source:** Firebase config (API key etc.) in `src/app.js` (H1 — not yet fixed).

## Webhooks & Callbacks

**Incoming:** None.
**Outgoing:** None (Razorpay uses redirect deep-links rather than webhooks).

## CSP (index.html)

Restrictive Content Security Policy:
- `script-src 'self' 'unsafe-inline' blob:` + CDNs (jsdelivr, unpkg, gstatic, Google APIs, recaptcha, razorpay, Sentry, Sardine). `'unsafe-eval'` removed; `'unsafe-inline'` remains.
- `connect-src 'self'` + Googleapis/Cloudfunctions, `ws://localhost:5173` (Vite HMR), jsdelivr, ipify/ipapi.co, Google, recaptcha, identitytoolkit, securetoken, Groq, Razorpay, Sentry, Sardine.
- `frame-src 'self'` + Googleapis, Google, recaptcha, Razorpay.
- `img-src 'self' data: blob: https:` (dropped `http:`).
- `font-src 'self' data: https://fonts.gstatic.com`.
- `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`.
- `object-src 'none'`; `base-uri 'self'`.

---

*Integration audit: 2026-11-21*
