# Mifela POS — Component & Module Reference

**Analysis Date:** 2026-11-21  
**Focus Area:** arch

---

## 1. Frontend Components (`src/components/`)

| File | Purpose |
|------|---------|
| `pos.js` | Point-of-sale checkout: cart, manual item add, customer lookup, discount, checkout, cheques, split payments, audio scan feedback, invoice printing |
| `inventory.js` | Product catalog: add/edit products, stock adjustments, barcode/SKU lookup, best-before dates, dealer info, barcode generation, CSV export |
| `customers.js` | Customer/partner management: create/edit customers, dealer/supplier types, partner type switching, loyalty, CSV export |
| `transactions.js` | Transaction history: search, date/status filtering, clear filters, CSV export |
| `dashboard.js` | Dashboard: dynamic widgets, revenue trend (7-day), top sellers, local IP display, auto-IP update |
| `settings.js` | Store profile setup + hardware settings: store details, tax/GST/PAN, currency, tax rate, printer config, silent print |
| `staff.js` | Staff management: add staff, staff list, payroll export, form reset |
| `reports.js` | Reporting views |
| `navigation.js` | Sidebar navigation, role-based view switching, `showNavItemsForRole`, `updateNavigationUIForPlan` |
| `notifications.js` | Notification drawer setup |
| `scannerReview.js` | AI receipt scan review screen (`renderReviewScreen`) |
| `widgetRenderer.js` | Dashboard widget rendering |
| `publicToS.js` | Public terms of service page |
| `TnC.js` | Terms & conditions |
| `bulkUpload.js` | Bulk data import |
| `production.js` | Production/manufacturing view |

## 2. Frontend Services (`src/services/`)

| File | Purpose |
|------|---------|
| `auth.js` | License verification (`verifyLocalLicense`), activation (`activateSoftware`), logout (`logoutUser`), silent cloud verification (`executeSilentVerification`) |
| `firebase-init.js` | Firebase app initialization |
| `network.js` | Online/offline status monitoring (`getNetworkStatus`, `initNetworkMonitoring`) |
| `usage.js` | Usage telemetry |

## 3. Frontend Store (`src/store/`)

| File | Purpose |
|------|---------|
| `state.js` | Global state: cart, user, location, currency, product cache (with dedup/invalidation), `AppState` pub/sub, `hasPermission` role matrix, `getUserRole`/`getCurrentUserPlan` from localStorage session |
| `listeners.js` | Firebase real-time listeners: settings, stores, inventory stats (low stock/expired/value at risk), marketing modal; guards against duplicate listener registration |
| `widgetConfig.js` | `MASTER_WIDGET_LIST` — dashboard widget definitions (revenue, sales count, staff on duty, value at risk, SKU count, out of stock, sales chart, top products, expired list, low stock warnings, highest grossing) |

## 4. Frontend Utils (`src/utils/`)

| File | Purpose |
|------|---------|
| `app.js` | Frontend root: Firebase init, global window helpers, printer engine (`loadPrinters`, `executePrint`, `attachPrinterTestButton`), global DOM listeners, modals (terms, support, recovery, cheque, update), auth setup, navigation init |
| `dom.js` | DOM element init, `showModal`, `showToast`, `initDOMElements` |
| `security.js` | `escapeHTML` |
| `math.js` | `safeMath` |
| `ids.js` | `generateInvoiceId` |
| `print.js` | Invoice/A3/ledger printing, HTML generation, CSV/Excel export, PDF generation |
| `export.js` | CSV export for inventory/transactions/partners/staff |
| `scanner.js` | `handleGlobalScan` — global keyboard barcode scanning |
| `imageDB.js` | `savePosImage` / `loadPosImage` — POS image indexed DB |
| `migrations.js` | Database migration utilities |
| `platform.js` | Platform detection helpers |
| `directoryFixer.js` | Directory path fixing |
| `Updater.js` | Auto-updater UI integration |

## 5. Frontend Printing (`src/printing/`)

| File | Purpose |
|------|---------|
| `PrinterManager.js` | Printer management |
| `PrinterEngine.js` | Print engine |
| `adapters/PrinterAdapter.js` | Base printer adapter |
| `adapters/TSCAdapter.js` | TSC thermal printer adapter (uses `printRaw` ESC/POS byte-stream) |

## 6. Electron Main Process (`electron/`)

| File | Purpose |
|------|---------|
| `main.js` | App lifecycle, single-instance lock, protocol handling (mifela://), window creation, print worker, IPC handler registration, auto-updater, scanner hot-folder, integrity check, `auth:login`/`licence:getState` handlers |
| `preload.js` | `contextBridge` APIs: `dbAPI`, `electronAPI`, `printAPI`, `scannerAPI` |
| `printPreload.js` | Isolated preload for print worker (`printBridge` only) |
| `printBlank.html` | Blank page loaded by print worker |
| `database/knex.js` | Knex SQLite connection (`initKnex`/`getKnex`) + `initSchema()` |
| `database/schema.js` | Knex schema migrations (`local_users`, `licence_data`, etc.) |
| `database/controllers.js` | All `db:*` IPC handlers; `authorize()` guard on writes |
| `security/licenseVerifier.js` | `LicenseManager.verifySignature` (Ed25519) |
| `security/fingerprint.js` | `getHardwareFingerprint` |
| `security/integrity.js` | `verifyAppIntegrity` (startup tamper detection) |
| `services/LicenceStateManager.js` | Offline licence state evaluation |
| `services/LocalAuthService.js` | bcrypt local user login |
| `services/ConnectivityMonitor.js` | WAN connectivity polling |
| `services/BackgroundVerificationScheduler.js` | Background online licence verification |
| `telemetry/logger.js` | Electron-log based file logging |
| `UniversalPrintEngine.js` | Print engine |

## 7. Cloud Functions (`functions/`)

| File | Purpose |
|------|---------|
| `functions/index.js` | `requestChallenge`, `verifyChallenge`, `redeemTerminalToken`; Firebase Callable `verifyNodeLicense` |

## 8. Tests (`tests/`)

| File | Purpose |
|------|---------|
| `license.test.js` | License unit tests |
| `licence-state.test.js` | `LicenceStateManager.evaluateCurrentState` coverage (mocks knex + licenseVerifier) |
| `interop.test.js` | Interop / integration checks |

## 9. Naming Conventions

- **Files:** PascalCase for classes (`PrinterManager.js`, `LicenseManager`), camelCase/kebab-case for utilities and modules (`gdpr-compliance.js`, `imageDB.js`, `knex.js`, `schema.js`)
- **Functions/variables:** camelCase
- **Directories:** lowercase descriptive (`components`, `services`, `utils`, `store`, `printing`, `database`, `security`, `telemetry`)
- **IPC channels:** `domain:action` (`db:getProducts`, `security:get-state`, `print:job`, `system:save-file`, `auth:login`, `licence:getState`)

## 10. Where to Add New Code

| Concern | Location |
|---------|----------|
| New UI view/component | `src/components/` |
| New global state | `src/store/state.js` |
| New Firebase listener | `src/store/listeners.js` |
| New DB query / IPC handler | `electron/database/controllers.js` (register in `registerDBHandlers`) + preload (`window.dbAPI`) |
| New main-process system API | `electron/main.js` (`registerIpcHandlers`) + preload (`window.electronAPI`) |
| New main-process service (auth/licensing/connectivity) | `electron/services/` |
| New util/helper | `src/utils/` |
| New print format | `src/utils/print.js` |
| New test | `tests/*.test.js` (Vitest) |

---

*Component reference: 2026-11-21 — focus: arch*
