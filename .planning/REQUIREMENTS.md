# Requirements: Mifela POS

**Defined:** 2026-11-21
**Core Value:** A reliable, offline-capable POS terminal that a small retailer can run all day without internet, with licensing that binds the terminal to a specific machine.

## v1 Requirements

Requirements for the current hardening scope. Each maps to a roadmap phase.

### Security

- [ ] **SEC-01**: CSP in `index.html` removes `unsafe-inline` from script-src and style-src
- [ ] **SEC-02**: `db:executeBatch` rejects writes to `licence_data` and `security_config` from the renderer
- [ ] **SEC-03**: `db:executeBatch` validates allowed columns per table before writing

### Correctness

- [ ] **COR-01**: `db:processSale` aborts when `stockLevel < item.quantity` (no negative stock)
- [ ] **COR-02**: DB read handlers return structured `{ success, data, error }` instead of masking errors as `[]`/`null`

### Access Control

- [ ] **ACC-01**: User role resolved from authenticated session, not client-controlled localStorage

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Database

- **DB-01**: Encrypt SQLite database file at rest
- **DB-02**: Add formal migration versioning table

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time multi-terminal sync | Single-terminal POS by design |
| Mobile app / web portal | Desktop Electron only |
| OAuth / social login | Email/password (Firebase + local bcrypt) sufficient |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1 | Pending |
| SEC-02 | Phase 1 | Pending |
| SEC-03 | Phase 1 | Pending |
| COR-01 | Phase 1 | Pending |
| COR-02 | Phase 1 | Pending |
| ACC-01 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 6 total
- Mapped to phases: 6
- Unmapped: 0 ✓

---
*Requirements defined: 2026-11-21*
*Last updated: 2026-11-21 after initial definition*
