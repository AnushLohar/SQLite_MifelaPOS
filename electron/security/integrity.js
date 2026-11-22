// App integrity verification — makes the build harder to pirate by detecting
// tampering with critical Electron files (main.js, preload.js, license code).
// Critical files are hashed at build time and the manifest is compared at runtime.
// Any mismatch means the app was patched/cracked and refuses to start.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { app } = require('electron');

// Canonical set of files whose modification would disable licensing.
const CRITICAL_FILES = [
  'main.js',
  'preload.js',
  'database/controllers.js',
  'database/knex.js',
  'security/licenseVerifier.js',
  'security/fingerprint.js',
  'services/LicenceStateManager.js',
  'services/BackgroundVerificationScheduler.js',
];

// Path (relative to the app root) where the integrity manifest lives.
// Generated at build time: `node scripts/generate-integrity-manifest.js > electron/dist/integrity-manifest.json`
const MANIFEST_RELATIVE = path.join('dist', 'integrity-manifest.json');

export function loadIntegrityManifest() {
  try {
    const appPath = app.getAppPath();
    const manifestPath = path.join(appPath, MANIFEST_RELATIVE);
    if (!fs.existsSync(manifestPath)) return null;
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

export function computeFileHash(relativePath) {
  try {
    const appPath = app.getAppPath();
    const fullPath = path.join(appPath, relativePath);
    if (!fs.existsSync(fullPath)) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
  } catch {
    return null;
  }
}

export function verifyAppIntegrity() {
  const manifest = loadIntegrityManifest();
  if (!manifest || !manifest.files) {
    // No manifest (dev mode) — skip check but log.
    console.warn('[integrity] No integrity manifest found; skipping app integrity check.');
    return { ok: true, reason: 'no_manifest' };
  }

  const tampered = [];
  for (const rel of CRITICAL_FILES) {
    const actual = computeFileHash(rel);
    const expected = manifest.files[rel];
    if (!expected) {
      tampered.push({ file: rel, reason: 'missing_from_manifest' });
      continue;
    }
    if (actual !== expected) {
      tampered.push({ file: rel, reason: 'hash_mismatch' });
    }
  }

  if (tampered.length > 0) {
    console.error('[integrity] TAMPER DETECTED:', tampered);
    return { ok: false, tampered };
  }

  return { ok: true };
}
