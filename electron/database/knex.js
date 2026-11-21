// electron/database/knex.js
import knex from 'knex';
import path from 'path';
import { app } from 'electron';

let knexInstance = null;

export function initKnex(dbPath) {
    if (knexInstance) return knexInstance;

    if (!dbPath) {
        dbPath = path.join(app.getPath('userData'), 'mifela_pos_v1.db');
    }

    knexInstance = knex({
        client: 'sqlite3',
        connection: {
            filename: dbPath
        },
        useNullAsDefault: true
    });

    initSchema(knexInstance);

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
