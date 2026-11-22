# Unified Roadmap — Mifela Perpetual Licensing Pivot

## Goal
Implement a Microsoft-style perpetual 1-PC licensing model (one-time purchase, device-bound, offline-first) while preserving existing parallel subscription logic.

## Phase 0 — Discovery (Complete)
- [x] Codebase mapping of `MifelaPOS` and `POSgateway`
- [x] Dependency mapping and gap analysis
- [x] Parallel architecture decision (coexistence of Subs and Perpetual)

## Phase 1 — Security & Backend Hardening (Target: POSgateway)
**Goal:** Shift payment verification to server-authoritative webhooks and secure the signing enclave.
- [ ] Implement Razorpay Webhook handler in Cloud Functions
- [ ] Signature verification using raw request body
- [ ] Idempotency logic for payment events
- [ ] Setup Ed25519 signing key in Firebase Secrets
- [ ] Implement `issuePerpetualLicense` function (Ed25519 signing)

## Phase 2 — App Hardening & Local Enforcement (Target: MifelaPOS)
**Goal:** Prepare the local application for Ed25519-signed device-bound licenses.
- [ ] Tighten Electron IPC boundaries (remove stubs)
- [ ] Update `LicenceStateManager` to support the new perpetual payload schema
- [ ] Implement Ed25519 verification using embedded public key
- [ ] Harden `createPrintWorker` and other renderer-facing APIs

## Phase 3 — Unified Entitlement Schema (Target: Firebase/Firestore)
**Goal:** Extend Firestore schema to support both models without data loss.
- [ ] Define `customers` document extensions (perpetual entitlements)
- [ ] Define `activations` collection (device registration history)
- [ ] Security rules for activation boundaries

## Phase 4 — Cross-Repo Integration & Lifecycle
**Goal:** End-to-end purchase and activation flow.
- [ ] Connect `MifelaPOS` activation UI to `POSgateway` activation endpoint
- [ ] Implement secure device transfer mechanism (backend-authorized)
- [ ] Implement offline-to-online reconciliation

## Phase 5 — Verification & Migration
**Goal:** Test both models in parallel and verify migration safety.
- [ ] E2E tests (Firebase Emulator + Razorpay Mock)
- [ ] Verify existing subscription renewal remains functional
- [ ] Rollback and backup procedures

---
*Roadmap created: 2026-11-21 after cross-repo audit*
