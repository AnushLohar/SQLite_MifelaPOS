// src/components/inventory.js


import { escapeHTML } from '../utils/security.js'; 
import { safeMath } from '../utils/math.js'; 
import { savePosImage } from '../utils/imageDB.js';
import { generateMerchantId } from '../utils/ids.js'; 
import { initProductionUI } from './production.js'; 
import { openManualBulkUpload } from './bulkUpload.js';
import { DOM, showModal, showToast } from '../utils/dom.js'; 
import { exportInventoryToSpreadsheet } from '../utils/export.js'; 

import { 
    getStoreId, getUserId, appId, getCurrencySymbol, getEditingProductId, 
    setEditingProductId, getCurrencyCode, getCurrentUserPlan, 
    getCurrentProductCount, setCurrentProductCount, PLAN_LIMITS, 
    getCurrentLocationId, getAvailableLocations, getUserRole, 
    setCurrentLocation, getUserAssignedLocationId, invalidateProductCache, AppState
} from '../store/state.js';

// ============================================================================
// 🚀 OFFLINE MOCKS: Perfectly intercepts Firebase commands and routes to SQLite
// ============================================================================
const getProductsRef = () => 'products';
const getTransactionsRef = () => 'transactions';
const getCustomersRef = () => 'customers';
const serverTimestamp = () => new Date().toISOString();
const increment = (val) => ({ _isIncrement: true, value: val });
export async function refreshLocalInventoryCache() {
    if (!window.dbAPI || !window.dbAPI.getProducts) return;
    try {
        const products = await window.dbAPI.getProducts();
        const role = typeof getUserRole === 'function' ? getUserRole() : 'manager';
        const canAccessAllLocations = (role === 'admin' || role === 'accountant');
        const assignedLoc = typeof getUserAssignedLocationId === 'function' ? getUserAssignedLocationId() : 'main';
        const normAssignedLoc = getNormalizedLoc(assignedLoc);

        // Update the global cache variable
        localProductsCache = canAccessAllLocations ? products : products.filter(d => getNormalizedLoc(d.locationId) === normAssignedLoc);
        
        // Save to local storage for fast initial loads
        localStorage.setItem(getCacheKey(), JSON.stringify(localProductsCache));

        // 🚀 FORCE THE UI TO RE-RENDER INSTANTLY
        if (DOM.inventory.table) {
            renderInventoryTable();
            if (typeof updateInventoryCountDisplay === 'function') updateInventoryCountDisplay();
            if (typeof updateProductDatalist === 'function') updateProductDatalist(); 
            if (typeof updateBundleDatalist === 'function') updateBundleDatalist();
        }
    } catch (e) { 
        console.error("Local UI Sync failed:", e); 
    }
}
function doc(dbOrCol, pathOrId) {
    let colStr = typeof dbOrCol === 'string' ? dbOrCol : (dbOrCol?.col || '');
    let idStr = pathOrId || '';

    // If the first argument is the dummy 'db' object, the routing info is hidden inside the path
    if (!colStr && typeof pathOrId === 'string') {
        colStr = pathOrId;
        const parts = pathOrId.split('/');
        idStr = parts.pop(); // The ID is always the last segment in a Firestore path
    }

    // Safely route to the correct SQLite table
    let col = 'unknown';
    if (colStr.includes('products')) col = 'products';
    else if (colStr.includes('transactions')) col = 'transactions';
    else if (colStr.includes('customers') || colStr.includes('directory_merchants')) col = 'customers';

    const id = idStr || `AUTO-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    return { col, id };
}

function writeBatch() {
    return {
        ops: [],
        set(docRef, data, opts) { this.ops.push({ type: 'set', col: docRef.col, id: docRef.id, data, merge: opts?.merge }); },
        update(docRef, data) { this.ops.push({ type: 'update', col: docRef.col, id: docRef.id, data }); },
        delete(docRef) { this.ops.push({ type: 'delete', col: docRef.col, id: docRef.id }); },
        async commit() {
            if (window.dbAPI && window.dbAPI.executeBatch) {
                await window.dbAPI.executeBatch(this.ops);
                
                // 🚀 THE FIX: Dynamically announce which databases were altered
                const alteredCols = new Set(this.ops.map(op => op.col));
                if (alteredCols.has('products')) {
                    if (typeof refreshLocalInventoryCache === 'function') await refreshLocalInventoryCache();
                    AppState.notify('products_updated'); // Alerts the POS to update the grid and cart
                }
                if (alteredCols.has('customers')) {
                    if (typeof refreshCustomerIndex === 'function') await refreshCustomerIndex();
                    AppState.notify('customers_updated'); // Alerts the POS to update dues and B2B pricing
                }
                if (alteredCols.has('transactions')) {
                    AppState.notify('transactions_updated'); // Alerts the Ledger and Activity Modals
                }
            }
        }
    };
}

async function deleteDoc(docRef) {
    if (window.dbAPI && window.dbAPI.deleteDoc) {
        await window.dbAPI.deleteDoc(docRef.col, docRef.id);
        await refreshLocalInventoryCache(); // 🚀 INSTANTLY SYNC UI AFTER DELETE
    }
}

async function getDoc(docRef) {
    if (window.dbAPI && window.dbAPI.getDoc) {
        const data = await window.dbAPI.getDoc(docRef.col, docRef.id);
        return { exists: () => !!data, data: () => data, id: docRef.id };
    }
    return { exists: () => false, data: () => null, id: docRef.id };
}



async function runTransaction(db, callback) {
    const mockTx = {
        async get(docRef) { return await getDoc(docRef); },
        set(docRef, data, opts) { this.batch.set(docRef, data, opts); },
        update(docRef, data) { this.batch.update(docRef, data); },
        delete(docRef) { this.batch.delete(docRef); },
        batch: writeBatch()
    };
    await callback(mockTx);
    await mockTx.batch.commit();
}

// Dummy query functions to bypass complex online duplicate checkers
const query = () => null;
const where = () => null;
const limit = () => null;
const orderBy = () => null;
const collection = () => 'dummy_collection'; // 🚀 THE FIX: Mocked collection
const addDoc = async () => ({ id: `LOG-${Date.now()}` }); // 🚀 THE FIX: Mocked addDoc
const getCountFromServer = async () => ({ data: () => ({ count: localProductsCache.length }) });
const getDocs = async () => ({ empty: true, docs: [] }); 

const db = {}; // Dummy db object to satisfy writeBatch(db)

const PRODUCTS_PER_PAGE = 50;
window.currentInventoryPage = 1;
window.changeInventoryPage = function(delta) {
    window.currentInventoryPage += delta;
    renderInventoryTable();
};

// --- State & Cache ---
let localProductsCache = []; 
let localDealersCache = []; 
let hsnDirectoryCache = [];
let productToAdjust = null;
let activityListenerUnsubscribe = null;
let inventoryListenerUnsubscribe = null;
let isListenersAttached = false; 

// --- BUNDLE STATE ---
let bundleComponents = []; // Array of { id, name, qty, cost }

// --- OFFLINE: Dynamic Cache Key (Prevents role-mixing on same device) ---
const getCacheKey = () => `mifela_inv_${getStoreId()}_${getUserId()}`;
const secureFloat = (val) => { const parsed = parseFloat(val); return isNaN(parsed) ? 0 : parsed; };
const secureInt = (val) => { const parsed = parseInt(val, 10); return isNaN(parsed) ? 0 : parsed; };

// --- HELPER: Location Normalization ---
function getNormalizedLoc(locId) {
    const sid = getStoreId();
    if (!locId || locId === 'all' || locId === sid) return 'main';
    return locId;
}

// 🚀 HYBRID FEFO/FIFO BATCH SORTING HELPER
function sortBatchesFefoFifo(batches) {
    if (!Array.isArray(batches)) return [];
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();

    return [...batches].sort((a, b) => {
        const hasExpA = Boolean(a.expirationDate);
        const hasExpB = Boolean(b.expirationDate);
        
        const timeA = hasExpA ? new Date(a.expirationDate).getTime() : Infinity;
        const timeB = hasExpB ? new Date(b.expirationDate).getTime() : Infinity;
        
        const isExpA = timeA < todayTime;
        const isExpB = timeB < todayTime;
        
        // 1. 🛑 EXPIRED STOCK QUARANTINE: Push expired batches to the absolute bottom!
        if (isExpA && !isExpB) return 1;
        if (!isExpA && isExpB) return -1;
        
        // 2. If both are valid (or both expired), sort by earliest expiry first (FEFO)
        if (hasExpA && hasExpB) {
            return timeA - timeB;
        }
        
        // 3. Items with expiry take precedence over items without expiry
        if (hasExpA) return -1;
        if (hasExpB) return 1;
        
        // 4. Fallback to FIFO (oldest timestamp first)
        return (a.timestamp || 0) - (b.timestamp || 0);
    });
}

window.prepareNewBatch = function() {
    const stockInput = document.getElementById('stockLevel') || document.getElementById('stock') || document.querySelector('input[name="stock"]');
    
    if (stockInput && typeof stockInput.dataset === 'object') {
        stockInput.dataset.baseStock = stockInput.value || 0;
        delete stockInput.dataset.editingBatchIndex;
    }
    
    ['prod-cases', 'prod-pieces', 'prod-free-qty'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = '0';
    });
    
    // 🚀 THE FIX: Aggressively clear ALL batch-specific pricing, dates, and supplier info.
    // Keep Name, SKU, Barcode, and HSN completely intact.
    const fieldsToClear = [
        'expirationDate', 'packagedDate', 'prod-batch', 'prod-invoice', 
        'prod-dealer', 'prod-dealer-id', 'prod-dealer-phone', 'prod-gstin', 'prod-dealer-pan', 'prod-dealer-state',
        'price', 'cost', 'prod-mrp', 'prod-base-rate', 'prod-net-amt', 'prod-taxable-amt', 
        'prod-cgst', 'prod-sgst', 'prod-sch-disc', 'prod-rs-disc'
    ];

    fieldsToClear.forEach(id => {
        const el = document.getElementById(id) || document.querySelector(`input[name="${id}"]`);
        if(el) {
            el.value = '';
            el.disabled = false; // 🚀 Unlock fields so a different dealer can be entered
            el.classList.remove('bg-gray-100', 'bg-gray-50', 'cursor-not-allowed', 'text-gray-500');
        }
    });

    // Clear active memory lock for dealer
    if (typeof activeDealerState !== 'undefined') {
        activeDealerState = { id: null, phone: '', name: '' };
    }
    
    // Default the Purchase Date to today for the new batch
    const prodDate = document.getElementById('prod-date');
    if (prodDate) prodDate.value = new Date().toISOString().split('T')[0];
    
    const pcsEl = document.getElementById('prod-pieces');
    if (pcsEl) {
        pcsEl.focus();
        pcsEl.classList.add('ring-4', 'ring-indigo-300');
        setTimeout(() => pcsEl.classList.remove('ring-4', 'ring-indigo-300'), 1000);
    }
    
    if (typeof window.calculateInvoiceBreakdown === 'function') {
        window.calculateInvoiceBreakdown('prod-pieces');
    }

    // Disable the Add Batch button until they save or click an existing batch
    const addBatchBtn = document.querySelector('button[onclick="window.prepareNewBatch()"]');
    if (addBatchBtn) {
        addBatchBtn.disabled = true;
        addBatchBtn.classList.add('opacity-50', 'cursor-not-allowed');
        addBatchBtn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> Adding...`;
    }
    
    if (typeof showToast === 'function') showToast("Ready", "Enter new batch quantities, pricing, and supplier details.", "info");
};
window.loadBatchToForm = function(index) {
    if (!window._tempBatchList || !window._tempBatchList[index]) return;
    const b = window._tempBatchList[index];
    
    const stockInput = document.getElementById('stockLevel') || document.getElementById('stock') || document.querySelector('input[name="stock"]');
    
    // Move root product lookup to the top
    const currentProductId = typeof getEditingProductId === 'function' ? getEditingProductId() : null;
    const rootProduct = (typeof localProductsCache !== 'undefined' && currentProductId) 
        ? localProductsCache.find(p => p.id === currentProductId) || {} : {};

    if (stockInput) {
        const currentTotal = parseFloat(stockInput.value) || 0;
        stockInput.dataset.baseStock = Math.max(0, currentTotal - (parseFloat(b.qty) || 0));
        
        // 🚀 THE FIX: Match exact batch from root product instead of using transient visual table index
        if (rootProduct.batches) {
            const realIndex = rootProduct.batches.findIndex(orig => orig.timestamp === b.timestamp && orig.batchNo === b.batchNo);
            if (realIndex > -1) {
                stockInput.dataset.editingBatchIndex = realIndex;
            } else {
                delete stockInput.dataset.editingBatchIndex;
            }
        } else {
            stockInput.dataset.editingBatchIndex = index; // Fallback
        }
    }
    
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

    setEl('prod-cases', b.cases !== undefined ? b.cases : '0');
    setEl('prod-pieces', b.pieces !== undefined ? b.pieces : (b.qty || '0'));
    setEl('prod-free-qty', b.freeQty !== undefined ? b.freeQty : '0');
    setEl('prod-upc', b.upc || '1');

    setEl('prod-batch', b.batchNo === 'LEGACY-STOCK' ? '' : (b.batchNo || ''));
    
    // 🚀 BATCH ISOLATION: Load Pricing directly from the batch!
    const priceInput = document.getElementById('price');
    if (priceInput) priceInput.value = (parseFloat(b.price !== undefined ? b.price : rootProduct.price) || 0).toFixed(2);
    setEl('prod-mrp', (parseFloat(b.mrp !== undefined ? b.mrp : rootProduct.mrp) || 0).toFixed(2));
    
    setEl('prod-date', b.date || rootProduct.purchaseDate || (rootProduct.createdAt ? rootProduct.createdAt.split('T')[0] : ''));
    setEl('expirationDate', b.expirationDate || rootProduct.expirationDate || '');
    
    const packagedInput = document.getElementById('packagedDate') || document.querySelector('input[name="packaged"]');
    if (packagedInput) packagedInput.value = b.packagedDate || rootProduct.packagedDate || '';
    
    if (b.sl !== undefined || rootProduct.sl !== undefined) setEl('prod-sl', b.sl || rootProduct.sl || '');
    
    // Safely map Dealer Name
    let resolvedDealerName = b.dealerName || rootProduct.dealerName || '';
    let resolvedDealerId = b.dealerId || b.supplierId || rootProduct.dealerId || '';
    
    if (resolvedDealerName.startsWith('MERCH-')) {
        resolvedDealerId = resolvedDealerName;
        resolvedDealerName = '';
    }

    let cachedDealer = null;
    if (resolvedDealerId && typeof localDealersCache !== 'undefined') {
        cachedDealer = localDealersCache.find(d => d.id === resolvedDealerId);
        if (!resolvedDealerName && cachedDealer) {
            resolvedDealerName = cachedDealer.name || cachedDealer.storeName;
        }
    }
    
    setEl('prod-dealer', resolvedDealerName);
    setEl('prod-dealer-id', resolvedDealerId);
    
    let resolvedPhone = b.dealerPhone || rootProduct.dealerPhone || (cachedDealer ? cachedDealer.phone : '');
    setEl('prod-dealer-phone', resolvedPhone.replace(/^\+?91/, ''));

    setEl('prod-gstin', b.dealerGstin || rootProduct.gstin || (cachedDealer ? cachedDealer.gstin : ''));
    setEl('prod-dealer-pan', b.dealerPan || rootProduct.dealerPan || (cachedDealer ? cachedDealer.pan : ''));
    setEl('prod-dealer-state', b.dealerState || rootProduct.dealerState || (cachedDealer ? cachedDealer.state : ''));
    setEl('prod-invoice', b.supplierInvoice || rootProduct.supplierInvoice || '');

    const cost = parseFloat(b.cost) || 0;
    const qty = parseFloat(b.qty) || 1;
    let savedBaseRate = parseFloat(b.baseRate);
    if (isNaN(savedBaseRate)) savedBaseRate = 0;

    if (savedBaseRate > 0) {
        setEl('prod-base-rate', savedBaseRate.toFixed(2));
        setEl('gst-slab', b.gstSlab || rootProduct.gstSlab || 0);
        setEl('prod-cess', b.cess || rootProduct.cess || 0);
        
        setEl('prod-sch-disc', b.rawSchDisc !== undefined ? parseFloat(b.rawSchDisc).toFixed(2) : parseFloat(b.schDisc || 0).toFixed(2));
        setEl('prod-rs-disc', b.rawRsDisc !== undefined ? parseFloat(b.rawRsDisc).toFixed(2) : parseFloat(b.rsDisc || 0).toFixed(2));
        
        const schToggle = document.getElementById('prod-sch-disc-type-toggle');
        if (schToggle) schToggle.checked = b.isSchPercent || false;
        
        const rsToggle = document.getElementById('prod-rs-disc-type-toggle');
        if (rsToggle) rsToggle.checked = b.isRsPercent || false;
        
        const taxIncToggle = document.getElementById('tax-inclusive-toggle');
        if (taxIncToggle) taxIncToggle.checked = b.isTaxInclusive || false;

        setEl('prod-taxable-amt', parseFloat(b.taxableAmt || 0).toFixed(2));
        setEl('prod-net-amt', parseFloat(b.netAmt || (cost * qty)).toFixed(2));
    } else {
        const gstEl = document.getElementById('gst-slab');
        const cessEl = document.getElementById('prod-cess');
        const gst = parseFloat(b.gstSlab || rootProduct.gstSlab || gstEl?.value) || 0;
        const cess = parseFloat(b.cess || rootProduct.cess || cessEl?.value) || 0;
        const taxMultiplier = 1 + (gst / 100) + (cess / 100);
        
        const baseRate = cost / taxMultiplier;
        const netAmt = cost * qty;
        
        setEl('prod-base-rate', baseRate.toFixed(2));
        setEl('prod-net-amt', netAmt.toFixed(2));
        setEl('prod-sch-disc', '0');
        setEl('prod-rs-disc', '0');
    }

    if (typeof window.calculateInvoiceBreakdown === 'function') {
        window.calculateInvoiceBreakdown('prod-net-amt'); 
    }
    
    // 🚀 THE FIX: Re-enable the Add Batch button when viewing an existing batch
    const addBatchBtn = document.querySelector('button[onclick="window.prepareNewBatch()"]');
    if (addBatchBtn) {
        addBatchBtn.disabled = false;
        addBatchBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        addBatchBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg> Add New Batch`;
    }
    
    if (typeof showToast === 'function') showToast('Batch Loaded', `Editing Batch: ${b.batchNo || 'Legacy'}`, 'success');
    document.getElementById('inventory-form-title')?.scrollIntoView({ behavior: 'smooth' });
};
// =========================================================
// 1. INITIALIZATION & LOADING
// =========================================================

export async function loadInventoryPage() {
    if (!DOM.inventory.table) return; 
    
    const role = typeof getUserRole === 'function' ? getUserRole() : 'manager';
    const assignedLoc = typeof getUserAssignedLocationId === 'function' ? getUserAssignedLocationId() : 'main';
    let currentLoc = typeof getCurrentLocationId === 'function' ? getCurrentLocationId() : 'main';
    const canAccessAllLocations = (role === 'admin' || role === 'accountant') ;

    if (!canAccessAllLocations && currentLoc !== assignedLoc) {
        if (typeof setCurrentLocation === 'function') setCurrentLocation(assignedLoc);
        currentLoc = assignedLoc;
    }

    const storeId = getStoreId();
    const productsRef = getProductsRef();
    if (!storeId || !productsRef) {
        console.warn("Inventory DB not ready, retrying...");
        setTimeout(loadInventoryPage, 500); 
        return;
    }

    if (!isListenersAttached) {
        setupInventoryListeners();
        isListenersAttached = true;
    }

    injectInventoryCopyright();
    injectImportButton(); 
    injectExpiredStockButton(); 
    injectProductCountDisplay();
    injectFreeQtyField(); 
    injectPaymentFields();
    injectExtraDealerFields();
    injectLocationDropdown(); 
    injectBatchRegistry(); 
    injectLocationFilterDropdown();
    injectTaxInclusiveToggle();
    injectPurchaseDiscountToggles(); 
    injectDiscountCalculator();
    
    
    injectB2BPricingButton();

    const dealerLabel = document.querySelector('label[for="prod-dealer"]');
    if (dealerLabel) dealerLabel.textContent = "Store Name";
    
    const invSection = document.getElementById('inventory');
    if (invSection) {
        const ths = invSection.querySelectorAll('th');
        ths.forEach(th => {
            if (th.textContent.trim() === 'Dealer') th.textContent = 'Store';
        });
    }

    const cachedData = localStorage.getItem(getCacheKey());
    if (cachedData) {
        try {
            localProductsCache = JSON.parse(cachedData);
            renderInventoryTable();
            updateInventoryCountDisplay();
        } catch (e) {
            localStorage.removeItem(getCacheKey());
            DOM.inventory.table.innerHTML = `<tr><td colspan="8" class="text-center py-4">Loading...</td></tr>`;
        }
    } else {
        DOM.inventory.table.innerHTML = `<tr><td colspan="8" class="text-center py-4">Loading...</td></tr>`;
    }
    
    try {
        updateProductDatalist(); 
        updateBundleDatalist();
        await loadDealerDropdowns(); 
        
        if (DOM.inventory.inputs.gst && DOM.inventory.inputs.gst.options.length <= 1) {
             DOM.inventory.inputs.gst.innerHTML = `
                <option value="0">0% (Exempt)</option>
                <option value="5">5%</option>
                <option value="12">12%</option>
                <option value="18">18%</option>
                <option value="28">28%</option>
             `;
        }
        if (!getEditingProductId()) resetForm(); 
    } catch (error) {
        console.error("Error initializing inventory view:", error);
    }

    setupActivityListener();

    // =========================================================================
    // 🚀 INJECT MANUFACTURING SUB-TABS (IN-HEADER UI)
    // =========================================================================
    const inventorySectionDiv = document.getElementById('inventory');
    
    if (inventorySectionDiv && !document.getElementById('inventory-mode-toggle')) {
        
        // 1. SURGICAL FINDER: Locate the exact white Title Box (Header)
        let headerBox = inventorySectionDiv.querySelector('header');
        if (!headerBox) {
            // Fallback: Find the div containing the h2 title
            const h2 = Array.from(inventorySectionDiv.querySelectorAll('h2')).find(el => el.textContent.includes('Stock'));
            if (h2) headerBox = h2.parentElement;
        }

        if (headerBox) {
            // Force the header box to be a flex container so tabs sit beautifully on the right
            headerBox.classList.add('flex', 'flex-col', 'sm:flex-row', 'justify-between', 'items-center', 'gap-4');

            const toggleContainer = document.createElement('div');
            toggleContainer.id = 'inventory-mode-toggle';
            
            // Compact, colorful pill container
            toggleContainer.className = "bg-slate-100/80 p-1 rounded-xl flex gap-1 shadow-inner border border-slate-200/60 w-full sm:w-auto mt-2 sm:mt-0 shrink-0";
            
            const retailIcon = `<svg class="w-4 h-4 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>`;
            const mfgIcon = `<svg class="w-4 h-4 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>`;

            // DYNAMIC COLOR STATES
            const getRetailActive = () => "py-2 px-4 rounded-lg text-sm font-black transition-all duration-300 bg-white text-indigo-600 shadow-[0_2px_8px_-2px_rgba(79,70,229,0.3)] ring-1 ring-indigo-100 flex items-center justify-center gap-2 transform scale-[1.02] z-10 tracking-wide";
            const getMfgActive = () => "py-2 px-4 rounded-lg text-sm font-black transition-all duration-300 bg-white text-purple-600 shadow-[0_2px_8px_-2px_rgba(147,51,234,0.3)] ring-1 ring-purple-100 flex items-center justify-center gap-2 transform scale-[1.02] z-10 tracking-wide";
            const inactiveClass = "py-2 px-4 rounded-lg text-sm font-bold transition-all duration-300 text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 flex items-center justify-center gap-2 transform scale-100";

            toggleContainer.innerHTML = `
                <button id="tab-retail-stock" class="${getRetailActive()}">${retailIcon} Retail & Standard</button>
                <button id="tab-manufacturing" class="${inactiveClass}">${mfgIcon} Manufacturing</button>
            `;
            
            // Inject directly into the white header box
            headerBox.appendChild(toggleContainer);

            // 2. Wrap and prepare main content
            const productForm = document.getElementById('product-form') || DOM.inventory.form;
            let mainContentWrapper = productForm;
            
            while (mainContentWrapper && mainContentWrapper.parentElement !== inventorySectionDiv && mainContentWrapper.parentElement !== document.body) {
                mainContentWrapper = mainContentWrapper.parentElement;
            }
            
            if (mainContentWrapper) {
                mainContentWrapper.id = 'inventory-main-content';
                
                let productionContent = document.getElementById('production-main-content');
                if (!productionContent) {
                    productionContent = document.createElement('div');
                    productionContent.id = 'production-main-content';
                    productionContent.className = 'hidden w-full mt-4';
                    mainContentWrapper.insertAdjacentElement('afterend', productionContent);
                }

                // 3. Tab Click Listeners
                document.getElementById('tab-retail-stock').onclick = (e) => {
                    e.target.closest('button').className = getRetailActive();
                    document.getElementById('tab-manufacturing').className = inactiveClass;
                    
                    mainContentWrapper.classList.remove('hidden');
                    productionContent.classList.add('hidden');
                    
                    renderInventoryTable(); 
                };

                document.getElementById('tab-manufacturing').onclick = (e) => {
                    e.target.closest('button').className = getMfgActive();
                    document.getElementById('tab-retail-stock').className = inactiveClass;
                    
                    mainContentWrapper.classList.add('hidden');
                    productionContent.classList.remove('hidden');
                    
                    initProductionUI(productionContent);
                };
            }
        }
    }
    // =========================================================================
}
// =========================================================
// 2. DOM INJECTION & MODAL HANDLERS
// =========================================================

function injectInventoryCopyright() {
    const inventorySection = document.getElementById('inventory');
    if (inventorySection && !document.getElementById('inventory-copyright-footer')) {
        const footer = document.createElement('div');
        footer.id = 'inventory-copyright-footer';
        footer.className = "py-8 text-center border-t border-gray-100 mt-8";
        footer.innerHTML = `
            <div class="flex flex-col items-center gap-1.5">
                <p class="text-[10px] font-bold text-gray-400 tracking-[0.3em] uppercase">Mifela Inventory Management</p>
                <p class="text-[11px] text-gray-500 font-medium">© 2026 All Rights Reserved</p>
            </div>
        `;
        inventorySection.appendChild(footer);
    }
}

function injectImportButton() {
    if (document.getElementById('bulk-import-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'bulk-import-btn';
    
    // 🚀 COLOR: Soft Indigo
    btn.className = "px-4 py-2 text-sm font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl hover:bg-indigo-100 hover:border-indigo-300 shadow-sm transition-all flex items-center gap-2 whitespace-nowrap";
    btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg> Bulk Upload`;
    btn.onclick = window.openImportDialog; 

    const actionContainer = document.getElementById('inventory-action-buttons');
    if (actionContainer) {
        actionContainer.insertBefore(btn, actionContainer.firstChild); 
    }
}



function injectExpiredStockButton() {
    const actionContainer = document.getElementById('inventory-action-buttons');
    if (actionContainer && !document.getElementById('manage-expired-btn')) {
        
        // 1. Manage Expired Button 🚀 COLOR: Soft Red
        const expBtn = document.createElement('button');
        expBtn.id = 'manage-expired-btn';
        expBtn.className = "px-4 py-2 text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 hover:border-red-300 shadow-sm transition-all flex items-center gap-2 whitespace-nowrap";
        expBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Manage Expired`;
        expBtn.onclick = openExpiredStockModal; 
        actionContainer.appendChild(expBtn);
        
        // 2. Merge Duplicates Button 🚀 COLOR: Soft Amber/Orange
        const mergeBtn = document.createElement('button');
        mergeBtn.id = 'merge-inventory-btn';
        mergeBtn.className = "px-4 py-2 text-sm font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 hover:border-amber-300 shadow-sm transition-all flex items-center gap-2 whitespace-nowrap";
        mergeBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg> Merge Duplicates`;
        mergeBtn.onclick = mergeDuplicateInventoryItems; 
        actionContainer.appendChild(mergeBtn);
    }
}

function injectProductCountDisplay() {
    const target = document.getElementById('inventory-count-target');
    if (target && !document.getElementById('inventory-count-display')) {
        const div = document.createElement('div');
        div.id = 'inventory-count-display';
        div.className = "bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg border border-indigo-200 text-sm font-bold flex items-center whitespace-nowrap shadow-sm";
        div.innerHTML = `Items: <span id="product-count-value" class="ml-1">...</span>`;
        target.appendChild(div);
    }
}

function injectPoCatalogCheckbox() {
    if (document.getElementById('prod-visibility-container')) return;

    const form = DOM.inventory.form;
    const saveBtn = DOM.inventory.saveBtn;
    
    if (form && saveBtn) {
        const container = document.createElement('div');
        container.id = 'prod-visibility-container';
        container.className = "col-span-full w-full grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-200 mt-6 mb-4 shadow-sm";
        container.innerHTML = `
            <div class="flex items-start gap-3 bg-white p-3 rounded-lg border border-gray-100 shadow-sm transition-colors">
                <div class="flex items-center h-5 mt-0.5">
                    <input type="checkbox" id="prod-permit-retail" class="w-5 h-5 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500 cursor-pointer" checked>
                </div>
                <div class="text-sm flex-1">
                    <label for="prod-permit-retail" class="font-black text-gray-800 cursor-pointer select-none flex items-center gap-2">🛒 Available in POS (Retail)</label>
                    <p class="text-[10px] font-bold text-gray-500 mt-1 uppercase tracking-wide">Uncheck to hide raw materials from the billing screen.</p>
                </div>
            </div>
            <div class="flex items-start gap-3 bg-white p-3 rounded-lg border border-gray-100 shadow-sm transition-colors">
                <div class="flex items-center h-5 mt-0.5">
                    <input type="checkbox" id="prod-in-po-catalog" class="w-5 h-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer" checked>
                </div>
                <div class="text-sm flex-1">
                    <label for="prod-in-po-catalog" class="font-black text-gray-800 cursor-pointer select-none flex items-center gap-2">📦 Show in B2B Orders</label>
                    <p class="text-[10px] font-bold text-gray-500 mt-1 uppercase tracking-wide">Uncheck to hide from Purchase Order catalogs.</p>
                </div>
            </div>
        `;
        
        const btnRow = saveBtn.closest('div.flex') || saveBtn.parentElement;
        if (btnRow && form.contains(btnRow)) form.insertBefore(container, btnRow);
        else form.appendChild(container);

        // 🚀 AUTO-ROUTER: Hide raw materials from POS automatically
        if (!window._poCatalogListenerAttached) {
            document.body.addEventListener('change', (e) => {
                // Now targets the dropdown by its id/name
                if (e.target.id === 'productType' || e.target.name === 'productType') {
                    const permitRetail = document.getElementById('prod-permit-retail');
                    const inPo = document.getElementById('prod-in-po-catalog');
                    
                    if (e.target.value === 'raw_material') {
                        if (permitRetail) permitRetail.checked = false;
                        if (inPo) inPo.checked = true; 
                    } else if (e.target.value === 'non_gst') {
                        if (permitRetail) permitRetail.checked = true; 
                        if (inPo) inPo.checked = false;
                    } else {
                        if (permitRetail) permitRetail.checked = true;
                        if (inPo) inPo.checked = true;
                    }
                }
            });
            window._poCatalogListenerAttached = true;
        }
    }
}
// --- REPLACE IN src/components/inventory.js ---

function updateInventoryCountDisplay() {
    const countEl = document.getElementById('product-count-value');
    if (countEl) {
        const count = localProductsCache.length;
        let plan = (typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free') || 'free';
        
        if (plan === 'standard') plan = 'silver';
        if (plan === 'premium') plan = 'platinum';

        // 🚀 THE FIX: Safely fallback to Infinity if the plan dictionary is missing offline
        const planConfig = (typeof PLAN_LIMITS !== 'undefined' && PLAN_LIMITS[plan]) ? PLAN_LIMITS[plan] : { max_products: Infinity };
        const limitVal = planConfig.max_products || Infinity;
        const limitDisplay = limitVal === Infinity ? '∞' : limitVal;
        
        countEl.textContent = `${count} / ${limitDisplay}`;
        
        const container = document.getElementById('inventory-count-display');
        if (limitVal !== Infinity && count >= limitVal) {
            if (container) container.className = "bg-red-100 text-red-700 px-4 py-2 rounded-md border border-red-300 text-sm font-bold flex items-center whitespace-nowrap shadow-sm";
        } else {
             if (container) container.className = "bg-indigo-50 text-indigo-700 px-4 py-2 rounded-md border border-indigo-200 text-sm font-bold flex items-center whitespace-nowrap shadow-sm";
        }
        if (typeof setCurrentProductCount === 'function') setCurrentProductCount(count);
    }
}

// 🚀 THE FIX: Disable Multi-Location logic entirely by returning early
function injectLocationDropdown() {
    return; 
}

function injectLocationFilterDropdown() {
    return; 
}

// --- IMPORT CSV LOGIC ---

function openImportModal() {
    let modal = document.getElementById('bulk-import-modal');
    if (!modal) {
        const modalHtml = `
            <div id="bulk-import-modal" class="fixed inset-0 bg-gray-900 bg-opacity-50 hidden items-center justify-center p-4 z-[70]">
                <div class="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col relative ">
                    <button id="close-import-btn" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                    
                    
                    <h3 class="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
                        <svg class="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                        Bulk Import Products
                    </h3>
                    <p class="text-sm text-gray-500 mb-6">Upload an Excel/CSV file to quickly add multiple products to your inventory.</p>
                    
                    <div class="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-6">
                        <h4 class="font-bold text-indigo-800 text-sm mb-2">Step 1: Download Template</h4>
                        <p class="text-xs text-indigo-600 mb-3">Ensure your data matches our format. Download the template, fill it in, and save it as a .CSV file.</p>
                        <button id="download-template-btn" class="text-sm bg-white border border-indigo-200 text-indigo-700 font-bold py-1.5 px-4 rounded shadow-sm hover:bg-indigo-50 transition">Download Template</button>
                    </div>
                    
                    <div class="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:bg-gray-50 transition cursor-pointer" id="drop-zone-import">
                        <h4 class="font-bold text-gray-700 text-sm mb-1">Step 2: Upload CSV File</h4>
                        <p class="text-xs text-gray-400 mb-4">Drag and drop your file here, or click to browse.</p>
                        <input type="file" id="csv-file-input" accept=".csv" class="hidden" />
                        <button onclick="document.getElementById('csv-file-input').click()" class="bg-indigo-600 text-white text-sm font-bold py-2 px-6 rounded-lg shadow hover:bg-indigo-700 transition">Select File</button>
                        <p id="csv-file-name" class="text-xs text-green-600 font-bold mt-3 hidden"></p>
                    </div>
                    
                    <div class="mt-6 flex justify-end gap-3 border-t pt-4">
                        <button id="cancel-import-btn" class="px-5 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition">Cancel</button>
                        <button id="process-import-btn" disabled class="px-6 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-bold shadow-md transition flex items-center gap-2">
                            Upload Data
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        document.body.classList.add('overflow-hidden');
        
        modal = document.getElementById('bulk-import-modal');
        const closeMod = () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.classList.remove('overflow-hidden');
            document.getElementById('csv-file-input').value = '';
            document.getElementById('csv-file-name').classList.add('hidden');
            document.getElementById('process-import-btn').disabled = true;
            document.getElementById('process-import-btn').innerHTML = 'Upload Data';
        };

        document.getElementById('close-import-btn').onclick = closeMod;
        document.getElementById('cancel-import-btn').onclick = closeMod;
        document.getElementById('download-template-btn').onclick = downloadImportTemplate;
        
        const fileInput = document.getElementById('csv-file-input');
        const processBtn = document.getElementById('process-import-btn');
        const nameDisplay = document.getElementById('csv-file-name');

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                nameDisplay.textContent = `Selected: ${e.target.files[0].name}`;
                nameDisplay.classList.remove('hidden');
                processBtn.disabled = false;
            }
        });

        processBtn.onclick = () => processCSVUpload(fileInput.files[0], processBtn, closeMod);
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('overflow-hidden');
}

function downloadImportTemplate() {
    const headers = [
        "Product Name (Required)", 
        "SKU/Code (Required)", 
        "Barcode", 
        "Selling Price (Required)", 
        "Unit Cost (Required)", 
        "Opening Stock", 
        "Free Qty (FOC)", 
        "Low Stock Alert", 
        "Unit (e.g. units, kgs)", 
        "GST Slab % (e.g. 0, 5, 12, 18, 28)", 
        "Store Name", 
        "Store Phone"
    ];
    
    const sampleRow = [
        "Premium Coffee Beans", "COF-001", "8901234567890", "450.00", "280.00", "50", "5", "10", "units", "5", "Local Distributor", "9876543210"
    ];

    const csvContent = headers.join(",") + "\n" + sampleRow.map(v => `"${v}"`).join(",");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "Mifela_Import_Template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 🚀 THE UNIFIED SPREADSHEET ENGINE (Handles both .csv and .xlsx!)
window.handleSpreadsheetUpload = async function(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    
    if (typeof XLSX === 'undefined') {
        if(typeof showToast === 'function') showToast("Library Missing", "Please ensure you have an active internet connection to load the Excel parser.", "error");
        else alert("Please include the SheetJS library in your index.html to read Excel/CSV files.");
        return;
    }

    const modal = document.getElementById('import-choice-modal');
    if (modal) modal.remove();
    
    if(typeof showToast === 'function') showToast("Processing", "Reading spreadsheet...", "info");

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
            
            if (!jsonData || jsonData.length === 0) throw new Error("Spreadsheet is empty.");

            const formattedItems = [];
            let errors = 0;

            jsonData.forEach(row => {
            const getCol = (possibleNames, exclude = []) => {
                let key = Object.keys(row).find(k => possibleNames.some(p => k.trim().toLowerCase() === p.toLowerCase()));
                if (!key) {
                    key = Object.keys(row).find(k => 
                        possibleNames.some(p => k.toLowerCase().includes(p.toLowerCase())) &&
                        !exclude.some(e => k.toLowerCase().includes(e.toLowerCase()))
                    );
                }
                return key ? row[key] : "";
            };

            const name = getCol(["Product Name", "Item Name", "Name"]);
            const sku = getCol(["SKU", "Code"]);
            const price = parseFloat(getCol(["Selling Price", "MRP", "Price"]));
            
            // 🚀 THE FIX: Make cost mutable using 'let'
            let cost = parseFloat(getCol(["Unit Cost", "Cost", "Purchase Price"])) || 0;
            
            const paidStock = parseFloat(getCol(["Opening Stock", "Stock", "Qty", "Quantity", "Opening"])) || 0;
            const freeQty = parseFloat(getCol(["Free Qty", "Free", "FOC"])) || 0;
            const totalStock = paidStock + freeQty; 
            
            const gst = parseFloat(getCol(["GST", "Tax", "Slab"])) || 0;
            const cess = parseFloat(getCol(["Cess"])) || 0;
            const rawType = String(getCol(["Item Type", "Type", "Category"]) || "").toLowerCase();

            let itemType = 'standard';
            let permitRetail = true;
            let inPoCatalog = true;

            if (rawType.includes('raw')) {
                itemType = 'raw_material';
                permitRetail = false;
            } else if (rawType.includes('mfg') || rawType.includes('manufactured') || rawType.includes('home') || rawType.includes('finished')) {
                itemType = 'homemade';
                inPoCatalog = false;
            }
            
            if (!name || isNaN(price)) {
                errors++;
                return;
            }

            // ========================================================================
            // 🚀 THE FIX: Forward & Reverse Math Reconciliation Engine
            // ========================================================================
            const finalGst = itemType === 'homemade' ? 0 : gst;
            const finalCess = itemType === 'homemade' ? 0 : cess;
            const taxMultiplier = 1 + (finalGst / 100) + (finalCess / 100);
            
            let finalNetAmt = 0;
            let finalTaxableAmt = 0;
            let finalBaseRate = 0;
            
            const rawTotalVal = parseFloat(getCol(["Total Value", "Total Value (Auto)", "Net Amount", "Total"]));
            const calcQty = paidStock > 0 ? paidStock : 1;

            if (!isNaN(rawTotalVal) && rawTotalVal > 0) {
                // REVERSE MATH: User provided the final Total Value. Trust it completely to avoid mismatches.
                finalNetAmt = rawTotalVal;
                finalTaxableAmt = finalNetAmt / taxMultiplier;
                finalBaseRate = finalTaxableAmt / calcQty;
                cost = finalNetAmt / calcQty; // Align inclusive unit cost to match the total
            } else {
                // FORWARD MATH: Fallback to Unit Cost (Treated as Exclusive Base Rate)
                finalBaseRate = cost;
                finalTaxableAmt = finalBaseRate * paidStock;
                finalNetAmt = finalTaxableAmt * taxMultiplier;
                cost = finalNetAmt / calcQty; // Update to final inclusive cost for UI rendering
            }

            formattedItems.push({
                name: String(name),
                sku: String(sku || `SKU${Date.now().toString().slice(-5)}${Math.floor(Math.random()*1000)}`),
                barcode: String(getCol(["Barcode", "UPC", "EAN"]) || ""),
                price: price,
                cost: cost,
                mrp: parseFloat(getCol(["MRP"])) || price,
                
                stockLevel: totalStock, 
                freeQty: freeQty,       
                pieces: paidStock,      
                cases: 0,
                
                unit: String(getCol(["Unit", "UOM"], ["cost", "price"]) || "units"),
                
                baseRate: finalBaseRate, 
                netAmt: finalNetAmt, 
                taxableAmt: finalTaxableAmt,
                gstSlab: finalGst, 
                cess: finalCess,
                hsn: String(getCol(["HSN", "SAC"]) || ""),
                batch: String(getCol(["Batch"]) || ""),
                expirationDate: String(getCol(["Expiry Date", "Expiry", "Expiration", "Exp"]) || ""),
                dealerName: String(getCol(["Supplier Name", "Store Name", "Dealer Name", "Supplier", "Vendor"]) || ""),
                dealerPhone: String(getCol(["Supplier Phone", "Store Phone", "Dealer Phone", "Phone"]) || ""),
                dealerGstin: String(getCol(["Supplier GSTIN", "Dealer GSTIN", "GSTIN"]) || ""),
                supplierInvoice: String(getCol(["Supplier Invoice No", "Invoice No", "Bill No", "Invoice"]) || ""),
                type: itemType,
                inPoCatalog: inPoCatalog,
                permitRetail: permitRetail
            });
        });

            if (formattedItems.length === 0) throw new Error("No valid products found. Ensure 'Product Name' and 'Selling Price' columns are filled.");

            await processScannedBulkUpload(formattedItems);
            
            if (errors > 0) {
                if(typeof showToast === 'function') showToast("Import Warning", `Imported ${formattedItems.length} items. Skipped ${errors} invalid rows.`, "warning");
            } else {
                if(typeof showToast === 'function') showToast("Import Success", `Successfully imported ${formattedItems.length} items!`, "success");
            }
            
        } catch (err) {
            console.error(err);
            if(typeof showModal === 'function') showModal("Import Failed", err.message, "error");
            else alert(`Import Failed: ${err.message}`);
        }
    };
    reader.readAsArrayBuffer(file);
};


window.downloadSpreadsheetTemplate = function() {
    if (typeof XLSX === 'undefined') {
        alert("Library loading. Please ensure you are connected to the internet.");
        return; 
    }

    const headers = [
        "Product Name (Required)", "SKU/Code (Required)", "Barcode",
        "Item Type (Standard/Raw/Mfg)", "Selling Price (Required)", "Unit Cost (Required)", 
        "Opening Stock", "Free Qty (FOC)", "Low Stock Alert", "Unit (e.g. units, kgs)", 
        "GST Slab %", "Cess %", "HSN Code", "Batch Number", "Expiry Date (YYYY-MM-DD)", 
        "Supplier Name", "Supplier Phone", "Supplier GSTIN", "Supplier Invoice No",
        "Total Value (Auto)"
    ];

    const sampleRow = [
        "Premium Coffee Beans", "COF-001", "8901234567890", 
        "Standard", 450.00, 280.00, 
        50, 5, 10, "units", 
        5, 0, "0901", "B123", "2026-12-31", 
        "Local Distributor", "9876543210", "27XXXXX1234X1ZX", "INV-001",
        0
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);

    // Apply auto-calculation formula (Unit Cost * Opening Stock -> F2 * G2)
    ws['T2'] = { t: 'n', f: 'F2*G2' };

    const wscols = [ {wch: 25}, {wch: 20}, {wch: 15}, {wch: 22}, {wch: 15}, {wch: 15}, {wch: 15}, {wch: 15}, {wch: 15}, {wch: 15}, {wch: 12}, {wch: 10}, {wch: 12}, {wch: 15}, {wch: 22}, {wch: 20}, {wch: 15}, {wch: 18}, {wch: 18}, {wch: 20} ];
    ws['!cols'] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory Template");
    
    XLSX.writeFile(wb, "Mifela_Inventory_Template.xlsx");
};


// --- EXPIRED STOCK LOGIC ---

async function openExpiredStockModal() {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayTime = new Date(todayStr).getTime();
    const currencySymbol = getCurrencySymbol();
    
    const expiredBatchesList = [];

    localProductsCache.forEach(p => {
        if (p.batches && p.batches.length > 0) {
            p.batches.forEach((b, index) => {
                if (b.expirationDate && new Date(b.expirationDate).getTime() < todayTime && parseFloat(b.qty) > 0) {
                    expiredBatchesList.push({
                        productId: p.id,
                        productName: p.name,
                        batchIndex: index,
                        batchNo: b.batchNo || 'Legacy',
                        qty: parseFloat(b.qty),
                        cost: parseFloat(b.cost) || 0,
                        gstSlab: parseFloat(b.gstSlab) || parseFloat(p.gstSlab) || 0,
                        dealerId: b.dealerId || p.dealerId || '',
                        dealerName: b.dealerName || p.dealerName || '-',
                        expirationDate: b.expirationDate
                    });
                }
            });
        } else if (p.expirationDate && new Date(p.expirationDate).getTime() < todayTime && parseFloat(p.stockLevel) > 0) {
            expiredBatchesList.push({
                productId: p.id,
                productName: p.name,
                batchIndex: -1,
                batchNo: p.batch || 'Legacy',
                qty: parseFloat(p.stockLevel),
                cost: parseFloat(p.cost) || 0,
                gstSlab: parseFloat(p.gstSlab) || 0,
                dealerId: p.dealerId || '',
                dealerName: p.dealerName || '-',
                expirationDate: p.expirationDate
            });
        }
    });

    if (expiredBatchesList.length === 0) {
        showModal('Good News', 'No expired stock found in current view.', 'success');
        return;
    }

    let modal = document.getElementById('expired-stock-modal');

    // 🚀 THE FIX: If the sweeper killed it, revive it by completely removing it from the DOM before rebuilding
    if (modal && modal.style.display === 'none') {
        modal.remove();
        modal = null;
    }

    if (!modal) {
        const modalHtml = `
            <div id="expired-stock-modal" class="fixed inset-0 bg-slate-900/60 hidden items-center justify-center p-4 z-[300] " style="opacity: 1; pointer-events: auto;">
                <div class="bg-white p-6 rounded-[2rem] shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col relative border border-slate-100 ">
                    <div class="flex justify-between items-center mb-4 border-b border-slate-100 pb-4 shrink-0">
                        <h3 class="text-xl font-black text-red-700 flex items-center gap-3">
                            <span class="bg-red-100 text-red-600 p-2 rounded-xl shadow-sm"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg></span>
                            Expired Batch Quarantines
                        </h3>
                        <button id="close-expired-btn" class="text-slate-400 hover:text-red-600 transition p-2 bg-slate-50 rounded-full hover:bg-red-50 border border-slate-200 shadow-sm">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    <div class="overflow-y-auto flex-1 mb-4 custom-scrollbar border border-slate-200 rounded-2xl shadow-inner bg-slate-50/50">
                        <table class="w-full text-sm text-left table-fixed">
                            <thead class="bg-red-50 text-red-700 uppercase text-[10px] tracking-widest font-black sticky top-0 z-10 shadow-sm border-b border-red-100">
                                <tr>
                                    <th class="px-4 py-3 w-12 text-center"><input type="checkbox" id="select-all-expired" class="cursor-pointer w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500"></th>
                                    <th class="px-4 py-3 w-1/3">Product & Batch</th>
                                    <th class="px-4 py-3 text-center w-1/6">Expiry Date</th>
                                    <th class="px-4 py-3 text-center w-1/6">Dead Stock</th>
                                    <th class="px-4 py-3 text-right w-1/6">Unit Cost</th>
                                    <th class="px-4 py-3 text-right w-1/6">Supplier</th>
                                </tr>
                            </thead>
                            <tbody id="expired-list-body" class="divide-y divide-slate-100 bg-white"></tbody>
                        </table>
                    </div>
                    <div class="flex flex-col sm:flex-row justify-between items-center pt-4 border-t border-slate-100 bg-slate-50 p-4 rounded-2xl shrink-0 gap-4">
                        <div class="text-sm font-bold text-slate-600 flex items-center gap-3 w-full sm:w-auto">
                            Action:
                            <select id="expired-action-type" class="flex-1 sm:flex-none border-2 border-slate-200 rounded-xl p-2.5 text-slate-800 font-bold focus:border-red-500 outline-none cursor-pointer shadow-sm transition-colors bg-white">
                                <option value="scrap">Scrap (Write-off Loss)</option>
                                <option value="return">Return to Supplier (Refund)</option>
                            </select>
                        </div>
                        <button id="process-expired-btn" class="w-full sm:w-auto px-8 py-3 bg-red-600 text-white rounded-xl shadow-lg shadow-red-200 font-black hover:bg-red-700 transition active:scale-95 flex justify-center items-center gap-2 text-base">
                            Process Selected
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modal = document.getElementById('expired-stock-modal');
        
        document.getElementById('close-expired-btn').onclick = () => {
            // 🚀 THE FIX: Destructive close. Don't hide it, destroy it.
            modal.remove();
            document.body.classList.remove('overflow-hidden');
        };
        
        document.getElementById('select-all-expired').onchange = (e) => {
            document.querySelectorAll('.expired-item-check').forEach(cb => cb.checked = e.target.checked);
        };

        document.getElementById('process-expired-btn').onclick = processExpiredStock;
    }

    const tbody = document.getElementById('expired-list-body');
    tbody.innerHTML = '';
    
    expiredBatchesList.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-red-50/40 transition-colors";
        tr.innerHTML = `
            <td class="px-4 py-3 text-center"><input type="checkbox" class="expired-item-check cursor-pointer w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500" data-product-id="${item.productId}" data-batch-index="${item.batchIndex}" data-qty="${item.qty}" data-cost="${item.cost}" data-gst="${item.gstSlab}" data-dealer="${escapeHTML(item.dealerId)}"></td>
            <td class="px-4 py-3 font-bold text-slate-800 truncate">
                ${escapeHTML(item.productName)}<br>
                <span class="text-[9px] text-slate-500 uppercase tracking-widest bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 mt-1 inline-block">${escapeHTML(item.batchNo)}</span>
            </td>
            <td class="px-4 py-3 text-red-600 font-black text-center">${item.expirationDate}</td>
            <td class="px-4 py-3 text-center font-black text-indigo-700 text-lg">${item.qty}</td>
            <td class="px-4 py-3 text-right font-mono text-slate-600">${currencySymbol}${item.cost.toFixed(2)}</td>
            <td class="px-4 py-3 text-xs font-bold text-slate-500 truncate text-right">${escapeHTML(item.dealerName)}</td>
        `;
        tbody.appendChild(tr);
    });

    // Strip inline sweeper overrides and show
    modal.style.display = '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('overflow-hidden');
}

// Keep promptForRefundAmount exactly as it is in your current code
function promptForRefundAmount(defaultAmount) {
    return new Promise((resolve) => {
        const modalId = 'custom-refund-modal';
        const currencySymbol = getCurrencySymbol();
        const existing = document.getElementById(modalId);
        if (existing) existing.remove();

        const modalHtml = `
            <div id="${modalId}" class="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[400] p-4">
                <div class="bg-white p-6 rounded-2xl shadow-xl max-w-sm w-full">
                    <h3 class="text-xl font-black text-slate-800 mb-2">Enter Refund Amount</h3>
                    <p class="text-sm font-bold text-slate-500 mb-4 uppercase tracking-widest">Total value: ${currencySymbol}${defaultAmount}</p>
                    <input type="number" id="custom-refund-input" value="${defaultAmount}" class="w-full border-2 border-indigo-200 bg-indigo-50 p-3 rounded-xl mb-4 text-2xl font-black text-indigo-700 outline-none focus:border-indigo-500 transition-colors text-center" step="0.01" min="0">
                    <div class="flex justify-end gap-3">
                        <button id="custom-refund-cancel" class="px-5 py-2.5 bg-slate-100 rounded-xl text-slate-600 font-bold hover:bg-slate-200 transition-colors">Cancel</button>
                        <button id="custom-refund-confirm" class="px-6 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 font-bold shadow-md shadow-green-200 transition-colors">Confirm</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById(modalId);
        const input = document.getElementById('custom-refund-input');
        
        input.focus();
        input.select();

        const cleanup = () => { modal.remove(); };

        document.getElementById('custom-refund-cancel').onclick = () => { cleanup(); resolve(null); };
        document.getElementById('custom-refund-confirm').onclick = () => {
            const val = parseFloat(input.value);
            cleanup();
            resolve(isNaN(val) ? null : val);
        };
        input.onkeydown = (e) => {
            if (e.key === 'Enter') document.getElementById('custom-refund-confirm').click();
            if (e.key === 'Escape') document.getElementById('custom-refund-cancel').click();
        };
    });
}

async function processExpiredStock() {
    const selectedCheckboxes = document.querySelectorAll('.expired-item-check:checked');
    if (selectedCheckboxes.length === 0) {
        showModal('Error', 'No items selected.', 'error');
        return;
    }

    const action = document.getElementById('expired-action-type').value;
    let customRefundAmount = 0;
    let totalCostOfSelected = 0;
    const currencySymbol = getCurrencySymbol();
    const isMathReady = typeof safeMath?.multiply === 'function';

    selectedCheckboxes.forEach(cb => {
        const qty = secureFloat(cb.dataset.qty);
        const cost = secureFloat(cb.dataset.cost);
        const val = isMathReady ? safeMath.multiply(qty, cost) : (qty * cost);
        totalCostOfSelected = isMathReady ? safeMath.add(totalCostOfSelected, val) : (totalCostOfSelected + val);
    });

    if (action === 'return') {
        const result = await promptForRefundAmount(totalCostOfSelected.toFixed(2));
        if (result === null) return; 
        customRefundAmount = result;
    }

    // 🚀 THE FIX: Replaced native confirm() with HTML modal
    showModal('Confirm Action', `Process ${selectedCheckboxes.length} expired batches? This cannot be undone.`, 'confirm', async () => {
        const btn = document.getElementById('process-expired-btn');
        btn.disabled = true;
        btn.innerHTML = `<span class="animate-spin mr-2">⏳</span> Processing...`;
        
        const batch = writeBatch(db);
        const now = new Date();
        const productsRef = getProductsRef();

        const updatesByProduct = {};
        let totalQtyRemoved = 0;
        const itemsList = [];

        selectedCheckboxes.forEach(cb => {
            const pId = cb.dataset.productId;
            const bIndex = parseInt(cb.dataset.batchIndex);
            const qty = parseFloat(cb.dataset.qty);
            const cost = parseFloat(cb.dataset.cost) || 0;
            const gst = parseFloat(cb.dataset.gst) || 0;
            
            if (!updatesByProduct[pId]) updatesByProduct[pId] = [];
            updatesByProduct[pId].push({ bIndex, qty, cost, gst });
            
            const pName = localProductsCache.find(p => p.id === pId)?.name || 'Expired Item';

            itemsList.push({
                id: pId,
                name: `${pName} (Expired Scrap)`, 
                quantity: -qty, 
                cost: cost,
                price: 0,
                taxRate: gst
            });
            totalQtyRemoved += qty;
        });

        const todayTimeForWac = new Date().setHours(0, 0, 0, 0);

        for (const pId in updatesByProduct) {
            const prod = localProductsCache.find(p => p.id === pId);
            if (!prod) continue;
            
            let newBatches = prod.batches ? [...prod.batches] : [];
            let legacyStockWipe = false;

            updatesByProduct[pId].forEach(update => {
                if (update.bIndex >= 0 && newBatches[update.bIndex]) {
                    newBatches[update.bIndex].qty = 0; 
                } else if (update.bIndex === -1) {
                    legacyStockWipe = true;
                }
            });

            newBatches = newBatches.filter(b => parseFloat(b.qty) > 0);

            let totalActiveStockCalc = 0;
            let totalActiveVal = 0;
            
            newBatches.forEach(b => {
                const isExpired = b.expirationDate && new Date(b.expirationDate).getTime() < todayTimeForWac;
                if (!isExpired) {
                    const q = parseFloat(b.qty);
                    const safeCost = parseFloat(b.cost) || 0;
                    totalActiveStockCalc += q;
                    totalActiveVal += (q * safeCost);
                }
            });

            let newWac = prod.cost;
            if (totalActiveStockCalc > 0) newWac = totalActiveVal / totalActiveStockCalc;
            else newWac = 0;

            const updatePayload = {
                batches: newBatches,
                stockLevel: totalActiveStockCalc, 
                cost: newWac,
                updatedAt: serverTimestamp()
            };

            if (legacyStockWipe && totalActiveStockCalc === 0) {
                 updatePayload.stockLevel = 0;
                 updatePayload.cost = 0;
            }

            const productRef = doc(productsRef, pId);
            batch.set(productRef, updatePayload, { merge: true });
        }

        const transactionsRef = getTransactionsRef();
        const txRef = doc(transactionsRef); 
        
        let transactionTotal = 0;
        let transactionProfit = 0;
        const txLocationId = getNormalizedLoc(getCurrentLocationId());

        if (action === 'scrap') {
            transactionTotal = 0;
            transactionProfit = -totalCostOfSelected; 
        } else {
            transactionTotal = customRefundAmount; 
            transactionProfit = isMathReady ? safeMath.subtract(customRefundAmount, totalCostOfSelected) : (customRefundAmount - totalCostOfSelected);
        }

        batch.set(txRef, {
            invoiceId: `ADJ-${Date.now()}`,
            storeId: getStoreId(),
            locationId: txLocationId,
            timestamp: now,
            type: action === 'scrap' ? 'LOSS' : 'REFUND',
            summary: {
                total: transactionTotal, 
                profit: transactionProfit, 
                paymentMethod: 'ADJUSTMENT',
                reason: `Expired Stock - ${action.toUpperCase()}`,
                itemCount: totalQtyRemoved
            },
            items: itemsList,
            cashierId: getUserId(),
            currency: { code: getCurrencyCode(), symbol: currencySymbol }
        });

        try {
            await batch.commit();
            showModal('Success', 'Dead stock removed from active database.', 'success');
            
            document.getElementById('expired-stock-modal').classList.add('hidden');
            document.getElementById('expired-stock-modal').classList.remove('flex');
            document.body.classList.remove('overflow-hidden');
            
            renderInventoryTable(); 
            updateInventoryCountDisplay();
        } catch (e) {
            console.error("Batch clearance failed:", e);
            showModal('Error', 'Failed to process. Check your network.', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Process Selected';
        }
    });
}


// =========================================================
// 3. FORM SUBMISSION & VALIDATION
// =========================================================

function getFormData() {
    const i = DOM.inventory.inputs;
    const typeSelect = document.getElementById('productType');
    let productType = typeSelect ? typeSelect.value : 'standard';

const rawName = (i.name?.value || document.getElementById('prod-name')?.value || '').trim();
    if (!rawName) return { error: "Product Name is strictly mandatory." };

    const priceRaw = (i.price?.value || document.getElementById('price')?.value || '').trim();
    if (priceRaw === '') return { error: "Our Selling Price is strictly mandatory. Please enter a value." };

    const baseRateRaw = document.getElementById('prod-base-rate')?.value.trim() || '';
    if (baseRateRaw === '') return { error: "Base Rate is strictly mandatory. Please enter a value." };

    const piecesRaw = document.getElementById('prod-pieces')?.value.trim() || '';
    if (piecesRaw === '') return { error: "PCS (Loose) is strictly mandatory. Please enter a quantity (or 0)." };

    // 🚀 THE FIX: GST & HSN COMPLIANCE VALIDATOR
    if (productType === 'standard') {
        const hsnRaw = document.getElementById('prod-hsn')?.value.trim() || '';
        if (!hsnRaw) return { error: "HSN Code is mandatory for GST Products. Please fetch it via AI or enter it manually." };
        
        const gstinRaw = document.getElementById('prod-gstin')?.value.trim() || '';
        if (!gstinRaw || gstinRaw.length < 15) return { error: "A valid 15-character Supplier GSTIN is mandatory for standard GST items." };

        const invoiceRaw = document.getElementById('prod-invoice')?.value.trim() || '';
        if (!invoiceRaw) return { error: "Supplier Invoice No. is mandatory to track GST inward supply." };
        
        const stateRaw = document.getElementById('prod-dealer-state')?.value.trim() || '';
        if (!stateRaw) return { error: "Supplier State is mandatory to determine IGST vs CGST/SGST." };
    }
    // ========================================================================

    // STRICT RADIX AND FLOAT PARSING
    const safeFloat = (id) => secureFloat(document.getElementById(id)?.value);
    const safeInt = (id) => secureInt(document.getElementById(id)?.value);
    const safeStr = (id) => document.getElementById(id)?.value?.trim() || '';

    const formattedName = typeof capitalizeName === 'function' 
        ? capitalizeName(rawName) 
        : rawName.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
    let lowStock = parseInt(i.lowStock?.value, 10);
    if (isNaN(lowStock) || lowStock < 0) lowStock = 10;
    
    let gst = secureFloat(i.gst ? i.gst.value : 0);
    if (gst < 0) gst = 0;

    let cess = secureFloat(i.cess ? i.cess.value : 0);
    if (cess < 0) cess = 0;

    const stock = secureFloat(i.stock?.value);
    const price = secureFloat(i.price?.value);
    
    // 🚀 THE FIX: Calculate Cost dynamically in the background!
    // (This allows you to safely delete the "Final Unit Cost" HTML element entirely if you want)
    const netAmtCalc = safeFloat('prod-net-amt');
    const casesCalc = safeInt('prod-cases');
    const upcCalc = safeInt('prod-upc') || 1;
    const pcsCalc = safeInt('prod-pieces');
    const freeCalc = safeInt('prod-free-qty');
    const totalPhysicalQty = (casesCalc * upcCalc) + pcsCalc + freeCalc;
    
    const cost = totalPhysicalQty > 0 ? (netAmtCalc / totalPhysicalQty) : secureFloat(i.cost?.value);

    if (!formattedName) return null;
    if (stock < 0) return { error: "Invalid Stock Level" };
    if (price < 0) return { error: "Invalid Selling Price" };
    if (cost < 0) return { error: "Invalid Final Unit Cost" };

    // 5. Target Location Setup
    const role = typeof getUserRole === 'function' ? getUserRole() : 'manager';
    const canAccessAllLocations = (role === 'admin' || role === 'accountant') ;
    
    const assignedLoc = typeof getUserAssignedLocationId === 'function' ? getUserAssignedLocationId() : 'main';
    let safeLocation = typeof getNormalizedLoc === 'function' ? getNormalizedLoc(assignedLoc) : 'main'; 

    if (canAccessAllLocations) {
        const locDropdown = document.getElementById('inv-form-location');
        if (locDropdown && locDropdown.value) {
            safeLocation = typeof getNormalizedLoc === 'function' ? getNormalizedLoc(locDropdown.value) : locDropdown.value;
        }
    }

    // 6. Discount & Math Conversions
    const casesForMath = safeInt('prod-cases');
    const piecesForMath = safeInt('prod-pieces');
    const upcForMath = safeInt('prod-upc') || 1;
    const totalQtyForMath = (casesForMath * upcForMath) + piecesForMath;
    const calcQtyForMath = totalQtyForMath > 0 ? totalQtyForMath : 1;
    
    const baseRateForMath = safeFloat('prod-base-rate');
    const lineTotalBeforeDisc = baseRateForMath * calcQtyForMath;

    const isSchPercent = document.getElementById('prod-sch-disc-type-toggle')?.checked || false;
    const finalSchDisc = isSchPercent ? lineTotalBeforeDisc * (safeFloat('prod-sch-disc') / 100) : safeFloat('prod-sch-disc');

    const isRsPercent = document.getElementById('prod-rs-disc-type-toggle')?.checked || false;
    const finalRsDisc = isRsPercent ? lineTotalBeforeDisc * (safeFloat('prod-rs-disc') / 100) : safeFloat('prod-rs-disc');

    // 7. Base Data Object Construction
    const d = {
        name: formattedName,
        sku: i.sku?.value.trim() || '',
        barcode: i.barcode?.value.trim() || '',
        price: price,
        cost: cost, 
        stockLevel: stock,
        lowStockThreshold: lowStock,
        unit: i.unit ? i.unit.value : 'units', 
        type: productType,
        bundleComponents: productType === 'bundle' ? (typeof bundleComponents !== 'undefined' ? bundleComponents : []) : [],
        
        sl: safeStr('prod-sl'),
        hsn: safeStr('prod-hsn'),
        batch: safeStr('prod-batch'),
        upc: safeInt('prod-upc') || 1, 
        
        baseRate: baseRateForMath, 
        mrp: safeFloat('prod-mrp'),
        schDisc: finalSchDisc,  
        rsDisc: finalRsDisc,    

        // 🚀 NEW: EXACT UI STATE MEMORY FOR FLAWLESS RETRIEVAL
        rawSchDisc: safeFloat('prod-sch-disc'),
        isSchPercent: isSchPercent,
        rawRsDisc: safeFloat('prod-rs-disc'),
        isRsPercent: isRsPercent,
        isTaxInclusive: document.getElementById('tax-inclusive-toggle')?.checked || false,
        
        taxableAmt: safeFloat('prod-taxable-amt'),
        cgstAmt: safeFloat('prod-cgst'),
        sgstAmt: safeFloat('prod-sgst'),
        netAmt: safeFloat('prod-net-amt'),
        
        cases: safeInt('prod-cases'),
        pieces: safeInt('prod-pieces'),
        freeQty: safeInt('prod-free-qty'), 

        packagedDate: i.packaged?.value || document.getElementById('packagedDate')?.value || null,
        expirationDate: document.getElementById('expirationDate')?.value || null,
        bestBeforeMonths: i.bestBefore ? parseInt(i.bestBefore.value) : 0,
        gstSlab: gst,
        cess: cess,
        
        purchaseDate: safeStr('prod-date'),
        locationId: safeLocation, 
        inPoCatalog: document.getElementById('prod-in-po-catalog')?.checked ?? true,
        permitRetail: document.getElementById('prod-permit-retail')?.checked ?? true
    };

    // 8. Role / Type Specific Bypass & Validation
    if (productType === 'bundle') {
        // Bundles don't need external suppliers
        d.dealerName = 'Internal Bundle';
        d.dealerPhone = '';
        d.dealerId = 'BUNDLE_INTERNAL';
        d.paymentMethod = 'SYSTEM';
        d.chequeDetails = null;
    } 
    else if (productType === 'homemade' || productType === 'manufactured' || productType === 'non_gst' || productType === 'raw_material') {
        // 🚀 THE FIX: Non-GST / Homemade / Local items. Make dealer optional, no strict validation.
        let dealerName = i.dealer ? i.dealer.value.trim() : '';
        let dealerPhone = safeStr('prod-dealer-phone');
        let gstinVal = safeStr('prod-gstin'); 
        let dealerState = safeStr('prod-dealer-state'); // 🚀 NEW: Grab State
        
        if (!dealerName) {
            return { error: "Dealer / Store Name is strictly mandatory to track inventory sourcing." };
        }
        
        d.dealerName = dealerName || 'Local / Homemade';
        d.dealerPhone = dealerPhone || '';
        d.dealerId = safeStr('prod-dealer-id') || 'INTERNAL_MFG';
        d.gstin = gstinVal;
        d.dealerPan = safeStr('prod-dealer-pan').toUpperCase();
        d.supplierInvoice = safeStr('prod-invoice');
        d.dealerState = dealerState; // 🚀 Passes to the DB
        d.cess = 0;
        
        const paymentMethod = safeStr('prod-payment-method') || 'CASH';
        d.paymentMethod = paymentMethod;
        
        if (paymentMethod === 'CHEQUE') {
            const bank = safeStr('prod-cheque-bank');
            const chequeNo = safeStr('prod-cheque-no');
            const clearanceDate = safeStr('prod-cheque-date');
            d.chequeDetails = { bank, chequeNo, clearanceDate, status: 'PENDING' };
        } else {
            d.chequeDetails = null;
        }
        
        // Blank out strict compliance fields
        d.gstin = '';
        d.dealerPan = '';
        d.supplierInvoice = '';
    } 
    else {
        // Standard & Raw Material: Supplier Validation IS Strictly Required
        let dealerName = i.dealer ? i.dealer.value.trim() : '';
        let dealerPhone = safeStr('prod-dealer-phone');
        let gstinVal = safeStr('prod-gstin'); // 🚀 NEW: Grab GSTIN
        let dealerState = safeStr('prod-dealer-state'); // 🚀 NEW: Grab State

        if (!dealerName) {
            return { error: "Dealer / Store Name is strictly mandatory to track inventory sourcing." };
        }
        
        const phoneDigits = dealerPhone.replace(/\D/g, '');
        if (!dealerPhone || phoneDigits.length < 10) {
            return { error: "A valid 10-digit Dealer Phone Number is strictly mandatory." };
        }

        // 🚀 NEW: Strict GSTIN enforcement
        if (!gstinVal || gstinVal.length < 15) {
            return { error: "A valid 15-character Supplier GSTIN is strictly mandatory for standard GST products." };
        }
        
        d.dealerName = dealerName;
        d.dealerPhone = dealerPhone;
        d.dealerId = safeStr('prod-dealer-id');
        d.gstin = gstinVal;
        d.dealerPan = safeStr('prod-dealer-pan').toUpperCase();
        d.supplierInvoice = safeStr('prod-invoice');

        const paymentMethod = safeStr('prod-payment-method') || 'CASH';
        d.paymentMethod = paymentMethod;
        
        if (paymentMethod === 'CHEQUE') {
            const bank = safeStr('prod-cheque-bank');
            const chequeNo = safeStr('prod-cheque-no');
            const clearanceDate = safeStr('prod-cheque-date');
            
            if (!bank || !chequeNo || !clearanceDate) {
                return { error: "Bank Name, Cheque Number, and Clearance Date are mandatory for Cheque payments." };
            }
            d.chequeDetails = { bank, chequeNo, clearanceDate, status: 'PENDING' };
        } else {
            d.chequeDetails = null;
        }
    }

    // 🚀 THE CRITICAL FIX: Scrub all 'undefined' values into 'null' to prevent Firebase crashes
    Object.keys(d).forEach(key => {
        if (d[key] === undefined) {
            d[key] = null;
        }
    });

    return d;
}


export async function handleProductSubmit(e) {
    e.preventDefault();
    let currentEditingId = getEditingProductId(); 
    const currentUserPlan = getCurrentUserPlan();

    if(DOM.inventory.saveBtn) { 
        DOM.inventory.saveBtn.disabled = true; 
        DOM.inventory.saveBtn.textContent = 'Checking...'; 
    }

    try {
        const data = getFormData(); 
        if (!data || data.error) {
            showModal('Error', data?.error || 'Please fill all required fields.', 'message');
            if(DOM.inventory.saveBtn) { DOM.inventory.saveBtn.disabled = false; DOM.inventory.saveBtn.textContent = 'Save Product'; }
            return;
        }

        // ====================================================================
        // 🚀 DUPLICATE INVOICE ITEM ALERT (PRE-CHECK)
        // ====================================================================
        if (data.supplierInvoice && !currentEditingId) {
            const transactionsRef = getTransactionsRef();
            const qTxSupp = query(transactionsRef, where('supplierInvoice', '==', data.supplierInvoice), limit(1));
            const txSnap = await getDocs(qTxSupp);
            
            if (!txSnap.empty) {
                const existingInvoice = txSnap.docs[0].data();
                const isProductAlreadyInInvoice = existingInvoice.items?.some(item => 
                    (item.name || '').trim().toLowerCase() === data.name.trim().toLowerCase() || 
                    (item.sku && data.sku && item.sku === data.sku)
                );

                if (isProductAlreadyInInvoice) {
                    const confirmAdd = confirm(`⚠️ Duplicate Item in Invoice!\n\n"${data.name}" has already been added to Supplier Invoice "${data.supplierInvoice}".\n\nClick OK if you intentionally want to ADD this as a separate batch, or Cancel to stop and edit the existing entry.`);
                    
                    if (!confirmAdd) {
                        if(DOM.inventory.saveBtn) { 
                            DOM.inventory.saveBtn.disabled = false; 
                            DOM.inventory.saveBtn.textContent = 'Save Product'; 
                        }
                        return; // Stop the save process entirely
                    }
                }
            }
        }
        
        if (!currentEditingId && data.type !== 'bundle') {
            const match = localProductsCache.find(p => {
                const sameLocation = getNormalizedLoc(p.locationId) === getNormalizedLoc(data.locationId);
                const sameName = (p.name || '').trim().toLowerCase() === (data.name || '').trim().toLowerCase();
                const sameDealer = (p.dealerName || '').trim().toLowerCase() === (data.dealerName || '').trim().toLowerCase();
                return sameLocation && sameName && sameDealer;
            });

            if (match) {
                currentEditingId = match.id; // Hijack the ID
                const incomingStock = parseFloat(data.stockLevel) || 0;
                const oldStock = parseFloat(match.stockLevel || 0);
                
                data.stockLevel = oldStock + incomingStock; 
                data.sku = match.sku; 
                if (!data.barcode || data.barcode === data.sku) data.barcode = match.barcode;
                
                if (typeof showToast === 'function') showToast("Auto-Merged!", `Stacked into existing product: ${match.name}`, "success");
            }
        }

        const newSku = data.sku;
        const newBarcode = data.barcode;

        if (!newSku) { 
            showModal('Error', 'SKU required', 'message'); 
            if(DOM.inventory.saveBtn) { DOM.inventory.saveBtn.disabled = false; DOM.inventory.saveBtn.textContent = 'Save Product'; }
            return; 
        }
        
        // ====================================================================
        // 🚀 THE INVENTORY GUARD
        // ====================================================================
        if (!currentEditingId) {
            // 🚀 THE FIX: Define 'plan' before attempting to check it!
            const currentPlanStr = typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free';
            const plan = (currentPlanStr || 'free').toLowerCase();
            
            

            try {
                // We use our offline getCountFromServer mock here
                const snapshot = await getCountFromServer(getProductsRef());
                const currentCount = snapshot.data().count;

                if (currentCount >= skuLimit) {
                    showModal('SKU Limit Reached', `Your current plan allows up to ${skuLimit} products. You currently have ${currentCount}.`, 'warning');
                    if(DOM.inventory.saveBtn) { 
                        DOM.inventory.saveBtn.disabled = false; 
                        DOM.inventory.saveBtn.textContent = 'Save Product'; 
                    }
                    return; 
                }
            } catch (error) {
                console.error("Failed to verify product count:", error);
            }
        }

        if (!currentEditingId) {
            const duplicate = localProductsCache.find(p => {
                const sameLocation = getNormalizedLoc(p.locationId) === getNormalizedLoc(data.locationId);
                const sameIdentity = p.sku === newSku || (newBarcode && p.barcode === newBarcode);
                return sameLocation && sameIdentity;
            });

            if (duplicate) {
                 showModal('Error', `Duplicate SKU/Barcode found in this location (${data.locationId}).\nProduct: ${escapeHTML(duplicate.name)}`, 'error');
                 if(DOM.inventory.saveBtn) { DOM.inventory.saveBtn.disabled = false; DOM.inventory.saveBtn.textContent = 'Save Product'; }
                 return;
            }
        }

        if (data.dealerId && data.dealerPhone) {
            // 🚀 THE FIX: Normalize both phone numbers before comparing to safely ignore +91 prefixes
            const normalizePhoneForCompare = (ph) => {
                let p = String(ph || '').replace(/\D/g, '');
                if (p.startsWith('91') && p.length > 10) p = p.substring(2);
                return p.slice(-10);
            };

            const incomingPhone = normalizePhoneForCompare(data.dealerPhone);

            const localConflict = localDealersCache.find(d => {
                if (d.id !== data.dealerId) return false;
                const cachedPhone = normalizePhoneForCompare(d.phone);
                // Flag conflict ONLY if both exist but do not match
                return incomingPhone && cachedPhone && incomingPhone !== cachedPhone;
            });
            
            if (localConflict) {
               showModal('Mismatch Error', `The Store ID and Phone Number do not match our local records for <b>${escapeHTML(localConflict.name)}</b>.<br>ID: ${localConflict.id}<br>Phone: ${localConflict.phone}<br><br><i>To update the phone number, please go to Settings > Directory.</i>`, 'error');
               if(DOM.inventory.saveBtn) { DOM.inventory.saveBtn.disabled = false; DOM.inventory.saveBtn.textContent = 'Save Product'; }
               return;
            }
        }

        const typeSelect = document.getElementById('productType');
        let productType = typeSelect ? typeSelect.value : 'standard';

        if (productType === 'bundle' && bundleComponents.length === 0) {
            showModal('Error', "A bundle must have at least one component.", 'error');
            if(DOM.inventory.saveBtn) { DOM.inventory.saveBtn.disabled = false; DOM.inventory.saveBtn.textContent = 'Save Product'; }
            return;
        }
        
        data.type = productType;
        data.bundleComponents = productType === 'bundle' ? bundleComponents : [];

        if (!currentEditingId) data.createdAt = new Date().toISOString();
        data.updatedAt = serverTimestamp();
        
        if (data.dealerId) {
            const dealerInfo = localDealersCache.find(d => d.id === data.dealerId);
            if (dealerInfo) {
                data.dealerAddress = dealerInfo.address || '';
                data.dealerEmail = dealerInfo.email || '';
                data.dealerCity = dealerInfo.city || '';
                if (!data.dealerName) data.dealerName = dealerInfo.name;
                if (!data.dealerPhone) data.dealerPhone = dealerInfo.phone;
                if (!data.gstin) data.gstin = dealerInfo.gstin;
                if (!data.dealerPan) data.dealerPan = dealerInfo.pan || '';
            }
        }

        const batch = writeBatch(db);
        const customersRef = getCustomersRef();

        const isInternalPlaceholder = data.dealerId === 'INTERNAL_MFG' || data.dealerName === 'Internal Manufacturing' || data.dealerName === 'Local / Homemade';
        
        if (data.type !== 'bundle' && data.type !== 'homemade' && data.dealerName && customersRef) {
            let rawPhone = data.dealerPhone ? String(data.dealerPhone).replace(/\D/g, '') : '';
            
            if (rawPhone.length >= 10) {
                let normalizedPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
                let hash = 0x811c9dc5;
                for (let i = 0; i < normalizedPhone.length; i++) {
                    hash ^= normalizedPhone.charCodeAt(i);
                    hash = (hash * 0x01000193) >>> 0;
                }
                const generatedId = `MERCH-${hash.toString(36).toUpperCase().padStart(6, '0')}`;
                
                // 🚀 B2B / D2C Strict Tagging
                data.dealerId = data.dealerId || generatedId;
                const isB2B = data.gstin && data.gstin.trim().length >= 15;
                const tradeType = isB2B ? 'B2B' : 'D2C';
                
                const dealerRef = doc(customersRef, data.dealerId);
                batch.set(dealerRef, {
                    id: data.dealerId,
                    name: data.dealerName, 
                    type: 'dealer',
                    tradeType: tradeType,
                    phone: `+${normalizedPhone}`,
                    gstin: data.gstin || '',
                    pan: data.dealerPan || '',      
                    state: data.dealerState || '', // 🚀 Captures newly typed State
                    locationId: data.locationId, 
                    updatedAt: serverTimestamp()
                }, { merge: true }); 

                const currentAppId = typeof window !== 'undefined' && window.__app_id ? window.__app_id : appId;
                const globalDirRef = doc(db, `artifacts/${currentAppId}/directory_merchants/${data.dealerId}`);
                batch.set(globalDirRef, {
                    merchantId: data.dealerId,
                    name: data.dealerName, 
                    storeName: data.dealerName,
                    type: 'dealer',
                    tradeType: tradeType,
                    phone: `+${normalizedPhone}`,
                    gstin: data.gstin || '',
                    pan: data.dealerPan || '',      
                    state: data.dealerState || '', // 🚀 Captures newly typed State Globally
                    updatedAt: serverTimestamp()
                }, { merge: true });

            } else if (!data.dealerId) {
                data.dealerId = `DUMMY-MERCH-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random()*1000)}`;
            }
        }

        const productsRef = getProductsRef();
        const transactionsRef = getTransactionsRef();
        const isMathReady = typeof safeMath?.multiply === 'function';

        const processTransactionGrouping = async (itemQuantity, docIdToLog, isEditMode) => {
            if (itemQuantity <= 0) return;
            const totalCost = isMathReady ? safeMath.multiply(itemQuantity, data.cost) : (itemQuantity * data.cost);
            
            const newItemObj = {
                id: docIdToLog,
                name: data.name,
                sku: data.sku,
                quantity: itemQuantity,
                cost: data.cost,
                price: data.price,
                taxRate: data.gstSlab || 0,
                cessRate: data.cess || 0,
                isOms: (data.gstin && String(data.gstin).substring(0, 2) !== '27') 
            };

            let txGrouped = false;
            let txSnap = null;

            if (data.sl) {
                const qTx = query(transactionsRef, where('invoiceId', '==', data.sl), limit(1));
                txSnap = await getDocs(qTx);
            }

            if ((!txSnap || txSnap.empty) && data.supplierInvoice) {
                const qTxSupp = query(transactionsRef, where('supplierInvoice', '==', data.supplierInvoice), limit(1));
                txSnap = await getDocs(qTxSupp);
            }

            if (txSnap && !txSnap.empty) {
                const existingTxDoc = txSnap.docs[0];
                const txRef = doc(transactionsRef, existingTxDoc.id);
                const existingData = existingTxDoc.data();
                
                batch.update(txRef, {
                    items: [...(existingData.items || []), newItemObj],
                    'summary.total': (existingData.summary?.total || 0) - totalCost,
                    'summary.itemCount': (existingData.summary?.itemCount || 0) + itemQuantity,
                    timestamp: new Date()
                });
                txGrouped = true;
            }

            if (!txGrouped) {
                const purchaseTxRef = doc(transactionsRef);
                const finalInvoiceId = data.sl ? data.sl : (data.supplierInvoice ? `SUPP-${data.supplierInvoice}` : `PUR-${Date.now()}`);
                const storeId = getStoreId();
                const userId = getUserId();
                const currencyCode = getCurrencyCode();
                const currencySymbol = getCurrencySymbol();

                batch.set(purchaseTxRef, {
                    invoiceId: finalInvoiceId,
                    supplierInvoice: data.supplierInvoice || '',
                    storeId: storeId,
                    locationId: data.locationId, 
                    timestamp: new Date(),
                    type: 'PURCHASE',
                    customer: {
                        id: data.dealerId || 'unknown_dealer',
                        name: data.dealerName || (isEditMode ? 'Stock Update' : 'Initial Stock'),
                        gstin: data.gstin || '',
                        state: data.gstin ? String(data.gstin).substring(0, 2) : ''
                    },
                    summary: {
                        total: -totalCost, 
                        profit: 0, 
                        paymentMethod: data.paymentMethod || 'CASH', 
                        chequeDetails: data.chequeDetails || null,
                        reason: isEditMode ? 'Stock Update (Edit Form)' : 'Initial Stock',
                        itemCount: itemQuantity
                    },
                    items: [newItemObj],
                    cashierId: userId,
                    currency: { code: currencyCode, symbol: currencySymbol }
                });
            }
        };

        if (currentEditingId) {
            const docRef = doc(productsRef, currentEditingId);
            const { locationId, stockLevel, ...updateFields } = data; 
            
            const oldProduct = localProductsCache.find(p => p.id === currentEditingId);
            const oldStock = oldProduct ? parseFloat(oldProduct.stockLevel || 0) : 0;
            const newStock = parseFloat(data.stockLevel);
            const stockDiff = newStock - oldStock;

            const finalUpdateData = { ...updateFields };
        const editingBatchIndex = document.getElementById('stockLevel')?.dataset?.editingBatchIndex;
        
        let currentBatches = oldProduct ? (oldProduct.batches ? [...oldProduct.batches] : []) : [];
        // 🚀 BUGFIX: DO NOT SORT HERE! 'editingBatchIndex' targets the exact index of the UNSORTED array.
        
        if (currentBatches.length === 0 && oldStock > 0) {
            currentBatches.push({
                    batchNo: 'LEGACY-STOCK',
                    date: oldProduct.purchaseDate || (oldProduct.createdAt ? oldProduct.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]),
                    qty: oldStock,
                    cost: parseFloat(oldProduct.cost) || 0,
                    expirationDate: oldProduct.expirationDate || '',
                    packagedDate: oldProduct.packagedDate || '',
                    timestamp: oldProduct.createdAt ? new Date(oldProduct.createdAt).getTime() : new Date().getTime(),
                    
                    // 🚀 THE FIX: Permanently save root context into the DB batch
                    supplierId: oldProduct.dealerId || 'Manual/Mfg',
                    dealerId: oldProduct.dealerId || '',
                    dealerName: oldProduct.dealerName || '',
                    dealerPhone: oldProduct.dealerPhone || '',
                    dealerGstin: oldProduct.gstin || '',
                    dealerPan: oldProduct.dealerPan || '',
                    supplierInvoice: oldProduct.supplierInvoice || '',
                    baseRate: oldProduct.baseRate || 0,
                    gstSlab: oldProduct.gstSlab || 0,
                    cess: oldProduct.cess || 0,
                    schDisc: oldProduct.schDisc || 0,
                    rsDisc: oldProduct.rsDisc || 0,
                    taxableAmt: oldProduct.taxableAmt || 0,
                    netAmt: oldProduct.netAmt || 0
                });
            }

            if (editingBatchIndex !== undefined && currentBatches[editingBatchIndex]) {
                const targetBatch = currentBatches[editingBatchIndex];
                const oldBatchQty = parseFloat(targetBatch.qty) || 0;
                const newBatchQty = (parseInt(data.cases) * parseInt(data.upc)) + parseInt(data.pieces) + parseInt(data.freeQty);
                
                targetBatch.qty = newBatchQty;
                targetBatch.cost = parseFloat(data.cost) || 0;
                targetBatch.price = parseFloat(data.price) || 0; // 🚀 ADDED
                targetBatch.mrp = parseFloat(data.mrp) || 0;     // 🚀 ADDED
                targetBatch.baseRate = parseFloat(data.baseRate) || 0;
                targetBatch.gstSlab = parseFloat(data.gstSlab) || 0;
                targetBatch.cess = parseFloat(data.cess) || 0;
                targetBatch.schDisc = parseFloat(data.schDisc) || 0;
                targetBatch.rsDisc = parseFloat(data.rsDisc) || 0;
                
                targetBatch.rawSchDisc = data.rawSchDisc || 0;
                targetBatch.isSchPercent = data.isSchPercent || false;
                targetBatch.rawRsDisc = data.rawRsDisc || 0;
                targetBatch.isRsPercent = data.isRsPercent || false;
                targetBatch.isTaxInclusive = data.isTaxInclusive || false;

                targetBatch.taxableAmt = parseFloat(data.taxableAmt) || 0;
                targetBatch.netAmt = parseFloat(data.netAmt) || 0;
                targetBatch.cases = parseInt(data.cases) || 0;
                targetBatch.pieces = parseInt(data.pieces) || 0;
                targetBatch.freeQty = parseInt(data.freeQty) || 0;
                targetBatch.upc = parseInt(data.upc) || 1;
                targetBatch.unit = data.unit || 'units';
                targetBatch.batchNo = data.batch || '';
                targetBatch.expirationDate = data.expirationDate || null;
                targetBatch.packagedDate = data.packagedDate || null; 
                targetBatch.date = data.purchaseDate || '';
                targetBatch.sl = data.sl || ''; // 🚀 Invoice Serial
                
                // Update Supplier Context accurately for edited batch
                targetBatch.supplierId = data.dealerId || '';
                targetBatch.dealerId = data.dealerId || '';
                targetBatch.dealerName = data.dealerName || '';
                targetBatch.dealerPhone = data.dealerPhone || '';
                targetBatch.dealerGstin = data.gstin || '';
                targetBatch.dealerPan = data.dealerPan || '';
                targetBatch.dealerState = data.dealerState || ''; // 🚀 State
                targetBatch.supplierInvoice = data.supplierInvoice || '';

                currentBatches = currentBatches.filter(b => parseFloat(b.qty) > 0);
                
                currentBatches = sortBatchesFefoFifo(currentBatches);
                
                const todayStrForWac = new Date().toISOString().split('T')[0];
                const todayTimeForWac = new Date(todayStrForWac).getTime();

                let totalActiveStockCalc = 0;
                let totalActiveVal = 0;
                
                currentBatches.forEach(b => {
                    const isExpired = b.expirationDate && new Date(b.expirationDate).getTime() < todayTimeForWac;
                    
                    if (!isExpired) {
                        const q = parseFloat(b.qty);
                        totalActiveStockCalc += q;
                        totalActiveVal += (q * parseFloat(b.cost));
                    }
                });
                
                finalUpdateData.stockLevel = increment(stockDiff); 
                finalUpdateData.cost = totalActiveStockCalc > 0 ? (totalActiveVal / totalActiveStockCalc) : 0;
                finalUpdateData.batches = currentBatches;
                
                const diff = newBatchQty - oldBatchQty;
                if (diff !== 0) {
                    await processTransactionGrouping(Math.abs(diff), currentEditingId, true);
                }
                
                delete document.getElementById('stockLevel').dataset.editingBatchIndex;
                logInventoryChange('UPDATE', data.name, `Updated Batch ${targetBatch.batchNo}.`);
                
            } else if (stockDiff !== 0) {
                finalUpdateData.stockLevel = increment(stockDiff);
                currentBatches = sortBatchesFefoFifo(currentBatches);
                
                if (stockDiff > 0) {
                    currentBatches.push({
                        batchNo: data.batch || `B-${Date.now().toString().slice(-6)}`,
                        date: data.purchaseDate || new Date().toISOString().split('T')[0],
                        qty: stockDiff, // (or data.stockLevel for the initial batch)
                        cost: data.cost, 
                        price: data.price, // 🚀 ADDED
                        mrp: data.mrp,     // 🚀 ADDED
                        supplierId: data.dealerId || 'Manual/Mfg',
                        expirationDate: data.expirationDate || '',
                        packagedDate: data.packagedDate || null, 
                        timestamp: new Date().getTime(),
                        baseRate: data.baseRate || 0,
                        gstSlab: data.gstSlab || 0,
                        cess: data.cess || 0,
                        sl: data.sl || '', // 🚀 ADDED
                        schDisc: data.schDisc || 0,
                        rsDisc: data.rsDisc || 0,
                        
                        rawSchDisc: data.rawSchDisc || 0,
                        isSchPercent: data.isSchPercent || false,
                        rawRsDisc: data.rawRsDisc || 0,
                        isRsPercent: data.isRsPercent || false,
                        isTaxInclusive: data.isTaxInclusive || false,

                        taxableAmt: data.taxableAmt || 0,
                        netAmt: data.netAmt || 0,
                        cases: data.cases || 0,
                        pieces: data.pieces || 0,
                        freeQty: data.freeQty || 0,
                        upc: data.upc || 1,
                        unit: data.unit || 'units',
                        
                        dealerId: data.dealerId || '',
                        dealerName: data.dealerName || '',
                        dealerPhone: data.dealerPhone || '',
                        dealerGstin: data.gstin || '',
                        dealerPan: data.dealerPan || '',
                        dealerState: data.dealerState || '', // 🚀 ADDED
                        supplierInvoice: data.supplierInvoice || ''
                    });
                } else if (stockDiff < 0) {
                    let qtyToRemove = Math.abs(stockDiff);
                    for (let i = 0; i < currentBatches.length; i++) {
                        if (qtyToRemove <= 0) break;
                        if (currentBatches[i].qty <= qtyToRemove) {
                            qtyToRemove -= currentBatches[i].qty;
                            currentBatches[i].qty = 0;
                        } else {
                            currentBatches[i].qty -= qtyToRemove;
                            qtyToRemove = 0;
                        }
                    }
                    currentBatches = currentBatches.filter(b => b.qty > 0); 
                }

                // 🚀 THE FIX: Same exclusion logic for manual stock additions/deductions
                const todayStrForWac2 = new Date().toISOString().split('T')[0];
                const todayTimeForWac2 = new Date().setHours(0, 0, 0, 0);

                let newWac = data.cost; 
                if (currentBatches.length > 0) {
                    let totalVal = 0, totalQ = 0;
                    currentBatches.forEach(b => {
                        const isExpired = b.expirationDate && new Date(b.expirationDate).getTime() < todayTimeForWac2;
                        if (!isExpired) {
                            totalVal += (parseFloat(b.qty) * parseFloat(b.cost));
                            totalQ += parseFloat(b.qty);
                        }
                    });
                    if (totalQ > 0) newWac = totalVal / totalQ;
                }
                
                finalUpdateData.batches = currentBatches;
                finalUpdateData.cost = newWac; 
                // 🚀 THE FIX: Also ensure the main stockLevel property reflects the active stock
                finalUpdateData.stockLevel = currentBatches.filter(b => !(b.expirationDate && new Date(b.expirationDate).getTime() < todayTimeForWac2)).reduce((sum, b) => sum + parseFloat(b.qty), 0); 
                
                await processTransactionGrouping(Math.abs(stockDiff), currentEditingId, true);
                logInventoryChange('UPDATE', data.name, `Stock changed by ${stockDiff > 0 ? '+' : ''}${stockDiff}`);
            } else {
                finalUpdateData.stockLevel = oldStock;
                delete finalUpdateData.stockLevel;
                finalUpdateData.batches = currentBatches;
                logInventoryChange('UPDATE', data.name, `Updated product metadata.`);
            }

            const role = typeof getUserRole === 'function' ? getUserRole() : 'manager';
            if (role === 'admin' || role === 'accountant') finalUpdateData.locationId = locationId;

            batch.set(docRef, finalUpdateData, { merge: true }); 
            logInventoryChange('UPDATE', data.name, `Updated details. Stock change: ${stockDiff > 0 ? '+' : ''}${stockDiff}`);

        } else {
            const newDocRef = doc(productsRef);
            
            if (data.stockLevel > 0) {
                 data.batches = [{
                     batchNo: data.batch || `B-${Date.now().toString().slice(-6)}`,
                     date: data.purchaseDate || new Date().toISOString().split('T')[0],
                     // 🚀 THE FIX: Use data.stockLevel for new products, not stockDiff!
                     qty: parseFloat(data.stockLevel) || 0, 
                     cost: data.cost, 
                     price: data.price, 
                     mrp: data.mrp,     
                     supplierId: data.dealerId || 'Manual/Mfg',
                     expirationDate: data.expirationDate || '',
                     packagedDate: data.packagedDate || null, 
                     timestamp: new Date().getTime(),
                     baseRate: data.baseRate || 0,
                     gstSlab: data.gstSlab || 0,
                     cess: data.cess || 0,
                     sl: data.sl || '', 
                     schDisc: data.schDisc || 0,
                     rsDisc: data.rsDisc || 0,
                     
                     rawSchDisc: data.rawSchDisc || 0,
                     isSchPercent: data.isSchPercent || false,
                     rawRsDisc: data.rawRsDisc || 0,
                     isRsPercent: data.isRsPercent || false,
                     isTaxInclusive: data.isTaxInclusive || false,

                     taxableAmt: data.taxableAmt || 0,
                     netAmt: data.netAmt || 0,
                     cases: data.cases || 0,
                     pieces: data.pieces || 0,
                     freeQty: data.freeQty || 0,
                     upc: data.upc || 1,
                     unit: data.unit || 'units',
                     
                     dealerId: data.dealerId || '',
                     dealerName: data.dealerName || '',
                     dealerPhone: data.dealerPhone || '',
                     dealerGstin: data.gstin || '',
                     dealerPan: data.dealerPan || '',
                     dealerState: data.dealerState || '', 
                     supplierInvoice: data.supplierInvoice || ''
                 }];
            }
            
            batch.set(newDocRef, data);
            
            if (data.stockLevel > 0) {
                await processTransactionGrouping(data.stockLevel, newDocRef.id, false);
            }
            
            logInventoryChange('CREATE', data.name, `SKU: ${data.sku}, Stock: ${data.stockLevel}`);
        }
        
        await batch.commit();

        if (typeof invalidateProductCache === 'function') invalidateProductCache();
        showModal('Success', 'Product saved successfully!', 'success');
        resetForm(); 
        if (data.dealerName) await loadDealerDropdowns();
        
    } catch (error) {
        console.error("Error saving:", error);
        showModal('Error', 'Failed to save: ' + error.message, 'error');
    } finally {
        // 🚀 THE FIX: Aggressively target both the DOM cache and the exact element ID to guarantee the button unlocks
        const saveBtnNode = document.getElementById('save-product-btn');
        if (saveBtnNode) {
            saveBtnNode.disabled = false;
            saveBtnNode.textContent = 'Save Product / Update Stock';
        }
        if(DOM.inventory.saveBtn) { 
            DOM.inventory.saveBtn.disabled = false; 
            DOM.inventory.saveBtn.textContent = 'Save Product / Update Stock'; 
        }
    }
}

// =========================================================
// 3. TABLE RENDERING & DATA LISTENER
// =========================================================





// Inject or update the <datalist> attached to the Product Name input
function updateHsnSuggestionsDatalist() {
    let datalist = document.getElementById('hsn-product-suggestions');
    const nameInput = document.getElementById('name');
    if (!nameInput) return;

    if (!datalist) {
        datalist = document.createElement('datalist');
        datalist.id = 'hsn-product-suggestions';
        document.body.appendChild(datalist);
        nameInput.setAttribute('list', 'hsn-product-suggestions');
    }

    datalist.innerHTML = '';
    const frag = document.createDocumentFragment();

    hsnDirectoryCache.forEach(item => {
        if (item.query) {
            const opt = document.createElement('option');
            opt.value = item.query; // e.g. "Chocolate Biscuits"
            opt.label = `HSN: ${item.hsn_code || 'N/A'} | GST: ${item.gst_rate || 0}%`;
            frag.appendChild(opt);
        }
    });

    datalist.appendChild(frag);
}
function updateProductDatalist() {
    if (!DOM.datalists.product || !localProductsCache) return;
    DOM.datalists.product.innerHTML = '';
    
    const locFilterDropdown = document.getElementById('inv-table-location-filter');
    const filterLocation = locFilterDropdown ? locFilterDropdown.value : 'all';

    let filteredProducts = localProductsCache;
    if (filterLocation !== 'all') {
        const normFilter = getNormalizedLoc(filterLocation);
        filteredProducts = filteredProducts.filter(item => getNormalizedLoc(item.locationId) === normFilter);
    }

    const frag = document.createDocumentFragment();
    filteredProducts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name; 
        frag.appendChild(opt);
    });
    DOM.datalists.product.appendChild(frag);
}

function updateBundleDatalist() {
    let bundleList = document.getElementById('bundle-product-search-list');
    const searchInput = document.getElementById('bundle-search');
    
    if (!searchInput) return;

    if (!bundleList) {
        bundleList = document.createElement('datalist');
        bundleList.id = 'bundle-product-search-list';
        document.body.appendChild(bundleList);
        searchInput.setAttribute('list', 'bundle-product-search-list');
    }

    bundleList.innerHTML = '';
    
    const locDropdown = document.getElementById('inv-form-location');
    const role = typeof getUserRole === 'function' ? getUserRole() : 'manager';
    const canAccessAllLocations = (role === 'admin' || role === 'accountant') ;

    let targetLoc = typeof getUserAssignedLocationId === 'function' ? getUserAssignedLocationId() : 'main';
    
    if (canAccessAllLocations && locDropdown) {
        targetLoc = locDropdown.value || 'main';
    }

    targetLoc = getNormalizedLoc(targetLoc);

    let filteredProducts = localProductsCache.filter(item => getNormalizedLoc(item.locationId) === targetLoc && item.type !== 'bundle');

    const frag = document.createDocumentFragment();
    filteredProducts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name; 
        frag.appendChild(opt);
    });
    bundleList.appendChild(frag);
}

export function renderInventoryTable() {
    if (!DOM.inventory.table) return;
    const searchTerm = DOM.inventory.search ? DOM.inventory.search.value.toLowerCase() : '';
    const sortMode = DOM.inventory.sort ? DOM.inventory.sort.value : 'name-asc';
    const currencySymbol = getCurrencySymbol();
    
    const locFilterDropdown = document.getElementById('inv-table-location-filter');
    const filterLocation = locFilterDropdown ? locFilterDropdown.value : 'all';

    let filteredProducts = localProductsCache;

    if (filterLocation !== 'all') {
        const normFilter = getNormalizedLoc(filterLocation);
        filteredProducts = filteredProducts.filter(item => getNormalizedLoc(item.locationId) === normFilter);
    }

    filteredProducts = filteredProducts.filter(product => {
        const name = (product.name || '').toLowerCase();
        const sku = (product.sku || '').toLowerCase();
        const barcode = (product.barcode || '').toLowerCase();
        const dealer = (product.dealerName || '').toLowerCase(); // 🚀 ADDED
        return name.includes(searchTerm) || sku.includes(searchTerm) || barcode.includes(searchTerm) || dealer.includes(searchTerm);
    });
    filteredProducts = filteredProducts.map(product => {
        if (product.type === 'bundle' && product.bundleComponents && product.bundleComponents.length > 0) {
            let maxBundlesPossible = Infinity;
            
            product.bundleComponents.forEach(comp => {
                const realProduct = localProductsCache.find(p => p.id === comp.id);
                const realStockAvailable = realProduct ? secureFloat(realProduct.stockLevel) : 0;
                
                const possibleWithThisItem = Math.floor(realStockAvailable / comp.qty);
                if (possibleWithThisItem < maxBundlesPossible) {
                    maxBundlesPossible = possibleWithThisItem;
                }
            });
            
            if (maxBundlesPossible === Infinity) maxBundlesPossible = 0;
            
            // Return a cloned object so the original cache is unaltered
            return { ...product, stockLevel: maxBundlesPossible };
        }
        return product;
    });

    // Now sort them (with the correct bundle stock levels applied)
    filteredProducts.sort((a, b) => {
        if (sortMode === 'name-asc') return (a.name || '').localeCompare(b.name || '');
        if (sortMode === 'name-desc') return (b.name || '').localeCompare(a.name || '');
        if (sortMode === 'stock-asc') return (parseFloat(a.stockLevel) || 0) - (parseFloat(b.stockLevel) || 0);
        if (sortMode === 'stock-desc') return (parseFloat(b.stockLevel) || 0) - (parseFloat(a.stockLevel) || 0);
        if (sortMode === 'exp-asc') return (a.expirationDate || '9999').localeCompare(b.expirationDate || '9999');
        return 0;
    });

    DOM.inventory.table.innerHTML = '';
    
    if (filteredProducts.length === 0) {
        DOM.inventory.table.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-gray-500">No products found.</td></tr>`;
        return;
    }

    // 🚀 NEW: Pagination Math
    const totalItems = filteredProducts.length;
    const totalPages = Math.ceil(totalItems / PRODUCTS_PER_PAGE);

    // Keep page bounds safe
    if (window.currentInventoryPage > totalPages) window.currentInventoryPage = totalPages || 1;
    if (window.currentInventoryPage < 1) window.currentInventoryPage = 1;

    const start = (window.currentInventoryPage - 1) * PRODUCTS_PER_PAGE;
    const end = start + PRODUCTS_PER_PAGE;
    
    // 🚀 Slice the exact 50 records for this page
    const pagedData = filteredProducts.slice(start, end);

    // 🚀 THE FIX: Add the 'index' parameter here so the serial number math works
    pagedData.forEach((product, index) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-indigo-50 transition duration-100 cursor-pointer table-row-animate';
        
        const isLowStock = parseFloat(product.stockLevel) <= (parseInt(product.lowStockThreshold) || 0);
        const expStatus = getExpirationStatus(product.expirationDate);
        let expDisplay = product.expirationDate ? escapeHTML(product.expirationDate) : '-';
        
        if (expStatus === 'expired') { 
            tr.classList.add('bg-red-50'); 
            expDisplay = `<span class="text-red-600 font-bold" title="Expired">${expDisplay} ⚠️</span>`;
        } else if (expStatus === 'soon') {
            tr.classList.add('bg-amber-50');
            expDisplay = `<span class="text-amber-600 font-medium" title="Expiring Soon">${expDisplay} ⏳</span>`;
        } else if (isLowStock) {
            tr.classList.add('bg-orange-50/30');
        }

        const typeBadge = product.type === 'bundle' ? '<span class="text-[10px] bg-purple-100 text-purple-700 px-1 rounded ml-1 font-bold">BUNDLE</span>' : '';
        const serialNo = start + index + 1;

        // 🚀 THE FIX: Stack unique dealers from the batches
        let dealers = new Set();
        if (product.batches && product.batches.length > 0) {
            product.batches.forEach(b => {
                if (parseFloat(b.qty) > 0 && b.dealerName && b.dealerName !== 'Internal Manufacturing' && b.dealerName !== 'Bulk Inventory Import') {
                    dealers.add(escapeHTML(b.dealerName));
                }
            });
        }
        if (dealers.size === 0 && product.dealerName) {
            dealers.add(escapeHTML(product.dealerName));
        }

        const dealerHtml = dealers.size > 0 
            ? Array.from(dealers).map(d => `<div class="truncate max-w-[140px]" title="${d}">${d}</div>`).join('<div class="h-px w-full bg-slate-200 my-1.5"></div>')
            : '<span class="text-gray-400 italic">No Supplier</span>';

        tr.innerHTML = `
            <td class="px-4 py-3 text-center text-xs font-bold text-slate-400 select-none">${serialNo}</td>
            <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                    <div class="relative group cursor-pointer w-10 h-10 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden flex-shrink-0" onclick="window.triggerPosImageUpload('${product.sku || product.id}')">
                        <img id="inv-img-${product.sku || product.id}" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' fill='none' stroke='%23cbd5e1' viewBox='0 0 24 24'><path stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z'></path></svg>" class="w-full h-full object-cover p-1.5" alt="Upload">
                        <div class="absolute inset-0 bg-indigo-600/80 hidden group-hover:flex items-center justify-center transition-all">
                            <span class="text-[9px] font-bold text-white uppercase tracking-wider">Pic</span>
                        </div>
                    </div>
                    <div class="font-bold text-slate-800 text-sm flex items-center">
                        ${escapeHTML(product.name)} ${typeBadge}
                    </div>
                </div>
            </td>
            <td class="px-4 py-3 text-sm text-slate-500 font-mono">${escapeHTML(product.sku)}</td>
            <td class="px-4 py-3 text-right font-mono text-slate-700">${currencySymbol}${parseFloat(product.price).toFixed(2)}</td>
            <td class="px-4 py-3 text-left font-bold ${isLowStock ? 'text-orange-600' : 'text-emerald-600'}">
                ${product.stockLevel} <span class="text-[9px] text-slate-400 font-bold uppercase tracking-wider ml-0.5">${escapeHTML(product.unit || 'UNITS')}</span>
            </td>
            <td class="px-4 py-3 text-center text-sm">${expDisplay}</td>
            <td class="px-4 py-3 text-left text-xs font-bold text-slate-600 leading-tight align-top pt-4">${dealerHtml}</td>
            <td class="px-4 py-3 text-right space-x-1 whitespace-nowrap align-top pt-3">
                 <button data-id="${product.id}" data-action="barcode" class="text-slate-500 hover:text-slate-800 font-bold text-xs bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-md transition-colors" title="Print Barcode">🖨️</button>
                 <button data-id="${product.id}" data-action="adjust" class="text-emerald-600 hover:text-emerald-800 font-bold text-xs bg-emerald-50 px-2.5 py-1.5 rounded-md transition-colors">Adjust</button>
                 <button data-id="${product.id}" data-action="edit" class="text-indigo-600 hover:text-indigo-800 font-bold text-xs bg-indigo-50 px-2.5 py-1.5 rounded-md transition-colors">Edit</button>
                 <button data-id="${product.id}" data-name="${escapeHTML(product.name)}" data-action="delete" class="text-red-500 hover:text-red-700 font-bold text-xs bg-red-50 px-2.5 py-1.5 rounded-md transition-colors">Del</button>
            </td>
        `;
        DOM.inventory.table.appendChild(tr);
    });

    // 🚀 NEW: Append the Pagination Footer
    const paginationRow = document.createElement('tr');
    paginationRow.className = "bg-slate-50/80 sticky bottom-0 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]";
    paginationRow.innerHTML = `
        <td colspan="8" class="p-4 border-t border-slate-200">
            <div class="flex items-center justify-between">
                <div class="text-xs text-slate-500 font-medium font-mono">
                    Showing <span class="font-bold text-indigo-600">${totalItems > 0 ? start + 1 : 0}</span> to <span class="font-bold text-indigo-600">${Math.min(end, totalItems)}</span> of <span class="font-bold text-indigo-600">${totalItems}</span> products
                </div>
                <div class="flex gap-2">
                    <button onclick="window.changeInventoryPage(-1)" class="px-4 py-1.5 text-xs font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-all" ${window.currentInventoryPage === 1 ? 'disabled' : ''}>Prev</button>
                    <span class="text-xs font-bold text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-200 shadow-inner">Page ${window.currentInventoryPage} of ${totalPages || 1}</span>
                    <button onclick="window.changeInventoryPage(1)" class="px-4 py-1.5 text-xs font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-all" ${window.currentInventoryPage >= totalPages ? 'disabled' : ''}>Next</button>
                </div>
            </div>
        </td>
    `;
    DOM.inventory.table.appendChild(paginationRow);

    // Intersection Observer for Lazy Loading Images
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const imageId = img.dataset.imageId || img.id.replace('inv-img-', '');
                    
                    if (imageId && !img.dataset.loaded) {
                        img.dataset.loaded = 'true'; 
                        
                        if (typeof loadPosImage === 'function') {
                            loadPosImage(imageId).then(base64 => {
                                if (base64) {
                                    img.src = base64;
                                    img.classList.remove('p-1.5');
                                }
                            }).catch(() => {});
                        }
                    }
                    observer.unobserve(img); 
                }
            });
        }, { rootMargin: '100px 0px' }); 

        document.querySelectorAll('img[id^="inv-img-"]').forEach(img => {
            imageObserver.observe(img);
        });
    }
}
// =========================================================
// 4. HELPER FUNCTIONS & MODALS
// =========================================================

export async function resetForm() {
    const formEl = DOM.inventory?.form || document.getElementById('product-form');
    if (formEl) formEl.reset();
    
    setEditingProductId(null);
    
    const titleEl = DOM.inventory?.formTitle || document.getElementById('form-title') || document.getElementById('inventory-form-title');
    if (titleEl) titleEl.textContent = 'Add New Product';
    
    const saveBtn = DOM.inventory?.saveBtn || document.getElementById('save-product-btn');
    if (saveBtn) saveBtn.textContent = 'Save Product / Update Stock';
    
    const cancelBtn = DOM.inventory?.cancelBtn || document.getElementById('cancel-edit-btn');
    if (cancelBtn) cancelBtn.classList.add('hidden');
    
    const clearIds = [
        'prod-sl', 'prod-hsn', 'prod-batch', 'prod-upc', 'prod-mrp', 'prod-cess',
        'prod-base-rate', 'prod-sch-disc', 'prod-rs-disc', 'prod-taxable-amt',
        'prod-cgst', 'prod-sgst', 'prod-net-amt', 'prod-cases', 'prod-pieces',
        'prod-dealer-pan', 'prod-dealer-phone', 'prod-free-qty', 'prod-dealer-state', // 🚀 ADDED HERE
        'prod-invoice', 'prod-date', 'packagedDate', 'expirationDate', 'best-before-months'
    ];
    clearIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.disabled = false; el.classList.remove('bg-gray-100', 'bg-gray-50'); }
    });
    
    const discVal = document.getElementById('inv-discount-val');
    if (discVal) discVal.value = '';
    
    // Defaults
    const upcEl = document.getElementById('prod-upc');
    if (upcEl) upcEl.value = "1";
    const schType = document.getElementById('prod-sch-disc-type');
    if(schType) schType.value = '₹';
    const rsType = document.getElementById('prod-rs-disc-type');
    if(rsType) rsType.value = '₹';
    const casesEl = document.getElementById('prod-cases');
    if (casesEl) casesEl.value = "0";
    const piecesEl = document.getElementById('prod-pieces');
    if (piecesEl) piecesEl.value = "0";
    const freeEl = document.getElementById('prod-free-qty');
    if (freeEl) freeEl.value = "0";
    const paySelect = document.getElementById('prod-payment-method');
    if (paySelect) paySelect.value = 'CASH';

    // 🚀 THE FIX: Wipe and Hide the Batch Registry Table!
    const regSection = document.getElementById('batch-registry-section');
    const regBody = document.getElementById('batch-registry-body');
    if (regSection) regSection.classList.add('hidden');
    if (regBody) regBody.innerHTML = '';
    window._tempBatchList = []; // Clear memory

    // 🚀 RESET TOGGLES TO RUPEES
    const schToggle = document.getElementById('prod-sch-disc-type-toggle');
    if (schToggle) schToggle.checked = false;
    const rsToggle = document.getElementById('prod-rs-disc-type-toggle');
    if (rsToggle) rsToggle.checked = false;
    const invDiscToggle = document.getElementById('inv-discount-type-toggle');
    if (invDiscToggle) invDiscToggle.checked = false;
    
    const chequeDrawer = document.getElementById('prod-cheque-drawer');
    if (chequeDrawer) {
        chequeDrawer.classList.add('hidden');
        chequeDrawer.classList.remove('grid');
        document.getElementById('prod-cheque-bank').value = '';
        document.getElementById('prod-cheque-no').value = '';
        document.getElementById('prod-cheque-date').value = '';
    }
    
    const i = DOM.inventory?.inputs || {};
    if (i.stock) {
        i.stock.disabled = false;
        delete i.stock.dataset.editingBatchIndex;
        i.stock.dataset.baseStock = "0"; // 🚀 THE FIX: Reset the base stock math engine
        i.stock.classList.remove('bg-gray-200', 'cursor-not-allowed', 'opacity-50', 'bg-red-50', 'text-red-500');
        i.stock.classList.add('bg-white');
        i.stock.value = "0"; // Force UI to show 0
    }
    if (i.lowStock) i.lowStock.value = 10;

    const poCheck = document.getElementById('prod-in-po-catalog');
    if (poCheck) poCheck.checked = true;
    const retailCheck = document.getElementById('prod-permit-retail');
    if (retailCheck) retailCheck.checked = true;

    if (i.dealer) { i.dealer.disabled = false; i.dealer.classList.remove('bg-gray-100'); i.dealer.value = ''; }
    if (i.dealerId) { i.dealerId.disabled = false; i.dealerId.value = ''; }
    if (i.dealerGst) { i.dealerGst.disabled = false; i.dealerGst.classList.remove('bg-gray-100'); i.dealerGst.value = ''; }

    if (i.sku) {
        i.sku.value = 'Generating...';
        i.sku.disabled = true; 
        const nextSku = await generateNextSku();
        i.sku.value = nextSku;
        i.sku.disabled = false; 
        if (i.barcode && !i.barcode.value) i.barcode.value = nextSku; 
    }
    
    bundleComponents = [];
    if (typeof renderBundleTable === 'function') renderBundleTable();
    const bb = document.getElementById('bundle-builder');
    if (bb) bb.classList.add('hidden');
    
    // 🚀 THE FIX: Reset the new Dropdown instead of Radios
    const typeSelect = document.getElementById('productType');
    if (typeSelect) typeSelect.value = 'standard';
    
    if (typeof toggleProductTypeUI === 'function') toggleProductTypeUI('standard');
    
    // 🚀 THE FIX: Re-enable the Add Batch button when the form is cleared/saved
    const addBatchBtn = document.querySelector('button[onclick="window.prepareNewBatch()"]');
    if (addBatchBtn) {
        addBatchBtn.disabled = false;
        addBatchBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        addBatchBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg> Add New Batch`;
    }
    
    if (formEl && window.scrollY > 300) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

export function handleInventorySortAndSearch() {
    renderInventoryTable();
}

export function getExpirationStatus(dateStr) {
    if (!dateStr) return 'ok';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expDate = new Date(dateStr);
    
    if (expDate < today) return 'expired';
    
    const warningDate = new Date(today);
    warningDate.setDate(today.getDate() + 30);
    if (expDate <= warningDate) return 'soon';
    
    return 'ok';
}

let dealersListenerUnsubscribe = null;

// ============================================================================
// 🚀 NON-DESTRUCTIVE STRICT-MATCH DEALER AUTO-SYNC (OFFLINE SQLite)
// ============================================================================

let activeDealerState = { id: null, phone: '', name: '' };
let dealerLookupDebounce = null;

export async function handleDealerInfoChange(triggerField, rawValue) {
    if (rawValue === undefined) {
        const el = document.getElementById(
            triggerField === 'phone' ? 'prod-dealer-phone' : 
            triggerField === 'gstin' ? 'prod-gstin' : 
            triggerField === 'name' ? 'prod-dealer' : 'prod-dealer-id'
        );
        if (el) rawValue = el.value;
    }

    let val = (rawValue || '').trim();
    const rawDigits = val.replace(/\D/g, '');

    // 🛑 STRICT TRIGGER RULES:
    const isExactPhone = (triggerField === 'phone' && rawDigits.length >= 10);
    const isExactGstin = (triggerField === 'gstin' && val.length >= 15);
    const isExactName = (triggerField === 'name' && val.length > 2);

    if (!isExactPhone && !isExactGstin && !isExactName) {
        activeDealerState = { id: null, phone: '', name: '' };
        unlockDealerFieldsSafe();
        return;
    }

    try {
        let match = null;

        // 1. Search local cached directory
        if (isExactName) {
            match = localDealersCache.find(d => 
                (d.name || d.storeName || '').trim().toLowerCase() === val.toLowerCase()
            );
        } else if (isExactPhone) {
            const targetPhone = rawDigits.slice(-10);
            match = localDealersCache.find(d => 
                (d.phone || '').replace(/\D/g, '').endsWith(targetPhone)
            );

            if (!match && window.dbAPI && window.dbAPI.getSupplierByPhone) {
                match = await window.dbAPI.getSupplierByPhone(targetPhone);
            }
        } else if (isExactGstin) {
            const cleanGst = val.toUpperCase();
            match = localDealersCache.find(d => 
                (d.gstin || '').trim().toUpperCase() === cleanGst
            );

            if (!match && window.dbAPI && window.dbAPI.getSupplierByGSTIN) {
                match = await window.dbAPI.getSupplierByGSTIN(cleanGst);
            }
        }

        // 2. ONLY populate if there is an exact match
        if (match) {
            activeDealerState = { 
                id: match.id || match.merchantId || null, 
                phone: match.phone || '', 
                name: match.name || match.storeName || '' 
            };
            fillDealerFieldsSafe(match);
            if (typeof showToast === 'function') {
                showToast("Supplier Linked", `Loaded details for: ${match.name || match.storeName}`, "success");
            }
        }
    } catch (e) {
        console.warn("Dealer fetch error:", e);
    }
}

function fillDealerFieldsSafe(data) {
    if (!data) return;

    const name = (data.storeName || data.name || '').trim();
    const gst = (data.gstin || data.taxId || '').trim();
    const id = (data.merchantId || data.id || '').trim();
    const pan = (data.pan || '').trim();
    let state = (data.state || '').trim();
    
    // 🚀 THE FIX: Auto-infer the state from the dropdown dealer's GSTIN if it's missing in the database
    if (!state && gst.length >= 2) {
        const GST_STATE_CODES = {
            '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', 
            '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', 
            '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', 
            '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', 
            '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', 
            '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli', '27': 'Maharashtra', '29': 'Karnataka', 
            '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', 
            '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh'
        };
        const stateName = GST_STATE_CODES[gst.substring(0, 2)];
        if (stateName) state = `${gst.substring(0, 2)}-${stateName}`;
    }

    let phone = (data.phone || '').trim().replace(/^\+?91/, '');

    const setVal = (elId, value, highlight = true) => {
        const el = document.getElementById(elId);
        if (el && value) {
            el.value = value;
            if (highlight) {
                el.classList.add('bg-emerald-50', 'transition-colors');
                setTimeout(() => el.classList.remove('bg-emerald-50'), 800);
            }
        }
    };

    setVal('prod-dealer', name);
    setVal('prod-dealer-phone', phone);
    setVal('prod-dealer-id', id, false);
    setVal('prod-gstin', gst);
    setVal('prod-dealer-pan', pan);
    setVal('prod-dealer-state', state);

    unlockDealerFieldsSafe();
}

function unlockDealerFieldsSafe() {
    const fieldIds = [
        'prod-dealer', 'prod-dealer-phone', 'prod-dealer-id', 
        'prod-gstin', 'prod-dealer-pan', 'prod-dealer-state', 'prod-invoice'
    ];
    
    fieldIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = false;
            el.classList.remove('bg-gray-100', 'bg-gray-50', 'cursor-not-allowed', 'text-gray-500');
        }
    });
}

// Ensure the clear button triggers correctly (Paste this inside setupInventoryListeners):
const clearDealerBtn = document.getElementById('clear-dealer-btn');
if (clearDealerBtn) {
    clearDealerBtn.addEventListener('click', () => {
        ['prod-gstin', 'prod-dealer-phone', 'prod-dealer', 'prod-dealer-id', 'prod-dealer-pan', 'prod-invoice', 'prod-dealer-state'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        
        if (typeof activeDealerState !== 'undefined') {
            activeDealerState = { id: null, phone: '', name: '' };
        }
        
        unlockDealerFieldsSafe();
        const nameInput = document.getElementById('prod-dealer');
        if (nameInput) nameInput.focus();
    });
}



async function searchGlobalDirectory(type, val) {
    try {
        const dirRef = collection(db, `artifacts/${appId}/directory_merchants`);
        
        if (type === 'id') {
            const docSnap = await getDoc(doc(dirRef, val));
            return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
        } 
        
        if (type === 'phone') {
            let queries = [];
            queries.push(getDocs(query(dirRef, where('phone', '==', val), limit(1))));
            
            if (val.length === 10) {
                queries.push(getDocs(query(dirRef, where('phone', '==', `+91${val}`), limit(1))));
            }
            
            const results = await Promise.all(queries);
            for (const snap of results) {
                if (!snap.empty) {
                    const d = snap.docs[0].data();
                    return { id: snap.docs[0].id, ...d };
                }
            }
        }
        return null;
    } catch (e) {
        console.warn("Global lookup failed", e);
        return null;
    }
}

function injectExtraDealerFields() {
    const gstInput = document.getElementById('prod-gstin') || document.querySelector('input[name="gstin"]'); 
    if (gstInput && !document.getElementById('prod-dealer-pan')) {
        const wrapper = gstInput.closest('div'); 
        if (wrapper) {
            wrapper.insertAdjacentHTML('afterend', `
                <div>
                    <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Supplier PAN</label>
                    <input type="text" id="prod-dealer-pan" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2.5 border uppercase font-mono focus:ring-indigo-500 focus:border-indigo-500" placeholder="OPTIONAL">
                </div>
            `);
        }
    }

    // 🚀 NEW: Inject Supplier State exactly matching your UI screenshot
    const invoiceInput = document.getElementById('prod-invoice');
    if (invoiceInput && !document.getElementById('prod-dealer-state')) {
        const wrapper = invoiceInput.closest('div');
        if (wrapper) {
            wrapper.insertAdjacentHTML('afterend', `
                <div class="col-span-1 md:col-span-2 lg:col-span-1">
                    <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Supplier State <span class="text-red-500">*</span></label>
                    <input type="text" id="prod-dealer-state" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2.5 border font-bold text-gray-800 focus:ring-indigo-500 focus:border-indigo-500 bg-white" placeholder="e.g. Maharashtra">
                </div>
            `);
        }
    }
}

function injectDiscountCalculator() {
    const mrpInput = document.getElementById('prod-mrp');
    const priceInput = document.getElementById('price');
    
    if (!mrpInput || !priceInput || document.getElementById('inv-discount-container')) return;

    const wrapper = priceInput.closest('div'); 
    
    // 🚀 FIXED: Top row layout strictly mirrors standard inputs
    const html = `
        <div id="inv-discount-container" class=" ">
            <div class="flex justify-between items-center w-full mb-2 h-[18px]">
                <label class="text-xs font-bold text-gray-600 uppercase tracking-wider truncate mr-2">Discount</label>
                <label class="flex items-center cursor-pointer bg-slate-200/60 rounded px-0.5 py-0.5 border border-slate-200 select-none shadow-inner shrink-0">
                    <input type="checkbox" id="inv-discount-type-toggle" class="sr-only peer">
                    <span class="px-2.5 py-[1px] text-[10px] font-bold rounded-sm transition-all peer-checked:text-slate-400 peer-checked:bg-transparent bg-white shadow-sm text-indigo-700 whitespace-nowrap">₹</span>
                    <span class="px-2.5 py-[1px] text-[10px] font-bold rounded-sm transition-all peer-checked:bg-white peer-checked:shadow-sm peer-checked:text-indigo-700 text-slate-400 bg-transparent whitespace-nowrap">%</span>
                </label>
            </div>
            <div class="flex rounded-md shadow-sm border border-gray-300 overflow-hidden focus-within:ring-1 focus-within:ring-indigo-500 focus-within:border-indigo-500 transition-all bg-white">
                <input type="number" id="inv-discount-val" class="flex-1 w-full px-3 py-2 outline-none sm:text-sm font-bold text-indigo-700 border-none m-0 focus:ring-0" placeholder="0">
            </div>
        </div>
    `;
    
    wrapper.insertAdjacentHTML('afterend', html);

    const discVal = document.getElementById('inv-discount-val');
    const discTypeToggle = document.getElementById('inv-discount-type-toggle');

    const calculateSellingPrice = () => {
        const mrp = parseFloat(mrpInput.value) || 0;
        const disc = parseFloat(discVal.value) || 0;
        const isPercent = discTypeToggle.checked; 

        if (mrp <= 0) return; 

        let finalPrice = mrp;
        if (isPercent) {
            finalPrice = mrp - (mrp * (disc / 100));
        } else {
            finalPrice = mrp - disc;
        }
        
        finalPrice = Math.max(0, finalPrice);
        priceInput.value = finalPrice.toFixed(2);
        
        priceInput.classList.add('bg-green-50', 'text-green-700', 'border-green-400', 'transition-colors');
        setTimeout(() => priceInput.classList.remove('bg-green-50', 'text-green-700', 'border-green-400'), 500);
    };

    mrpInput.addEventListener('input', calculateSellingPrice);
    discVal.addEventListener('input', calculateSellingPrice);
    discTypeToggle.addEventListener('change', calculateSellingPrice);
}

function injectTaxInclusiveToggle() {
    const baseRateInput = document.getElementById('prod-base-rate');
    
    if (baseRateInput && !document.getElementById('tax-inclusive-toggle-container')) {
        const wrapper = baseRateInput.parentElement;
        const label = wrapper.querySelector('label');
        
        if (label) {
            // 🚀 SURGICAL FIX: Remove specific margins from the label so the parent container can control the height
            label.classList.remove('mb-2', 'h-[18px]'); 
            
            // Create a perfect flex container
            const flexHeader = document.createElement('div');
            flexHeader.id = 'tax-inclusive-toggle-container';
            flexHeader.className = 'flex justify-between items-center w-full mb-2 h-[18px]';
            
            // Gently wrap the existing label (leaving tooltips 100% intact!)
            wrapper.insertBefore(flexHeader, label);
            flexHeader.appendChild(label);
            
            // Inject the toggle next to it
            const toggleHTML = `
                <label class="flex items-center cursor-pointer bg-slate-200/60 rounded px-0.5 py-0.5 border border-slate-200 select-none shadow-inner shrink-0 ml-2" title="Is the tax already included in the base rate?">
                    <input type="checkbox" id="tax-inclusive-toggle" class="sr-only peer">
                    <span class="px-1.5 py-[1px] text-[9px] font-bold rounded-sm transition-all peer-checked:text-slate-400 peer-checked:bg-transparent bg-white shadow-sm text-indigo-700 whitespace-nowrap">+ TAX</span>
                    <span class="px-1.5 py-[1px] text-[9px] font-bold rounded-sm transition-all peer-checked:bg-white peer-checked:shadow-sm peer-checked:text-indigo-700 text-slate-400 bg-transparent whitespace-nowrap">INCL</span>
                </label>
            `;
            flexHeader.insertAdjacentHTML('beforeend', toggleHTML);
        }
    }
}

function injectPurchaseDiscountToggles() {
    ['prod-sch-disc', 'prod-rs-disc'].forEach(id => {
        const input = document.getElementById(id);
        if (!input || input.classList.contains('has-toggle-injected')) return;

        // 🚀 THE FIX: Traverse UP the DOM tree until we find the label!
        let wrapper = input.parentElement;
        let label = wrapper ? wrapper.querySelector('label') : null;
        
        while (!label && wrapper && wrapper !== document.body) {
            wrapper = wrapper.parentElement;
            label = wrapper ? wrapper.querySelector('label') : null;
        }

        if (label && wrapper) {
            // Safely remove the "(₹)" text node without destroying the SVG Tooltip
            label.childNodes.forEach(node => {
                if (node.nodeType === 3) { // If it is pure text
                    node.nodeValue = node.nodeValue.replace(/\(₹\)/g, '');
                }
            });

            // Remove margins to allow the wrapper to take control
            label.classList.remove('mb-2', 'h-[18px]');
            
            // Create the flex wrapper
            const flexHeader = document.createElement('div');
            flexHeader.className = 'flex justify-between items-center w-full mb-2 h-[18px]';
            
            // Wrap the label
            label.parentNode.insertBefore(flexHeader, label);
            flexHeader.appendChild(label);

            // Inject the toggle
            const toggleHTML = `
                <label class="flex items-center cursor-pointer bg-slate-200/60 rounded px-0.5 py-0.5 border border-slate-200 select-none shadow-inner shrink-0 ml-2">
                    <input type="checkbox" id="${id}-type-toggle" class="sr-only peer">
                    <span class="px-2 py-[1px] text-[10px] font-bold rounded-sm transition-all peer-checked:text-slate-400 peer-checked:bg-transparent bg-white shadow-sm text-indigo-700 whitespace-nowrap">₹</span>
                    <span class="px-2 py-[1px] text-[10px] font-bold rounded-sm transition-all peer-checked:bg-white peer-checked:shadow-sm peer-checked:text-indigo-700 text-slate-400 bg-transparent whitespace-nowrap">%</span>
                </label>
            `;
            flexHeader.insertAdjacentHTML('beforeend', toggleHTML);
        }

        input.classList.add('has-toggle-injected');

        // Wire it to the math engine
        const toggle = document.getElementById(`${id}-type-toggle`);
        if (toggle) {
            toggle.addEventListener('change', () => {
                if (typeof window.calculateInvoiceBreakdown === 'function') {
                    window.calculateInvoiceBreakdown(id);
                }
            });
        }
    });
}

function injectPaymentFields() {
    // 🚀 THE FIX: Changed the anchor from FSSAI to the Supplier Invoice field
    const anchorInput = document.getElementById('prod-invoice');
    
    if (anchorInput && !document.getElementById('prod-payment-method')) {
        const wrapper = anchorInput.closest('div').parentElement; 
        
        wrapper.insertAdjacentHTML('afterend', `
            <div class="col-span-full mt-4 p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 ">
                <h4 class="text-[10px] font-black text-indigo-800 uppercase tracking-widest mb-3">Payment Details (For Stock Purchases)</h4>
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                        <label class="block text-xs font-bold text-gray-500 mb-1">Payment Mode</label>
                        <select id="prod-payment-method" class="w-full rounded-lg border-gray-300 shadow-sm p-2.5 text-sm font-bold text-indigo-700 bg-white focus:ring-indigo-500 focus:border-indigo-500 cursor-pointer">
                            <option value="CASH">Cash</option>
                            <option value="UPI">UPI</option>
                            <option value="CHEQUE">Cheque</option>
                            <option value="CREDIT">Credit (Udhaar)</option>
                        </select>
                    </div>
                </div>
                <!-- Hidden Cheque Drawer -->
                <div id="prod-cheque-drawer" class="hidden grid-cols-1 md:grid-cols-3 gap-4 mt-4 bg-white p-4 rounded-lg border border-indigo-200 shadow-inner">
                    <div>
                        <label class="block text-xs font-bold text-gray-500 mb-1">Bank Name</label>
                        <input type="text" id="prod-cheque-bank" placeholder="e.g. HDFC, SBI" class="w-full rounded-md border-gray-300 shadow-sm p-2 text-sm focus:ring-indigo-500 focus:border-indigo-500">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 mb-1">Cheque No.</label>
                        <input type="text" id="prod-cheque-no" placeholder="6 Digits" class="w-full rounded-md border-gray-300 shadow-sm p-2 text-sm font-mono focus:ring-indigo-500 focus:border-indigo-500">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 mb-1">Clearance Date</label>
                        <input type="date" id="prod-cheque-date" class="w-full rounded-md border-gray-300 shadow-sm p-2 text-sm focus:ring-indigo-500 focus:border-indigo-500 text-gray-700">
                    </div>
                </div>
            </div>
        `);

        // Attach Toggle Listener
        document.getElementById('prod-payment-method').addEventListener('change', (e) => {
            const drawer = document.getElementById('prod-cheque-drawer');
            if (e.target.value === 'CHEQUE') {
                drawer.classList.remove('hidden');
                drawer.classList.add('grid');
            } else {
                drawer.classList.add('hidden');
                drawer.classList.remove('grid');
            }
        });
    }
}


function setInputLoading(el, isLoading) {
    if (!el || !el.parentNode) return;
    const parent = el.parentNode;
    let spinner = parent.querySelector('.input-spinner');
    
    if (isLoading) {
        if (!spinner) {
            spinner = document.createElement('div');
            spinner.className = 'input-spinner absolute right-2 top-2.5 animate-spin h-4 w-4 border-2 border-indigo-500 rounded-full border-t-transparent';
            if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
            parent.appendChild(spinner);
        }
    } else {
        if (spinner) spinner.remove();
    }
}

function setInputStatus(el, status) {
    if (!el) return;
    el.classList.remove('border-green-500', 'border-red-500', 'border-indigo-500');
    if (status === 'success') el.classList.add('border-green-500');
    if (status === 'error') el.classList.add('border-red-500');
    if (status === 'neutral') el.classList.add('border-gray-300');
}

function editProduct(id) {
    const p = localProductsCache.find(i => i.id === id);
    if (!p) return;
    setEditingProductId(id);
    const gstinInput = document.getElementById('edit-product-gstin');
    const i = DOM.inventory?.inputs || {};
    
    const safeVal = (val, isNumber = false) => {
        if (val === null || val === undefined) return isNumber ? "0" : "";
        if (isNumber && isNaN(val)) return "0";
        return String(val);
    };
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    
    // ========================================================================
    // 🚀 THE FIX: FEFO/FIFO BATCH RECONCILIATION
    // If POS sales depleted stockLevel but not batches, or manual stock was added,
    // we safely reconcile the working batches array to perfectly match the true liveStock.
    // ========================================================================
    const liveStock = parseFloat(p.stockLevel) || 0;
    let workingBatches = p.batches ? JSON.parse(JSON.stringify(p.batches)) : [];
    
    // 🚀 THE FIX: Use strict LOCAL timezone midnight instead of UTC toISOString().
    // This prevents batches from ghosting in and out of expiry depending on the time of night.
    const todayTime = new Date().setHours(0, 0, 0, 0);
    
    let sumActiveBatches = 0;
    workingBatches.forEach(b => {
        const isExpired = b.expirationDate && new Date(b.expirationDate).getTime() < todayTime;
        if (!isExpired) sumActiveBatches += (parseFloat(b.qty) || 0);
    });
    
    if (workingBatches.length > 0 && Math.abs(liveStock - sumActiveBatches) > 0.01) {
        if (liveStock < sumActiveBatches) {
            // Stock was sold. Deplete batches logically, but ONLY from active stock.
            let diff = sumActiveBatches - liveStock;
            workingBatches = sortBatchesFefoFifo(workingBatches);
            for (let j = 0; j < workingBatches.length; j++) {
                if (diff <= 0) break;
                
                const isExpired = workingBatches[j].expirationDate && new Date(workingBatches[j].expirationDate).getTime() < todayTime;
                if (isExpired) continue; // Skip quarantines, they weren't sold!

                if (workingBatches[j].qty <= diff) {
                    diff -= workingBatches[j].qty;
                    workingBatches[j].qty = 0;
                } else {
                    workingBatches[j].qty -= diff;
                    diff = 0;
                }
            }
            workingBatches = workingBatches.filter(b => b.qty > 0.001);
        } else if (liveStock > sumActiveBatches) {
            // Phantom stock exists. Add a legacy recovery batch to fix the desync.
            workingBatches.push({
                batchNo: 'LEGACY-RECOVERY',
                date: p.purchaseDate || (p.createdAt ? p.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]),
                qty: liveStock - sumActiveBatches,
                cost: parseFloat(p.cost) || 0,
                supplierId: p.dealerId || 'SYSTEM',
                dealerName: p.dealerName || '',
                timestamp: new Date().getTime()
            });
        }
    }

    // Separate active (sellable) batches from expired (quarantined) batches
    const activeSellableBatches = workingBatches.filter(b => {
        if (!b.expirationDate) return true;
        return new Date(b.expirationDate).getTime() >= todayTime;
    });

    let activeBatch = null;
    if (activeSellableBatches.length > 0) {
        // 🚀 THE FIX: Target the actively selling batch (FEFO/FIFO front of queue)
        const sortedActive = sortBatchesFefoFifo(activeSellableBatches);
        activeBatch = sortedActive[0]; 
    }
    const source = activeBatch || p;

    // 🚀 Recalculate true active stock (ignoring quarantined items)
    let trueActiveStock = activeSellableBatches.reduce((sum, b) => sum + (parseFloat(b.qty) || 0), 0);
    // Fallback if no batches exist but legacy stock is present
    if (workingBatches.length === 0) trueActiveStock = liveStock;

    // 🚀 HOIST THE MATH (Using the newly calculated active stock)
    const targetQty = activeBatch ? (parseFloat(activeBatch.qty) || 0) : trueActiveStock;
    let upc = parseInt(p.upc) || 1;
    let cases = parseInt(source.cases) || 0;
    let pieces = parseInt(source.pieces) || (activeBatch ? targetQty : trueActiveStock);
    let freeQty = parseInt(source.freeQty) || 0;
    
    // Force mathematical sync if the saved cases/pieces don't match the target quantity
    if ((cases * upc + pieces + freeQty) !== targetQty) {
        if (upc > 1) {
            cases = Math.floor(targetQty / upc);
            pieces = targetQty % upc;
        } else {
            cases = 0;
            pieces = targetQty;
        }
        freeQty = 0;
    }
    let calcQty = targetQty > 0 ? targetQty : 1;

// 1. Basic Info UI Rendering
    if (i.name) i.name.value = safeVal(p.name);
    if (i.sku) { i.sku.value = safeVal(p.sku); i.sku.disabled = false; }
    if (i.barcode) i.barcode.value = safeVal(p.barcode);
    
    // 🚀 THE FIX: Pull ALL financials strictly from the Active Batch
    let basePrice = activeBatch?.price !== undefined && activeBatch?.price !== null ? activeBatch.price : p.price;
    let baseCost = activeBatch?.cost !== undefined && activeBatch?.cost !== null ? activeBatch.cost : p.cost;
    let baseMrp = activeBatch?.mrp !== undefined && activeBatch?.mrp !== null ? activeBatch.mrp : (p.mrp || basePrice);

    if (i.price) i.price.value = safeVal(basePrice, true);
    if (i.cost) i.cost.value = safeVal(baseCost, true);
    setEl('prod-mrp', safeVal(baseMrp, true));
    // 🚀 THE FIX: Only display the active, non-expired stock in the main UI
    if (i.stock) {
        i.stock.value = safeVal(trueActiveStock, true);
        i.stock.dataset.baseStock = Math.max(0, trueActiveStock - targetQty).toString(); 
        
        if (activeBatch && p.batches) {
            // Explicitly locate via timestamp/batchNo mapping to safely bypass deep cloning breaks
            const bIndex = p.batches.findIndex(b => 
                b.timestamp === activeBatch.timestamp && 
                b.batchNo === activeBatch.batchNo
            );
            
            if (bIndex > -1) {
                i.stock.dataset.editingBatchIndex = bIndex;
            } else {
                delete i.stock.dataset.editingBatchIndex;
            }
        } else {
            delete i.stock.dataset.editingBatchIndex;
        }
        i.stock.disabled = false; 
        i.stock.classList.remove('bg-gray-200', 'cursor-not-allowed', 'opacity-50');
    }
    if (i.lowStock) i.lowStock.value = safeVal(p.lowStockThreshold, true);

    const toDateInput = (val) => {
        if (!val) return "";
        const strVal = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(strVal)) return strVal;
        const parts = strVal.split(/[-/]/);
        if (parts.length === 3) {
            if (parts[2].length === 4) {
                return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        }
        return ""; 
    };

    // --- POPULATE NEW FIELDS ---
    setEl('prod-sl', safeVal(source.sl || p.sl));
    setEl('prod-hsn', safeVal(p.hsn));
    setEl('prod-batch', safeVal(source.batchNo === 'LEGACY-STOCK' ? '' : (source.batchNo || p.batch)));
    setEl('prod-upc', safeVal(p.upc, true) || "1");
    setEl('prod-mrp', safeVal(source.mrp || p.mrp, true));
    
    const mMrp = parseFloat(source.mrp || p.mrp) || 0;
    const mPrice = parseFloat(source.price || p.price) || 0;
    const discVal = document.getElementById('inv-discount-val');
    const discToggle = document.getElementById('inv-discount-type-toggle');
    
    if (discVal && mMrp > mPrice) {
        discVal.value = (mMrp - mPrice).toFixed(2);
        if (discToggle) discToggle.checked = false; 
    }
    
    let baseRateVal = parseFloat(source.baseRate);
    if (isNaN(baseRateVal)) baseRateVal = 0;

    const schDisc = parseFloat(source.schDisc) || 0;
    const rsDisc = parseFloat(source.rsDisc) || 0;
    const netAmt = parseFloat(source.netAmt) || 0;
    const cost = parseFloat(source.cost || p.cost) || 0;
    const gst = parseFloat(source.gstSlab || p.gstSlab) || 0;
    const cess = parseFloat(source.cess || p.cess) || 0;
    
    if (baseRateVal === 0 && (cost > 0 || netAmt > 0)) {
        const taxMultiplier = 1 + (gst / 100) + (cess / 100);
        if (netAmt > 0) {
            const taxableAmt = netAmt / taxMultiplier;
            baseRateVal = (taxableAmt + schDisc + rsDisc) / calcQty;
        } else if (cost > 0) {
            const unitCostWithoutTax = cost / taxMultiplier;
            baseRateVal = (unitCostWithoutTax * calcQty + schDisc + rsDisc) / calcQty;
        }
    }
    
    setEl('prod-base-rate', baseRateVal > 0 ? baseRateVal.toFixed(2) : "0");
    setEl('prod-sch-disc', schDisc > 0 ? schDisc.toFixed(2) : "0");
    setEl('prod-rs-disc', rsDisc > 0 ? rsDisc.toFixed(2) : "0");
    setEl('prod-taxable-amt', safeVal(source.taxableAmt || p.taxableAmt, true));
    setEl('prod-cgst', safeVal(source.cgstAmt || p.cgstAmt, true));
    setEl('prod-sgst', safeVal(source.sgstAmt || p.sgstAmt, true));
    setEl('prod-net-amt', safeVal(source.netAmt || p.netAmt, true));
    setEl('prod-cases', cases);
    setEl('prod-pieces', pieces);
    setEl('prod-free-qty', freeQty);

    if (i.gst) i.gst.value = safeVal(source.gstSlab || p.gstSlab, true);
    if (i.cess) i.cess.value = safeVal(source.cess || p.cess, true); 

    if (typeof window.calculateInvoiceBreakdown === 'function') {
        window.calculateInvoiceBreakdown('manual-fetch');
    }
    
    setEl('expirationDate', toDateInput(source.expirationDate || p.expirationDate));
    if (i.packaged) i.packaged.value = toDateInput(source.packagedDate || p.packagedDate || (p.type === 'manufactured' ? (p.createdAt ? p.createdAt.split('T')[0] : '') : ''));
    if (i.bestBefore) i.bestBefore.value = isNaN(parseInt(p.bestBeforeMonths)) ? "" : parseInt(p.bestBeforeMonths);
    setEl('prod-date', toDateInput(source.date || p.purchaseDate || (p.createdAt ? p.createdAt.split('T')[0] : ''))); 

    const dealerInput = document.getElementById('prod-dealer');
    const dealerIdInput = document.getElementById('prod-dealer-id');
    const phoneInput = document.getElementById('prod-dealer-phone');
    const dealerGstInput = document.getElementById('prod-gstin');
    const panInput = document.getElementById('prod-dealer-pan');
    const stateInput = document.getElementById('prod-dealer-state');

    if (p.type === 'manufactured' || p.type === 'homemade') {
        if (dealerInput) dealerInput.value = 'Internal Manufacturing';
        if (dealerIdInput) dealerIdInput.value = 'INTERNAL_MFG';
        if (phoneInput) phoneInput.value = '';
        if (dealerGstInput) dealerGstInput.value = '';
        if (panInput) panInput.value = '';
        if (stateInput) stateInput.value = '';
    } else {
        let dName = source.dealerName || p.dealerName || '';
        let dId = source.dealerId || source.supplierId || p.dealerId || '';
        
        if (dName.startsWith('MERCH-')) {
            dId = dName;
            dName = '';
        }

        let cachedDealer = null;
        if (!dName && dId && typeof localDealersCache !== 'undefined') {
            cachedDealer = localDealersCache.find(d => d.id === dId);
            if (cachedDealer) dName = cachedDealer.name || cachedDealer.storeName;
        }

        if (dealerInput) dealerInput.value = safeVal(dName);
        if (dealerIdInput) dealerIdInput.value = safeVal(dId);
        
        // 🚀 THE FIX: Fetch Phone, GSTIN, PAN, and State from the active batch or cache
        if (phoneInput) {
            phoneInput.value = safeVal(source.dealerPhone || p.dealerPhone || (cachedDealer ? cachedDealer.phone : '')).replace(/^\+?91/, '');
            
            // Safe listener binding to prevent memory leaks
            if (!phoneInput.dataset.listenerBound) {
                phoneInput.addEventListener('input', (e) => {
                    let digits = e.target.value.replace(/\D/g, '');
                    if (digits.startsWith('91') && digits.length > 10) digits = digits.substring(2);
                    if (digits.length > 10) digits = digits.substring(0, 10);
                    if (e.target.value !== digits) e.target.value = digits;

                    clearTimeout(dealerLookupDebounce);
                    if (digits.length === 10) {
                        dealerLookupDebounce = setTimeout(() => handleDealerInfoChange('phone', digits), 300);
                    }
                });
                phoneInput.dataset.listenerBound = 'true';
            }
        }

        const gstinInputEl = dealerGstInput || document.getElementById('prod-gstin');
        if (gstinInputEl) {
            gstinInputEl.value = safeVal(source.dealerGstin || p.gstin || (cachedDealer ? cachedDealer.gstin : ''));
            
            if (!gstinInputEl.dataset.listenerBound) {
                gstinInputEl.addEventListener('input', (e) => {
                    let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    if (e.target.value !== val) e.target.value = val;

                    const verifyBtn = document.getElementById('verify-gstin-btn');
                    if (verifyBtn) {
                        if (val.length === 15) verifyBtn.classList.remove('hidden');
                        else verifyBtn.classList.add('hidden');
                    }

                    // 🚀 THE FIX: Auto-Extract State from the first 2 digits of GSTIN
                    if (val.length >= 2) {
                        const GST_STATE_CODES = {
                            '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', 
                            '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', 
                            '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', 
                            '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', 
                            '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', 
                            '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli', '27': 'Maharashtra', '29': 'Karnataka', 
                            '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', 
                            '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh'
                        };
                        const stateCode = val.substring(0, 2);
                        const stateName = GST_STATE_CODES[stateCode];
                        const stateInput = document.getElementById('prod-dealer-state');
                        
                        if (stateInput && !stateInput.value && stateName) {
                            stateInput.value = `${stateCode}-${stateName}`;
                            stateInput.classList.add('bg-emerald-50', 'transition-colors');
                            setTimeout(() => stateInput.classList.remove('bg-emerald-50'), 800);
                        }
                    }

                    // 🚀 THE FIX: Ensure string is long enough before extracting the 10-digit PAN
                    if (val.length >= 12) {
                        const pInput = document.getElementById('prod-dealer-pan');
                        if (pInput && !pInput.value) {
                            pInput.value = val.substring(2, 12);
                            pInput.classList.add('bg-emerald-50', 'transition-colors');
                            setTimeout(() => pInput.classList.remove('bg-emerald-50'), 800);
                        }
                    }

                    clearTimeout(dealerLookupDebounce);
                    if (val.length === 15) {
                        dealerLookupDebounce = setTimeout(() => handleDealerInfoChange('gstin', val), 300);
                    }
                });
                gstinInputEl.dataset.listenerBound = 'true';
            }
        }
        
        if (panInput) panInput.value = safeVal(source.dealerPan || p.dealerPan || (cachedDealer ? cachedDealer.pan : ''));
        if (stateInput) stateInput.value = safeVal(source.dealerState || p.dealerState || (cachedDealer ? cachedDealer.state : ''));
        setEl('prod-invoice', safeVal(source.supplierInvoice || p.supplierInvoice));
    }

    unlockDealerFieldsSafe();

    [dealerInput, dealerIdInput, dealerGstInput, phoneInput, panInput, stateInput].forEach(f => {
        if (f) {
            if (p.dealerId && f.value.trim() !== '') {
                f.disabled = true; 
                f.classList.add('bg-gray-100', 'cursor-not-allowed', 'text-gray-500');
            } else {
                f.disabled = false; 
                f.classList.remove('bg-gray-100', 'cursor-not-allowed', 'text-gray-500');
            }
        }
    });

    const locDropdown = document.getElementById('inv-form-location');
    if (locDropdown) locDropdown.value = p.locationId || 'main';

    if (i.unit) i.unit.value = p.unit || 'units';
    
    const poCheck = document.getElementById('prod-in-po-catalog');
    if (poCheck) poCheck.checked = (p.inPoCatalog !== false);
    
    const typeSelect = document.getElementById('productType');
    const builder = document.getElementById('bundle-builder');
    
    let pType = p.type || 'standard';
    if (pType === 'manufactured' || pType === 'homemade') pType = 'standard'; 

    if (typeSelect) {
        typeSelect.value = pType;
        if (typeSelect.selectedIndex === -1) typeSelect.value = 'standard';
    }

    if (pType === 'bundle') {
        if (builder) builder.classList.remove('hidden');
        bundleComponents = p.bundleComponents || [];
        if (typeof renderBundleTable === 'function') renderBundleTable();
    } else {
        if (builder) builder.classList.add('hidden');
        bundleComponents = [];
    }

    const titleEl = DOM.inventory?.formTitle || document.getElementById('form-title') || document.getElementById('inventory-form-title');
    if (titleEl) titleEl.textContent = `Edit / Restock: ${p.name}`;

    const saveBtn = DOM.inventory?.saveBtn || document.getElementById('save-product-btn');
    if (saveBtn) saveBtn.textContent = 'Update Product & Stock';

    const cancelBtn = DOM.inventory?.cancelBtn || document.getElementById('cancel-edit-btn');
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    if (typeof toggleProductTypeUI === 'function') toggleProductTypeUI(p.type || 'standard');
    const formEl = DOM.inventory?.form || document.getElementById('product-form');
    if (formEl) formEl.scrollIntoView({ behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const retailCheck = document.getElementById('prod-permit-retail');
    if (retailCheck) retailCheck.checked = (p.permitRetail !== false);

    const regSection = document.getElementById('batch-registry-section');
    const regBody = document.getElementById('batch-registry-body');
    const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';

    if (regSection && regBody) {
        regSection.classList.remove('hidden'); 
        
        let batches = sortBatchesFefoFifo(workingBatches); 
        
        if (batches.length === 0 && liveStock > 0) {
            batches = [{
                batchNo: 'LEGACY-STOCK',
                date: p.purchaseDate || (p.createdAt ? p.createdAt.split('T')[0] : 'Unknown'),
                qty: liveStock,
                cost: parseFloat(p.cost) || 0,
                expirationDate: p.expirationDate || '',
                packagedDate: p.packagedDate || '',
                supplierId: p.dealerId || '',
                dealerId: p.dealerId || '',
                dealerName: p.dealerName || '',
                dealerPhone: p.dealerPhone || '',
                dealerGstin: p.gstin || '',
                dealerPan: p.dealerPan || '',
                dealerState: p.dealerState || '',
                supplierInvoice: p.supplierInvoice || '',
                baseRate: p.baseRate || 0,
                gstSlab: p.gstSlab || 0,
                cess: p.cess || 0,
                schDisc: p.schDisc || 0,
                rsDisc: p.rsDisc || 0,
                taxableAmt: p.taxableAmt || 0,
                netAmt: p.netAmt || 0
            }];
        }

        if (batches.length > 0) {
            let rows = '';
            let tQty = 0, tVal = 0;
            let activeIndexToLoad = 0; // 🚀 ADDED: Tracks the active FEFO index
            
            window._tempBatchList = batches;
            
            batches.forEach((b, index) => {
                const val = b.qty * b.cost;
                tQty += b.qty;
                tVal += val;
                
                const displayQty = Number.isInteger(b.qty) ? b.qty : parseFloat(b.qty).toFixed(2);
                const batchRef = escapeHTML(b.batchNo || 'SYS-ADJ');
                
                let dName = b.dealerName || '';
                if (dName.startsWith('MERCH-')) {
                    b.supplierId = dName;
                    dName = '';
                }
                if (!dName && (b.supplierId || b.dealerId) && typeof localDealersCache !== 'undefined') {
                    const cD = localDealersCache.find(d => d.id === b.supplierId || d.id === b.dealerId);
                    if (cD) dName = cD.name || cD.storeName;
                }
                
                const supplierRef = escapeHTML(b.supplierInvoice ? `Inv: ${b.supplierInvoice}` : (dName || b.supplierId || ''));
                
                // 🚀 THE FIX: Visually flag quarantined expired batches AND the active batch
                const isExpired = b.expirationDate && new Date(b.expirationDate).getTime() < new Date().setHours(0,0,0,0);
                const isActiveFEFO = activeBatch && b.timestamp === activeBatch.timestamp && b.batchNo === activeBatch.batchNo;
                
                if (isActiveFEFO) activeIndexToLoad = index; // 🚀 Capture the active index

                let rowClass = 'hover:bg-indigo-50/50';
                if (isExpired) rowClass = 'bg-red-50/50 hover:bg-red-100/50 opacity-80';
                else if (isActiveFEFO) rowClass = 'bg-emerald-50/70 border-l-4 border-emerald-500 hover:bg-emerald-100/70';
                
                const expTextClass = isExpired ? 'text-red-600 font-black' : (b.expirationDate ? (isActiveFEFO ? 'text-emerald-700 font-bold' : 'text-orange-600') : 'text-slate-400');
                const expBadge = isExpired ? '<br><span class="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[8px] uppercase tracking-widest mt-1 inline-block border border-red-200">Quarantined</span>' : (isActiveFEFO ? '<br><span class="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[8px] uppercase tracking-widest mt-1 inline-block border border-emerald-300 shadow-sm">Active Batch</span>' : '');
                
                rows += `<tr class="${rowClass} transition-colors cursor-pointer group" ondblclick="window.loadBatchToForm(${index})" title="Double-click to load into form">
                    <td class="p-3">${b.date}</td>
                    <td class="p-3 font-mono text-[10px] bg-white rounded px-2 py-0.5 w-fit mt-1.5 border border-slate-200 shadow-sm transition-colors">
                        ${batchRef}<br>
                        <span class="text-[9px] text-slate-400 truncate max-w-[120px] block">${supplierRef}</span>
                    </td>
                    <td class="p-3 text-center text-xs font-bold ${expTextClass}">${escapeHTML(b.expirationDate || '--')}${expBadge}</td>
                    <td class="p-3 text-right font-black ${isExpired ? 'text-red-500' : 'text-indigo-600'}">${displayQty}</td>
                    <td class="p-3 text-right">${currency}${parseFloat(b.cost).toFixed(2)}</td>
                    <td class="p-3 text-right font-bold text-slate-800">${currency}${val.toFixed(2)}</td>
                </tr>`;
            });
            
            regBody.innerHTML = rows;
            document.getElementById('reg-total-qty').textContent = Number.isInteger(tQty) ? tQty : tQty.toFixed(2);
            document.getElementById('reg-total-val').textContent = tVal.toFixed(2);
            document.getElementById('reg-avg-cost').textContent = currency + (tQty > 0 ? (tVal / tQty) : 0).toFixed(2);

            // 🚀 THE FIX: Force the UI to ingest the exact Active Batch data (Supplier, Dates, Cost)
            setTimeout(() => window.loadBatchToForm(activeIndexToLoad), 50);
        } else {
            regBody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-400 italic">No stock batches found. Add stock above to create a new batch.</td></tr>';
            document.getElementById('reg-total-qty').textContent = '0';
            document.getElementById('reg-total-val').textContent = '0.00';
            document.getElementById('reg-avg-cost').textContent = currency + '0.00';
        }
    }
    
    let isLatest = true;
    if (activeBatch && p.batches && p.batches.length > 0) {
        const latestTimestamp = Math.max(...p.batches.map(x => x.timestamp || 0));
        isLatest = (activeBatch.timestamp === latestTimestamp);
    }
    
    if (typeof window.toggleBatchEditability === 'function') {
        window.toggleBatchEditability(isLatest);
    }

    // 🚀 THE FIX: Force the Active Batch (Nearest Expiry FEFO) to push into the editing form
    if (activeBatch && window._tempBatchList) {
        const activeIndexToLoad = window._tempBatchList.findIndex(b => b.timestamp === activeBatch.timestamp && b.batchNo === activeBatch.batchNo);
        if (activeIndexToLoad > -1) {
            setTimeout(() => window.loadBatchToForm(activeIndexToLoad), 50);
        }
    }
}
async function deleteProduct(id, name) {
    const product = localProductsCache.find(p => p.id === id);
    if (product && parseFloat(product.stockLevel) > 0) {
        showModal('Cannot Delete', `Item has **${product.stockLevel}** stock. Adjust to 0 first.`, 'error');
        return;
    }

    showModal('Confirm Delete', `Are you sure you want to delete **${escapeHTML(name)}**?`, 'confirm', async () => {
        try {
            await deleteDoc(doc(getProductsRef(), id));
            showModal('Success', 'Item deleted.', 'success'); 
            logInventoryChange('DELETE', name, 'Deleted by admin');
        } catch (e) { console.error(e); }
    });
}

// =========================================================
// 5. UTILITIES (SKU, BARCODE, STOCK ADJUSTMENT)
// =========================================================
async function generateNextSku() {
    try {
        // 🚀 THE FIX: Read from the local SQLite cache instead of Firebase
        let allProducts = typeof localProductsCache !== 'undefined' ? localProductsCache : [];
        
        if (window.dbAPI && window.dbAPI.getProducts) {
            const dbProducts = await window.dbAPI.getProducts();
            if (dbProducts && dbProducts.length > 0) allProducts = dbProducts;
        }

        if (!allProducts || allProducts.length === 0) return '100001';

        let maxSkuNum = 100000; // Baseline
        
        allProducts.forEach(p => {
            const numericPart = (p.sku || '').replace(/\D/g, '');
            if (numericPart) {
                const num = parseInt(numericPart, 10);
                if (num > maxSkuNum) maxSkuNum = num;
            }
        });
        
        return String(maxSkuNum + 1);
    } catch (e) {
        console.warn("Generating offline-safe SKU fallback.");
        return Date.now().toString().slice(-8); 
    }
}

export function handleGenerateBarcode() {
    if (DOM.inventory.inputs.barcode) {
        const randomBarcode = Math.floor(100000000000 + Math.random() * 900000000000).toString();
        DOM.inventory.inputs.barcode.value = randomBarcode;
    }
}

export async function printProductBarcode(productId) {
    const p = localProductsCache.find(x => x.id === productId);
    if (!p) return;
    
    const code = p.barcode || p.sku || '000000';
    const currencySymbol = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';
    const savedPrinterPref = localStorage.getItem('mifela_barcode_printer') || 'label_50x25';
    
    let storeName = 'RETAIL STORE';
    try {
        const currentStoreId = typeof getStoreId === 'function' ? getStoreId() : window.primaryStoreId;
        const currentAppId = typeof window !== 'undefined' && window.__app_id ? window.__app_id : appId;
        
        if (currentStoreId) {
            const profileSnap = await getDoc(doc(db, `artifacts/${currentAppId}/stores/${currentStoreId}/settings/profile`));
            if (profileSnap.exists() && profileSnap.data().storeName) {
                storeName = profileSnap.data().storeName;
            }
        }
    } catch(e) {
        console.warn("Failed to fetch store name for barcode", e);
    }

    const formatCompactDate = (dStr) => {
        if (!dStr) return '--';
        const d = new Date(dStr);
        if (isNaN(d.getTime())) return '--';
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
    };

    // 🚀 THE FIX: FEFO BATCH FILTERING + PHANTOM STOCK RECONCILIATION
    // This ensures the barcode printer sees the exact same working batches as the Edit form
    const todayTime = new Date().setHours(0, 0, 0, 0);
    const liveStock = parseFloat(p.stockLevel) || 0;
    let workingBatches = p.batches ? JSON.parse(JSON.stringify(p.batches)) : [];

    let sumActiveBatches = 0;
    workingBatches.forEach(b => {
        const isExpired = b.expirationDate && new Date(b.expirationDate).getTime() < todayTime;
        if (!isExpired) sumActiveBatches += (parseFloat(b.qty) || 0);
    });

    if (workingBatches.length > 0 && Math.abs(liveStock - sumActiveBatches) > 0.01) {
        if (liveStock < sumActiveBatches) {
            let diff = sumActiveBatches - liveStock;
            workingBatches = sortBatchesFefoFifo(workingBatches);
            for (let j = 0; j < workingBatches.length; j++) {
                if (diff <= 0) break;
                const isExpired = workingBatches[j].expirationDate && new Date(workingBatches[j].expirationDate).getTime() < todayTime;
                if (isExpired) continue;

                if (workingBatches[j].qty <= diff) {
                    diff -= workingBatches[j].qty;
                    workingBatches[j].qty = 0;
                } else {
                    workingBatches[j].qty -= diff;
                    diff = 0;
                }
            }
            workingBatches = workingBatches.filter(b => b.qty > 0.001);
        } else if (liveStock > sumActiveBatches) {
            workingBatches.push({
                batchNo: 'LEGACY-RECOVERY',
                date: p.purchaseDate || (p.createdAt ? p.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]),
                qty: liveStock - sumActiveBatches,
                cost: parseFloat(p.cost) || 0,
                supplierId: p.dealerId || 'SYSTEM',
                dealerName: p.dealerName || '',
                timestamp: new Date().getTime()
            });
        }
    } else if (workingBatches.length === 0 && liveStock > 0) {
        workingBatches.push({
            batchNo: 'LEGACY-STOCK',
            date: p.purchaseDate || (p.createdAt ? p.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]),
            qty: liveStock,
            cost: parseFloat(p.cost) || 0,
            supplierId: p.dealerId || 'SYSTEM',
            dealerName: p.dealerName || '',
            timestamp: new Date().getTime()
        });
    }

    // 1. Remove expired batches completely. 2. Sort the remaining by earliest expiry (FEFO).
    let activeBatches = workingBatches.filter(b => {
        if (!b.expirationDate) return true;
        return new Date(b.expirationDate).getTime() >= todayTime;
    }).filter(b => parseFloat(b.qty) > 0).sort((a, b) => {
        const hasExpA = Boolean(a.expirationDate);
        const hasExpB = Boolean(b.expirationDate);
        if (hasExpA && hasExpB) return new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime();
        if (hasExpA) return -1;
        if (hasExpB) return 1;
        return (a.timestamp || 0) - (b.timestamp || 0);
    });

    let activeBatch = activeBatches[0] || null;
    let defaultQty = activeBatch ? (activeBatch.qty > 0 ? activeBatch.qty : 1) : (parseFloat(p.stockLevel) > 0 ? parseFloat(p.stockLevel) : 1);

    const mfgDateRaw = activeBatch?.date || p.packagedDate || p.mfgDate || null;
    const mfgDate = mfgDateRaw ? formatCompactDate(mfgDateRaw) : '--';
    const expDateRaw = activeBatch?.expirationDate || p.expirationDate || null;
    const expDate = expDateRaw ? formatCompactDate(expDateRaw) : '--';

    let modal = document.getElementById('barcode-preview-modal');
    if (!modal) {
        const modalHtml = `
            <div id="barcode-preview-modal" class="fixed inset-0 bg-slate-900/80 hidden items-center justify-center p-4 z-[200] transition-opacity">
                <div class="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-md flex flex-col items-center relative border border-slate-100">
                    <button id="close-barcode-modal" class="absolute top-4 right-4 text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 p-2 rounded-full transition-colors">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                    
                    <h3 class="text-xl font-black text-slate-800 mb-4 flex items-center gap-2">
                        <div class="bg-indigo-100 text-indigo-600 p-1.5 rounded-lg">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"></path></svg>
                        </div>
                        Print Batch Labels
                    </h3>

                    ${activeBatches.length > 0 ? `
                    <div class="w-full bg-slate-50 p-2.5 rounded-xl border border-slate-200 shadow-inner mb-3 text-left">
                        <label class="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Select Source Batch</label>
                        <select id="barcode-batch-selector" class="w-full text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2 outline-none cursor-pointer focus:ring-2 focus:ring-indigo-500 shadow-sm transition-all">
                            ${activeBatches.map((b, i) => `
                                <option value="${i}">${escapeHTML(b.batchNo || 'LEGACY')} | Qty: ${b.qty} | Exp: ${b.expirationDate ? formatCompactDate(b.expirationDate) : 'N/A'}</option>
                            `).join('')}
                        </select>
                    </div>
                    ` : ''}

                    <div class="w-full bg-slate-50 p-4 rounded-2xl border border-slate-200 shadow-inner mb-4 flex gap-3 text-left">
                        <div class="flex-1">
                            <label class="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Override MFG Date</label>
                            <input type="text" id="barcode-edit-mfg" class="w-full text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 transition-colors shadow-sm" placeholder="DD/MM/YY">
                        </div>
                        <div class="flex-1">
                            <label class="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Override EXP Date</label>
                            <input type="text" id="barcode-edit-exp" class="w-full text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 transition-colors shadow-sm" placeholder="DD/MM/YY">
                        </div>
                    </div>

                    <div class="flex items-center justify-between w-full mb-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200 shadow-inner">
                        <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Printer Profile</span>
                        <select id="barcode-printer-type" class="text-xs font-bold text-indigo-700 bg-white border border-indigo-100 rounded-lg px-3 py-1.5 outline-none cursor-pointer focus:ring-2 focus:ring-indigo-500 shadow-sm transition-all">
                            <option value="label_34x22_3up">3-Across Thermal (34x22mm)</option>
                            <option value="label_50x25">Thermal Label (50x25mm)</option>
                            <option value="label_38x25">Small Label (38x25mm)</option>
                            <option value="receipt_80">Receipt Roll (80mm)</option>
                        </select>
                    </div>

                    <div class="flex items-center justify-between w-full mb-4 bg-slate-50 p-2.5 rounded-xl border border-slate-200 shadow-inner">
                        <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Print Quantity</span>
                        <input type="number" id="barcode-print-qty" min="1" class="text-xs font-bold text-indigo-700 bg-white border border-indigo-100 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm w-20 text-center">
                    </div>
                    
                    <div class="bg-slate-100 p-6 rounded-2xl mb-6 w-full flex justify-center shadow-inner border border-slate-200">
                        <canvas id="barcode-canvas-element" class="shadow-md border border-slate-300 bg-white max-w-full h-auto"></canvas>
                    </div>
                    
                    <div class="flex w-full gap-2">
                        <button id="cancel-barcode-btn" class="flex-1 py-3.5 bg-slate-100 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-200 transition-colors">Cancel</button>
                        <button id="download-barcode-btn" class="flex-1 py-3.5 bg-slate-800 text-white text-sm font-bold rounded-xl hover:bg-slate-900 transition-colors flex justify-center items-center gap-2 shadow-md">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg> PNG
                        </button>
                        <button id="confirm-print-barcode-btn" class="flex-[1.5] py-3.5 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-200 flex justify-center items-center gap-2 transition-all active:scale-95">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg> Print
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
    modal = document.getElementById('barcode-preview-modal');
    const closeModal = () => {
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex', 'fixed', 'inset-0'); 
        modal.style.display = 'none'; // Hard CSS override
        
        document.body.classList.remove('overflow-hidden');
        document.documentElement.classList.remove('overflow-hidden');
        
        setTimeout(() => {
            if (modal && modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        }, 300);
    };
    
    const closeTopBtn = document.getElementById('close-barcode-modal');
    if (closeTopBtn) closeTopBtn.onclick = closeModal;
    
    const cancelBottomBtn = document.getElementById('cancel-barcode-btn');
    if (cancelBottomBtn) cancelBottomBtn.onclick = closeModal;

    const mfgInput = document.getElementById('barcode-edit-mfg');
    const expInput = document.getElementById('barcode-edit-exp');
    const qtyInput = document.getElementById('barcode-print-qty');
    
    if (mfgInput) mfgInput.value = mfgDate;
    if (expInput) expInput.value = expDate;
    if (qtyInput) qtyInput.value = defaultQty;

    const printerDropdown = document.getElementById('barcode-printer-type');
    if (printerDropdown) printerDropdown.value = savedPrinterPref;

    // 🚀 THE FIX: BATCH SELECTOR LISTENER
    // Automatically load the date and stock quantities of the batch selected from the dropdown
    const batchSelector = document.getElementById('barcode-batch-selector');
    if (batchSelector) {
        batchSelector.addEventListener('change', (e) => {
            const selectedBatch = activeBatches[e.target.value];
            if (selectedBatch) {
                const selMfg = selectedBatch.date || selectedBatch.packagedDate;
                if (mfgInput) mfgInput.value = selMfg ? formatCompactDate(selMfg) : '--';
                if (expInput) expInput.value = selectedBatch.expirationDate ? formatCompactDate(selectedBatch.expirationDate) : '--';
                if (qtyInput) qtyInput.value = selectedBatch.qty > 0 ? selectedBatch.qty : 1;
                renderCanvasLabel();
            }
        });
    }

    const renderCanvasLabel = () => {
        const type = printerDropdown.value;
        const canvas = document.getElementById('barcode-canvas-element');
        const ctx = canvas.getContext('2d');

        const liveMfg = mfgInput ? mfgInput.value.trim() : mfgDate;
        const liveExp = expInput ? expInput.value.trim() : expDate;

        let w = 406, h = 203; 
        let labelWidth = '2in';
        let labelHeight = '1in';

        if (type === 'label_50x25') { 
            w = 406; h = 203; 
            labelWidth = '2in'; labelHeight = '1in';
        } else if (type === 'label_38x25') { 
            w = 304; h = 203; 
            labelWidth = '1.5in'; labelHeight = '1in';
        } else if (type === 'label_34x22_3up') { 
            w = 272; h = 176; 
            labelWidth = '34mm'; labelHeight = '22mm';
        } else if (type === 'receipt_80') { 
            w = 576; h = 400;  
            labelWidth = '80mm'; labelHeight = 'auto';
        }

        canvas.width = w;
        canvas.height = h;
        canvas.dataset.printWidth = labelWidth;
        canvas.dataset.printHeight = labelHeight;

        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#000000";

        const drawText = (txt, x, y, font, align="center") => {
            ctx.font = font; ctx.textAlign = align; ctx.fillText(txt, x, y);
        };

        const priceStr = `${currencySymbol}${parseFloat(p.price).toFixed(2)}`;
        let pName = p.name || 'Unknown Product';

        const tinyFont = 'bold 14px "OCR-B", "OCR B Std", "Courier New", monospace';
        const smallFont = 'bold 16px "OCR-B", "OCR B Std", "Courier New", monospace';
        const baseFont = 'bold 20px "OCR-B", "OCR B Std", "Courier New", monospace';
        const priceFont = 'bold 24px "OCR-B", "OCR B Std", "Courier New", monospace';

        const tempCanvas = document.createElement('canvas');
        let bcHeightSetting = 50;
        if (type === 'label_34x22_3up') bcHeightSetting = 40; 

        try {
            if (window.JsBarcode) {
                JsBarcode(tempCanvas, code, {
                    format: "CODE128",
                    displayValue: false, 
                    margin: 0,
                    height: bcHeightSetting,
                    width: 2
                });
            }
        } catch(e) { console.error("Barcode generation failed", e); }

        if (type === 'label_34x22_3up') {
            const cx = w / 2;
            drawText(storeName.toUpperCase(), cx, 18, tinyFont);
            ctx.beginPath(); ctx.moveTo(5, 24); ctx.lineTo(w-5, 24); ctx.stroke();
            
            if (pName.length > 18) pName = pName.substring(0, 16) + '..';
            drawText(pName, cx, 42, smallFont);

            const bcWidth = Math.min(tempCanvas.width, w - 10);
            const bcHeight = 40; 
            const bcX = (w - bcWidth) / 2;
            ctx.drawImage(tempCanvas, bcX, 52, bcWidth, bcHeight);

            drawText(code, cx, 110, tinyFont);
            drawText(`MFG:${liveMfg}`, 5, 140, tinyFont, "left");
            drawText(`EXP:${liveExp}`, 5, 165, tinyFont, "left");
            drawText(priceStr, w - 5, 160, baseFont, "right");

        } else if (type === 'label_50x25' || type === 'label_38x25') {
            const cx = w / 2;
            drawText(storeName.toUpperCase(), cx, 24, baseFont);
            ctx.beginPath(); ctx.moveTo(10, 32); ctx.lineTo(w-10, 32); ctx.stroke();
            
            const maxLen = type === 'label_38x25' ? 16 : 22;
            if (pName.length > maxLen) pName = pName.substring(0, maxLen - 2) + '..';
            drawText(pName, cx, 56, baseFont);

            const bcWidth = Math.min(tempCanvas.width, w - 20);
            const bcHeight = 60;
            const bcX = (w - bcWidth) / 2;
            ctx.drawImage(tempCanvas, bcX, 68, bcWidth, bcHeight);

            drawText(code, cx, 145, smallFont);
            drawText(`MFG:${liveMfg}`, 10, 175, smallFont, "left");
            drawText(`EXP:${liveExp}`, 10, 195, smallFont, "left");
            drawText(priceStr, w - 10, 190, priceFont, "right");

        } else {
            const cx = w/2;
            if (pName.length > 35) pName = pName.substring(0, 32) + '...';

            drawText(storeName.toUpperCase(), cx, 40, "900 28px monospace");
            ctx.beginPath(); ctx.moveTo(20, 55); ctx.lineTo(w-20, 55); ctx.stroke();
            drawText(pName, cx, 95, "bold 32px monospace");
            
            const bcWidth = Math.min(tempCanvas.width, w - 60);
            const bcHeight = 120;
            const bcX = (w - bcWidth) / 2;
            ctx.drawImage(tempCanvas, bcX, 120, bcWidth, bcHeight);

            drawText(code, cx, 270, "bold 24px monospace");

            drawText(`MFG: ${liveMfg}`, 20, 320, "bold 24px monospace", "left");
            drawText(`EXP: ${liveExp}`, 20, 360, "bold 24px monospace", "left");
            drawText(priceStr, w - 20, 350, "900 48px monospace", "right");
        }
    };

    renderCanvasLabel();

    [mfgInput, expInput].forEach(el => {
        if (el) el.addEventListener('input', renderCanvasLabel);
    });

    printerDropdown.onchange = (e) => {
        localStorage.setItem('mifela_barcode_printer', e.target.value);
        renderCanvasLabel();
    };

    document.getElementById('download-barcode-btn').onclick = async () => {
        const canvas = document.getElementById('barcode-canvas-element');
        if (canvas) {
            const dataUrl = canvas.toDataURL("image/png");
            const safeName = escapeHTML(p.sku || p.name).replace(/[^a-z0-9]/gi, '_');
            const fileName = `Label_${safeName}.png`;

            if (window.electronAPI && typeof window.electronAPI.saveFile === 'function') {
                try {
                    const base64Data = dataUrl.split(',')[1];
                    const binaryString = window.atob(base64Data);
                    const len = binaryString.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    await window.electronAPI.saveFile(bytes.buffer, fileName);
                    if (typeof showToast === 'function') showToast("Downloaded", "Label saved successfully.", "success");
                } catch (e) { console.error("Electron PNG Save failed:", e); }
            } else {
                const link = document.createElement('a');
                link.download = fileName;
                link.href = dataUrl;
                link.click();
                if (typeof showToast === 'function') showToast("Downloaded", "Label saved as PNG.", "success");
            }
        }
    };

    document.getElementById('confirm-print-barcode-btn').onclick = async () => {
        const isDesktop = window.electronAPI && typeof window.electronAPI.printSilent === 'function';
        const printQuantity = parseInt(document.getElementById('barcode-print-qty')?.value) || 1;
        const mediaId = document.getElementById('barcode-printer-type').value;

        // 1. Fetch from the correct localStorage keys
        let targetPrinter = '';
        let isSilent = true; 
        try {
            const config = JSON.parse(localStorage.getItem('mifela_printer_config') || '{}');
            if (config.printerName) targetPrinter = config.printerName;
            if (config.silent !== undefined) isSilent = config.silent;
            
            const smartConfig = JSON.parse(localStorage.getItem('mifela_smart_printers') || '{}');
            if (!targetPrinter && smartConfig.barcode) targetPrinter = smartConfig.barcode;
        } catch(e) {}

        // 🚀 SAFEGUARD: Fallback to the OS default printer if local storage is completely empty
        if (!targetPrinter && isDesktop && window.electronAPI.getPrinters) {
            try {
                const printers = await window.electronAPI.getPrinters();
                const defaultP = printers.find(pr => pr.isDefault) || printers[0];
                if (defaultP) targetPrinter = defaultP.name;
            } catch(e) {}
        }

        if (!targetPrinter) {
            if (typeof showModal === 'function') showModal("No Printer Found", "Your operating system has no printers installed, or none are selected in Settings.", "error");
            return;
        }

        const isRawLabelPrinter = mediaId === 'label_34x22_3up' || 
                                  targetPrinter.toLowerCase().includes('tsc') || 
                                  targetPrinter.toLowerCase().includes('zebra') || 
                                  targetPrinter.toLowerCase().includes('zdesigner');

        const liveMfg = mfgInput ? mfgInput.value.trim() : mfgDate;
        const liveExp = expInput ? expInput.value.trim() : expDate;

        const btn = document.getElementById('confirm-print-barcode-btn');
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<svg class="animate-spin w-4 h-4 mr-2" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Sending...`;

        try {
            if (isDesktop && isRawLabelPrinter) {
                const connectionConfig = { type: 'os', address: targetPrinter };

                const printerProfile = {
                    name: targetPrinter,
                    manufacturer: 'tsc',
                    dpi: 203,
                    connection: connectionConfig 
                };

                const labelData = {
                    storeName: storeName.toUpperCase(),
                    name: p.name || 'Unknown Product',
                    sku: code,
                    mfgDate: liveMfg,
                    expDate: liveExp,
                    price: parseFloat(p.price).toFixed(2)
                };

                if (typeof PrinterManager === 'undefined') {
                    throw new Error("PrinterManager module is missing. Check your import paths.");
                }

                await PrinterManager.printLabel(printerProfile, mediaId, labelData, printQuantity);
                if (typeof showToast === 'function') showToast("Success", `Sent ${printQuantity} labels to printer buffer.`, "success");
                closeModal(); 
                return;
            }

            const canvas = document.getElementById('barcode-canvas-element');
            const dataUrl = canvas.toDataURL("image/png");
            
            let printW = canvas.dataset.printWidth || '104mm'; 
            let printH = canvas.dataset.printHeight || '22mm'; 
            let pdfWidthMicrons = 104000;
            let pdfHeightMicrons = 22000;

            let copiesHtml = '';
            
            if (mediaId === 'label_34x22_3up') {
                const numRows = Math.ceil(printQuantity / 3);
                
                printW = '104mm'; 
                printH = `${numRows * 22}mm`; 
                pdfWidthMicrons = 104000;
                pdfHeightMicrons = numRows * 22000; 

                copiesHtml += `<div class="page" style="display: flex; flex-direction: column; justify-content: flex-start; align-items: center; width: ${printW}; height: ${printH}; margin: 0 auto; padding: 0; box-sizing: border-box; overflow: hidden; background: white;">`;
                
                let printedCount = 0;
                
                for (let r = 0; r < numRows; r++) {
                    copiesHtml += `<div class="row" style="display: flex; flex-direction: row; justify-content: center; align-items: flex-start; gap: 1mm; width: 104mm; height: 22mm; margin: 0 auto; padding: 0; box-sizing: border-box; overflow: hidden; flex-shrink: 0;">`;
                    
                    for (let c = 0; c < 3; c++) {
                        copiesHtml += `<div style="width: 34mm; height: 22mm; display: flex; justify-content: center; align-items: flex-start; flex-shrink: 0; box-sizing: border-box; overflow: hidden;">`;
                        
                        if (printedCount < printQuantity) {
                            copiesHtml += `<img src="${dataUrl}" style="max-width: 100%; max-height: 100%; object-fit: contain; object-position: top center; display: block;" />`;
                            printedCount++;
                        }
                        
                        copiesHtml += `</div>`;
                    }
                    copiesHtml += `</div>`;
                }
                copiesHtml += `</div>`;
            } else {
                for (let i = 0; i < printQuantity; i++) {
                    copiesHtml += `<div class="page" style="display: flex; justify-content: center; align-items: flex-start; margin: 0 auto;">
                        <img src="${dataUrl}" style="max-width: 100%; max-height: 100%; object-fit: contain; object-position: top center; display: block;" />
                    </div>`;
                }
                if (mediaId === 'label_50x25') { pdfWidthMicrons = 50800; pdfHeightMicrons = 25400; }
                else if (mediaId === 'label_38x25') { pdfWidthMicrons = 38100; pdfHeightMicrons = 25400; }
                else if (mediaId === 'receipt_80') { pdfWidthMicrons = 80000; pdfHeightMicrons = 300000; }
            }

            const printHtml = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <style>
                        @media print {
                            /* 🚀 THE FIX: Strict page constraints, no portrait/landscape overrides */
                            @page { margin: 0 !important; size: ${printW} ${printH} !important; }
                            html, body { 
                                width: ${printW} !important; 
                                height: ${printH !== 'auto' ? printH : 'auto'} !important; 
                                margin: 0 !important; 
                                padding: 0 !important; 
                                background: white !important; 
                                display: block !important; 
                            }
                            /* Forces the spooler to chop discrete labels */
                            .page { page-break-after: always !important; break-after: page !important; }
                        }
                        html, body { margin: 0; padding: 0; background: white; display: block; }
                        * { box-sizing: border-box; }
                        
                        .page { 
                            width: ${printW}; 
                            height: ${printH}; 
                            position: relative; 
                            background: white; 
                            overflow: hidden; 
                            margin: 0 auto; 
                            /* 🚀 THE FIX: Switch to block alignment to prevent endless flex-stretching */
                            display: block; 
                            text-align: center;
                        }
                    </style>
                </head>
                <body>
                    ${copiesHtml}
                </body>
                </html>
            `;

            if (isDesktop && isSilent && window.electronAPI?.printSilent) {
                await window.electronAPI.printSilent({
                    content: printHtml,
                    silent: true,
                    printerName: targetPrinter,
                    copies: mediaId === 'label_34x22_3up' ? 1 : printQuantity, 
                    pageSize: { width: pdfWidthMicrons, height: pdfHeightMicrons }, 
                    landscape: false 
                });
                
                if (typeof showToast === 'function') showToast("Printing", `Sending ${printQuantity} generic labels to spooler...`, "info");
                closeModal(); 
            } else {
                const printFrame = document.createElement('iframe');
                printFrame.style.position = 'fixed';
                printFrame.style.right = '-9999px';
                printFrame.style.bottom = '-9999px';
                document.body.appendChild(printFrame);
                
                const frameDoc = printFrame.contentWindow.document;
                frameDoc.open();
                frameDoc.write(printHtml);
                frameDoc.close();
                
                printFrame.onload = function() {
                    setTimeout(() => {
                        printFrame.contentWindow.focus();
                        printFrame.contentWindow.print();
                        setTimeout(() => document.body.removeChild(printFrame), 500);
                    }, 200);
                };
                closeModal(); 
            }

        } catch (error) {
            console.error("Print Error:", error);
            alert("Printing failed: " + error.message);
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    };

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.style.pointerEvents = 'auto'; 
    document.body.classList.add('overflow-hidden');
}

export function handleBestBefore() {
    const i = DOM.inventory.inputs;
    if (!i.bestBefore || !i.expiry) return;
    const months = parseInt(i.bestBefore.value, 10);
    if (isNaN(months) || months < 0) return;

    const baseDateStr = (i.packaged && i.packaged.value) ? i.packaged.value : new Date().toISOString().split('T')[0];
    const d = new Date(baseDateStr);
    
    // 🚀 THE FIX: Store original day and clamp to prevent month-rollover anomalies
    const originalDay = d.getDate();
    d.setMonth(d.getMonth() + months);
    
    if (d.getDate() !== originalDay) {
        d.setDate(0); // Pushes it back to the last valid day of the target month
    }
    
    i.expiry.value = d.toISOString().split('T')[0];
}

// --- Stock Adjustment Logic ---

export function openStockAdjustmentModal(id) {
    productToAdjust = localProductsCache.find(p => p.id === id);
    if (!productToAdjust) return;
    
    const m = DOM.modals.stock;
    if(m.self) {
        m.title.textContent = `Adjust: ${productToAdjust.name}`;
        m.current.textContent = productToAdjust.stockLevel;
        m.form.reset();
        m.self.classList.remove('hidden');
        m.self.classList.add('flex');
    m.self.style.pointerEvents = 'auto';
        document.body.classList.add('overflow-hidden');
    }
}

export function closeStockAdjustmentModal() {
    const m = DOM.modals.stock;
    if(m && m.self) {
        m.self.classList.add('hidden');
        m.self.classList.remove('flex');
    }
    // 🚀 THE FIX: Explicitly release the scroll lock
    document.body.classList.remove('overflow-hidden');
    document.documentElement.classList.remove('overflow-hidden');
    productToAdjust = null;
}

export async function handleStockAdjustmentSubmit(e) {
    e.preventDefault();
    if (!productToAdjust) return;

    const targetProductId = productToAdjust.id;
    const m = DOM.modals.stock;
    const rawQty = secureFloat(m.change.value);
    const reason = m.reason.value;
    const qtyAbs = Math.abs(rawQty);

    if (rawQty === 0) {
        showModal('Error', 'Please enter a valid quantity change.', 'error');
        return;
    }

    try {
        const productsRef = getProductsRef();
        const productRef = doc(productsRef, targetProductId);
        
        let inventoryChange = rawQty;
        let financialTotal = 0;
        let transactionType = 'ADJUSTMENT';
        
        const price = secureFloat(productToAdjust.price);
        const cost = secureFloat(productToAdjust.cost);

        switch (reason) {
            case 'Correction': inventoryChange = rawQty; break;
            case 'Damage': 
                inventoryChange = -qtyAbs; 
                financialTotal = -safeMath.multiply(cost, qtyAbs); // ENFORCED safeMath
                transactionType = 'LOSS'; 
                break;
            case 'Return': 
                inventoryChange = qtyAbs; 
                financialTotal = -safeMath.multiply(price, qtyAbs); 
                transactionType = 'REFUND'; 
                break;
            case 'Shipment': 
                inventoryChange = qtyAbs; 
                financialTotal = -safeMath.multiply(cost, qtyAbs); 
                transactionType = 'PURCHASE'; 
                break;
            case 'Theft': 
                inventoryChange = -qtyAbs; 
                financialTotal = -safeMath.multiply(cost, qtyAbs); 
                transactionType = 'LOSS'; 
                break;
        }

        // 🚀 THE FIX: Instantly block the adjustment if it drops stock below zero
        const currentUiStock = parseFloat(productToAdjust.stockLevel) || 0;
        if (currentUiStock + inventoryChange < 0) {
            showModal('Invalid Adjustment', `You cannot deduct ${Math.abs(inventoryChange)} items. You only have ${currentUiStock} left in stock.`, 'error');
            return;
        }

        const role = typeof getUserRole === 'function' ? getUserRole() : 'manager';
        const canAccessAllLocations = (role === 'admin' || role === 'accountant') ;
        
        const assignedLoc = typeof getUserAssignedLocationId === 'function' ? getUserAssignedLocationId() : 'main';
        let adjustmentLocation = getNormalizedLoc(canAccessAllLocations ? (productToAdjust.locationId || 'main') : assignedLoc);

        // 🚀 Use runTransaction to prevent FIFO Race Conditions
        await runTransaction(db, async (transaction) => {
            const prodDoc = await transaction.get(productRef);
            if (!prodDoc.exists()) throw new Error("Product does not exist!");
            
            const prodData = prodDoc.data();
            let currentBatches = prodData.batches ? [...prodData.batches] : [];
            const oldStock = secureFloat(prodData.stockLevel);

            // 🚀 THE FIX: A secondary DB-level barrier to prevent negative stock during race conditions
            if (oldStock + inventoryChange < 0) {
                throw new Error(`Insufficient live stock! Only ${oldStock} items are currently available.`);
            }

            currentBatches = sortBatchesFefoFifo(currentBatches);
            if (currentBatches.length === 0 && oldStock > 0) {
                currentBatches.push({
                    batchNo: 'LEGACY-STOCK',
                    date: prodData.createdAt ? prodData.createdAt.split('T')[0] : new Date().toISOString().split('T')[0],
                    qty: oldStock,
                    cost: secureFloat(prodData.cost),
                    supplierId: prodData.dealerId || 'Manual/Mfg',
                    expirationDate: prodData.expirationDate || '',
                    timestamp: prodData.createdAt ? new Date(prodData.createdAt).getTime() : new Date().getTime()
                });
            }

            if (inventoryChange > 0) {
                currentBatches.push({
                    batchNo: `ADJ-${Date.now().toString().slice(-6)}`,
                    date: new Date().toISOString().split('T')[0],
                    qty: inventoryChange,
                    cost: cost,
                    supplierId: prodData.dealerId || 'Adjustment',
                    expirationDate: prodData.expirationDate || '',
                    timestamp: new Date().getTime()
                });
            } else if (inventoryChange < 0) {
                let qtyToRemove = Math.abs(inventoryChange);
                for (let i = 0; i < currentBatches.length; i++) {
                    if (qtyToRemove <= 0) break;
                    if (currentBatches[i].qty <= qtyToRemove) {
                        qtyToRemove = safeMath.subtract(qtyToRemove, currentBatches[i].qty);
                        currentBatches[i].qty = 0;
                    } else {
                        currentBatches[i].qty = safeMath.subtract(currentBatches[i].qty, qtyToRemove);
                        qtyToRemove = 0;
                    }
                }
                currentBatches = currentBatches.filter(b => b.qty > 0);
            }

            let newWac = cost;
            if (currentBatches.length > 0) {
                let totalVal = 0, totalQ = 0;
                currentBatches.forEach(b => {
                    totalVal = safeMath.add(totalVal, safeMath.multiply(b.qty, b.cost));
                    totalQ = safeMath.add(totalQ, b.qty);
                });
                if (totalQ > 0) newWac = safeMath.divide(totalVal, totalQ);
            }

            transaction.update(productRef, {
                stockLevel: increment(inventoryChange),
                batches: currentBatches,
                cost: newWac,
                updatedAt: serverTimestamp()
            });

            const transactionsRef = getTransactionsRef();
            const newTxRef = doc(transactionsRef);
            
            transaction.set(newTxRef, {
                invoiceId: `ADJ-${Date.now()}`,
                storeId: getStoreId(),
                locationId: adjustmentLocation,
                timestamp: new Date(),
                type: transactionType,
                customer: prodData.dealerId ? { 
                    id: prodData.dealerId, 
                    name: prodData.dealerName,
                    gstin: prodData.gstin || '',
                    state: prodData.gstin ? String(prodData.gstin).substring(0, 2) : ''
                } : null, 
                summary: {
                    total: financialTotal,
                    profit: financialTotal,
                    paymentMethod: 'ADJUSTMENT',
                    reason: reason,
                    itemCount: qtyAbs
                },
                items: [{
                    id: prodDoc.id,
                    name: prodData.name,
                    sku: prodData.sku,
                    quantity: inventoryChange,
                    price: price,
                    cost: cost,
                    taxRate: secureFloat(prodData.gstSlab)
                }],
                cashierId: getUserId(),
                currency: { code: getCurrencyCode(), symbol: getCurrencySymbol() }
            });
        });

        showModal('Success', 'Stock adjusted successfully.', 'success');
        logInventoryChange('ADJUST', productToAdjust.name, `Change: ${rawQty} (${reason})`);
        closeStockAdjustmentModal(); 
        
    } catch (error) {
        console.error("Adjustment error:", error);
        showModal('Error', error.message, 'error');
    }
}

// --- ACTIVITY LOG ---

// --- REPLACE IN src/components/inventory.js ---

function setupInventoryListeners() {
    // 🚀 Fetch initial data on load
    refreshLocalInventoryCache();

    // 🚀 THE FIX: Catch POS sales & adjustments instantly to heal the Inventory table
    if (typeof AppState !== 'undefined') {
        AppState.subscribe('products_updated', async () => {
            // Only force a hard refresh if the inventory tab is actually active/visible
            const invSection = document.getElementById('inventory');
            if (invSection && !invSection.classList.contains('hidden')) {
                await refreshLocalInventoryCache();
            }
        });
    }

    DOM.inventory.table.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (!action || !id) return;
        e.stopPropagation();

        if (action === 'edit') editProduct(id);
        else if (action === 'delete') deleteProduct(id, btn.dataset.name);
        else if (action === 'adjust') openStockAdjustmentModal(id);
        else if (action === 'barcode') printProductBarcode(id);
    });

    let debounceTimer;
    if (DOM.inventory.search) {
        DOM.inventory.search.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                window.currentInventoryPage = 1;
                handleInventorySortAndSearch();
            }, 300);
        });
    }
}

async function loadDealerDropdowns() {
    try {
        if (window.dbAPI && window.dbAPI.getCustomers) {
            let docs = await window.dbAPI.getCustomers();
            docs = docs.filter(d => d.type === 'dealer' || d.type === 'supplier');
            
            const role = typeof getUserRole === 'function' ? getUserRole() : 'manager';
            const canAccessAllLocations = (role === 'admin' || role === 'accountant');
            const normAssignedLoc = getNormalizedLoc(typeof getUserAssignedLocationId === 'function' ? getUserAssignedLocationId() : 'main');

            if (!canAccessAllLocations) docs = docs.filter(d => getNormalizedLoc(d.locationId) === normAssignedLoc);
            localDealersCache = docs;
            
            let dealerSearchList = document.getElementById('dealer-search-list');
            if (!dealerSearchList) {
                dealerSearchList = document.createElement('datalist');
                dealerSearchList.id = 'dealer-search-list';
                document.body.appendChild(dealerSearchList);
            }
            
            const nameInput = document.getElementById('prod-dealer') || document.querySelector('input[name="dealer"]');
                if (nameInput) {
                    nameInput.setAttribute('list', 'dealer-search-list');
                    
                    // 🚀 THE FIX: Attach a listener to fetch full details when a name is picked from the dropdown
                    if (!nameInput.dataset.listenerBound) {
                        nameInput.addEventListener('input', (e) => {
                            clearTimeout(dealerLookupDebounce);
                            dealerLookupDebounce = setTimeout(() => handleDealerInfoChange('name', e.target.value), 300);
                        });
                        nameInput.dataset.listenerBound = 'true';
                    }
                }

                dealerSearchList.innerHTML = '';
            localDealersCache.forEach(d => { if (d.name) dealerSearchList.appendChild(new Option(d.name)); });
        }
    } catch (e) { console.error("Error loading dealers:", e); }
}

export function setupActivityListener() {
    document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (btn && (btn.id === 'activity-btn' || btn.textContent.includes('Activity'))) {
            if (btn.classList.contains('bg-blue-50') || btn.closest('#inventory-action-buttons')) {
                window.openActivityModal();
            }
        }
    });
    AppState.subscribe('transactions_updated', () => {
        // If the inline dashboard container exists, refresh it
        const inlineContainer = document.getElementById('activity-log-container');
        if (inlineContainer) loadRecentActivity('activity-log-container');
        
        // If the popup modal is currently open on screen, refresh it live
        const modalContainer = document.getElementById('activity-log-container-modal');
        if (modalContainer && document.getElementById('activity-log-modal')) {
            loadRecentActivity('activity-log-container-modal');
        }
    });
    
    loadRecentActivity('activity-log-container');
}

window.openActivityModal = async function() {
    const modalId = 'activity-log-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();
    
    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[400] bg-slate-900/60 flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl shadow-2xl w-full max-w-xl flex flex-col h-[80vh] overflow-hidden border border-slate-100">
                <div class="px-6 py-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0 shadow-sm">
                    <div>
                        <h3 class="text-xl font-black text-slate-800 flex items-center gap-3">
                            <span class="bg-blue-100 text-blue-600 p-2 rounded-xl"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></span>
                            Recent Activity
                        </h3>
                        <p class="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Local Transaction & Adjustment Log</p>
                    </div>
                    <button onclick="document.getElementById('${modalId}').remove(); document.body.classList.remove('overflow-hidden');" class="text-slate-400 hover:text-red-500 transition-colors bg-white p-2.5 rounded-full shadow-sm border border-slate-200">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div id="activity-log-container-modal" class="p-6 overflow-y-auto custom-scrollbar flex-1 bg-slate-100">
                    <div class="text-center py-10 animate-pulse text-slate-400 font-bold">Loading System Logs...</div>
                </div>
            </div>
        </div>
    `;
    
    document.body.classList.add('overflow-hidden');
    document.body.insertAdjacentHTML('beforeend', html);
    
    await loadRecentActivity('activity-log-container-modal');
};

async function loadRecentActivity(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    try {
        let logs = [];
        
        if (window.dbAPI && window.dbAPI.getTransactions) {
            const txs = await window.dbAPI.getTransactions();
            logs = txs.map(tx => ({
                action: tx.type || 'TX',
                productName: tx.invoiceId || 'System',
                details: tx.summary?.reason || `${tx.items?.length || 0} items processed`,
                timestamp: tx.timestamp || tx.localTimestamp || new Date().toISOString()
            }));
        }
        
        if (window.dbAPI && window.dbAPI.getTelemetry) {
            const tele = await window.dbAPI.getTelemetry(50) || [];
            logs = [...logs, ...tele];
        }
        
        logs.sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        logs = logs.slice(0, 50); 
        
        if (logs.length === 0) {
            container.innerHTML = '<div class="flex flex-col items-center justify-center py-16 bg-white rounded-2xl border border-dashed border-slate-300"><span class="text-5xl mb-4 opacity-50">📭</span><p class="text-slate-600 font-bold text-lg">No recent activity.</p><p class="text-xs text-slate-400 mt-1 uppercase tracking-widest">Adjust stock to see logs here.</p></div>';
            return;
        }
        
        let html = '<div class="space-y-4">';
        logs.forEach(log => {
            const d = new Date(log.timestamp);
            const timeStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            let color = 'indigo';
            if (log.action === 'LOSS' || log.action === 'DELETE') color = 'red';
            if (log.action === 'PURCHASE' || log.action === 'CREATE') color = 'emerald';
            if (log.action === 'SALE') color = 'blue';
            if (log.action === 'ADJUSTMENT' || log.action === 'UPDATE') color = 'amber';
            
            html += `
                <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                    <div class="flex justify-between items-start mb-2.5">
                        <span class="text-[10px] font-black text-${color}-700 bg-${color}-50 border border-${color}-100 px-2.5 py-1 rounded-md uppercase tracking-widest">${log.action}</span>
                        <span class="text-[10px] font-bold text-slate-500 font-mono bg-slate-50 px-2 py-0.5 rounded border border-slate-100">${timeStr}</span>
                    </div>
                    <h4 class="text-sm font-black text-slate-800 mb-1">${escapeHTML(log.productName || 'System')}</h4>
                    <p class="text-xs font-medium text-slate-500 leading-relaxed">${escapeHTML(log.details || '')}</p>
                </div>
            `;
        });
        html += '</div>';
        
        container.innerHTML = html;
    } catch (e) {
        console.error("Activity load error", e);
        container.innerHTML = '<div class="text-center py-10 bg-red-50 text-red-600 font-bold rounded-2xl border border-red-100">Failed to load activity logs from database.</div>';
    }
}
async function logInventoryChange(action, productName, details) {
    if (window.dbAPI && window.dbAPI.logTelemetry) {
        window.dbAPI.logTelemetry(action, { productName, details, locationId: getNormalizedLoc(getCurrentLocationId()) });
    }
}

// Bypassed network HSN fetcher
async function loadHsnDirectoryCache() { return; }



// --- BUNDLE LOGIC HANDLERS ---
function handleAddToBundle() {
    const searchInput = document.getElementById('bundle-search');
    const term = searchInput.value.trim();
    if (!term) return;

    const locDropdown = document.getElementById('inv-form-location');
    const role = typeof getUserRole === 'function' ? getUserRole() : 'manager';
    
    const canAccessAllLocations = (role === 'admin' || role === 'accountant') ;

    let targetLoc = typeof getUserAssignedLocationId === 'function' ? getUserAssignedLocationId() : 'main';
    if (canAccessAllLocations && locDropdown) targetLoc = locDropdown.value || 'main';
    targetLoc = getNormalizedLoc(targetLoc);

    const product = localProductsCache.find(p => 
        getNormalizedLoc(p.locationId) === targetLoc && 
        (p.name === term || p.sku === term || p.barcode === term)
    );
    
    if (product) {
        if (product.type === 'bundle') {
            showToast("Invalid", "Cannot add a bundle inside another bundle.", "error");
            return;
        }

        const existing = bundleComponents.find(c => c.id === product.id);
        if (existing) {
            existing.qty += 1;
        } else {
            // 🚀 THE FIX: Removed limits. You can bundle as many items as you want!
            bundleComponents.push({
                id: product.id,
                name: product.name,
                qty: 1,
                cost: product.cost || 0,
                price: product.price || 0,
                mrp: product.mrp || 0,
                expirationDate: product.expirationDate || null
            });
        }
        
        searchInput.value = '';
        renderBundleTable();
        // 🚀 Trigger the auto-math engine!
        if (typeof updateBundleCalculations === 'function') updateBundleCalculations();
    } else {
        showToast("Not Found", "Product not found in this branch's inventory.", "error");
    }
}

function renderBundleTable() {
    const tbody = document.getElementById('bundle-components-list');
    const totalEl = document.getElementById('bundle-total-cost');
    
    if (!tbody) return;
    
    if (bundleComponents.length === 0) {
        tbody.innerHTML = `<tr id="bundle-empty-row"><td colspan="4" class="text-center py-4 text-gray-400 italic">No components added.</td></tr>`;
        if (totalEl) totalEl.textContent = '0.00';
        return;
    }

    let html = '';
    let totalCost = 0;
    const isMathReady = typeof safeMath?.multiply === 'function';

    bundleComponents.forEach((comp, index) => {
        const lineCost = isMathReady ? safeMath.multiply(comp.qty, comp.cost) : (comp.qty * comp.cost);
        totalCost = isMathReady ? safeMath.add(totalCost, lineCost) : (totalCost + lineCost);
        
        html += `
            <tr class="border-b border-gray-50">
                <td class="px-3 py-2 text-gray-700">${escapeHTML(comp.name)}</td>
                <td class="px-3 py-2 text-center font-bold text-indigo-600">${comp.qty}</td>
                <td class="px-3 py-2 text-right text-gray-600">${lineCost.toFixed(2)}</td>
                <td class="px-3 py-2 text-center">
                    <button type="button" class="text-red-400 hover:text-red-600 remove-bundle-btn" data-index="${index}">&times;</button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    if (totalEl) totalEl.textContent = totalCost.toFixed(2);
}

// 🚀 THE FIX: Force math updates and strip out the "polite" checks
function updateBundleCalculations() {
    const costInput = document.getElementById('cost');
    const priceInput = document.getElementById('price');
    const mrpInput = document.getElementById('prod-mrp');
    const expInput = document.getElementById('expirationDate');
    
    let stockInput = null;
    if (DOM.inventory && DOM.inventory.inputs && DOM.inventory.inputs.stock) {
        stockInput = DOM.inventory.inputs.stock;
    } else {
        stockInput = document.getElementById('stockLevel') || document.querySelector('input[name="stock"]');
    }

    if (bundleComponents.length === 0) return;

    let totalCost = 0;
    let totalPrice = 0;
    let totalMrp = 0;
    let earliestExp = null;
    let maxBundlesPossible = Infinity; 

    bundleComponents.forEach(comp => {
        const realProduct = localProductsCache.find(p => p.id === comp.id);
        const realStockAvailable = realProduct ? parseFloat(realProduct.stockLevel || 0) : 0;
        
        const possibleWithThisItem = Math.floor(realStockAvailable / comp.qty);
        if (possibleWithThisItem < maxBundlesPossible) {
            maxBundlesPossible = possibleWithThisItem;
        }

        totalCost += (parseFloat(comp.cost) || 0) * comp.qty;
        totalPrice += (parseFloat(comp.price) || 0) * comp.qty;
        
        // Failsafe: If component doesn't have MRP, use its Selling Price for the total MRP math
        const compMrp = parseFloat(comp.mrp) > 0 ? parseFloat(comp.mrp) : parseFloat(comp.price);
        totalMrp += (compMrp || 0) * comp.qty;

        const expToUse = comp.expirationDate || realProduct?.expirationDate;
        if (expToUse) {
            const compDate = new Date(expToUse);
            if (!earliestExp || compDate < earliestExp) earliestExp = compDate;
        }
    });

    if (maxBundlesPossible === Infinity) maxBundlesPossible = 0;

    // 🚀 THE FIX: Forcefully overwrite the fields every time a component changes!
    if (costInput) costInput.value = totalCost.toFixed(2);
    if (priceInput) priceInput.value = totalPrice.toFixed(2);
    if (mrpInput) mrpInput.value = totalMrp.toFixed(2);
    
    if (stockInput) {
        stockInput.value = maxBundlesPossible;
        stockInput.readOnly = true; 
        stockInput.classList.add('bg-indigo-50', 'text-indigo-700', 'font-bold', 'cursor-not-allowed');
    }

    if (expInput && earliestExp) {
        expInput.value = earliestExp.toISOString().split('T')[0];
    }

    // Flash indigo to show the user it was auto-calculated
    [costInput, priceInput, mrpInput, stockInput, expInput].forEach(el => {
        if (el) {
            el.classList.add('bg-indigo-50', 'border-indigo-400', 'transition-colors', 'duration-300');
            setTimeout(() => el.classList.remove('bg-indigo-50', 'border-indigo-400'), 800);
        }
    });
}
// 🚀 SURGICAL UI TOGGLER: Safely hides individual elements without breaking the layout or math
export function toggleProductTypeUI(type) {
    const isBundle = type === 'bundle';
    const isHomemade = type === 'homemade' || type === 'manufactured' || type === 'non_gst';    
    
    // 1. SAFELY HIDE DEALER INPUT FIELDS (Preserves Barcode)
    const hideForHomemade = ['prod-gstin', 'prod-dealer-pan', 'prod-invoice', 'prod-dealer-id', 'gstin'];
    const hideForBundle = ['prod-dealer', 'prod-dealer-phone', 'prod-dealer-id', 'prod-gstin', 'prod-dealer-pan',  'prod-invoice', 'gstin'];
    const allDealerFields = ['prod-dealer', 'prod-dealer-phone', 'prod-dealer-id', 'prod-gstin', 'prod-dealer-pan',  'prod-invoice', 'gstin'];

    allDealerFields.forEach(id => {
        let el = document.getElementById(id);
        if (!el) el = document.querySelector(`input[name="${id}"]`);

        if (el) {
            const wrapper = el.closest('div'); 
            if (wrapper && wrapper.tagName === 'DIV') {
                if (isBundle && hideForBundle.includes(id)) {
                    wrapper.style.display = 'none';
                } else if (isHomemade && hideForHomemade.includes(id)) {
                    wrapper.style.display = 'none';
                } else {
                    wrapper.style.display = ''; 
                }
            }
        }
    });

    // 2. THE ULTIMATE SECTION HIDER
    function hideSectionByTextAndInput(searchText, inputId, shouldHide) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let textNode;
        let headerEl = null;
        
        while (textNode = walker.nextNode()) {
            if (textNode.nodeValue.toUpperCase().includes(searchText.toUpperCase())) {
                headerEl = textNode.parentElement;
                break;
            }
        }

        if (headerEl) {
            let container = headerEl;
            while (container && container.tagName !== 'FORM' && container.tagName !== 'BODY') {
                if (container.querySelector(`#${inputId}`)) {
                    container.style.display = shouldHide ? 'none' : '';
                    break;
                }
                container = container.parentElement;
            }
        } else {
            const inputEl = document.getElementById(inputId);
            if (inputEl) {
                const fallbackContainer = inputEl.closest('.border, .rounded-xl, .bg-indigo-50\\/50');
                if (fallbackContainer) fallbackContainer.style.display = shouldHide ? 'none' : '';
            }
        }
    }

    // 🚀 THE FIX: Always keep the TAX BREAKDOWN container visible!
    hideSectionByTextAndInput('TAX BREAKDOWN', 'prod-base-rate', false); 
    hideSectionByTextAndInput('BUNDLE COMPONENTS', 'bundle-search', !isBundle);
    hideSectionByTextAndInput('PAYMENT DETAILS', 'prod-payment-method', isBundle || isHomemade);
    hideSectionByTextAndInput('SUPPLIER & SOURCING DETAILS', 'prod-dealer', isBundle || isHomemade);

    // 🚀 SURGICAL HIDE FIX: Target the outermost .col-span-1 wrapper to hide the input, label, AND tooltip simultaneously
    const taxFieldsToHide = ['prod-sch-disc', 'prod-rs-disc', 'prod-taxable-amt', 'gst-slab', 'prod-cess', 'prod-cgst', 'prod-sgst'];
    
    taxFieldsToHide.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const wrapper = el.closest('.col-span-1');
            if (wrapper) {
                // Safety check: ensure we don't accidentally hide the Net Amount or Base Rate if they share a container
                if (!wrapper.querySelector('#prod-net-amt') && !wrapper.querySelector('#prod-base-rate')) {
                    wrapper.style.display = (isBundle || isHomemade) ? 'none' : '';
                }
            }
        }
    });

    // Clean up the dynamically injected discount headers
    ['prod-sch-disc', 'prod-rs-disc'].forEach(id => {
        const toggleHeader = document.getElementById(`${id}-type-toggle`)?.closest('.flex.justify-between');
        if (toggleHeader) {
            toggleHeader.style.display = (isBundle || isHomemade) ? 'none' : '';
        }
    });

    // 3. Force GST Slab to 0% in the background
    const gstSlab = document.getElementById('gst-slab');
    if (gstSlab) {
        if (isHomemade || isBundle) {
            gstSlab.value = "0";
            if (typeof window.calculateInvoiceBreakdown === 'function') window.calculateInvoiceBreakdown('gst-slab');
        }
    }
}



function injectBatchRegistry() {
    const targetDiv = document.getElementById('batch-registry-injection-point');
    
    if (targetDiv && !document.getElementById('batch-registry-section')) {
        targetDiv.innerHTML = `
            <div id="batch-registry-section" class="mt-4 mb-6 bg-slate-50 p-5 rounded-xl border border-slate-200 shadow-inner w-full col-span-full">
                <div class="flex justify-between items-center mb-4">
                    <h4 class="text-sm font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
                         Internal Batch Registry (FIFO)
                    </h4>
                    <div class="flex items-center gap-3">
                        <span class="text-[9px] font-black bg-indigo-100 text-indigo-700 px-2 py-1 rounded uppercase tracking-widest shadow-sm">Weighted Avg Active</span>
                        <button type="button" onclick="window.prepareNewBatch()" class="bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm hover:bg-indigo-700 transition-all flex items-center gap-1 active:scale-95">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg> Add New Batch
                        </button>
                    </div>
                </div>
                <div class="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-100 text-slate-500 font-bold uppercase tracking-wider">
                            <tr>
                                <th class="p-3">Date Added</th>
                                <th class="p-3">Batch / Ref</th>
                                <th class="p-3 text-center">Exp Date</th>
                                <th class="p-3 text-right">Qty Remaining</th>
                                <th class="p-3 text-right">Unit Cost</th>
                                <th class="p-3 text-right">Total Value</th>
                            </tr>
                        </thead>
                        <tbody id="batch-registry-body" class="divide-y divide-slate-100 font-medium text-slate-700">
                        </tbody>
                        <tfoot class="bg-slate-50 font-black text-slate-900 border-t-2 border-slate-200">
                            <tr>
                                <td colspan="3" class="p-3 text-right text-slate-500 uppercase tracking-widest text-[10px]">Averages & Totals:</td>
                                <td class="p-3 text-right text-indigo-600 text-sm" id="reg-total-qty">0</td>
                                <td class="p-3 text-right text-emerald-600 text-sm" id="reg-avg-cost">₹0.00</td>
                                <td class="p-3 text-right text-sm">₹<span id="reg-total-val">0.00</span></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        `
    }
}

// ---------------------------------------------------------
// SMART INVOICE & INVENTORY CALCULATOR
// ---------------------------------------------------------

window.calculateInvoiceBreakdown = (triggerId) => {
    // 🚀 THE FIX: Transient Math Anchor! 
    const isReverseMath = (triggerId === 'prod-net-amt' || triggerId === 'prod-taxable-amt');

    const cases = parseInt(document.getElementById('prod-cases')?.value) || 0;
    const pieces = parseInt(document.getElementById('prod-pieces')?.value) || 0;
    const freeQty = parseInt(document.getElementById('prod-free-qty')?.value) || 0; 

    let upc = parseInt(document.getElementById('prod-upc')?.value);
    if (isNaN(upc) || upc <= 0) upc = 1; 

    // 🚀 THE CRITICAL FIX: Universally target the Stock Input field regardless of HTML changes
    const stockInput = document.getElementById('stockLevel') || document.getElementById('stock') || document.querySelector('input[name="stock"]');

    const baseStock = parseFloat(stockInput?.dataset?.baseStock) || 0;
    const paidQty = (cases * upc) + pieces;
    const currentBatchPhysicalQty = paidQty + freeQty;
    const totalPhysicalQty = currentBatchPhysicalQty + baseStock;
    const calcQty = paidQty > 0 ? paidQty : 1; 

    if (['prod-cases', 'prod-pieces', 'prod-upc', 'prod-free-qty'].includes(triggerId)) {
        if (stockInput) {
            stockInput.value = totalPhysicalQty; 
            // Force a DOM event update to ensure getFormData catches it later
            stockInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    const gstSlab = parseFloat(document.getElementById('gst-slab')?.value) || 0;
    const cessRate = parseFloat(document.getElementById('prod-cess')?.value) || 0; 
    const taxMultiplier = 1 + (gstSlab / 100) + (cessRate / 100);
    const isInclusive = document.getElementById('tax-inclusive-toggle')?.checked || false;

    let schDiscVal = parseFloat(document.getElementById('prod-sch-disc')?.value) || 0;
    const isSchPercent = document.getElementById('prod-sch-disc-type-toggle')?.checked || false;
    let rsDiscVal = parseFloat(document.getElementById('prod-rs-disc')?.value) || 0;
    const isRsPercent = document.getElementById('prod-rs-disc-type-toggle')?.checked || false;

    let baseRate = parseFloat(document.getElementById('prod-base-rate')?.value) || 0;
    let netAmt = parseFloat(document.getElementById('prod-net-amt')?.value) || 0;
    let taxableAmt = parseFloat(document.getElementById('prod-taxable-amt')?.value) || 0;

    // 🚀 REVERSE MATH ALGEBRA
    if (isReverseMath) {
        if (triggerId === 'prod-taxable-amt') {
            taxableAmt = parseFloat(document.getElementById('prod-taxable-amt')?.value) || 0;
            netAmt = taxableAmt * taxMultiplier;
        } else {
            netAmt = parseFloat(document.getElementById('prod-net-amt')?.value) || 0;
            taxableAmt = netAmt / taxMultiplier;
        }

        let targetLineTotal = isInclusive ? netAmt : taxableAmt;
        
        let pctSum = 0;
        let absSum = 0;
        if (isSchPercent) pctSum += (schDiscVal / 100); else absSum += schDiscVal;
        if (isRsPercent) pctSum += (rsDiscVal / 100); else absSum += rsDiscVal;
        
        let X = 0;
        if (1 - pctSum !== 0) {
            X = (targetLineTotal + absSum) / (1 - pctSum);
        }
        baseRate = X / calcQty;

    } 
    // 🚀 FORWARD MATH ALGEBRA
    else {
        baseRate = parseFloat(document.getElementById('prod-base-rate')?.value) || 0;
        const X = baseRate * calcQty;
        
        const schDiscAmt = isSchPercent ? X * (schDiscVal / 100) : schDiscVal;
        const rsDiscAmt = isRsPercent ? X * (rsDiscVal / 100) : rsDiscVal;

        let targetLineTotal = Math.max(0, X - schDiscAmt - rsDiscAmt);

        if (isInclusive) {
            netAmt = targetLineTotal;
            taxableAmt = netAmt / taxMultiplier;
        } else {
            taxableAmt = targetLineTotal;
            netAmt = taxableAmt * taxMultiplier;
        }
    }

    const baseTax = taxableAmt * (gstSlab / 100);
    const cgst = baseTax / 2;
    const sgst = baseTax / 2;

    const setVal = (id, val) => { 
        const el = document.getElementById(id); 
        // Only format and push to DOM if we aren't actively typing in it
        if (el && document.activeElement !== el) {
            el.value = val.toFixed(2); 
        }
    };

    setVal('prod-base-rate', baseRate);
    setVal('prod-taxable-amt', taxableAmt);
    setVal('prod-cgst', cgst);
    setVal('prod-sgst', sgst);
    setVal('prod-net-amt', netAmt);

    const costInput = document.getElementById('cost');
    if (costInput) { 
        costInput.value = (netAmt / (currentBatchPhysicalQty > 0 ? currentBatchPhysicalQty : 1)).toFixed(2); 
        costInput.classList.add('bg-green-50', 'text-green-700', 'border-green-400', 'transition-colors');
        setTimeout(() => costInput.classList.remove('bg-green-50', 'text-green-700', 'border-green-400'), 500);
    }
};

['input', 'change'].forEach(evt => {
    document.body.addEventListener(evt, (e) => {
        const triggers = [
            'prod-base-rate', 'prod-sch-disc', 'prod-rs-disc', 'gst-slab', 
            'prod-cess', 'prod-cases', 'prod-pieces', 'prod-upc', 
            'tax-inclusive-toggle', 'prod-free-qty', 'prod-net-amt', 'prod-taxable-amt'
        ];
        if (triggers.includes(e.target.id)) {
            window.calculateInvoiceBreakdown(e.target.id);
        }
    });
});

window.handleManualBulkClick = function() {
    const choiceModal = document.getElementById('import-choice-modal');
    if (choiceModal) choiceModal.remove();

    // 🚀 THE FIX: Pass localProductsCache as the 3rd argument so the grid can read barcodes!
    openManualBulkUpload(async (payloadArray) => {
        console.log("Uploading manual items:", payloadArray);
        await processScannedBulkUpload(payloadArray);
        
        if (typeof showToast === 'function') showToast('Success', `Imported ${payloadArray.length} items manually.`, 'success');
        renderInventoryTable();
        updateInventoryCountDisplay();
    }, localDealersCache, localProductsCache); 
};

window.openImportDialog = function() {
    const existing = document.getElementById('import-choice-modal');
    if (existing) existing.remove();

    const modalHtml = `
    <div id="import-choice-modal" class="fixed inset-0 z-[100] bg-slate-900/60 flex items-center justify-center p-4">
        <div class="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden ">
            <div class="p-8 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
                <div>
                    <h3 class="text-2xl font-black text-slate-800 tracking-tight">Add Stock to Inventory</h3>
                    <p class="text-sm text-slate-500 font-medium">Choose your preferred offline import method</p>
                </div>
                <button onclick="document.getElementById('import-choice-modal').remove()" class="text-slate-400 hover:text-slate-600 bg-white rounded-full p-2 hover:bg-slate-100">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
            
            <div class="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div onclick="document.getElementById('spreadsheet-file-input').click()" class="cursor-pointer bg-white border-2 border-slate-100 hover:border-indigo-600 rounded-3xl p-8 hover:shadow-xl hover:shadow-indigo-100 flex flex-col items-center text-center">
                    <div class="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-4">
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    </div>
                    <h4 class="font-black text-slate-800 mb-2">Excel / CSV Upload</h4>
                    <p class="text-xs text-slate-500 font-medium">Upload a standard spreadsheet for bulk updates.</p>
                </div>

                <div onclick="window.handleManualBulkClick()" class="cursor-pointer bg-white border-2 border-slate-100 hover:border-emerald-500 rounded-3xl p-8 hover:shadow-xl hover:shadow-emerald-100 flex flex-col items-center text-center">
                    <div class="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-4">
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                    </div>
                    <h4 class="font-black text-slate-800 mb-2">Manual Entry</h4>
                    <p class="text-xs text-slate-500 font-medium">Fast spreadsheet UI for typing handwritten bills.</p>
                </div>
                
                <input type="file" id="spreadsheet-file-input" class="hidden" accept=".csv, .xlsx, .xls" onchange="window.handleSpreadsheetUpload(this)">
            </div>
            
            <div class="px-8 py-5 bg-slate-50 border-t border-slate-100 flex justify-end">
                <button onclick="window.downloadSpreadsheetTemplate()" class="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100">Download Template</button>
            </div>
        </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.body.classList.add('overflow-hidden');
};

window.handlePhotoUpload = async function() {};

// --- AI Scanner Access (Plan-Free, Daily Cap Active) ---
async function verifyScannerAccess() {
    const today = new Date().toISOString().split('T')[0]; 
    const localUsageKey = `mifela_ai_scans_${today}`;
    
    // 1. Check Daily Limit (10 Scans) via Local Storage
    let scansToday = parseInt(localStorage.getItem(localUsageKey)) || 0;

    // if (scansToday >= 10) {
    //     if (typeof window.showModal === 'function') {
    //         window.showModal(
    //             'Daily Limit Reached 🛑', 
    //             'You have used your 10 AI scans for today. Please try again tomorrow to manage your API quota.', 
    //             'error'
    //         );
    //     } else {
    //         alert('Daily limit of 10 scans reached.');
    //     }
    //     return false; 
    // }

    // 2. Increment locally and allow
    localStorage.setItem(localUsageKey, scansToday + 1);
    console.log(`🚀 AI Scan authorized. Scan #${scansToday + 1}/10 for ${today}.`);
    return true; 
}



function injectFreeQtyField() {
    const piecesInput = document.getElementById('prod-pieces');
    if (piecesInput && !document.getElementById('prod-free-qty')) {
        const wrapper = piecesInput.closest('div'); 
        
        // 🚀 THE FIX: Matched the exact CSS classes of "Cases" and "Pieces" (mt-1, p-2, rounded-md, text-xs)
        wrapper.insertAdjacentHTML('afterend', `
            <div>
                <label class="block text-xs font-bold text-emerald-700 uppercase" title="Free items given by supplier">Free (FOC) </label>
                <input type="number" id="prod-free-qty" min="0" step="1" value="0" class="mt-1 w-full rounded-md border-emerald-300 bg-emerald-50 text-emerald-700 font-bold shadow-sm p-2 border text-sm focus:ring-emerald-500 focus:border-emerald-500 outline-none" placeholder="0">
            </div>
        `);
    }
}
// // --- NEW: AI Scanner Security & Limits (Crash-Proof Version) ---
// async function verifyScannerAccess() {
//     const today = new Date().toISOString().split('T')[0]; 
//     let currentPlan = 'free';

//     // 1. THE DEEP UI/LOCAL SCRAPE (Zero Permissions Required)
//     // We do this first so we don't even need to ask the database
//     const storageStr = JSON.stringify(localStorage).toLowerCase();
//     if (storageStr.match(/"(?:plan|subscription|tier)"\s*:\s*"gold"/)) {
//         currentPlan = 'gold';
//     } else if (document.body.innerText.toLowerCase().includes('gold plan') || document.body.innerText.toLowerCase().includes('gold')) {
//         currentPlan = 'gold';
//     }

//     // 2. FIREBASE FALLBACK (Wrapped in Try/Catch to prevent crashes)
//     if (currentPlan !== 'gold') {
//         try {
//             const productsRef = typeof getProductsRef === 'function' ? getProductsRef() : null;
            
//             if (productsRef && productsRef.parent) {
//                 const storeSnap = await getDoc(productsRef.parent);
//                 if (storeSnap.exists()) {
//                     const data = storeSnap.data();
//                     const dbPlan = String(data.plan || data.subscription || data.tier || 'free').toLowerCase();
//                     if (['gold', 'platinum', 'enterprise'].includes(dbPlan)) currentPlan = 'gold';
//                 }
//             }
//         } catch (e) {
//             console.warn("Firebase plan check bypassed due to permissions:", e.message);
//         }
//     }

//     // 3. FINAL VALIDATION
//     if (currentPlan !== 'gold') {
//         if (typeof window.showModal === 'function') {
//             window.showModal('Upgrade Required', 'AI Receipt Scanning requires the GOLD plan.', 'warning');
//         } else {
//             alert('AI Receipt Scanning requires the GOLD plan.');
//         }
//         return false;
//     }

//     // 4. RATE LIMITER (Hybrid Firebase + Local Storage)
//     const localUsageKey = `mifela_ai_scans_${today}`;
//     let scansToday = parseInt(localStorage.getItem(localUsageKey)) || 0;

//     try {
//         // Try to sync with Firebase across devices
//         const productsRef = typeof getProductsRef === 'function' ? getProductsRef() : null;
        
//         if (productsRef && productsRef.path) {
//             // Build the exact string path to avoid .parent object confusion
//             const usagePath = productsRef.path.replace('/products', '/usage') + `/scans_${today}`;
//             const usageRef = doc(db, usagePath);
            
//             const usageSnap = await getDoc(usageRef);
//             if (usageSnap.exists()) {
//                 scansToday = Math.max(scansToday, usageSnap.data().count || 0);
//             }

//             if (scansToday < 10) {
//                 await setDoc(usageRef, { count: increment(1), lastScan: new Date().toISOString() }, { merge: true });
//             }
//         }
//     } catch (e) {
//         console.warn("Firebase usage tracker bypassed. Using local storage.", e.message);
//     }

//     // Check limit and update local storage fallback
//     if (scansToday >= 10) {
//         if (typeof window.showModal === 'function') {
//             window.showModal('Daily Limit Reached 🛑', 'You have reached your limit of 10 AI scans for today. Please try again tomorrow!', 'error');
//         } else {
//             alert('You have reached your limit of 10 AI scans for today.');
//         }
//         return false; 
//     }

//     // Increment local storage successfully
//     localStorage.setItem(localUsageKey, scansToday + 1);
    
//     return true; 
// }
// --- NEW: Firebase Bulk Upload Logic for Scanned Bills & Excel ---
// src/components/inventory.js

async function processScannedBulkUpload(itemsData) {
    activeDealerState = { id: null, phone: '', name: '' };
    if (typeof clearAndUnlockDealerFields === 'function') {
        clearAndUnlockDealerFields(true);
    }
    if (!itemsData || itemsData.length === 0) return;

    let currentBatch = writeBatch(db);
    let batchOpCount = 0;

    const productsRef = getProductsRef();
    const transactionsRef = getTransactionsRef();
    const customersRef = getCustomersRef(); 
    
    const assignedLoc = typeof getUserAssignedLocationId === 'function' ? getUserAssignedLocationId() : 'main';
    const safeTargetLoc = getNormalizedLoc(assignedLoc);

    const existingProductsSnap = await getDocs(productsRef);
    
    // 🚀 FIX: Convert to O(1) Dictionary Lookup to prevent O(N²) freezing
    const existingInventoryMap = new Map();
    existingProductsSnap.docs.forEach(d => {
        const p = d.data();
        
        // 1. Index by Barcode
        if (p.barcode) existingInventoryMap.set(`barcode_${p.barcode.trim()}`, { id: d.id, ...p });
        
        // 2. Index by SKU
        if (p.sku) existingInventoryMap.set(`sku_${p.sku.trim()}`, { id: d.id, ...p });
        
        // 3. Fallback Index (Name + Expiry + Batch)
        const fallbackKey = `fallback_${(p.name || '').trim().toLowerCase()}_${(p.expirationDate || '').trim()}_${(p.batch || '').trim().toUpperCase()}`;
        existingInventoryMap.set(fallbackKey, { id: d.id, ...p });
    });

    const newDealersMap = {}; 
    const invoiceGroups = {};

    for (let i = 0; i < itemsData.length; i++) {
        const item = itemsData[i];
        if (item.type === 'standard') {
            const rawPhone = item.dealerPhone ? String(item.dealerPhone).replace(/\D/g, '') : '';
            if (rawPhone.length < 10) {
                const msg = `Row ${i + 1} Error: A valid 10-digit Supplier Phone Number is strictly mandatory for the GST product "${item.name || 'Unknown Item'}".`;
                if (typeof window.showModal === 'function') window.showModal('Validation Failed', msg, 'error');
                throw new Error(msg);
            }
            
            // 🚀 THE FIX: Backend GSTIN validation interceptor
            const rawGstin = item.dealerGstin || item.gstin || '';
            if (rawGstin.length < 15) {
                const msg = `Row ${i + 1} Error: A valid 15-character Supplier GSTIN is strictly mandatory for the GST product "${item.name || 'Unknown Item'}".`;
                if (typeof window.showModal === 'function') window.showModal('Validation Failed', msg, 'error');
                throw new Error(msg);
            }
        }
    }
    for (const item of itemsData) {
        let currentDealerId = '';
        let currentDealerName = item.dealerName ? item.dealerName.trim() : 'Bulk Inventory Import';

        if (item.type === 'homemade' || item.type === 'manufactured') {
            currentDealerId = 'INTERNAL_MFG';
            currentDealerName = 'Internal Production';
            item.gstSlab = 0;
            item.cess = 0;
            item.dealerPhone = '';
            item.dealerGstin = '';
            item.supplierInvoice = ''; 
        } else {
            const generateSafeId = (str) => {
                let hash = 0x811c9dc5;
                for (let i = 0; i < str.length; i++) {
                    hash ^= str.charCodeAt(i);
                    hash = (hash * 0x01000193) >>> 0;
                }
                return hash.toString(36).toUpperCase().padStart(6, '0');
            };

            if (currentDealerName && currentDealerName !== 'Bulk Inventory Import') {
                let rawPhone = item.dealerPhone ? String(item.dealerPhone).replace(/\D/g, '') : '';
                if (rawPhone.length >= 10) {
                    let normalizedPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
                    currentDealerId = `MERCH-${generateSafeId(normalizedPhone)}`; 
                    
                    if (!newDealersMap[currentDealerId] && customersRef) {
                        const newDealerRef = doc(customersRef, currentDealerId);
                        currentBatch.set(newDealerRef, {
                            id: currentDealerId, 
                            name: currentDealerName, 
                            type: 'dealer',
                            phone: `+${normalizedPhone}`, 
                            gstin: item.dealerGstin || item.gstin || '',
                            pan: item.dealerPan || '',      
                            updatedAt: serverTimestamp()
                        }, { merge: true });

                        const currentAppId = typeof window !== 'undefined' && window.__app_id ? window.__app_id : appId;
                        if (currentAppId) {
                            const globalDirRef = doc(db, `artifacts/${currentAppId}/directory_merchants/${currentDealerId}`);
                            currentBatch.set(globalDirRef, {
                                merchantId: currentDealerId,
                                name: currentDealerName, 
                                storeName: currentDealerName,
                                type: 'dealer',
                                phone: `+${normalizedPhone}`,
                                gstin: item.dealerGstin || item.gstin || '',
                                pan: item.dealerPan || '',      
                                updatedAt: serverTimestamp()
                            }, { merge: true });
                            batchOpCount++;
                        }
                        
                        newDealersMap[currentDealerId] = { id: currentDealerId, name: currentDealerName };
                        batchOpCount++;
                    }
                }
            } else {
                currentDealerId = 'BULK_IMPORT';
            }
        }

        item.dealerId = currentDealerId;
        item.dealerName = currentDealerName;

        // 🚀 FIX: O(1) Dictionary Check
        const matchKey = `${(item.name || '').trim().toLowerCase()}_${(item.expirationDate || '').trim()}_${(item.batch || '').trim().toUpperCase()}`;
        
        let match = null;
        
        if (item.barcode) match = existingInventoryMap.get(`barcode_${item.barcode.trim()}`);
        
        if (!match && item.sku && !item.sku.startsWith('SKU')) {
            match = existingInventoryMap.get(`sku_${item.sku.trim()}`);
        }
        
        if (!match) {
            const fallbackKey = `fallback_${(item.name || '').trim().toLowerCase()}_${(item.expirationDate || '').trim()}_${(item.batch || '').trim().toUpperCase()}`;
            match = existingInventoryMap.get(fallbackKey);
        }

        const targetDocRef = match ? doc(productsRef, match.id) : doc(productsRef);
        let freshSku = match ? match.sku : `SKU${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 10000)}`;

        if (match) {
            // 🚀 THE FIX: Maintain FIFO batches & Weighted Avg Cost when merging!
            const currentBatches = match.batches ? [...match.batches] : [];
            
            if (item.stockLevel > 0) {
                currentBatches.push({
                    batchNo: item.batch || `BLK-${Date.now().toString().slice(-6)}`,
                    date: new Date().toISOString().split('T')[0],
                    qty: item.stockLevel,
                    cost: parseFloat(item.cost) || 0,
                    supplierId: currentDealerId || 'Bulk Import',
                    expirationDate: item.expirationDate || '',
                    timestamp: new Date().getTime(),
                    baseRate: item.baseRate || 0,
                    gstSlab: item.gstSlab || 0,
                    cess: item.cess || 0,
                    sl: item.supplierInvoice || '',
                    schDisc: item.schDisc || 0,
                    rsDisc: item.rsDisc || 0,
                    taxableAmt: item.taxableAmt || 0,
                    netAmt: item.netAmt || 0,
                    cases: item.cases || 0,
                    pieces: item.pieces || 0,
                    freeQty: item.freeQty || 0,
                    upc: item.upc || 1,
                    unit: item.unit || 'units'
                });
            }

            let newWac = parseFloat(match.cost) || 0;
            if (currentBatches.length > 0) {
                let totalVal = 0, totalQ = 0;
                currentBatches.forEach(b => {
                    totalVal += (parseFloat(b.qty) * parseFloat(b.cost));
                    totalQ += parseFloat(b.qty);
                });
                if (totalQ > 0) newWac = totalVal / totalQ;
            }

            currentBatch.set(targetDocRef, {
                stockLevel: increment(item.stockLevel), 
                freeQty: increment(item.freeQty || 0),
                batches: currentBatches,
                cost: newWac,
                updatedAt: serverTimestamp()
            }, { merge: true });
            
        } else {
            const finalBarcode = item.barcode && item.barcode !== item.sku ? item.barcode : freshSku;
            
            // 🚀 THE FIX: Standardize Batch Generation for New Bulk Imports
            const initialBatch = [{
                batchNo: item.batch || `BLK-${Date.now().toString().slice(-6)}`,
                date: new Date().toISOString().split('T')[0],
                qty: item.stockLevel || 0,
                cost: parseFloat(item.cost) || 0,
                supplierId: currentDealerId || 'Bulk Import',
                expirationDate: item.expirationDate || '',
                timestamp: new Date().getTime(),
                baseRate: item.baseRate || 0,
                gstSlab: item.gstSlab || 0,
                cess: item.cess || 0,
                sl: item.supplierInvoice || '',
                price: data.price, // 🚀 ADDED
                mrp: data.mrp,
                schDisc: item.schDisc || 0,
                rsDisc: item.rsDisc || 0,
                taxableAmt: item.taxableAmt || 0,
                netAmt: item.netAmt || 0,
                cases: item.cases || 0,
                pieces: item.pieces || 0,
                freeQty: item.freeQty || 0,
                upc: item.upc || 1,
                unit: item.unit || 'units'
            }];

            currentBatch.set(targetDocRef, {
                ...item, 
                sku: freshSku,
                barcode: finalBarcode,
                batches: initialBatch, // Inject the array here
                createdAt: new Date().toISOString(), 
                updatedAt: serverTimestamp()
            });
        }
        batchOpCount++;

        // 🚀 FIX: Chunk Control for Safety
        if (batchOpCount >= 400) {
            await currentBatch.commit();
            currentBatch = writeBatch(db);
            batchOpCount = 0;
        }

        if (item.stockLevel > 0) { 
            const invoiceStr = item.supplierInvoice || 'NO_INV';
            const groupKey = `${invoiceStr}_${currentDealerId}`; 

            if (!invoiceGroups[groupKey]) {
                invoiceGroups[groupKey] = {
                    supplierInvoice: item.supplierInvoice || '',
                    dealerId: currentDealerId,
                    dealerName: currentDealerName,
                    gstin: item.dealerGstin || item.gstin || '',
                    paymentMethod: item.paymentMethod || 'CASH',
                    chequeDetails: item.chequeDetails || null,
                    roundOffApplied: item.roundOffApplied || 0,
                    invoiceTotalOverride: item.invoiceTotalOverride, 
                    calculatedSum: 0,
                    txType: (item.type === 'homemade' || item.type === 'manufactured') ? 'PRODUCTION' : 'PURCHASE',
                    items: []
                };
            }

            invoiceGroups[groupKey].calculatedSum += item.netAmt;
            const dealerStateCode = item.gstin ? String(item.gstin).substring(0, 2) : '';
            const isInterState = dealerStateCode !== '' && dealerStateCode !== '27'; 

            invoiceGroups[groupKey].items.push({
                id: targetDocRef.id, 
                name: item.name, 
                sku: freshSku, 
                quantity: item.stockLevel, 
                cost: item.cost, 
                price: item.price,
                taxRate: item.gstSlab || 0, 
                cessRate: item.cess || item.cessPct || 0,
                isOms: isInterState,
                amount: item.netAmt, 
                total: item.netAmt, 
                subtotal: item.taxableAmt
            });
        }
    }

    const groupKeys = Object.keys(invoiceGroups);
    for (const key of groupKeys) {
        const group = invoiceGroups[key];
        if (group.items.length > 0) {
            const txRef = doc(transactionsRef);
            const finalTxTotal = group.invoiceTotalOverride !== undefined ? group.invoiceTotalOverride : group.calculatedSum;
            
            let generatedInvoiceId;
            let reasonStr;
            const invoiceStr = group.supplierInvoice || 'NO_INV';

            if (group.txType === 'PRODUCTION') {
                generatedInvoiceId = `MFG-${Date.now().toString().slice(-6)}`;
                reasonStr = 'Initial Production Stock';
            } else {
                generatedInvoiceId = group.supplierInvoice ? `SUPP-${group.supplierInvoice}` : `PUR-SCAN-${Date.now()}-${Math.floor(Math.random()*1000)}`;
                reasonStr = group.supplierInvoice ? 'Excel/AI Import' : 'Bulk Inventory Import';
            }
            
            currentBatch.set(txRef, {
                invoiceId: generatedInvoiceId, 
                supplierInvoice: group.supplierInvoice || '',
                storeId: getStoreId(), 
                locationId: safeTargetLoc, 
                timestamp: serverTimestamp(), 
                type: group.txType, 
                status: 'completed',
                customer: { 
                    id: group.dealerId, 
                    name: group.dealerName, 
                    gstin: group.gstin 
                },
                summary: { 
                    total: finalTxTotal, 
                    discount: group.roundOffApplied || 0, 
                    profit: 0, 
                    paymentMethod: group.paymentMethod, 
                    chequeDetails: group.chequeDetails,
                    reason: reasonStr, 
                    itemCount: group.items.reduce((sum, i) => sum + i.quantity, 0) 
                },
                items: group.items, 
                cashierId: getUserId(),
                cashierName: (() => {
                    try {
                        const fbKey = Object.keys(localStorage).find(k => k.startsWith('firebase:authUser:'));
                        if (fbKey) return JSON.parse(localStorage.getItem(fbKey)).displayName || 'Store Admin';
                    } catch (e) {} return 'Store Admin';
                })(),
                currency: { code: getCurrencyCode(), symbol: getCurrencySymbol() }
            });

            batchOpCount++;
            if (batchOpCount >= 400) {
                await currentBatch.commit();
                currentBatch = writeBatch(db);
                batchOpCount = 0;
            }
        }
    }

    if (batchOpCount > 0) {
        await currentBatch.commit();
    }

    if (typeof window.showModal === 'function') window.showModal('Success', `Imported & Merged ${itemsData.length} items!`, 'success');
    if (typeof renderInventoryTable === 'function') renderInventoryTable();
    if (typeof loadDealerDropdowns === 'function') loadDealerDropdowns();
}

window.downloadCsvTemplate = function() {
    const csvContent = "data:text/csv;charset=utf-8,Item Name,Category,Cost Price,Selling Price,Stock Quantity,GST %,HSN Code\nSample Coffee,Grocery,100,150,50,5,2101";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "Mifela_Stock_Template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

export async function handleInventoryLookup(code) {
    if (!code) return;

    // 🚀 FIX: Correctly reference localProductsCache (not localProductIndex)
    const match = localProductsCache.find(p => p.sku === code || p.barcode === code);

    if (match) {
        // 1. Basic Details
        const nameInput = document.getElementById('prod-name'); // Using standard IDs
        if (nameInput) nameInput.value = match.name || '';
        
        document.getElementById('prod-mrp').value = match.mrp || match.price || 0;
        document.getElementById('price').value = match.price || 0;
        document.getElementById('cost').value = match.cost || 0;

        // 2. Identifiers & Packaging (NEW)
        document.getElementById('prod-hsn').value = match.hsn || '';
        document.getElementById('prod-batch').value = match.batch || '';
        document.getElementById('prod-upc').value = match.upc || 1;
        document.getElementById('prod-sl').value = match.sl || '';
        
        // Ensure barcode field reflects the code if it was found via SKU
        if (document.getElementById('barcode')) {
            document.getElementById('barcode').value = match.barcode || match.sku || '';
        }

        // 3. Tax Slab
        const gstSelect = document.getElementById('gst-slab');
        if (gstSelect) gstSelect.value = match.gstSlab || 0;

        // 4. Dealer Info
        if (document.getElementById('prod-dealer')) {
            document.getElementById('prod-dealer').value = match.dealerName || '';
            document.getElementById('prod-dealer-id').value = match.dealerId || '';
            document.getElementById('prod-dealer-phone').value = match.dealerPhone || '';
        }

        // 🚀 CRITICAL: Set the hidden ID so "Save" becomes "Update"
        setEditingProductId(match.id);

        // Update UI Text
        const title = document.getElementById('inventory-form-title');
        if (title) title.textContent = `Edit / Restock: ${match.name}`;
        
        const saveBtn = document.getElementById('save-product-btn');
        if (saveBtn) {
            saveBtn.textContent = 'Update Product & Stock';
            saveBtn.classList.replace('bg-indigo-600', 'bg-emerald-600');
        }

        // Reveal the Cancel button
        document.getElementById('cancel-edit-btn')?.classList.remove('hidden');

        showToast("Product Found", `Loaded ${match.name}`, "success");
    }
}
// =========================================================
// 9. POS IMAGE UPLOADER & AUTO-COMPRESSOR
// =========================================================

window.currentImageUploadSku = null;

window.triggerPosImageUpload = function(sku) {
    window.currentImageUploadSku = sku;
    let input = document.getElementById('hidden-pos-image-input');
    
    if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = 'hidden-pos-image-input';
        input.accept = 'image/*';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file || !window.currentImageUploadSku) return;
            
            if (typeof window.showModal === 'function') {
                window.showModal('Processing...', 'Optimizing image for POS...', 'info');
            }

            try {
                // 1. Auto-compress the image
                const compressedBase64 = await window.compressImageForPos(file);
                
                // 2. Save to local database
                await savePosImage(window.currentImageUploadSku, compressedBase64);
                
                // 3. Refresh the table
                if (typeof renderInventoryTable === 'function') renderInventoryTable();
                
            } catch (error) {
                console.error("Image save failed:", error);
                if (typeof showModal === 'function') showModal("Error", "Failed to save image.", "error");
            } finally {
                input.value = ''; // Reset input
                
                // 🚀 THE FIX: Always forcefully kill the modals in the 'finally' block!
                const genModal = document.getElementById('generic-modal');
                if (genModal) {
                    genModal.classList.add('hidden');
                    genModal.classList.remove('flex');
                }
                
                const customModal = document.getElementById('custom-modal');
                if (customModal) customModal.remove();

                // 🚀 NEW: Instantly release the scroll lock so the user doesn't have to wait for the Ghostbuster
                document.body.classList.remove('overflow-hidden');
                document.documentElement.classList.remove('overflow-hidden');
            }
        });
    }
    
    input.click(); // Trigger the file picker!
};

// The Auto-Compressor
window.compressImageForPos = function(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const size = 300; // Perfect square for POS tiles
                canvas.width = size;
                canvas.height = size;
                
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = "#F8FAFC"; // Light slate background for transparent PNGs
                ctx.fillRect(0, 0, size, size);
                
                // Crop and center
                const scale = Math.max(size / img.width, size / img.height);
                const x = (size / 2) - (img.width / 2) * scale;
                const y = (size / 2) - (img.height / 2) * scale;
                ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
                
                // Export as lightweight JPEG
resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
};
// =========================================================
// 🚀 INVENTORY MERGE ENGINE (CLEANUP UTILITY)
// =========================================================

export async function mergeDuplicateInventoryItems() {
    // 🚀 THE FIX: Replaced native confirm() with HTML modal wrapper
    showModal('Confirm Merge', "This will scan your entire inventory. Products with the exact same Name and Store/Dealer will be merged into a single item. Their stock will be combined into the Batch Registry. Continue?", 'confirm', async () => {
        const btn = document.getElementById('merge-inventory-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<svg class="animate-spin h-4 w-4 mr-2 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Merging...`;
        }

        try {
            const productsRef = getProductsRef();
            const transactionsRef = getTransactionsRef();
            if (!productsRef) throw new Error("Database not ready.");

            const snap = await getDocs(query(productsRef));
            const allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            const groups = {};
            allProducts.forEach(p => {
                const safeName = (p.name || '').trim().toLowerCase();
                const safeDealer = (p.dealerName || '').trim().toLowerCase();
                const key = `${safeName}|${safeDealer}`;
                
                if (!groups[key]) groups[key] = [];
                groups[key].push(p);
            });

            let currentBatch = writeBatch(db);
            let batchOpCount = 0; 
            let mergedGroupsCount = 0;
            let deletedDuplicatesCount = 0;

            for (const key in groups) {
                const items = groups[key];
                
                if (items.length > 1) {
                    mergedGroupsCount++;
                    
                    items.sort((a, b) => {
                        const getTime = (val) => {
                            if (!val) return 0;
                            if (typeof val.toMillis === 'function') return val.toMillis();
                            if (val.seconds) return val.seconds * 1000;
                            return new Date(val).getTime() || 0;
                        };
                        return getTime(a.createdAt) - getTime(b.createdAt);
                    });

                    const master = items[0];
                    const duplicates = items.slice(1);
                    let masterBatches = master.batches ? [...master.batches] : [];
                    
                    const masterStock = parseFloat(master.stockLevel) || 0;
                    if (masterBatches.length === 0 && masterStock > 0) {
                        masterBatches.push({
                            batchNo: 'LEGACY-STOCK',
                            date: master.createdAt ? master.createdAt.split('T')[0] : new Date().toISOString().split('T')[0],
                            qty: masterStock,
                            cost: parseFloat(master.cost) || 0,
                            supplierId: master.dealerId || 'Manual/Mfg',
                            timestamp: master.createdAt ? new Date(master.createdAt).getTime() : new Date().getTime()
                        });
                    }

                    let totalAddedStock = 0;

                    for (const dup of duplicates) {
                        const dupStock = parseFloat(dup.stockLevel) || 0;
                        
                        if (dupStock > 0) {
                            totalAddedStock += dupStock;
                            if (dup.batches && dup.batches.length > 0) {
                                masterBatches = masterBatches.concat(dup.batches);
                            } else {
                                masterBatches.push({
                                    batchNo: dup.batch || `MERGED-${Date.now().toString().slice(-4)}`,
                                    date: dup.purchaseDate || (dup.createdAt ? dup.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]),
                                    qty: dupStock,
                                    cost: parseFloat(dup.cost) || 0,
                                    supplierId: dup.dealerId || 'Manual/Mfg',
                                    timestamp: dup.createdAt ? new Date(dup.createdAt).getTime() : new Date().getTime()
                                });
                            }
                        }

                        currentBatch.delete(doc(productsRef, dup.id));
                        deletedDuplicatesCount++;
                        batchOpCount++;

                        if (batchOpCount >= 400) {
                            await currentBatch.commit();
                            currentBatch = writeBatch(db);
                            batchOpCount = 0;
                        }
                    }

                    let newWac = parseFloat(master.cost) || 0;
                    let totalVal = 0, totalQ = 0;
                    if (masterBatches.length > 0) {
                        masterBatches.forEach(b => {
                            totalVal += (parseFloat(b.qty) * parseFloat(b.cost));
                            totalQ += parseFloat(b.qty);
                        });
                        if (totalQ > 0) newWac = totalVal / totalQ;
                    }

                    currentBatch.update(doc(productsRef, master.id), {
                        stockLevel: increment(totalAddedStock),
                        batches: masterBatches,
                        cost: newWac,
                        updatedAt: serverTimestamp()
                    });
                    batchOpCount++;

                    if (batchOpCount >= 400) {
                        await currentBatch.commit();
                        currentBatch = writeBatch(db);
                        batchOpCount = 0;
                    }
                }
            }

            if (batchOpCount > 0) {
                await currentBatch.commit();
            }

            if (deletedDuplicatesCount > 0) {
                if (typeof showModal === 'function') showModal('Migration Complete', `Successfully merged ${mergedGroupsCount} product groups and removed ${deletedDuplicatesCount} duplicate rows.`, 'success');
                if (typeof renderInventoryTable === 'function') renderInventoryTable();
                if (typeof updateInventoryCountDisplay === 'function') updateInventoryCountDisplay();
            } else {
                if (typeof showModal === 'function') showModal('All Good!', 'No duplicates found. Your inventory is already perfectly consolidated.', 'info');
            }

        } catch (error) {
            console.error("Merge error:", error);
            if (typeof showModal === 'function') showModal('Error', "Failed to merge inventory: " + error.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `Merge Duplicates`;
            }
        }
    });
}
// =========================================================
// 🛡 AUTO-GHOSTBUSTER: PURE PASSIVE SWEEPER
// =========================================================

// 🚀 THE FIX: The Ultimate Passive Sweeper.
// Continuously scans for and neutralizes invisible overlays without 
// interfering with native clicks, date-pickers, forms, or typing.
setInterval(() => {
    let activeModals = 0;
    
    // 1. Clean up broken modal wrappers
    const overlays = document.querySelectorAll('.fixed.inset-0:not(.hidden)');
    overlays.forEach(el => {
        const style = window.getComputedStyle(el);
        const isTransparent = style.opacity === '0' || style.visibility === 'hidden';
        const isEmpty = el.children.length === 0;

        if (isEmpty || isTransparent) {
            el.classList.add('hidden');
            el.classList.remove('flex');
            el.style.pointerEvents = 'none';
        } else {
            activeModals++;
        }
    });

    // 2. Release global scroll lock if no legitimate modals are open
    if (activeModals === 0 && (document.body.classList.contains('overflow-hidden') || document.documentElement.classList.contains('overflow-hidden'))) {
        document.body.classList.remove('overflow-hidden');
        document.documentElement.classList.remove('overflow-hidden');
    }
    
    // 3. Neutralize invisible full-screen click traps
    const allAbsoluteFixed = document.querySelectorAll('div.fixed, div.absolute');
    allAbsoluteFixed.forEach(el => {
        if (el.classList.contains('hidden') || el.style.pointerEvents === 'none') return;
        
        const rect = el.getBoundingClientRect();
        const coversScreen = rect.width >= window.innerWidth * 0.8 && rect.height >= window.innerHeight * 0.8;
        
        if (coversScreen) {
            const style = window.getComputedStyle(el);
            const isInvisibleTrap = style.opacity === '0' || 
                                    style.backgroundColor === 'rgba(0, 0, 0, 0)' || 
                                    style.backgroundColor === 'transparent';
            
            if (isInvisibleTrap) {
                el.style.pointerEvents = 'none';
                console.log('🧹 Ghostbuster passively neutralized an invisible click trap:', el.id || el.className);
            }
        }
    });

}, 1500);
// ============================================================================
// 🏷️ B2B CUSTOMER PRICING ENGINE 
// ============================================================================

export function injectB2BPricingButton() {
    const actionContainer = document.getElementById('inventory-action-buttons');
    
    if (!actionContainer || document.getElementById('btn-b2b-pricing')) return;

    const b2bBtn = document.createElement('button');
    b2bBtn.id = 'btn-b2b-pricing';
    
    // 🚀 THE FIX: Perfectly matched the soft pastel CSS blueprint of the adjacent buttons!
    b2bBtn.className = "px-4 py-2 text-sm font-bold text-purple-700 bg-purple-50 border border-purple-200 rounded-xl hover:bg-purple-100 hover:border-purple-300 shadow-sm transition-all flex items-center gap-2 whitespace-nowrap";
    
    // Swapped the SVG stroke-width back to 2 to match the other icons perfectly
    b2bBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg> Manage B2B Rates`;
    b2bBtn.onclick = openB2BPricingModal;
    
    actionContainer.appendChild(b2bBtn);
}
window.b2bProductState = { customerId: null, page: 1, search: '', sort: 'name_asc' };

async function openB2BPricingModal() {
    const modalId = 'b2b-pricing-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();
    
    window.b2bProductsCache = (window.dbAPI && window.dbAPI.getProducts) 
        ? await window.dbAPI.getProducts() 
        : [...(localProductsCache || [])];
        
    document.documentElement.classList.add('overflow-hidden');
    document.body.classList.add('overflow-hidden');
    
    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[200] bg-slate-900/60 flex items-center justify-center p-4">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col h-[90vh] overflow-hidden border border-slate-100">
                <div class="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0 shadow-sm z-10">
                    <div>
                        <h3 class="text-xl font-black text-slate-800 flex items-center gap-2">
                            <span class="bg-indigo-100 text-indigo-600 p-1.5 rounded-lg">🏷️</span> B2B Custom Rates Manager
                        </h3>
                        <p class="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Assign special pricing per customer</p>
                    </div>
                    <button onclick="document.getElementById('${modalId}').remove(); document.documentElement.classList.remove('overflow-hidden'); document.body.classList.remove('overflow-hidden');" class="text-slate-400 hover:text-red-500 transition-colors bg-white p-2 rounded-full shadow-sm border border-slate-200">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="p-4 border-b border-slate-100 bg-white shrink-0 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
                    <input type="text" id="b2b-customer-search" placeholder="🔍 Search customers by name or phone..." class="w-full border-2 border-slate-200 rounded-xl p-3 text-sm font-bold text-slate-700 focus:border-indigo-500 outline-none transition-colors bg-slate-50 focus:bg-white">
                </div>
               <div class="flex-1 overflow-y-auto overscroll-contain p-6 bg-slate-100 custom-scrollbar transform-gpu [-webkit-overflow-scrolling:touch]" id="b2b-modal-content">
                    <div class="text-center py-10 text-slate-400 font-bold animate-pulse">Loading Directory...</div>
                </div>
            </div>
        </div>
    `;
    
    document.body.classList.remove('overflow-hidden');
    document.body.insertAdjacentHTML('beforeend', html);

    const content = document.getElementById('b2b-modal-content');
    
    try {
        let customers = [];
        if (window.dbAPI && window.dbAPI.getCustomers) {
            customers = await window.dbAPI.getCustomers();
        } else if (typeof localCustomersCache !== 'undefined') {
            customers = localCustomersCache;
        }
        
        window.b2bCustomersCache = customers.filter(c => {
            const cid = String(c.id || c.docId || c.merchantId || '');
            if (c.role !== undefined || c.permissions !== undefined) return false;
            if (c.date !== undefined && c.records !== undefined) return false;
            if (cid.includes('shifts_') || Array.isArray(c.records)) return false;
            if (cid.includes('_att_') || cid.includes('helper_') || cid.includes('staff_') || cid.includes('user_')) return false;
            return true;
        }).sort((a,b) => (a.name||a.storeName||'').localeCompare(b.name||b.storeName||''));
        
        if (window.b2bCustomersCache.length === 0) {
            content.innerHTML = `<div class="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-dashed border-slate-300"><span class="text-5xl mb-4 opacity-50">👥</span><p class="text-slate-500 font-bold text-lg">No customers found.</p><p class="text-xs text-slate-400 mt-1 uppercase tracking-widest">Please add a customer in the Trade tab first.</p></div>`;
            return;
        }

        if (typeof window.renderB2BCustomerList === 'function') {
            window.renderB2BCustomerList();
        }
        
        document.getElementById('b2b-customer-search').addEventListener('input', (e) => {
            if (typeof window.renderB2BCustomerList === 'function') {
                window.renderB2BCustomerList(e.target.value.trim());
            }
        });
        
    } catch (err) {
        console.error(err);
        content.innerHTML = `<div class="text-center py-10 text-red-500 font-bold">Failed to load customers.</div>`;
    }
}

window.renderB2BCustomerList = function(searchTerm = '') {
    const content = document.getElementById('b2b-modal-content');
    if (!content) return;
    
    let filtered = window.b2bCustomersCache;
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filtered = filtered.filter(c => (c.name || '').toLowerCase().includes(term) || (c.phone || '').includes(term));
    }
    
    if (filtered.length === 0) {
        content.innerHTML = `<div class="text-center py-10 text-slate-400 font-bold">No matching customers.</div>`;
        return;
    }
    
    const html = filtered.map(c => {
        const activeRatesCount = Object.keys(c.customPricing || {}).length;
        const countBadgeClass = activeRatesCount > 0 ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-200 text-slate-600';
        
        return `
        <div class="mb-4 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden transition-all b2b-accordion" data-customer-id="${c.id}">
            <div class="px-6 py-4 flex justify-between items-center cursor-pointer hover:bg-indigo-50/50 transition-colors" onclick="window.toggleB2BCustomer('${c.id}')">
                <div>
                    <h4 class="font-black text-slate-800 text-lg">${escapeHTML(c.name || c.storeName || 'Unknown')}</h4>
                    <p class="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">${escapeHTML(c.phone || c.type || 'Customer')}</p>
                </div>
                <div class="flex items-center gap-4">
                    <span class="text-[10px] font-black px-3 py-1.5 rounded-lg ${countBadgeClass}" id="b2b-count-${c.id}">${activeRatesCount} Custom Rates</span>
                    <div class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center border border-slate-200">
                        <svg class="w-5 h-5 text-slate-400 transition-transform duration-300 b2b-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                </div>
            </div>
            <div id="b2b-body-${c.id}" class="hidden border-t border-slate-200 bg-slate-50 p-6 shadow-inner">
                </div>
        </div>
    `}).join('');
    
    content.innerHTML = html;
};

window.toggleB2BCustomer = function(customerId) {
    const body = document.getElementById(`b2b-body-${customerId}`);
    const accordion = body.closest('.b2b-accordion');
    const arrow = accordion.querySelector('.b2b-arrow');
    
    // Close all other accordions
    document.querySelectorAll('.b2b-accordion .b2b-arrow').forEach(a => { if (a !== arrow) a.classList.remove('rotate-180'); });
    document.querySelectorAll('.b2b-accordion > div:nth-child(2)').forEach(b => { if (b !== body) b.classList.add('hidden'); });
    document.querySelectorAll('.b2b-accordion').forEach(acc => { if (acc !== accordion) acc.classList.remove('border-indigo-400', 'ring-2', 'ring-indigo-100'); });
    
    if (body.classList.contains('hidden')) {
        body.classList.remove('hidden');
        arrow.classList.add('rotate-180');
        accordion.classList.add('border-indigo-400', 'ring-2', 'ring-indigo-100');
        
        window.b2bProductState = { customerId, page: 1, search: '', sort: 'name_asc' };
        window.renderB2BProducts(customerId);
    } else {
        body.classList.add('hidden');
        arrow.classList.remove('rotate-180');
        accordion.classList.remove('border-indigo-400', 'ring-2', 'ring-indigo-100');
    }
};

window.renderB2BProducts = function(customerId) {
    const body = document.getElementById(`b2b-body-${customerId}`);
    if (!body) return;
    
    if (!document.getElementById(`b2b-controls-${customerId}`)) {
        body.innerHTML = `
            <div id="b2b-controls-${customerId}" class="flex gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <input type="text" placeholder="Search inventory..." class="flex-1 border-2 border-slate-100 rounded-lg p-2 text-sm font-bold text-slate-700 focus:border-indigo-500 outline-none transition-colors bg-slate-50 focus:bg-white" oninput="window.b2bProductState.search = this.value; window.b2bProductState.page = 1; window.renderB2BProductsTable('${customerId}')">
                <select class="border-2 border-slate-100 rounded-lg p-2 text-sm font-bold text-slate-600 focus:border-indigo-500 outline-none bg-slate-50 cursor-pointer" onchange="window.b2bProductState.sort = this.value; window.b2bProductState.page = 1; window.renderB2BProductsTable('${customerId}')">
                    <option value="name_asc">Sort: A-Z</option>
                    <option value="custom_first">Sort: Custom Rates First</option>
                </select>
            </div>
            <div id="b2b-table-${customerId}" class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"></div>
            <div id="b2b-pagination-${customerId}" class="mt-4 flex justify-between items-center text-sm"></div>
        `;
        setTimeout(() => window.renderB2BProductsTable(customerId), 0);
    } else {
        window.renderB2BProductsTable(customerId);
    }
};

window.renderB2BProductsTable = function(customerId) {
    const tableContainer = document.getElementById(`b2b-table-${customerId}`);
    const pagContainer = document.getElementById(`b2b-pagination-${customerId}`);
    if (!tableContainer) return;
    
    const state = window.b2bProductState;
    const customer = window.b2bCustomersCache.find(c => c.id === customerId);
    const customPricing = customer.customPricing || {};
    let products = [...(window.b2bProductsCache || [])];
    
    // 1. Filter
    if (state.search) {
        const term = state.search.toLowerCase();
        products = products.filter(p => (p.name || '').toLowerCase().includes(term) || (p.sku || '').toLowerCase().includes(term));
    }
    
    // 2. Sort
    if (state.sort === 'name_asc') {
        products.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (state.sort === 'custom_first') {
        products.sort((a, b) => {
            const hasA = customPricing[a.id] ? 1 : 0;
            const hasB = customPricing[b.id] ? 1 : 0;
            if (hasA !== hasB) return hasB - hasA; 
            return (a.name || '').localeCompare(b.name || '');
        });
    }
    
    // 3. Pagination (10 per page)
    const itemsPerPage = 10;
    const totalItems = products.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    if (state.page > totalPages) state.page = totalPages;
    
    const start = (state.page - 1) * itemsPerPage;
    const pagedProducts = products.slice(start, start + itemsPerPage);
    
    const currency = '₹';
    const rows = pagedProducts.map(p => {
        const currentCustomPrice = customPricing[p.id]?.price;
        const hasCustom = currentCustomPrice !== undefined;
        const valStr = hasCustom ? currentCustomPrice.toFixed(2) : '';
        const basePrice = parseFloat(p.price || 0).toFixed(2);
        
        return `
            <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td class="p-4 w-1/4 text-sm font-bold text-slate-800 align-middle break-words">
                    ${escapeHTML(p.name)} <br>
                    <span class="text-[10px] text-slate-400 font-mono tracking-widest">${escapeHTML(p.sku || p.barcode || '')}</span>
                </td>
                
                <td class="p-4 w-1/4 text-sm font-bold text-slate-500 text-center align-middle">
                    ${currency}${basePrice}
                </td>
                
                <td class="p-4 w-1/4 align-middle">
                    <div class="flex items-center justify-center gap-2">
                        <span class="text-slate-400 font-bold">${currency}</span>
                        <input type="number" id="b2b-input-${customerId}-${p.id}" value="${valStr}" placeholder="${basePrice}" class="w-24 border-2 ${hasCustom ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-800'} rounded-lg p-2 text-sm font-black text-center focus:border-indigo-600 outline-none transition-colors">
                    </div>
                </td>
                
                <td class="p-4 w-1/4 align-middle">
                    <div class="flex justify-center items-center gap-2 h-9">
                        <button onclick="window.saveB2BPrice('${customerId}', '${p.id}', '${escapeHTML(p.name).replace(/'/g, "\\'")}')" class="${hasCustom ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-slate-800 hover:bg-slate-900'} text-white w-20 rounded-lg text-xs font-bold shadow-sm transition-all active:scale-95 flex justify-center items-center h-full">
                            ${hasCustom ? 'Update' : 'Set Rate'}
                        </button>
                        ${hasCustom ? `
                        <button onclick="window.resetB2BPrice('${customerId}', '${p.id}', '${escapeHTML(p.name).replace(/'/g, "\\'")}')" class="bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 hover:text-red-700 w-10 h-full rounded-lg text-xs font-bold shadow-sm transition-all active:scale-95 flex justify-center items-center" title="Remove custom rate and reset to default">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                        ` : '<div class="w-10 h-full"></div>'}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    tableContainer.innerHTML = `
        <table class="w-full table-fixed">
            <thead class="bg-slate-100 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-200">
                <tr>
                    <th class="p-4 w-1/4 text-left">Product</th>
                    <th class="p-4 w-1/4 text-center">Shop Rate</th>
                    <th class="p-4 w-1/4 text-center">Hotel / Custom Rate</th>
                    <th class="p-4 w-1/4 text-center">Action</th>
                </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="4" class="p-8 text-center text-slate-400 font-bold">No products found.</td></tr>`}</tbody>
        </table>
    `;
    
    pagContainer.innerHTML = `
        <span class="text-slate-500 font-bold text-xs uppercase tracking-widest">Showing ${start + 1} to ${Math.min(start + itemsPerPage, totalItems)} of ${totalItems}</span>
        <div class="flex gap-2 bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
            <button onclick="window.b2bProductState.page--; window.renderB2BProductsTable('${customerId}')" class="px-4 py-1.5 bg-white rounded-md hover:bg-slate-50 disabled:opacity-30 font-bold text-slate-600 transition-colors" ${state.page === 1 ? 'disabled' : ''}>Prev</button>
            <span class="px-4 py-1.5 font-black text-indigo-700 bg-indigo-50 rounded-md border border-indigo-100">Page ${state.page}</span>
            <button onclick="window.b2bProductState.page++; window.renderB2BProductsTable('${customerId}')" class="px-4 py-1.5 bg-white rounded-md hover:bg-slate-50 disabled:opacity-30 font-bold text-slate-600 transition-colors" ${state.page === totalPages ? 'disabled' : ''}>Next</button>
        </div>
    `;
};

window.resetB2BPrice = async function(customerId, productId, productName) {
    const customer = window.b2bCustomersCache.find(c => c.id === customerId);
    if (!customer || !customer.customPricing || !customer.customPricing[productId]) return;

    const input = document.getElementById(`b2b-input-${customerId}-${productId}`);
    if (input) input.value = '';

    delete customer.customPricing[productId];

    try {
        // 🚀 THE FIX: Use local offline batch writer instead of Firebase updateDoc
        const batch = writeBatch();
        batch.set(doc('customers', customerId), { customPricing: customer.customPricing }, { merge: true });
        await batch.commit();
        
        const countSpan = document.getElementById(`b2b-count-${customerId}`);
        if (countSpan) {
            const newCount = Object.keys(customer.customPricing).length;
            countSpan.textContent = `${newCount} Custom Rates`;
            countSpan.className = `text-[10px] font-black px-3 py-1.5 rounded-lg ${newCount > 0 ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-200 text-slate-600'}`;
        }
        
        if (typeof showToast === 'function') {
            showToast('Reset Success', `Custom rate for ${productName} removed. Standard shop rate applies.`, 'info');
        }
        window.renderB2BProductsTable(customerId); 
    } catch (e) {
        console.error("Failed to reset B2B rate", e);
        alert("Failed to reset rate.");
    }
};

window.saveB2BPrice = async function(customerId, productId, productName) {
    const input = document.getElementById(`b2b-input-${customerId}-${productId}`);
    const val = parseFloat(input.value);
    
    const customer = window.b2bCustomersCache.find(c => c.id === customerId);
    if (!customer) return;
    
    customer.customPricing = customer.customPricing || {};
    
    let isDelete = false;
    if (isNaN(val) || val < 0 || input.value.trim() === '') {
        delete customer.customPricing[productId]; 
        isDelete = true;
    } else {
        customer.customPricing[productId] = { name: productName, price: val }; 
    }
    
    try {
        // 🚀 THE FIX: Use local offline batch writer instead of Firebase updateDoc
        const batch = writeBatch();
        batch.set(doc('customers', customerId), { customPricing: customer.customPricing }, { merge: true });
        await batch.commit();
        
        const countSpan = document.getElementById(`b2b-count-${customerId}`);
        if (countSpan) {
            const newCount = Object.keys(customer.customPricing).length;
            countSpan.textContent = `${newCount} Custom Rates`;
            countSpan.className = `text-[10px] font-black px-3 py-1.5 rounded-lg ${newCount > 0 ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-200 text-slate-600'}`;
        }
        
        if (typeof showToast === 'function') {
            showToast('Saved', isDelete ? 'Custom rate removed. Default applies.' : `Rate for ${productName} locked at ₹${val.toFixed(2)}`, 'success');
        }
        window.renderB2BProductsTable(customerId); 
    } catch (e) {
        console.error("Failed to save B2B rate", e);
        alert("Failed to save rate.");
    }
};
function capitalizeName(name) {
    if (!name) return "";
    return name.toString().toLowerCase().split(' ').map(word => {
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
}
window.openInventoryGuideModal = function() {
    const modalId = 'inventory-guide-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();

    // 🚀 THE FIX: Lock the background scrolling immediately
    document.body.classList.add('overflow-hidden');
    document.documentElement.classList.add('overflow-hidden');

    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[300] bg-slate-900/70 flex items-center justify-center p-4  ">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden max-h-[90vh] animate-scaleIn">
                <div class="px-6 py-4 border-b border-slate-100 bg-indigo-50 flex justify-between items-center shrink-0">
                    <h2 class="text-xl font-black text-indigo-900 flex items-center gap-2">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        Inventory & Workflow Guide
                    </h2>
                    <!-- 🚀 THE FIX: Unlock the background scrolling when closed -->
                    <button onclick="document.getElementById('${modalId}').remove(); document.body.classList.remove('overflow-hidden'); document.documentElement.classList.remove('overflow-hidden');" class="text-indigo-400 hover:text-indigo-700 bg-white rounded-full p-1.5 transition shadow-sm">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                
                <div class="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6 text-sm text-slate-600 bg-slate-50">
                    
                    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <h3 class="font-black text-slate-800 text-base mb-2 border-b pb-2">🔄 Primary Workflows</h3>
                        <ul class="space-y-3 font-medium">
                            <li><strong class="text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">1. Add New Product:</strong> Fill out the form completely. A new SKU will be generated automatically. When saved, the stock is logged as your first batch.</li>
                            <li><strong class="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">2. Restock (Add Batch):</strong> Click "Edit" on a product in the table below. Enter the newly received quantities (Cases/Pieces) and the Supplier Invoice details. <strong>Do not overwrite the existing total stock</strong>—the system will safely add your new pieces to the total and log a new batch.</li>
                            <li><strong class="text-amber-700 bg-amber-50 px-2 py-0.5 rounded">3. Edit Metadata:</strong> Click "Edit", change the Selling Price, MRP, Name, or Thresholds, leave stock fields empty (0), and click Update.</li>
                        </ul>
                    </div>

                    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <h3 class="font-black text-slate-800 text-base mb-2 border-b pb-2">📦 Physical Stock Calculation</h3>
                        <p class="mb-2">The system calculates physical stock automatically based on what you received in the delivery:</p>
                        <ul class="list-disc pl-5 space-y-1 font-medium">
                            <li><strong class="text-slate-800">CS (Cases):</strong> Master cartons.</li>
                            <li><strong class="text-slate-800">UPC:</strong> Units Per Case (How many items are inside one carton).</li>
                            <li><strong class="text-slate-800">Pcs (Loose):</strong> Individual loose units.</li>
                            <li><strong class="text-emerald-600">Free (FOC):</strong> Free items given by the supplier (Not taxed, but adds to physical stock).</li>
                        </ul>
                        <div class="mt-3 p-3 bg-slate-50 rounded text-xs font-mono text-slate-500 border border-slate-100">
                            Math: (CS × UPC) + Pcs + Free = Total Stock
                        </div>
                    </div>

                    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <h3 class="font-black text-slate-800 text-base mb-2 border-b pb-2">⚖️ Tax Interpretation Toggle (+TAX vs INCL)</h3>
                        <p class="mb-3">This switch determines how the system reads the <strong>Base Rate</strong> you type in.</p>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="bg-slate-50 p-3 rounded-lg border border-slate-200">
                                <h4 class="font-bold text-slate-800 mb-1">Exclusive (+TAX)</h4>
                                <p class="text-xs">The Base Rate is the item price <strong class="text-indigo-600">without tax</strong>. The system will calculate GST on top of it to figure out the Net Amount.</p>
                            </div>
                            <div class="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
                                <h4 class="font-bold text-indigo-800 mb-1">Inclusive (INCL)</h4>
                                <p class="text-xs">The Base Rate you type is the <strong class="text-indigo-600">final total</strong>. The system will reverse-calculate to separate the tax and subtotal.</p>
                            </div>
                        </div>
                    </div>

                    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <h3 class="font-black text-slate-800 text-base mb-2 border-b pb-2">🏷️ Product Types</h3>
                        <ul class="space-y-3 font-medium text-xs">
                            <li><strong class="text-slate-800">GST Product:</strong> Standard inventory. Requires strict supplier info (GSTIN, Phone).</li>
                            <li><strong class="text-emerald-700">Non-GST / Homemade:</strong> Forces GST to 0% and does not require strict supplier IDs.</li>
                            <li><strong class="text-amber-700">Raw Material:</strong> Ingredients. Hidden from the POS retail billing screen automatically.</li>
                            <li><strong class="text-purple-700">Bundle Hamper:</strong> A combination of existing products sold as a single unit.</li>
                        </ul>
                    </div>

                    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <h3 class="font-black text-slate-800 text-base mb-2 border-b pb-2">🗓️ Expiration & FEFO Batches</h3>
                        <p class="mb-2">Mifela uses a <strong>FEFO (First Expired, First Out)</strong> system. When you add a new batch with an expiration date, it's tracked separately from existing stock.</p>
                        <p>The POS automatically sells from the batch that expires earliest.</p>
                        <p class="mt-2 text-xs text-red-600 font-bold bg-red-50 p-2 rounded border border-red-100">Expired batches are automatically quarantined from active stock and must be written off or returned using the "Manage Expired" button.</p>
                    </div>

                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
}
