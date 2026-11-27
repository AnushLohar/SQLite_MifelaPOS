// electron/services/LicenceStateManager.js
import { getKnex } from '../database/knex.js';
import { LicenseManager } from '../security/licenseVerifier.js';
import { getHardwareFingerprint } from '../security/fingerprint.js';

export default class LicenceStateManager {
    static async evaluateCurrentState() {
        const db = getKnex(); // Retrieve the initialized database instance

        const licenceRecord = await db('licence_data').first();
        if (!licenceRecord) return 'UNACTIVATED';

        try {
            const payload = JSON.parse(licenceRecord.licence_payload);

            // 1. Check Cryptographic Integrity offline (Ed25519 signature over the payload)
            const isValid = LicenseManager.verifySignature(payload, licenceRecord.signature);
            if (!isValid) return 'INVALID';

            // 2. Anti-tamper: the payload's hardwareId must bind to THIS machine.
            //    An attacker who copies licence_data to another terminal is rejected.
            const expectedFingerprint = getHardwareFingerprint();
            if (payload.hardwareId && payload.hardwareId !== expectedFingerprint) {
                return 'HARDWARE_MISMATCH';
            }

            // 3. Check Remote Revocation & Expiry (synced in payload)
            if (payload.status === 'REVOKED') return 'REVOKED';
            if (payload.subscriptionExpiryDate && new Date() > new Date(payload.subscriptionExpiryDate)) {
                return 'EXPIRED';
            }

            // 4. Check 30-Day Offline Verification Deadline
            const now = new Date();
            const nextDue = new Date(payload.nextVerificationDue);
            const daysUntilDue = (nextDue - now) / (1000 * 60 * 60 * 24);

            if (now > nextDue) return 'VERIFICATION_PENDING'; // App locked until online sync
            if (daysUntilDue <= 7) return 'VERIFICATION_DUE'; // App works, UI shows warnings

            return 'ACTIVE'; // Normal offline operation
        } catch (e) {
            return 'INVALID';
        }
    }
}