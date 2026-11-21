# Mifela POS

## What This Is

Mifela POS is a desktop point-of-sale and inventory management application (Electron, vanilla JavaScript + Tailwind) for single-store retail. It runs offline-first on a local SQLite database with Firebase cloud sync for settings, stores, and optional cross-device data. The app handles POS checkout (cart, discounts, cheques, split payments, invoice printing), product catalog, customer/partner management, transaction history, dashboard widgets, staff management, reporting, and store settings. Licensing is offline-first Ed25519 signature verification bound to a hardware fingerprint, with background re-verification when online.

## Core Value

A reliable, offline-capable POS terminal that a small retailer can run all day without internet, with licensing that binds the terminal to a specific machine.

## Business Context

- **Customer**: Small retail store owners who run the terminal on one machine
- **Revenue model**: Lifetime offline license sold via Razorpay, activated per terminal
- **Success metric**: Terminal can complete a sale and print an invoice fully offline
- **Strategy notes**: none

## Requirements

### Validated

(Shipped and confirmed valuable — inferred from existing code.)

- ✓ POS checkout with cart, discounts, cheques, split payments, invoice printing
- ✓ Product catalog with barcode/SKU lookup, stock tracking, CSV export
- ✓ Customer/partner (supplier/dealer) management with dues and loyalty points
- ✓ Transaction history, search, filtering, CSV export
- ✓ Dashboard widgets (revenue, top sellers, low stock, expired, value at risk)
- ✓ Staff management and payroll export
- ✓ Store settings (tax/GST/PAN, currency, printer config, silent print)
- ✓ Offline-first Ed25519 licensing with hardware fingerprint binding
- ✓ Background online license re-verification when connectivity returns
- ✓ Razorpay payments via `mifela://` deep-link redirect
- ✓ Firebase Auth + Firestore cloud sync for settings/stores
- ✓ Auto-updater and scanner hot-folder (dev)
- ✓ App integrity check at startup (refuses to run if critical files patched)

### Active

(Current scope — hardening & security fixes.)

- [ ] Tighten CSP in `index.html` — remove `unsafe-inline` from script-src/style-src
- [ ] Guard `db:executeBatch` — restrict sensitive tables (`licence_data`, `security_config`) and validate columns
- [ ] Stock availability check in `db:processSale` — abort if `stockLevel < quantity`
- [ ] Surface DB read errors instead of returning `[]`/`null` silently
- [ ] Role sourced from authenticated session, not client-controlled localStorage

### Out of Scope

- Real-time multi-terminal sync — single-terminal POS by design
- Mobile app / web portal — desktop Electron only
- OAuth / social login — email/password (Firebase + local bcrypt) sufficient
- Encrypted database at rest — out of scope for v1 hardening

## Context

- **Technical environment**: Electron v44.5.1, Vite v7.3.1, Tailwind v3, Node.js ESM
- **Database**: Single Knex/`sqlite3` driver at `<userData>/mifela_pos_v1.db`; `better-sqlite3` removed
- **Key files**: `electron/main.js`, `electron/database/controllers.js`, `electron/preload.js`, `src/app.js`, `index.html`
- **Known issues to address**: hardcoded Firebase config in `src/app.js` (H1), broad IPC surface (M2)

## Constraints

- **Tech stack**: Electron + vanilla JS + SQLite — no React, no framework migration
- **Compatibility**: Windows (NSIS x64) and macOS (DMG/zip) builds via electron-builder
- **Security**: Licensing and business logic run on the client device; obfuscation is not a security control

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Knex/sqlite3 single driver (removed better-sqlite3 dual layer) | Eliminates concurrent-write corruption risk | — Pending |
| Sandboxed print worker (`printBlank.html` + `printPreload.js`) | Removes XSS/RCE vector from renderer-controlled `data:` URLs | — Pending |
| Existing app treated as Validated | Onboarding goal is hardening, not feature rebuild | ✓ Good |

---
*Last updated: 2026-11-21 after gsd-onboard (codebase map complete)*
