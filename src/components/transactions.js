// src/components/transactions.js



import { 
    getTransactionsRef, 
    getProductsRef,
    getCustomersRef,
    getCurrencySymbol,
    getCurrentLocationId, 
    getUserRole,
    getUserId,
    getStoreId,
    appId,
    getCurrencyCode,
    // --- Step 1: Multi-Location Imports ---
    getAvailableLocations,
    getUserAssignedLocationId,
    setCurrentLocation,
    getCurrentUserPlan
} from '../store/state.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DOM, showModal } from '../utils/dom.js'; 
import { buildAndPrintInvoice } from '../utils/print.js'; 
import { escapeHTML } from '../utils/security.js';
import { safeMath } from '../utils/math.js';
import { generateInvoiceId } from '../utils/ids.js';


// --- Local cache & Pagination State ---
let localTransactionsCache = [];
let firstVisibleTransaction = null;
let lastVisibleTransaction = null;
const TRANSACTIONS_PER_PAGE = 15; 
let isTransactionsInitialized = false;
let currentTypeFilter = 'ALL'; 
let isFetching = false; // Prevents race conditions / doubling
let currentCustomerDues = 0; // Tracks the active customer's pending balance
let stagedDuesPayment = 0;
// --- Public Functions (Event Handlers) ---


export async function loadTransactionsPage() {
    if (isFetching) return;
    isFetching = true;
    
    const role = typeof getUserRole === 'function' ? getUserRole() : 'manager';
    const assignedLoc = typeof getUserAssignedLocationId === 'function' ? getUserAssignedLocationId() : 'main';
    let currentLoc = typeof getCurrentLocationId === 'function' ? getCurrentLocationId() : 'main';
    const canAccessAllLocations = (role === 'admin' || role === 'accountant');

    if (!canAccessAllLocations && currentLoc !== assignedLoc) {
        if (typeof setCurrentLocation === 'function') setCurrentLocation(assignedLoc);
        currentLoc = assignedLoc;
    }

    renderTransactionUIStructure();
    injectTransactionsCopyright();
    checkChequeAlerts();

    if (!DOM.transactions.table) {
        DOM.transactions.table = document.getElementById('transactions-table-body');
        if (!DOM.transactions.table) {
            isFetching = false;
            return;
        }
    }

    const paymentSelect = document.getElementById('tx-payment-filter');
    const searchInput = document.getElementById('tx-search');

    if (!isTransactionsInitialized) {
        setupTransactionListeners();
        setupTypeFilterButtons(); 
        isTransactionsInitialized = true;
    }

    DOM.transactions.table.innerHTML = `
        <tr><td colspan="7" class="py-12 text-center">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-2"></div>
            <span class="text-sm font-medium text-gray-500">Fetching local records...</span>
        </td></tr>
    `;

    try {
        if (!window.dbAPI || !window.dbAPI.getTransactionsSince) throw new Error("Offline Database not ready.");

        // 1. Fetch all local transactions
        let txs = await window.dbAPI.getTransactionsSince("2000-01-01T00:00:00Z");

        const locationSelect = document.getElementById('tx-location-filter');
        let filterLoc = currentLoc;
        if (canAccessAllLocations && locationSelect) filterLoc = locationSelect.value;

        // 2. Smart Search Filtering
        const rawSearch = searchInput ? searchInput.value.trim() : '';
        const searchTerm = rawSearch.toUpperCase();

        if (searchTerm) {
            txs = txs.filter(tx => {
                if (filterLoc !== 'all' && (tx.locationId || 'main') !== filterLoc) return false;

                if (/^(INV|RET|PUR|REV|MAN|OB|MRG)-/.test(searchTerm)) return tx.invoiceId === searchTerm;
                if (/^(CUST|MERCH)-/.test(searchTerm)) return tx.customer?.id === searchTerm;
                if (/^\d+$/.test(rawSearch)) {
                    if (rawSearch.length >= 10) {
                        const phoneFormatted = rawSearch.length === 10 ? `+91${rawSearch}` : `+${rawSearch}`;
                        return tx.customer?.phone === phoneFormatted;
                    } else {
                        return tx.invoiceId === `INV-${searchTerm}`;
                    }
                }
                return tx.customer?.name === rawSearch;
            });
            
            const pseudoSnapshot = { empty: txs.length === 0, docs: txs.map(tx => ({ id: tx.id, data: () => tx })) };
            updateLocalCache(pseudoSnapshot);
            renderTransactionsTable();
            return; 
        }

        // 3. Apply Standard Filters
        if (filterLoc !== 'all') {
            txs = txs.filter(tx => (tx.locationId || 'main') === filterLoc);
        }

        if (currentTypeFilter !== 'ALL') {
            if (currentTypeFilter === 'SALE') {
                txs = txs.filter(tx => tx.summary?.transactionType === "SALE");
            } else if (currentTypeFilter === 'ADJUSTMENT') {
                txs = txs.filter(tx => tx.type === "ADJUSTMENT" || tx.type === "LOSS"); 
            } else if (currentTypeFilter === 'LOSS') {
                txs = txs.filter(tx => tx.type === "LOSS");
            } else {
                txs = txs.filter(tx => tx.type === currentTypeFilter);
            }
        }

        const currentPaymentMethod = paymentSelect ? paymentSelect.value : 'all';
        if (currentPaymentMethod && currentPaymentMethod !== 'all') {
            txs = txs.filter(tx => tx.summary?.paymentMethod === currentPaymentMethod);
        }

        const startDateVal = document.getElementById('tx-start-date')?.value;
        const endDateVal = document.getElementById('tx-end-date')?.value;

        if (startDateVal) {
            const startIST = getISTBoundary(startDateVal, false).getTime();
            txs = txs.filter(tx => new Date(tx.timestamp || Date.now()).getTime() >= startIST);
        }
        if (endDateVal) {
            const endIST = getISTBoundary(endDateVal, true).getTime();
            txs = txs.filter(tx => new Date(tx.timestamp || Date.now()).getTime() <= endIST);
        }

        // 4. Sort and Paginate
        txs.sort((a, b) => new Date(b.timestamp || Date.now()).getTime() - new Date(a.timestamp || Date.now()).getTime());
        txs = txs.slice(0, TRANSACTIONS_PER_PAGE);

        const pseudoSnapshot = { empty: txs.length === 0, docs: txs.map(tx => ({ id: tx.id, data: () => tx })) };
        updateLocalCache(pseudoSnapshot);
        renderTransactionsTable();

    } catch (error) {
        console.error("Error loading transactions:", error);
        DOM.transactions.table.innerHTML = `<tr><td colspan="7" class="py-12 px-4 text-center bg-slate-50/50"><div class="max-w-lg mx-auto bg-white p-6 rounded-2xl border border-red-100 shadow-xl"><div class="text-red-700 font-black text-lg mb-1">Local Database Error</div><p class="text-sm text-red-600 mb-4">${error.message}</p></div></td></tr>`;
    } finally {
        isFetching = false;
    }
}


// --- Helper: Strict IST Time Boundaries ---
function getISTBoundary(dateString, isEndOfDay = false) {
    // Expects dateString format: "YYYY-MM-DD"
    // Start of day IST: YYYY-MM-DDT00:00:00.000+05:30
    // End of day IST: YYYY-MM-DDT23:59:59.999+05:30
    const timePart = isEndOfDay ? "23:59:59.999" : "00:00:00.000";
    return new Date(`${dateString}T${timePart}+05:30`);
}


function injectTransactionsCopyright() {
    const transactionsSection = document.getElementById('transactions');
    if (transactionsSection && !document.getElementById('transactions-copyright-footer')) {
        const footer = document.createElement('div');
        footer.id = 'transactions-copyright-footer';
        footer.className = "py-8 text-center border-t border-gray-100 mt-8";
        footer.innerHTML = `
            <div class="flex flex-col items-center gap-1.5">
                <p class="text-[10px] font-bold text-gray-400 tracking-[0.3em] uppercase">Mifela Inventory Management</p>
                <p class="text-[11px] text-gray-500 font-medium">© 2026 All Rights Reserved</p>
            </div>
        `;
        transactionsSection.appendChild(footer);
    }
}

function renderTransactionUIStructure() {
    const container = document.getElementById('transactions');
    if (!container || container.querySelector('.tx-modern-ui')) return;

    // --- Step 3: Admin Location Dropdown Generation (Platinum Check) ---
    const role = typeof getUserRole === 'function' ? getUserRole() : 'manager';
    const plan = typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free';  
    const canAccessAllLocations = (role === 'admin' || role === 'accountant') ;
    
    const availLocs = typeof getAvailableLocations === 'function' ? getAvailableLocations() : [];
    let currentLoc = typeof getCurrentLocationId === 'function' ? getCurrentLocationId() : 'main';

    let locationHtml = '';
    if (canAccessAllLocations) {
        let optionsHtml = `<option value="all">All Locations</option>`;
        if (availLocs && availLocs.length > 0) {
            optionsHtml += availLocs.map(loc => 
                `<option value="${loc.id}" ${loc.id === currentLoc ? 'selected' : ''}>${escapeHTML(loc.name || loc.id)}</option>`
            ).join('');
        } else {
            optionsHtml += `<option value="main">Main Store</option>`;
        }

        locationHtml = `
            <div>
                <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Location</label>
                <select id="tx-location-filter" class="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all">
                    ${optionsHtml}
                </select>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="tx-modern-ui space-y-6 ">
            <!-- Header & Tabs -->
            <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div class="px-6 py-5 border-b border-gray-100 flex flex-col md:flex-row justify-between items-center gap-4 bg-gray-50/50">
                    <div>
                        <h2 class="text-2xl font-extrabold text-gray-800 tracking-tight">Transactions</h2>
                        <p class="text-sm text-gray-500 mt-1">Monitor your sales, purchases, and adjustments.</p>
                    </div>
                    
                    <!-- Tabs -->
                    <div class="flex bg-gray-200/50 p-1 rounded-lg overflow-x-auto">
                        <button class="tx-tab px-4 py-2 text-sm font-semibold rounded-md transition-all duration-200 text-gray-600 hover:text-gray-900 whitespace-nowrap" data-tx-type="ALL" id="filter-all-btn">All</button>
                        <button class="tx-tab px-4 py-2 text-sm font-semibold rounded-md transition-all duration-200 text-gray-600 hover:text-gray-900 whitespace-nowrap" data-tx-type="SALE" id="filter-sales-btn">Sales</button>
                        <button class="tx-tab px-4 py-2 text-sm font-semibold rounded-md transition-all duration-200 text-gray-600 hover:text-gray-900 whitespace-nowrap" data-tx-type="PURCHASE" id="filter-purchases-btn">Purchases</button>
                        <button class="tx-tab px-4 py-2 text-sm font-semibold rounded-md transition-all duration-200 text-gray-600 hover:text-gray-900 whitespace-nowrap" data-tx-type="PRODUCTION" id="filter-prod-btn">Production</button> <button class="tx-tab px-4 py-2 text-sm font-semibold rounded-md transition-all duration-200 text-gray-600 hover:text-gray-900 whitespace-nowrap" data-tx-type="CHEQUE" id="filter-cheque-btn">Cheque</button>
                        <button class="tx-tab px-4 py-2 text-sm font-semibold rounded-md transition-all duration-200 text-gray-600 hover:text-gray-900 whitespace-nowrap" data-tx-type="ADJUSTMENT" id="filter-adjust-btn">Adjustments</button>
                        <button class="tx-tab px-4 py-2 text-sm font-semibold rounded-md transition-all duration-200 text-gray-600 hover:text-gray-900 whitespace-nowrap" data-tx-type="REFUND" id="filter-refund-btn">Refunds</button>
                    </div>

                    
                </div>

                <div class="p-4 flex flex-col md:flex-row gap-4 items-center justify-between bg-white border-t border-gray-100">
    <div class="relative w-full md:w-80 shrink-0">
        <input type="text" id="tx-search" placeholder="Search Invoice # or Party..." class="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all">
        <svg class="w-5 h-5 text-gray-400 absolute left-3 top-2.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
    </div>

    <div class="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
        <button id="open-tx-filters-btn" class="px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs uppercase tracking-wider rounded-lg border border-indigo-100 transition flex items-center gap-2 shadow-sm active:scale-95">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
            Filter Records
        </button>

        <button id="open-tx-export-btn" class="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-md shadow-emerald-200 transition flex items-center gap-2 active:scale-95">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
            Export Dialog
        </button>
    </div>
</div>
            </div>

            <!-- Table Card -->
            <div class="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="min-w-full divide-y divide-gray-100">
                        <thead class="bg-gray-50/80">
                            <tr>
                                <th class="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Date & Time</th>
                                <th class="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Invoice ID</th>
                                <th class="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Party / Reason</th>
                                <th class="px-6 py-4 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Items</th>
                                <th class="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Total</th>
                                <th class="px-6 py-4 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                                <th class="px-6 py-4 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Action</th>
                            </tr>
                        </thead>
                        <tbody id="transactions-table-body" class="bg-white divide-y divide-gray-50"></tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    
    DOM.transactions.table = document.getElementById('transactions-table-body');
}

function setupTransactionListeners() {
    const container = document.getElementById('transactions');
    if (!container) return;

    // 🚀 THE FIX: Debounced Live Search (Triggered as you type)
    let searchDebounceTimer;
    container.addEventListener('input', (e) => {
        if (e.target.id === 'tx-search') {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                firstVisibleTransaction = null;
                lastVisibleTransaction = null;
                loadTransactionsPage();
            }, 600); // 600ms wait after they stop typing
        }
    });

    container.addEventListener('keypress', (e) => {
        if (e.target.id === 'tx-search' && e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(searchDebounceTimer);
            firstVisibleTransaction = null;
            lastVisibleTransaction = null;
            loadTransactionsPage();
        }
    });

    container.addEventListener('click', (e) => {
        const target = e.target;
        if (target.closest('.view-btn')) {
            showTransactionDetails(target.closest('.view-btn').dataset.id);
            return;
        }
        if (target.closest('#prev-tx-page-btn')) loadPrevTransactionsPage();
        if (target.closest('#next-tx-page-btn')) loadNextTransactionsPage();
        
        // 🚀 NEW MODAL TRIGGERS
        if (target.closest('#open-tx-filters-btn')) promptFilterDialog();
        if (target.closest('#open-tx-export-btn')) promptExportDialogWithPreview();
    });
}
// ============================================================================
// 🚀 MULTI-FORMAT TRANSACTION EXPORT ENGINE
// ============================================================================

async function triggerMultiFormatExport() {
    const rangeSelect = document.getElementById('tx-export-range');
    const range = rangeSelect ? rangeSelect.value : 'all';
    
    const now = new Date();
    let startDate = null;

    if (range === 'today') startDate = new Date(now.setHours(0,0,0,0));
    else if (range === 'week') startDate = new Date(now.setDate(now.getDate() - 7));
    else if (range === 'month') startDate = new Date(now.setMonth(now.getMonth() - 1));
    else if (range === '3month') startDate = new Date(now.setMonth(now.getMonth() - 3));
    else if (range === '6month') startDate = new Date(now.setMonth(now.getMonth() - 6));

    if (typeof showModal === 'function') showModal('Exporting...', 'Fetching local records...', 'info');

    try {
        if (!window.dbAPI || !window.dbAPI.getTransactionsSince) throw new Error("Offline Database not ready.");
        
        let txs = await window.dbAPI.getTransactionsSince(startDate ? startDate.toISOString() : "2000-01-01T00:00:00Z");

        // Sort descending
        txs.sort((a, b) => new Date(b.timestamp || Date.now()).getTime() - new Date(a.timestamp || Date.now()).getTime());

        if (txs.length === 0) {
            if (typeof showModal === 'function') showModal('Empty', 'No transactions found in the selected range.', 'warning');
            return;
        }

        const exportData = txs.map(d => {
            const dateObj = new Date(d.timestamp || Date.now());
            return {
                timestamp: d.timestamp,
                Date: dateObj.toLocaleDateString(),
                Time: dateObj.toLocaleTimeString(),
                InvoiceID: d.invoiceId || d.id,
                Type: d.type || d.summary?.transactionType || 'SALE',
                Party: d.customer?.name || d.dealer?.name || 'Walk-in',
                Method: d.summary?.paymentMethod || 'System',
                ItemsCount: d.items ? d.items.length : 0,
                TotalAmount: d.summary?.total || 0
            };
        });

        document.getElementById('custom-modal')?.remove(); 
        promptFormatSelection(exportData, range);

    } catch (e) {
        console.error("Export failed:", e);
        if (typeof showModal === 'function') showModal('Error', 'Export failed: ' + e.message, 'error');
    }
}

function promptFormatSelection(data, rangeLabel) {
    const modalId = 'export-format-modal';
    document.getElementById(modalId)?.remove();

    const html = `
        <div id="${modalId}" class="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[200] p-4  ">
            <div class="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl text-center border">
                <h3 class="text-lg font-bold text-gray-800 mb-1">Select Export Format</h3>
                <p class="text-xs text-gray-500 mb-6">Ready to export ${data.length} records (${rangeLabel}).</p>
                
                <div class="space-y-3">
                    <button id="dl-csv" class="w-full py-3 bg-green-50 text-green-700 border border-green-200 font-bold rounded-xl hover:bg-green-100 flex items-center justify-center gap-2">
                        Download Excel / CSV
                    </button>
                    <button id="dl-pdf" class="w-full py-3 bg-red-50 text-red-700 border border-red-200 font-bold rounded-xl hover:bg-red-100 flex items-center justify-center gap-2">
                        Generate Printable PDF
                    </button>
                    <button id="dl-json" class="w-full py-3 bg-slate-50 text-slate-700 border border-slate-200 font-bold rounded-xl hover:bg-slate-100 flex items-center justify-center gap-2">
                        Download Raw JSON Data
                    </button>
                    <button id="dl-pdf-print" disabled class="p-3 bg-white border border-slate-200 hover:border-red-500 hover:bg-red-50 rounded-xl text-slate-700 font-bold text-xs flex flex-col items-center gap-1 transition shadow-sm disabled:opacity-50">
        Print PDF
    </button>
                </div>
                
                <button onclick="document.getElementById('${modalId}').remove()" class="mt-6 text-xs text-gray-400 font-bold uppercase tracking-wider">Cancel</button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);

    // CSV Handler
    document.getElementById('dl-csv').onclick = () => {
        const headers = Object.keys(data[0]).join(',');
        const rows = data.map(row => Object.values(row).map(val => `"${val}"`).join(',')).join('\n');
        const blob = new Blob([headers + '\n' + rows], { type: 'text/csv' });
        triggerBrowserDownload(blob, `Transactions_${rangeLabel}.csv`);
        document.getElementById(modalId).remove();
    };

    // JSON Handler
    document.getElementById('dl-json').onclick = () => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        triggerBrowserDownload(blob, `Transactions_${rangeLabel}.json`);
        document.getElementById(modalId).remove();
    };

    // Printable PDF Handler
    document.getElementById('dl-pdf').onclick = () => {
        const rowsHtml = data.map(r => `<tr><td>${r.Date}</td><td>${r.InvoiceID}</td><td>${r.Type}</td><td>${r.Party}</td><td>${r.Method}</td><td style="text-align:right;">${r.TotalAmount}</td></tr>`).join('');
        const printHtml = `
            <html><head><title>Transactions Report</title>
            <style>body{font-family:sans-serif;padding:20px;} table{width:100%;border-collapse:collapse;} th,td{border:1px solid #ddd;padding:8px;font-size:12px;text-align:left;} th{background:#f4f4f4;}</style>
            </head><body><h2>Transactions Export (${rangeLabel.toUpperCase()})</h2><table><thead><tr><th>Date</th><th>Invoice</th><th>Type</th><th>Party</th><th>Method</th><th style="text-align:right;">Total</th></tr></thead><tbody>${rowsHtml}</tbody></table>
            </body></html>
        `;

        let printFrame = document.getElementById('hidden-web-print-frame');
        if (!printFrame) {
            printFrame = document.createElement('iframe');
            printFrame.id = 'hidden-web-print-frame';
            printFrame.style.position = 'fixed';
            printFrame.style.width = '0px';
            printFrame.style.height = '0px';
            printFrame.style.border = 'none';
            document.body.appendChild(printFrame);
        }
        
        const frameDoc = printFrame.contentWindow.document;
        frameDoc.open();
        frameDoc.write(printHtml);
        frameDoc.close();
        
        setTimeout(() => {
            printFrame.contentWindow.focus();
            printFrame.contentWindow.print();
        }, 500);

        document.getElementById(modalId).remove();
    };
}

// 🚀 ELECTRON FIX: Triggers Native OS "Save As" Dialog + Memory Cleanup
async function triggerBrowserDownload(blob, filename) {
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.saveFile) {
        try {
            // Convert Blob to ArrayBuffer for IPC transfer to Electron Main Process
            const arrayBuffer = await blob.arrayBuffer();
            await window.electronAPI.saveFile(arrayBuffer, filename);
            if (typeof showToast === 'function') showToast("Saved", `File saved successfully.`, "success");
        } catch (e) {
            console.error("Electron save failed:", e);
            if (typeof showToast === 'function') showToast("Save Cancelled", "File export was cancelled.", "info");
        }
    } else {
        // Standard Web Browser Fallback
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        
        // CRITICAL: Prevent Memory Leaks in long-running POS sessions
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url); 
        }, 1000);
    }
}
function promptFilterDialog() {
    const modalId = 'tx-filter-dialog-modal';
    document.getElementById(modalId)?.remove();

    // Ensure hidden master state anchors exist in DOM
    let hiddenPay = document.getElementById('tx-payment-filter');
    let hiddenStart = document.getElementById('tx-start-date');
    let hiddenEnd = document.getElementById('tx-end-date');

    if (!hiddenPay) {
        const d = document.createElement('div');
        d.className = 'hidden';
        d.innerHTML = `<input type="hidden" id="tx-payment-filter" value="all"><input type="hidden" id="tx-start-date" value=""><input type="hidden" id="tx-end-date" value="">`;
        document.body.appendChild(d);
        hiddenPay = document.getElementById('tx-payment-filter');
        hiddenStart = document.getElementById('tx-start-date');
        hiddenEnd = document.getElementById('tx-end-date');
    }

    const html = `
        <div id="${modalId}" class="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[150] p-4  ">
            <div class="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border text-left">
                <div class="p-5 bg-slate-50 border-b flex justify-between items-center">
                    <h3 class="font-bold text-gray-800 text-base flex items-center gap-2">🎯 Filter Options</h3>
                    <button onclick="document.getElementById('${modalId}').remove()" class="text-gray-400 hover:text-gray-600 font-bold p-1">✕</button>
                </div>
                
                <div class="p-6 space-y-5">
                    <div>
                        <label class="block text-[11px] font-black tracking-widest text-gray-400 uppercase mb-1.5">Payment Method</label>
                        <select id="modal-pay-filter" class="w-full p-3 border rounded-xl bg-slate-50 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="all" ${hiddenPay.value === 'all' ? 'selected' : ''}>All Methods</option>
                            <option value="Cash" ${hiddenPay.value === 'Cash' ? 'selected' : ''}>Cash</option>
                            <option value="Card" ${hiddenPay.value === 'Card' ? 'selected' : ''}>Card</option>
                            <option value="UPI" ${hiddenPay.value === 'UPI' ? 'selected' : ''}>UPI</option>
                            <option value="Credit" ${hiddenPay.value === 'Credit' ? 'selected' : ''}>Credit (Udhar)</option> 
                            <option value="Split" ${hiddenPay.value === 'Split' ? 'selected' : ''}>Split</option>
                        </select>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-[11px] font-black tracking-widest text-gray-400 uppercase mb-1.5">From Date</label>
                            <input type="date" id="modal-start-date" value="${hiddenStart.value}" class="w-full p-2.5 border rounded-xl text-xs font-mono font-bold bg-slate-50 text-indigo-600">
                        </div>
                        <div>
                            <label class="block text-[11px] font-black tracking-widest text-gray-400 uppercase mb-1.5">To Date</label>
                            <input type="date" id="modal-end-date" value="${hiddenEnd.value}" class="w-full p-2.5 border rounded-xl text-xs font-mono font-bold bg-slate-50 text-indigo-600">
                        </div>
                    </div>
                </div>

                <div class="p-4 bg-slate-50 border-t flex gap-3 justify-end">
                    <button id="modal-reset-filters" class="px-4 py-2.5 text-xs font-bold text-red-600 hover:bg-red-50 rounded-xl transition">Clear All</button>
                    <button onclick="document.getElementById('${modalId}').remove()" class="px-6 py-2.5 text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition">Done</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);

    // 🚀 LIVE FILTER ENGINE: Fires instantly on input change
    const triggerLiveSearch = () => {
        hiddenPay.value = document.getElementById('modal-pay-filter').value;
        hiddenStart.value = document.getElementById('modal-start-date').value;
        hiddenEnd.value = document.getElementById('modal-end-date').value;

        firstVisibleTransaction = null;
        lastVisibleTransaction = null;
        loadTransactionsPage();
    };

    document.getElementById('modal-pay-filter').onchange = triggerLiveSearch;
    document.getElementById('modal-start-date').onchange = triggerLiveSearch;
    document.getElementById('modal-end-date').onchange = triggerLiveSearch;

    document.getElementById('modal-reset-filters').onclick = () => {
        hiddenPay.value = 'all';
        hiddenStart.value = '';
        hiddenEnd.value = '';
        document.getElementById(modalId).remove();
        clearTransactionFilters();
    };
}

export async function promptExportDialogWithPreview() {
    const modalId = 'tx-export-preview-modal';
    document.getElementById(modalId)?.remove();

    // Safety cleanup
    document.getElementById('generic-modal')?.remove();
    document.getElementById('custom-modal')?.remove();


    // 🚀 STEP 1: Read active filters from the UI
    const startDateVal = document.getElementById('tx-start-date')?.value;
    const endDateVal = document.getElementById('tx-end-date')?.value;
    const paymentMethod = document.getElementById('tx-payment-filter')?.value || 'all';
    
    let activeFilterText = "All Time";
    if (startDateVal || endDateVal) {
        activeFilterText = `${startDateVal ? new Date(startDateVal).toLocaleDateString() : 'Start'} to ${endDateVal ? new Date(endDateVal).toLocaleDateString() : 'Today'}`;
    }
    if (paymentMethod && paymentMethod !== 'all') {
        activeFilterText += ` • ${paymentMethod} Only`;
    }
    if (currentTypeFilter !== 'ALL') {
        activeFilterText += ` • ${currentTypeFilter}`;
    }

    // Default Configuration
    let cols = {
        date: { label: 'Date & Time', active: true },
        invoice: { label: 'Invoice #', active: true },
        type: { label: 'Txn Type', active: true },
        party: { label: 'Party/Customer', active: true },
        method: { label: 'Pay Method', active: true },
        items: { label: 'Items Qty', active: false },
        total: { label: 'Total Amount', active: true }
    };

    const html = `
        <div id="${modalId}" class="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[200] p-4  ">
            <div class="bg-white rounded-3xl max-w-4xl w-full shadow-2xl overflow-hidden border flex flex-col max-h-[90vh]">
                
                <div class="p-6 bg-slate-50 border-b flex justify-between items-center shrink-0">
                    <div>
                        <h3 class="font-black text-gray-800 text-lg">Export Customizer</h3>
                        <p class="text-xs font-bold text-indigo-600 tracking-wider uppercase mt-1" id="export-dataset-count">Dataset: Fetching records...</p>
                    </div>
                    <button onclick="document.getElementById('${modalId}').remove(); document.body.classList.remove('overflow-hidden');" class="text-gray-400 hover:text-red-500 transition font-bold p-2 bg-white rounded-full shadow-sm border border-gray-100">✕</button>
                </div>

                <div class="flex flex-col md:flex-row flex-1 overflow-hidden">
                    <div class="w-full md:w-72 border-r border-slate-100 bg-white p-6 shrink-0 overflow-y-auto flex flex-col">
                        
                        <div class="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-6 flex items-start gap-3 shadow-sm">
                            <div class="bg-indigo-100 text-indigo-600 p-2 rounded-lg shrink-0">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            </div>
                            <div>
                                <h4 class="text-xs font-black text-indigo-900 uppercase tracking-wide">Pro Tip</h4>
                                <p class="text-[11px] text-indigo-700 mt-1 leading-relaxed font-medium">This tool exports exactly what is on your screen. Need a specific month? Close this window and use the <b>Filter Records</b> button first!</p>
                            </div>
                        </div>

                        <span class="text-[10px] font-black tracking-widest uppercase text-slate-400 block mb-4">Include Columns</span>
                        <div class="space-y-3 flex-1" id="export-col-toggles">
                            ${Object.entries(cols).map(([key, config]) => `
                                <label class="flex items-center gap-3 cursor-pointer group">
                                    <input type="checkbox" data-col="${key}" ${config.active ? 'checked' : ''} class="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 transition">
                                    <span class="text-sm font-bold text-gray-700 group-hover:text-indigo-600 transition">${config.label}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>

                    <div class="flex-1 bg-slate-50/50 p-6 flex flex-col overflow-hidden">
                        
                        <div class="flex justify-between items-end mb-3">
                            <span class="text-[10px] font-black tracking-widest uppercase text-slate-400">Live Document Preview </span>
                            <span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded">Active Range: ${activeFilterText}</span>
                        </div>
                        
                        <div class="border border-slate-200 rounded-xl bg-white shadow-sm overflow-auto flex-1 mb-6">
                            <table class="w-full text-left whitespace-nowrap">
                                <thead id="preview-thead" class="bg-slate-50 border-b">
                                    <tr>
                                        ${Object.entries(cols).map(([k, c]) => c.active ? `<th class="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">${c.label}</th>` : '').join('')}
                                    </tr>
                                </thead>
                                <tbody id="preview-tbody" class="divide-y divide-gray-50">
                                    <tr>
                                        <td colspan="7" class="py-20 text-center">
                                            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>
                                            <p class="text-xs text-gray-500 font-bold uppercase tracking-widest">Loading entire dataset...</p>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0 mt-4">
                            <button id="dl-csv" disabled class="p-3 bg-white border border-slate-200 hover:border-green-500 hover:bg-green-50 rounded-xl text-slate-700 font-bold text-[11px] uppercase tracking-wider flex flex-col items-center justify-center gap-2 transition shadow-sm group active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                                <svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                Excel / CSV
                            </button>
                            <button id="dl-pdf" disabled class="p-3 bg-white border border-slate-200 hover:border-red-500 hover:bg-red-50 rounded-xl text-slate-700 font-bold text-[11px] uppercase tracking-wider flex flex-col items-center justify-center gap-2 transition shadow-sm group active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                                <svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                                Save PDF
                            </button>
                            <button id="dl-pdf-print" disabled class="p-3 bg-white border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 rounded-xl text-slate-700 font-bold text-[11px] uppercase tracking-wider flex flex-col items-center justify-center gap-2 transition shadow-sm group active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                                <svg class="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                                Direct Print
                            </button>
                            <button id="dl-json" disabled class="p-3 bg-white border border-slate-200 hover:border-blue-500 hover:bg-blue-50 rounded-xl text-slate-700 font-bold text-[11px] uppercase tracking-wider flex flex-col items-center justify-center gap-2 transition shadow-sm group active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                                <svg class="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
                                Raw JSON
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    document.body.classList.add('overflow-hidden');

    // 🚀 STEP 2: Async Fetch Data in Background
    try {
        const transactionsRef = getTransactionsRef();
        let constraints = [];

        // Apply Location Filters
        const locationSelect = document.getElementById('tx-location-filter');
        
        const canAccessAllLocations = (role === 'admin' || role === 'accountant') ;

        const assignedLoc = typeof getUserAssignedLocationId === 'function' ? getUserAssignedLocationId() : 'main';
        let filterLoc = canAccessAllLocations ? 'all' : assignedLoc;
        if (canAccessAllLocations && locationSelect) filterLoc = locationSelect.value;

        if (filterLoc !== 'all') constraints.push(where('locationId', '==', filterLoc));

        // Apply Type Filters
        if (currentTypeFilter !== 'ALL') {
            if (currentTypeFilter === 'CHEQUE') constraints.push(where("summary.paymentMethod", "==", "CHEQUE"));
            else if (currentTypeFilter === 'SALE') constraints.push(where("summary.transactionType", "==", "SALE"));
            else if (currentTypeFilter === 'ADJUSTMENT') constraints.push(where("type", "in", ["ADJUSTMENT", "LOSS"])); 
            else if (currentTypeFilter === 'LOSS') constraints.push(where("type", "==", "LOSS"));
            else constraints.push(where("type", "==", currentTypeFilter));
        }

        if (paymentMethod !== 'all') constraints.push(where("summary.paymentMethod", "==", paymentMethod));

        if (startDateVal) constraints.push(where("timestamp", ">=", getISTBoundary(startDateVal, false)));
        if (endDateVal) constraints.push(where("timestamp", "<=", getISTBoundary(endDateVal, true)));

        // Ensure proper sorting & Smart Export Search
        const searchInput = document.getElementById('tx-search');
        const rawSearch = searchInput ? searchInput.value.trim() : '';
        const searchTerm = rawSearch.toUpperCase();
        
        if (searchTerm) {
            constraints = []; // Reset constraints to isolate the search for export
            
            if (/^(INV|RET|PUR|REV|MAN|OB|MRG)-/.test(searchTerm)) {
                constraints.push(where('invoiceId', '==', searchTerm));
            } else if (/^(CUST|MERCH)-/.test(searchTerm)) {
                constraints.push(where('customer.id', '==', searchTerm));
            } else if (/^\d+$/.test(rawSearch)) {
                if (rawSearch.length >= 10) {
                    const phoneFormatted = rawSearch.length === 10 ? `+91${rawSearch}` : `+${rawSearch}`;
                    constraints.push(where('customer.phone', '==', phoneFormatted));
                } else {
                    constraints.push(where('invoiceId', '==', `INV-${searchTerm}`));
                }
            } else {
                constraints.push(where('customer.name', '==', rawSearch));
            }

            if (filterLoc !== 'all') constraints.push(where('locationId', '==', filterLoc));
        } else {
            constraints.push(orderBy("timestamp", "desc"));
        }

        // Pull the unpaginated dataset
        const q = query(transactionsRef, ...constraints);
        const snap = await getDocs(q);

        let data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        data.sort((a, b) => {
            const timeA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : (a.timestamp ? new Date(a.timestamp).getTime() : Date.now());
            const timeB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : (b.timestamp ? new Date(b.timestamp).getTime() : Date.now());
            return timeB - timeA;
        });

        const countLabel = document.getElementById('export-dataset-count');
        if (countLabel) countLabel.textContent = `Dataset: ${data.length} records found`;

        if (data.length === 0) {
            const tbody = document.getElementById('preview-tbody');
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-red-500 font-bold">No records found for current filters.</td></tr>`;
            return;
        }

        // 🚀 Unlock the UI now that data is ready
        document.getElementById('dl-csv').disabled = false;
        document.getElementById('dl-pdf').disabled = false;
        document.getElementById('dl-json').disabled = false;
        document.getElementById('dl-pdf-print').disabled = false;

        const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';

        const updatePreview = () => {
            const thead = document.getElementById('preview-thead');
            const tbody = document.getElementById('preview-tbody');
            if (!thead || !tbody) return;

            let headHtml = '<tr>';
            Object.entries(cols).forEach(([k, c]) => { if (c.active) headHtml += `<th class="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">${c.label}</th>`; });
            headHtml += '</tr>';
            thead.innerHTML = headHtml;

            let bodyHtml = '';
            data.forEach(d => {
                const dateObj = d.timestamp?.toDate ? d.timestamp.toDate() : new Date(d.timestamp || Date.now());
                bodyHtml += '<tr class="text-xs text-gray-600 hover:bg-slate-50">';
                
                if (cols.date.active) bodyHtml += `<td class="px-4 py-2.5">${dateObj.toLocaleDateString()} ${dateObj.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td>`;
                if (cols.invoice.active) bodyHtml += `<td class="px-4 py-2.5 font-mono text-indigo-600 font-bold">${d.invoiceId || '-'}</td>`;
                if (cols.type.active) bodyHtml += `<td class="px-4 py-2.5"><span class="px-2 py-0.5 bg-gray-100 rounded text-[10px] font-bold uppercase">${d.type || 'SALE'}</span></td>`;
                if (cols.party.active) bodyHtml += `<td class="px-4 py-2.5 font-bold text-gray-800">${escapeHTML(d.customer?.name || d.dealer?.name || 'Walk-in')}</td>`;
                if (cols.method.active) bodyHtml += `<td class="px-4 py-2.5 uppercase text-[10px] font-bold">${d.summary?.paymentMethod || '-'}</td>`;
                if (cols.items.active) bodyHtml += `<td class="px-4 py-2.5 text-center">${d.items ? d.items.length : 0}</td>`;
                if (cols.total.active) bodyHtml += `<td class="px-4 py-2.5 font-black text-gray-900">${currency}${Math.abs(d.summary?.total || 0).toFixed(2)}</td>`;
                
                bodyHtml += '</tr>';
            });
            tbody.innerHTML = bodyHtml;
        };

        // Attach listeners to column toggle checkboxes
        document.querySelectorAll('#export-col-toggles input').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                cols[e.target.dataset.col].active = e.target.checked;
                updatePreview();
            });
        });

        // Hydrate table with data
        updatePreview();

        // 🚀 STEP 3: CLOSURE HELPERS
        // Because these are defined INSIDE promptExportDialogWithPreview, 
        // they have absolute access to `data`, `cols`, and `activeFilterText`!
        
        const buildExportData = () => {
            return data.map(d => {
                const dateObj = d.timestamp?.toDate ? d.timestamp.toDate() : new Date(d.timestamp || Date.now());
                let row = {};
                if (cols.date.active) row[cols.date.label] = `${dateObj.toLocaleDateString()} ${dateObj.toLocaleTimeString()}`;
                if (cols.invoice.active) row[cols.invoice.label] = d.invoiceId || '';
                if (cols.type.active) row[cols.type.label] = d.type || 'SALE';
                if (cols.party.active) row[cols.party.label] = d.customer?.name || d.dealer?.name || 'Walk-in';
                if (cols.method.active) row[cols.method.label] = d.summary?.paymentMethod || '';
                if (cols.items.active) row[cols.items.label] = d.items ? d.items.length : 0;
                if (cols.total.active) row[cols.total.label] = Math.abs(d.summary?.total || 0).toFixed(2);
                return row;
            });
        };

        // Fetch Store Info (Runs once for both PDF and Print)
        let storeName = "My Store";
        let storeDetails = "";
        try {
            const sId = typeof getStoreId === 'function' ? getStoreId() : null;
            const aId = typeof appId !== 'undefined' ? appId : null;
            if (sId && aId) {
                const profileDoc = await getDoc(doc(db, `artifacts/${aId}/stores/${sId}/settings/profile`));
                if (profileDoc.exists()) {
                    const pData = profileDoc.data();
                    storeName = pData.storeName || storeName;
                    storeDetails = `${pData.address || ''}\nGSTIN: ${pData.taxId || pData.gstin || ''}`;
                }
            }
        } catch (e) {
            console.warn("Store details fetch failed:", e);
        }

        // --- MATCHING HTML PRINTER ENGINE ---
        const buildPrintHtmlStr = (mappedData) => {
            const headHtml = Object.keys(mappedData[0]).map(h => `<th>${escapeHTML(h)}</th>`).join('');
            const rowsHtml = mappedData.map((r, i) => `<tr class="${i % 2 === 0 ? 'bg-slate-50' : 'bg-white'}">${Object.values(r).map(v => `<td>${escapeHTML(String(v))}</td>`).join('')}</tr>`).join('');
            
            return `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Transactions Report</title>
                    <style>
                        @page { margin: 15mm; size: A4 portrait; }
                        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 20px; color: #1e293b; background: white; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                        h2 { margin: 0 0 5px 0; font-size: 22px; text-transform: uppercase; font-weight: 900; }
                        .store-info { font-size: 11px; color: #0f172a; margin-bottom: 20px; white-space: pre-wrap; font-weight: bold; }
                        .meta { font-size: 9px; color: #64748b; margin-bottom: 15px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                        th, td { border: 1px solid #cbd5e1; padding: 8px; font-size: 10px; text-align: left; }
                        th { background-color: #4f46e5 !important; color: white !important; text-transform: uppercase; font-size: 9px; font-weight: bold; }
                        .bg-slate-50 { background-color: #f8fafc !important; }
                        .bg-white { background-color: #ffffff !important; }
                        .footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; font-size: 9px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 10px; }
                    </style>
                </head>
                <body>
                    <h2>Transactions Report</h2>
                    <div class="store-info">${escapeHTML(storeName)}<br><span style="font-weight: normal; font-size: 10px;">${escapeHTML(storeDetails)}</span></div>
                    <div class="meta">
                        <b>Filters Applied:</b> ${escapeHTML(activeFilterText)} <br> 
                        <b>Generated on:</b> ${new Date().toLocaleString()}
                    </div>
                    <table>
                        <thead><tr>${headHtml}</tr></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                    <div class="footer">Mifela POS | Powered by Mifela Inventory Management</div>
                </body>
                </html>
            `;
        };

        // --- PDF GENERATOR ENGINE ---
        const generatePdfDocObj = async (mappedData) => {
            
            const pdfDoc = new jsPDF('p', 'mm', 'a4');
            
            // Draw Headers
            pdfDoc.setFontSize(18);
            pdfDoc.text("Transactions Report", 14, 20);
            
            pdfDoc.setFontSize(11);
            pdfDoc.setFont("helvetica", "bold");
            pdfDoc.text(storeName, 14, 28);
            
            pdfDoc.setFontSize(9);
            pdfDoc.setFont("helvetica", "normal");
            const detailsLines = pdfDoc.splitTextToSize(storeDetails, 100);
            pdfDoc.text(detailsLines, 14, 33);
            
            const metaY = 33 + (detailsLines.length * 4) + 5;
            pdfDoc.setTextColor(100);
            pdfDoc.text(`Filters: ${activeFilterText}`, 14, metaY);
            pdfDoc.text(`Generated: ${new Date().toLocaleString()}`, 14, metaY + 5);
            
            // Draw Table
            autoTable(pdfDoc, {
                head: [Object.keys(mappedData[0])],
                body: mappedData.map(r => Object.values(r)),
                startY: metaY + 10,
                theme: 'striped',
                headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
                styles: { fontSize: 8, cellPadding: 3 },
                alternateRowStyles: { fillColor: [248, 250, 252] }
            });

            // Draw Watermarks
            const pageCount = pdfDoc.internal.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                pdfDoc.setPage(i);
                
                // Embedded watermark logic to prevent scope issues
                const pw = pdfDoc.internal.pageSize.getWidth();
                const ph = pdfDoc.internal.pageSize.getHeight();
                pdfDoc.setFontSize(8);
                pdfDoc.setTextColor(150);
                pdfDoc.setDrawColor(200);
                pdfDoc.line(14, ph - 15, pw - 14, ph - 15);
                pdfDoc.text("Mifela POS | Powered by Mifela Inventory Management", pw / 2, ph - 10, { align: 'center' });
            }
            
            return pdfDoc;
        };

        // 🚀 STEP 4: Button Handlers
        document.getElementById('dl-csv').onclick = () => {
            const mappedData = buildExportData();
            const headers = Object.keys(mappedData[0]).join(',');
            const rows = mappedData.map(r => Object.values(r).map(val => `"${val}"`).join(',')).join('\n');
            const blob = new Blob([headers + '\n' + rows], { type: 'text/csv' });
            
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `Mifela_Transactions_${Date.now()}.csv`;
            link.click();
        };

        document.getElementById('dl-json').onclick = () => {
            const mappedData = buildExportData();
            const blob = new Blob([JSON.stringify(mappedData, null, 2)], { type: 'application/json' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `Mifela_Transactions_${Date.now()}.json`;
            link.click();
        };

        document.getElementById('dl-pdf').onclick = async () => {
            const btn = document.getElementById('dl-pdf');
            const originalHtml = btn.innerHTML;
            btn.innerHTML = `<div class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-red-600 mb-1"></div> Loading...`;
            btn.disabled = true;
            
            try {
                const mappedData = buildExportData();
                const pdfInstance = await generatePdfDocObj(mappedData); 
                pdfInstance.save(`Mifela_Transactions_${Date.now()}.pdf`);
            } catch (e) {
                console.error("PDF generation failed:", e);
                if (typeof showModal === 'function') showModal('Error', 'Could not generate PDF.', 'error');
            } finally {
                btn.innerHTML = originalHtml;
                btn.disabled = false;
            }
        };

        document.getElementById('dl-pdf-print').onclick = async () => {
            const btn = document.getElementById('dl-pdf-print');
            const originalHtml = btn.innerHTML;
            btn.innerHTML = `<div class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600 mb-1"></div> Printing...`;
            btn.disabled = true;
            
            try {
                const mappedData = buildExportData();
                const printHtml = buildPrintHtmlStr(mappedData); 

                // 1. Fetch user's print settings
                let printConfig = { silent: true, invoicePrinter: '' };
                try { 
                    const saved = localStorage.getItem('mifela_printer_settings');
                    if (saved) printConfig = { ...printConfig, ...JSON.parse(saved) }; 
                } catch(e) {}

                const isElectron = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.printSilent;

                // 2. Decide how to print based on environment and user preference
                if (isElectron && printConfig.silent) {
    // 🚀 THE FIX: Wrap parameters in the expected object schema
    window.electronAPI.printSilent({
        content: printHtml,
        silent: true,
        pageSize: 'A4', // Hardcoded to A4 for the Export Report
        printerName: printConfig.invoicePrinter || ''
    });
    if (typeof showToast === 'function') showToast("Printing", "Sent to background printer.", "success");
} else {
                    // Web App OR Electron with Silent Printing Turned OFF (Forces OS Modal)
                    let printFrame = document.getElementById('hidden-web-print-frame');
                    if (!printFrame) {
                        printFrame = document.createElement('iframe');
                        printFrame.id = 'hidden-web-print-frame';
                        printFrame.style.position = 'fixed';
                        printFrame.style.width = '0px';
                        printFrame.style.height = '0px';
                        printFrame.style.border = 'none';
                        document.body.appendChild(printFrame);
                    }
                    
                    const frameDoc = printFrame.contentWindow.document;
                    frameDoc.open();
                    frameDoc.write(printHtml);
                    frameDoc.close();
                    
                    setTimeout(() => {
                        printFrame.contentWindow.focus();
                        printFrame.contentWindow.print();
                    }, 500);
                }
            } catch (e) {
                console.error("Print failed:", e);
                if (typeof showModal === 'function') showModal('Error', e.message, 'error');
            } finally {
                btn.innerHTML = originalHtml;
                btn.disabled = false;
            }
        };

    } catch (e) {
        document.getElementById('custom-modal')?.remove();
        console.error("Export failed:", e);
        const tbody = document.getElementById('preview-tbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-red-500 font-bold p-4 text-center">Failed to fetch data: ${e.message}</td></tr>`;
    }
}

/**
 * Renders a clean branding footer at the bottom of each page
 */
function addMifelaWatermark(doc) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    doc.setFontSize(8);
    doc.setTextColor(150); // Muted grey
    
    // Add horizontal line
    doc.setDrawColor(200);
    doc.line(14, pageHeight - 15, pageWidth - 14, pageHeight - 15);
    
    // Footer text
    doc.text("Mifela Inventory Management | Powered by Mifela POS", pageWidth / 2, pageHeight - 10, {
        align: 'center'
    });
}

function setupTypeFilterButtons() {
    const tabs = document.querySelectorAll('.tx-tab');
    if (tabs.length === 0) return;

    tabs.forEach(tab => {
        const newTab = tab.cloneNode(true);
        tab.parentNode.replaceChild(newTab, tab);
        
        newTab.addEventListener('click', (e) => {
            const btn = e.target.closest('.tx-tab');
            
            document.querySelectorAll('.tx-tab').forEach(t => {
                t.classList.remove('active', 'bg-white', 'shadow-md', 'text-indigo-600', 'ring-1', 'ring-indigo-100');
                t.classList.add('text-gray-500', 'hover:bg-gray-200/50', 'hover:text-gray-700');
            });
            
            btn.classList.remove('text-gray-500', 'hover:bg-gray-200/50', 'hover:text-gray-700');
            btn.classList.add('active', 'bg-white', 'shadow-md', 'text-indigo-600', 'ring-1', 'ring-indigo-100');

            const type = btn.getAttribute('data-tx-type');
            if (type) currentTypeFilter = type;
            else currentTypeFilter = 'ALL';

            firstVisibleTransaction = null;
            lastVisibleTransaction = null;
            loadTransactionsPage();
        });
    });
    
    // Set initial active state
    const initialBtn = document.querySelector(`.tx-tab[data-tx-type="${currentTypeFilter}"]`);
    if(initialBtn) {
        initialBtn.classList.remove('text-gray-500', 'hover:bg-gray-200/50', 'hover:text-gray-700');
        initialBtn.classList.add('active', 'bg-white', 'shadow-md', 'text-indigo-600', 'ring-1', 'ring-indigo-100');
    }
}

// Pagination Logic
async function loadNextTransactionsPage() {
    if (!lastVisibleTransaction) return; 
    executePaginationQuery('next');
}

async function loadPrevTransactionsPage() {
    if (!firstVisibleTransaction) return;
    executePaginationQuery('prev');
}



function updateLocalCache(querySnapshot) {
    // 1. Extract the raw data first
    let docs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 🚀 THE .EXE SAVIOR: Absolute Javascript Fallback Sorting
    // This forces newly created (pending/null timestamp) transactions to the very top!
    docs.sort((a, b) => {
        const timeA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : 
                     (a.timestamp ? new Date(a.timestamp).getTime() : Date.now());
                     
        const timeB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : 
                     (b.timestamp ? new Date(b.timestamp).getTime() : Date.now());
        
        return timeB - timeA; // Sorts Descending (Newest at the top)
    });

    // 2. Safely update the cache with the perfectly sorted array
    localTransactionsCache = docs;

    // 3. Keep the original snapshot bounds for pagination controls
    if (!querySnapshot.empty) {
        firstVisibleTransaction = querySnapshot.docs[0];
        lastVisibleTransaction = querySnapshot.docs[querySnapshot.docs.length - 1];
    } else {
        firstVisibleTransaction = null;
        lastVisibleTransaction = null;
    }
}

export function handleTransactionFilterChange() {
    firstVisibleTransaction = null;
    lastVisibleTransaction = null;
    loadTransactionsPage();
}

export function clearTransactionFilters() {
    const searchInp = document.getElementById('tx-search');
    const paySelect = document.getElementById('tx-payment-filter');
    const startInp = document.getElementById('tx-start-date');
    const endInp = document.getElementById('tx-end-date');
    const locSelect = document.getElementById('tx-location-filter');

    if (searchInp) searchInp.value = '';
    if (paySelect) paySelect.value = 'all';
    if (startInp) startInp.value = '';
    if (endInp) endInp.value = '';
    // Reset location if admin
    if (locSelect) locSelect.value = 'all'; 
    
    currentTypeFilter = 'ALL';
    const tabs = document.querySelectorAll('.tx-tab');
    if (tabs.length > 0) {
        tabs.forEach(t => {
            t.classList.remove('active', 'bg-white', 'shadow-md', 'text-indigo-600', 'ring-1', 'ring-indigo-100');
            t.classList.add('text-gray-500');
        });
        const allBtn = document.getElementById('filter-all-btn');
        if(allBtn) {
            allBtn.classList.add('active', 'bg-white', 'shadow-md', 'text-indigo-600', 'ring-1', 'ring-indigo-100');
            allBtn.classList.remove('text-gray-500');
        }
    }

    firstVisibleTransaction = null;
    lastVisibleTransaction = null;
    loadTransactionsPage();
}

export function renderTransactionsTable() {
    const tbody = document.getElementById('transactions-table-body');
    if (!tbody) return;

    const isRegistryView = currentTypeFilter === 'CHEQUE';
    const filteredTx = localTransactionsCache; 

    const thead = document.querySelector('#transactions-table-body').previousElementSibling;
    if (isRegistryView) {
        thead.innerHTML = `
            <tr>
                <th class="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Entry Date</th>
                <th class="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Cheque No & Bank</th>
                <th class="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Party</th>
                <th class="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Amount</th>
                <th class="px-6 py-4 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Clearance Date</th>
                <th class="px-6 py-4 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                <th class="px-6 py-4 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Action</th>
            </tr>
        `;
    } else {
        thead.innerHTML = `
            <tr>
                <th class="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Date & Time</th>
                <th class="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Invoice ID</th>
                <th class="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Party / Reason</th>
                <th class="px-6 py-4 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Items</th>
                <th class="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Total</th>
                <th class="px-6 py-4 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Type</th>
                <th class="px-6 py-4 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Action</th>
            </tr>
        `;
    }

    tbody.innerHTML = '';
    
    if (filteredTx.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="py-16 text-center">
                    <div class="flex flex-col items-center justify-center text-gray-400">
                        <div class="bg-gray-50 p-4 rounded-full mb-3 shadow-sm border border-gray-100">
                            <svg class="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                        </div>
                        <p class="text-sm font-medium">No transactions found.</p>
                    </div>
                </td>
            </tr>`;
    } else {
        const fragment = document.createDocumentFragment();
        filteredTx.forEach(tx => {
            const row = document.createElement('tr');
            row.className = 'group hover:bg-indigo-50/50 transition-colors duration-150 border-b border-gray-100 last:border-0 cursor-pointer';
            
            if (isRegistryView) {
                const chq = tx.summary?.chequeDetails || {};
                const status = chq.status || 'PENDING';
                const rawDate = tx.localTimestamp || tx.timestamp;
                const dateObj = rawDate?.toDate ? rawDate.toDate() : new Date(rawDate);
                const dateStr = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                
                let statusBadge = '<span class="px-2.5 py-1 bg-yellow-100 text-yellow-700 text-[10px] font-bold uppercase rounded-full">Pending</span>';
                if (status === 'CLEARED') statusBadge = '<span class="px-2.5 py-1 bg-green-100 text-green-700 text-[10px] font-bold uppercase rounded-full">Cleared</span>';
                if (status === 'BOUNCED') statusBadge = '<span class="px-2.5 py-1 bg-red-100 text-red-700 text-[10px] font-bold uppercase rounded-full">Bounced</span>';

                row.innerHTML = `
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700 font-medium">${dateStr}</td>
                    <td class="px-6 py-4 whitespace-nowrap">
                        <p class="text-sm font-mono font-bold text-gray-800">${chq.chequeNo || 'N/A'}</p>
                        <p class="text-[10px] uppercase text-gray-500 tracking-wider">${chq.bank || 'Unknown Bank'}</p>
                    </td>
                    <td class="px-6 py-4 text-sm font-medium text-gray-800">${tx.customer?.name || tx.dealer?.name || 'Unknown'}</td>
                    <td class="px-6 py-4 text-right font-black text-indigo-700">${getCurrencySymbol()}${Math.abs(tx.summary?.total || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 text-center font-mono text-xs text-gray-600">${chq.clearanceDate || 'N/A'}</td>
                    <td class="px-6 py-4 text-center">${statusBadge}</td>
                    <td class="px-6 py-4 text-center space-x-1">
                        ${status === 'PENDING' ? `
                            <button onclick="window.updateChequeStatus('${tx.id}', 'CLEARED')" class="px-3 py-1.5 bg-green-100 text-green-700 hover:bg-green-200 font-bold rounded-lg text-[10px] uppercase tracking-wider transition-colors shadow-sm">Clear</button>
                            <button onclick="window.updateChequeStatus('${tx.id}', 'BOUNCED')" class="px-3 py-1.5 bg-red-100 text-red-700 hover:bg-red-200 font-bold rounded-lg text-[10px] uppercase tracking-wider transition-colors shadow-sm">Bounce</button>
                        ` : `<button class="view-btn text-indigo-600 font-bold text-[10px] uppercase tracking-wider bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition shadow-sm" data-id="${tx.id}">View Details</button>`}
                    </td>
                `;
                fragment.appendChild(row);
                return;
            }

            const rawDate = tx.localTimestamp || tx.timestamp;
            const dateObj = rawDate?.toDate ? rawDate.toDate() : new Date(rawDate);
            const dateStr = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const totalItems = tx.items ? tx.items.reduce((acc, item) => acc + Math.abs(item.quantity), 0) : 0;
            const currency = tx.currency?.symbol || getCurrencySymbol();
            
            // 🚀 THE FIX: Always define displayAmt based on the Total Invoice Value, not the Revenue captured
            const totalAmt = tx.summary?.total || 0;
            const revenueAmt = tx.summary?.revenue !== undefined ? tx.summary.revenue : totalAmt;
            const stagedDuesAmt = tx.summary?.stagedDuesPayment || 0; 
            
            let displayAmt = totalAmt;
            let duesHtml = '';
            
            let typeStyles = '';
            let typeLabel = '';
            let amountClass = 'text-gray-900 font-semibold';
            let amountPrefix = '';
            
            const type = (tx.type || tx.summary?.transactionType || 'SALE').toUpperCase();
            
            switch (type) {
                case 'SALE':
                    // If cart was 0 and they only paid dues
                    if (tx.summary?.cartTotal === 0 && stagedDuesAmt > 0) {
                        displayAmt = stagedDuesAmt;
                        typeLabel = 'Dues Paid';
                        typeStyles = 'bg-teal-100 text-teal-700 border-teal-200';
                    } else {
                        displayAmt = totalAmt;
                        typeLabel = 'Sale';
                        typeStyles = 'bg-green-100 text-green-700 border-green-200';
                        
                        // Tag if past dues were included in this bill
                        if (stagedDuesAmt > 0) {
                            duesHtml += `<div class="text-[10px] text-teal-600 font-bold mt-0.5 tracking-tight">+${currency}${stagedDuesAmt.toFixed(2)} Dues</div>`;
                        }
                        
                        // 🚀 NEW: Clearly flag Unpaid (Credit) portion directly under the total!
                        if (revenueAmt < totalAmt) {
                            const unpaid = totalAmt - revenueAmt;
                            duesHtml += `<div class="text-[10px] text-red-500 font-bold mt-0.5 tracking-tight">Credit: ${currency}${unpaid.toFixed(2)}</div>`;
                        }
                    }
                    amountClass = 'text-green-600 font-bold';
                    amountPrefix = '+';
                    break;
                case 'REFUND': 
                    typeStyles = 'bg-orange-100 text-orange-700 border-orange-200';
                    typeLabel = 'Return';
                    amountClass = 'text-orange-600 font-bold';
                    break;
                case 'PURCHASE': 
                    typeStyles = 'bg-blue-50 text-blue-700 border-blue-200';
                    typeLabel = 'Purchase';
                    amountClass = 'text-gray-700 font-bold'; 
                    break;
                case 'LOSS': 
                    typeStyles = 'bg-red-50 text-red-700 border-red-200';
                    typeLabel = 'Loss';
                    amountClass = 'text-red-600 font-bold';
                    break;
                case 'ADJUSTMENT': 
                    typeStyles = 'bg-gray-100 text-gray-600 border-gray-200';
                    typeLabel = 'Adj';
                    amountClass = 'text-gray-400 italic';
                    break;
                default:
                    typeStyles = 'bg-gray-100 text-gray-700';
                    typeLabel = type;
            }

            if (tx.summary?.paymentMethod === 'ADJUSTMENT' && type === 'ADJUSTMENT') {
                typeLabel = 'Correction';
            }
            
            let chequeBadgeHtml = '';
            if (tx.summary?.paymentMethod === 'CHEQUE') {
                const chq = tx.summary.chequeDetails || {};
                const chqStat = chq.status || 'PENDING';
                let badgeColor = 'bg-yellow-100 text-yellow-700 border-yellow-200';
                if (chqStat === 'CLEARED') badgeColor = 'bg-green-100 text-green-700 border-green-200';
                if (chqStat === 'BOUNCED') badgeColor = 'bg-red-100 text-red-700 border-red-200';
                
                chequeBadgeHtml = `
                    <div class="mt-1.5 flex flex-col items-end gap-1">
                        <span class="text-[9px] ${badgeColor} px-1.5 py-0.5 rounded font-black uppercase tracking-wider border shadow-sm">CHQ: ${chqStat}</span>
                        <span class="text-[10px] text-gray-500 font-mono tracking-tight">${chq.bank || 'Bank'} | ${chq.chequeNo || '#'}</span>
                    </div>
                `;
            }
            
            let displayParty = tx.dealer?.name || tx.customer?.name;
            let partySubtext = tx.dealer ? 'Dealer' : 'Customer';
            if (!displayParty) {
                 if (tx.summary?.reason) { displayParty = tx.summary.reason; partySubtext = 'Reason'; }
                 else { displayParty = 'Walk-in Customer'; }
            }

            row.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="flex flex-col">
                        <span class="text-sm font-semibold text-gray-700">${dateStr}</span>
                        <span class="text-[10px] text-gray-400 font-medium">${timeStr}</span>
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-xs font-mono text-gray-400 group-hover:text-indigo-600 transition-colors">
                    ${tx.invoiceId || 'N/A'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                     <div class="flex flex-col">
                        <span class="text-sm text-gray-800 font-medium truncate max-w-[160px]">${displayParty}</span>
                        <span class="text-[10px] text-gray-400 uppercase tracking-wider">${partySubtext}</span>
                    </div>
                </td>
                <td class="px-6 py-4 text-sm text-gray-500 text-center font-mono bg-gray-50/30">
                    ${Math.abs(totalItems)}
                </td>
                <td class="px-6 py-4 text-right">
                    <div class="flex flex-col items-end">
                        <span class="text-sm ${amountClass} tracking-tight">
                            ${amountPrefix}${currency}${Math.abs(displayAmt).toFixed(2)}
                        </span>
                        ${duesHtml}
                        ${chequeBadgeHtml}
                    </div>
                </td>
                <td class="px-6 py-4 text-center">
                    <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${typeStyles} shadow-sm">
                        ${typeLabel}
                    </span>
                </td>
                <td class="px-6 py-4 text-center">
                    <button data-id="${tx.id}" class="view-btn p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all" title="View Details">
                        <svg class="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                    </button>
                </td>
            `;
            fragment.appendChild(row);
        });
        tbody.appendChild(fragment);
    } 
    
    const isSearching = document.getElementById('tx-search')?.value.trim().length > 0;
    const paginationRow = document.createElement('tr');
    paginationRow.innerHTML = `
        <td colspan="7" class="py-4 px-6 bg-white border-t border-gray-100">
            <div class="flex justify-between items-center w-full">
                <span class="text-xs font-medium text-gray-500">
                    Viewing ${filteredTx.length} records
                </span>
                <div class="flex space-x-2">
                    <button id="prev-tx-page-btn" class="px-4 py-2 text-xs font-bold border border-gray-200 bg-white text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition" ${!firstVisibleTransaction || isSearching ? 'disabled' : ''}>
                        &larr; Previous
                    </button>
                    <button id="next-tx-page-btn" class="px-4 py-2 text-xs font-bold border border-gray-200 bg-white text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition" ${!lastVisibleTransaction || isSearching ? 'disabled' : ''}>
                        Next &rarr;
                    </button>
                </div>
            </div>
        </td>
    `;
    tbody.appendChild(paginationRow);
}
    


async function processRefund(txId) {
    const tx = localTransactionsCache.find(t => t.id === txId);
    if (!tx) return;

    const modalId = 'partial-refund-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const currency = tx.currency?.symbol || getCurrencySymbol();
    let itemsHtml = '';
    
    // Build the interactive item list
    tx.items.forEach((item, idx) => {
        const maxQty = Math.abs(item.quantity || 0);
        const unitPrice = parseFloat(item.price || item.cost || 0);
        
        itemsHtml += `
            <div class="flex justify-between items-center py-4 border-b border-gray-100 last:border-0 gap-4 hover:bg-slate-50/50 transition-colors px-4 rounded-xl">
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-bold text-slate-800 truncate" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</p>
                    <p class="text-xs text-slate-500 mt-1">Purchased: <strong class="text-slate-700">${maxQty}</strong> &times; ${currency}${unitPrice.toFixed(2)}</p>
                </div>
                <div class="flex items-center gap-3 shrink-0 bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
                    <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Return</label>
                    <input type="number" min="0" max="${maxQty}" value="0" 
                           data-idx="${idx}" data-price="${unitPrice}" data-max="${maxQty}"
                           class="refund-qty-input w-20 p-2 text-center border border-slate-200 rounded-lg focus:border-red-500 focus:ring-2 focus:ring-red-500/20 font-black text-red-600 bg-slate-50 hover:bg-white transition-all outline-none">
                </div>
            </div>
        `;
    });

    const html = `
        <div id="${modalId}" class="fixed inset-0 bg-slate-900/60   flex items-center justify-center z-[100] p-4">
            <div class="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden  border border-white/20">
                
                <div class="px-8 py-6 border-b border-slate-100 bg-white flex justify-between items-center shrink-0">
                    <div>
                        <h3 class="text-2xl font-black text-slate-900 flex items-center gap-3">
                            <span class="bg-red-100 text-red-600 p-2 rounded-xl shadow-sm">↩️</span> Process Return
                        </h3>
                        <p class="text-xs text-slate-400 mt-1.5 font-bold tracking-widest uppercase">Invoice #${escapeHTML(tx.invoiceId)}</p>
                    </div>
                    <button id="close-refund-modal" class="text-slate-400 hover:text-red-500 bg-slate-50 rounded-full p-2.5 hover:bg-red-50 transition border border-slate-100">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                
                <div class="p-8 max-h-[55vh] overflow-y-auto custom-scrollbar bg-slate-50/50">
                    <div class="bg-amber-50 border border-amber-200 p-5 rounded-2xl mb-6 text-sm text-amber-800 font-medium leading-relaxed shadow-sm flex items-start gap-3">
                        <span class="text-xl">💡</span>
                        <div>
                            <strong class="text-amber-900 block mb-0.5">How many items are coming back?</strong>
                            Enter the exact quantity being returned for each item. Leave at 0 if the item is not being returned.
                        </div>
                    </div>
                    <div class="bg-white border border-slate-200 rounded-2xl p-2 shadow-sm">
                        ${itemsHtml}
                    </div>
                </div>

                <div class="px-8 py-6 bg-white border-t border-slate-100 shrink-0">
                    <div class="flex justify-between items-center mb-6 p-4 bg-red-50 rounded-2xl border border-red-100">
                        <span class="text-sm font-bold text-red-800 uppercase tracking-widest">Total Refund Value</span>
                        <span id="refund-total-display" class="text-3xl font-black text-red-600 tracking-tight">${currency}0.00</span>
                    </div>
                    <div class="flex gap-4">
                        <button id="cancel-refund-btn" class="flex-1 py-4 bg-white border-2 border-slate-200 text-slate-600 font-bold rounded-2xl hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm">Cancel</button>
                        <button id="confirm-refund-btn" class="flex-1 py-4 bg-red-600 text-white font-bold rounded-2xl hover:bg-red-700 shadow-lg shadow-red-200 disabled:opacity-50 disabled:shadow-none transition transform active:scale-[0.98] flex justify-center items-center gap-2" disabled>
                            Confirm Refund
                        </button>
                    </div>
                </div>

            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    
    const modal = document.getElementById(modalId);
    const closeBtn = document.getElementById('close-refund-modal');
    const cancelBtn = document.getElementById('cancel-refund-btn');
    const confirmBtn = document.getElementById('confirm-refund-btn');
    const totalDisplay = document.getElementById('refund-total-display');
    const qtyInputs = document.querySelectorAll('.refund-qty-input');

    const cleanup = (e) => {
        // 🚀 THE FIX: Stop the click from bubbling up and triggering other listeners!
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        modal.classList.add('opacity-0');
        modal.querySelector('div').classList.add('scale-95');
        
        setTimeout(() => {
            modal.remove();
        }, 250); // Keep this timeout short and sweet
    };

    // Update your button bindings to pass the event 'e'
    closeBtn.onclick = (e) => cleanup(e);
    cancelBtn.onclick = (e) => cleanup(e);

    let refundTotal = 0;
    let returnItems = [];

    // Live Math Engine for the Modal
    const calculateTotal = () => {
        refundTotal = 0;
        returnItems = [];
        
        qtyInputs.forEach(input => {
            let qty = parseInt(input.value) || 0;
            const max = parseInt(input.dataset.max);
            const price = parseFloat(input.dataset.price);
            const idx = parseInt(input.dataset.idx);

            // Prevent returning more than sold or negative numbers
            if (qty > max) { qty = max; input.value = max; }
            if (qty < 0) { qty = 0; input.value = 0; }

            if (qty > 0) {
                const lineTotal = qty * price;
                refundTotal += lineTotal;
                
                const originalItem = tx.items[idx];
                returnItems.push({
                    ...originalItem,
                    quantity: qty, 
                    subtotal: lineTotal
                });
            }
        });

        totalDisplay.textContent = `${currency}${refundTotal.toFixed(2)}`;
        confirmBtn.disabled = refundTotal <= 0;
    };

    qtyInputs.forEach(input => {
        input.addEventListener('input', calculateTotal);
        input.addEventListener('change', calculateTotal);
    });

    confirmBtn.onclick = () => {
        if (refundTotal <= 0) return;
        confirmBtn.innerHTML = '<span class="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full inline-block"></span> Processing...';
        confirmBtn.disabled = true;
        executePartialRefund(tx, returnItems, refundTotal);
    };
}

async function executePartialRefund(tx, returnItems, refundTotal) {
    try {
        const batch = writeBatch(db);
        const productsRef = getProductsRef();
        const transactionsRef = getTransactionsRef();
        const customersRef = getCustomersRef();
        const storeId = getStoreId();
        const userId = getUserId();
        const currencyCode = getCurrencyCode();
        const currencySymbol = getCurrencySymbol();

        const refundTxRef = doc(transactionsRef);
        const refundInvoiceId = `RET-${generateInvoiceId().replace('INV-', '')}`;
        const refundTimestamp = serverTimestamp();

        // 1. Create REFUND Transaction in Firebase
        batch.set(refundTxRef, {
            invoiceId: refundInvoiceId,
            storeId: storeId,
            locationId: tx.locationId,
            timestamp: refundTimestamp,
            type: 'REFUND',
            customer: tx.customer,
            summary: {
                total: Math.abs(refundTotal), 
                profit: 0, 
                paymentMethod: 'REFUND',
                originalInvoiceId: tx.invoiceId,
                // Flag if this was a partial or full return
                isPartial: returnItems.length < tx.items.length || returnItems.some((item, i) => item.quantity < Math.abs(tx.items[tx.items.findIndex(orig => orig.id === item.id)]?.quantity)),
                transactionType: 'REFUND'
            },
            items: returnItems,
            cashierId: userId,
            currency: { code: currencyCode, symbol: currencySymbol }
        });

        // 2. Return Inventory to Stock
        returnItems.forEach(item => {
            if (item.id) {
                const productRef = doc(productsRef, item.id);
                batch.update(productRef, { 
                    stockLevel: increment(Math.abs(item.quantity)),
                    updatedAt: serverTimestamp()
                });
            }
        });

        // 3. Update Customer Stats and Ledger
        if (tx.customer && tx.customer.id && tx.customer.id !== 'WALK-IN') {
            const customerRef = doc(customersRef, tx.customer.id);
            
            const customerUpdates = {
                totalSpent: increment(-Math.abs(refundTotal)),
                lastVisit: refundTimestamp
            };

            // If they originally bought it on Udhaar, refunding the item reduces their debt!
            if (tx.summary?.paymentMethod === 'Credit') {
                customerUpdates.balance = increment(-Math.abs(refundTotal));
            }

            batch.update(customerRef, customerUpdates);
        }

        // 4. Update the Daily Sales Totals (Subtract from today's revenue)
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const dailyStatsRef = doc(transactionsRef.parent, 'dailyStats', todayStr);
        
        batch.set(dailyStatsRef, {
            revenue: increment(-Math.abs(refundTotal)),
            lastUpdated: serverTimestamp()
        }, { merge: true });

        await batch.commit();
        
        // Remove modals and reload page
        document.getElementById('partial-refund-modal')?.remove();
        document.getElementById('tx-detail-overlay')?.remove();
        
        showModal('Success', `Return processed successfully. ID: ${refundInvoiceId}`, 'success');
        loadTransactionsPage();

    } catch (error) {
        console.error("Refund failed:", error);
        showModal('Error', 'Refund failed: ' + error.message, 'error');
        document.getElementById('confirm-refund-btn').disabled = false;
        document.getElementById('confirm-refund-btn').innerHTML = 'Confirm Refund';
    }
}


export async function showTransactionDetails(txId) {
    const tx = localTransactionsCache.find(t => t.id === txId);
    if (!tx) return;
    
    // Nuke any existing phantom modals
    const existingModal = document.getElementById('tx-detail-overlay');
    if (existingModal) existingModal.remove();
    
    // 🚀 STEP 1: INSTANTLY render the blurred background (No fade-in transition on the background!)
    const detailOverlay = document.createElement('div');
    detailOverlay.id = 'tx-detail-overlay';
    // Removed   from here! Kept  .
    detailOverlay.className = "fixed inset-0 bg-gray-900/60  flex items-center justify-center z-[70]"; 
    
    // Inject a quick loading state so the window opens instantly
    detailOverlay.innerHTML = `
        <div id="tx-detail-inner-box" class="bg-white rounded-xl shadow-2xl w-full max-w-lg min-h-[300px] m-4 flex flex-col items-center justify-center ">
            <div class="animate-spin rounded-full h-10 w-10 border-b-4 border-indigo-600 mb-4"></div>
            <p class="text-sm font-bold text-gray-500 uppercase tracking-widest">Loading Details...</p>
        </div>
    `;
    document.body.appendChild(detailOverlay);

    // 🚀 STEP 2: Defer the heavy math and database lookups so the CSS animation can play smoothly
    setTimeout(async () => {
        let storeName = document.getElementById('dashboard-store-name')?.textContent 
                     || document.querySelector('.store-name-display')?.textContent 
                     || 'Our Store';
        storeName = storeName.trim();

        // Async Staff Name Lookup
        let cashierDisplayName = tx.cashierName;
        if (!cashierDisplayName && tx.cashierId) {
            try {
                const userSnap = await getDoc(doc(db, 'userProfiles', tx.cashierId));
                if (userSnap.exists()) {
                    cashierDisplayName = userSnap.data().name;
                }
            } catch (e) {
                console.warn("Could not fetch cashier name", e);
            }
        }
        cashierDisplayName = cashierDisplayName || tx.cashierId || 'System';

        const type = (tx.type || tx.summary?.transactionType || 'SALE').toUpperCase();
        const currency = tx.currency?.symbol || getCurrencySymbol();
        const payMethod = tx.summary?.paymentMethod || 'SYSTEM';
        const cheque = tx.summary?.chequeDetails;
        
        let headerClass = "text-gray-800";
        let headerBg = "bg-gray-100";
        let totalLabel = "Total Amount";
        
        // DYNAMIC UI STYLING & LABELS
        if (type === 'SALE') { 
            headerClass = "text-green-700"; headerBg = "bg-green-50"; 
            totalLabel = payMethod === 'CREDIT' ? 'Total Bill (Unpaid)' : 'Total Received';
        }
        else if (type === 'REFUND') { 
            headerClass = "text-orange-700"; headerBg = "bg-orange-50"; 
            totalLabel = 'Total Refunded';
        }
        else if (type === 'LOSS' || type === 'ADJUSTMENT') { 
            headerClass = "text-red-700"; headerBg = "bg-red-50"; 
            totalLabel = type === 'LOSS' ? 'Total Loss Value' : 'Adjustment Value';
        }
        else if (type === 'PURCHASE') { 
            headerClass = "text-blue-700"; headerBg = "bg-blue-50"; 
            totalLabel = 'Total Paid';
        }

        let itemsHtml = '';
        let calculatedSubtotal = 0;
        let totalSavings = 0; 
        const isMathReady = typeof safeMath?.multiply === 'function';

        if (tx.items) {
            tx.items.forEach(item => {
                const qtyAbs = Math.abs(item.quantity || 0);
                
                let unitRate = 0;
                let itemMrp = parseFloat(item.mrp || item.price || 0); 

                if (type === 'PURCHASE' || type === 'LOSS' || type === 'ADJUSTMENT') {
                    unitRate = parseFloat(item.cost || item.purchasePrice || item.price || 0);
                } else {
                    unitRate = parseFloat(item.price || item.cost || 0);
                    if (itemMrp > unitRate) {
                        totalSavings += (itemMrp - unitRate) * qtyAbs;
                    }
                }
                
                let lineTotal = 0;
                if (item.subtotal !== undefined && item.subtotal !== null) {
                    lineTotal = Math.abs(item.subtotal);
                } else {
                    lineTotal = isMathReady ? safeMath.multiply(unitRate, qtyAbs) : (unitRate * qtyAbs);
                }

                calculatedSubtotal = isMathReady ? safeMath.add(calculatedSubtotal, lineTotal) : (calculatedSubtotal + lineTotal);

                itemsHtml += `
                    <tr class="border-b last:border-0 border-gray-50">
                        <td class="py-3 px-1">
                            <p class="font-medium text-gray-800 text-sm">${escapeHTML(item.name)}</p>
                            <p class="text-[10px] text-gray-400 font-mono">${escapeHTML(item.sku || '-')}</p>
                        </td>
                        <td class="py-3 px-1 text-center font-mono text-sm text-gray-600">${qtyAbs}</td>
                        <td class="py-3 px-1 text-right text-sm text-gray-600">${currency}${unitRate.toFixed(2)}</td>
                        <td class="py-3 px-1 text-right font-bold text-sm text-gray-800">${currency}${lineTotal.toFixed(2)}</td>
                    </tr>
                `;
            });
        }

        const displaySubtotal = tx.summary?.subtotal ? Math.abs(tx.summary.subtotal) : calculatedSubtotal;
        const finalTotal = Math.abs(tx.summary?.total || 0);
        
        let paymentHtml = '';
        if (payMethod === 'CHEQUE' && cheque) {
            let statColor = 'text-yellow-600 bg-yellow-50 border-yellow-200';
            if (cheque.status === 'CLEARED') statColor = 'text-green-600 bg-green-50 border-green-200';
            if (cheque.status === 'BOUNCED') statColor = 'text-red-600 bg-red-50 border-red-200';
            
            paymentHtml = `
                <div class="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600 flex flex-col gap-1.5">
                    <div class="flex justify-between items-center mb-1">
                        <span class="font-bold uppercase tracking-wider text-[10px] text-gray-400">Payment Method</span>
                        <span class="font-bold text-gray-800 flex items-center gap-1.5">
                            CHEQUE 
                            <span class="text-[9px] px-1.5 py-0.5 rounded uppercase border ${statColor}">${cheque.status}</span>
                        </span>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-gray-500">Bank</span>
                        <span class="font-medium">${escapeHTML(cheque.bank || 'N/A')}</span>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-gray-500">Cheque No.</span>
                        <span class="font-mono">${escapeHTML(cheque.chequeNo || 'N/A')}</span>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-gray-500">Clearance Date</span>
                        <span class="font-medium">${escapeHTML(cheque.clearanceDate || 'N/A')}</span>
                    </div>
                </div>
            `;
        } else {
            paymentHtml = `
                <div class="text-right mt-1">
                     <span class="text-[10px] uppercase font-bold text-gray-400 border border-gray-200 px-2 py-0.5 rounded bg-gray-50">
                        Paid via ${escapeHTML(payMethod)}
                     </span>
                </div>
            `;
        }
        
        let totalsBlock = `
            <div class="flex justify-between text-sm text-gray-600 mb-1">
                <span>Subtotal</span>
                <span>${currency}${displaySubtotal.toFixed(2)}</span>
            </div>
            ${tx.summary?.tax > 0 ? `
            <div class="flex justify-between text-sm text-gray-600 mb-1">
                <span>Tax</span>
                <span>+${currency}${(tx.summary.tax).toFixed(2)}</span>
            </div>` : ''}
            ${tx.summary?.discount > 0 ? `
            <div class="flex justify-between text-sm text-green-600 font-medium mb-1">
                <span>Extra Discount</span>
                <span>-${currency}${(tx.summary.discount).toFixed(2)}</span>
            </div>` : ''}
            
            ${totalSavings > 0 && type === 'SALE' ? `
            <div class="flex justify-between items-center bg-green-50 p-2 rounded-lg border border-green-200 mt-2 mb-2 shadow-sm">
                <span class="font-bold text-green-700 text-sm">🎉 Customer Saved</span>
                <span class="font-black text-green-700 text-sm">${currency}${totalSavings.toFixed(2)}</span>
            </div>` : ''}

            ${tx.summary?.stagedDuesPayment > 0 ? `
            <div class="flex justify-between text-sm text-teal-600 font-medium mt-1 pt-1 border-t border-gray-100">
                <span>Previous Dues Settled</span>
                <span>+${currency}${(tx.summary.stagedDuesPayment).toFixed(2)}</span>
            </div>` : ''}
            
            <div class="flex justify-between items-center border-t border-gray-200 pt-3 mt-2">
                <span class="font-bold text-gray-900">${totalLabel}</span>
                <span class="font-black text-xl ${headerClass}">${currency}${finalTotal.toFixed(2)}</span>
            </div>
            ${paymentHtml}
        `;

        if (type === 'ADJUSTMENT' || type === 'LOSS') {
             totalsBlock = `
                <div class="flex justify-between items-center border-t border-gray-200 pt-3 mt-2">
                    <span class="font-bold text-gray-900">${totalLabel}</span>
                    <span class="font-black text-xl ${headerClass}">${currency}${finalTotal.toFixed(2)}</span>
                </div>
             `;
        }

        const modalContent = `
            <div id="tx-details-printable" class="p-6 font-sans">
                <div class="flex justify-between items-start mb-6 pb-4 border-b border-gray-100">
                    <div>
                        <h2 class="text-2xl font-bold text-gray-900">${escapeHTML(storeName)}</h2>
                        <div class="flex items-center gap-2 mt-1">
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${headerBg} ${headerClass}">${type}</span>
                            <span class="text-xs text-gray-400 font-mono">#${escapeHTML(tx.invoiceId)}</span>
                        </div>
                    </div>
                    <div class="text-right text-xs text-gray-500">
                        <p>${tx.timestamp?.toDate ? new Date(tx.timestamp.toDate()).toLocaleDateString() : 'N/A'}</p>
                        <p>${tx.timestamp?.toDate ? new Date(tx.timestamp.toDate()).toLocaleTimeString() : ''}</p>
                        <p class="mt-1 font-medium">By: ${escapeHTML(cashierDisplayName)}</p>
                    </div>
                </div>

                ${tx.summary?.reason ? `
                <div class="mb-6 bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded-r text-sm text-yellow-800">
                    <p class="font-bold text-xs uppercase opacity-70 mb-1">Note / Reason</p>
                    ${escapeHTML(tx.summary.reason)}
                </div>` : ''}

                <div class="mb-6">
                    <table class="w-full">
                        <thead class="text-xs text-gray-400 uppercase tracking-wider border-b-2 border-gray-100">
                            <tr>
                                <th class="text-left py-2 font-semibold">Item</th>
                                <th class="text-center py-2 font-semibold">Qty</th>
                                <th class="text-right py-2 font-semibold">Rate</th>
                                <th class="text-right py-2 font-semibold">Total</th>
                            </tr>
                        </thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>
                </div>

                <div class="flex justify-end">
                    <div class="w-full sm:w-2/3 md:w-1/2 space-y-1">
                        ${totalsBlock}
                    </div>
                </div>
                
                <div class="mt-8 flex justify-end gap-3 pt-4 border-t border-gray-100" id="tx-modal-actions">
                    ${type === 'SALE' ? `<button id="btn-refund-tx" class="px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded text-sm font-bold hover:bg-red-100 transition">Process Return / Refund</button>` : ''}
                    <button id="btn-print-tx" class="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-bold hover:bg-indigo-700 shadow transition flex items-center gap-2">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg> 
                        Reprint Receipt
                    </button>
                </div>
            </div>
        `;
        
        // 🚀 STEP 3: Swap out the spinner with the actual content using   so it looks intentional
        const innerBox = document.getElementById('tx-detail-inner-box');
        if (innerBox) {
            innerBox.outerHTML = `
                <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto m-4 flex flex-col  ">
                    <div class="flex justify-between items-center p-4 border-b border-gray-100 sticky top-0 bg-white z-10 shrink-0">
                        <h3 class="font-bold text-gray-800">Transaction Details</h3>
                        <button id="close-tx-overlay" class="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    ${modalContent}
                </div>
            `;
        }
        
        document.getElementById('close-tx-overlay').onclick = () => detailOverlay.remove();
        
        const printBtn = document.getElementById('btn-print-tx');
        if (printBtn) printBtn.onclick = () => buildAndPrintInvoice(tx, storeName);
        
        const refundBtn = document.getElementById('btn-refund-tx');
        if (refundBtn) refundBtn.onclick = () => processRefund(tx.id);

    }, 50); // Just 50ms of breathing room for the GPU!
}

window.updateChequeStatus = async function(txId, newStatus) {
    if (!confirm(`Are you sure you want to mark this cheque as ${newStatus}?`)) return;

    try {
        const txRef = doc(db, `artifacts/${appId}/stores/${getStoreId()}/transactions`, txId);
        
        // 1. Fetch the exact transaction data
        const snap = await getDoc(txRef);
        if (!snap.exists()) throw new Error("Transaction not found.");
        const txData = snap.data();
        
        const batch = writeBatch(db);
        
        // 2. Update the Cheque Status
        batch.update(txRef, {
            "summary.chequeDetails.status": newStatus,
            "summary.chequeDetails.processedDate": new Date().toISOString()
        });

        // 3. 🚀 THE MATH FIX: If Bounced, Re-apply Dues to Ledger!
        if (newStatus === 'BOUNCED') {
            const partyId = txData.customer?.id || txData.dealer?.id;
            const absoluteAmount = Math.abs(txData.summary?.total || 0);
            
            if (partyId) {
                const partyRef = doc(db, `artifacts/${appId}/stores/${getStoreId()}/customers`, partyId);
                
                // Add the absolute amount BACK to the party's outstanding dues
                batch.set(partyRef, {
                    dues: increment(absoluteAmount),
                    updatedAt: serverTimestamp()
                }, { merge: true });
                
                // Create a penalty/reversal log for accounting clarity
                const logRef = doc(collection(db, `artifacts/${appId}/stores/${getStoreId()}/transactions`));
                batch.set(logRef, {
                    invoiceId: `REV-${Date.now()}`,
                    storeId: getStoreId(),
                    locationId: txData.locationId || 'main',
                    timestamp: serverTimestamp(),
                    type: 'ADJUSTMENT',
                    customer: { id: partyId, name: txData.customer?.name || txData.dealer?.name },
                    summary: {
                        total: 0, 
                        dues: absoluteAmount, // Strictly a Dues Increase
                        profit: 0,
                        paymentMethod: 'SYSTEM',
                        reason: `Cheque Bounced Reversal (Ref: ${txData.summary?.chequeDetails?.chequeNo})`,
                        transactionType: 'LOSS'
                    },
                    items: [],
                    cashierId: getUserId(),
                    currency: { code: getCurrencyCode(), symbol: getCurrencySymbol() }
                });
            }
        }

        await batch.commit();

        let alertMsg = `Cheque successfully marked as ${newStatus}.`;
        if (newStatus === 'BOUNCED') alertMsg += ` The amount of ${getCurrencySymbol()}${Math.abs(txData.summary?.total || 0).toFixed(2)} has been added back to the ledger dues.`;

        if (typeof showModal === 'function') showModal('Success', alertMsg, 'success');
        
        // Refresh the table and alerts!
        loadTransactionsPage();

    } catch (e) {
        console.error("Failed to update cheque:", e);
        if (typeof showModal === 'function') showModal('Error', 'Failed to update cheque status and ledger.', 'error');
    }
};
// --- REPLACE IN src/components/transactions.js ---

async function executePaginationQuery(direction) {
    try {
        if (!window.dbAPI || !window.dbAPI.getTransactionsSince) return;
        
        // 🚀 THE FIX: Pull all transactions from SQLite instead of Firebase query()
        let txs = await window.dbAPI.getTransactionsSince("2000-01-01T00:00:00Z");

        const locationSelect = document.getElementById('tx-location-filter');
        const role = typeof getUserRole === 'function' ? getUserRole() : 'manager';
        const canAccessAllLocations = (role === 'admin' || role === 'accountant');
        const assignedLoc = typeof getUserAssignedLocationId === 'function' ? getUserAssignedLocationId() : 'main';
        
        let filterLoc = canAccessAllLocations ? 'all' : assignedLoc;
        if (canAccessAllLocations && locationSelect) filterLoc = locationSelect.value;

        // 1. In-memory Location Filter
        if (filterLoc !== 'all') {
            txs = txs.filter(tx => (tx.locationId || 'main') === filterLoc);
        }
        
        // 2. In-memory Type Filter
        if (currentTypeFilter !== 'ALL') {
            if (currentTypeFilter === 'SALE') {
                txs = txs.filter(tx => tx.summary?.transactionType === "SALE");
            } else if (currentTypeFilter === 'ADJUSTMENT') {
                txs = txs.filter(tx => tx.type === "ADJUSTMENT" || tx.type === "LOSS"); 
            } else if (currentTypeFilter === 'LOSS') {
                txs = txs.filter(tx => tx.type === "LOSS");
            } else {
                txs = txs.filter(tx => tx.type === currentTypeFilter);
            }
        }

        // 3. In-memory Payment Filter
        const paymentMethod = document.getElementById('tx-payment-filter')?.value || 'all';
        if (paymentMethod !== 'all') {
            txs = txs.filter(tx => tx.summary?.paymentMethod === paymentMethod);
        }

        // 4. In-memory Date Filter
        const startDateVal = document.getElementById('tx-start-date')?.value;
        const endDateVal = document.getElementById('tx-end-date')?.value;

        if (startDateVal) {
            const startIST = getISTBoundary(startDateVal, false).getTime();
            txs = txs.filter(tx => new Date(tx.timestamp || Date.now()).getTime() >= startIST);
        }
        if (endDateVal) {
            const endIST = getISTBoundary(endDateVal, true).getTime();
            txs = txs.filter(tx => new Date(tx.timestamp || Date.now()).getTime() <= endIST);
        }

        // Format to match old Firebase snapshot array so updateLocalCache works seamlessly
        const pseudoSnapshot = { empty: txs.length === 0, docs: txs.map(tx => ({ id: tx.id, data: () => tx })) };
        
        if (pseudoSnapshot.empty) {
            showModal('Info', direction === 'next' ? 'No more records.' : 'You are at the start.', 'info');
            return;
        }
        updateLocalCache(pseudoSnapshot);
        renderTransactionsTable();
    } catch (e) { console.error(e); }
}

async function checkChequeAlerts() {
    const txUi = document.querySelector('.tx-modern-ui');
    if (!txUi) return;

    const existingAlert = document.getElementById('cheque-alert-wrapper');
    if (existingAlert) existingAlert.remove();

    try {
        if (!window.dbAPI || !window.dbAPI.getPendingCheques) return;
        
        // 🚀 THE FIX: Fetch directly from SQLite instead of Firebase query()
        const pendingCheques = await window.dbAPI.getPendingCheques();
        if (pendingCheques.length === 0) return;

        let dueTodayOrPast = 0;
        const today = new Date().toISOString().split('T')[0];

        pendingCheques.forEach(data => {
            const clDate = data.summary?.chequeDetails?.clearanceDate;
            if (clDate && clDate <= today) dueTodayOrPast++;
        });

        // ... Keep the exact same UI injection code below ...
        if (dueTodayOrPast > 0) {
            const alertHtml = `
                <div id="cheque-alert-wrapper" class="overflow-hidden opacity-0" style="height: 0px; transition: height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.5s ease;">
                    <div id="cheque-alert-inner" class="pb-6">
                        <div class="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border border-red-100">
                            <div class="flex items-center gap-3">
                                <div class="bg-red-100 p-2 rounded-full text-red-600 shrink-0">
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                                </div>
                                <div>
                                    <h4 class="text-red-800 font-bold text-sm">Action Required: Pending Cheques</h4>
                                    <p class="text-red-600 text-xs mt-0.5">You have <b class="text-red-800 text-sm">${dueTodayOrPast}</b> cheque(s) ready for bank clearance today.</p>
                                </div>
                            </div>
                            <button onclick="document.getElementById('filter-cheque-btn').click()" class="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-lg text-xs font-bold shadow-md transition-transform active:scale-95 whitespace-nowrap">
                                Review Cheques
                            </button>
                        </div>
                    </div>
                </div>
            `;
            txUi.insertAdjacentHTML('afterbegin', alertHtml);
            const wrapper = document.getElementById('cheque-alert-wrapper');
            if (wrapper) {
                void wrapper.offsetHeight;
                wrapper.style.height = wrapper.scrollHeight + 'px';
                wrapper.style.opacity = '1';
                wrapper.addEventListener('transitionend', function handler(e) {
                    if (e.propertyName === 'height') {
                        wrapper.style.height = 'auto';
                        wrapper.removeEventListener('transitionend', handler);
                    }
                });
            }
        }
    } catch(e) {
        console.error("Cheque alert error:", e);
    }
}

window.selectExportFormat = (format, data) => {
    window.currentExportData = data;
    window.currentExportFormat = format;
    
    document.getElementById('step-format').classList.add('hidden');
    document.getElementById('step-preview').classList.remove('hidden');
    document.getElementById('export-status').textContent = `Step 2: Preview & Download (${format.toUpperCase()})`;
    
    // Render the table...
    // [Call your updatePreview function here]
};

// ============================================================================
// 🛡️ EMERGENCY UI UNLOCK (GHOSTBUSTER)
// ============================================================================
document.addEventListener('keydown', (e) => {
    // If the app freezes, the user can hit 'Escape' to forcibly destroy all overlays
    if (e.key === 'Escape') {
        const modals = document.querySelectorAll(
            '[id$="-modal"], [id$="-overlay"], #pos-qr-payment-modal, #tx-detail-overlay'
        );
        
        modals.forEach(el => {
            el.classList.add('hidden');
            setTimeout(() => el.remove(), 50);
        });

        document.body.classList.remove('overflow-hidden');
        
        if (typeof setCheckoutLoadingState === 'function') {
            isProcessingCheckout = false;
            setCheckoutLoadingState(false);
        }
    }
});