# Coding Conventions

**Analysis Date:** 2026-11-21

## Language & Module System

**Language:** JavaScript (ESM) exclusively. `package.json` sets `"type": "module"`.
**Module syntax:** `import`/`export` (ESM) throughout `src/` and `electron/`. CommonJS only where required for native modules (e.g. `createRequire` for `electron-updater`/`serialport` in `main.js`).

## Naming Patterns

**Files:**
- PascalCase for classes/main components (`PrinterManager.js`, `LicenseManager`).
- camelCase or kebab-case for utilities (`gdpr-compliance.js`, `imageDB.js`, `knex.js`, `schema.js`).
- Directories: lowercase descriptive (`components`, `services`, `utils`, `store`, `printing`, `database`, `security`, `telemetry`, `adapters`, `legal`).

**Functions/Methods:** camelCase (`registerDBHandlers`, `initKnex`, `executePrint`, `evaluateCurrentState`).

**Variables:** camelCase consistently.

**IPC channel names:** kebab-case or `domain:action` (`db:getProducts`, `security:get-state`, `print:job`, `system:save-file`, `auth:login`, `licence:getState`).

## Code Style

**Formatting:** No strict automated formatting enforced via repo config (no ESLint/Prettier present).

**Linting:** Not detected.

**Import organization:**
1. External/Node builtin modules.
2. Local internal modules.
**Path aliases:** Standard relative imports (`./`, `../`); Vite resolves `@` to `./src` (`vite.config.js`).

## Error Handling

**Patterns:** Try/catch blocks used in `electron/database/controllers.js` and async operations. IPC handlers return `{ success: false, error: ... }` or throw; renderer side wraps calls in try/catch with toast/modal feedback. DB read handlers return `[]`/`null` on error (masking — see CONCERNS.md M3).

**Process-level:** `uncaughtException` and `unhandledRejection` logged via `electron-log` in `electron/main.js`.

## Logging

**Framework:** `electron-log`.
**Patterns:** Logging to local filesystem for production traceability (`electron/telemetry/logger.js`); `console.error`/`console.warn` used in renderer.

## Comments

**When to comment:** Minimal JSDoc usage. Inline "🚀 THE FIX:" / "🚀 NEW:" markers used to denote recent patches throughout the codebase.

## Function Design

**Size:** Modular approach — components broken into logical files (`src/components/*.js`).

**Parameters:** Standard object passing for complex configurations (e.g. `{ transaction, customerUpdate }`).

---

*Convention analysis: 2026-11-21*
