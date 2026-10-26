// electron/database/connection.js
import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db;

export function initDB() {
    // 1. Store the DB in the user's AppData folder so it survives app updates
    const dbPath = path.join(app.getPath('userData'), 'mifela_pos_v1.db');
    db = new Database(dbPath);

    // 2. Build the Schema
    db.exec(`
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            locationId TEXT,
            name TEXT,
            sku TEXT,
            barcode TEXT,
            price REAL,
            cost REAL,
            stockLevel REAL,
            lowStockThreshold REAL,
            data TEXT
        );

        CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            name TEXT,
            phone TEXT,
            type TEXT,
            dues REAL DEFAULT 0,
            loyaltyPoints INTEGER DEFAULT 0,
            data TEXT
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            invoiceId TEXT,
            locationId TEXT,
            type TEXT,
            timestamp TEXT,
            paymentMethod TEXT,
            total REAL,
            data TEXT
        );

        -- 🚀 NEW: Secure Enclave for Asymmetric Keys
        CREATE TABLE IF NOT EXISTS security_config (
            id TEXT PRIMARY KEY,
            email TEXT,
            storeName TEXT,
            encryptedPrivateKey TEXT,
            publicKey TEXT,
            nextVerificationDate TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
        CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
        
        -- 🚀 OPTIMIZATION: Index for faster date-range ledger queries
        CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
    `);
    
    return db;
}

export function getDB() {
    if (!db) {
        throw new Error("Database not initialized! Call initDB first.");
    }
    return db;
}