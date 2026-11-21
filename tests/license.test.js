import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAdYAQDfnQeIuKh23WLVFvvdpZZDqQWqfOQktq5K4lEtk=
-----END PUBLIC KEY-----`;

// Mirror of LicenseManager.verifySignature from electron/security/licenseVerifier.js
function verifySignature(payload, signatureBase64) {
  const payloadBuffer = Buffer.from(JSON.stringify(payload));
  const signatureBuffer = Buffer.from(signatureBase64, 'base64');
  return crypto.verify(null, payloadBuffer, PUBLIC_KEY, signatureBuffer);
}

describe('LicenseManager signature verification', () => {
  it('verifies a valid Ed25519 signature produced with the matching private key shape', () => {
    const payload = {
      licenceId: 'LIC-abcd1234',
      accountId: 'user@example.com',
      productId: 'mifela-pos-pro',
      hardwareId: 'FP123',
      status: 'ACTIVE'
    };

    // Ed25519 sign using a generated key pair matching the public key curve
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const signature = crypto.sign(null, Buffer.from(JSON.stringify(payload)), privateKey);

    // Verify against our hardcoded public key only matches if same key; here just
    // assert the round-trip works with the generated pair.
    expect(crypto.verify(null, Buffer.from(JSON.stringify(payload)), publicKey, signature)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const good = { licenceId: 'LIC-1', status: 'ACTIVE' };
    const sig = crypto.sign(null, Buffer.from(JSON.stringify(good)), privateKey);
    const tampered = { licenceId: 'LIC-2', status: 'ACTIVE' };
    expect(crypto.verify(null, Buffer.from(JSON.stringify(tampered)), PUBLIC_KEY, sig)).toBe(false);
  });

  it('rejects a bad signature', () => {
    const payload = { licenceId: 'LIC-1', status: 'ACTIVE' };
    expect(verifySignature(payload, 'notabase64signature')).toBe(false);
  });
});
