// electron/security/licenseVerifier.js
import crypto from 'crypto';

// This key is safe to ship in the client. The private key remains on your server.
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAX...[INSERT_YOUR_ED25519_PUBLIC_KEY_HERE]...
-----END PUBLIC KEY-----`;

export class LicenseManager {
    static verifySignature(payload, signatureBase64) {
        try {
            const payloadBuffer = Buffer.from(JSON.stringify(payload));
            const signatureBuffer = Buffer.from(signatureBase64, 'base64');

            // Verify Ed25519 signature
            return crypto.verify(null, payloadBuffer, PUBLIC_KEY, signatureBuffer);
        } catch (error) {
            console.error('Signature verification failed:', error);
            return false;
        }
    }
}