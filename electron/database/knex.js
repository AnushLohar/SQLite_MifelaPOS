// electron/database/knex.js
// Knex backed by `better-sqlite3-multiple-ciphers` for encryption at rest.
// The database key is stored via Electron `safeStorage` (OS keychain/DPAPI)
// and an injectable key provider so Vitest can test without Electron.
// An existing unencrypted database is migrated to encrypted storage on open
// (temp file -> PRAGMA integrity_check -> atomic swap -> backup removed).

import path from 'path';
import { fileURLToPath } from 'url';
import { migrateIfNeeded, getOrCreateDatabaseKey } from './connection.js';
import { runMigrations } from './migrate.js';

let knexInstance = null;
let knexLoaded = false;

// Route knex's better-sqlite3 driver to the encrypted drop-in so every
// connection opens the database file with SQLCipher encryption.
async function getKnexDriver() {
    if (knexLoaded) {
        const { default: knex } = await import('knex');
        return knex;
    }
    let knexModule;
    try {
        const { createRequire } = await import('module');
        const req = createRequire(import.meta.url);
        const Module = req('module');
        const SHIM_PATH = fileURLToPath(new URL('../../shims/better-sqlite3/index.js', import.meta.url));
        const origResolve = Module._resolveFilename.bind(Module);
        Module._resolveFilename = function (request, ...args) {
            if (request === 'better-sqlite3') return SHIM_PATH;
            return origResolve(request, ...args);
        };
        knexModule = await import('knex');
        knexLoaded = true;
    } catch (err) {
        console.error('🔥 Failed to load the encrypted sqlite driver (check native module build for Electron ABI):', err);
        throw err;
    }
    return knexModule.default;
}

export async function initKnex(dbPath) {
    if (knexInstance) return knexInstance;

    if (!dbPath) {
        const { app } = await import('electron');
        const dir = path.join(app.getPath('userData'), 'mifela_pos_v1.db');
        dbPath = dir;
    }

    const keyPath = dbPath + '.key';
    const key = getOrCreateDatabaseKey(keyPath);

    // Migrate any existing unencrypted database to encrypted storage before
    // knex opens it, so knex never sees an unencrypted file.
    migrateIfNeeded(dbPath, key);

    const knex = await getKnexDriver();
    const instance = knex({
        client: 'better-sqlite3',
        connection: { filename: dbPath },
        useNullAsDefault: true,
        // The key MUST be applied to every pooled connection. Knex opens
        // several (pool min 2); applying it once via knexInstance.raw() leaves
        // the rest keyless, so they fail to read the SQLCipher file and tarn
        // surfaces "Unable to acquire a connection".
        pool: {
            afterCreate: (conn, done) => {
                try {
                    conn.pragma(`key = '${key}'`);
                    conn.pragma(`cipher = 'sqlcipher'`);
                    done(null, conn);
                } catch (err) {
                    console.error('🔥 PRAGMA key failed on pooled connection:', err);
                    done(err, conn);
                }
            }
        }
    });

    // Fail fast with the real SQLite error instead of a pool timeout.
    try {
        await instance.raw('SELECT 1');
        await initSchema(instance);
        knexInstance = instance;
        // Run versioned schema migrations
        await runMigrations();
    } catch (err) {
        knexInstance = null;
        try { await instance.destroy(); } catch (_) {}
        console.error('🔥 Encrypted DB init failed:', err);
        throw err;
    }

    return knexInstance;
}

async function initSchema(knex) {
    if (!(await knex.schema.hasTable('products'))) {
        await knex.schema.createTable('products', table => {
            table.text('id').primary();
            table.text('locationId');
            table.text('name');
            table.text('sku');
            table.text('barcode');
            table.real('price');
            table.real('cost');
            table.real('stockLevel');
            table.real('lowStockThreshold');
            table.text('data');
            table.index('barcode');
            table.index('sku');
        });
    }

    if (!(await knex.schema.hasTable('customers'))) {
        await knex.schema.createTable('customers', table => {
            table.text('id').primary();
            table.text('name');
            table.text('phone');
            table.text('type');
            table.real('dues').defaultTo(0);
            table.integer('loyaltyPoints').defaultTo(0);
            table.text('data');
        });
    }

    if (!(await knex.schema.hasTable('transactions'))) {
        await knex.schema.createTable('transactions', table => {
            table.text('id').primary();
            table.text('invoiceId');
            table.text('locationId');
            table.text('type');
            table.text('timestamp');
            table.text('paymentMethod');
            table.real('total');
            table.text('data');
            table.index('timestamp');
        });
    }

    if (!(await knex.schema.hasTable('security_config'))) {
        await knex.schema.createTable('security_config', table => {
            table.text('id').primary();
            table.text('email');
            table.text('storeName');
            table.text('encryptedPrivateKey');
            table.text('publicKey');
            table.text('nextVerificationDate');
        });
    }

    if (!(await knex.schema.hasTable('store_settings'))) {
        await knex.schema.createTable('store_settings', table => {
            table.text('id').primary();
            table.text('data');
        });
    }

    // --- NEW OFFLINE-FIRST TABLES ---
    if (!(await knex.schema.hasTable('local_users'))) {
        await knex.schema.createTable('local_users', table => {
            table.uuid('id').primary();
            table.string('username').notNullable().unique();
            table.string('password_hash').notNullable();
            table.string('role').defaultTo('user');
            table.boolean('is_active').defaultTo(true);
            table.string('firebase_uid').nullable();
        });
    }

    if (!(await knex.schema.hasTable('licence_data'))) {
        await knex.schema.createTable('licence_data', table => {
            table.string('id').primary();
            table.text('licence_payload').notNullable();
            table.text('signature').notNullable();
            table.timestamp('last_verified_at');
            table.timestamp('next_verification_due');
            table.string('status').defaultTo('UNACTIVATED');
        });
    }
}

export function getKnex() {
    if (!knexInstance) {
        throw new Error("Knex not initialized! Call initKnex first.");
    }
    return knexInstance;
}
