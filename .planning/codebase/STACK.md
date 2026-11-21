# Technology Stack

**Analysis Date:** 2026-11-21

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
- React — not used. Frontend is vanilla JavaScript manipulating the DOM directly.

**Testing:**
- Vitest (v4.1.12) — now a devDependency; 3 test files under `tests/` (`interop.test.js`, `licence-state.test.js`, `license.test.js`).

**Build/Dev:**
- electron-builder — Packaging and distribution (Windows/macOS).
- javascript-obfuscator — Build-time source obfuscation (frontend via Vite plugin; backend via dedicated `obfuscate-backend` script).
- concurrently — Process management during development (`dev` runs Vite + Electron).
- wait-on — Waits for Vite dev server before launching Electron in dev mode.

## Key Dependencies

**Critical:**
- better-sqlite3-multiple-ciphers — REMOVED from `dependencies`; only remains in `build.asarUnpack` (leftover). No longer used at runtime.
- knex (^3.3.0) — SQL query builder used by `electron/database/controllers.js` (replaced direct better-sqlite3 usage; schema bootstrapped via `knex.js` → `schema.js`).
- sqlite3 (^6.0.1) — Knex driver; single SQLite driver now used runtime-wide.
- firebase (@firebase v13.1.0) — Auth and Firestore cloud sync/auth (client SDK still loaded in renderer).
- razorpay (^2.9.8) — Payment processing (gateway redirects via `mifela://` deep links).
- serialport (^13.0.0) / usb (^3.2.1) — Hardware peripheral (thermal printer) interaction.
- electron-updater (^6.1.8) — Auto-update mechanism.
- chart.js (^4.5.1) — Data visualization (loaded from CDN in `index.html`).
- @google/generative-ai (^0.24.1) — AI receipt extraction.
- bcryptjs (^3.0.3) — Password hashing for `local_users` (`LocalAuthService`).

**Infrastructure:**
- electron-log (^5.0.0) — Logging to local filesystem.
- chokidar (^5.0.0) — Scanner hot-folder watcher (dev).
- html2pdf.js, jspdf, jspdf-autotable — PDF/report generation.
- html5-qrcode — Barcode/QR scanning.

## Data Access Layer

- `electron/database/knex.js` — Knex instance factory (`initKnex`/`getKnex`), client `sqlite3`, file at `<userData>/mifela_pos_v1.db`. Runs `initSchema()` on init to create all tables (`CREATE TABLE IF NOT EXISTS`).
- `electron/database/schema.js` — Knex schema migrations: `products`, `customers`, `transactions`, `security_config`, `store_settings`, plus new offline-first tables `local_users` and `licence_data`.
- `electron/database/controllers.js` — All `db:*` IPC handlers, all queries through Knex. Write handlers wrapped in `knex.transaction()`; read handlers return `[]` on error.

**Single driver now:** only `sqlite3`/knex opens the DB file. `better-sqlite3`/`connection.js` and the dual-driver concern (H1) are removed.

## Configuration

**Environment:** Configured via code constants and dynamic runtime settings (no `.env` tracked).
- Firebase config is hardcoded in `src/app.js` (API key, project `mifela-pos-sqlite`). Still present (H2 not fixed).

**Build:**
- `vite.config.js` — Frontend bundling; externals `electron`, node builtins, `usb`, `serialport`, `chokidar`, `electron-updater`; obfuscator plugin applied to `src/**` on build.
- `package.json` (`build` section) — Electron application configuration (electron-builder: NSIS/DMG, asar, icon paths). `electron-dist/` is the obfuscated backend output; `extraMetadata.main` points to `electron-dist/main.js`.

## Platform Requirements

**Development:** Node.js environment with native build tools for `sqlite3`/`better-sqlite3` native modules.

**Production:** Desktop Application (Windows NSIS installer, macOS DMG/zip). Executable name `Mifela`, appId `com.mifela.pos`.

---

*Stack analysis: 2026-11-21 (focus: tech)*
