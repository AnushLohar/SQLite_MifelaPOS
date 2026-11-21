#!/usr/bin/env node
/**
 * migrate-provisioned-to-customers.js
 *
 * Migrates existing `provisioned_nodes` documents into the canonical
 * `customers/{customerId}` schema so the POSgateway bridge can resolve
 * identity, store, subscription and license from one document per customer.
 *
 * Usage:
 *   node scripts/migrate-provisioned-to-customers.js
 *
 * Environment:
 *   GOOGLE_APPLICATION_CREDENTIALS  — service account JSON (required)
 *   FIRESTORE_PROJECT_ID            — optional, defaults to firebase-admin
 *
 * Safety:
 *   - Dry-run by default. Pass --execute to write.
 *   - Idempotent: re-running is safe; existing customer docs are merged, not overwritten.
 *   - Never deletes source `provisioned_nodes` documents.
 */

'use strict';

const admin = require('firebase-admin');

const DRY_RUN = !process.argv.includes('--execute');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Build the canonical customer document from a provisioned_nodes record.
 * Preserves existing customer fields when a customer doc already exists.
 */
function buildCustomerDoc(nodeId, nodeData, existingCustomer) {
  const now = admin.firestore.FieldValue.serverTimestamp();

  const identity = {
    customerId: nodeData.email || nodeId,
    firebaseUid: nodeData.firebaseUid || null,
    email: nodeData.email || null,
    phone: nodeData.phone || nodeData.contact || null,
    name: nodeData.ownerName || nodeData.storeName || null,
    deviceFingerprint: nodeId
  };

  const store = {
    storeId: nodeData.storeId || 'LOCAL_NODE',
    storeName: nodeData.storeName || null,
    address: nodeData.address || null,
    state: nodeData.state || null,
    country: 'India',
    gstNumber: nodeData.gstin || nodeData.taxId || null,
    currency: nodeData.currency || 'INR'
  };

  const device = {
    primaryFingerprint: nodeId,
    registeredDevices: [nodeId],
    lastSeenAt: nodeData.updatedAt || now
  };

  const subscription = {
    planId: nodeData.planId || null,
    planName: nodeData.planName || 'LIFETIME LICENSE',
    status: nodeData.status === 'ACTIVE' ? 'ACTIVE' : (nodeData.status || 'INACTIVE'),
    startDate: nodeData.createdAt || null,
    expiryDate: nodeData.subscriptionExpiry || null,
    autoRenew: false
  };

  const payment = {
    gateway: 'razorpay',
    customerReference: nodeData.paymentId || null,
    lastPaymentId: nodeData.paymentId || null,
    lastOrderId: nodeData.razorpayOrderId || null,
    lastPaymentStatus: nodeData.status || null,
    lastPaymentAt: nodeData.updatedAt || null
  };

  const license = {
    licenseId: nodeData.verificationToken || `LIC-${nodeId.substring(0, 8)}`,
    status: nodeData.status === 'ACTIVE' ? 'ACTIVE' : (nodeData.status || 'INACTIVE'),
    machineFingerprint: nodeId,
    issuedAt: nodeData.createdAt || null,
    expiresAt: nodeData.subscriptionExpiry || null
  };

  const metadata = {
    createdAt: existingCustomer?.metadata?.createdAt || nodeData.createdAt || now,
    updatedAt: now,
    migratedFrom: 'provisioned_nodes',
    schemaVersion: 1
  };

  return {
    schemaVersion: 1,
    identity: { ...existingCustomer?.identity, ...identity },
    store: { ...existingCustomer?.store, ...store },
    device: { ...existingCustomer?.device, ...device },
    subscription: { ...existingCustomer?.subscription, ...subscription },
    payment: { ...existingCustomer?.payment, ...payment },
    license: { ...existingCustomer?.license, ...license },
    metadata
  };
}

async function migrate() {
  const snapshot = await db.collection('provisioned_nodes').get();
  const total = snapshot.size;

  console.log(`Found ${total} provisioned_nodes document(s).`);
  if (DRY_RUN) {
    console.log('DRY RUN — pass --execute to write changes.');
  }

  let migrated = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const nodeId = doc.id;
    const nodeData = doc.data();

    const customerId = nodeData.email || nodeId;
    const customerRef = db.collection('customers').doc(customerId);

    let existingCustomer = null;
    try {
      const existingSnap = await customerRef.get();
      if (existingSnap.exists) {
        existingCustomer = existingSnap.data();
      }
    } catch (e) {
      console.warn(`  ⚠️ Could not read existing customer ${customerId}:`, e.message);
    }

    const payload = buildCustomerDoc(nodeId, nodeData, existingCustomer);

    if (DRY_RUN) {
      console.log(`  [dry-run] ${nodeId} → customers/${customerId}`);
      migrated++;
      continue;
    }

    try {
      await customerRef.set(payload, { merge: true });
      console.log(`  ✅ Migrated ${nodeId} → customers/${customerId}`);
      migrated++;
    } catch (e) {
      console.error(`  ❌ Failed to migrate ${nodeId}:`, e.message);
      skipped++;
    }
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}, Total: ${total}`);
  if (DRY_RUN) {
    console.log('Re-run with --execute to apply changes.');
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});