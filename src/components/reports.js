// src/components/reports.js

// --- Imports ---
import {
    getStoreId,
    appId,
    getCurrencySymbol,
    getTransactionsRef,
    getProductsRef,
    getUserRole,
    getCurrentLocationId,
    getAvailableLocations,
    setCurrentLocation,
    getUserAssignedLocationId,
    getCurrentUserPlan
} from '../store/state.js';

import { DOM, showModal } from '../utils/dom.js';
import { safeMath } from '../utils/math.js';
import { escapeHTML } from '../utils/security.js';

// --- Helper: Local Time ISO Month ---
const getLocalISOMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// --- Helper: Normalize Plan ---
function normalizePlan(planString) {
    if (!planString) return 'free';
    const plan = planString.toLowerCase();
    if (plan === 'standard') return 'silver';
    if (plan === 'premium') return 'platinum';
    return plan;
}

function renderAccessDenied(isAllowedRole) {
    const grid = DOM.reports.grid;
    if (!grid) return;

    grid.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center py-24 text-center animate-scaleIn">
            <div class="bg-red-50 p-6 rounded-full mb-6">
                <svg class="w-16 h-16 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m0 0v2m0-2h2m-2 0H10m11 0a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            </div>
            <h2 class="text-2xl font-bold text-gray-800">Permission Denied</h2>
            <p class="text-gray-500 mt-2 max-w-md">Access to financial statements is restricted to Administrators, Accountants, and Store Managers.</p>
            <button onclick="document.getElementById('nav-dashboard').click()" class="mt-8 px-8 py-3 bg-gray-800 text-white rounded-xl font-bold hover:bg-gray-900 shadow-lg transition-all active:scale-95">Return to Dashboard</button>
        </div>
    `;
}

// Inside src/components/reports.js

// Back-compat stub (navigation.js falls back to this name)
export async function initReports() {
    await renderReportLibraryPage();
}

export async function renderReportLibraryPage() {
    if (!DOM.reports.grid) return;

    DOM.reports.grid.innerHTML = '';

    // Security & Access Checks
    const role = getUserRole();
    const allowedRoles = ['admin', 'accountant', 'store_manager'];
    const isAllowedRole = allowedRoles.includes(role);

    // 🚀 THE FIX: Removed hasReportPlan entirely. Just check the Role.
    if (!isAllowedRole) {
        renderAccessDenied(isAllowedRole);
        return;
    }

    const assignedLoc = getUserAssignedLocationId();
    let currentLoc = getCurrentLocationId();
    const canAccessAllLocations = (role === 'admin' || role === 'accountant');

    if (!canAccessAllLocations && currentLoc !== assignedLoc) {
        setCurrentLocation(assignedLoc);
        currentLoc = assignedLoc;
    }

    // Loading State
    DOM.reports.grid.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center py-20">
            <div class="animate-spin rounded-full h-10 w-10 border-4 border-SLATE-100 border-t-SLATE-600 mb-4"></div>
            <p class="text-gray-500 font-medium">Analyzing historical data...</p>
        </div>
    `;

    const myGenerationId = ++currentGenerationId;

    try {
        resetFinancials();
        await calculateFinancials(myGenerationId);
        if (myGenerationId !== currentGenerationId) return;

        await loadSavedManualInputs();
        if (myGenerationId !== currentGenerationId) return;

        renderFinancialUI();
    } catch (error) {
        if (myGenerationId !== currentGenerationId) return;
        console.error("Reports Error:", error);

        DOM.reports.grid.innerHTML = `
            <div class="col-span-full text-center p-10 bg-red-50 rounded-xl border border-red-200 text-red-700 mt-6">
                <p class="font-bold text-lg mb-2">Report Generation Failed</p>
                <p class="text-sm opacity-80">${escapeHTML(error.message)}</p>
                <button id="btn-report-retry" class="mt-4 px-6 py-2 bg-white border border-red-300 text-red-700 rounded-lg hover:bg-red-50 font-medium shadow-sm transition">Try Again</button>
            </div>
        `;

        const retryBtn = document.getElementById('btn-report-retry');
        if (retryBtn) retryBtn.onclick = () => renderReportLibraryPage();
    }
}

// --- State for Reports ---
let financials = {
    trading: { sales: 0, purchases: 0, closingStock: 0, openingStock: 0, directExpenses: 0, grossProfit: 0 },
    pl: {
        otherIncome: 0,
        expenses: { salaries: 0, rent: 0, utilities: 0, internet: 0, marketing: 0, packaging: 0, repairs: 0, travel: 0, general: 0, depreciation: 0 },
        customExpenses: [],
        netProfit: 0
    },
    bs: { capital: 0, drawings: 0, securedLoans: 0, unsecuredLoans: 0, reserves: 0, sundryCreditors: 0, fixedAssets: [], sundryDebtors: 0, cashInHand: 0, bankAccounts: 0, closingStockBS: 0 },
    gstSummary: {},
    itcSummary: {},
    analytics: { daily: {}, products: {}, lowStock: [] }, // 🚀 NEW: Time-series and Product data for Charts
    anomalies: [], // 🚀 NEW: Array to hold detected issues
    // 🚀 B2B & D2C INTELLIGENCE: Customer / Supplier ledgers, aging, payment mix
    b2bD2c: {
        b2bSales: 0,
        d2cSales: 0,
        b2bPurchases: 0,
        d2cPurchases: 0,
        b2bCustomers: {},   // { custId: { name, gstin, pan, type, sales, purchases, dues, lastSaleDate, invoiceCount, creditUsed } }
        d2cCustomers: {},   // { custId: { name, phone, sales, purchases, dues, lastSaleDate, invoiceCount, loyaltyPoints } }
        suppliers: {},      // { supId: { name, gstin, purchases, lastPurchase, paymentDue } }
        paymentSummary: { Cash: 0, Card: 0, UPI: 0, Credit: 0, Cheque: 0, Split: 0, Internal: 0 },
        hourlySales: {},    // { hour: sales }
        b2bInvoices: [],    // Array of B2B invoice objects for the Tax Invoice Register
        topProducts: {},    // { name: { qty, revenue, cost, margin, category } } - D2C top sellers
    },
    periodType: 'monthly',
    periodValue: getLocalISOMonth(),
    selectedYear: new Date().getFullYear(),
    activeReportView: 'all'
};

let saveTimeout = null;
let listenersAttached = false;
let currentGenerationId = 0;

function resetFinancials() {
    const pType = financials.periodType;
    const pValue = financials.periodValue;
    const sYear = financials.selectedYear;
    const currentView = financials.activeReportView || 'all';

    financials = {
        trading: { sales: 0, purchases: 0, closingStock: 0, openingStock: 0, directExpenses: 0, grossProfit: 0 },
        pl: {
            otherIncome: 0,
            expenses: { salaries: 0, rent: 0, utilities: 0, internet: 0, marketing: 0, packaging: 0, repairs: 0, travel: 0, general: 0, depreciation: 0 },
            customExpenses: [],
            netProfit: 0
        },
        bs: { capital: 0, drawings: 0, securedLoans: 0, unsecuredLoans: 0, reserves: 0, sundryCreditors: 0, fixedAssets: [], sundryDebtors: 0, cashInHand: 0, bankAccounts: 0, closingStockBS: 0 },
        gstSummary: {},
        itcSummary: {},
        analytics: { daily: {}, products: {}, lowStock: [] }, // 🚀 Reset Chart Data
        anomalies: [], // 🚀 NEW: Array to hold detected issues
        b2bD2c: {
            b2bSales: 0, d2cSales: 0, b2bPurchases: 0, d2cPurchases: 0,
            b2bCustomers: {}, d2cCustomers: {}, suppliers: {},
            paymentSummary: { Cash: 0, Card: 0, UPI: 0, Credit: 0, Cheque: 0, Split: 0, Internal: 0 },
            hourlySales: {}, b2bInvoices: [], topProducts: {}
        },
        periodType: pType,
        periodValue: pValue,
        selectedYear: sYear,
        activeReportView: currentView
    };
}

async function calculateHistoricalStockValue(targetDate) {
    const today = new Date();
    if (targetDate >= today.setHours(0, 0, 0, 0)) {
        return calculateCurrentStockValue();
    }

    const currentLocationId = getCurrentLocationId();
    let productMap = new Map();

    // 🚀 THE FIX: Fetch from SQLite
    if (window.dbAPI && window.dbAPI.getProducts) {
        const products = await window.dbAPI.getProducts();
        products.forEach(p => {
            if (currentLocationId !== 'all' && p.locationId !== currentLocationId) return;
            if (p.type === 'homemade') return;

            const created = p.createdAt ? new Date(p.createdAt) : new Date(0);
            if (created <= targetDate) {
                productMap.set(p.id, {
                    cost: parseFloat(p.costPrice || p.cost) || 0,
                    histStock: parseFloat(p.stockLevel) || 0
                });
            }
        });
    }

    if (window.dbAPI && window.dbAPI.getTransactionsSince) {
        const txs = await window.dbAPI.getTransactionsSince(targetDate.toISOString());
        txs.forEach(tx => {
            if (currentLocationId !== 'all' && tx.locationId !== currentLocationId) return;

            // Parse SQLite JSON if necessary
            const items = typeof tx.items === 'string' ? JSON.parse(tx.items) : (tx.items || []);

            items.forEach(item => {
                if (productMap.has(item.id)) {
                    const p = productMap.get(item.id);
                    const qty = parseFloat(item.quantity) || 0;

                    if (tx.type === 'SALE' || tx.type === 'REFUND') {
                        if (tx.type === 'SALE') p.histStock += qty;
                        else p.histStock -= qty;
                    } else if (tx.type === 'PURCHASE') {
                        p.histStock -= qty;
                    }
                }
            });
        });
    }

    let totalValue = 0;
    productMap.forEach(p => {
        const validStock = Math.max(0, p.histStock);
        totalValue += safeMath.multiply(validStock, p.cost);
    });

    return totalValue;
}

async function calculateCurrentStockValue() {
    let total = 0;
    const currentLocationId = getCurrentLocationId();

    // 🚀 THE FIX: Fetch from SQLite
    if (window.dbAPI && window.dbAPI.getProducts) {
        const products = await window.dbAPI.getProducts();
        products.forEach(p => {
            if (currentLocationId !== 'all' && p.locationId !== currentLocationId) return;
            if (p.type === 'homemade') return;

            total = safeMath.add(total, safeMath.multiply(p.stockLevel || 0, p.costPrice || p.cost || 0));
        });
    }
    return total;
}

// 🚀 B2B & D2C INTELLIGENCE: Customer / Supplier ledger, payment mix, hourly sales
function collectB2BD2CIntelligence(tx, txType, total, dateObj, isoDate) {
    const intel = financials.b2bD2c;
    const cust = tx.customer || {};
    const summary = tx.summary || {};

    // --- Payment Mix (Cashflow) ---
    const payMethod = (summary.paymentMethod || tx.paymentMethod || 'Cash').toString();
    if (!intel.paymentSummary[payMethod]) intel.paymentSummary[payMethod] = 0;
    intel.paymentSummary[payMethod] = safeMath.add(intel.paymentSummary[payMethod], Math.abs(total));

    // --- Hourly Sales (D2C footfall) ---
    const hour = dateObj.getHours();
    if (!intel.hourlySales[hour]) intel.hourlySales[hour] = 0;
    intel.hourlySales[hour] = safeMath.add(intel.hourlySales[hour], Math.abs(total));

    // --- B2B vs D2C Split ---
    const isB2B = (cust.gstin && cust.gstin.trim().length >= 15) || (cust.type === 'dealer') || (cust.type === 'supplier');

    if (txType === 'SALE' || txType === 'REFUND') {
        const sign = txType === 'REFUND' ? -1 : 1;
        const netTotal = Math.abs(total) * sign;

        if (isB2B) {
            intel.b2bSales = safeMath.add(intel.b2bSales, netTotal);
            const entry = intel.b2bCustomers[cust.id] || {
                name: cust.name || 'Walk-in',
                gstin: cust.gstin || '',
                pan: cust.pan || '',
                type: cust.type || 'dealer',
                sales: 0, purchases: 0, dues: 0, lastSaleDate: isoDate,
                invoiceCount: 0, creditUsed: 0
            };
            entry.sales = safeMath.add(entry.sales, netTotal);
            entry.lastSaleDate = isoDate;
            entry.invoiceCount += 1;
            entry.dues = safeMath.add(entry.dues, parseFloat(cust.dues || 0));
            intel.b2bCustomers[cust.id] = entry;

            // Tax Invoice Register (B2B)
            intel.b2bInvoices.push({
                invoiceId: tx.invoiceId || tx.id,
                date: isoDate,
                customer: entry.name,
                gstin: entry.gstin,
                pan: entry.pan,
                total: netTotal,
                paymentMethod: payMethod
            });
        } else {
            intel.d2cSales = safeMath.add(intel.d2cSales, netTotal);
            const entry = intel.d2cCustomers[cust.id] || {
                name: cust.name || 'Walk-in Customer',
                phone: cust.phone || '',
                sales: 0, purchases: 0, dues: 0, lastSaleDate: isoDate,
                invoiceCount: 0, loyaltyPoints: 0
            };
            entry.sales = safeMath.add(entry.sales, netTotal);
            entry.lastSaleDate = isoDate;
            entry.invoiceCount += 1;
            entry.dues = safeMath.add(entry.dues, parseFloat(cust.dues || 0));
            intel.d2cCustomers[cust.id] = entry;
        }

        // --- Top Products (D2C top sellers) ---
        (tx.items || []).forEach(item => {
            if (item.type === 'homemade' || item.type === 'bundle') return;
            const qty = Math.abs(item.quantity || 0);
            const revenue = safeMath.multiply(item.price || 0, qty);
            const cost = safeMath.multiply(item.cost || item.purchasePrice || 0, qty);
            const name = item.name || 'Unknown';
            const t = intel.topProducts[name] || { qty: 0, revenue: 0, cost: 0, margin: 0, category: item.type || 'standard' };
            t.qty = safeMath.add(t.qty, qty);
            t.revenue = safeMath.add(t.revenue, revenue);
            t.cost = safeMath.add(t.cost, cost);
            t.margin = safeMath.subtract(t.revenue, t.cost);
            intel.topProducts[name] = t;
        });
    } else if (txType === 'PURCHASE') {
        const isB2BPurchase = isB2B;
        if (isB2BPurchase) {
            intel.b2bPurchases = safeMath.add(intel.b2bPurchases, Math.abs(total));
        } else {
            intel.d2cPurchases = safeMath.add(intel.d2cPurchases, Math.abs(total));
        }

        // --- Supplier Intelligence ---
        const supId = cust.id || cust.phone || 'WALK-IN-SUPPLIER';
        const sup = intel.suppliers[supId] || {
            name: cust.name || 'Walk-in Supplier',
            gstin: cust.gstin || '',
            purchases: 0, lastPurchase: isoDate, paymentDue: 0
        };
        sup.purchases = safeMath.add(sup.purchases, Math.abs(total));
        sup.lastPurchase = isoDate;
        sup.paymentDue = safeMath.add(sup.paymentDue, Math.abs(total));
        intel.suppliers[supId] = sup;
    }
}

async function calculateFinancials(genId) {
    const storeId = getStoreId();
    if (!storeId) return;

    let startDate, endDate;

    if (financials.periodType === 'monthly') {
        const [y, m] = financials.periodValue.split('-');
        startDate = new Date(parseInt(y), parseInt(m) - 1, 1, 0, 0, 0, 0);
        endDate = new Date(parseInt(y), parseInt(m), 0, 23, 59, 59, 999);
    } else {
        // Handle Quarterly Math
        const [y, qStr] = financials.periodValue.split('-');
        const year = parseInt(y);
        let startMonth = 0, endMonth = 2; // Default Q1

        if (qStr === 'Q2_CAL') { startMonth = 3; endMonth = 5; }
        else if (qStr === 'Q3_CAL') { startMonth = 6; endMonth = 8; }
        else if (qStr === 'Q4_CAL') { startMonth = 9; endMonth = 11; }

        startDate = new Date(year, startMonth, 1, 0, 0, 0, 0);
        endDate = new Date(year, endMonth + 1, 0, 23, 59, 59, 999);
    }


    try {
        const currentLocationId = getCurrentLocationId();

        // 🚀 THE FIX: Fetch Transactions via SQLite and filter by Date/Location
        let txs = [];
        if (window.dbAPI && window.dbAPI.getTransactionsSince) {
            const rawTxs = await window.dbAPI.getTransactionsSince(startDate.toISOString());
            txs = rawTxs.filter(tx => {
                const tDate = new Date(tx.timestamp);
                const locMatch = currentLocationId === 'all' || tx.locationId === currentLocationId;
                return locMatch && tDate <= endDate;
            });
        }

        if (genId !== currentGenerationId) return;

        // Iterate through the local array instead of a Firebase Snapshot
        txs.forEach(tx => {
            // Parse SQLite JSON items if necessary
            if (typeof tx.items === 'string') {
                try { tx.items = JSON.parse(tx.items); } catch (e) { tx.items = []; }
            }

            const txType = (tx.type || tx.summary?.transactionType || 'UNKNOWN').toUpperCase();
            let total = Math.abs(parseFloat(tx.summary?.total || 0));

            let homemadeDeduction = 0;
            let pureInventoryCost = 0;
            let pureTaxableSales = 0;

            if (tx.items && Array.isArray(tx.items)) {
                tx.items.forEach(item => {
                    const qty = Math.abs(parseFloat(item.quantity) || 0);

                    if (item.type === 'homemade') {
                        const lineVal = item.subtotal !== undefined ? Math.abs(item.subtotal) : (parseFloat(item.price || item.cost || 0) * qty);
                        homemadeDeduction += lineVal;
                    } else if (item.type !== 'bundle') {
                        // Pure Inventory Cost: Base Unit Cost * Quantity
                        pureInventoryCost += (qty * parseFloat(item.cost || item.purchasePrice || item.price || 0));

                        // Pure Taxable Sales: Revenue without GST
                        pureTaxableSales += parseFloat(item.taxableValue || item.taxableAmt || item.subtotal || (qty * parseFloat(item.price || 0)));
                    }
                });
            }

            // Reduce the total by the amount belonging to homemade goods
            total = Math.max(0, total - homemadeDeduction);

            // 🚀 TIME-SERIES EXTRACTION FOR CHARTS
            const dateObj = tx.timestamp?.toDate ? tx.timestamp.toDate() : new Date();
            const isoDate = dateObj.toISOString().split('T')[0];
            const displayDate = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

            if (!financials.analytics.daily[isoDate]) {
                financials.analytics.daily[isoDate] = { display: displayDate, sales: 0, purchases: 0, expenses: 0 };
            }

            // 1. Trading Account (Sales vs Purchases)
            if (txType === 'SALE' || txType === 'REFUND') {
                if (txType === 'REFUND') {
                    // Trading Account uses Taxable Value; Charts use Cashflow (Total)
                    financials.trading.sales = Math.max(0, safeMath.subtract(financials.trading.sales, pureTaxableSales));
                    financials.analytics.daily[isoDate].sales = Math.max(0, financials.analytics.daily[isoDate].sales - total);
                } else {
                    financials.trading.sales = safeMath.add(financials.trading.sales, pureTaxableSales);
                    financials.analytics.daily[isoDate].sales += total;
                }

                // Track Product Charts
                tx.items?.forEach(item => {
                    if (item.type === 'homemade' || item.type === 'bundle') return;
                    if (txType === 'REFUND') return;

                    // Product Sales Chart Data
                    const qty = Math.abs(item.quantity || 0);
                    const itemRev = safeMath.multiply(item.price || 0, qty);
                    if (!financials.analytics.products[item.name]) financials.analytics.products[item.name] = 0;
                    financials.analytics.products[item.name] += itemRev;

                    const slab = parseFloat(item.taxRate || item.gstSlab || item.tax || 0);
                    const cessRate = parseFloat(item.cessRate || item.cess || 0);

                    if (!financials.gstSummary[slab]) financials.gstSummary[slab] = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };

                    const itemTotal = safeMath.multiply(item.price || 0, Math.abs(item.quantity || 0));
                    const combinedRate = slab + cessRate;
                    const taxable = item.taxableValue || (itemTotal / (1 + (combinedRate / 100)));

                    const taxAmt = item.taxAmount || (taxable * (slab / 100));
                    const cessAmt = item.cessAmount || (taxable * (cessRate / 100));

                    financials.gstSummary[slab].taxable += taxable;
                    financials.gstSummary[slab].cess += cessAmt;

                    if (item.isOms || item.oms) {
                        financials.gstSummary[slab].igst += taxAmt;
                    } else {
                        financials.gstSummary[slab].cgst += taxAmt / 2;
                        financials.gstSummary[slab].sgst += taxAmt / 2;
                    }
                });

            } else if (txType === 'PURCHASE') {
                // 🚀 THE FIX: Trading Account Purchases MUST equal the pure base cost added to stock!
                // Adding the invoice 'total' includes GST, which instantly creates a phantom loss.
                let pureInventoryValue = 0;
                (tx.items || []).forEach(item => {
                    // Ignore homemade items in physical stock valuations
                    if (item.type !== 'homemade' && item.type !== 'bundle') {
                        pureInventoryValue += (Math.abs(item.quantity || 0) * parseFloat(item.cost || item.purchasePrice || item.baseRate || 0));
                    }
                });

                financials.trading.purchases = safeMath.add(financials.trading.purchases, pureInventoryValue);
                financials.analytics.daily[isoDate].purchases += total; // Keep charts showing real cashflow

                tx.items?.forEach(item => {
                    if (item.type === 'homemade' || item.type === 'bundle') return;
                    const slab = parseFloat(item.taxRate || item.gstSlab || item.tax || 0);
                    const cessRate = parseFloat(item.cessRate || item.cess || 0);

                    if (!financials.itcSummary[slab]) financials.itcSummary[slab] = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };

                    const itemTotal = safeMath.multiply(item.cost || item.purchasePrice || item.price || 0, Math.abs(item.quantity || 0));
                    const combinedRate = slab + cessRate;

                    const taxable = item.taxableValue || (itemTotal / (1 + (combinedRate / 100)));
                    const taxAmt = item.taxAmount || (taxable * (slab / 100));
                    const cessAmt = item.cessAmount || (taxable * (cessRate / 100));

                    financials.itcSummary[slab].taxable += taxable;
                    financials.itcSummary[slab].cess += cessAmt;

                    if (item.oms) {
                        financials.itcSummary[slab].igst += taxAmt;
                    } else {
                        financials.itcSummary[slab].cgst += taxAmt / 2;
                        financials.itcSummary[slab].sgst += taxAmt / 2;
                    }
                });
            }

            // 2. P&L Expenses
            else if (txType === 'EXPENSE' || txType === 'SALARY') {
                financials.analytics.daily[isoDate].expenses += total; // 🚀 Chart Data

                let cat = (tx.category || tx.summary?.reason || 'general').toLowerCase();

                // Map common terms to standard buckets
                if (cat.includes('salary') || txType === 'SALARY') cat = 'salaries';
                else if (cat.includes('rent')) cat = 'rent';
                else if (cat.includes('util') || cat.includes('electric')) cat = 'utilities';
                else if (cat.includes('internet') || cat.includes('wifi')) cat = 'internet';
                else if (cat.includes('market') || cat.includes('ad')) cat = 'marketing';
                else if (cat.includes('pack')) cat = 'packaging';
                else if (cat.includes('repair') || cat.includes('maint')) cat = 'repairs';
                else if (cat.includes('travel') || cat.includes('transport')) cat = 'travel';

                if (Object.prototype.hasOwnProperty.call(financials.pl.expenses, cat)) {
                    financials.pl.expenses[cat] = safeMath.add(financials.pl.expenses[cat], total);
                } else {
                    financials.pl.expenses.general = safeMath.add(financials.pl.expenses.general, total);
                }
            }

            // 🚀 B2B & D2C INTELLIGENCE: Customer / Supplier ledger, payment mix, hourly sales
            collectB2BD2CIntelligence(tx, txType, total, dateObj, isoDate);
        });

        // 3. Stock Values
        financials.trading.openingStock = await calculateHistoricalStockValue(startDate);
        financials.trading.closingStock = await calculateHistoricalStockValue(endDate);

        // 🚀 NEW: Scan Inventory for Low Stock Alerts (SQLite Version)
        let liveProducts = [];
        if (window.dbAPI && window.dbAPI.getProducts) {
            const allProds = await window.dbAPI.getProducts();
            liveProducts = allProds.filter(p => currentLocationId === 'all' || p.locationId === currentLocationId);
        }

        liveProducts.forEach(p => {
            if (p.type === 'homemade') return;
            const stock = parseFloat(p.stockLevel) || 0;
            const minStock = parseFloat(p.minStockLevel || 5);
            if (stock <= minStock) {
                financials.analytics.lowStock.push({ name: p.name || p.productName, stock: stock, min: minStock });
            }
        });

        // =========================================================================
        // 🚀 NEW: THE AUTOMATED ANOMALY & DIAGNOSTIC SCANNER
        // =========================================================================

        // Check 1: Orphaned Inventory (Transactions for items that were deleted)
        const liveProductIds = new Set();
        liveProducts.forEach(p => liveProductIds.add(p.id));

        txs.forEach(tx => {
            if (tx.type === 'PURCHASE' || tx.type === 'SALE') {
                (tx.items || []).forEach(item => {
                    if (item.type !== 'homemade' && !liveProductIds.has(item.id)) {
                        financials.anomalies.push({
                            type: 'warning',
                            title: 'Orphaned Ledger Entry',
                            message: `Invoice <b>${tx.invoiceId}</b> contains "${item.name}", but this item has been deleted from your Live Inventory. This may cause physical stock valuation to mismatch your purchasing ledger.`
                        });
                    }
                });
            }
        });

        // Check 2: The Balance Sheet Cashflow Gap
        const totalPurchasesAmount = financials.trading.purchases;
        if (totalPurchasesAmount > 0) {
            financials.anomalies.push({
                type: 'info',
                title: 'Balance Sheet Unbalanced (Expected)',
                message: `You have <b>${getCurrencySymbol()}${totalPurchasesAmount.toFixed(2)}</b> in inventory purchases. Because Mifela currently lacks a Cash/Bank deduction module, the system added the Asset (Stock) but did not deduct the Cash, resulting in a temporary Balance Sheet difference.`
            });
        }

        // Check 3: Negative Stock Warnings
        liveProducts.forEach(p => {
            const stock = parseFloat(p.stockLevel) || 0;
            if (stock < 0) {
                financials.anomalies.push({
                    type: 'error',
                    title: 'Negative Inventory Detected',
                    message: `<b>${p.name}</b> has a negative stock level (${stock}). This means you sold items you didn't officially have in the system, which will artificially inflate your Gross Profit.`
                });
            }
        });

        // Remove duplicate anomalies so we don't spam the user
        financials.anomalies = Array.from(new Set(financials.anomalies.map(a => JSON.stringify(a)))).map(a => JSON.parse(a));

        // =========================================================================
        updateComputedTotalsDOM(true);

    } catch (e) {
        console.error("Financial Calculation Failed:", e);
        throw e;
    }
}

async function loadSavedManualInputs() {
    const storeId = getStoreId();
    if (!storeId) return;

    try {
        const currentLocationId = getCurrentLocationId();
        const suffix = (currentLocationId === 'all') ? 'main' : currentLocationId;
        const localKey = `mifela_financial_inputs_${storeId}_${financials.periodValue}_${suffix}`;

        const rawData = localStorage.getItem(localKey);

        if (rawData) {
            const data = JSON.parse(rawData);

            if (data.openingStock !== undefined) financials.trading.openingStock = data.openingStock;
            if (data.directExpenses !== undefined) financials.trading.directExpenses = data.directExpenses;
            if (data.otherIncome !== undefined) financials.pl.otherIncome = data.otherIncome;
            if (data.customExpenses && Array.isArray(data.customExpenses)) financials.pl.customExpenses = data.customExpenses;
            if (data.capital !== undefined) financials.bs.capital = data.capital;
            if (data.drawings !== undefined) financials.bs.drawings = data.drawings;
            if (data.reserves !== undefined) financials.bs.reserves = data.reserves;
            if (data.securedLoans !== undefined) financials.bs.securedLoans = data.securedLoans;
            if (data.unsecuredLoans !== undefined) financials.bs.unsecuredLoans = data.unsecuredLoans;
            if (data.cashInHand !== undefined) financials.bs.cashInHand = data.cashInHand;
            if (data.bankAccounts !== undefined) financials.bs.bankAccounts = data.bankAccounts;
            if (Array.isArray(data.fixedAssets)) financials.bs.fixedAssets = data.fixedAssets;
        }
    } catch (e) {
        console.warn("Load inputs failed:", e);
    }
}

function saveInputsToCloud() {
    const storeId = getStoreId();
    if (!storeId) return;

    if (saveTimeout) clearTimeout(saveTimeout);

    const status = document.getElementById('save-status');
    if (status) status.innerHTML = `<span class="text-amber-600 flex items-center gap-1 text-xs"><svg class="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Saving...</span>`;

    saveTimeout = setTimeout(() => {
        try {
            const currentLocationId = getCurrentLocationId();
            const suffix = (currentLocationId === 'all') ? 'main' : currentLocationId;
            const localKey = `mifela_financial_inputs_${storeId}_${financials.periodValue}_${suffix}`;

            const saveData = {
                openingStock: financials.trading.openingStock,
                directExpenses: financials.trading.directExpenses,
                otherIncome: financials.pl.otherIncome,
                customExpenses: financials.pl.customExpenses,
                capital: financials.bs.capital,
                drawings: financials.bs.drawings,
                reserves: financials.bs.reserves,
                securedLoans: financials.bs.securedLoans,
                unsecuredLoans: financials.bs.unsecuredLoans,
                cashInHand: financials.bs.cashInHand,
                bankAccounts: financials.bs.bankAccounts,
                fixedAssets: financials.bs.fixedAssets,
                lastUpdated: new Date().toISOString()
            };

            // Save to LocalStorage
            localStorage.setItem(localKey, JSON.stringify(saveData));

            if (status) {
                status.innerHTML = `<span class="text-green-600 text-xs font-bold">Saved Locally</span>`;
                setTimeout(() => { if (status) status.innerHTML = ''; }, 2000);
            }
        } catch (e) {
            console.error(e);
            if (status) status.innerHTML = `<span class="text-red-600 text-xs">Save Failed</span>`;
        }
    }, 1500);
}

// Inside src/components/reports.js

function getReportHeaderHtml() {
    const role = getUserRole();
    const currentLocationId = getCurrentLocationId();
    const availLocs = typeof getAvailableLocations === 'function' ? getAvailableLocations() : [{ id: 'main', name: 'Main Store' }];

    let locationOpts = `<option value="all">All Locations (Aggregate)</option>`;
    availLocs.forEach(loc => {
        locationOpts += `<option value="${loc.id}" ${loc.id === currentLocationId ? 'selected' : ''}>${loc.name}</option>`;
    });

    // 🚀 THE FIX: Removed hasMultiLocationSupport. Just check if they are an admin/accountant.
    const canSwitchLocation = (role === 'admin' || role === 'accountant');

    const locationFilterHtml = canSwitchLocation ? `
        <div class="h-5 w-px bg-gray-300 mx-1"></div>
        <select id="report-loc-filter" class="bg-transparent text-sm font-semibold text-gray-700 focus:outline-none cursor-pointer px-2 border-none">
            ${locationOpts}
        </select>
    ` : `
        <div class="h-5 w-px bg-gray-300 mx-1"></div>
        <span class="text-sm font-semibold text-gray-600 px-2">${availLocs.find(l => l.id === currentLocationId)?.name || 'Local Branch'}</span>
    `;


    return `
        <div class="bg-white p-4 rounded-xl shadow-sm flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 sticky top-0 z-10 border-b border-gray-100">
            <div>
                <h2 class="text-xl font-bold text-gray-800 flex items-center gap-2">
                    <svg class="w-6 h-6 text-SLATE-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    Business Intelligence
                </h2>
                <div class="flex items-center gap-2 text-sm text-gray-500 mt-1">
                    <span>${financials.periodType.toUpperCase()} VIEW</span>
                    <span class="text-gray-300">|</span>
                    <span id="save-status"></span>
                </div>
            </div>
            
            <div class="flex flex-wrap items-center gap-3 bg-gray-50 p-1.5 rounded-lg border shadow-sm">
                <!-- 🚀 NEW: Report View Selector -->
                <div class="flex items-center bg-white border border-SLATE-100 rounded-md px-2 shadow-inner">
                    <span class="text-SLATE-500 mr-1"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"></path></svg></span>
                    <select id="report-view-type" class="bg-transparent py-1.5 text-sm font-black text-SLATE-700 focus:outline-none cursor-pointer">
                        <option value="all" ${financials.activeReportView === 'all' ? 'selected' : ''}>Complete Dashboard</option>
                        <option value="charts" ${financials.activeReportView === 'charts' ? 'selected' : ''}>Visual Charts & Analytics</option>
                        <option value="b2bd2c" ${financials.activeReportView === 'b2bd2c' ? 'selected' : ''}>B2B & D2C Intelligence</option>
                        <option value="financial" ${financials.activeReportView === 'financial' ? 'selected' : ''}>Financial Statements (P&L)</option>
                        <option value="tax" ${financials.activeReportView === 'tax' ? 'selected' : ''}>GST & Tax Compliance</option>
                    </select>
                </div>
                
                <div class="h-5 w-px bg-gray-300"></div>

                <select id="report-period-type" class="bg-transparent text-sm font-semibold text-gray-700 focus:outline-none cursor-pointer px-2">
                    <option value="monthly" ${financials.periodType === 'monthly' ? 'selected' : ''}>Monthly</option>
                    <option value="quarterly" ${financials.periodType === 'quarterly' ? 'selected' : ''}>Quarterly</option>
                </select>
                <div class="h-5 w-px bg-gray-300"></div>
                ${renderPeriodInput()}
                ${locationFilterHtml}
                
                <button id="btn-refresh-financials" class="flex items-center gap-2 bg-SLATE-100 text-SLATE-700 hover:bg-SLATE-600 hover:text-white px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> Fetch
                </button>
            </div>
        </div>
    `;
}

function renderFinancialUI() {
    DOM.reports.grid.className = "block space-y-8";

    updateComputedTotalsDOM(true);

    const currency = getCurrencySymbol();
    const { trading, pl, bs, gstSummary } = financials;
    const headerHtml = getReportHeaderHtml();

    const gstRows = Object.entries(gstSummary).map(([slab, vals]) => `
        <tr class="hover:bg-gray-50 border-b border-gray-100">
            <td class="p-4 text-sm font-black text-gray-800">${slab}% GST</td>
            <td class="p-4 text-right font-medium text-gray-600">${currency}${vals.taxable.toFixed(2)}</td>
            <td class="p-4 text-right font-bold text-orange-500">${currency}${vals.igst.toFixed(2)}</td>
            <td class="p-4 text-right font-bold text-SLATE-500">${currency}${vals.cgst.toFixed(2)}</td>
            <td class="p-4 text-right font-bold text-SLATE-500">${currency}${vals.sgst.toFixed(2)}</td>
            <td class="p-4 text-right font-bold text-red-500">${currency}${vals.cess.toFixed(2)}</td>
        </tr>
    `).join('');

    const itcRows = Object.keys(financials.itcSummary).length > 0 ? Object.entries(financials.itcSummary).map(([slab, vals]) => `
        <tr class="hover:bg-gray-50 border-b border-gray-100">
            <td class="p-4 text-sm font-black text-gray-800">${slab}% GST</td>
            <td class="p-4 text-right font-medium text-gray-600">${currency}${vals.taxable.toFixed(2)}</td>
            <td class="p-4 text-right font-bold text-orange-500">${currency}${vals.igst.toFixed(2)}</td>
            <td class="p-4 text-right font-bold text-emerald-500">${currency}${vals.cgst.toFixed(2)}</td>
            <td class="p-4 text-right font-bold text-emerald-500">${currency}${vals.sgst.toFixed(2)}</td>
            <td class="p-4 text-right font-bold text-red-500">${currency}${vals.cess.toFixed(2)}</td>
        </tr>
    `).join('') : null;

    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const view = financials.activeReportView;

    // 🚀 THE ULTIMATE ENTERPRISE CSS & HTML CHARTS GENERATOR
    let chartHtml = '';
    if (view === 'all' || view === 'charts') {

        // --- 1. SMART Y-AXIS FORMATTER ---
        const formatYAxis = (num) => {
            if (num === 0) return '0';
            if (num >= 10000000) return (num / 10000000).toFixed(1) + 'Cr';
            if (num >= 100000) return (num / 100000).toFixed(1) + 'L';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            return Math.floor(num).toString();
        };

        // --- 2. TREND DATA (Dual-Bar Chart) ---
        const sortedDays = Object.entries(financials.analytics.daily)
            .sort((a, b) => new Date(a[0]) - new Date(b[0]))
            .slice(-14); // Last 14 days

        // Bulletproof Max Value Calculation with 10% headroom
        let maxDailyValue = 100; // Baseline to prevent division by zero
        if (sortedDays.length > 0) {
            const rawMax = Math.max(...sortedDays.map(d => Math.max(d[1].sales || 0, d[1].purchases || 0, d[1].expenses || 0)));
            if (rawMax > 0) maxDailyValue = rawMax * 1.1;
        }

        const trendBars = sortedDays.map(([iso, data]) => {
            const hSales = Math.max(1, (data.sales / maxDailyValue) * 100);
            const hPurch = Math.max(1, (data.purchases / maxDailyValue) * 100);
            return `
                <div class="relative flex flex-col items-center flex-1 group h-full justify-end px-0.5">
                    <!-- Advanced Tooltip (Fixed Pointer) -->
                    <div class="absolute bottom-full mb-2 hidden group-hover:flex flex-col items-center z-30 transform scale-95 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-200 pointer-events-none">
                        <div class="bg-slate-800 text-white text-xs p-3 rounded-xl shadow-xl whitespace-nowrap border border-slate-700 min-w-[120px]">
                            <span class="block font-bold text-slate-300 mb-2 border-b border-slate-700 pb-1.5 text-[10px] uppercase tracking-widest">${data.display}</span>
                            <div class="flex justify-between items-center gap-4 mb-1">
                                <span class="flex items-center gap-1.5 text-SLATE-300 font-bold"><div class="w-2 h-2 rounded-full bg-SLATE-400 shadow-[0_0_8px_rgba(99,102,241,0.8)]"></div>Sales</span> 
                                <span class="font-mono text-sm">${currency}${data.sales.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                            </div>
                            <div class="flex justify-between items-center gap-4">
                                <span class="flex items-center gap-1.5 text-rose-300 font-bold"><div class="w-2 h-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.8)]"></div>Purch</span> 
                                <span class="font-mono text-sm">${currency}${data.purchases.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                            </div>
                        </div>
                        <div class="w-3 h-3 bg-slate-800 rotate-45 -mt-1.5 border-r border-b border-slate-700"></div>
                    </div>
                    
                    <!-- Dual Bars -->
                    <div class="flex items-end justify-center w-full gap-0.5 sm:gap-1 h-full relative z-10">
                        <div class="w-1/2 max-w-[14px] bg-gradient-to-t from-SLATE-700 to-SLATE-400 rounded-t-md transition-all duration-300 group-hover:brightness-125 shadow-[0_0_10px_rgba(99,102,241,0.15)]" style="height: ${hSales}%"></div>
                        <div class="w-1/2 max-w-[14px] bg-gradient-to-t from-rose-600 to-rose-300 rounded-t-md transition-all duration-300 group-hover:brightness-125 shadow-[0_0_10px_rgba(244,63,94,0.15)]" style="height: ${hPurch}%"></div>
                    </div>
                    
                    <!-- X-Axis Label -->
                    <span class="text-[9px] font-bold text-slate-400 mt-4 -rotate-45 origin-top-left transform translate-x-3 whitespace-nowrap">${data.display}</span>
                </div>
            `;
        }).join('') || '<div class="h-48 flex items-center justify-center text-slate-400 italic w-full font-medium">No trading data available for this period.</div>';

        // --- 3. PROFITABILITY BREAKDOWN (Light Theme Financial Summary) ---
        const rev = financials.trading.sales || 0;
        const cogs = Math.max(0, (financials.trading.purchases || 0) + (financials.trading.openingStock || 0) - (financials.trading.closingStock || 0));
        const exp = Object.values(financials.pl.expenses).reduce((a, b) => a + (Number(b) || 0), 0) +
            financials.pl.customExpenses.reduce((a, b) => a + (Number(b.value) || 0), 0);

        const safeRev = Math.max(1, rev);
        const pctCogs = Math.min(100, Math.max(0, (cogs / safeRev) * 100));
        const pctExp = Math.min(100, Math.max(0, (exp / safeRev) * 100));
        const pctProf = Math.max(0, 100 - pctCogs - pctExp);

        chartHtml = `
            <!-- Shimmer Animation Definition -->
            <style>
                @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
            </style>
            
            <div class="grid grid-cols-1 xl:grid-cols-3 gap-8 mb-8 animate-scaleIn">
                <!-- 📈 TREND CHART -->
                <div class="xl:col-span-2 bg-white rounded-3xl shadow-xl border border-slate-100 p-6 sm:p-8 flex flex-col relative overflow-hidden">
                    <!-- Decorative Background Blur -->
                    <div class="absolute top-0 right-0 w-64 h-64 bg-SLATE-50 rounded-full blur-3xl -z-10 translate-x-1/2 -translate-y-1/2 opacity-60"></div>
                    
                    <div class="flex justify-between items-start mb-8">
                        <div>
                            <h3 class="font-extrabold text-slate-900 flex items-center gap-2 text-xl tracking-tight">
                                <span class="p-1.5 bg-SLATE-100 rounded-lg text-SLATE-600 shadow-sm">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                                </span> 
                                Revenue vs Cost Matrix
                            </h3>
                            <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1.5">Last 14 Trading Days</p>
                        </div>
                        <div class="flex items-center gap-4 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-xl shadow-inner">
                            <div class="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-600 tracking-wider"><span class="w-2.5 h-2.5 rounded-full bg-SLATE-500 shadow-[0_0_5px_rgba(99,102,241,0.6)]"></span> Sales</div>
                            <div class="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-600 tracking-wider"><span class="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.6)]"></span> Purchases</div>
                        </div>
                    </div>
                    
                    <!-- Chart Area -->
                    <div class="flex-1 flex items-end w-full relative pb-8 pt-4">
                        <!-- Y-Axis Grid Lines & Labels -->
                        <div class="absolute inset-0 flex flex-col justify-between text-[10px] font-bold text-slate-400 pointer-events-none pb-8 z-0">
                            <div class="w-full flex items-center border-t border-dashed border-slate-200"><span class="bg-white pr-2 -mt-3.5">${currency}${formatYAxis(maxDailyValue)}</span></div>
                            <div class="w-full flex items-center border-t border-dashed border-slate-200"><span class="bg-white pr-2 -mt-3.5">${currency}${formatYAxis(maxDailyValue * 0.66)}</span></div>
                            <div class="w-full flex items-center border-t border-dashed border-slate-200"><span class="bg-white pr-2 -mt-3.5">${currency}${formatYAxis(maxDailyValue * 0.33)}</span></div>
                            <div class="w-full flex items-center border-t border-slate-300"><span class="bg-white pr-2 -mt-3.5">${currency}0</span></div>
                        </div>
                        
                        <!-- Dynamic Bars -->
                        <div class="w-full h-48 sm:h-64 flex justify-between items-end gap-1 pl-12 pr-2 relative z-10">
                            ${trendBars}
                        </div>
                    </div>
                </div>

                <div class="flex flex-col gap-8">
                    <!-- 🍰 PROFITABILITY BREAKDOWN -->
                    <div class="bg-white rounded-3xl shadow-xl border border-slate-100 p-6 sm:p-8 flex-1 flex flex-col justify-center relative overflow-hidden">
                        <div class="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full blur-2xl pointer-events-none"></div>
                        <h3 class="font-extrabold text-slate-900 flex items-center gap-2 mb-1 text-lg tracking-tight">
                            <span class="p-1.5 bg-emerald-100 rounded-lg text-emerald-600 shadow-sm">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"></path></svg>
                            </span> 
                            Capital Allocation
                        </h3>
                        <p class="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-6">Distribution of Revenue</p>
                        
                        <!-- Animated Stacked Bar -->
                        <div class="w-full h-4 flex rounded-full overflow-hidden shadow-inner bg-slate-100 mb-6">
                            <div style="width: ${pctCogs}%" class="bg-rose-400 hover:brightness-110 transition-all duration-300" title="COGS: ${pctCogs.toFixed(1)}%"></div>
                            <div style="width: ${pctExp}%" class="bg-amber-400 hover:brightness-110 transition-all duration-300 border-l border-white/50" title="Expenses: ${pctExp.toFixed(1)}%"></div>
                            <div style="width: ${pctProf}%" class="bg-emerald-500 hover:brightness-110 transition-all duration-300 border-l border-white/50 relative overflow-hidden" title="Net Profit: ${pctProf.toFixed(1)}%">
                                <div class="absolute inset-0 bg-white/30 w-full h-full animate-[shimmer_2s_infinite]"></div>
                            </div>
                        </div>
                        
                        <!-- Financial Details Grid (Light Theme) -->
                        <div class="grid grid-cols-1 gap-3 z-10 relative">
                            <div class="flex justify-between items-center bg-rose-50/50 p-2.5 rounded-xl border border-rose-100 transition-colors hover:bg-rose-50">
                                <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-rose-400"></div><span class="text-xs font-bold text-slate-700">Cost of Goods</span></div>
                                <div class="text-right"><span class="block text-sm font-black text-slate-900">${currency}${cogs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span><span class="text-[9px] text-rose-500 font-bold">${pctCogs.toFixed(1)}%</span></div>
                            </div>
                            <div class="flex justify-between items-center bg-amber-50/50 p-2.5 rounded-xl border border-amber-100 transition-colors hover:bg-amber-50">
                                <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-amber-400"></div><span class="text-xs font-bold text-slate-700">Overhead/Exp.</span></div>
                                <div class="text-right"><span class="block text-sm font-black text-slate-900">${currency}${exp.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span><span class="text-[9px] text-amber-500 font-bold">${pctExp.toFixed(1)}%</span></div>
                            </div>
                            <div class="flex justify-between items-center bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 shadow-sm transition-colors hover:bg-emerald-100/50">
                                <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"></div><span class="text-xs font-bold text-emerald-900">Net Profit</span></div>
                                <div class="text-right"><span class="block text-sm font-black text-emerald-700">${currency}${pl.netProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span><span class="text-[9px] text-emerald-600 font-bold">${pctProf.toFixed(1)}% MARGIN</span></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // 🚀 B2B & D2C INTELLIGENCE BLOCK
    let b2bD2CHtml = '';
    if (view === 'all' || view === 'b2bd2c') {
        b2bD2CHtml = renderB2BD2CBlock();
    }

    // 🚀 NEW: Conditional Block Rendering
    let taxHtml = '';
    if (view === 'all' || view === 'tax') {
        taxHtml = `
            <div class="bg-gradient-to-r from-SLATE-50 to-blue-50 rounded-xl shadow-md border border-SLATE-100 overflow-hidden mb-8 animate-scaleIn">
                <div class="px-6 py-4 border-b border-SLATE-100 bg-white/50 flex justify-between items-center">
                    <h3 class="font-bold text-SLATE-900 text-lg flex items-center gap-2">
                        <span class="text-xl">🇮🇳</span> Tax & Compliance (GST)
                    </h3>
                </div>
                <div class="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="bg-white rounded-xl p-5 shadow-sm border border-SLATE-50 hover:shadow-md transition">
                        <div class="flex justify-between items-start mb-3">
                            <div><h4 class="font-bold text-gray-800">GSTR-1</h4><p class="text-xs text-gray-500 font-medium">Outward Supplies (Sales)</p></div>
                            <div class="w-8 h-8 bg-SLATE-100 text-SLATE-600 rounded-full flex items-center justify-center shadow-sm">📤</div>
                        </div>
                        <div class="flex flex-col gap-2">
                            <input type="month" id="gstr1-month" value="${monthStr}" class="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-SLATE-500 outline-none">
                            <button onclick="window.downloadGSTR('1')" class="bg-SLATE-600 hover:bg-SLATE-700 text-white py-2 rounded-lg text-sm font-bold shadow-sm transition active:scale-95">Export CSV</button>
                        </div>
                    </div>
                    <div class="bg-white rounded-xl p-5 shadow-sm border border-SLATE-50 hover:shadow-md transition">
                        <div class="flex justify-between items-start mb-3">
                            <div><h4 class="font-bold text-gray-800">GSTR-2</h4><p class="text-xs text-gray-500 font-medium">Inward Supplies (Purchases)</p></div>
                            <div class="w-8 h-8 bg-SLATE-100 text-SLATE-600 rounded-full flex items-center justify-center shadow-sm">📥</div>
                        </div>
                        <div class="flex flex-col gap-2">
                            <input type="month" id="gstr2-month" value="${monthStr}" class="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-SLATE-500 outline-none">
                            <button onclick="window.downloadGSTR('2')" class="bg-SLATE-600 hover:bg-SLATE-700 text-white py-2 rounded-lg text-sm font-bold shadow-sm transition active:scale-95">Export CSV</button>
                        </div>
                    </div>
                    <div class="bg-white rounded-xl p-5 shadow-sm border border-SLATE-50 hover:shadow-md transition">
                        <div class="flex justify-between items-start mb-3">
                            <div><h4 class="font-bold text-gray-800">GSTR-3B / 3R</h4><p class="text-xs text-gray-500 font-medium">Monthly Summary</p></div>
                            <div class="w-8 h-8 bg-SLATE-100 text-SLATE-600 rounded-full flex items-center justify-center shadow-sm">🧾</div>
                        </div>
                        <div class="flex flex-col gap-2">
                            <input type="month" id="gstr3-month" value="${monthStr}" class="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-SLATE-500 outline-none">
                            <button onclick="window.downloadGSTR('3')" class="bg-SLATE-600 hover:bg-SLATE-700 text-white py-2 rounded-lg text-sm font-bold shadow-sm transition active:scale-95">Export CSV</button>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8 animate-scaleIn">
                <div class="bg-white rounded-3xl shadow-xl border border-SLATE-100 overflow-hidden">
                    <div class="px-6 py-4 border-b border-SLATE-50 bg-SLATE-50/50 flex justify-between items-center">
                        <h3 class="font-bold text-SLATE-900 flex items-center gap-2"><span>📤</span> Tax Liability (Sales)</h3>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="p-4 text-[10px] font-black text-gray-400 uppercase">Tax Slab</th>
                                    <th class="p-4 text-right text-[10px] font-black text-gray-400 uppercase">Taxable</th>
                                    <th class="p-4 text-right text-[10px] font-black text-gray-400 uppercase">IGST</th>
                                    <th class="p-4 text-right text-[10px] font-black text-gray-400 uppercase">CGST</th>
                                    <th class="p-4 text-right text-[10px] font-black text-gray-400 uppercase">SGST</th>
                                    <th class="p-4 text-right text-[10px] font-black text-gray-400 uppercase">CESS</th>
                                </tr>
                            </thead>
                            <tbody>${gstRows || '<tr><td colspan="6" class="text-center py-10 text-gray-400 italic">No liability data found.</td></tr>'}</tbody>
                        </table>
                    </div>
                </div>
                <div class="bg-white rounded-3xl shadow-xl border border-emerald-100 overflow-hidden">
                    <div class="px-6 py-4 border-b border-emerald-50 bg-emerald-50/50 flex justify-between items-center">
                        <h3 class="font-bold text-emerald-900 flex items-center gap-2"><span>📥</span> Input Tax Credit (Purchases)</h3>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="p-4 text-[10px] font-black text-gray-400 uppercase">Tax Slab</th>
                                    <th class="p-4 text-right text-[10px] font-black text-gray-400 uppercase">Taxable</th>
                                    <th class="p-4 text-right text-[10px] font-black text-gray-400 uppercase">IGST</th>
                                    <th class="p-4 text-right text-[10px] font-black text-gray-400 uppercase">CGST</th>
                                    <th class="p-4 text-right text-[10px] font-black text-gray-400 uppercase">SGST</th>
                                    <th class="p-4 text-right text-[10px] font-black text-gray-400 uppercase">CESS</th>
                                </tr>
                            </thead>
                            <tbody>${itcRows || '<tr><td colspan="6" class="text-center py-10 text-gray-400 italic">No ITC data found.</td></tr>'}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    let financialHtml = '';
    if (view === 'all' || view === 'financial') {
        financialHtml = `
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <!-- TRADING ACCOUNT -->
                <div class="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden animate-scaleIn">
                    <div class="bg-SLATE-50 px-6 py-3 border-b border-SLATE-100 flex justify-between items-center">
                        <h3 class="font-bold text-SLATE-900">Trading Account</h3>
                        <span class="text-xs font-mono bg-white px-2 py-1 rounded border text-SLATE-700 shadow-sm">
                            GP: ${currency}<span id="disp-gp-header">${trading.grossProfit.toFixed(2)}</span>
                        </span>
                    </div>
                    <div class="p-5 grid grid-cols-2 gap-8">
                        <div class="space-y-3">
                            <h4 class="text-xs font-bold text-gray-400 uppercase border-b pb-1">Particulars (Dr.)</h4>
                            ${rowInput('Opening Stock', 'inp-open-stock', trading.openingStock)}
                            ${rowStatic('Purchases', trading.purchases)}
                            ${rowInput('Direct Expenses', 'inp-direct-exp', trading.directExpenses)}
                            <div class="pt-4 border-t mt-4 flex justify-between items-center bg-green-50 p-2 rounded">
                                <span class="font-bold text-sm text-green-800">Gross Profit c/d</span>
                                <span class="font-bold text-green-800" id="disp-gp-main">${trading.grossProfit.toFixed(2)}</span>
                            </div>
                        </div>
                        <div class="space-y-3">
                            <h4 class="text-xs font-bold text-gray-400 uppercase border-b pb-1">Particulars (Cr.)</h4>
                            ${rowStatic('Sales Accounts', trading.sales)}
                            ${rowStatic('Closing Stock', trading.closingStock)}
                        </div>
                    </div>
                </div>

                <!-- PROFIT & LOSS ACCOUNT -->
                <div class="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden animate-scaleIn" style="animation-delay: 0.1s">
                    <div class="bg-purple-50 px-6 py-3 border-b border-purple-100 flex justify-between items-center">
                        <h3 class="font-bold text-purple-900">Profit & Loss A/c</h3>
                        <span class="text-xs font-mono bg-white px-2 py-1 rounded border text-purple-700 shadow-sm">
                            NP: ${currency}<span id="disp-np-header">${pl.netProfit.toFixed(2)}</span>
                        </span>
                    </div>
                    <div class="p-5 grid grid-cols-2 gap-8">
                        <div class="space-y-2">
                            <h4 class="text-xs font-bold text-gray-400 uppercase border-b pb-1">Expenses (Dr.)</h4>
                            ${rowInput('Salaries', 'inp-salaries', pl.expenses.salaries, true)}
                            ${rowInput('Rent & Rates', 'inp-rent', pl.expenses.rent)}
                            ${rowInput('Utilities', 'inp-util', pl.expenses.utilities)}
                            ${rowInput('Marketing', 'inp-marketing', pl.expenses.marketing)}
                            ${rowInput('Repairs', 'inp-repairs', pl.expenses.repairs)}
                            ${rowInput('Travel', 'inp-travel', pl.expenses.travel)}
                            ${rowInput('General / Loss', 'inp-general', pl.expenses.general)}
                            <div class="mt-4 pt-2 border-t border-dashed border-gray-200">
                                <div class="flex justify-between items-center mb-2">
                                    <h5 class="text-xs font-bold text-purple-800">ADDITIONAL EXPENSES</h5>
                                    <button id="btn-add-custom-exp" class="text-xs text-white bg-purple-600 hover:bg-purple-700 px-2 py-0.5 rounded shadow-sm transition">+ Add</button>
                                </div>
                                <div id="custom-exp-list-container" class="space-y-1"></div>
                            </div>
                            <div class="pt-2 border-t mt-2 flex justify-between items-center bg-SLATE-50 p-2 rounded">
                                <span class="font-bold text-sm text-SLATE-800">Net Profit</span>
                                <span class="font-bold text-SLATE-800" id="disp-np-main">${pl.netProfit.toFixed(2)}</span>
                            </div>
                        </div>
                        <div class="space-y-3">
                            <h4 class="text-xs font-bold text-gray-400 uppercase border-b pb-1">Incomes (Cr.)</h4>
                            <div class="flex justify-between items-center text-sm">
                                <span class="text-gray-600">Gross Profit b/d</span>
                                <span class="font-mono bg-gray-100 px-2 py-1 rounded text-gray-800 shadow-sm" id="disp-gp-brought">${trading.grossProfit.toFixed(2)}</span>
                            </div>
                            ${rowInput('Other Income', 'inp-other-income', pl.otherIncome)}
                        </div>
                    </div>
                </div>

                <!-- BALANCE SHEET -->
                <div class="xl:col-span-2 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden animate-scaleIn" style="animation-delay: 0.2s">
                    <div class="bg-gray-800 text-white px-6 py-3 flex justify-between items-center">
                        <h3 class="font-bold text-lg">Balance Sheet</h3>
                        <div class="flex items-center gap-4">
                            <span id="disp-bs-status" class="text-xs bg-gray-700 px-3 py-1 rounded-full text-gray-300">Checking...</span>
                            <select id="export-actions-dropdown" class="bg-SLATE-600 hover:bg-SLATE-500 text-white text-xs px-3 py-1.5 rounded transition shadow font-medium cursor-pointer border-none">
                                <option value="" disabled selected>Export Data</option>
                                <option value="print">Preview & Print</option>
                                <option value="xml">Tally XML</option>
                                <option value="json">JSON Data</option>
                            </select>
                        </div>
                    </div>
                    <div class="p-6 grid grid-cols-1 lg:grid-cols-2 gap-10">
                        <div>
                            <h4 class="text-sm font-bold text-gray-700 uppercase border-b-2 border-gray-800 pb-2 mb-4">Liabilities</h4>
                            <div class="space-y-4 pr-4">
                                <div class="bg-gray-50 p-3 rounded border border-gray-200">
                                    <h5 class="text-xs font-bold text-gray-500 mb-2">CAPITAL ACCOUNT</h5>
                                    ${rowInput('Opening Capital', 'inp-capital', bs.capital)}
                                    ${rowInput('(-) Drawings', 'inp-drawings', bs.drawings)}
                                    <div class="flex justify-between items-center text-sm">
                                        <span class="text-gray-600">(+) Net Profit</span>
                                        <span class="font-mono bg-gray-100 px-2 py-1 rounded text-gray-800 shadow-sm" id="disp-np-bs">${pl.netProfit.toFixed(2)}</span>
                                    </div>
                                    <div class="flex justify-between items-center mt-2 pt-2 border-t border-gray-300">
                                        <span class="text-sm font-bold">Net Capital</span>
                                        <span class="font-mono font-bold text-gray-800" id="disp-net-capital">0.00</span>
                                    </div>
                                </div>
                                <div class="bg-gray-50 p-3 rounded border border-gray-200">
                                    <h5 class="text-xs font-bold text-gray-500 mb-2">LOANS</h5>
                                    ${rowInput('Secured Loans', 'inp-sec-loans', bs.securedLoans)}
                                    ${rowInput('Unsecured Loans', 'inp-unsec-loans', bs.unsecuredLoans)}
                                </div>
                                <div class="bg-gray-50 p-3 rounded border border-gray-200">
                                    <h5 class="text-xs font-bold text-gray-500 mb-2">CURRENT LIABILITIES</h5>
                                    ${rowStatic('Sundry Creditors', bs.sundryCreditors)}
                                    ${rowInput('Reserves & Surplus', 'inp-reserves', bs.reserves)}
                                </div>
                            </div>
                            <div class="mt-4 bg-gray-100 p-3 rounded flex justify-between items-center border border-gray-200">
                                <span class="font-bold text-gray-900">TOTAL LIABILITIES</span>
                                <span class="font-bold text-xl text-gray-900" id="disp-total-liab">0.00</span>
                            </div>
                        </div>
                        <div>
                            <h4 class="text-sm font-bold text-gray-700 uppercase border-b-2 border-gray-800 pb-2 mb-4">Assets</h4>
                            <div class="space-y-4 pl-4 border-l border-gray-100">
                                <div class="bg-blue-50 p-3 rounded border border-blue-100">
                                    <div class="flex justify-between items-center mb-2">
                                        <h5 class="text-xs font-bold text-blue-800">FIXED ASSETS</h5>
                                        <button id="btn-add-asset" class="text-xs text-white bg-blue-600 hover:bg-blue-700 px-2 py-0.5 rounded shadow-sm transition">+ Add</button>
                                    </div>
                                    <div id="assets-list-container" class="space-y-1 mb-2"></div>
                                    <div class="flex justify-between items-center pt-2 border-t border-blue-200">
                                        <span class="text-sm font-bold text-blue-900">Total Fixed Assets</span>
                                        <span class="font-mono font-bold text-blue-900" id="disp-total-fixed">0.00</span>
                                    </div>
                                </div>
                                <div class="bg-gray-50 p-3 rounded border border-gray-200">
                                    <h5 class="text-xs font-bold text-gray-500 mb-2">CURRENT ASSETS</h5>
                                    ${rowStatic('Closing Stock', trading.closingStock)}
                                    ${rowStatic('Sundry Debtors', bs.sundryDebtors)}
                                    ${rowInput('Cash-in-Hand', 'inp-cash', bs.cashInHand)}
                                    ${rowInput('Bank Accounts', 'inp-bank', bs.bankAccounts)}
                                </div>
                            </div>
                            <div class="mt-4 bg-gray-100 p-3 rounded flex justify-between items-center border border-gray-200">
                                <span class="font-bold text-gray-900">TOTAL ASSETS</span>
                                <span class="font-bold text-xl text-gray-900" id="disp-total-assets">0.00</span>
                            </div>
                        </div>
                    </div>
                </div>
                
            </div>
        `;
    }
    // Inside renderFinancialUI(), after the Balance Sheet block finishes:

    let diagnosticHtml = '';
    if (financials.anomalies.length > 0) {
        const anomalyRows = financials.anomalies.map(anomaly => {
            let colors = '';
            let icon = '';
            if (anomaly.type === 'error') {
                colors = 'bg-red-50 border-red-200 text-red-800';
                icon = '<span class="text-red-500">🚨</span>';
            } else if (anomaly.type === 'warning') {
                colors = 'bg-amber-50 border-amber-200 text-amber-800';
                icon = '<span class="text-amber-500">⚠️</span>';
            } else {
                colors = 'bg-blue-50 border-blue-200 text-blue-800';
                icon = '<span class="text-blue-500">💡</span>';
            }

            return `
                <div class="flex items-start gap-3 p-4 rounded-xl border ${colors} shadow-sm  ">
                    <div class="text-xl mt-0.5">${icon}</div>
                    <div>
                        <h4 class="font-bold text-sm mb-1">${anomaly.title}</h4>
                        <p class="text-xs opacity-90 leading-relaxed">${anomaly.message}</p>
                    </div>
                </div>
            `;
        }).join('');

        diagnosticHtml = `
            <div class="col-span-full xl:col-span-2 mt-4 bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden animate-scaleIn">
                <div class="bg-slate-800 px-6 py-3 border-b border-slate-700 flex justify-between items-center">
                    <h3 class="font-bold text-white flex items-center gap-2"><span>🩺</span> System Diagnostics & Audits</h3>
                    <span class="text-[10px] bg-slate-700 text-slate-300 px-2 py-1 rounded-full uppercase tracking-widest font-bold">${financials.anomalies.length} Notices</span>
                </div>
                <div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50/50">
                    ${anomalyRows}
                </div>
            </div>
        `;
    }

    // Now, ensure diagnosticHtml is added to the very end of your financialHtml string:
    // 🚀 THE FIX: Safely append the diagnostics WITHOUT destroying the financial tables!
    if (diagnosticHtml) {
        financialHtml += `
            <div class="mt-8">
                ${diagnosticHtml}
            </div>
        `;
    }
    const footerHtml = `
        <div class="col-span-full pt-10 pb-4 border-t border-gray-100 mt-4 text-center">
            <div class="flex flex-col items-center gap-1.5">
                <p class="text-[10px] font-bold text-gray-400 tracking-[0.3em] uppercase">Mifela Inventory Management</p>
                <p class="text-[11px] text-gray-500 font-medium">© 2026 All Rights Reserved</p>
            </div>
        </div>
    `;

    DOM.reports.grid.innerHTML = headerHtml + chartHtml + b2bD2CHtml + taxHtml + financialHtml + footerHtml;
    attachListeners();
    if (view === 'all' || view === 'financial') {
        renderAssetRows();
        renderCustomExpenseRows();
        updateComputedTotalsDOM();
    }
}

const INPUT_MAP = {
    'inp-open-stock': 'trading.openingStock',
    'inp-direct-exp': 'trading.directExpenses',
    'inp-other-income': 'pl.otherIncome',
    'inp-salaries': 'pl.expenses.salaries',
    'inp-rent': 'pl.expenses.rent',
    'inp-util': 'pl.expenses.utilities',
    'inp-internet': 'pl.expenses.internet',
    'inp-marketing': 'pl.expenses.marketing',
    'inp-packaging': 'pl.expenses.packaging',
    'inp-repairs': 'pl.expenses.repairs',
    'inp-travel': 'pl.expenses.travel',
    'inp-general': 'pl.expenses.general',
    'inp-capital': 'bs.capital',
    'inp-drawings': 'bs.drawings',
    'inp-reserves': 'bs.reserves',
    'inp-sec-loans': 'bs.securedLoans',
    'inp-unsec-loans': 'bs.unsecuredLoans',
    'inp-cash': 'bs.cashInHand',
    'inp-bank': 'bs.bankAccounts'
};

function attachListeners() {
    if (listenersAttached) return;

    DOM.reports.grid.addEventListener('input', (e) => {
        const target = e.target;
        if (INPUT_MAP[target.id]) {
            const path = INPUT_MAP[target.id];
            updateStateByPath(path, target.value);
            updateComputedTotalsDOM();
            saveInputsToCloud();
            return;
        }
        if (target.classList.contains('asset-name')) {
            const idx = parseInt(target.dataset.idx);
            financials.bs.fixedAssets[idx].name = target.value;
            saveInputsToCloud();
        } else if (target.classList.contains('asset-val')) {
            const idx = parseInt(target.dataset.idx);
            financials.bs.fixedAssets[idx].value = parseFloat(target.value) || 0;
            updateComputedTotalsDOM();
            saveInputsToCloud();
        }
        if (target.classList.contains('custom-exp-name')) {
            const idx = parseInt(target.dataset.idx);
            financials.pl.customExpenses[idx].name = target.value;
            saveInputsToCloud();
        } else if (target.classList.contains('custom-exp-val')) {
            const idx = parseInt(target.dataset.idx);
            financials.pl.customExpenses[idx].value = parseFloat(target.value) || 0;
            updateComputedTotalsDOM();
            saveInputsToCloud();
        }
    });

    DOM.reports.grid.addEventListener('change', async (e) => {
        const target = e.target;

        // 🚀 NEW: Switch Views instantly!
        if (target.id === 'report-view-type') {
            financials.activeReportView = target.value;
            renderFinancialUI(); // Instantly swaps DOM without querying Firebase!
            return;
        }

        if (target.id === 'report-loc-filter') {
            setCurrentLocation(target.value);
            await renderReportLibraryPage();
        } else if (target.id === 'report-period-type') {
            financials.periodType = target.value;
            renderReportLibraryPage();
        } else if (target.id === 'export-actions-dropdown') {
            const val = target.value;
            if (val === 'xml') generateDetailedTallyXML();
            if (val === 'json') generateJSONExport();
            if (val === 'print') printFinancialStatements();
            target.value = "";
        }
    });

    DOM.reports.grid.addEventListener('click', async (e) => {
        const target = e.target;
        const refreshBtn = target.closest('#btn-refresh-financials');
        if (refreshBtn) {
            handleRefreshClick();
            return;
        }
        if (target.id === 'btn-add-asset') {
            financials.bs.fixedAssets.push({ name: 'New Asset', value: 0 });
            renderAssetRows();
            updateComputedTotalsDOM();
            saveInputsToCloud();
            return;
        }
        if (target.classList.contains('del-asset')) {
            const idx = parseInt(target.dataset.idx);
            financials.bs.fixedAssets.splice(idx, 1);
            renderAssetRows();
            updateComputedTotalsDOM();
            saveInputsToCloud();
            return;
        }
        if (target.id === 'btn-add-custom-exp') {
            financials.pl.customExpenses.push({ name: 'Expense', value: 0 });
            renderCustomExpenseRows();
            updateComputedTotalsDOM();
            saveInputsToCloud();
            return;
        }
        if (target.classList.contains('del-custom-exp')) {
            const idx = parseInt(target.dataset.idx);
            financials.pl.customExpenses.splice(idx, 1);
            renderCustomExpenseRows();
            updateComputedTotalsDOM();
            saveInputsToCloud();
            return;
        }
    });

    listenersAttached = true;
}

function rowInput(label, id, value, isReadOnly = false) {
    const readonlyAttr = isReadOnly ? 'readonly' : '';
    const bgClass = isReadOnly ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-white';
    const icon = isReadOnly ? '<span class="ml-1 text-xs" title="Auto-Calculated">🧮</span>' : '';
    return `
        <div class="flex justify-between items-center text-sm">
            <span class="text-gray-700 flex items-center">${label}${icon}</span>
            <input type="number" id="${id}" value="${value}" ${readonlyAttr}
                   class="w-28 text-right border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-SLATE-500 focus:border-SLATE-500 ${bgClass}" 
                   placeholder="0.00">
        </div>
    `;
}

function rowStatic(label, value) {
    return `
        <div class="flex justify-between items-center text-sm">
            <span class="text-gray-600">${label}</span>
            <span class="font-mono bg-gray-100 px-2 py-1 rounded text-gray-800 shadow-sm border border-gray-200">${value.toFixed(2)}</span>
        </div>
    `;
}

function renderPeriodInput() {
    if (financials.periodType === 'monthly') {
        return `<input type="month" id="report-period-val" value="${financials.periodValue}" class="border rounded p-1.5 text-sm text-gray-600 focus:ring-SLATE-500 font-mono shadow-inner bg-white" />`;
    } else {
        const yOpts = [0, 1, 2, 3, 4].map(i => {
            const y = new Date().getFullYear() - i;
            return `<option value="${y}" ${parseInt(financials.selectedYear) == y ? 'selected' : ''}>${y}</option>`;
        }).join('');
        let q = financials.periodValue.includes('Q') ? financials.periodValue.split('-')[1] : 'Q1_CAL';
        return `
            <div class="flex items-center gap-1">
                <select id="report-year-select" class="border rounded p-1.5 text-sm text-gray-600 focus:ring-SLATE-500 shadow-inner bg-white">${yOpts}</select>
                <select id="report-quarter-select" class="border rounded p-1.5 text-sm text-gray-600 focus:ring-SLATE-500 shadow-inner bg-white">
                    <option value="Q1_CAL" ${q === 'Q1_CAL' ? 'selected' : ''}>Jan-Mar</option>
                    <option value="Q2_CAL" ${q === 'Q2_CAL' ? 'selected' : ''}>Apr-Jun</option>
                    <option value="Q3_CAL" ${q === 'Q3_CAL' ? 'selected' : ''}>Jul-Sep</option>
                    <option value="Q4_CAL" ${q === 'Q4_CAL' ? 'selected' : ''}>Oct-Dec</option>
                </select>
            </div>
        `;
    }
}

function renderAssetRows() {
    const container = document.getElementById('assets-list-container');
    if (!container) return;
    let html = '';
    financials.bs.fixedAssets.forEach((asset, index) => {
        html += `
            <div class="flex items-center gap-2 mb-1">
                <input type="text" data-idx="${index}" class="asset-name flex-1 border-b border-blue-200 text-xs py-1 bg-transparent focus:outline-none focus:border-blue-500" value="${escapeHTML(asset.name)}" placeholder="Name">
                <input type="number" data-idx="${index}" class="asset-val w-20 text-right border rounded px-1 py-0.5 text-xs bg-white" value="${asset.value}" placeholder="0">
                <button data-idx="${index}" class="del-asset text-red-400 hover:text-red-600 font-bold px-1 transition-colors">&times;</button>
            </div>
        `;
    });
    container.innerHTML = html;
}

function renderCustomExpenseRows() {
    const container = document.getElementById('custom-exp-list-container');
    if (!container) return;
    let html = '';
    financials.pl.customExpenses.forEach((exp, index) => {
        html += `
            <div class="flex items-center gap-2 mb-1">
                <input type="text" data-idx="${index}" class="custom-exp-name flex-1 border-b border-purple-200 text-xs py-1 bg-transparent focus:outline-none focus:border-purple-500" value="${escapeHTML(exp.name)}" placeholder="Expense Name">
                <input type="number" data-idx="${index}" class="custom-exp-val w-20 text-right border rounded px-1 py-0.5 text-xs bg-white" value="${exp.value}" placeholder="0">
                <button data-idx="${index}" class="del-custom-exp text-red-400 hover:text-red-600 font-bold px-1 transition-colors">&times;</button>
            </div>
        `;
    });
    container.innerHTML = html;
}

function updateStateByPath(path, value) {
    const parts = path.split('.');
    let obj = financials;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = parseFloat(value) || 0;
}

async function handleRefreshClick() {
    if (financials.periodType === 'monthly') {
        const val = document.getElementById('report-period-val');
        if (val) financials.periodValue = val.value;
    } else {
        const y = document.getElementById('report-year-select').value;
        const q = document.getElementById('report-quarter-select').value;
        financials.periodValue = `${y}-${q}`;
        financials.selectedYear = y;
    }
    await renderReportLibraryPage();
}

function updateComputedTotalsDOM(dryRun = false) {
    const { trading, pl, bs } = financials;

    // 🚀 THE FIX: WAC Rounding Anomaly Auto-Reconciliation
    // When calculating massive inventory values, .toFixed(2) unit costs can drift from the exact Purchase Ledger by fractions of a rupee.
    // If there are no sales, we forcefully snap the Closing Stock to match the Purchase Ledger to eliminate phantom profits.
    let rawRevSide = safeMath.add(trading.sales, trading.closingStock);
    let rawCostSide = safeMath.add(safeMath.add(trading.openingStock, trading.purchases), trading.directExpenses);
    let rawGrossProfit = safeMath.subtract(rawRevSide, rawCostSide);

    if (trading.sales === 0 && Math.abs(rawGrossProfit) > 0 && Math.abs(rawGrossProfit) < 10) {
        // Snap closing stock to perfectly match the ledger cost
        trading.closingStock = safeMath.subtract(trading.closingStock, rawGrossProfit);
    }

    // Recalculate with perfectly reconciled values
    const revSide = safeMath.add(trading.sales, trading.closingStock);
    const costSide = safeMath.add(safeMath.add(trading.openingStock, trading.purchases), trading.directExpenses);
    const grossProfit = safeMath.subtract(revSide, costSide);
    trading.grossProfit = grossProfit;

    const totalStandardExp = Object.values(pl.expenses).reduce((acc, val) => safeMath.add(acc, parseFloat(val) || 0), 0);
    const totalCustomExp = pl.customExpenses.reduce((acc, item) => safeMath.add(acc, parseFloat(item.value) || 0), 0);
    const totalIndExp = safeMath.add(totalStandardExp, totalCustomExp);

    const grossPlusOther = safeMath.add(grossProfit, pl.otherIncome);
    const netProfit = safeMath.subtract(grossPlusOther, totalIndExp);
    pl.netProfit = netProfit;

    const netCapital = safeMath.add(safeMath.subtract(bs.capital, bs.drawings), netProfit);
    const totalLiab = safeMath.add(safeMath.add(safeMath.add(netCapital, bs.reserves), safeMath.add(bs.securedLoans, bs.unsecuredLoans)), bs.sundryCreditors);

    const totalFixed = bs.fixedAssets.reduce((acc, val) => safeMath.add(acc, parseFloat(val.value) || 0), 0);
    const totalAssets = safeMath.add(safeMath.add(safeMath.add(totalFixed, trading.closingStock), bs.sundryDebtors), safeMath.add(bs.cashInHand, bs.bankAccounts));

    const diff = safeMath.subtract(totalAssets, totalLiab);

    if (dryRun) return;

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val.toFixed(2); };

    setText('disp-gp-header', grossProfit);
    setText('disp-gp-main', grossProfit);
    setText('disp-gp-brought', grossProfit);
    setText('disp-np-header', netProfit);
    setText('disp-np-main', netProfit);
    setText('disp-np-bs', netProfit);
    setText('disp-net-capital', netCapital);
    setText('disp-total-liab', totalLiab);
    setText('disp-total-fixed', totalFixed);
    setText('disp-total-assets', totalAssets);

    const statusEl = document.getElementById('disp-bs-status');
    if (statusEl) {
        if (Math.abs(diff) < 1.0) {
            statusEl.className = "text-xs bg-gray-700 px-3 py-1 rounded-full text-green-400 border border-green-500 font-bold flex items-center gap-1";
            statusEl.innerHTML = `✓ Balanced`;
        } else {
            statusEl.className = "text-xs bg-gray-700 px-3 py-1 rounded-full text-red-400 border border-red-500 font-bold flex items-center gap-1";
            statusEl.innerHTML = `⚠ Diff: ${diff.toFixed(2)}`;
        }
    }
}

function printFinancialStatements() {
    const { bs, trading, pl } = financials;
    const currency = getCurrencySymbol();
    const periodLabel = financials.periodType === 'monthly' ? financials.periodValue : `${financials.selectedYear} ${financials.periodValue}`;
    const storeName = document.getElementById('dashboard-store-name')?.textContent || 'My Store';
    const totalFixed = bs.fixedAssets.reduce((acc, val) => safeMath.add(acc, parseFloat(val.value) || 0), 0);
    const totalAssets = safeMath.add(safeMath.add(safeMath.add(totalFixed, trading.closingStock), bs.sundryDebtors), safeMath.add(bs.cashInHand, bs.bankAccounts));
    const netCapital = safeMath.add(safeMath.subtract(bs.capital, bs.drawings), pl.netProfit);
    const totalLiab = safeMath.add(safeMath.add(safeMath.add(netCapital, bs.reserves), safeMath.add(bs.securedLoans, bs.unsecuredLoans)), bs.sundryCreditors);

    const renderPrintRow = (label, val, bold = false) => `
        <tr>
            <td style="padding: 4px 0 4px 10px; ${bold ? 'font-weight:bold;' : ''}">${label}</td>
            <td style="text-align: right; ${bold ? 'font-weight:bold;' : ''}">${val !== '' ? currency + parseFloat(val).toFixed(2) : ''}</td>
        </tr>
    `;

    let expenseRows = '';
    Object.entries(pl.expenses).forEach(([key, val]) => {
        if (val > 0) expenseRows += renderPrintRow(key.charAt(0).toUpperCase() + key.slice(1), val);
    });
    pl.customExpenses.forEach(exp => {
        if (exp.value > 0) expenseRows += renderPrintRow(exp.name, exp.value);
    });

    const html = `
        <div style="font-family: 'Inter', Arial, sans-serif; box-sizing: border-box; width: 100%; max-width: 100%; margin: 0 auto; color: #000 !important; background-color: #fff !important; overflow-x: hidden;">
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="font-size: 26px; font-weight: bold; margin: 0; color: #000;">${escapeHTML(storeName)}</h1>
                <h2 style="font-size: 18px; margin: 8px 0; color: #333; text-transform: uppercase; letter-spacing: 1px;">Financial Statements</h2>
                <p style="font-size: 14px; color: #555; border-top: 1px solid #eee; display: inline-block; padding-top: 5px; margin-top: 5px;">Period: ${periodLabel}</p>
            </div>

            <!-- TRADING ACCOUNT -->
            <div style="margin-bottom: 35px;">
                <h3 style="font-size: 15px; font-weight: bold; text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 15px;">Trading Account</h3>
                <div style="display: flex; gap: 0; border-bottom: 1px solid #000; width: 100%;">
                    <!-- Dr -->
                    <div style="flex: 1; border-right: 1px solid #ccc; padding: 0 15px 15px 0;">
                        <table style="width: 100%; font-size: 12px; border-collapse: collapse; table-layout: fixed;">
                            <tr><td style="padding: 5px 0; font-weight: bold; text-decoration: underline;">Particulars (Dr.)</td><td style="text-align: right; font-weight: bold; text-decoration: underline; width: 100px;">Amount</td></tr>
                            ${renderPrintRow('Opening Stock', trading.openingStock)}
                            ${renderPrintRow('Purchases', trading.purchases)}
                            ${renderPrintRow('Direct Expenses', trading.directExpenses)}
                            <tr><td colspan="2" style="height:15px;"></td></tr>
                            <tr style="background:#f0fdf4;">
                                <td style="padding: 6px 0 6px 10px; font-weight: bold; color: #166534;">Gross Profit c/d</td>
                                <td style="text-align: right; font-weight: bold; color: #166534;">${currency}${trading.grossProfit.toFixed(2)}</td>
                            </tr>
                        </table>
                    </div>
                    <!-- Cr -->
                    <div style="flex: 1; padding: 0 0 15px 15px;">
                        <table style="width: 100%; font-size: 12px; border-collapse: collapse; table-layout: fixed;">
                            <tr><td style="padding: 5px 0; font-weight: bold; text-decoration: underline;">Particulars (Cr.)</td><td style="text-align: right; font-weight: bold; text-decoration: underline; width: 100px;">Amount</td></tr>
                            ${renderPrintRow('Sales Accounts', trading.sales)}
                            ${renderPrintRow('Closing Stock', trading.closingStock)}
                        </table>
                    </div>
                </div>
            </div>

            <!-- P&L ACCOUNT -->
            <div style="margin-bottom: 35px;">
                <h3 style="font-size: 15px; font-weight: bold; text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 15px;">Profit & Loss Account</h3>
                <div style="display: flex; gap: 0; border-bottom: 1px solid #000; width: 100%;">
                    <!-- Dr -->
                    <div style="flex: 1; border-right: 1px solid #ccc; padding: 0 15px 15px 0;">
                        <table style="width: 100%; font-size: 12px; border-collapse: collapse; table-layout: fixed;">
                            <tr><td style="padding: 5px 0; font-weight: bold; text-decoration: underline;">Expenses (Dr.)</td><td style="text-align: right; font-weight: bold; text-decoration: underline; width: 100px;">Amount</td></tr>
                            ${expenseRows}
                            <tr><td colspan="2" style="height:15px;"></td></tr>
                            <tr style="background:#f5f3ff;">
                                <td style="padding: 6px 0 6px 10px; font-weight: bold; color: #4338ca;">Net Profit</td>
                                <td style="text-align: right; font-weight: bold; color: #4338ca;">${currency}${pl.netProfit.toFixed(2)}</td>
                            </tr>
                        </table>
                    </div>
                    <!-- Cr -->
                    <div style="flex: 1; padding: 0 0 15px 15px;">
                        <table style="width: 100%; font-size: 12px; border-collapse: collapse; table-layout: fixed;">
                            <tr><td style="padding: 5px 0; font-weight: bold; text-decoration: underline;">Incomes (Cr.)</td><td style="text-align: right; font-weight: bold; text-decoration: underline; width: 100px;">Amount</td></tr>
                            ${renderPrintRow('Gross Profit b/d', trading.grossProfit)}
                            ${renderPrintRow('Other Income', pl.otherIncome)}
                        </table>
                    </div>
                </div>
            </div>

            <!-- BALANCE SHEET -->
            <div>
                <h3 style="font-size: 15px; font-weight: bold; text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 15px;">Balance Sheet</h3>
                <div style="display: flex; gap: 0; border-bottom: 2.5px solid #000; width: 100%;">
                    <!-- LIABILITIES SIDE -->
                    <div style="flex: 1; padding: 0 15px 15px 0; border-right: 1px solid #ccc;">
                        <table style="width: 100%; font-size: 12px; border-collapse: collapse; table-layout: fixed;">
                            <tr><td style="padding: 5px 0; font-weight: bold; text-decoration: underline;">Liabilities</td><td style="text-align: right; font-weight: bold; text-decoration: underline; width: 100px;">Amount</td></tr>
                            
                            <tr><td style="padding: 8px 0 4px 0; font-weight: bold; font-size: 11px; color:#444; border-bottom: 0.5px solid #eee;">Capital Account</td><td></td></tr>
                            ${renderPrintRow('Opening Capital', bs.capital)}
                            ${renderPrintRow('Add: Net Profit', pl.netProfit)}
                            ${renderPrintRow('Less: Drawings', `(${bs.drawings.toFixed(2)})`)}
                            <tr style="border-top:1px solid #ccc; background: #fafafa;"><td style="padding: 6px 0 6px 10px; font-weight: bold;">Net Capital</td><td style="text-align: right; font-weight: bold;">${currency}${netCapital.toFixed(2)}</td></tr>
                            
                            <tr><td colspan="2" style="height: 10px;"></td></tr>

                            <tr><td style="padding: 8px 0 4px 0; font-weight: bold; font-size: 11px; color:#444; border-bottom: 0.5px solid #eee;">Loans & Liabilities</td><td></td></tr>
                            ${renderPrintRow('Secured Loans', bs.securedLoans)}
                            ${renderPrintRow('Unsecured Loans', bs.unsecuredLoans)}
                            ${renderPrintRow('Sundry Creditors', bs.sundryCreditors)}
                            ${renderPrintRow('Reserves & Surplus', bs.reserves)}
                        </table>
                    </div>

                    <!-- ASSETS SIDE -->
                    <div style="flex: 1; padding: 0 0 15px 15px;">
                        <table style="width: 100%; font-size: 12px; border-collapse: collapse; table-layout: fixed;">
                            <tr><td style="padding: 5px 0; font-weight: bold; text-decoration: underline;">Assets</td><td style="text-align: right; font-weight: bold; text-decoration: underline; width: 100px;">Amount</td></tr>
                            
                            <tr><td style="padding: 8px 0 4px 0; font-weight: bold; font-size: 11px; color:#444; border-bottom: 0.5px solid #eee;">Fixed Assets</td><td></td></tr>
                            ${bs.fixedAssets.map(a => renderPrintRow(escapeHTML(a.name), a.value)).join('')}
                            <tr style="border-top:1px solid #ccc; background: #f0f9ff;"><td style="padding: 6px 0 6px 10px; font-weight: bold;">Total Fixed Assets</td><td style="text-align: right; font-weight: bold;">${currency}${totalFixed.toFixed(2)}</td></tr>

                            <tr><td colspan="2" style="height: 10px;"></td></tr>

                            <tr><td style="padding: 8px 0 4px 0; font-weight: bold; font-size: 11px; color:#444; border-bottom: 0.5px solid #eee;">Current Assets</td><td></td></tr>
                            ${renderPrintRow('Closing Stock', trading.closingStock)}
                            ${renderPrintRow('Sundry Debtors', bs.sundryDebtors)}
                            ${renderPrintRow('Cash-in-Hand', bs.cashInHand)}
                            ${renderPrintRow('Bank Accounts', bs.bankAccounts)}
                        </table>
                    </div>
                </div>
            </div>

            <div style="display: flex; gap: 0; font-size: 14px; font-weight: bold; padding: 15px 0; color: #000; background: #f9f9f9; border: 1px solid #eee; border-top: none; width: 100%;">
                <div style="flex: 1; display: flex; justify-content: space-between; padding-right: 15px; border-right: 1px solid #ccc;">
                    <span style="padding-left: 10px;">Total Liabilities</span>
                    <span>${currency}${totalLiab.toFixed(2)}</span>
                </div>
                <div style="flex: 1; display: flex; justify-content: space-between; padding-left: 15px;">
                    <span>Total Assets</span>
                    <span style="padding-right: 10px;">${currency}${totalAssets.toFixed(2)}</span>
                </div>
            </div>
            
            <div style="text-align: center; margin-top: 50px; font-size: 10px; color: #777; border-top: 1px dashed #eee; padding-top: 10px;">
                Generated by Mifela Inventory Management System on ${new Date().toLocaleString()}
            </div>
            
            <div style="text-align: center; margin-top: 20px;">
                <p style="font-size: 10px; font-weight: bold; color: #aaa; letter-spacing: 2px; text-transform: uppercase;">Mifela Inventory Management</p>
                <p style="font-size: 11px; color: #777; font-weight: 500;">© 2026 All Rights Reserved</p>
            </div>
        </div>
    `;

    const modalId = 'print-preview-modal';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();

    const modalHtml = `
        <div id="${modalId}" class="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900 bg-opacity-75  ">
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[95vh] flex flex-col overflow-hidden">
                <div class="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                    <h3 class="text-lg font-bold text-gray-800">Financial Report Preview</h3>
                    <button id="close-preview-btn" class="text-gray-500 hover:text-gray-700">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="flex-1 overflow-auto bg-gray-200 p-8 flex justify-center">
                    <div class="bg-white shadow-2xl w-[210mm] min-h-[297mm] p-[10mm] origin-top transform scale-[0.85] md:scale-[0.95] lg:scale-100 mb-20">
                        ${html}
                    </div>
                </div>
                <div class="px-6 py-4 border-t border-gray-200 bg-white flex justify-end gap-3 shadow-top">
                    <button id="cancel-print-btn" class="px-5 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition">Cancel</button>
                    <button id="confirm-print-btn" class="px-8 py-2.5 bg-SLATE-600 text-white rounded-lg hover:bg-SLATE-700 font-bold shadow-md flex items-center gap-2 transition active:scale-95">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                        Print Statements
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const closePreview = () => document.getElementById(modalId).remove();
    document.getElementById('close-preview-btn').onclick = closePreview;
    document.getElementById('cancel-print-btn').onclick = closePreview;

    document.getElementById('confirm-print-btn').onclick = () => {
        const btn = document.getElementById('confirm-print-btn');
        btn.innerHTML = `<svg class="animate-spin h-5 w-5 mr-2 inline" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Sending to Printer...`;
        btn.disabled = true;

        const fullHtml = `
            <!DOCTYPE html>
            <html>
                <head>
                    <title>Financial Report</title>
                    <style>
                        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');
                        body { margin: 0; padding: 0; background: white; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                        @media print { 
                            @page { margin: 1cm; }
                            body { margin: 0; padding: 0; }
                        }
                        * { box-sizing: border-box; }
                    </style>
                </head>
                <body>
                    ${html}
                </body>
            </html>
        `;

        // 🚀 THE MAGIC: Pass the job to the global router and tag it as a 'report'
        if (typeof window.executePrint === 'function') {
            window.executePrint(fullHtml, 'report');
        } else {
            console.warn("Smart Print Router not found. Ensure app.js is updated.");
        }

        // Automatically close the preview window after it sends
        setTimeout(() => {
            closePreview();
        }, 1000);
    };
}

function generateDetailedTallyXML() {
    const { trading, pl, bs } = financials;
    let xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC><REQUESTDATA>`;
    const add = (name, parent, val, type) => {
        if (!val) return;
        const amt = (type === 'liab' || type === 'income') ? -Math.abs(val) : Math.abs(val);
        xml += `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${escapeHTML(name)}" RESERVEDNAME=""><PARENT>${parent}</PARENT><OPENINGBALANCE>${amt}</OPENINGBALANCE></LEDGER></TALLYMESSAGE>`;
    };
    add('Opening Stock', 'Stock-in-Hand', trading.openingStock, 'asset');
    add('Purchases', 'Purchase Accounts', trading.purchases, 'exp');
    add('Direct Expenses', 'Direct Expenses', trading.directExpenses, 'exp');
    add('Sales', 'Sales Accounts', trading.sales, 'income');
    add('Closing Stock', 'Stock-in-Hand', trading.closingStock, 'asset');
    Object.entries(pl.expenses).forEach(([k, v]) => {
        add(k.charAt(0).toUpperCase() + k.slice(1), 'Indirect Expenses', v, 'exp');
    });
    pl.customExpenses.forEach(exp => {
        add(exp.name, 'Indirect Expenses', exp.value, 'exp');
    });
    add('Other Income', 'Indirect Incomes', pl.otherIncome, 'income');
    add('Capital', 'Capital Account', bs.capital, 'liab');
    add('Drawings', 'Capital Account', -bs.drawings, 'asset');
    add('Secured Loans', 'Secured Loans', bs.securedLoans, 'liab');
    add('Unsecured Loans', 'Unsecured Loans', bs.unsecuredLoans, 'liab');
    add('Reserves', 'Reserves & Surplus', bs.reserves, 'liab');
    add('Sundry Creditors', 'Sundry Creditors', bs.sundryCreditors, 'liab');
    add('Sundry Debtors', 'Sundry Debtors', bs.sundryDebtors, 'asset');
    add('Cash', 'Cash-in-Hand', bs.cashInHand, 'asset');
    add('Bank', 'Bank Accounts', bs.bankAccounts, 'asset');
    bs.fixedAssets.forEach(a => add(a.name, 'Fixed Assets', a.value, 'asset'));
    xml += `</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    const blob = new Blob([xml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Report_${financials.periodValue}.xml`;
    a.click();
}

function generateJSONExport() {
    const exportData = {
        ...financials,
        summary: {
            grossProfit: financials.trading.grossProfit,
            netProfit: financials.pl.netProfit
        }
    };
    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Report_${financials.periodValue}.json`;
    a.click();
}


window.downloadGSTR = async function (type) {
    const monthInput = document.getElementById(`gstr${type}-month`).value;
    if (!monthInput) {
        showModal('Required', 'Please select a month to generate the report.', 'warning');
        return;
    }

    const [year, month] = monthInput.split('-');
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const activeStoreId = getStoreId();
    if (!activeStoreId) return;

    showModal('Generating...', `Compiling GSTR-${type} for ${monthInput}...`, 'info');

    try {
        const txRef = collection(db, `artifacts/${appId}/stores/${activeStoreId}/transactions`);
        const q = query(txRef, where('timestamp', '>=', startDate), where('timestamp', '<=', endDate));
        const snap = await getDocs(q);

        let csvContent = "";

        // ==========================================
        // ADVANCED GSTR-1 (STRICT B2B FORMAT)
        // ==========================================
        if (type === '1') {
            const headers = [
                "GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number", "Invoice Date",
                "Invoice Value", "Place Of Supply", "Reverse Charge", "Invoice Type",
                "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"
            ];
            csvContent = headers.join(",") + "\n";

            let b2bFound = false;

            snap.forEach(doc => {
                const tx = doc.data();
                const txType = tx.type || tx.summary?.transactionType || 'SALE';

                // Only process SALES where the customer has a valid GSTIN (B2B)
                if (txType.toUpperCase() === 'SALE' && tx.customer && tx.customer.gstin && tx.customer.gstin.length >= 15) {
                    b2bFound = true;
                    const gstin = tx.customer.gstin.toUpperCase();
                    const name = (tx.customer.name || 'Walk-in').replace(/"/g, '""');
                    const invNum = tx.invoiceId || doc.id;

                    // Format date to DD-MMM-YYYY (e.g. 25-Mar-2026)
                    const dateObj = tx.timestamp?.toDate ? tx.timestamp.toDate() : new Date(tx.timestamp || Date.now());
                    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                    const invDate = `${String(dateObj.getDate()).padStart(2, '0')}-${months[dateObj.getMonth()]}-${dateObj.getFullYear()}`;

                    const invValue = parseFloat(tx.summary?.total || 0).toFixed(2);

                    // Extract State Code from GSTIN to format Place of Supply
                    const stateCode = gstin.substring(0, 2);
                    const stateName = tx.customer.state || "Unknown";
                    const pos = `${stateCode}-${stateName}`;

                    const revCharge = "N";
                    const invTypeStr = "Regular";
                    const eComm = "";

                    // Inside GSTR-1 Export (type === '1')
                    const rateGroups = {};

                    (tx.items || []).forEach(item => {
                        const rate = parseFloat(item.taxRate || item.gstSlab || 0);
                        const cessRate = parseFloat(item.cessRate || item.cess || 0);
                        const lineTotal = parseFloat(item.subtotal || (item.price * item.quantity));

                        // Extract base Taxable Value using combined rate
                        const combinedRate = rate + cessRate;
                        const taxableValue = item.taxableValue || (lineTotal / (1 + (combinedRate / 100)));
                        const cessAmt = item.cessAmount || (taxableValue * (cessRate / 100));
                        if (item.type === 'homemade' || item.type === 'bundle') return;
                        if (!rateGroups[rate]) rateGroups[rate] = { taxable: 0, cess: 0 };
                        rateGroups[rate].taxable += taxableValue;
                        rateGroups[rate].cess += cessAmt;
                    });

                    // Generate a CSV row for each rate group found on the invoice
                    Object.keys(rateGroups).forEach(rate => {
                        const taxableVal = rateGroups[rate].taxable.toFixed(2);
                        const cess = rateGroups[rate].cess.toFixed(2);

                        const row = [
                            gstin, name, invNum, invDate, invValue, pos, revCharge, invTypeStr, eComm, rate, taxableVal, cess
                        ].join(",");

                        csvContent += row + "\n";
                    });
                }
            });

            if (!b2bFound) {
                showModal('No B2B Data', 'No B2B sales with valid GSTINs were found for this period.', 'info');
                return; // Stop export
            }
        }
        // ==========================================
        // LEGACY GSTR-2 FORMAT
        // ==========================================
        else if (type === '2') {
            csvContent = "Invoice No,Date,Party Name,GSTIN,State,Total Invoice Value,Taxable Value,IGST,CGST,SGST,CESS\n";

            snap.forEach(doc => {
                const tx = doc.data();
                const txType = tx.type || tx.summary?.transactionType || 'SALE';

                if (txType.toUpperCase() === 'PURCHASE') {
                    const dateStr = tx.timestamp?.toDate ? tx.timestamp.toDate().toLocaleDateString() : '';
                    let partyName = tx.customer?.name || tx.dealer?.name || 'Walk-in';
                    partyName = partyName.replace(/,/g, '');

                    const gstin = tx.customer?.gstin || tx.dealer?.gstin || '';
                    const state = tx.customer?.state || tx.dealer?.state || '';

                    let totalInvoice = tx.summary?.total || 0;
                    let taxableValue = 0;
                    let igst = 0, cgst = 0, sgst = 0, cess = 0;

                    if (tx.items && Array.isArray(tx.items)) {
                        tx.items.forEach(item => {
                            const itemTotal = safeMath.multiply(item.price || item.cost || 0, Math.abs(item.quantity || 0));
                            const taxRate = parseFloat(item.taxRate || item.gstSlab || 0);
                            const itemCessRate = parseFloat(item.cess || 0);
                            const isOms = item.oms === true || item.oms === 'true';

                            // Standardized Inclusive Math
                            const baseTaxable = itemTotal / (1 + (taxRate / 100));
                            const baseTaxAmt = itemTotal - baseTaxable;

                            taxableValue = safeMath.add(taxableValue, baseTaxable);
                            if (item.type === 'homemade' || item.type === 'bundle') return;
                            if (isOms) {
                                igst = safeMath.add(igst, baseTaxAmt);
                            } else {
                                cgst = safeMath.add(cgst, baseTaxAmt / 2);
                                sgst = safeMath.add(sgst, baseTaxAmt / 2);
                            }
                            cess = safeMath.add(cess, parseFloat(item.cessAmount || 0)); // Assuming cess is a flat amount or adjust as needed
                        });
                    }

                    csvContent += `"${tx.invoiceId || doc.id}","${dateStr}","${partyName}","${gstin}","${state}",${totalInvoice.toFixed(2)},${taxableValue.toFixed(2)},${igst.toFixed(2)},${cgst.toFixed(2)},${sgst.toFixed(2)},${cess.toFixed(2)}\n`;
                }
            });
        }
        // ==========================================
        // LEGACY GSTR-3B FORMAT
        // ==========================================
        else if (type === '3') {
            csvContent = "Description,Total Invoice Value,Taxable Value,IGST,CGST,SGST,CESS\n";

            let outTotal = 0, outTaxable = 0, outIgst = 0, outCgst = 0, outSgst = 0, outCess = 0;
            let inTotal = 0, inTaxable = 0, inIgst = 0, inCgst = 0, inSgst = 0, inCess = 0;

            snap.forEach(doc => {
                const tx = doc.data();
                const txType = tx.type || tx.summary?.transactionType || 'SALE';

                let totalInvoice = Math.abs(tx.summary?.total || 0);
                let taxableValue = 0;
                let igst = 0, cgst = 0, sgst = 0, cess = 0;

                if (tx.items && Array.isArray(tx.items)) {
                    tx.items.forEach(item => {
                        const itemTotal = safeMath.multiply(item.price || 0, Math.abs(item.quantity || 0));
                        const taxRate = item.taxRate || 0;
                        const itemCessRate = item.cess || 0;
                        const isOms = item.oms === true || item.oms === 'true';

                        // 🚀 FIX: Prevent crash by using explicit inclusive math instead of missing utility functions
                        const combinedRate = parseFloat(taxRate) + parseFloat(itemCessRate);
                        const taxable = item.taxableValue || (itemTotal / (1 + (combinedRate / 100)));

                        const baseTaxAmt = item.taxAmount || (taxable * (taxRate / 100));
                        const cessAmt = item.cessAmount || (taxable * (itemCessRate / 100));

                        taxableValue = safeMath.add(taxableValue, taxable);
                        if (item.type === 'homemade' || item.type === 'bundle') return;
                        if (isOms) {
                            igst = safeMath.add(igst, baseTaxAmt);
                        } else {
                            cgst = safeMath.add(cgst, baseTaxAmt / 2);
                            sgst = safeMath.add(sgst, baseTaxAmt / 2);
                        }
                        cess = safeMath.add(cess, cessAmt);
                    });
                }

                if (txType.toUpperCase() === 'SALE') {
                    outTotal += totalInvoice; outTaxable += taxableValue; outIgst += igst; outCgst += cgst; outSgst += sgst; outCess += cess;
                } else if (txType.toUpperCase() === 'PURCHASE') {
                    inTotal += totalInvoice; inTaxable += taxableValue; inIgst += igst; inCgst += cgst; inSgst += sgst; inCess += cess;
                }
            });

            csvContent += `"Outward Supplies (Sales)",${outTotal.toFixed(2)},${outTaxable.toFixed(2)},${outIgst.toFixed(2)},${outCgst.toFixed(2)},${outSgst.toFixed(2)},${outCess.toFixed(2)}\n`;
            csvContent += `"Inward Supplies (Purchases)",${inTotal.toFixed(2)},${inTaxable.toFixed(2)},${inIgst.toFixed(2)},${inCgst.toFixed(2)},${inSgst.toFixed(2)},${inCess.toFixed(2)}\n`;
        }

        // TRIGGER DOWNLOAD
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", `GSTR-${type}_${monthInput}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        showModal('Success', `GSTR-${type} Exported Successfully.`, 'success');

    } catch (error) {
        console.error("GSTR Generation Error:", error);
        showModal('Error', 'Failed to generate report. Missing indexes or too much data.', 'error');
    }
};