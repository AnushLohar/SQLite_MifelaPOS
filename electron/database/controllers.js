// electron/database/controllers.js
import { ipcMain } from 'electron';
import { getKnex } from './knex.js';

import LicenceStateManager from '../services/LicenceStateManager.js';

// Allowed table names for renderer-driven operations. Table names cannot be
// parameterized in SQL, so they MUST be whitelisted here to prevent injection.
const ALLOWED_TABLES = new Set([
  'products',
  'customers',
  'transactions',
  'security_config',
  'store_settings',
  'local_users',
  'licence_data',
]);

function resolveTable(col) {
  const tableName = col === 'directory_merchants' ? 'customers' : col;
  if (!ALLOWED_TABLES.has(tableName)) {
    throw new Error(`Table access denied: ${col}`);
  }
  return tableName;
}

export function registerDBHandlers() {
    const knex = getKnex();

    // Helper for authorization
    const authorize = async () => {
        const state = await LicenceStateManager.evaluateCurrentState();
        if (state !== 'ACTIVE') throw new Error("Terminal access denied: License " + state);
    };

    // =========================================================================
    // --- CORE FETCH HANDLERS ---
    // =========================================================================

    ipcMain.handle('db:getProducts', async () => {
        try {
            const rows = await knex('products').select('data');
            return rows.map(r => JSON.parse(r.data));
        } catch (e) {
            console.error("Failed to fetch products:", e);
            return [];
        }
    });

    ipcMain.handle('db:getTransactionsSince', async (event, isoDate) => {
        try {
            const rows = await knex('transactions')
                .select('data')
                .where('timestamp', '>=', isoDate)
                .orderBy('timestamp', 'desc');
            return rows.map(r => JSON.parse(r.data));
        } catch (e) {
            console.error("Failed to fetch transactions:", e);
            return [];
        }
    });

    ipcMain.handle('db:getPendingCheques', async () => {
        try {
            const rows = await knex('transactions')
                .select('*')
                .whereRaw("json_extract(data, '$.summary.paymentMethod') = ?", ['CHEQUE'])
                .andWhereRaw("json_extract(data, '$.summary.chequeDetails.status') = ?", ['PENDING']);
            return rows.map(row => JSON.parse(row.data));
        } catch (error) {
            console.error('Database read error (get-pending-cheques):', error);
            return [];
        }
    });

    // =========================================================================
    // --- CORE WRITE / TRANSACTION HANDLERS ---
    // =========================================================================

    ipcMain.handle('db:updateChequeStatus', async (event, txId, status, isoDate) => {
        try {
            const row = await knex('transactions').select('data').where({ id: txId }).first();
            if (!row) throw new Error("Transaction not found");

            const txData = JSON.parse(row.data);
            if (txData.summary && txData.summary.chequeDetails) {
                txData.summary.chequeDetails.status = status;
                txData.summary.chequeDetails.updatedAt = isoDate;
            }

            await knex('transactions')
                .where({ id: txId })
                .update({ data: JSON.stringify(txData) });

            return { success: true };
        } catch (error) {
            console.error("Error updating cheque:", error);
            throw error;
        }
    });

    ipcMain.handle('db:processSale', async (event, { transaction, customerUpdate }) => {
        await authorize();
        try {
            await knex.transaction(async (trx) => {
                await trx('transactions').insert({
                    id: transaction.id,
                    invoiceId: transaction.invoiceId,
                    locationId: transaction.locationId,
                    type: transaction.summary.transactionType,
                    timestamp: transaction.localTimestamp,
                    paymentMethod: transaction.summary.paymentMethod,
                    total: transaction.summary.total,
                    data: JSON.stringify(transaction)
                });

                for (const item of transaction.items) {
                    if (item.type !== 'homemade') {
                        await trx('products')
                            .where({ id: item.id })
                            .decrement('stockLevel', item.quantity);
                    }
                }

                if (customerUpdate && customerUpdate.id !== 'WALK-IN') {
                    if (customerUpdate.isNew) {
                        await trx('customers').insert({
                            id: customerUpdate.id,
                            name: customerUpdate.name,
                            phone: customerUpdate.phone,
                            dues: customerUpdate.ledgerChange,
                            loyaltyPoints: customerUpdate.loyaltyPointsChange,
                            data: JSON.stringify(customerUpdate)
                        });
                    } else {
                        await trx('customers')
                            .where({ id: customerUpdate.id })
                            .increment({
                                dues: customerUpdate.ledgerChange,
                                loyaltyPoints: customerUpdate.loyaltyPointsChange
                            });
                    }
                }
            });

            return { success: true };
        } catch (error) {
            console.error("SQLite processSale Error:", error);
            throw error;
        }
    });

    ipcMain.handle('db:processFinancialTransaction', async (event, { transaction, customerId, duesChange }) => {
        try {
            await knex.transaction(async (trx) => {
                await trx('transactions').insert({
                    id: transaction.id,
                    invoiceId: transaction.invoiceId,
                    locationId: transaction.locationId,
                    type: transaction.type,
                    timestamp: transaction.timestamp,
                    paymentMethod: transaction.summary.paymentMethod,
                    total: transaction.summary.total,
                    data: JSON.stringify(transaction)
                });

                await trx('customers')
                    .where({ id: customerId })
                    .increment('dues', duesChange);
            });
            return { success: true };
        } catch (e) { throw e; }
    });

    ipcMain.handle('db:getTransactionsForCustomer', async (event, customerId) => {
        try {
            const rows = await knex('transactions')
                .select('data')
                .whereRaw("json_extract(data, '$.customer.id') = ?", [customerId])
                .orderBy('timestamp', 'desc');
            return rows.map(r => JSON.parse(r.data));
        } catch (e) { throw e; }
    });

    ipcMain.handle('db:executeLedgerMerge', async (event, { selectedTxIds, customerId, customerName }) => {
        try {
            let netTotal = 0;
            let combinedItems = [];
            let bundledOriginals = [];
            let primaryCustomerData = null;

            const mergedId = `MRG-${Date.now().toString().slice(-6)}`;

            await knex.transaction(async (trx) => {
                for (let id of selectedTxIds) {
                    const row = await trx('transactions').select('data').where({ id }).first();
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

                        await trx('transactions').where({ id }).delete();
                    }
                }

                const mergedTx = {
                    id: mergedId, invoiceId: mergedId, locationId: 'main',
                    timestamp: new Date().toISOString(), type: 'MERGED_LEDGER',
                    customer: primaryCustomerData || { id: customerId, name: customerName },
                    summary: { total: netTotal, profit: 0, paymentMethod: 'MERGED', reason: `Merged ${selectedTxIds.length} records`, transactionType: 'MERGED_LEDGER' },
                    items: combinedItems, _archivedRecords: bundledOriginals
                };

                await trx('transactions').insert({
                    id: mergedId,
                    invoiceId: mergedId,
                    locationId: 'main',
                    type: 'MERGED_LEDGER',
                    timestamp: mergedTx.timestamp,
                    paymentMethod: 'MERGED',
                    total: netTotal,
                    data: JSON.stringify(mergedTx)
                });
            });

            return { success: true, mergedId };
        } catch (e) { throw e; }
    });

    ipcMain.handle('db:undoLedgerMerge', async (event, mergedTxId) => {
        try {
            await knex.transaction(async (trx) => {
                const row = await trx('transactions').select('data').where({ id: mergedTxId }).first();
                if (!row) throw new Error("Merged record not found.");

                const data = JSON.parse(row.data);
                const archivedRecords = data._archivedRecords || [];

                for (const record of archivedRecords) {
                    await trx('transactions').insert({
                        id: record.id,
                        invoiceId: record.data.invoiceId,
                        locationId: record.data.locationId,
                        type: record.data.type,
                        timestamp: record.data.timestamp,
                        paymentMethod: record.data.summary?.paymentMethod,
                        total: record.data.summary?.total,
                        data: JSON.stringify(record.data)
                    });
                }

                await trx('transactions').where({ id: mergedTxId }).delete();
            });
            return { success: true };
        } catch (e) { throw e; }
    });

    // =========================================================================
    // --- UNIFIED CUSTOMER & DIRECTORY HANDLERS ---
    // =========================================================================

    const fetchCustomers = async () => {
        try {
            const rows = await knex('customers').select('data', 'dues', 'loyaltyPoints');
            return rows.map(r => ({ ...JSON.parse(r.data), dues: r.dues, loyaltyPoints: r.loyaltyPoints }));
        } catch (e) {
            console.error("Failed to fetch customers:", e);
            return [];
        }
    };

    ipcMain.handle('db:getCustomers', fetchCustomers);
    ipcMain.handle('db:get-customers', fetchCustomers);

    const savePartner = async (event, { customer, obTransaction }) => {
        try {
            await knex.transaction(async (trx) => {
                const existing = await trx('customers').select('id').where({ id: customer.id }).first();
                if (existing) {
                    await trx('customers').where({ id: customer.id }).update({
                        name: customer.name,
                        phone: customer.phone,
                        type: customer.type,
                        dues: customer.dues || 0,
                        loyaltyPoints: customer.loyaltyPoints || 0,
                        data: JSON.stringify(customer)
                    });
                } else {
                    await trx('customers').insert({
                        id: customer.id,
                        name: customer.name,
                        phone: customer.phone,
                        type: customer.type,
                        dues: customer.dues || 0,
                        loyaltyPoints: customer.loyaltyPoints || 0,
                        data: JSON.stringify(customer)
                    });
                }

                if (obTransaction) {
                    await trx('transactions').insert({
                        id: obTransaction.id,
                        invoiceId: obTransaction.invoiceId,
                        locationId: obTransaction.locationId,
                        type: obTransaction.type,
                        timestamp: obTransaction.timestamp,
                        paymentMethod: obTransaction.summary?.paymentMethod || 'SYSTEM',
                        total: obTransaction.summary?.total || 0,
                        data: JSON.stringify(obTransaction)
                    });
                }
            });
            return { success: true };
        } catch (e) { throw e; }
    };

    ipcMain.handle('db:savePartner', savePartner);
    ipcMain.handle('db:save-partner', savePartner);

    ipcMain.handle('db:deleteCustomer', async (event, id) => {
        try {
            await knex('customers').where({ id }).delete();
            return { success: true };
        } catch (e) { throw e; }
    });

    ipcMain.handle('db:resetPartnerAccount', async (event, id) => {
        try {
            await knex.transaction(async (trx) => {
                await trx('transactions').whereRaw("json_extract(data, '$.customer.id') = ?", [id]).delete();
                await trx('customers').where({ id }).update({ dues: 0, loyaltyPoints: 0 });
            });
            return { success: true };
        } catch (e) { throw e; }
    });

    ipcMain.handle('db:updateLoyaltyTokens', async (event, customerId, tokensEarned) => {
        try {
            await knex('customers').where({ id: customerId }).increment('loyaltyPoints', tokensEarned);
            return { success: true };
        } catch (e) { throw e; }
    });

    ipcMain.handle('db:runDirectoryCleanup', async (event, type) => {
        try {
            let mergedCount = 0;
            await knex.transaction(async (trx) => {
                const customers = await trx('customers').where({ type });
                const phoneGroups = {};

                customers.forEach(row => {
                    const data = JSON.parse(row.data);
                    const phoneDigits = (data.phone || '').replace(/\D/g, '').slice(-10);
                    if (phoneDigits.length === 10) {
                        if (!phoneGroups[phoneDigits]) phoneGroups[phoneDigits] = [];
                        phoneGroups[phoneDigits].push({ id: row.id, data, dbDues: row.dues, dbPts: row.loyaltyPoints });
                    }
                });

                for (const phone in phoneGroups) {
                    const group = phoneGroups[phone];
                    if (group.length > 1) {
                        group.sort((a, b) => (new Date(a.data.createdAt || 0)).getTime() - (new Date(b.data.createdAt || 0)).getTime());
                        const primary = group[0];
                        const duplicates = group.slice(1);

                        for (const dup of duplicates) {
                            await trx('transactions')
                                .whereRaw("json_extract(data, '$.customer.id') = ?", [dup.id])
                                .update({ data: knex.raw("json_set(data, '$.customer.id', ?)", [primary.id]) });

                            await trx('customers')
                                .where({ id: primary.id })
                                .increment({
                                    dues: dup.dbDues,
                                    loyaltyPoints: dup.dbPts
                                });

                            await trx('customers').where({ id: dup.id }).delete();
                            mergedCount++;
                        }
                    }
                }
            });
            return { success: true, mergedCount };
        } catch(e) {
            console.error("Cleanup error:", e);
            throw e;
        }
    });

    ipcMain.handle('db:getSupplierByPhone', async (event, phoneDigits) => {
        try {
            const row = await knex('customers')
                .select('data')
                .whereIn('type', ['supplier', 'dealer', 'store'])
                .andWhereRaw("json_extract(data, '$.phone') LIKE ?", [`%${phoneDigits}`])
                .first();
            return row ? JSON.parse(row.data) : null;
        } catch (e) {
            console.error("Failed to fetch supplier by phone:", e);
            return null;
        }
    });

    ipcMain.handle('db:getSupplierByGSTIN', async (event, gstin) => {
        try {
            const row = await knex('customers')
                .select('data')
                .whereIn('type', ['supplier', 'dealer', 'store'])
                .andWhereRaw("json_extract(data, '$.gstin') = ?", [gstin])
                .first();
            return row ? JSON.parse(row.data) : null;
        } catch (e) {
            console.error("Failed to fetch supplier by GSTIN:", e);
            return null;
        }
    });

    ipcMain.handle('db:logTelemetry', (event, action, data) => {
        try {
            console.log(`[Offline Telemetry] ${action}:`, data);
            return { success: true };
        } catch (e) {
            return { success: false };
        }
    });

    ipcMain.handle('db:getDoc', async (event, col, id) => {
        try {
            const tableName = resolveTable(col);
            const row = await knex(tableName).select('data').where({ id }).first();
            return row ? JSON.parse(row.data) : null;
        } catch (e) { return null; }
    });

    ipcMain.handle('db:save-store-settings', async (_, { storeId, settings }) => {
        try {
            await knex.schema.hasTable('store_settings').then(async (exists) => {
                if (!exists) {
                    await knex.schema.createTable('store_settings', table => {
                        table.text('id').primary();
                        table.text('data');
                    });
                }
            });

            await knex('store_settings')
                .insert({ id: storeId, data: JSON.stringify(settings) })
                .onConflict('id')
                .merge();
            return { success: true };
        } catch (error) {
            console.error('Save store settings error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('db:deleteDoc', async (event, col, id) => {
        try {
            const tableName = resolveTable(col);
            await knex(tableName).where({ id }).delete();
            return { success: true };
        } catch (e) { throw e; }
    });

    // Attendance persistence (renderer-driven; table name is fixed, not user input)
    ipcMain.handle('db:saveAttendance', async (_, payload) => {
        try {
            const { staffId, date, status, ...rest } = payload;
            const docId = `att_${date}`;
            await knex('customers')
                .insert({ id: docId, data: JSON.stringify({ date, records: { [staffId]: { status, ...rest } }, updatedAt: new Date().toISOString(), locationId: 'main' }) })
                .onConflict('id')
                .merge();
            return { success: true };
        } catch (e) { throw e; }
    });

    ipcMain.handle('db:getMonthlyAttendance', async (_, monthStr) => {
        try {
            const rows = await knex('customers')
                .select('data')
                .whereRaw("json_extract(data, '$.date') LIKE ?", [`${monthStr}%`]);
            const result = {};
            rows.forEach(r => {
                try { Object.assign(result, JSON.parse(r.data).records || {}); } catch { /* ignore malformed rows */ }
            });
            return result;
        } catch (e) { return {}; }
    });

    ipcMain.handle('db:executeBatch', async (event, ops) => {
        try {
            await knex.transaction(async (trx) => {
                for (const op of ops) {
                    const tableName = resolveTable(op.col);

                    if (op.type === 'set' || op.type === 'update') {
                        const safeData = { ...op.data };

                        for (const key in safeData) {
                            if (safeData[key] && safeData[key]._isIncrement) {
                                const existingRow = await trx(tableName).select('data').where({ id: op.id }).first();
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
                            const existingRow = await trx(tableName).select('data').where({ id: op.id }).first();
                            if (existingRow) {
                                const merged = { ...JSON.parse(existingRow.data), ...safeData };
                                finalDataStr = JSON.stringify(merged);
                                await trx(tableName).where({ id: op.id }).update({ data: finalDataStr });
                            } else {
                                await trx(tableName).insert({ id: op.id, data: finalDataStr });
                            }
                        } else {
                            await trx(tableName).insert({ id: op.id, data: finalDataStr }).onConflict('id').merge();
                        }

                        const parsedData = JSON.parse(finalDataStr);
                        if (tableName === 'products') {
                            await trx('products').where({ id: op.id }).update({ stockLevel: parsedData.stockLevel || 0 });
                        } else if (tableName === 'customers') {
                            await trx('customers').where({ id: op.id }).update({
                                type: parsedData.type || 'customer',
                                name: parsedData.name || '',
                                phone: parsedData.phone || '',
                                dues: parsedData.dues || 0,
                                loyaltyPoints: parsedData.loyaltyPoints || 0
                            });
                        } else if (tableName === 'transactions') {
                            await trx('transactions').where({ id: op.id }).update({
                                timestamp: parsedData.timestamp || '',
                                type: parsedData.type || 'SALE',
                                paymentMethod: parsedData.summary?.paymentMethod || '',
                                total: parsedData.summary?.total || 0
                            });
                        }
                    }
                    else if (op.type === 'delete') {
                        await trx(tableName).where({ id: op.id }).delete();
                    }
                }
            });
            return { success: true };
        } catch (e) {
            console.error("Batch Execution Error:", e);
            throw e;
        }
    });

    ipcMain.handle('db:getProductByBarcode', async (event, code) => {
        try {
            const row = await knex('products')
                .select('data', 'stockLevel')
                .where('barcode', '=', code)
                .orWhere('sku', '=', code)
                .first();
            if (!row) return null;

            const parsedData = JSON.parse(row.data);
            parsedData.stockLevel = row.stockLevel;
            return parsedData;
        } catch (e) {
            console.error("Optimized Barcode Lookup Failed:", e);
            return null;
        }
    });

    ipcMain.handle('db:adjustStockAtomic', async (event, { id, qtyChange }) => {
        try {
            const count = await knex('products')
                .where({ id })
                .increment('stockLevel', qtyChange);
            return { success: count > 0 };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}
