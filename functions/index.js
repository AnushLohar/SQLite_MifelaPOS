const functions = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const cors = require('cors')({ origin: true });

const RZP_WEBHOOK_SECRET = defineSecret('RAZORPAY_WEBHOOK_SECRET');

functions.setGlobalOptions({ region: "asia-south1", maxInstances: 100, secrets: ["LICENSING_PRIVATE_KEY"] });

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

/**
 * 1. Razorpay Webhook Handler
 * Idempotent, secure endpoint that updates Firestore when payment is captured.
 */
exports.razorpayWebhook = onRequest({
    region: 'asia-south1',
    secrets: [RZP_WEBHOOK_SECRET]
}, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const secret = RZP_WEBHOOK_SECRET.value();
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) return res.status(401).send('Missing signature');

    // 1. Verify Webhook Signature using raw body with timing-safe comparison
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(req.rawBody)
        .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))) {
      console.error('Invalid Razorpay Signature');
      return res.status(401).send('Invalid signature');
    }

    const event = req.body;
    const eventId = req.headers['x-razorpay-event-id'];

    try {
        // 2. Idempotency Check using Firestore Transactions
        await db.runTransaction(async (transaction) => {
            const eventRef = db.collection('razorpayWebhookEvents').doc(eventId);
            const eventDoc = await transaction.get(eventRef);

            if (eventDoc.exists) {
                console.log(`Event ${eventId} already processed. Skipping.`);
                return; // Duplicate webhook, exit cleanly
            }

            // Mark event as processed
            transaction.set(eventRef, { processedAt: admin.firestore.FieldValue.serverTimestamp(), type: event.event });

            if (event.event === 'payment.captured' || event.event === 'order.paid') {
                const paymentData = event.payload.payment.entity;
                const orderId = paymentData.order_id;

                // Assuming you pass hardware fingerprint in notes during order creation
                const fingerprint = paymentData.notes?.fingerprint || 'UNKNOWN';
                const userEmail = paymentData.email;
                const rzpPaymentId = paymentData.id;

                // 3. Also record lookup from payment_id -> orderId in dedicated collection
                const paymentIdLookupRef = db.collection('paymentsByPaymentId').doc(rzpPaymentId);
                transaction.set(paymentIdLookupRef, {
                    orderId: orderId,
                    paymentId: rzpPaymentId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                // 4. Update Central Payment Ledger
                const paymentRef = db.collection('payments').doc(orderId);
                transaction.set(paymentRef, {
                    razorpayPaymentId: rzpPaymentId,
                    razorpayOrderId: orderId,
                    amount: paymentData.amount / 100, // Convert paise to currency
                    currency: paymentData.currency,
                    paymentStatus: 'PAID',
                    subscriptionStatus: 'ACTIVE',
                    licenceStatus: 'VALID',
                    paidAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    fingerprint: fingerprint,
                    email: userEmail
                }, { merge: true });

                // 5. Expose payment_id -> orderId lookup for refund revocation
                if (rzpPaymentId && rzpPaymentId !== 'UNKNOWN') {
                    await transaction.set(db.collection('provisioned_nodes').doc(fingerprint), {
                        status: 'ACTIVE',
                        paymentToken: rzpPaymentId,
                        lastVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
                        nextVerificationDue: admin.firestore.Timestamp.fromDate(new Date()),
                        subscriptionExpiry: null,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                }
            } else if (event.event === 'refund.processed') {
                // Handle Refund logic (revoke license)
                const paymentId = event.payload.refund.entity.payment_id;

                // 1. First, try to find the order_id via the payment_id lookup
                const lookupRef = db.collection('paymentsByPaymentId').doc(paymentId);
                const lookupDoc = await transaction.get(lookupRef);

                if (lookupDoc.exists) {
                    const orderId = lookupDoc.data().orderId;

                    // 2. Fetch the payment record via the known order_id
                    const paymentSnap = await db.collection('payments').doc(orderId).get();

                    if (paymentSnap.exists) {
                        const fingerprint = paymentSnap.data().fingerprint;

                        // Revoke the payment record
                        await transaction.update(db.collection('payments').doc(orderId), {
                            paymentStatus: 'REFUNDED',
                            licenceStatus: 'REVOKED',
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        });

                        // 3. Revoke the node's license if fingerprint is known
                        if (fingerprint && fingerprint !== 'UNKNOWN') {
                            const nodeRef = db.collection('provisioned_nodes').doc(fingerprint);
                            await transaction.update(nodeRef, {
                                status: 'REVOKED',
                                updatedAt: admin.firestore.FieldValue.serverTimestamp()
                            });
                        }

                        console.log(`Refund processed: revoked license for node ${fingerprint}, payment ${paymentId} -> order ${orderId}`);
                    } else {
                        console.error(`Payment record not found for order ${orderId} during refund revocation`);
                    }
                } else {
                    // No lookup entry found — try direct order_id lookup as fallback (old path)
                    const paymentRef = db.collection('payments').doc(paymentId);
                    const paymentSnap = await paymentRef.get();

                    if (paymentSnap.exists) {
                        const fingerprint = paymentSnap.data().fingerprint;

                        // Revoke the payment record
                        await transaction.update(paymentRef, {
                            paymentStatus: 'REFUNDED',
                            licenceStatus: 'REVOKED',
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        });

                        // 3. Revoke the node's license if fingerprint is known
                        if (fingerprint && fingerprint !== 'UNKNOWN') {
                            const nodeRef = db.collection('provisioned_nodes').doc(fingerprint);
                            await transaction.update(nodeRef, {
                                status: 'REVOKED',
                                updatedAt: admin.firestore.FieldValue.serverTimestamp()
                            });
                        }

                        console.log(`Refund processed (fallback path): revoked license for node ${fingerprint}, payment ${paymentId}`);
                    } else {
                        console.error(`No payment record found for payment_id ${paymentId} — cannot revoke license. Silent failure avoided.`);
                    }
                }
            }
        });

        res.status(200).send({ status: 'ok' });
    } catch (error) {
        console.error('Webhook processing failed:', error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * 2. Order Status Poller (Used by Gateway / Electron setup phase)
 */
exports.checkOrderStatus = functions.https.onRequest((req, res) => {
    cors(req, res, async () => {
        const orderId = req.query.orderId;
        if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

        try {
            const paymentDoc = await db.collection('payments').doc(orderId).get();

            if (!paymentDoc.exists) {
                return res.status(404).json({ success: false, status: 'PENDING', message: 'Order not found or payment pending' });
            }

            const data = paymentDoc.data();

            return res.status(200).json({
                success: true,
                orderId: data.razorpayOrderId,
                paymentId: data.razorpayPaymentId,
                paymentStatus: data.paymentStatus,
                subscriptionStatus: data.subscriptionStatus,
                licenceStatus: data.licenceStatus,
                paidAt: data.paidAt ? data.paidAt.toDate().toISOString() : null,
                signature: 'verified-by-backend' // Tells frontend not to await Razorpay signature
            });

        } catch (error) {
            console.error('Check order failed:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
});

/**
 * 4. Node Activation (Called after verified Razorpay payment during setup)
 * Verifies payment was received for this node, then marks it ACTIVE so the
 * terminal can generate its local license. Only payment-verified nodes activate.
 *
 * FIXED: Uses onRequest with CORS for standard HTTP POST (not onCall).
 * - Accepts identifier from: hardwareFingerprint, hardwareId, fingerprint, or data.hardwareFingerprint
 * - Returns 200 OK with complete response matching client expectations
 * - Checks status === "PAID" (and accepts ACTIVE/VERIFIED as success)
 * - Updates document with verified markers on successful verification
 * - Returns: verificationToken, paymentToken, paymentId, hardwareFingerprint, hardwareId, amountPaid, email
 */
exports.verifyNodeActivation = onRequest({
    cors: true,
    region: 'asia-south1',
    secrets: ['LICENSING_PRIVATE_KEY']
}, async (req, res) => {
    try {
        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
            return res.status(204).send('');
        }

        // Only accept POST
        if (req.method !== 'POST') {
            return res.status(405).json({ success: false, error: 'Method not allowed' });
        }

        const body = req.body || {};

        // Normalize accepted payload keys
        const fingerprint = body.hardwareFingerprint
            || body.hardwareId
            || body.fingerprint
            || body.node
            || (body.data && (body.data.hardwareFingerprint || body.data.hardwareId || body.data.fingerprint || body.data.node));

        const email = body.email || (body.data && body.data.email) || '';

        if (!fingerprint) {
            console.error('verifyNodeActivation: Missing fingerprint in request body:', JSON.stringify(body));
            return res.status(400).json({
                success: false,
                error: 'Missing hardwareFingerprint (expected: hardwareFingerprint, hardwareId, fingerprint, or node)'
            });
        }

        // Look up node by document ID first
        let nodeSnap = await db.collection('provisioned_nodes').doc(fingerprint).get();

        // FALLBACK: If doc doesn't exist by ID, query by hardwareFingerprint field
        if (!nodeSnap.exists) {
            try {
                const { collection, query, where, getDocs } = require('firebase/firestore');
                const nodeQuery = query(
                    collection(db, 'provisioned_nodes'),
                    where('hardwareFingerprint', '==', fingerprint)
                );
                const snapshot = await getDocs(nodeQuery);
                if (!snapshot.empty) {
                    nodeSnap = snapshot.docs[0];
                }
            } catch (e) {
                console.error('Fallback field query failed:', e.message);
            }
        }

        if (!nodeSnap || !nodeSnap.exists) {
            // DOCUMENT NOT FOUND — Return 200 with clear message
            console.log('Node not found in provisioned_nodes:', fingerprint);
            return res.status(200).json({
                success: true,
                verified: false,
                status: 'NOT_REGISTERED',
                message: 'Node not registered. Complete payment first.',
                paymentExists: await _paymentExistsForFingerprint(fingerprint)
            });
        }

        const nodeData = nodeSnap.data();
        const nodeRef = nodeSnap.ref;
        const status = nodeData.status || 'UNKNOWN';

        // FIXED: Check status === "PAID" instead of strict ACTIVE match
        // Accept PAID, ACTIVE, or VERIFIED as payment confirmed
        const isPaid = status === 'PAID' || status === 'ACTIVE' || status === 'VERIFIED';

        if (!isPaid) {
            console.log('Node status is:', status, '— payment not detected/incomplete');
            return res.status(200).json({
                success: true,
                verified: false,
                status: 'PENDING',
                message: `Payment not detected or incomplete. Current status: ${status}`,
                paymentData: _extractPaymentData(nodeData)
            });
        }

        // Payment confirmed — mark as fully verified
        await nodeRef.update({
            verified: true,
            verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            terminalActivated: true
        });

        // Return complete response matching client expectations
        return res.status(200).json({
            success: true,
            verified: true,
            status: 'VERIFIED',
            message: 'Payment verified successfully',
            verificationToken: nodeData.verificationToken || 'AUTO_VERIFIED',
            paymentToken: nodeData.paymentToken || 'AUTO_PROVISIONED',
            paymentId: nodeData.paymentId || null,
            hardwareFingerprint: fingerprint,
            hardwareId: fingerprint,
            amountPaid: nodeData.amountPaid || null,
            email: nodeData.email || email
        });
    } catch (err) {
        console.error('verifyNodeActivation error:', err);
        return res.status(500).json({
            success: false,
            verified: false,
            error: err.message || 'Internal server error'
        });
    }
});

// Helper: Check if payment record exists for this fingerprint (for debugging)
async function _paymentExistsForFingerprint(fingerprint) {
    try {
        // Query payments collection for any payment linked to this fingerprint
        const payments = await db.collection('payments')
            .where('fingerprint', '==', fingerprint)
            .limit(1)
            .get();

        return !payments.empty;
    } catch (e) {
        console.error('Payment lookup failed:', e);
        return false;
    }
}

// Helper: Extract payment-related data for clearer error messages
function _extractPaymentData(nodeData) {
    return {
        paymentToken: nodeData.paymentToken || null,
        amountPaid: nodeData.amountPaid || null,
        createdAt: nodeData.createdAt?.toDate?.().toISOString() || null,
        lastVerifiedAt: nodeData.lastVerifiedAt?.toDate?.().toISOString() || null
    };
}

/**
 * 3. Secure Node Verification (Called silently by Electron Background Sync)
 */
exports.verifyNodeLicense = functions.https.onCall(async (request) => {
    const { fingerprint } = request.data;
    if (!fingerprint) throw new functions.https.HttpsError('invalid-argument', 'Missing fingerprint');

    const nodeDoc = await db.collection('provisioned_nodes').doc(fingerprint).get();
    if (!nodeDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Node not registered');
    }

    const nodeData = nodeDoc.data();

    // Enforce Revocations / Expirations based strictly on Firestore
    if (nodeData.status === 'REVOKED' || nodeData.status === 'REFUNDED') {
        throw new functions.https.HttpsError('permission-denied', 'License has been revoked');
    }

    if (nodeData.subscriptionExpiry && nodeData.subscriptionExpiry.toDate() < new Date()) {
        throw new functions.https.HttpsError('permission-denied', 'Subscription expired');
    }

    // Push verification deadline forward 30 days
    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + 30);

    // 1. Generate cryptographic payload
    const payload = {
        licenceId: `LIC-${fingerprint.substring(0, 8)}`,
        accountId: nodeData.email,
        productId: 'mifela-pos-pro',
        hardwareId: fingerprint,
        activationDate: nodeData.createdAt ? nodeData.createdAt.toDate().toISOString() : new Date().toISOString(),
        lastVerification: new Date().toISOString(),
        nextVerificationDue: nextDue.toISOString(),
        status: 'ACTIVE'
    };

    // 2. Sign payload with server's Private Key
    // We sign BEFORE updating the database to ensure we don't mark a node verified if signing fails
    // Normalize key: handle both escaped \n and actual newlines, ensure PEM headers
    let privateKey = process.env.LICENSING_PRIVATE_KEY || '';
    privateKey = privateKey.replace(/\\n/g, '\n').trim();
    if (!privateKey.includes('-----BEGIN')) {
        privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
    }
    const signatureBase64 = crypto.sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString('base64');

    // 3. Persist the verification event
    await nodeDoc.ref.update({
        lastVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        nextVerificationDue: admin.firestore.Timestamp.fromDate(nextDue)
    });

    return { success: true, payload, signature: signatureBase64 };
});

/**
 * 5. Resolve Customer by Device Fingerprint
 * Called from the renderer during setup to auto-populate store details
 * when the device is already registered in provisioned_nodes.
 */
exports.resolveCustomerByDevice = functions.https.onCall(async (request) => {
    const { fingerprint } = request.data;
    if (!fingerprint) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing fingerprint');
    }

    const nodeDoc = await db.collection('provisioned_nodes').doc(fingerprint).get();

    if (!nodeDoc.exists) {
        return { found: false };
    }

    const nodeData = nodeDoc.data();

    // Build the identity / store / subscription / license objects the client expects
    const identity = {
        email: nodeData.email || null,
        ownerName: nodeData.ownerName || null,
        contact: nodeData.contact || nodeData.phone || null,
    };

    const store = {
        storeName: nodeData.storeName || null,
        address: nodeData.address || null,
        state: nodeData.state || null,
        gstin: nodeData.gstin || nodeData.taxId || null,
        currency: nodeData.currency || 'INR',
        taxRate: nodeData.taxRate !== undefined ? nodeData.taxRate : null,
    };

    const subscription = {
        status: nodeData.status || 'UNKNOWN',
        paymentToken: nodeData.paymentToken || null,
        subscriptionExpiry: nodeData.subscriptionExpiry
            ? nodeData.subscriptionExpiry.toDate().toISOString()
            : null,
    };

    const license = {
        status: nodeData.status || 'UNKNOWN',
        lastVerifiedAt: nodeData.lastVerifiedAt
            ? nodeData.lastVerifiedAt.toDate().toISOString()
            : null,
        nextVerificationDue: nodeData.nextVerificationDue
            ? nodeData.nextVerificationDue.toDate().toISOString()
            : null,
    };

    return {
        found: true,
        customerId: fingerprint,
        identity,
        store,
        subscription,
        license,
    };
});
