# Testing Patterns

**Analysis Date:** 2026-11-21

## Test Framework

**Runner:** Vitest (v4.1.12), configured in `vitest.config.js`:
- `environment: 'node'`
- `include: ['tests/**/*.test.js']`

## Test File Organization

Test files live in `tests/` at the project root:

| File | Purpose |
|------|---------|
| `tests/license.test.js` | License-related unit tests |
| `tests/licence-state.test.js` | `LicenceStateManager.evaluateCurrentState` coverage |
| `tests/interop.test.js` | Interop / integration checks |

## Test Structure

Node environment, standard Vitest `test()`/`expect()` style. No React/component rendering tests (frontend is vanilla DOM). No Electron E2E (no Playwright/Spectron).

## Mocking

Tests mock `electron`/`knex` modules where needed (see `tests/licence-state.test.js` which mocks `../database/knex.js` and `../security/licenseVerifier.js`).

## Coverage

Partial — only the 3 files above. Large parts of `src/` and `electron/` remain untested (controllers, components, services).

## Gaps / Recommendations

- No unit tests for `electron/database/controllers.js` (Knex query logic, transactions, ledger merge, `executeBatch`).
- No unit tests for renderer components (`src/components/pos.js`, `inventory.js`, etc.).
- No end-to-end tests for the Electron app (no playwright/spectron).
- Authorization (`authorize()` in `controllers.js`) is untested.

---

*Testing analysis: 2026-11-21 (focus: tech)*
