// electron/database/knex.js
import knex from 'knex';
import path from 'path';
import { app } from 'electron';

let knexInstance = null;

export function initKnex() {
    if (knexInstance) return knexInstance;

    const dbPath = path.join(app.getPath('userData'), 'mifela_pos_v1.db');

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
    await knex.schema.createTableIfNotExists('products', table => {
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

    await knex.schema.createTableIfNotExists('customers', table => {
        table.text('id').primary();
        table.text('name');
        table.text('phone');
        table.text('type');
        table.real('dues').defaultTo(0);
        table.integer('loyaltyPoints').defaultTo(0);
        table.text('data');
    });

    await knex.schema.createTableIfNotExists('transactions', table => {
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

    await knex.schema.createTableIfNotExists('security_config', table => {
        table.text('id').primary();
        table.text('email');
        table.text('storeName');
        table.text('encryptedPrivateKey');
        table.text('publicKey');
        table.text('nextVerificationDate');
    });

    await knex.schema.createTableIfNotExists('store_settings', table => {
        table.text('id').primary();
        table.text('data');
    });
}

export function getKnex() {
    if (!knexInstance) {
        throw new Error("Knex not initialized! Call initKnex first.");
    }
    return knexInstance;
}
