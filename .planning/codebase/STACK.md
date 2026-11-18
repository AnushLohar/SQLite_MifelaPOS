# Technology Stack

**Analysis Date:** 2026-11-18

## Languages

**Primary:**
- JavaScript (ESM) — Entire codebase (Node.js/Electron). `package.json` sets `"type": "module"`.
- HTML/CSS — Single `index.html` entry point with Tailwind utility classes and inline `<style>` blocks.

## Runtime

**Environment:**
- Node.js (via Electron)
- Package Manager: npm (lockfile: `package-lock.json` present)

## Frameworks

**Core:**
- Electron (v44.5.1) — Desktop application runtime. Main process entry: `electron/main.js`.
- Vite (v7.3.1) — Frontend build tool and dev server (`vite.config.js`). Serves renderer on `http://localhost:5173` in dev.
- Tailwind CSS (v3) — Styling (via PostCSS config).

**Not used in source (declared as dependencies only):**
- Express (v5.2.1) — listed in `package.json` but no `express` imports found anywhere in `src/` or `electron/`. Not part of the active runtime.
- React — not used. Frontend is vanilla JavaScript manipulating the DOM directly. Earlier documents incorrectly described the frontend as React.

**Testing:** None detected. No test framework, no `.test.js`/`.spec.js` files.

**Build/Dev:**
- electron-builder — Packaging and distribution (Windows/macOS).
- javascript-obfuscator — Build-time source obfuscation (frontend via Vite plugin; backend via dedicated `obfuscate-backend` script).
- concurrently — Process management during development (`dev` runs Vite + Electron).
- wait-on — Waits for Vite dev server before launching Electron in dev mode.

## Key Dependencies

**Critical:**
- better-sqlite3-multiple-ciphers — Local encrypted SQLite database (driver).
- knex (^3.3.0) — SQL query builder used by `electron/database/controllers.js` (replaced direct better-sqlite3 usage in controllers; schema still bootstrapped via `connection.js`).
- firebase (@firebase v13.1.0) — Auth and Firestore cloud sync/auth.
- razorpay (^2.9.8) — Payment processing (gateway redirects via `mifela://` deep links).
- serialport (^13.0.0) / usb (^3.2.1) — Hardware peripheral (thermal printer) interaction.
- electron-updater (^6.1.8) — Auto-update mechanism.
- chart.js (^4.5.1) — Data visualization (loaded from CDN in `index.html`).
- @google/generative-ai (^0.24.1) — AI receipt extraction.

**Infrastructure:**
- electron-log (^5.0.0) — Logging to local filesystem.
- chokidar (^5.0.0) — Scanner hot-folder watcher (dev).
- html2pdf.js, jspdf, jspdf-autotable — PDF/report generation.
- html5-qrcode — Barcode/QR scanning.

## Data Access Layer

- `electron/database/knex.js` — Knex instance factory (`initKnex`/`getKnex`), client `sqlite3`, file at `<userData>/mifela_pos_v1.db`.
- `electron/database/connection.js` — Legacy direct `better-sqlite3` schema bootstrap (`initDB` creates `products`, `customers`, `transactions`, `security_config` tables + indexes).
- `electron/database/controllers.js` — IPC DB handlers registered via `registerDBHandlers()`, all queries through Knex (transactions, JSON extraction via `json_extract`/`json_set`, batch ops).

**Note:** Two database access paths exist — `connection.js` (better-sqlite3 for schema bootstrap) and `knex.js`/`controllers.js` (Knex for runtime queries) both target the same `mifela_pos_v1.db` file.

## Configuration

**Environment:** Configured via code constants and dynamic runtime settings (no `.env` tracked; secrets scrubbed in commit `3a46b9d`).
- Firebase config is hardcoded in `src/app.js` (API key, project `mifela-pos-sqlite`).

**Build:**
- `vite.config.js` — Frontend bundling; externals `electron`, node builtins, `usb`, `serialport`, `chokidar`, `electron-updater`; obfuscator plugin applied to `src/**` on build.
- `package.json` (`build` section) — Electron application configuration (electron-builder: NSIS/DMG, asar, icon paths).

## Platform Requirements

**Development:** Node.js environment with native build tools for `better-sqlite3`.

**Production:** Desktop Application (Windows NSIS installer, macOS DMG/zip). Executable name `Mifela`, appId `com.mifela.pos`.

---
*Stack analysis: 2026-11-18 (focus: tech)*