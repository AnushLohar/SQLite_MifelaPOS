# Roadmap: Mifela POS

## Phase 1 — Hardening & Security Fixes

**Goal:** Close the highest-severity gaps identified in the codebase map (CONCERNS.md H1/H2, M1-M3, L2) without adding features.

**Requirements covered:** SEC-01, SEC-02, SEC-03, COR-01, COR-02, ACC-01

**Tasks:**
1. Tighten CSP in `index.html` — remove `unsafe-inline` from script-src/style-src (use nonces/hashes for required inline scripts)
2. `db:executeBatch` — deny writes to `licence_data`/`security_config`; validate allowed columns per table
3. `db:processSale` — add stock-availability guard; abort transaction if `stockLevel < item.quantity`
4. DB read handlers — return `{ success, data, error }` instead of masking errors as `[]`/`null`
5. Resolve user role from authenticated session instead of client-controlled localStorage

**Definition of done:** All 6 v1 requirements marked Complete, tests added for `controllers.js` write paths, app builds and starts.

## Phase 2 — (Future)

TBD after Phase 1 verification. Candidates: database encryption at rest, formal migration versioning, automated test expansion.

### Phase 1: Phase 1 — Hardening & Security Fixes

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Nothing
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 1 to break down)

---

*Roadmap created: 2026-11-21 after gsd-onboard*
