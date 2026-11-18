# Mifela POS — Component & Module Reference

**Analysis Date:** 2026-11-18  
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

## 2. Frontend Services (`src/services/`)

| File | Purpose |
|------|---------|
| `auth.js` | License verification (`verifyLocalLicense`), activation (`activateSoftware`), logout (`logoutUser`), silent cloud verification (`executeSilentVerification`) |
| `network.js` | Online/offline status monitoring (`getNetworkStatus`, `initNetworkMonitoring`) |
| `usage.js` | Usage telemetry |

## 3. Frontend Store (`src/store/`)

| File | Purpose |
|------|---------|
| `state.js` | Global state: cart, user, location, currency, product cache (with dedup/invalidation), `AppState` pub/sub, permission bypass (`hasPermission` always true), role/location forced to admin/main |
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

## 5. Electron Main Process (`electron/`)

| File | Purpose |
|------|---------|
| `main.js` | App lifecycle, single-instance lock, protocol handling (mifela:// deep links), window creation, print worker, IPC handler registration, auto-updater, scanner hot-folder |
| `preload.js` | `contextBridge` APIs: `dbAPI`, `electronAPI`, `printAPI`, `scannerAPI` |
| `database/knex.js` | Knex SQLite connection (init/get) |
| `database/controllers.js` | All `db:*` IPC handlers (products, customers, transactions, ledger, directory cleanup, batch, settings) |
| `database/connection.js` | better-sqlite3 sync connection + schema (products/customers/transactions/security_config) |
| `security/licenseVerifier.js` | `LicenseManager`: key generation, state check, challenge signing, license extension |
| `security/fingerprint.js` | `getHardwareFingerprint` |
| `telemetry/logger.js` | Electron-log based file logging |

## 6. Cloud Functions (`functions/`)

| File | Purpose |
|------|---------|
| `functions/index.js` | `requestChallenge`, `verifyChallenge`, `redeemTerminalToken` |

## 7. Naming Conventions

- **Files:** PascalCase for classes (`PrinterManager.js`, `LicenseManager`), camelCase/kebab-case for utilities and modules (`gdpr-compliance.js`, `imageDB.js`, `knex.js`)
- **Functions/variables:** camelCase
- **Directories:** lowercase descriptive (`components`, `services`, `utils`, `store`, `printing`, `database`, `security`, `telemetry`)
- **IPC channels:** `domain:action` (`db:getProducts`, `security:sign-challenge`, `system:save-file`, `print:job`)

## 8. Where to Add New Code

| Concern | Location |
|---------|----------|
| New UI view/component | `src/components/` |
| New global state | `src/store/state.js` |
| New Firebase listener | `src/store/listeners.js` |
| New DB query / IPC handler | `electron/database/controllers.js` (register in `registerDBHandlers`) + preload (`window.dbAPI`) |
| New main-process system API | `electron/main.js` (`registerIpcHandlers`) + preload (`window.electronAPI`) |
| New util/helper | `src/utils/` |
| New print format | `src/utils/print.js` |

---

*Component reference: 2026-11-18 — focus: arch*
