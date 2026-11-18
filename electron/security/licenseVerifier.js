// security/licenseVerifier.js
import crypto from 'crypto';
import { getHardwareFingerprint } from './fingerprint.js';
import { getKnex } from '../database/knex.js';

export class LicenseManager {
    static generateAndStoreKeys(email, storeName) {
        const fingerprint = getHardwareFingerprint();

        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });

        const aesKey = Buffer.from(fingerprint.substring(0, 64), 'hex');
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);

        let encryptedPrivateKey = cipher.update(privateKey, 'utf8', 'base64');
        encryptedPrivateKey += cipher.final('base64');
        const authTag = cipher.getAuthTag().toString('base64');

        const secureStorageString = JSON.stringify({
            iv: iv.toString('base64'),
            data: encryptedPrivateKey,
            tag: authTag
        });

        const nextDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const knex = getKnex();
        knex('security_config')
            .insert({
                id: 'SYSTEM_LICENSE',
                email,
                storeName,
                encryptedPrivateKey: secureStorageString,
                publicKey,
                nextVerificationDate: nextDate
            })
            .onConflict('id')
            .merge();

        return { publicKey, email, storeName, fingerprint };
    }

    static async verifyLocalState() {
        try {
            const knex = getKnex();
            const record = await knex('security_config')
                .select('*')
                .where({ id: 'SYSTEM_LICENSE' })
                .first();

            if (!record) return { status: 'UNPROVISIONED' };

            const now = new Date();
            const nextVerif = new Date(record.nextVerificationDate);

            if (now > nextVerif) {
                return { status: 'VERIFICATION_REQUIRED', payload: record };
            }

            return { status: 'ACTIVE', payload: record };
        } catch (e) {
            return { status: 'DATABASE_ERROR', message: e.message };
        }
    }

    // 🚀 FIX: Accept passed hardware fingerprint from main process
    static async executeChallenge(challengeHex, currentHardwareFingerprint) {
        const knex = getKnex();
        const record = await knex('security_config')
            .select('encryptedPrivateKey')
            .where({ id: 'SYSTEM_LICENSE' })
            .first();

        if (!record) throw new Error("No secure keys found in enclave.");

        // 1. Decrypt Private Key using the exact fingerprint passed from main process
        const aesKey = Buffer.from(currentHardwareFingerprint.substring(0, 64), 'hex');
        const parsed = JSON.parse(record.encryptedPrivateKey);

        let privateKeyPem;
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(parsed.iv, 'base64'));
            decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));

            privateKeyPem = decipher.update(parsed.data, 'base64', 'utf8');
            privateKeyPem += decipher.final('utf8');
        } catch (e) {
            throw new Error("Local hardware signature failed. Possible clone.");
        }

        // 2. Sign Challenge Array
        const sign = crypto.createSign('SHA256');
        sign.update(challengeHex);
        sign.end();

        return sign.sign(privateKeyPem, 'base64');
    }

    static async updateVerificationDate() {
        const nextDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const knex = getKnex();
        await knex('security_config')
            .where({ id: 'SYSTEM_LICENSE' })
            .update({ nextVerificationDate: nextDate });
        return true;
    }
}
