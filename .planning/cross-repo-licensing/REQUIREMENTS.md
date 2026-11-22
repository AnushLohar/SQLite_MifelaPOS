# Requirements: Cross-Repo Perpetual Licensing

**Defined:** 2026-11-21  
**Core Value:** Secure, perpetual single-PC activation that works offline and coexists with subscriptions.

## v1 Requirements

### Licensing & Entitlement
- [ ] **LIC-01**: One-time purchase grants lifetime usage rights (no auto-expiry).
- [ ] **LIC-02**: One perpetual entitlement limits active use to exactly ONE registered PC.
- [ ] **LIC-03**: Reinstallation on the same PC (same fingerprint) must be free and automatic.
- [ ] **LIC-04**: Device replacement requires an explicit, server-authorized license transfer.
- [ ] **LIC-05**: Existing subscription plans must continue operating in parallel without modification.

### Security & Cryptography
- [ ] **SEC-01**: License payload signed using Ed25519 (private key in Firebase Secrets, public key in Electron).
- [ ] **SEC-02**: Razorpay payment verification must be server-authoritative (webhooks + signature check).
- [ ] **SEC-03**: Payment-to-license pipeline must be idempotent (duplicate webhooks ignored).
- [ ] **SEC-04**: Electron IPC boundaries must not trust renderer-provided license status.

### Offline Operation
- [ ] **OFF-01**: MifelaPOS verifies Ed25519 license locally without contacting the server.
- [ ] **OFF-02**: Offline sales continue without interruption.
- [ ] **OFF-03**: Re-verification/revocation checks sync silently when network is restored.

---
*Created: 2026-11-21*
