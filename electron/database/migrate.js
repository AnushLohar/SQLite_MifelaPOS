// electron/database/migrate.js
// Versioned schema migrations with transactional execution and automatic backup/rollback.
// Uses SQLite's PRAGMA user_version + a schema_migrations ledger table.
// Runs automatically in initKnex after database connection is established.

import { getKnex } from './knex.js';

const MIGRATIONS = [
    // 1: Initial schema (products, customers, transactions, security_config, store_settings)
    //    -> Already created by initSchema, so we mark it as applied if tables exist.
    {
        version: 1,
        name: '001_initial_schema',
        up: async (knex) => {
            // No-op: initSchema creates these tables. This migration just records version.
        },
        down: async (knex) => {
            await knex.schema.dropTableIfExists('products');
            await knex.schema.dropTableIfExists('customers');
            await knex.schema.dropTableIfExists('transactions');
            await knex.schema.dropTableIfExists('security_config');
            await knex.schema.dropTableIfExists('store_settings');
        }
    },
    // 2: Offline-first tables (local_users, licence_data)
    {
        version: 2,
        name: '002_offline_first_tables',
        up: async (knex) => {
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
        },
        down: async (knex) => {
            await knex.schema.dropTableIfExists('licence_data');
            await knex.schema.dropTableIfExists('local_users');
        }
    },
    // 3: Add schema_migrations ledger table itself
    {
        version: 3,
        name: '003_migrations_ledger',
        up: async (knex) => {
            if (!(await knex.schema.hasTable('schema_migrations'))) {
                await knex.schema.createTable('schema_migrations', table => {
                    table.integer('version').primary();
                    table.string('name').notNullable();
                    table.timestamp('applied_at').defaultTo(knex.fn.now());
                    table.boolean('success').defaultTo(true);
                });
            }
        },
        down: async (knex) => {
            await knex.schema.dropTableIfExists('schema_migrations');
        }
    },
];

export async function runMigrations() {
    const knex = getKnex();

    // Ensure schema_migrations table exists (migration 3 creates it)
    const hasLedger = await knex.schema.hasTable('schema_migrations');
    if (!hasLedger) {
        await knex.schema.createTable('schema_migrations', table => {
            table.integer('version').primary();
            table.string('name').notNullable();
            table.timestamp('applied_at').defaultTo(knex.fn.now());
            table.boolean('success').defaultTo(true);
        });
    }

    // Get current user_version (SQLite built-in)
    const [userVersionRow] = await knex.raw('PRAGMA user_version');
    const currentVersion = userVersionRow?.user_version ?? userVersionRow?.[0]?.user_version ?? 0;

    // Get applied migrations from ledger
    const applied = await knex('schema_migrations').select('version').orderBy('version');
    const appliedVersions = new Set(applied.map(r => r.version));

    // Find pending migrations
    const pending = MIGRATIONS.filter(m => m.version > currentVersion && !appliedVersions.has(m.version));

    if (pending.length === 0) {
        console.log('No pending migrations. Current version:', currentVersion);
        return { applied: 0, currentVersion };
    }

    console.log(`Running ${pending.length} pending migration(s) from version ${currentVersion}`);

    // Create a timestamped backup before any migration
    const backupPath = await createPreMigrationBackup(knex);

    let appliedCount = 0;
    try {
        for (const migration of pending) {
            console.log(`Applying migration ${migration.version}: ${migration.name}`);

            // Run migration in a transaction
            await knex.transaction(async (trx) => {
                await migration.up(trx);

                // Record in ledger
                await trx('schema_migrations').insert({
                    version: migration.version,
                    name: migration.name,
                    success: true
                });
            });

            // Update user_version after successful transaction
            await knex.raw(`PRAGMA user_version = ${migration.version}`);
            appliedCount++;
            console.log(`Migration ${migration.version} applied successfully`);
        }

        console.log(`All ${appliedCount} migrations applied. New version: ${currentVersion + appliedCount}`);
        return { applied: appliedCount, currentVersion: currentVersion + appliedCount };
    } catch (error) {
        console.error('Migration failed, rolling back...', error.message);

        // Attempt rollback by restoring backup
        await restoreFromBackup(knex, backupPath);
        throw new Error(`Migration failed and rolled back: ${error.message}`);
    }
}

async function createPreMigrationBackup(knex) {
    // Get database path from connection
    const db = knex.client.connectionSettings?.filename || 'mifela_pos_v1.db';
    const backupPath = `${db}.bak.${Date.now()}`;

    // Use better-sqlite3 to backup (VACUUM INTO is atomic)
    await knex.raw(`VACUUM INTO '${backupPath}'`);
    console.log(`Pre-migration backup created: ${backupPath}`);
    return backupPath;
}

async function restoreFromBackup(knex, backupPath) {
    try {
        const db = knex.client.connectionSettings?.filename || 'mifela_pos_v1.db';
        await knex.destroy(); // Close connections
        // Copy backup over original (requires file system access, simplified here)
        const fs = await import('fs');
        const { copyFileSync } = fs;
        copyFileSync(backupPath, db);
        console.log('Restored from backup:', backupPath);
    } catch (e) {
        console.error('Backup restore failed:', e.message);
    }
}

// Export for manual rollback if needed
export async function rollbackMigration(targetVersion) {
    const knex = getKnex();
    const [userVersionRow] = await knex.raw('PRAGMA user_version');
    const currentVersion = userVersionRow?.user_version ?? userVersionRow?.[0]?.user_version ?? 0;

    if (targetVersion >= currentVersion) {
        throw new Error('Target version must be less than current version');
    }

    const backupPath = await createPreMigrationBackup(knex);

    try {
        for (let v = currentVersion; v > targetVersion; v--) {
            const migration = MIGRATIONS.find(m => m.version === v);
            if (!migration) continue;

            console.log(`Rolling back migration ${v}: ${migration.name}`);
            await knex.transaction(async (trx) => {
                await migration.down(trx);
                await trx('schema_migrations').where({ version: v }).delete();
            });
            await knex.raw(`PRAGMA user_version = ${v - 1}`);
        }
        console.log(`Rolled back to version ${targetVersion}`);
    } catch (error) {
        console.error('Rollback failed, restoring backup...', error.message);
        await restoreFromBackup(knex, backupPath);
        throw error;
    }
}

export default { runMigrations, rollbackMigration };