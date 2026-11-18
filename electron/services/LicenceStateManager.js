// electron/services/LicenceStateManager.js
import { getKnex } from '../database/knex.js';
import { LicenseManager } from '../security/licenseVerifier.js';

export default class LicenceStateManager {
    static async evaluateCurrentState() {
        const db = getKnex(); // Retrieve the initialized database instance

        const licenceRecord = await db('licence_data').first();
        if (!licenceRecord) return 'UNACTIVATED';

        try {
            const payload = JSON.parse(licenceRecord.licence_payload);

            // 1. Check Cryptographic Integrity offline
            const isValid = LicenseManager.verifySignature(payload, licenceRecord.signature);
            if (!isValid) return 'INVALID';

            // 2. Check Remote Revocation & Expiry (synced in payload)
            if (payload.status === 'REVOKED') return 'REVOKED';
            if (payload.subscriptionExpiryDate && new Date() > new Date(payload.subscriptionExpiryDate)) {
                return 'EXPIRED';
            }

            // 3. Check 90-Day Offline Verification Deadline
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