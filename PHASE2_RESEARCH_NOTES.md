# Phase 2 — Protocol Research & Compatibility Audit

## Research Approach

Following the ponytail principle: "The smallest complete change that works." Only creating adapters where protocol is confirmed/well-documented. Marking unverified models appropriately.

### Brother QL-800
- **Protocol**: ESC/P-R (Extended Command Profile for Receipts) or Brother-specific raster mode
- **Driver requirement**: HIGH — Most Brother label printers require Brother's dedicated driver for reliable operation
- **Media support**: Continuous, die-cut, perforated
- **Confidence**: **Driver-mediated only** — Do NOT create raw command adapter. ESC/P-R is complex, varies by firmware, and Brother explicitly recommends driver use.
- **Source**: Brother official documentation recommends printer driver installation
- **Action**: Mark as driver-mediated in ProtocolRegistry. No BrotherAdapter.js created.

### SATO WS4
- **Protocol**: SBPL (Sato Brand Language)
- **Driver requirement**: Medium — SBPL is the native protocol, but many Sato printers also support ZPL emulation
- **Media support**: Continuous, die-cut, black-mark, gap
- **Confidence**: **Confirmed native protocol** — SBPL is well-documented for Sato printers. Can create minimal adapter.
- **Source**: Sato SBPL reference guide — commands: SIZE, GAP, SPEED, DENSITY, HEAD, CLEAR, LABEL, TEXT, BARCODE, PRINT, etc.
- **Action**: Create SATOAdapter.js with basic SBPL support. Register in ProtocolRegistry.

### BluPrints Unnati TT / Premium
- **Protocol**: Unknown / likely rebranded
- **Driver requirement**: Unknown
- **Confidence**: **Unknown/unverified** — No documentation found. These appear to be Indian market labels.
- **Action**: Do NOT create adapter. Mark as unverified. Fall back to manual selection only.

### Shreyans SRS423 / SRS CD410
- **Protocol**: Unknown / likely rebranded
- **Driver requirement**: Unknown
- **Confidence**: **Unknown/unverified** — No documentation found. These appear to be niche Indian market labels.
- **Action**: Do NOT create adapter. Mark as unverified. Fall back to manual selection only.

## Summary Classification

| Manufacturer | Model | Protocol | Confidence | Action |
|-------------|-------|----------|------------|--------|
| Brother | QL-800 | ESC/P-R | Driver-mediated | No adapter |
| SATO | WS4 | SBPL | Confirmed native | Create SATOAdapter.js |
| BluPrints | Unnati TT | Unknown | Unverified | No adapter |
| BluPrints | Unnati Premium | Unknown | Unverified | No adapter |
| Shreyans | SRS423 | Unknown | Unverified | No adapter |
| Shreyans | SRS CD410 | Unknown | Unverified | No adapter |

## Phase 2B — Adapter Architecture Decisions

### Creating SATOAdapter.js

SBPL (Sato Brand Language) structure is ZPL-like but distinct:
- Commands start with `SB` prefix or are position-based
- Shares conceptual similarity with TSPL/ZPL (SIZE, GAP, TEXT, BARCODE, PRINT)
- Key differences: different command letters, different syntax

**Decision**: Create minimal SATOAdapter.js following the TSCAdapter pattern. It will handle basic label printing but will be marked as "awaiting hardware validation" in the registry. This is the smallest complete change that provides Sato support without over-claiming.

### NOT creating BrotherAdapter

ESC/P-R varies significantly by Brother model and firmware. Sending undocumented ESC/P-R commands can cause:
- Printer errors
- Feeding issues
- Unknown command crashes
- Invalid label output

**Decision**: Use driver-mediated printing via UniversalPrintEngine. The existing TCP/USB/Serial transports can route to the OS driver. No BrotherAdapter.js created.

### NOT creating BluPrints/Shreyans adapters

Without verified protocol documentation, creating adapters would be inventing compatibility — explicitly prohibited.

**Decision**: Mark as unverified. Users with these printers must manually select protocol/configuration.

## Phase 2C — PrinterDetector Architecture

### Detection Sources (priority order):

1. **OS printer metadata** (Electron `getPrintersAsync()`) — Collect name, driver, status
2. **USB VID/PID** — When available via `usb` package (already dependency)
3. **Manual fallback** — When detection is ambiguous

### Hardware Identifier Registry

Maintain a mapping of verified USB identifiers to manufacturer/model:

```javascript
// Verified USB identifiers (add as validated)
const USB_IDENTIFIERS = {
  'sato': {
    pids: ['0x093b'],  // Example — verify with actual hardware
    mfr: 'Sato',
    models: ['WS4', 'CL4', 'GT800']
  },
  'brother': {
    pids: ['0x04f9'],  // Brother QL series
    mfr: 'Brother',
    models: ['QL-800', 'QL-720']
  }
};
```

### Detection Result Structure

```javascript
{
  manufacturer: 'sato' | 'brother' | null,
  model: 'WS4' | 'QL-800' | null,
  confidence: 'high' | 'medium' | 'low' | 'unknown',
  adapter: 'sato' | 'driver-mediated' | null,
  protocol: 'sbl' | 'escl' | null,
  evidence: ['usb:0x093b:0x093b', 'driver:sato'],
  ambiguity: 'none' | 'model-unclear' 'multiple-matches',
  requiresManualConfirmation: boolean
}
```

### Detection Logic

1. Try USB VID/PID matching against registry
2. If match found → return with appropriate confidence
3. If no USB match → try OS printer name pattern matching
4. If OS name matches known pattern → return with lower confidence
5. If nothing matches → return with `requiresManualConfirmation: true`

### Never silently choose incompatible adapter

Detection result ALWAYS includes:
- `confidence` level
- `requiresManualConfirmation` flag
- `evidence` list of what was matched
- `adapter` recommendation (not mandate)

User/UI must explicitly confirm before using recommended adapter for ambiguous cases.