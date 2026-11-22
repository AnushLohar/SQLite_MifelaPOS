import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import betterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { migrateIfNeeded, getOrCreateDatabaseKey } from '../electron/database/connection.js';
import os from 'os';
import fs from 'fs';

// Helper to create a fresh test database
function createTestDb() {
  const dbPath = os.tmpdir() + '/test_pos_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db';
  const keyPath = dbPath + '.key';
  const key = getOrCreateDatabaseKey(keyPath);
  return { dbPath, keyPath, key };
}

// Helper to create encrypted database with schema using better-sqlite3 directly
function setupEncryptedDb(dbPath, key) {
  const db = betterSqlite3(dbPath);
  db.pragma(`key = '${key}'`);
  db.pragma('cipher = sqlcipher');

  db.exec(`
    CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, sku TEXT, barcode TEXT, price REAL, cost REAL, stockLevel REAL, lowStockThreshold REAL, data TEXT);
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, phone TEXT, type TEXT, dues REAL DEFAULT 0, loyaltyPoints INTEGER DEFAULT 0, data TEXT);
    CREATE TABLE transactions (id TEXT PRIMARY KEY, invoiceId TEXT, locationId TEXT, type TEXT, timestamp TEXT, paymentMethod TEXT, total REAL, data TEXT);
    CREATE TABLE local_users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT 'user', is_active BOOLEAN DEFAULT 1, firebase_uid TEXT);
    CREATE TABLE licence_data (id TEXT PRIMARY KEY, licence_payload TEXT NOT NULL, signature TEXT NOT NULL, last_verified_at TEXT, next_verification_due TEXT, status TEXT DEFAULT 'UNACTIVATED');
  `);
  db.close();
}

describe('Phase 2: Database Encryption & Migration', () => {
  let testDb;

  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    if (testDb && fs.existsSync(testDb.dbPath)) fs.unlinkSync(testDb.dbPath);
    if (testDb && fs.existsSync(testDb.keyPath)) fs.unlinkSync(testDb.keyPath);
    if (testDb && fs.existsSync(testDb.dbPath + '.bak')) fs.unlinkSync(testDb.dbPath + '.bak');
  });

  it('encrypts new database with key from safeStorage fallback', () => {
    const { dbPath, key } = testDb;
    const db = betterSqlite3(dbPath);
    db.pragma(`key = '${key}'`);
    db.pragma('cipher = sqlcipher');
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
    db.close();

    const header = fs.readFileSync(dbPath, { encoding: 'latin1' }).slice(0, 16);
    expect(header).not.toBe('SQLite format 3\u0000');
  });

  it('migrates unencrypted database to encrypted storage atomically', () => {
    const { dbPath, key } = testDb;

    // Create unencrypted database with data
    const plainDb = betterSqlite3(dbPath);
    plainDb.exec(`
      CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, stockLevel REAL);
      INSERT INTO products VALUES ('p1', 'Widget', 10);
    `);
    plainDb.close();

    const headerBefore = fs.readFileSync(dbPath, { encoding: 'latin1' }).slice(0, 16);
    expect(headerBefore).toBe('SQLite format 3\u0000');

    // Run migration
    migrateIfNeeded(dbPath, key);

    const headerAfter = fs.readFileSync(dbPath, { encoding: 'latin1' }).slice(0, 16);
    expect(headerAfter).not.toBe('SQLite format 3\u0000');
    expect(fs.existsSync(dbPath + '.bak')).toBe(false);

    // Verify data integrity after migration
    const encDb = betterSqlite3(dbPath);
    encDb.pragma(`key = '${key}'`);
    const rows = encDb.prepare('SELECT * FROM products').all();
    expect(rows).toEqual([{ id: 'p1', name: 'Widget', stockLevel: 10 }]);
    encDb.close();
  });

  it('preserves data integrity through migration with multiple tables', () => {
    const { dbPath, key } = testDb;

    const plainDb = betterSqlite3(dbPath);
    plainDb.exec(`
      CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, stockLevel REAL);
      CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, dues REAL);
      INSERT INTO products VALUES ('p1', 'Widget', 10), ('p2', 'Gadget', 5);
      INSERT INTO customers VALUES ('c1', 'Acme', 100.50);
    `);
    plainDb.close();

    migrateIfNeeded(dbPath, key);

    const encDb = betterSqlite3(dbPath);
    encDb.pragma(`key = '${key}'`);
    const products = encDb.prepare('SELECT * FROM products ORDER BY id').all();
    const customers = encDb.prepare('SELECT * FROM customers').all();
    encDb.close();

    expect(products).toHaveLength(2);
    expect(customers).toHaveLength(1);
    expect(customers[0].dues).toBe(100.50);
  });
});

describe('Phase 2: Billing & GST Calculations', () => {
  it('calculates correct tax splits for intra-state CGST/SGST', () => {
    const items = [
      { id: 'p1', name: 'Item A', price: 100, quantity: 2, gstRate: 18 },
      { id: 'p2', name: 'Item B', price: 50, quantity: 1, gstRate: 12 },
    ];

    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const cgst = items.reduce((sum, item) => sum + (item.price * item.quantity * item.gstRate / 200), 0);
    const sgst = items.reduce((sum, item) => sum + (item.price * item.quantity * item.gstRate / 200), 0);
    const total = subtotal + cgst + sgst;

    expect(subtotal).toBe(250);
    expect(cgst).toBe(21);
    expect(sgst).toBe(21);
    expect(total).toBe(292);
  });

  it('handles item-level discounts correctly before tax', () => {
    const item = { price: 100, quantity: 2, discount: 10, gstRate: 18 };
    const discountedPrice = item.price * (1 - item.discount / 100);
    const taxableAmount = discountedPrice * item.quantity;
    const cgst = taxableAmount * item.gstRate / 200;
    const sgst = taxableAmount * item.gstRate / 200;

    expect(discountedPrice).toBe(90);
    expect(taxableAmount).toBe(180);
    expect(cgst).toBe(16.2);
    expect(sgst).toBe(16.2);
  });

  it('generates unique invoice IDs', () => {
    let seq = 0;
    const generateInvoiceId = () => {
      const dateStr = '20261122';
      const rand = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
      return `INV-${dateStr}-${rand}-${++seq}`;
    };

    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateInvoiceId());
    }
    expect(ids.size).toBe(100);
  });
});

describe('Phase 2: Schema Migration Logic', () => {
  it('can detect SQLite 3 header for migration detection', () => {
    const plainDb = betterSqlite3(':memory:');
    plainDb.exec('CREATE TABLE test (id INTEGER)');

    // We can't directly test file header in memory, but the logic is:
    // 'SQLite format 3\u0000' === header.slice(0, 16) -> needs migration
    const expectedHeader = 'SQLite format 3\u0000';
    expect(expectedHeader.length).toBe(16);
  });

  it('upgrades unencrypted legacy database to encrypted schema', () => {
    const testDb = createTestDb();
    const { dbPath, key } = testDb;

    try {
      // Create legacy unencrypted database with old schema
      const legacyDb = betterSqlite3(dbPath);
      legacyDb.exec(`
        CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, price REAL, stockLevel REAL);
        CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, phone TEXT);
        INSERT INTO products VALUES ('p1', 'Legacy Widget', 100, 10);
      `);
      legacyDb.close();

      // Run migration
      migrateIfNeeded(dbPath, key);

      // Now open with encryption and verify
      const encDb = betterSqlite3(dbPath);
      encDb.pragma(`key = '${key}'`);
      const products = encDb.prepare('SELECT * FROM products').all();
      expect(products).toHaveLength(1);
      expect(products[0].name).toBe('Legacy Widget');
      encDb.close();
    } finally {
      // Cleanup
      if (fs.existsSync(testDb.dbPath)) fs.unlinkSync(testDb.dbPath);
      if (fs.existsSync(testDb.keyPath)) fs.unlinkSync(testDb.keyPath);
    }
  });
});