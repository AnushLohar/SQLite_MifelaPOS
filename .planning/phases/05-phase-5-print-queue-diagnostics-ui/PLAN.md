# Phase 5 — Print Queue, Diagnostics & Calibration UI

**Project**: `/Users/anushlohar/Documents/BUZZ/mifela/SQLite_MifelaPOS copy`
**Status**: PLANNED (not yet implemented)

## Goals

1. Persistent print job queue & dispatcher with sequential per-printer execution
2. Printer diagnostics & calibration UI (dark theme)
3. Profile persistence decision (localStorage vs SQLite/Electron userData)

## Background

Phases 1-4 complete:
- Phase 1: Raw printing IPC + ProtocolRegistry + adapters (TSC/ZPL/SATO)
- Phase 2: Remaining adapters + PrinterDetector
- Phase 3A: Intelligent PrinterDetector integration
- Phase 4: Calibration engine + persistent profiles + test labels

## Deliverables

### 1. Persistent Print Job Queue & Dispatcher

**Files**: `src/printing/PrintQueue.js`, `src/printing/PrintDispatcher.js`

**Requirements**:
- Sequential queue per printer (one job at a time per printer)
- Job states: `pending`, `dispatching`, `completed`, `failed`, `cancelled`
- Job tracking: `jobId`, `printerName`, `timestamp`, `payload`, `attempts`, `maxAttempts`
- Retry with exponential backoff for network/USB failures
- User-controlled cancel (stops current job + queued jobs)
- Duplicate prevention: reject identical jobs within configurable window
- Distinguish OS-accepted job vs physical print completion (only knowable via direct TCP/USB feedback)

**Design**:
```javascript
// Job record structure
{
  jobId: string,
  printerName: string,
  manufacturer: string,
  payload: string,       // Raw TSPL/ZPL/SBPL
  quantity: number,
  attempts: 0,
  maxAttempts: 3,
  state: 'pending',      // pending | dispatching | completed | failed | cancelled
  createdAt: ISO string,
  startedAt: ISO string | null,
  completedAt: ISO string | null,
  error: string | null,
}

// Queue per printer
queues: Map<string, PrintQueue>  // keyed by printerName

// Dispatcher processes queues sequentially
PrintDispatcher.dispatch(job) -> Promise<JobResult>
PrintDispatcher.cancel(jobId) -> void
PrintDispatcher.getQueueStatus(printerName) -> object
```

**Failure handling**:
- Printer offline → job fails after maxAttempts, alerts user, queue continues
- Network timeout → exponential backoff retry (1s, 2s, 4s)
- Invalid command → fail immediately, no retry
- OS spooler accepts but physical print fails → marked `completed` with note (cannot verify physical)

### 2. Printer Diagnostics & Calibration UI

**Files**: New UI component(s) under `src/components/` — named `calibration`, `printer-diagnostics`, `print-queue`

**Theme**: Dark theme consistent with existing MifelaPOS dark UI (SLATE accents)

**Screen A — Printer Discovery & Profile Editor**
- List detected printers from `window.electronAPI.getPrinters()`
- Auto-detect manufacturer/model (via PrinterDetector) with confidence badges
- Manual override fields:
  - Manufacturer dropdown
  - Model text input
  - Protocol dropdown (tspl/zpl/sbl/driver-mediated/manual)
  - DPI selector (203/300/600)
  - Label width/height (mm)
  - Media type (gap/black-mark/continuous)
  - Darkness slider (0-15)
  - Speed selector
  - X/Y offset nudge (±mm with +/- buttons)
- **Save Profile** button (calls PrinterProfileManager.saveProfile)
- **Reset to Default** button
- **Test Connection** button

**Screen B — Calibration Test Label**
- **Print Calibration Test Label** button → generates + dispatches test label via CalibrationEngine
- **Preview Label** section:
  - Online: Labelary iframe preview of generated ZPL (when internet available)
  - Offline: Clean wireframe layout (SVG/HTML representation of label contents)
  - Raw ZPL/TSPL/SBPL toggle for developers
- **Nudge Controls**: X/Y offset adjustments with live preview update (no print until user clicks Save)

**Screen C — Print Job Queue & Error Log**
- Live queue status per printer (pending/completed/failed counts)
- Recent print error log (last 20 jobs with timestamps and error messages)
- Retry failed jobs button
- Cancel all button

### 3. Profile Persistence Decision

**Options**:
A. **Keep `localStorage`** (`mifela_printer_profiles_v2`)
   - Pro: Minimal code, existing pattern, survives restarts
   - Con: Cleared on cache clear, not accessible from Electron main process, lost on packaged update reinstall

B. **Migrate to Electron `userData` (file-based JSON)**
   - Pro: Survives cache clears, accessible from main process
   - Con: Requires IPC + fs, more code

C. **Migrate to SQLite** (`electron/database/`)
   - Pro: Transactional, structured queries, survives cache clears
   - Con: Requires Knex migration, most code

**Recommendation**: **Option B** — migrate to `userData` JSON file via IPC.
- Rationale: Calibration data needs to survive cache clears and packaged updates. SQLite adds migration overhead for what is essentially a key-value profile store. `userData` JSON via IPC is the sweet spot.
- Keep `localStorage` as read fallback for backward compatibility during migration.

### 4. Error Boundaries & Safety

- Never silently fall back to TSC for unknown manufacturers (ProtocolRegistry already throws)
- Never send raw commands for provisional protocols without explicit user acknowledgment
- Display actionable error messages: "Printer offline", "Unsupported protocol", "Driver missing"
- Log errors to existing `writeLog` IPC channel

### 5. Integration Points

| Component | Integration |
|-----------|-------------|
| `src/printing/PrinterEngine.js` | PrintQueue calls `PrinterManager.printLabel()` |
| `src/printing/CalibrationEngine.js` | UI calls `CalibrationEngine.generateTestLabel()` + `printTestLabel()` |
| `src/printing/PrinterProfileManager.js` | UI reads/saves profiles via manager methods |
| `electron/main.js` | New IPC: `print:queue-status`, `print:cancel-job`, `profile:save`, `profile:load` |
| `electron/UniversalPrintEngine.js` | Dispatcher routes jobs to transports |

### 6. Tests (Automated)

- Queue: add/remove/process jobs sequentially per printer
- Dispatcher: retry on failure, stop on maxAttempts, cancel queue
- Job states: pending→dispatching→completed/failed/cancelled
- Duplicate detection: identical job ID rejected within window
- Profile persistence: save/load/reset via new persistence layer
- Mocked transports: `printRaw` mocked to simulate success/failure

### 7. Non-Goals (Phase 5)

- ❌ USB VID/PID detection (deferred to future phase)
- ❌ Physical hardware validation (no hardware available)
- ❌ Label preview image rendering (wireframe only)
- ❌ Multi-printer concurrent printing (sequential per printer only)

## Architecture Decisions

1. **Offsets**: Applied once in `LabelLayoutEngine` (software dots). Adapters never add printer shift commands based on profile offsets.
2. **Raw print**: Only permitted when protocol confidence is `high` or user explicitly confirms.
3. **Queue key**: `printerName` (exact OS name string).
4. **Persistence**: Start with `localStorage`; plan migration to `userData` JSON via IPC as a follow-up task.

## Open Questions

1. Does the UI need live job progress (dots printed vs total)? — Requires printer feedback which most thermal printers don't provide.
2. Should calibration profiles be linked to OS printer names or user-defined names? — OS names are more stable but can change on driver reinstall.

## Next Steps (After Plan Approval)

1. Implement `PrintQueue.js` + `PrintDispatcher.js`
2. Build calibration UI components
3. Decide persistence migration (localStorage → userData)
4. Write unit tests for queue/dispatcher
5. Run regression tests
