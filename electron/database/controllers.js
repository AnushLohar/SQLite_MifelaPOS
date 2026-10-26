// electron/database/controllers.js
import { ipcMain } from 'electron';
import { getDB } from './connection.js';

export function registerDBHandlers() {
    const db = getDB();

    // =========================================================================
    // --- CORE FETCH HANDLERS ---
    // =========================================================================
    
    ipcMain.handle('db:getProducts', () => {
        try {
            const rows = db.prepare(`SELECT data FROM products`).all();
            return rows.map(r => JSON.parse(r.data));
        } catch (e) {
            console.error("Failed to fetch products:", e);
            return [];
        }
    });

    ipcMain.handle('db:getTransactionsSince', (event, isoDate) => {
        try {
            const rows = db.prepare(`SELECT data FROM transactions WHERE timestamp >= ? ORDER BY timestamp DESC`).all(isoDate);
            return rows.map(r => JSON.parse(r.data));
        } catch (e) {
            console.error("Failed to fetch transactions:", e);
            return [];
        }
    });

    ipcMain.handle('db:getPendingCheques', () => {
        try {
            const stmt = db.prepare(`
                SELECT * FROM transactions 
                WHERE json_extract(data, '$.summary.paymentMethod') = 'CHEQUE' 
                  AND json_extract(data, '$.summary.chequeDetails.status') = 'PENDING'
            `);
            const rows = stmt.all();
            return rows.map(row => JSON.parse(row.data));
        } catch (error) {
            console.error('Database read error (get-pending-cheques):', error);
            return []; 
        }
    });

    // =========================================================================
    // --- CORE WRITE / TRANSACTION HANDLERS ---
    // =========================================================================

    ipcMain.handle('db:updateChequeStatus', (event, txId, status, isoDate) => {
        try {
            const stmt = db.prepare(`SELECT data FROM transactions WHERE id = ?`);
            const row = stmt.get(txId);
            if (!row) throw new Error("Transaction not found");

            const txData = JSON.parse(row.data);
            if (txData.summary && txData.summary.chequeDetails) {
                txData.summary.chequeDetails.status = status;
                txData.summary.chequeDetails.updatedAt = isoDate;
            }

            const updateStmt = db.prepare(`UPDATE transactions SET data = ? WHERE id = ?`);
            updateStmt.run(JSON.stringify(txData), txId);
            return { success: true };
        } catch (error) {
            console.error("Error updating cheque:", error);
            throw error;
        }
    });

    ipcMain.handle('db:processSale', (event, { transaction, customerUpdate }) => {
        try {
            const commitSale = db.transaction(() => {
                const insertTx = db.prepare(`INSERT INTO transactions (id, invoiceId, locationId, type, timestamp, paymentMethod, total, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
                insertTx.run(
                    transaction.id, transaction.invoiceId, transaction.locationId, 
                    transaction.summary.transactionType, transaction.localTimestamp, 
                    transaction.summary.paymentMethod, transaction.summary.total, 
                    JSON.stringify(transaction)
                );

                const updateStock = db.prepare(`UPDATE products SET stockLevel = stockLevel - ? WHERE id = ?`);
                for (const item of transaction.items) {
                    if (item.type !== 'homemade') {
                        updateStock.run(item.quantity, item.id);
                    }
                }

                if (customerUpdate && customerUpdate.id !== 'WALK-IN') {
                    if (customerUpdate.isNew) {
                        const insertCust = db.prepare(`INSERT INTO customers (id, name, phone, dues, loyaltyPoints, data) VALUES (?, ?, ?, ?, ?, ?)`);
                        insertCust.run(
                            customerUpdate.id, customerUpdate.name, customerUpdate.phone, 
                            customerUpdate.ledgerChange, customerUpdate.loyaltyPointsChange, 
                            JSON.stringify(customerUpdate)
                        );
                    } else {
                        const updateCust = db.prepare(`UPDATE customers SET dues = dues + ?, loyaltyPoints = loyaltyPoints + ? WHERE id = ?`);
                        updateCust.run(customerUpdate.ledgerChange, customerUpdate.loyaltyPointsChange, customerUpdate.id);
                    }
                }
            });

            commitSale();
            return { success: true };
        } catch (error) {
            console.error("SQLite processSale Error:", error);
            throw error; 
        }
    });

    ipcMain.handle('db:processFinancialTransaction', (event, { transaction, customerId, duesChange }) => {
        try {
            db.transaction(() => {
                const stmtTx = db.prepare(`INSERT INTO transactions (id, invoiceId, locationId, type, timestamp, paymentMethod, total, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
                stmtTx.run(transaction.id, transaction.invoiceId, transaction.locationId, transaction.type, transaction.timestamp, transaction.summary.paymentMethod, transaction.summary.total, JSON.stringify(transaction));
                
                const stmtCust = db.prepare(`UPDATE customers SET dues = dues + ? WHERE id = ?`);
                stmtCust.run(duesChange, customerId);
            })();
            return { success: true };
        } catch (e) { throw e; }
    });

    ipcMain.handle('db:getTransactionsForCustomer', (event, customerId) => {
        try {
            const rows = db.prepare(`SELECT data FROM transactions WHERE json_extract(data, '$.customer.id') = ? ORDER BY timestamp DESC`).all(customerId);
            return rows.map(r => JSON.parse(r.data));
        } catch (e) { throw e; }
    });

    ipcMain.handle('db:executeLedgerMerge', (event, { selectedTxIds, customerId, customerName }) => {
        try {
            let netTotal = 0;
            let combinedItems = [];
            let bundledOriginals = [];
            let primaryCustomerData = null;

            const commitMerge = db.transaction(() => {
                for (let id of selectedTxIds) {
                    const row = db.prepare(`SELECT data FROM transactions WHERE id = ?`).get(id);
                    if (row) {
                        const data = JSON.parse(row.data);
                        let rawTotal = parseFloat(data.summary?.total || 0);
                        
                        if (data.type !== 'MERGED_LEDGER') {
                            if (['PAYMENT_MADE', 'PURCHASE', 'REFUND'].includes(data.type)) {
                                if (rawTotal > 0) rawTotal = -Math.abs(rawTotal); 
                            } else if (['PAYMENT_RECEIVED', 'SALE'].includes(data.type)) {
                                if (rawTotal < 0) rawTotal = Math.abs(rawTotal); 
                            }
                        }

                        netTotal += rawTotal;
                        if (data.items) combinedItems = combinedItems.concat(data.items);
                        if (!primaryCustomerData) primaryCustomerData = data.customer;

                        if (data.type === 'MERGED_LEDGER' && data._archivedRecords) {
                            bundledOriginals = bundledOriginals.concat(data._archivedRecords);
                        } else {
                            bundledOriginals.push({ id: id, data: data });
                        }

                        db.prepare(`DELETE FROM transactions WHERE id = ?`).run(id);
                    }
                }

                const mergedId = `MRG-${Date.now().toString().slice(-6)}`;
                const mergedTx = {
                    id: mergedId, invoiceId: mergedId, locationId: 'main',
                    timestamp: new Date().toISOString(), type: 'MERGED_LEDGER', 
                    customer: primaryCustomerData || { id: customerId, name: customerName },
                    summary: { total: netTotal, profit: 0, paymentMethod: 'MERGED', reason: `Merged ${selectedTxIds.length} records`, transactionType: 'MERGED_LEDGER' },
                    items: combinedItems, _archivedRecords: bundledOriginals 
                };

                db.prepare(`INSERT INTO transactions (id, invoiceId, locationId, type, timestamp, paymentMethod, total, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
                    mergedId, mergedId, 'main', 'MERGED_LEDGER', mergedTx.timestamp, 'MERGED', netTotal, JSON.stringify(mergedTx)
                );
                
                return mergedId;
            });

            const newId = commitMerge();
            return { success: true, mergedId: newId };
        } catch (e) { throw e; }
    });

    ipcMain.handle('db:undoLedgerMerge', (event, mergedTxId) => {
        try {
            db.transaction(() => {
                const row = db.prepare(`SELECT data FROM transactions WHERE id = ?`).get(mergedTxId);
                if (!row) throw new Error("Merged record not found.");
                
                const data = JSON.parse(row.data);
                const archivedRecords = data._archivedRecords || [];

                archivedRecords.forEach(record => {
                    db.prepare(`INSERT INTO transactions (id, invoiceId, locationId, type, timestamp, paymentMethod, total, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
                        record.id, record.data.invoiceId, record.data.locationId, record.data.type, record.data.timestamp, record.data.summary?.paymentMethod, record.data.summary?.total, JSON.stringify(record.data)
                    );
                });

                db.prepare(`DELETE FROM transactions WHERE id = ?`).run(mergedTxId);
            })();
            return { success: true };
        } catch (e) { throw e; }
    });

    // =========================================================================
    // --- UNIFIED CUSTOMER & DIRECTORY HANDLERS ---
    // =========================================================================
    
    const fetchCustomers = () => {
        try {
            const rows = db.prepare(`SELECT data, dues, loyaltyPoints FROM customers`).all();
            return rows.map(r => ({ ...JSON.parse(r.data), dues: r.dues, loyaltyPoints: r.loyaltyPoints }));
        } catch (e) {
            console.error("Failed to fetch customers:", e);
            return [];
        }
    };
    
    ipcMain.handle('db:getCustomers', fetchCustomers);
    ipcMain.handle('db:get-customers', fetchCustomers);

    const savePartner = (event, { customer, obTransaction }) => {
        try {
            db.transaction(() => {
                const stmtCust = db.prepare(`INSERT OR REPLACE INTO customers (id, name, phone, type, dues, loyaltyPoints, data) VALUES (?, ?, ?, ?, ?, ?, ?)`);
                stmtCust.run(customer.id, customer.name, customer.phone, customer.type, customer.dues || 0, customer.loyaltyPoints || 0, JSON.stringify(customer));
                
                if (obTransaction) {
                    const stmtTx = db.prepare(`INSERT INTO transactions (id, invoiceId, locationId, type, timestamp, paymentMethod, total, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
                    stmtTx.run(obTransaction.id, obTransaction.invoiceId, obTransaction.locationId, obTransaction.type, obTransaction.timestamp, obTransaction.summary?.paymentMethod || 'SYSTEM', obTransaction.summary?.total || 0, JSON.stringify(obTransaction));
                }
            })();
            return { success: true };
        } catch (e) { throw e; }
    };
    
    ipcMain.handle('db:savePartner', savePartner);
    ipcMain.handle('db:save-partner', savePartner);

    ipcMain.handle('db:deleteCustomer', (event, id) => {
        try { db.prepare(`DELETE FROM customers WHERE id = ?`).run(id); return { success: true }; } 
        catch (e) { throw e; }
    });

    ipcMain.handle('db:resetPartnerAccount', (event, id) => {
        try {
            db.transaction(() => {
                db.prepare(`DELETE FROM transactions WHERE json_extract(data, '$.customer.id') = ?`).run(id);
                db.prepare(`UPDATE customers SET dues = 0, loyaltyPoints = 0 WHERE id = ?`).run(id);
            })();
            return { success: true };
        } catch (e) { throw e; }
    });

    ipcMain.handle('db:updateLoyaltyTokens', (event, customerId, tokensEarned) => {
        try {
            db.prepare(`UPDATE customers SET loyaltyPoints = loyaltyPoints + ? WHERE id = ?`).run(tokensEarned, customerId);
            return { success: true };
        } catch (e) { throw e; }
    });

    ipcMain.handle('db:runDirectoryCleanup', (event, type) => {
        try {
            let mergedCount = 0;
            db.transaction(() => {
                const customers = db.prepare(`SELECT * FROM customers WHERE type = ?`).all(type);
                const phoneGroups = {};
                
                customers.forEach(row => {
                    const data = JSON.parse(row.data);
                    const phoneDigits = (data.phone || '').replace(/\D/g, '').slice(-10);
                    if (phoneDigits.length === 10) {
                        if (!phoneGroups[phoneDigits]) phoneGroups[phoneDigits] = [];
                        phoneGroups[phoneDigits].push({ id: row.id, data, dbDues: row.dues, dbPts: row.loyaltyPoints });
                    }
                });

                const updateTx = db.prepare(`UPDATE transactions SET data = json_set(data, '$.customer.id', ?) WHERE json_extract(data, '$.customer.id') = ?`);
                const updatePrimary = db.prepare(`UPDATE customers SET dues = dues + ?, loyaltyPoints = loyaltyPoints + ? WHERE id = ?`);
                const deleteDup = db.prepare(`DELETE FROM customers WHERE id = ?`);

                for (const phone in phoneGroups) {
                    const group = phoneGroups[phone];
                    if (group.length > 1) {
                        group.sort((a, b) => (new Date(a.data.createdAt || 0)).getTime() - (new Date(b.data.createdAt || 0)).getTime());
                        const primary = group[0];
                        const duplicates = group.slice(1);

                        for (const dup of duplicates) {
                            updateTx.run(primary.id, dup.id);
                            updatePrimary.run(dup.dbDues, dup.dbPts, primary.id);
                            deleteDup.run(dup.id);
                            mergedCount++;
                        }
                    }
                }
            })();
            return { success: true, mergedCount };
        } catch(e) {
            console.error("Cleanup error:", e);
            throw e;
        }
    });
    ipcMain.handle('db:getSupplierByPhone', (event, phoneDigits) => {
        try {
            // Searches the JSON 'phone' field for numbers ending with the typed digits
            const stmt = db.prepare(`
                SELECT data FROM customers 
                WHERE type IN ('supplier', 'dealer', 'store') 
                AND json_extract(data, '$.phone') LIKE ?
            `);
            const row = stmt.get(`%${phoneDigits}`);
            return row ? JSON.parse(row.data) : null;
        } catch (e) {
            console.error("Failed to fetch supplier by phone:", e);
            return null;
        }
    });

    ipcMain.handle('db:getSupplierByGSTIN', (event, gstin) => {
        try {
            const stmt = db.prepare(`
                SELECT data FROM customers 
                WHERE type IN ('supplier', 'dealer', 'store') 
                AND json_extract(data, '$.gstin') = ?
            `);
            const row = stmt.get(gstin);
            return row ? JSON.parse(row.data) : null;
        } catch (e) {
            console.error("Failed to fetch supplier by GSTIN:", e);
            return null;
        }
    });

    ipcMain.handle('db:logTelemetry', (event, action, data) => {
        try {
            // In an offline app, telemetry can safely be dumped to the terminal 
            // or written to a local rotating log file instead of a cloud database.
            console.log(`[Offline Telemetry] ${action}:`, data);
            return { success: true };
        } catch (e) {
            return { success: false };
        }
    });
    ipcMain.handle('db:getDoc', (event, col, id) => {
        try {
            const tableName = col === 'directory_merchants' ? 'customers' : col;
            const row = db.prepare(`SELECT data FROM ${tableName} WHERE id = ?`).get(id);
            return row ? JSON.parse(row.data) : null;
        } catch (e) { return null; }
    });

    // ---- store settings ------------------------------------------------------
  ipcMain.handle('db:saveStoreSettings', async (_, { storeId, settings }) => {
    try {
      const db = getDB();
      db.exec(`CREATE TABLE IF NOT EXISTS store_settings (id TEXT PRIMARY KEY, data TEXT);`);
      db.prepare(`INSERT OR REPLACE INTO store_settings (id, data) VALUES (?, ?)`).run(
        storeId,
        JSON.stringify(settings)
      );
      return { success: true };
    } catch (error) {
      console.error('Save store settings error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:save-store-settings', async (_, { storeId, settings }) => {
    const db = getDB();
    db.exec(`CREATE TABLE IF NOT EXISTS store_settings (id TEXT PRIMARY KEY, data TEXT);`);
    db.prepare(`INSERT OR REPLACE INTO store_settings (id, data) VALUES (?, ?)`).run(
      storeId,
      JSON.stringify(settings)
    );
    return { success: true };
  });

  ipcMain.handle('db:deleteDoc', (event, col, id) => {
        try {
            const tableName = col === 'directory_merchants' ? 'customers' : col;
            db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(id);
            return { success: true };
        } catch (e) { throw e; }
    });

    ipcMain.handle('db:executeBatch', (event, ops) => {
        try {
            db.transaction(() => {
                for (const op of ops) {
                    const tableName = op.col === 'directory_merchants' ? 'customers' : op.col;
                    
                    if (op.type === 'set' || op.type === 'update') {
                        const safeData = { ...op.data };
                        
                        // Handle our mocked increment() calls
                        for (const key in safeData) {
                            if (safeData[key] && safeData[key]._isIncrement) {
                                const existingRow = db.prepare(`SELECT data FROM ${tableName} WHERE id = ?`).get(op.id);
                                let currentVal = 0;
                                if (existingRow) {
                                    const parsed = JSON.parse(existingRow.data);
                                    currentVal = parseFloat(parsed[key]) || 0;
                                }
                                safeData[key] = currentVal + safeData[key].value;
                            }
                        }

                        if (!safeData.id) safeData.id = op.id;

                        let finalDataStr = JSON.stringify(safeData);

                        if (op.merge || op.type === 'update') {
                            const existingRow = db.prepare(`SELECT data FROM ${tableName} WHERE id = ?`).get(op.id);
                            if (existingRow) {
                                const merged = { ...JSON.parse(existingRow.data), ...safeData };
                                finalDataStr = JSON.stringify(merged);
                                db.prepare(`UPDATE ${tableName} SET data = ? WHERE id = ?`).run(finalDataStr, op.id);
                            } else {
                                db.prepare(`INSERT INTO ${tableName} (id, data) VALUES (?, ?)`).run(op.id, finalDataStr);
                            }
                        } else {
                            db.prepare(`INSERT OR REPLACE INTO ${tableName} (id, data) VALUES (?, ?)`).run(op.id, finalDataStr);
                        }

                        // Sync specific table columns for SQLite Lookups
                        const parsedData = JSON.parse(finalDataStr);
                        if (tableName === 'products') {
                            db.prepare(`UPDATE products SET stockLevel = ? WHERE id = ?`).run(parsedData.stockLevel || 0, op.id);
                        } else if (tableName === 'customers') {
                            db.prepare(`UPDATE customers SET type = ?, name = ?, phone = ?, dues = ?, loyaltyPoints = ? WHERE id = ?`)
                              .run(parsedData.type || 'customer', parsedData.name || '', parsedData.phone || '', parsedData.dues || 0, parsedData.loyaltyPoints || 0, op.id);
                        } else if (tableName === 'transactions') {
                            db.prepare(`UPDATE transactions SET timestamp = ?, type = ?, paymentMethod = ?, total = ? WHERE id = ?`)
                              .run(parsedData.timestamp || '', parsedData.type || 'SALE', parsedData.summary?.paymentMethod || '', parsedData.summary?.total || 0, op.id);
                        }
                    } 
                    else if (op.type === 'delete') {
                        db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(op.id);
                    }
                }
            })();
            return { success: true };
        } catch (e) {
            console.error("Batch Execution Error:", e);
            throw e;
        }
    });

// 🚀 OPTIMIZATION: High-speed single item lookup (Bypasses array mapping)
    ipcMain.handle('db:getProductByBarcode', (event, code) => {
        try {
            const stmt = db.prepare(`SELECT data, stockLevel FROM products WHERE barcode = ? OR sku = ? LIMIT 1`);
            const row = stmt.get(code, code);
            if (!row) return null;
            
            const parsedData = JSON.parse(row.data);
            parsedData.stockLevel = row.stockLevel; 
            return parsedData;
        } catch (e) {
            console.error("Optimized Barcode Lookup Failed:", e);
            return null;
        }
    });

    // 🚀 OPTIMIZATION: Atomic Stock Adjustment (MUST BE INSIDE THIS FUNCTION)
    ipcMain.handle('db:adjustStockAtomic', (event, { id, qtyChange }) => {
        try {
            const stmt = db.prepare(`UPDATE products SET stockLevel = stockLevel + ? WHERE id = ?`);
            const info = stmt.run(qtyChange, id);
            return { success: info.changes > 0 };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}