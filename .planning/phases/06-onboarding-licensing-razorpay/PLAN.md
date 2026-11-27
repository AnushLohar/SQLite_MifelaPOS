# Phase 6 — Signup → License Creation → ₹25,000 Razorpay Payment → Verification → Login

## Project
`/Users/anushlohar/Documents/BUZZ/mifela/SQLite_MifelaPOS copy`

## Current Baseline (Phase 6 starts from scratch; phases 1–5 already complete)

**Existing Architecture:**
- **License Verification**: `verifyLocalLicense()` in `src/services/auth.js` validates a signed JWT token against stored `mifela_sys_details`, hardware fingerprint, and identity. Returns `{ valid: true/false, reason }`.
- **Security State**: `window.electronAPI.getSecurityState()` returns `{ status: 'UNPROVISIONED' | 'VERIFICATION_REQUIRED' | 'ACTIVE' }`.
- **Onboarding Flow**: User enters license key → `executeSoftware(inputString)` → fetches via HTTPS → `verifyNodeActivation` cloud function → `electronAPI.provisionSecurity()` → `verifyLocalLicense()`.
- **Authentication**: `activateSoftware(inputString)` → fetch → provision → `verifyLocalLicense()` → `localStorage.setItem('mifela_local_user')`.
- **Existing Razorpay**: `checkout.js` Razorpay integration exists; license activation uses a cloud function path (one-time provisioning).

**What Needs to Change:**
We are adding a **new complete onboarding flow** for fresh accounts (no existing license). The flow is:

1. **Signup** → create pending account
2. **₹25,000 Razorpay Payment** → one-time payment tied to uid + storeId
3. **Verification → License Creation** → HMAC-SHA256 verification + webhook fallback → idempotent license mint
4. **Login → Offline POS Gate** → Firebase Auth + license check → offline cache

---

## Phase 6 Plan

### 1. Signup & Pending Account State

**Files**: `src/components/signup.js` (new), `src/store/state.js` (extend), `src/services/auth.js` (extend)

**Account Creation** (client-side):
- User fills: Store Name, Owner Name, Phone, Email, Password
- On submit: Create a `pending_payment` document in `licenses` collection with:
  - `uid`: Firebase Auth UID
  - `storeId`: auto-generated short ID (e.g., `STORE-xxxx`)
  - `status`: `pending_payment`
  - `plan`: `GOLD` (will become active after payment)
  - `createdAt`: server timestamp
  - `paymentDueAt`: 90 days from now (trial grace period)
  - `paymentCompleted`: `false`
  - `paymentId`: `null`
  - `paymentAttempts`: `0`
  - `securityQuarantine`: `""`

**UI Behavior**:
- After signup, UI immediately shows: "Account Created. Pending Payment Required. ₹25,000 to activate GOLD license."
- POS/Dashboard are **locked** until license becomes `active`.
- A "Go to Payment" button is shown.

**Backend (Cloud Functions)**:
- On `licenses/{docId}` creation (via `onCreate` trigger): nothing needed initially; client-side flow handles payment initiation.
- Key constraint: client cannot directly create licenses; only via the payment flow.

### 2. One-Time ₹25,000 Payment (Razorpay)

**Razorpay Order Creation** (Backend Cloud Function `createRazorpayOrder`):
- Accepts: `uid`, `storeId`, `callbackUrl` (optional)
- Returns: `razorpay_order_id`, `razorpay_key_id`
- Order amount: **2500000 paise** (= ₹25,000 INR)
- Currency: `INR`
- Receipt: `receipt_stationary_${storeId}`
- Payment Capturable: `automatic` (or manual if needed)
- Notes: `uid`, `storeId`, `plan: GOLD`

**Frontend Razorpay Checkout** (lazy-loaded):
- Only load Razorpay SDK when user clicks "Pay ₹25,000"
- Two paths:
  - **Electron Modal**: Use `window.open()` with `Razorpay Checkout` sandbox, or embed via `razorpayjs` in a modal dialog
  - **External Browser Handoff**: `window.open(razorpayUrl, '_blank')` — user completes payment in browser, then returns to app
- On payment success, Razorpay SDK fires `razorpay_payment_verified` event (or we listen to `window.electronAPI.razorpayPaymentVerified`)

**Idempotency Key**:
- Each order uses `receipt_id` + `uid` + `storeId` as natural dedup.
- Backend stores `paymentsByPaymentId/{paymentId}` → `{ uid, storeId, status: 'minted' | 'pending' }` so duplicate webhooks never mint duplicate licenses.

### 3. Tamper-Proof Verification & License Creation

**Flow**:

1. **Frontend** receives Razorpay payment success event → immediately calls `window.electronAPI.provisionSecurity({ email, storeName })` (same path as existing activation).
2. **Cloud Function `verifyNodeActivation`**:
   - Verifies `HMAC-SHA256(razorpay_order_id + "|" + razorpay_payment_id, RAZORPAY_KEY_SECRET)` against stored secret
   - Checks `paymentsByPaymentId/{paymentId}` → if already `minted`, return `409 Conflict` (duplicate).
   - If not minted: mark `paymentsByPaymentId/{paymentId}` = `minted`, bind to `storeId`, set plan to `GOLD`, update license status to `active`.
   - Returns signed JWT token with: `accountId`, `storeId`, `expiresAt` (90 days from now, renewable), `fingerprint` (hardware ID), `email`.
3. **Client Side** (`activateSoftware`):
   - On success: `window.electronAPI.provisionSecurity()` → local `verifyLocalLicense()` → `localStorage.setItem('mifela_local_user')`.
   - On failure: show error; user may retry payment or use webhook fallback.

**Webhook Fallback** (if internet drops after paying):
- Razorpay sends `payment.captured` / `order.paid` webhook to our Cloud Function endpoint.
- Same `verifyNodeActivation` logic runs, checks `paymentsByPaymentId`, mints license if not already done.
- Client, on next startup, checks `verifyLocalLicense()` → if `valid`, proceeds to POS.

**Security Rules (`firestore.rules`)**:
```javascript
// ⛔️ Clients MUST NOT write to these paths
// All writes go through Cloud Functions only

// Licenses collection — never writable by clients
licenses: { .write: false }

// Payments collection — never writable by clients  
payments: { .write: false }

// Idempotency index — never writable by clients
paymentsByPaymentId: { .write: false }

// ✅ Read access for authenticated users
licenses: { .read: "auth != null" }
payments: { .read: "auth != null" }
paymentsByPaymentId: { .read: "auth != null" }
```

### 4. Login & Offline POS Gate

**Login Flow**:
1. User enters email/phone + password → Firebase Auth `signInWithEmailAndPassword`.
2. On success, immediately call `verifyLocalLicense()`.
3. If `valid`: `localStorage.setItem('mifela_local_user')` → redirect to POS/Dashboard.
4. If `invalid`: show "License Required. Activate now?" → opens activation panel.

**Offline POS Grace Period**:
- After first activation, license metadata is cached locally.
- If internet drops: `verifyLocalLicense()` still validates the **local JWT** against stored `mifela_sys_details` + hardware fingerprint.
- Grace period: 90 days from activation (configurable); after that, re-verification needed when online.

### 5. File Changes Summary

| File | Action |
|------|--------|
| `src/components/signup.js` | **New** — signup UI + pending account creation |
| `src/services/auth.js` | **Extend** — add `startOnboarding()`, handle payment verification path |
| `src/store/state.js` | **Extend** — add `pendingPaymentDueAt`, `isLicensed` getters |
| `src/utils/print.js` | May need minor tweaks for receipt printing Razorpay callback |
| `src/functions/` (Cloud Functions) | **New** — `createRazorpayOrder`, `verifyNodeActivation`, `handleRazorpayWebhook` |
| `firestore.rules` | **Update** — lock down `licenses`, `payments`, `paymentsByPaymentId` |
| `index.html` | **Add** — Razorpay SDK lazy-load script tag |
| `src/components/subscription.js` (if exists) | **Update** — reference new signup flow |

### 6. Open Questions / Decisions

1. **Razorpay Hosting**: Should we use Electron modal or external browser? Recommend external browser for simplicity + reliability, with Electron modal as optional fallback.
2. **License Key Format**: `MIFELA-XXXX-XXXX-XXXX` (8 chars each, base64-like, case-insensitive). Generated via `randomBytes(12).toString('hex').match(/.{8}-{1}/g).join('-')`.
3. **Grace Period**: 90 days from license activation. After that, `verifyLocalLicense()` returns `EXPIRED` until re-verification online.
4. **Device Limits**: Optional — `license.maxDevices` (e.g., `1` for single-terminal, `unlimited`). Enforced in `verifyLocalLicense()` fingerprint check.

### 7. Next Steps (After Plan Review)

1. Create `src/components/signup.js` with account creation UI + pending document write.
2. Create Cloud Functions: `createRazorpayOrder`, `verifyNodeActivation`, `handleRazorpayWebhook`.
3. Update `firestore.rules` to lock down client writes.
4. Add Razorpay SDK script to `index.html` (lazy-loaded).
5. Extend `src/services/auth.js` with `startOnboarding()` and payment verification path.
6. Test end-to-end: signup → payment → license → login → POS access.