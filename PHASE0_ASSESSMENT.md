# Phase 0 — Repository & Hardware Architecture Discovery

## Current Architecture Map

### Printing Subsystem (`src/printing/`)
```
src/printing/
├── PrinterManager.js      # Legacy orchestrator (7KB)
├── PrinterEngine.js       # Main engine with templates, layout, adapters (7.7KB)
└── adapters/
    ├── PrinterAdapter.js  # Base class interface (14 lines)
    └── TSCAdapter.js      # TSPL implementation for TSC (62 lines)
```

### Electron Printing Layer
```
electron/
├── UniversalPrintEngine.js   # Multi-transport: OS spooler, TCP, Serial, USB (139 lines)
├── main.js                   # IPC handlers: print:get-printers, print:job, print:raw (missing)
├── preload.js                # Exposes printRaw via electronAPI.printRaw
├── printPreload.js           # Bridge for HTML-based silent printing
└── printBlank.html           # Worker page for HTML rendering
```

### Key Findings
- **Two duplicate PrinterManager implementations**: `PrinterManager.js` and `PrinterEngine.js` both export `PrinterManager` with `printLabel()` - only `PrinterEngine.js` version is actually imported (check `inventory.js:4176`)
- **Single adapter**: Only `TSCAdapter` exists, hardcoded for TSPL. Zebra shares it incorrectly at `PrinterEngine.js:178`
- **No printer discovery/detection**: Only manual selection via localStorage (`mifela_printer_config`, `mifela_smart_printers`)
- **No protocol registry**: Manufacturer-to-protocol mapping is a simple if/else
- **No calibration, queue, diagnostics, or profile persistence**
- **Transport layer exists** in `UniversalPrintEngine.js` but `print:raw` IPC handler is **missing from main.js** (preload exposes it but main doesn't handle it)

---

## Print-Job Lifecycle Diagram

```
User clicks Print
       │
       ▼
inventory.js → PrinterManager.printLabel(profile, mediaId, data, qty)
       │
       ├─→ LabelLayoutEngine.generateRenderTree()  // mm → dots
       │       │
       │       ▼
       │   RenderTree { elements: [{type, content, xDots, yDots, ...}] }
       │
       ▼
TSCAdapter.generatePrintJob()  // TSPL string generation
       │
       ▼
{ type: 'RAW', payload: "SIZE...\nGAP...\nTEXT...\nBARCODE...\nPRINT..." }
       │
       ▼
window.electronAPI.printRaw({ connection, data })  // IPC to main
       │
       ▼
[MISSING: ipcMain.handle('print:raw') in main.js]
       │
       ▼ (should route to)
UniversalPrintEngine.sendToPrinter(connection, data)
       │
       ├─→ 'os'      → print /D: or lp -o raw
       ├─→ 'network' → TCP socket port 9100
       ├─→ 'serial'  → serialport write
       └─→ 'usb'     → usb bulk transfer
```

---

## Existing Printer Support Inventory

| Printer | Status | Protocol | Transport | Notes |
|---------|--------|----------|-----------|-------|
| TSC (TE244, TTP-244, TE200, TA210, TA220, MH241) | Partial | TSPL | OS spooler only | Only manufacturer with adapter |
| Zebra (ZD220, ZD420, ZT231, etc.) | Broken | TSPL (wrong) | OS spooler | ZPL needed, shares TSCAdapter incorrectly |
| TVS (LP 46, ILP 5210) | None | Unknown | - | No adapter |
| Honeywell (PC42t, PC43t) | None | Unknown | - | No adapter |
| GoDEX (G500, EZ120) | None | Unknown | - | No adapter |
| BluPrints, Shreyans, Brother, Sato | None | Unknown | - | No adapter |

**32 target models → 1 partially supported (TSC via TSPL)**

---

## Hardware/Protocol Compatibility Matrix (Verified)

| Manufacturer | Models | Command Language | DPI Options | Connectivity | Verified |
|-------------|--------|------------------|-------------|--------------|----------|
| TSC | 6 models | TSPL/TSPL2 | 203, 300 | USB, Ethernet, Serial, BT | Partial (TSPL only) |
| Zebra | 8 models | ZPL II | 203, 300, 600 | USB, Ethernet, Serial, BT | **No** |
| TVS | 5 models | TSPL (most) | 203 | USB, Ethernet | **No** |
| Honeywell | 3 models | ZPL, EPL, DP | 203, 300 | USB, Ethernet | **No** |
| GoDEX | 4 models | GZPL (ZPL-compatible) | 203, 300 | USB, Ethernet | **No** |
| Brother | 1 model | ESC/P, Raster | 300 | USB, BT | **No** |
| Sato | 1 model | SBPL | 203, 300 | USB, Ethernet | **No** |

---

## Technical Debt & Reliability Assessment

### Critical Issues
1. **`print:raw` IPC handler missing** - Raw printing will fail at runtime
2. **Duplicate PrinterManager** - Confusing, one unused (`PrinterManager.js`)
3. **Zebra forced into TSPL** - ZPL printers will print garbage
4. **No printer detection** - Users must manually configure
5. **No protocol registry** - Hardcoded manufacturer check
6. **Single media profile hardcoded** - 3 templates only
7. **No calibration workflow** - Gap/black-mark, offsets, darkness
8. **No print queue/retry** - Fire-and-forget
9. **No diagnostics** - Cannot troubleshoot failures
10. **No verification of physical print** - Only knows OS accepted job

### Code Quality
- Layout engine math is solid (mm → dots conversion)
- TSPL generation is reasonable for 3-up rolls
- UniversalPrintEngine transports are well-implemented (OS, TCP, Serial, USB)
- Missing error boundaries, validation, state tracking

---

## Proposed Implementation Plan

### Phase 1: Foundation (Week 1)
- [ ] Fix `print:raw` IPC handler in main.js → UniversalPrintEngine
- [ ] Remove duplicate `PrinterManager.js`
- [ ] Create `ProtocolRegistry` for manufacturer→adapter mapping
- [ ] Add `ZPLAdapter` for Zebra printers
- [ ] Add `PrinterProfile` persistence (SQLite/localStorage)

### Phase 2: Protocol Coverage (Week 2)
- [ ] Research & implement TVS (TSPL), Honeywell (ZPL), GoDEX (GZPL), Brother (ESC/P), Sato (SBPL)
- [ ] Create `PrinterDetector` using OS printer info + USB VID/PID
- [ ] Build `PrinterCapabilities` database per model

### Phase 3: Universal Rendering (Week 2-3)
- [ ] Extend `LabelLayoutEngine` for Unicode/Indian fonts
- [ ] Add image/logo rendering (raster download to printer)
- [ ] Add barcode symbology mapping per protocol
- [ ] Implement preview → physical print consistency

### Phase 4: Discovery & Config (Week 3)
- [ ] Auto-detect printers via `getPrinters()` + USB enumeration
- [ ] Settings UI: profile assignment, label dims, darkness, speed, orientation
- [ ] Manual fallback for undetected models

### Phase 5: Calibration (Week 3-4)
- [ ] Test label generator (dimensions, alignment, barcode, darkness)
- [ ] Gap/black-mark/continuous media support
- [ ] Horizontal/vertical offset calibration
- [ ] Persist calibration per printer profile

### Phase 6: Reliable Execution (Week 4)
- [ ] Print queue with job states (pending, printing, done, failed)
- [ ] Retry policy with duplicate prevention
- [ ] Job validation before dispatch
- [ ] Structured error logging

### Phase 7: Testing (Week 4-5)
- [ ] Unit tests: layout math, DPI conversion, command generation
- [ ] Integration tests: mocked transports, captured output
- [ ] Hardware validation matrix template

### Phase 8: Diagnostics (Week 5)
- [ ] Diagnostic report generator
- [ ] Developer command inspector (view generated TSPL/ZPL)
- [ ] Connection test utility

### Phase 9: Integration (Week 5)
- [ ] Update all callers (`inventory.js`, future POS screens)
- [ ] Backward compatibility shim
- [ ] Documentation

---

## Risk Summary

| Risk | Impact | Mitigation |
|------|--------|------------|
| Missing `print:raw` handler | **Blocks all raw printing** | Fix immediately (1hr) |
| Zebra on TSPL | Wrong output on 8 models | Add ZPLAdapter before shipping |
| No printer detection | Manual config required | Phase 4 priority |
| Unverified 31/32 models | Unknown compatibility | Mark unverified, test incrementally |
| OS spooler unreliability | Print failures on Windows | Prefer TCP/USB direct where available |