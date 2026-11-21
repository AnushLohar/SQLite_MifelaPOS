import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

// Mirrors client electron/security/licenseVerifier.js
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAdYAQDfnQeIuKh23WLVFvvdpZZDqQWqfOQktq5K4lEtk=
-----END PUBLIC KEY-----`;

function clientVerify(payload, signatureBase64) {
  const payloadBuffer = Buffer.from(JSON.stringify(payload));
  const signatureBuffer = Buffer.from(signatureBase64, 'base64');
  return crypto.verify(null, payloadBuffer, PUBLIC_KEY, signatureBuffer);
}

describe('Server->client signature interop', () => {
  it('signs with Ed25519 (algorithm null) and verifies on client', () => {
    const payload = {
      licenceId: 'LIC-abcd1234',
      accountId: 'user@example.com',
      productId: 'mifela-pos-pro',
      hardwareId: 'FP123',
      status: 'ACTIVE'
    };

    const kp = crypto.generateKeyPairSync('ed25519');
    const signature = crypto.sign(null, Buffer.from(JSON.stringify(payload)), kp.privateKey).toString('base64');

    // Same-key round-trip must pass
    expect(crypto.verify(null, Buffer.from(JSON.stringify(payload)), kp.publicKey, Buffer.from(signature, 'base64'))).toBe(true);

    // Tampered payload must fail verification
    const tampered = { ...payload, status: 'REVOKED' };
    expect(crypto.verify(null, Buffer.from(JSON.stringify(tampered)), kp.publicKey, Buffer.from(signature, 'base64'))).toBe(false);
  });
});
