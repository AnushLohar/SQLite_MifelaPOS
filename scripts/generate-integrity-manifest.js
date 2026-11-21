// Build-time script: generates an integrity manifest for critical Electron files.
// Run this after building (e.g. after `npm run build` + obfuscation) and before
// packaging:
//   node scripts/generate-integrity-manifest.js
//
// It hashes every file listed in CRITICAL_FILES under the app root and writes
// electron/dist/integrity-manifest.json, which verifyAppIntegrity() compares
// at runtime to detect tampering / cracking.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const APP_ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'electron'));

const CRITICAL_FILES = [
  'main.js',
  'preload.js',
  'database/controllers.js',
  'database/knex.js',
  'security/licenseVerifier.js',
  'security/fingerprint.js',
  'security/integrity.js',
  'services/LicenceStateManager.js',
  'services/BackgroundVerificationScheduler.js',
];

const files = {};
for (const rel of CRITICAL_FILES) {
  const fullPath = path.join(APP_ROOT, rel);
  if (!fs.existsSync(fullPath)) {
    console.warn(`[manifest] Skipping missing file: ${rel}`);
    continue;
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
  files[rel] = hash;
}

const manifest = { generatedAt: new Date().toISOString(), files };

const outDir = path.join(APP_ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'integrity-manifest.json');
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

console.log(`[manifest] Wrote ${outPath} with ${Object.keys(files).length} file hashes.`);
