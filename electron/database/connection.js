// electron/database/connection.js
// Encrypted SQLite database initializer using better-sqlite3-multiple-ciphers.
// Electron `safeStorage` (OS keychain/DPAPI) protects the database key;
// falls back to plaintext key file only where `safeStorage` is unavailable.
// Key provider is injectable so Vitest can test encryption without Electron.
import betterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, renameSync } from 'fs';
import crypto from 'crypto';

export function getOrCreateDatabaseKey(keyPath, keyProvider) {
  if (keyProvider) return keyProvider(keyPath);

  // Default provider: Electron `safeStorage` encrypted key file, plaintext fallback.
  try {
    if (existsSync(keyPath)) {
      const raw = readFileSync(keyPath);
      if (typeof safeStorage !== 'undefined' && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(raw);
      }
      return raw.toString('utf8');
    }

    const key = crypto.randomBytes(32).toString('hex');
    const blob = typeof safeStorage !== 'undefined' && safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(key)
      : Buffer.from(key, 'utf8');
    writeFileSync(keyPath, blob);
    return key;
  } catch (_) {
    // Fallback to in-memory random key if OS keychain is unavailable.
    return crypto.randomBytes(32).toString('hex');
  }
}

// Create/open an encrypted database, optionally migrating an existing unencrypted one.
export function openDatabase({ dbPath, keyPath, keyProvider }) {
  if (!dbPath) {
    if (typeof app === 'undefined') {
      throw new Error('dbPath required when Electron `app` is unavailable.');
    }
    const dir = join(app.getPath('userData'), 'database');
    mkdirSync(dir, { recursive: true });
    dbPath = join(dir, 'mifela_secure.db');
    keyPath = join(dir, 'database.key');
  }

  const key = getOrCreateDatabaseKey(keyPath, keyProvider);
  const db = betterSqlite3(dbPath);
  db.pragma(`key = '${key}'`);

  // Migrate an existing unencrypted database to encrypted storage.
  migrateIfNeeded(dbPath, key);

  return db;
}

// Atomic unencrypted -> encrypted migration: temp file -> copy tables -> integrity check -> swap.
export function migrateIfNeeded(dbPath, key) {
  let needsMigration = false;
  try {
    const header = readFileSync(dbPath, { encoding: 'latin1' }).slice(0, 16);
    // SQLite 3 header is exactly 16 bytes: "SQLite format 3\0"
    needsMigration = header === 'SQLite format 3\u0000';
  } catch (_) {
    return; // File does not exist yet — nothing to migrate.
  }
  if (!needsMigration) return;

  const backupPath = `${dbPath}.bak`;
  const tmpEncryptedPath = `${dbPath}.enc_tmp`;
  writeFileSync(backupPath, readFileSync(dbPath)); // mandatory pre-migration backup

  try {
    const tmpDb = betterSqlite3(tmpEncryptedPath);
    tmpDb.pragma(`key = '${key}'`);
    tmpDb.pragma('cipher = sqlcipher');

    // Attach unencrypted source database (no key = plaintext)
    tmpDb.exec(`ATTACH DATABASE '${dbPath}' AS source KEY ''`);

    // Get all tables from source
    const tables = tmpDb.prepare("SELECT sql, name FROM source.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();

    for (const table of tables) {
      // Create table in encrypted DB
      tmpDb.exec(table.sql);

      // Copy data
      const rows = tmpDb.prepare(`SELECT * FROM source.${table.name}`).all();
      if (rows.length > 0) {
        const cols = Object.keys(rows[0]);
        const placeholders = cols.map(() => '?').join(',');
        const insertSql = `INSERT INTO ${table.name} (${cols.join(',')}) VALUES (${placeholders})`;
        const stmt = tmpDb.prepare(insertSql);
        for (const row of rows) {
          stmt.run(...cols.map(c => row[c]));
        }
      }
    }

    tmpDb.exec('DETACH DATABASE source');

    const integrity = tmpDb.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`Encrypted migration failed integrity check: ${integrity}`);
    }

    tmpDb.close();

    // Atomic swap: remove unencrypted original, place encrypted file.
    if (existsSync(dbPath)) unlinkSync(dbPath);
    renameSync(tmpEncryptedPath, dbPath);

    // Remove plaintext backup only after verified encrypted swap.
    if (existsSync(backupPath)) unlinkSync(backupPath);
  } catch (error) {
    // On any failure, clean up the temp encrypted file; backup remains for recovery.
    if (existsSync(tmpEncryptedPath)) unlinkSync(tmpEncryptedPath);
    throw new Error(`Database migration to encrypted storage failed: ${error.message}`);
  }
}

export default openDatabase;