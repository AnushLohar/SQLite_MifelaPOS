// --- Imports ---

import { savePosImage, loadPosImage } from '../utils/imageDB.js';

// Add 'increment' to your firebase imports
import {
    getProductsRef,
    getTransactionsRef,
    getCustomersRef,
    getCurrentCart,
    setCurrentCart,
    addToCart,
    getConvenienceFee,
    getCurrencySymbol,
    getCurrencyCode,
    getUserId,
    getCurrentUserPlan,
    fetchAllProducts, // 🚀 ADD THIS
    deductLocalProductStock,
    getCurrentLocationId,
    getAvailableLocations,
    getUserRole,
    getUserAssignedLocationId,
    setCurrentLocation,
    appId,
    getStoreId,
    AppState
} from '../store/state.js';
import { generateInvoiceId } from '../utils/ids.js';
import { DOM, showModal, showToast } from '../utils/dom.js';
import { buildAndPrintInvoice, printA3InvoiceHtml, exportPosCartToCsv, exportPosCartToExcel, generatePosPdf, exportLedgerToCsv, exportLedgerToExcel, generateLedgerPdf } from '../utils/print.js';
import { escapeHTML } from '../utils/security.js';
import { safeMath } from '../utils/math.js';
import { getExpirationStatus } from './inventory.js';
import { processEarnedTokens, getLoyaltyConfig } from './customers.js';
import * as CustomersModule from './customers.js';

// --- State ---
let isPosInitialized = false;
let isProcessingCheckout = false;
let currentCustomerDues = 0; // NEW: Tracks the active customer's pending balance
let parkedCarts = [];
let stagedDuesPayment = 0;
let localCustomerIndex = [];
let localProductIndex = [];
let currentImageUploadSku = null;
let activePosContainerId = 'main';
const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds
let posInactivityTimer;
// --- FIX: Dynamic Storage Keys tied strictly to the Logged-In User ---
const getCartKey = () => `mifela_cart_${getUserId() || 'guest'}`;
const getParkedKey = () => `mifela_parked_${getUserId() || 'guest'}`;

let splitPaymentDetails = null;
let activePaymentMethod = 'Cash';
let isPaperlessMode = localStorage.getItem('mifela_paperless_mode') === 'true';
let isAutoPrintEnabled = localStorage.getItem('mifela_auto_print') !== 'false'; // 🚀 NEW: Defaults to true
function checkPlanLimits(plan, feature) {
    // Offline POS systems operate as a single local node
    if (feature === 'multi_location') return false;

    // Unlock everything else natively (like Split Payments, Digital Payments)
    return true;
}
// ============================================================================
// 🔊 POS AUDIO FEEDBACK (Zero-Latency Web Audio API Beep)
// ============================================================================
function playScanBeep(isSuccess = true) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = isSuccess ? 'sine' : 'square';
        osc.frequency.setValueAtTime(isSuccess ? 1800 : 400, ctx.currentTime);

        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (isSuccess ? 0.08 : 0.2));

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + (isSuccess ? 0.08 : 0.2));
    } catch (e) {
        // Audio policy or silent mode fallback
    }
}

// ============================================================================
// 🚀 GLOBAL HARDWARE WEDGE SCANNER INTERCEPTOR
// ============================================================================
let posHardwareBuffer = '';
let posHardwareTimer = null;
let isPosGlobalScannerAttached = false;

function setupGlobalHardwareScanner() {
    if (isPosGlobalScannerAttached) return;

    document.addEventListener('keydown', (e) => {
        // 1. Only act if the POS view is visible on screen
        const posSection = DOM.pos?.section || document.getElementById('pos');
        if (!posSection || posSection.classList.contains('hidden')) return;

        // 2. Ignore if modal dialogs or prompt overlays are open
        const activeModal = document.querySelector('[id$="-modal"]:not(.hidden), [id$="-overlay"]:not(.hidden)');
        if (activeModal) return;

        const activeEl = document.activeElement;
        const isFocusedInManualInput = activeEl && (activeEl.id === 'pos-manual-input' || activeEl.name === 'manualInput');

        // 3. Enter key trigger from hardware scanner
        if (e.key === 'Enter') {
            if (posHardwareBuffer.length >= 3) {
                const scannedCode = posHardwareBuffer.trim();
                posHardwareBuffer = '';

                // If user was deliberately typing into manual input, let standard submit handle it
                if (isFocusedInManualInput) return;

                e.preventDefault();
                e.stopPropagation();

                // If scanner typed into the wrong input (e.g., customer name/phone), clean it up
                if (activeEl && ['INPUT', 'TEXTAREA'].includes(activeEl.tagName)) {
                    if (activeEl.value && activeEl.value.endsWith(scannedCode)) {
                        activeEl.value = activeEl.value.slice(0, -scannedCode.length).trim();
                        activeEl.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    activeEl.blur();
                }

                // Push directly to cart
                findAndAddToCart(scannedCode, 1);

                // Auto-refocus the main search bar
                if (DOM.pos.manualInput) {
                    DOM.pos.manualInput.value = '';
                    DOM.pos.manualInput.focus();
                }
                return;
            }
            posHardwareBuffer = '';
        }

        // 4. Capture fast keystrokes (< 45ms per character is a laser/2D scanner)
        if (e.key && e.key.length === 1) {
            posHardwareBuffer += e.key;
            clearTimeout(posHardwareTimer);
            posHardwareTimer = setTimeout(() => {
                posHardwareBuffer = '';
            }, 45);
        }
    }, { capture: true });

    isPosGlobalScannerAttached = true;
}

// --- Helper: UI State Management ---
function setCheckoutLoadingState(isLoading) {
    const checkoutBtn = DOM.pos.checkoutBtn;
    if (!checkoutBtn) return;

    if (isLoading) {
        checkoutBtn.disabled = true;
        checkoutBtn.innerHTML = `<svg class="animate-spin h-6 w-6 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> <span class="ml-2">Processing...</span>`;
    } else {
        checkoutBtn.disabled = false;
        checkoutBtn.innerHTML = `<svg class="w-6 h-6 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> <span class="tracking-wide ml-2">COMPLETE SALE (F4)</span>`;
    }
}

// --- Helper: Customer POS State Management ---
function resetCustomerPosState() {
    if (DOM.pos.customer.id) DOM.pos.customer.id.value = '';
    if (DOM.pos.customer.name) {
        DOM.pos.customer.name.value = '';
        DOM.pos.customer.name.classList.remove('border-emerald-500', 'bg-emerald-50', 'transition-colors');
    }
    if (DOM.pos.customer.phone) DOM.pos.customer.phone.value = '';

    currentCustomerDues = 0;
    stagedDuesPayment = 0;
    window.__pendingTokenDeduction = 0;
    if (DOM.pos.totals?.discount) DOM.pos.totals.discount.value = '';

    const balanceBadge = document.getElementById('pos-customer-balance-badge');
    if (balanceBadge) {
        balanceBadge.classList.add('hidden');
        const span = balanceBadge.querySelector('span');
        if (span) span.textContent = '0.00';
    }

    if (typeof applyB2BRatesToCart === 'function') applyB2BRatesToCart(null);
    if (typeof updateCartSummary === 'function') updateCartSummary();
}

function applyCustomerPosState(customer, showAlerts = false) {
    if (!customer) return resetCustomerPosState();

    if (DOM.pos.customer.id) DOM.pos.customer.id.value = customer.merchantId || customer.id || '';
    if (DOM.pos.customer.name) {
        DOM.pos.customer.name.value = customer.name || '';
        DOM.pos.customer.name.classList.add('border-emerald-500', 'bg-emerald-50', 'transition-colors');
    }
    if (DOM.pos.customer.phone) DOM.pos.customer.phone.value = customer.phone || '';

    currentCustomerDues = parseFloat(customer.dues || customer.balance || 0);

    const balanceBadge = document.getElementById('pos-customer-balance-badge');
    if (balanceBadge) {
        if (currentCustomerDues !== 0) {
            balanceBadge.querySelector('span').textContent = Math.abs(currentCustomerDues).toFixed(2);
            balanceBadge.classList.remove('hidden');

            if (showAlerts && typeof showToast === 'function') {
                if (currentCustomerDues > 0) {
                    showToast('Credit Alert', `Pending dues of ₹${currentCustomerDues.toFixed(2)} added to cart.`, 'warning');
                } else {
                    showToast('Advance Balance', `Advance of ₹${Math.abs(currentCustomerDues).toFixed(2)} applied to cart.`, 'success');
                }
            }
        } else {
            balanceBadge.classList.add('hidden');
        }
    }

    if (typeof applyB2BRatesToCart === 'function') applyB2BRatesToCart(customer);
    if (typeof updateCartSummary === 'function') updateCartSummary();
}

// --- Helper: Stock Deduction ---
function executeStockDeduction(productId, quantity, batch, productsRef, processFifoDepletion) {
    if (productId.startsWith('CUSTOM-')) return;
    const productRef = doc(productsRef, productId);
    const prodUpdate = {
        stockLevel: increment(-quantity),
        updatedAt: serverTimestamp()
    };

    const updatedBatches = processFifoDepletion(productId, quantity);
    if (updatedBatches !== null) prodUpdate.batches = updatedBatches;

    batch.set(productRef, prodUpdate, { merge: true });

    // 🚀 THE FIX: Prevent Double-Deduction in local cache!
    // If deductLocalProductStock exists (from state.js), it handles the global memory array.
    // We MUST NOT manually subtract from localMatch again, otherwise it subtracts twice in memory!
    if (typeof deductLocalProductStock === 'function') {
        deductLocalProductStock(productId, quantity);
    } else {
        const localMatch = localProductIndex.find(p => p.id === productId);
        if (localMatch) {
            localMatch.stockLevel = (parseFloat(localMatch.stockLevel) || 0) - quantity;
        }
    }
}

// --- Helper: Normalize Plan ---
function normalizePlan(planString) {
    if (!planString) return 'free';
    const plan = planString.toLowerCase();
    if (plan === 'standard') return 'silver';
    if (plan === 'premium') return 'platinum';
    return plan;
}



export function loadPosPage() {
    const rawPlan = typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free';
    const plan = normalizePlan(rawPlan);

    const role = typeof getUserRole === 'function' ? getUserRole() : 'manager';
    const assignedLoc = typeof getUserAssignedLocationId === 'function' ? getUserAssignedLocationId() : 'main';
    let currentLoc = typeof getCurrentLocationId === 'function' ? getCurrentLocationId() : 'main';

    const hasMultiLoc = checkPlanLimits(plan, 'multi_location');
    const canAccessAllLocations = (role === 'admin' || role === 'accountant') && hasMultiLoc;

    if (!canAccessAllLocations && currentLoc !== assignedLoc) {
        if (typeof setCurrentLocation === 'function') setCurrentLocation(assignedLoc);
        currentLoc = assignedLoc;
    }

    activePosContainerId = currentLoc === 'all' ? 'main' : currentLoc;

    transformPosUI(plan);

    if (!isPosInitialized) {
        setupPosListeners();
        setupKeyboardShortcuts(); // 🚀 NEW
        isPosInitialized = true;
    }

    // --- FIX: Restore User-Specific Cart & Parked Carts ---
    try {
        const storedParked = localStorage.getItem(getParkedKey());
        if (storedParked) parkedCarts = JSON.parse(storedParked);
        else parkedCarts = [];

        const savedCart = localStorage.getItem(getCartKey());
        if (savedCart) {
            const parsedCart = JSON.parse(savedCart);
            if (Array.isArray(parsedCart) && parsedCart.length > 0) {
                setCurrentCart(parsedCart);
            } else {
                setCurrentCart([]); // Enforce empty cart
            }
        } else {
            setCurrentCart([]); // Enforce empty cart for a fresh user
        }
    } catch (e) {
        console.error("Failed to restore cart:", e);
        setCurrentCart([]);
        parkedCarts = [];
    }

    injectPosLocationSelector();
    renderCart();
    updateParkedIndicator(plan);
    injectInvoiceDateSelector();
    refreshCustomerIndex();
    refreshProductIndex();
    injectPaperlessToggle();
    updatePrintModeUI();
    injectPosCopyright();
    window.injectCashCalculator();
    if (DOM.pos.manualInput) {
        DOM.pos.manualInput.setAttribute('autocomplete', 'off');
        requestAnimationFrame(() => DOM.pos.manualInput.focus());
    }
    injectVisualGridToggle();

    // 🚀 THE FIX: Start the 5-minute idle timer securely when the page loads
    resetCartIdleTimer();
}

function injectPosCopyright() {
    const posSection = DOM.pos.section || document.getElementById('pos');
    if (posSection && !document.getElementById('pos-copyright-footer')) {
        const footer = document.createElement('div');
        footer.id = 'pos-copyright-footer';
        footer.className = "py-8 text-center border-t border-gray-100 mt-8 col-span-full w-full";
        footer.innerHTML = `
            <div class="flex flex-col items-center gap-1.5">
                <p class="text-[10px] font-bold text-gray-400 tracking-[0.3em] uppercase">Mifela Inventory Management</p>
                <p class="text-[11px] text-gray-500 font-medium">© 2026 All Rights Reserved</p>
            </div>
        `;
        posSection.appendChild(footer);
    }
}
window._mifela_sticky_date = null; // Memory lock for backdating batches

function injectInvoiceDateSelector() {
    const finalTotalContainer = DOM.pos.totals.final?.closest('.flex');
    if (!finalTotalContainer || document.getElementById('pos-invoice-date-container')) return;

    const today = new Date();
    const minDate = new Date();
    minDate.setDate(today.getDate() - 30);

    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const minStr = `${minDate.getFullYear()}-${String(minDate.getMonth() + 1).padStart(2, '0')}-${String(minDate.getDate()).padStart(2, '0')}`;

    const defaultVal = window._mifela_sticky_date || todayStr;

    const html = `
        <div id="pos-invoice-date-container" class="flex justify-between items-center text-sm font-bold text-slate-600 mb-4 pt-3 border-t border-dashed border-gray-200  ">
            <span>Invoice Date</span>
            <input type="date" id="pos-custom-date" 
                   min="${minStr}" 
                   max="${todayStr}" 
                   value="${defaultVal}" 
                   class="border border-slate-300 rounded-lg p-1.5 text-xs font-mono outline-none focus:border-SLATE-500 bg-white text-SLATE-700 shadow-sm cursor-pointer hover:bg-slate-50 transition-colors">
        </div>
    `;

    finalTotalContainer.insertAdjacentHTML('beforebegin', html);

    // 🚀 THE FIX: CSP-Safe Event Listener to remember the date!
    const dateInput = document.getElementById('pos-custom-date');
    if (dateInput) {
        dateInput.addEventListener('change', (e) => {
            window._mifela_sticky_date = e.target.value;
        });
    }
}

async function renderVisualPosGrid(searchTerm = '') {
    if (!isCatalogPinned && searchTerm.trim().length === 0) return;

    let gridWrapper = document.getElementById('visual-pos-grid-wrapper');
    let gridContainer = document.getElementById('visual-pos-grid');

    if (!gridWrapper) {
        gridWrapper = document.createElement('div');
        gridWrapper.id = 'visual-pos-grid-wrapper';
        // 🚀 THE SPEED FIX: Removed transition-all, max-h-0, opacity-0. Using pure Tailwind 'hidden'
        gridWrapper.className = 'w-full mb-4 relative z-0 col-span-full hidden';

        gridContainer = document.createElement('div');
        gridContainer.id = 'visual-pos-grid';
        gridContainer.className = "w-full bg-slate-50 border border-slate-200 rounded-xl p-4 mt-2 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 max-h-[60vh] overflow-y-auto custom-scrollbar shadow-inner";

        gridWrapper.appendChild(gridContainer);

        const searchInput = DOM.pos.manualInput;
        if (searchInput) {
            const searchFlexRow = searchInput.closest('.flex');
            const parentContainer = searchFlexRow.parentNode;
            if (searchFlexRow.nextSibling) {
                parentContainer.insertBefore(gridWrapper, searchFlexRow.nextSibling);
            } else {
                parentContainer.appendChild(gridWrapper);
            }
        }
    }

    const currency = getCurrencySymbol();
    const userId = typeof getUserId === 'function' ? getUserId() : 'guest';
    const pinnedKey = `mifela_pinned_products_${userId}`;
    const pinnedProducts = JSON.parse(localStorage.getItem(pinnedKey) || "[]");

    const term = searchTerm.toLowerCase();
    let filteredProducts = localProductIndex.filter(p => {
        if (!term) return true;
        return (p.name || '').toLowerCase().includes(term) ||
            (p.sku || '').toLowerCase().includes(term) ||
            (p.barcode || '').toLowerCase().includes(term);
    });

    if (filteredProducts.length === 0) {
        gridContainer.innerHTML = `<div class="col-span-full py-10 text-center font-bold text-slate-400">No products match "${escapeHTML(searchTerm)}"</div>`;
        return;
    }

    // Sort pinned items to top...
    filteredProducts.sort((a, b) => {
        const aPinned = pinnedProducts.includes(a.id);
        const bPinned = pinnedProducts.includes(b.id);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        return nameA < nameB ? -1 : (nameA > nameB ? 1 : 0);
    });

    // 🚀 THE CPU SAVER: Never render more than 60 tiles at once. 
    filteredProducts = filteredProducts.slice(0, 60);

    const fragment = document.createDocumentFragment();

    filteredProducts.forEach((prod, index) => {
        const isExpired = typeof getExpirationStatus === 'function' && getExpirationStatus(prod.expirationDate) === 'expired';
        const isPinned = pinnedProducts.includes(prod.id);

        // Calculate the live stock for initial render
        const currentCart = typeof getCurrentCart === 'function' ? getCurrentCart() : [];
        const cartItem = currentCart.find(i => i.id === prod.id);
        const cartQty = cartItem ? cartItem.quantity : 0;
        const liveStock = (parseFloat(prod.stockLevel) || 0) - cartQty;
        const isLowStock = liveStock <= parseFloat(prod.lowStockThreshold || 0);

        // 🚀 THE FIX: Identify the first search result and apply the blue outline
        const isFirstSearchResult = searchTerm.trim().length > 0 && index === 0;
        let borderClass = 'border-slate-100 hover:border-SLATE-200 hover:shadow-md';

        if (isFirstSearchResult) {
            borderClass = 'border-blue-500 ring-2 ring-blue-200 shadow-md z-10 first-grid-result transform scale-[1.02]';
        } else if (isPinned) {
            borderClass = 'border-SLATE-200 ring-1 ring-SLATE-100';
        }

        const tile = document.createElement('div');
        tile.className = `bg-white rounded-xl shadow-sm border ${borderClass} p-2 relative flex flex-col items-center text-center select-none group cursor-pointer transition-all duration-200`;

        tile.innerHTML = `
            ${isExpired ? '<div class="absolute inset-0 bg-red-500/10 z-20 flex flex-col items-center justify-center rounded-xl border-2 border-red-500/50 pointer-events-none"><span class="bg-red-600 text-white font-black text-[12px] px-3 py-1 rounded-md shadow-2xl uppercase tracking-widest rotate-[-12deg]">Expired</span></div>' : ''}
            <button class="pin-product-btn absolute top-1.5 right-1.5 z-30 p-1.5 rounded-full bg-white/90 shadow-sm transition-all ${isPinned ? 'text-SLATE-500 fill-SLATE-500 opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-SLATE-400'}" title="${isPinned ? 'Unpin Item' : 'Pin to Top'}">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path></svg>
            </button>
            <div class="w-full h-20 mb-2 bg-slate-50 rounded-lg overflow-hidden flex items-center justify-center relative">
                <img id="img-pos-${prod.sku || prod.id}" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" class="w-full h-full object-cover relative z-10 opacity-0 transition-opacity duration-300 pointer-events-none" alt="">
            </div>
            <h4 class="font-bold text-slate-700 text-[10px] leading-tight line-clamp-2 w-full px-1">${escapeHTML(prod.name)}</h4>
            <div class="flex items-center justify-between w-full px-1 mt-1.5 mb-auto">
                 <span class="text-[8px] font-mono text-slate-400 truncate max-w-[55%]">${escapeHTML(prod.sku || 'No SKU')}</span>
                 <span id="grid-stock-${prod.id}" class="text-[8px] font-bold ${isLowStock ? 'text-orange-500' : 'text-emerald-500'}">${liveStock} in stock</span>
            </div>
            <span class="text-SLATE-600 font-black mt-2 pt-1.5 border-t border-slate-50 w-full text-xs">${currency}${parseFloat(prod.price || 0).toFixed(2)}</span>
        `;

        tile.onclick = (e) => {
            const pinBtn = e.target.closest('.pin-product-btn');
            if (pinBtn) {
                e.stopPropagation();
                let pinned = JSON.parse(localStorage.getItem(pinnedKey) || "[]");
                pinned = isPinned ? pinned.filter(k => k !== prod.id) : [...pinned, prod.id];
                localStorage.setItem(pinnedKey, JSON.stringify(pinned));
                renderVisualPosGrid(searchTerm);
                return;
            }

            // 🚀 THE FIX: Block interaction for expired OR zero-stock items
            const currentStock = parseFloat(prod.stockLevel) || 0;
            if (isExpired) {
                if (typeof showModal === 'function') showModal('Product Expired', `Cannot sell **${escapeHTML(prod.name)}**...`, 'error');
                return;
            }

            if (currentStock <= 0) {
                if (typeof showToast === 'function') showToast('Out of Stock', `${escapeHTML(prod.name)} is currently unavailable.`, 'warning');
                return;
            }

            // Proceed to the quantity prompt
            if (typeof window.promptForCatalogQuantity === 'function') {
                window.promptForCatalogQuantity(prod);
            } else {
                addProductToCart(prod.id, prod, 1);
                if (DOM.pos.manualInput) DOM.pos.manualInput.focus();
            }
        };
        fragment.appendChild(tile);
    });

    // 5. Atomic Update
    gridWrapper.style.display = 'block'; // Show the mask
    gridContainer.style.display = 'grid'; // Layout the grid
    gridContainer.innerHTML = ''; // Wipe once
    gridContainer.appendChild(fragment); // 🚀 Injected in one single operation
    // 6. Async Image Hydration (unchanged, but now targeting live nodes)
    try {
        for (const prod of filteredProducts) {
            const imageId = prod.sku || prod.id;
            loadPosImage(imageId).then(base64 => {
                if (base64) {
                    const img = document.getElementById(`img-pos-${imageId}`);
                    if (img) { img.src = base64; img.classList.remove('opacity-0'); }
                }
            });
        }
    } catch (e) { console.error(e); }
}

async function refreshProductIndex(retryCount = 0) {
    try {
        let allProducts = [];

        // 🚀 THE FIX: Always fetch the live truth directly from SQLite
        if (window.dbAPI && window.dbAPI.getProducts) {
            allProducts = await window.dbAPI.getProducts();
        } else if (typeof fetchAllProducts === 'function') {
            allProducts = await fetchAllProducts();
        }

        localProductIndex = allProducts.filter(p => p.permitRetail !== false && p.type !== 'raw_material');

        if (localProductIndex.length === 0 && retryCount < 5) {
            setTimeout(() => refreshProductIndex(retryCount + 1), 500);
            return;
        }

        recalculateBundleStocks();
        populateProductDatalist();

        if (typeof renderVisualPosGrid === 'function' && isVisualGridEnabled) {
            const searchInput = DOM.pos.manualInput;
            renderVisualPosGrid(searchInput ? searchInput.value.trim() : '');
        }

    } catch (e) {
        console.warn("POS: Failed to pull from local database", e);
    }
}

function populateProductDatalist() {
    if (!DOM.pos.manualInput) return;

    // 1. Remove the 'list' attribute to stop the native browser dropdown
    DOM.pos.manualInput.removeAttribute('list');

    // 2. Destroy the HTML datalist if it exists
    const existingList = document.getElementById('pos-product-search-list');
    if (existingList) {
        existingList.remove();
    }
}



function populateCustomerDatalists() {
    const searchList = DOM.datalists.customer;
    const idList = DOM.datalists.customerId;

    if (!searchList || !idList) return;

    searchList.innerHTML = '';
    idList.innerHTML = '';

    localCustomerIndex.forEach(cust => {
        const nameOpt = document.createElement('option');
        nameOpt.value = cust.name;
        nameOpt.textContent = `${cust.phone ? '📱 ' + cust.phone : ''} (ID: ${cust.id})`;
        searchList.appendChild(nameOpt);

        const idOpt = document.createElement('option');
        idOpt.value = cust.id;
        idOpt.textContent = cust.name;
        idList.appendChild(idOpt);
    });
}
function transformPosUI(plan) {
    const checkoutBtn = DOM.pos.checkoutBtn;

    if (!checkoutBtn) return;

    const newCheckoutBtn = checkoutBtn.cloneNode(true);
    checkoutBtn.parentNode.replaceChild(newCheckoutBtn, checkoutBtn);
    DOM.pos.checkoutBtn = newCheckoutBtn;

    newCheckoutBtn.addEventListener('click', handleCheckout);

    const originalContainer = newCheckoutBtn.parentNode;
    if (!originalContainer) return;

    if (originalContainer.id === 'pos-advanced-controls') {
        updateActivePaymentTab(plan);
        updateParkedIndicator(plan);
        return;
    }

    if (plan === 'free') {
        const legacySelect = DOM.pos.paymentMethod;
        if (legacySelect) legacySelect.style.display = 'block';

        newCheckoutBtn.className = "w-full bg-SLATE-600 hover:bg-SLATE-700 text-white font-bold py-3 rounded-lg shadow transition transform active:scale-95 flex justify-center items-center gap-2 mt-4";
        return;
    }

    originalContainer.id = 'pos-advanced-controls';
    originalContainer.className = "grid grid-cols-4 gap-4 bg-gray-50/50 p-4 rounded-xl border border-gray-100 mt-4";

    const legacySelect = DOM.pos.paymentMethod;
    if (legacySelect) legacySelect.style.display = 'none';

    // Unlocked Split Payment for all users
    const allowSplit = true;
    const paymentContainer = document.createElement('div');

    // Always use 3 columns so all 6 buttons (Cash, Card, UPI, Udhar, Dispatch, Split) fit symmetrically across 2 rows
    paymentContainer.className = "col-span-4 grid grid-cols-3 gap-3 mb-2";

    const baseTabClass = "pay-tab py-3 rounded-lg border font-bold text-sm flex flex-col items-center justify-center transition-all duration-200 cursor-pointer select-none group relative overflow-hidden";

    const allowDigital = checkPlanLimits(plan, 'digital_payments');
    const disabledClass = "opacity-50 cursor-not-allowed bg-gray-100 text-gray-400";

    const digitalAttr = allowDigital ? '' : 'disabled';
    const splitAttr = allowSplit ? '' : 'disabled';

    const cardClass = allowDigital ? "bg-white hover:bg-gray-50 border-gray-300 text-gray-600 hover:border-gray-400" : disabledClass;
    const upiClass = allowDigital ? "bg-white hover:bg-gray-50 border-gray-300 text-gray-600 hover:border-gray-400" : disabledClass;
    const splitClass = allowSplit ? "bg-white hover:bg-SLATE-50 border-SLATE-200 text-SLATE-600 hover:border-SLATE-300" : disabledClass;

    const cashIcon = `<svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>`;
    const cardIcon = `<svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>`;
    const upiIcon = `<svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>`;
    const splitIcon = `<svg class="w-6 h-6 mb-1 text-SLATE-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"></path></svg>`;
    const creditIcon = `<svg class="w-6 h-6 mb-1 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>`;
    const transferIcon = `<svg class="w-6 h-6 mb-1 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>`;

    let paymentButtonsHtml = `
        <button type="button" data-method="Cash" class="${baseTabClass} bg-SLATE-50 border-SLATE-600 text-SLATE-700 shadow-sm ring-1 ring-SLATE-600 ring-opacity-20">
            ${cashIcon} Cash
            <div class="absolute bottom-0 left-0 w-full h-1 bg-SLATE-600 opacity-0 group-[.active]:opacity-100 transition-opacity"></div>
        </button>
        <button type="button" data-method="Card" class="${baseTabClass} ${cardClass}" ${digitalAttr}>
            ${cardIcon} Card
        </button>
        <button type="button" data-method="UPI" class="${baseTabClass} ${upiClass}" ${digitalAttr}>
            ${upiIcon} UPI
        </button>
        <button type="button" data-method="Credit" class="${baseTabClass} bg-white hover:bg-red-50 text-red-600 border-red-200 hover:border-red-300">
            ${creditIcon} UDHAR
        </button>
        <button type="button" data-method="Internal Transfer" class="${baseTabClass} bg-white hover:bg-emerald-50 text-emerald-700 border-emerald-200 hover:border-emerald-300">
            ${transferIcon} Dispatch
        </button>
        <button type="button" data-method="Split" class="${baseTabClass} ${splitClass}" ${splitAttr}>
            ${splitIcon} Split
        </button>
    `;

    paymentContainer.innerHTML = paymentButtonsHtml;
    originalContainer.insertBefore(paymentContainer, originalContainer.firstChild);

    paymentContainer.querySelectorAll('.pay-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const method = btn.dataset.method;
            if (btn.disabled) {
                if (method === 'Split') {
                    showModal('Upgrade Required', 'Split payments are exclusively available on Gold and Platinum plans.', 'info');
                } else {
                    showModal('Upgrade Required', 'Digital payments are available on Silver, Gold, and Platinum plans.', 'info');
                }
                return;
            }

            if (method === 'Split') handleSplitPayment();
            else setActivePaymentMethod(method);
        });
    });

    const actionRow = document.createElement('div');
    actionRow.className = "col-span-4 flex gap-3 mb-1";

    const parkBtn = document.createElement('button');
    parkBtn.type = "button";
    parkBtn.className = "flex-1 py-2.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-sm font-bold hover:bg-amber-100 hover:border-amber-300 transition active:scale-95 flex items-center justify-center gap-1.5 shadow-sm";
    parkBtn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Park Sale`;
    parkBtn.onclick = handleParkSale;
    actionRow.appendChild(parkBtn);

    const retrieveBtn = document.createElement('button');
    retrieveBtn.type = "button";
    retrieveBtn.id = 'pos-retrieve-btn';
    retrieveBtn.className = "flex-1 py-2.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm font-bold hover:bg-blue-100 hover:border-blue-300 transition active:scale-95 shadow-sm hidden";
    retrieveBtn.onclick = showParkedSalesList;
    actionRow.appendChild(retrieveBtn);

    const newClearBtn = document.createElement('button');
    newClearBtn.type = "button";
    newClearBtn.className = `py-2.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-bold hover:bg-red-100 hover:border-red-300 transition active:scale-95 shadow-sm w-1/4 flex items-center justify-center gap-1`;
    newClearBtn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg> Clear`;
    newClearBtn.onclick = () => {
        if (confirm('Are you sure you want to clear the entire cart?')) clearCart();
    };
    actionRow.appendChild(newClearBtn);

    const oldClearBtn = DOM.pos.clearBtn;
    if (oldClearBtn) oldClearBtn.style.display = 'none';

    originalContainer.insertBefore(actionRow, newCheckoutBtn);

    let printToggleContainer = document.getElementById('pos-print-toggle-container');
    if (!printToggleContainer) {
        printToggleContainer = document.createElement('div');
        printToggleContainer.id = 'pos-print-toggle-container';
        printToggleContainer.className = "col-span-4 flex justify-between items-center mb-2 mt-1 gap-2";

        const savedFormat = localStorage.getItem('mifela_pos_export_format') || '80mm';

        printToggleContainer.innerHTML = `
            <!-- 🚀 NEW: Integrated Export/Print Dropdown -->
            <div class="relative flex-1">
                <select id="pos-export-format-selector" class="w-full bg-white border border-slate-200 text-slate-700 text-[11px] font-bold py-2 px-2.5 rounded-lg shadow-sm focus:ring-2 focus:ring-SLATE-500 outline-none cursor-pointer appearance-none transition-colors">
                    <option value="80mm" ${savedFormat === '80mm' ? 'selected' : ''}>🖨️ 80mm Receipt</option>
                    <option value="print_a3" ${savedFormat === 'print_a3' ? 'selected' : ''}> A3 Invoice Print</option>
                    <option value="pdf_a3" ${savedFormat === 'pdf_a3' ? 'selected' : ''}> A3 Invoice PDF</option>
                    <option value="excel" ${savedFormat === 'excel' ? 'selected' : ''}> Export Excel</option>
                    <option value="csv" ${savedFormat === 'csv' ? 'selected' : ''}> Export CSV</option>
                </select>
                <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
            </div>

            <!-- 🚀 NEW: "Get Invoice" Checkbox -->
            <label class="flex items-center cursor-pointer gap-1.5 bg-SLATE-50 px-3 py-2 rounded-lg border border-SLATE-200 shadow-sm hover:bg-SLATE-100 transition-colors select-none shrink-0" title="Generate the selected format upon checkout">
                <input type="checkbox" id="auto-print-toggle" class="w-4 h-4 text-SLATE-600 rounded border-gray-300 focus:ring-SLATE-500 cursor-pointer" ${isAutoPrintEnabled ? 'checked' : ''}>
                <span class="text-[10px] font-black text-SLATE-800 uppercase tracking-widest">Get Invoice</span>
            </label>
        `;
        originalContainer.insertBefore(printToggleContainer, newCheckoutBtn);

        // Save preference instantly
        document.getElementById('auto-print-toggle').addEventListener('change', (e) => {
            isAutoPrintEnabled = e.target.checked;
            localStorage.setItem('mifela_auto_print', isAutoPrintEnabled);
        });

        // When changing the dropdown, auto-check the Get Invoice box
        document.getElementById('pos-export-format-selector').addEventListener('change', (e) => {
            localStorage.setItem('mifela_pos_export_format', e.target.value);
            const toggle = document.getElementById('auto-print-toggle');
            if (toggle && !toggle.checked) {
                toggle.checked = true;
                isAutoPrintEnabled = true;
                localStorage.setItem('mifela_auto_print', true);
            }
        });
    }

    newCheckoutBtn.className = "col-span-4 w-full bg-gradient-to-r from-SLATE-600 to-SLATE-700 hover:from-SLATE-700 hover:to-SLATE-800 text-white text-lg font-bold py-4 rounded-xl shadow-lg hover:shadow-xl transition-all transform active:scale-[0.98] flex justify-center items-center gap-3";
    newCheckoutBtn.innerHTML = `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> <span class="tracking-wide">COMPLETE SALE (F4)</span>`;
    if (newCheckoutBtn.parentNode !== originalContainer) {
        originalContainer.appendChild(newCheckoutBtn);
    }
}
// ============================================================================
// 🚀 IN-POS MULTI-FORMAT EXPORT ENGINE (FIXED)
// ============================================================================
async function handlePosExportSelection(e) {
    const format = e.target.value;
    e.target.value = 'none'; // Instantly reset the dropdown

    const currentCart = typeof getCurrentCart === 'function' ? getCurrentCart() : [];
    if (currentCart.length === 0) {
        if (typeof showModal === 'function') showModal('Empty Cart', 'Cannot export an empty invoice. Please add items to the cart.', 'error');
        return;
    }

    const checkoutBtn = document.getElementById('pos-checkout-btn') || document.querySelector('#checkout-btn');
    if (checkoutBtn) checkoutBtn.disabled = true;

    try {
        if (typeof showModal === 'function') showModal('Generating...', `Preparing ${format.toUpperCase()} export...`, 'info');

        const { total, subtotal, tax, discount, cartTotal, dues, fee } = calculateTotals();

        const storeName = document.getElementById('setting-store-name')?.value || document.getElementById('dashboard-store-name')?.textContent || 'STORE';
        const storeAddress = document.getElementById('setting-store-address')?.value || '';
        const storePhone = document.getElementById('setting-store-phone')?.value || '';
        const storeGstin = document.getElementById('setting-store-tax-id')?.value || '';
        const storePan = document.getElementById('setting-store-pan')?.value || '';
        const storeLogo = document.getElementById('setting-store-logo')?.value || document.getElementById('logo-preview-img')?.src || '';

        // 🚀 THE FIX: Safely extract Customer metadata from Local Memory
        const rawId = document.getElementById('pos-cust-id')?.value.trim();
        const rawName = document.getElementById('pos-cust-name')?.value.trim();
        const rawPhone = document.getElementById('pos-cust-phone')?.value.trim();

        let activeCustomer = {};

        if (rawId) {
            activeCustomer = localCustomerIndex.find(c => c.id === rawId || c.merchantId === rawId) || {};
        } else if (rawPhone) {
            activeCustomer = localCustomerIndex.find(c => c.phone === rawPhone) || {};
        } else if (rawName && rawName.toLowerCase() !== 'walk-in customer') {
            activeCustomer = localCustomerIndex.find(c => c.name === rawName) || {};
        }

        const custId = activeCustomer.id || rawId || 'WALK-IN';
        const custName = activeCustomer.name || rawName || 'Walk-in Customer';
        const custPhone = activeCustomer.phone || rawPhone || '';

        const isB2BTrade = activeCustomer.gstin && activeCustomer.gstin.trim().length >= 15;

        const simulatedTx = {
            invoiceId: `DRAFT-${Date.now().toString().slice(-6)}`,
            timestamp: new Date(),
            type: 'SALE',
            tradeType: isB2BTrade ? 'B2B' : 'D2C',
            customer: {
                id: custId,
                name: custName,
                phone: custPhone,
                address: activeCustomer.address || '',
                gstin: activeCustomer.gstin || '',
                pan: activeCustomer.pan || ''
            },
            storeDetails: {
                name: storeName,
                address: storeAddress,
                phone: storePhone,
                gstin: storeGstin,
                pan: storePan,
                logo: storeLogo,
                branch: typeof activePosContainerId !== 'undefined' ? activePosContainerId : 'main'
            },
            items: currentCart.map(item => ({
                id: item.id, name: item.name, sku: item.sku, quantity: item.quantity,
                price: item.price, cost: item.cost, mrp: item.mrp || item.price,
                taxRate: item.taxRate || 0, cessRate: item.cess || 0, hsn: item.hsn || '',
                batch: item.batch || '', mfd: item.mfd || '', expiry: item.expiry || '',
                subtotal: item.price * item.quantity,
                taxableValue: (item.price * item.quantity) / (1 + ((item.taxRate || 0) / 100))
            })),
            summary: {
                total: total, subtotal: subtotal, tax: tax, discount: discount,
                cartTotal: cartTotal, dues: dues, fee: fee, paymentMethod: typeof activePaymentMethod !== 'undefined' ? activePaymentMethod : 'Cash'
            },
            currency: { symbol: typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹' }
        };

        if (format === 'print_a3') {
            document.getElementById('generic-modal')?.remove();
            if (typeof printA3InvoiceHtml === 'function') {
                printA3InvoiceHtml(simulatedTx, storeName);
            }
        }
        else if (format === 'pdf_a3') {
            document.getElementById('generic-modal')?.remove();
            if (typeof generatePosPdf === 'function') {
                await generatePosPdf(simulatedTx, storeName);
            }
        }
        else if (format === 'excel') {
            document.getElementById('generic-modal')?.remove();
            if (typeof exportPosCartToExcel === 'function') {
                await exportPosCartToExcel(simulatedTx, storeName);
            }
        }
        else if (format === 'csv') {
            document.getElementById('generic-modal')?.remove();
            if (typeof exportPosCartToCsv === 'function') {
                exportPosCartToCsv(simulatedTx, storeName);
            }
        }
        else if (format === '80mm') {
            document.getElementById('generic-modal')?.remove();
            if (typeof buildAndPrintInvoice === 'function') {
                buildAndPrintInvoice(simulatedTx, storeName);
            }
        }

    } catch (error) {
        console.error("Export Error:", error);
        document.getElementById('generic-modal')?.remove();
        if (typeof showModal === 'function') showModal('Export Failed', error.message, 'error');
    } finally {
        if (checkoutBtn) checkoutBtn.disabled = false;
    }
}
export async function findAndAddToCart(queryStr, qty = 1) {
    if (!queryStr) return;

    // 🚀 1. SANITIZE BARCODE: Strip scanner prefixes/suffixes (AIM identifiers, \r, \n, whitespace)
    let term = queryStr.toString().trim();
    term = term.replace(/^\][A-Za-z0-9]{2}/, ''); // Remove AIM 2D Symbology Identifiers (e.g. ]C1, ]e0)
    term = term.replace(/[\r\n\t]/g, '').trim();
    if (!term) return;

    // 🚀 2. NFC / Loyalty Card Scanner Intercept
    const customerMatch = localCustomerIndex.find(c =>
        (c.nfcCardId && c.nfcCardId.trim() === term) ||
        (c.cardNumber && c.cardNumber.trim() === term)
    );

    if (customerMatch) {
        applyCustomerPosState(customerMatch, true);
        playScanBeep(true);
        if (typeof showToast === 'function') showToast('Card Accepted', `Customer: ${customerMatch.name}`, 'success');
        if (DOM.pos.manualInput) DOM.pos.manualInput.value = '';
        return;
    }

    try {
        const cleanTerm = term.toLowerCase();

        // 🚀 3. LOCAL CACHE EXACT MATCH (Barcode, SKU, or Alternate UPC)
        let localMatches = localProductIndex.filter(p => {
            const b = (p.barcode || '').toString().trim().toLowerCase();
            const s = (p.sku || '').toString().trim().toLowerCase();

            // Exact match on standard or without leading zeros
            return b === cleanTerm || s === cleanTerm ||
                (cleanTerm.length > 7 && b.replace(/^0+/, '') === cleanTerm.replace(/^0+/, ''));
        });

        // 🚀 4. FUZZY MATCH FALLBACK (Product Name)
        if (localMatches.length === 0) {
            localMatches = localProductIndex.filter(p =>
                (p.name || '').trim().toLowerCase() === cleanTerm
            );
        }

        if (localMatches.length > 0) {
            const getTime = (val) => {
                if (!val) return 0;
                if (typeof val.toMillis === 'function') return val.toMillis();
                if (val.seconds) return val.seconds * 1000;
                return new Date(val).getTime() || 0;
            };

            // Sort by creation date (Oldest first) for FIFO depletion
            localMatches.sort((a, b) => getTime(a.createdAt) - getTime(b.createdAt));

            const currentCart = typeof getCurrentCart === 'function' ? getCurrentCart() : [];
            let remainingQty = qty;

            for (const match of localMatches) {
                if (remainingQty <= 0) break;

                const cartItem = currentCart.find(i => i.id === match.id);
                const cartQty = cartItem ? cartItem.quantity : 0;
                const availableStock = (parseFloat(match.stockLevel) || 0) - cartQty;

                if (availableStock > 0) {
                    const qtyToTake = Math.min(availableStock, remainingQty);
                    addProductToCart(match.id, match, qtyToTake);
                    remainingQty -= qtyToTake;
                }
            }

            if (remainingQty > 0) {
                const newestMatch = localMatches[localMatches.length - 1];
                addProductToCart(newestMatch.id, newestMatch, remainingQty);
            }

            playScanBeep(true);
            if (typeof updateVisualGridStock === 'function') updateVisualGridStock();
            return;
        }

        // 🚀 5. LOCAL OFFLINE SEARCH FALLBACK
        let foundDoc = null;
        if (window.dbAPI && window.dbAPI.getProducts) {
            const allProducts = await window.dbAPI.getProducts();
            foundDoc = allProducts.find(p => p.barcode === term || p.sku === term || (p.name && p.name.toLowerCase() === cleanTerm));
        }

        if (foundDoc) {
            addProductToCart(foundDoc.id, foundDoc, qty);
            localProductIndex.push(foundDoc);
            playScanBeep(true);
            if (typeof updateVisualGridStock === 'function') updateVisualGridStock();
        } else {
            playScanBeep(false);
            if (typeof showToast === 'function') {
                showToast('Not Found', `No item matching "${escapeHTML(term)}"`, 'warning');
            }
            if (DOM.pos.manualInput) {
                DOM.pos.manualInput.classList.add('border-red-500', 'bg-red-50');
                setTimeout(() => DOM.pos.manualInput.classList.remove('border-red-500', 'bg-red-50'), 600);
                DOM.pos.manualInput.select();
            }
        }

    } catch (error) {
        console.error("Barcode Processing Error:", error);
        playScanBeep(false);
    }
}

// --- Internal Logic ---
function setupPosListeners() {
    if (!DOM.pos.cartBody) return;

    DOM.pos.cartBody.addEventListener('input', (e) => {
        const target = e.target;
        if (target.classList.contains('qty-input')) {
            handleQtyChange(target.dataset.id, target.value, true);
        } else if (target.classList.contains('price-input')) {
            handlePriceChange(target.dataset.id, target.value, true);
        }
    });

    DOM.pos.cartBody.addEventListener('focusout', (e) => {
        const target = e.target;
        if (target.classList.contains('price-input')) {
            target.value = parseFloat(target.value || 0).toFixed(2);
        }
    });

    DOM.pos.cartBody.addEventListener('click', (e) => {
        if (e.target.closest('.remove-item-btn')) {
            const btn = e.target.closest('.remove-item-btn');
            removeFromCart(btn.dataset.id);
        }
    });

    if (DOM.pos.totals?.discount) DOM.pos.totals.discount.addEventListener('input', updateCartSummary);

    // 🚀 INITIALIZE GLOBAL HARDWARE BARCODE INTERCEPTOR
    setupGlobalHardwareScanner();

    // Replaced deprecated 'keypress' with 'keydown'
    if (DOM.pos.manualInput) {
        DOM.pos.manualInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleManualAdd();
            }
        });
    }
    const manualBtn = DOM.pos.addBtn;
    if (manualBtn) manualBtn.addEventListener('click', handleManualAdd);

    if (DOM.pos.customer.id) DOM.pos.customer.id.addEventListener('change', handleCustomerIdLookup);

    if (DOM.pos.customer.name) {
        DOM.pos.customer.name.addEventListener('input', handleCustomerNameInput);
        DOM.pos.customer.name.addEventListener('change', handleCustomerNameLookup);

        // 🚀 MOVED FROM GLOBAL SCOPE TO HERE:
        DOM.pos.customer.name.addEventListener('focus', (e) => {
            renderCustomerDropdown(e.target.value);
            document.getElementById('pinned-customers-dropdown')?.classList.remove('hidden');
        });
        DOM.pos.customer.name.addEventListener('input', (e) => {
            renderCustomerDropdown(e.target.value);
        });
    }

    // 🚀 MOVED FROM GLOBAL SCOPE TO HERE:
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#pos-cust-name') && !e.target.closest('#pinned-customers-dropdown')) {
            const dropdown = document.getElementById('pinned-customers-dropdown');
            if (dropdown) dropdown.classList.add('hidden');
        }

        const btn = e.target.closest('button') || e.target.closest('a') || e.target;
        if (btn && btn.textContent.trim().toUpperCase() === 'CHANGE') {
            e.preventDefault();
            resetCustomerPosState();
        }
    });

    document.addEventListener('change', async (e) => {
        if (e.target.id === 'print-mode-toggle') {
            const isChecked = e.target.checked;

            if (isChecked) {
                const isReady = await verifyWhatsAppSetup();
                if (!isReady) {
                    e.target.checked = false;
                    if (typeof startWhatsAppSetupFlow === 'function') startWhatsAppSetupFlow(e.target);
                    return;
                }
            }

            isPaperlessMode = isChecked;
            localStorage.setItem('mifela_paperless_mode', isPaperlessMode);
            updatePrintModeUI();
            if (typeof showToast === 'function') showToast('Mode Updated', isPaperlessMode ? 'WhatsApp Enabled' : 'Paper Enabled', 'info');
        }
    });

    // ... inside setupPosListeners()

    // 🚀 CLEANED UP DUPLICATES: Smart Customer Phone Auto-Fetch
    const phoneInputEl = document.getElementById('pos-cust-phone');
    if (phoneInputEl) {
        let phoneDebounceTimer;
        phoneInputEl.addEventListener('input', (e) => {
            clearTimeout(phoneDebounceTimer);

            // Format phone number immediately as user types
            let val = e.target.value.replace(/[^\d+]/g, '');
            if (val.startsWith('+91')) val = val.substring(3);
            else if (val.startsWith('91') && val.length > 10) val = val.substring(2);
            if (val.length > 10) val = val.substring(0, 10);

            if (e.target.value !== val) e.target.value = val;

            // Wait until they stop typing to run the lookup
            phoneDebounceTimer = setTimeout(async () => {
                if (val.length === 10) {
                    let match = localCustomerIndex.find(c => c.phone && c.phone.replace(/\D/g, '').includes(val));

                    if (!match) {
                        try {
                            const currentAppId = typeof window !== 'undefined' && window.__app_id ? window.__app_id : appId;
                            const dirRef = collection(db, `artifacts/${currentAppId}/directory_merchants`);
                            const candidates = [`+91${val}`, val, `0${val}`, `+91 ${val.slice(0, 5)} ${val.slice(5)}`];
                            const q = query(dirRef, where("phone", "in", candidates), limit(1));
                            const snap = await getDocs(q);

                            if (!snap.empty) {
                                match = { id: snap.docs[0].id, ...snap.docs[0].data(), name: snap.docs[0].data().storeName || snap.docs[0].data().name };
                                localCustomerIndex.push(match);
                            }
                        } catch (err) {
                            console.warn("Fetch failed:", err);
                        }
                    }

                    if (match) {
                        applyCustomerPosState(match, true);
                    }
                } else if (val.length < 10) {
                    // Reset customer state if they delete digits
                    resetCustomerPosState();
                    // Put the partial phone number back so they can finish typing
                    e.target.value = val;
                }
            }, 600);
        });
    }
    AppState.subscribe('products_updated', async () => {
        await refreshProductIndex(); // Pulls the fresh SQLite data

        // 1. Update Visual Grid
        if (typeof updateVisualGridStock === 'function') updateVisualGridStock();

        // 2. Re-hydrate the Cart with live data (Sync Prices, Names, and Stock Limits)
        const currentCart = typeof getCurrentCart === 'function' ? getCurrentCart() : [];
        if (currentCart.length > 0) {
            let hasCartChanges = false;
            const syncedCart = currentCart.map(cartItem => {
                const liveProduct = localProductIndex.find(p => p.id === cartItem.id);
                if (!liveProduct) return cartItem; // Product was deleted, ignore or handle removal

                if (
                    cartItem.name !== liveProduct.name ||
                    cartItem.originalPrice !== liveProduct.price ||
                    cartItem.stock !== liveProduct.stockLevel
                ) {
                    hasCartChanges = true;
                    return {
                        ...cartItem,
                        name: liveProduct.name,
                        originalPrice: liveProduct.price,
                        price: cartItem.price === cartItem.originalPrice ? liveProduct.price : cartItem.price, // Keep custom overrides if they typed one
                        stock: liveProduct.stockLevel
                    };
                }
                return cartItem;
            });

            if (hasCartChanges) {
                setCurrentCart(syncedCart);
                persistCart();
                renderCart();
                updateCartSummary();
                if (typeof showToast === 'function') showToast("Live Sync", "Cart prices/stock updated from inventory.", "info");
            }
        }
    });

    // 🚀 REACTIVITY: Listen for Customer / Ledger Changes
    AppState.subscribe('customers_updated', async () => {
        await refreshCustomerIndex();

        // If a customer is currently selected in the POS, check if their dues changed
        const activeCustId = DOM.pos?.customer?.id?.value;
        if (activeCustId) {
            const liveCustomer = localCustomerIndex.find(c => c.id === activeCustId || c.merchantId === activeCustId);
            if (liveCustomer && parseFloat(liveCustomer.dues || 0) !== currentCustomerDues) {
                applyCustomerPosState(liveCustomer, false); // Silently update the dues badge on screen
            }
        }
    });

    resetCartIdleTimer();
}
// ============================================================================
// 🚀 CASH CALCULATOR & KEYBOARD SHORTCUTS
// ============================================================================

let isShortcutsAttached = false;

function setupKeyboardShortcuts() {
    if (isShortcutsAttached) return;

    document.addEventListener('keydown', (e) => {
        // Prevent shortcuts from triggering if a modal (like Split Payment) is open
        if (document.getElementById('split-pay-modal') || document.getElementById('custom-prompt-modal')) return;

        // [F4] -> Complete Sale
        if (e.key === 'F4') {
            e.preventDefault();
            const btn = DOM.pos.checkoutBtn;
            if (btn && !btn.disabled && !isProcessingCheckout) btn.click();
        }

        // [F2] -> Jump to Customer Phone Input
        if (e.key === 'F2') {
            e.preventDefault();
            if (DOM.pos.customer.phone) DOM.pos.customer.phone.focus();
        }

        // [F3] -> Jump to Product Search Input
        if (e.key === 'F3') {
            e.preventDefault();
            if (DOM.pos.manualInput) DOM.pos.manualInput.focus();
        }
    });

    isShortcutsAttached = true;
}

window.injectCashCalculator = function () {
    const checkoutBtn = DOM.pos.checkoutBtn;
    if (!checkoutBtn) return;

    const container = checkoutBtn.parentNode;
    if (!container || document.getElementById('cash-calculator-block')) return;

    const calcHtml = `
        <div id="cash-calculator-block" class="col-span-4 bg-emerald-50 border border-emerald-200 p-3 rounded-xl mt-1 mb-1 ${activePaymentMethod === 'Cash' ? 'flex' : 'hidden'} items-center gap-4   shadow-sm">
            
            <div class="flex-1">
                <label class="block text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-1.5">Cash Given</label>
                <div class="relative flex items-center">
                    <span class="absolute left-3 font-bold text-emerald-600">${getCurrencySymbol()}</span>
                    <input type="number" id="cash-tendered-input" class="w-full pl-7 pr-2 py-2 rounded-lg border border-emerald-300 text-lg font-black text-emerald-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all shadow-inner bg-white" placeholder="0">
                </div>
            </div>
            
            <div class="w-px bg-emerald-200 h-10 self-center"></div>
            
            <div class="flex-1 flex flex-col justify-center items-end pr-1 overflow-hidden">
                <label class="block text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-1.5">Change Due</label>
                <div id="cash-change-display" class="text-2xl font-black text-slate-400 truncate w-full text-right leading-none tracking-tight">${getCurrencySymbol()}0.00</div>
            </div>
            
        </div>
    `;

    // Insert it directly above the Complete Sale button
    container.insertBefore(document.createRange().createContextualFragment(calcHtml), checkoutBtn);

    // Wire up the math engine
    document.getElementById('cash-tendered-input').addEventListener('input', window.updateCashChange);
};

window.updateCashChange = function () {
    const input = document.getElementById('cash-tendered-input');
    const display = document.getElementById('cash-change-display');
    const calcBlock = document.getElementById('cash-calculator-block');
    if (!input || !display) return;

    const { total } = calculateTotals();
    const tendered = parseFloat(input.value) || 0;
    const change = tendered - total;
    const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';

    // Base CSS classes to keep the text aligned and prevent it from breaking the layout
    const baseClasses = "text-2xl font-black truncate w-full text-right leading-none tracking-tight ";

    const labelEl = calcBlock ? calcBlock.querySelector('div.flex-1.items-end label') : null;

    if (tendered === 0) {
        if (labelEl) labelEl.textContent = "Change Due";
        display.textContent = `${currency}0.00`;
        display.className = baseClasses + "text-slate-400";
    } else if (change < -0.01) {
        // Negative: Amount still due
        if (labelEl) labelEl.textContent = "Amount Short";
        display.textContent = `-${currency}${Math.abs(change).toFixed(2)}`;
        display.className = baseClasses + "text-red-500";
    } else if (Math.abs(change) <= 0.01) {
        // Exact amount: Balanced
        if (labelEl) labelEl.textContent = "Status";
        display.innerHTML = `<span class="text-blue-700 px-3 py-1 rounded-lg text-xl tracking-wide inline-block">Balanced ✓</span>`;
        display.className = "w-full text-right font-black flex justify-end";
    } else {
        // Positive: Change to return
        if (labelEl) labelEl.textContent = "Change Due";
        display.textContent = `${currency}${change.toFixed(2)}`;
        display.className = baseClasses + "text-emerald-600";
    }
};

function updateActivePaymentTab(plan) {
    if (plan === 'free') return;

    const activeClass = "pay-tab py-3 rounded-lg border-2 border-SLATE-600 bg-SLATE-50 text-SLATE-700 font-bold text-sm flex flex-col items-center justify-center shadow-md transform scale-[1.02] transition-all";
    const inactiveClass = "pay-tab py-3 rounded-lg border border-gray-200 bg-white text-gray-500 font-medium text-sm flex flex-col items-center justify-center hover:bg-gray-50 hover:border-gray-300 transition-all";

    document.querySelectorAll('.pay-tab').forEach(btn => {
        if (btn.disabled) return;
        if (btn.dataset.method === activePaymentMethod) {
            btn.className = activeClass;
        } else {
            btn.className = inactiveClass;
        }
    });
}

function setActivePaymentMethod(method) {
    activePaymentMethod = method;
    if (method !== 'Split') splitPaymentDetails = null;
    const plan = normalizePlan(typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free');
    updateActivePaymentTab(plan);

    // 🚀 NEW: Show/Hide Cash Calculator
    const calcBlock = document.getElementById('cash-calculator-block');
    if (calcBlock) {
        if (method === 'Cash') {
            calcBlock.classList.remove('hidden');
            calcBlock.classList.add('flex');
            window.updateCashChange();
        } else {
            calcBlock.classList.add('hidden');
            calcBlock.classList.remove('flex');
        }
    }
}



function persistCart() {
    const cart = getCurrentCart();
    localStorage.setItem(getCartKey(), JSON.stringify(cart));
}

// export async function handleCheckout() {
//     if (isProcessingCheckout) return; 

//     const currentCart = typeof getCurrentCart === 'function' ? getCurrentCart() : [];

//     if (currentCart.length === 0 && currentCustomerDues <= 0) {
//         showModal('Empty Cart', 'Please add items or select a customer with pending dues before checking out.', 'error');
//         return;
//     }

//     const plan = typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free';
//     let method = activePaymentMethod;
//     if (plan === 'free' || plan === 'free-tier') {
//         const select = DOM.pos.paymentMethod;
//         method = select ? select.value : 'Cash';
//     }

//     if (method === 'Split' && !splitPaymentDetails) {
//         handleSplitPayment(); 
//         return;
//     }

//     const customerName = DOM.pos.customer.name ? DOM.pos.customer.name.value.trim() : '';
//     const customerPhone = DOM.pos.customer.phone ? DOM.pos.customer.phone.value.trim().replace(/\D/g, '') : '';

//     let isCreditSale = false;

//     if (method === 'Credit') {
//         isCreditSale = true;
//     } else if (method === 'Split' && splitPaymentDetails) {
//         const creditAmount = parseFloat(splitPaymentDetails.credit) || 0;
//         if (creditAmount > 0) {
//             isCreditSale = true;
//         }
//     }

//     if (isCreditSale) {
//         if (!customerName || customerPhone.length < 10) {
//             showModal('Missing Information', 'Customer Name and a valid 10-digit Phone Number are strictly required to issue Credit (Udhaar).', 'error');
//             if(DOM.pos.customer.name && !customerName) DOM.pos.customer.name.classList.add('border-red-500', 'bg-red-50', 'animate-pulse');
//             if(DOM.pos.customer.phone && customerPhone.length < 10) DOM.pos.customer.phone.classList.add('border-red-500', 'bg-red-50', 'animate-pulse');
//             setTimeout(() => {
//                 if(DOM.pos.customer.name) DOM.pos.customer.name.classList.remove('border-red-500', 'bg-red-50', 'animate-pulse');
//                 if(DOM.pos.customer.phone) DOM.pos.customer.phone.classList.remove('border-red-500', 'bg-red-50', 'animate-pulse');
//             }, 3000);
//             return; 
//         }
//     }

//     // =========================================================
//     // 🚀 READ CUSTOM INVOICE DATE FROM UI (Fixes Scope Error)
//     // =========================================================
//     let overrideDate = null;
//     const dateInput = document.getElementById('pos-custom-date');

//     if (dateInput && dateInput.value) {
//         const selectedDate = dateInput.value;
//         const now = new Date();
//         const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

//         // Only trigger an override if they actually changed it
//         if (selectedDate !== todayStr) {
//             overrideDate = selectedDate;
//         }
//     }

//     // =========================================================
//     // 🚀 THE SMART ROUTER LOGIC
//     // =========================================================
//     if (method === 'UPI' || method === 'Card') {
//         const { total } = calculateTotals();

//         let isRazorpaySetup = false;
//         const rzpNode = document.getElementById('setting-razorpay-key');

//         if (rzpNode && rzpNode.value.trim().length > 5) {
//             isRazorpaySetup = true;
//         } else {
//             try {
//                 const sId = typeof getStoreId === 'function' ? getStoreId() : window.primaryStoreId;
//                 const aId = typeof window !== 'undefined' && window.__app_id ? window.__app_id : (appId || "electron-mifela-inventory");

//                 if (sId) {
//                     const snap = await getDoc(doc(db, `artifacts/${aId}/stores/${sId}/settings/profile`));
//                     if (snap.exists() && snap.data().razorpayKeyId) isRazorpaySetup = true;
//                 }
//             } catch(e) { console.warn("Razorpay key check fallback failed", e); }
//         }

//         if (!isRazorpaySetup) {
//             processCheckout(method, overrideDate);
//             return;
//         }

//         if (method === 'Card') {
//             await triggerPaymentGateway(total, method);
//             return;
//         }

//         if (method === 'UPI') {
//             const paymentRoute = await promptForPaymentRoute(method, total);
//             if (paymentRoute === 'CANCEL') return;
//             if (paymentRoute === 'INTERNAL') {
//                 await triggerPaymentGateway(total, method);
//                 return; 
//             }
//             if (paymentRoute === 'EXTERNAL') {
//                 processCheckout(method, overrideDate);
//                 return;
//             }
//         }
//         return; 
//     }

//     // If it's Cash or Credit, process normally
//     processCheckout(method, overrideDate);
// }

export async function handleCheckout() {
    if (isProcessingCheckout) return;
    isProcessingCheckout = true;
    setCheckoutLoadingState(true);

    try {
        const currentCart = typeof getCurrentCart === 'function' ? getCurrentCart() : [];

        if (currentCart.length === 0 && currentCustomerDues <= 0) {
            showModal('Empty Cart', 'Please add items or select a customer with pending dues before checking out.', 'error');
            return;
        }

        let method = activePaymentMethod;

        // 🚀 SMART SPLIT INTERCEPTOR: Automatically convert Cash shortage to Credit (Udhaar)
        if (method === 'Cash') {
            const tenderedInput = document.getElementById('cash-tendered-input');
            if (tenderedInput && tenderedInput.value !== '') {
                const tendered = parseFloat(tenderedInput.value) || 0;
                const { total } = calculateTotals();

                if (tendered < total) {
                    const shortage = total - tendered;
                    method = 'Split';
                    splitPaymentDetails = { cash: tendered, card: 0, upi: 0, credit: shortage };
                    if (typeof showToast === 'function') showToast('Auto-Split Applied', `₹${tendered.toFixed(2)} Cash & ₹${shortage.toFixed(2)} Credit`, 'info');
                }
            }
        }

        if (method === 'Split' && !splitPaymentDetails) {
            await handleSplitPayment();
            if (!splitPaymentDetails) return; // Stop if user cancelled the split modal
        }

        if (stagedDuesPayment > 0 && (method === 'Credit' || (method === 'Split' && splitPaymentDetails && parseFloat(splitPaymentDetails.credit) > 0))) {
            showModal('Invalid Payment', 'You cannot use Credit (Udhaar) to settle past dues. Please select Cash, UPI, or Card.', 'error');
            return;
        }

        const customerName = DOM.pos.customer.name ? DOM.pos.customer.name.value.trim() : '';
        const customerPhone = DOM.pos.customer.phone ? DOM.pos.customer.phone.value.trim().replace(/\D/g, '') : '';

        let isCreditSale = method === 'Credit' || (method === 'Split' && splitPaymentDetails && parseFloat(splitPaymentDetails.credit) > 0);

        if (isCreditSale) {
            if (!customerName || customerPhone.length < 10) {
                showModal('Missing Information', 'Customer Name and a valid 10-digit Phone Number are strictly required to issue Credit (Udhaar).', 'error');
                if (DOM.pos.customer.name && !customerName) DOM.pos.customer.name.classList.add('border-red-500', 'bg-red-50', 'animate-pulse');
                if (DOM.pos.customer.phone && customerPhone.length < 10) DOM.pos.customer.phone.classList.add('border-red-500', 'bg-red-50', 'animate-pulse');
                setTimeout(() => {
                    if (DOM.pos.customer.name) DOM.pos.customer.name.classList.remove('border-red-500', 'bg-red-50', 'animate-pulse');
                    if (DOM.pos.customer.phone) DOM.pos.customer.phone.classList.remove('border-red-500', 'bg-red-50', 'animate-pulse');
                }, 3000);
                return;
            }
        }

        let overrideDate = null;
        const dateInput = document.getElementById('pos-custom-date');
        if (dateInput && dateInput.value) {
            const selectedDate = dateInput.value;
            const now = new Date();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            if (selectedDate !== todayStr) overrideDate = selectedDate;
        }

        // Handle ONLINE_GATEWAY payment method (posgateway.mifela.com redirect with Razorpay)
        if (method === 'ONLINE_GATEWAY') {
            // The verification is handled via the redirect listener in app.js
            // which stores verification data in localStorage and then calls handleCheckout
            // We just need to ensure we don't require customer info for this method
            // (unless it's a credit sale, which it isn't for gateway payments)
            // Fall through to processCheckout
        } else if (method === 'UPI' || method === 'Card') {
            const { total } = calculateTotals();
            let isRazorpaySetup = false;
            const rzpNode = document.getElementById('setting-razorpay-key');

            if (rzpNode && rzpNode.value.trim().length > 5) {
                isRazorpaySetup = true;
            } else {
                try {
                    const sId = typeof getStoreId === 'function' ? getStoreId() : window.primaryStoreId;
                    const aId = typeof window !== 'undefined' && window.__app_id ? window.__app_id : (appId || "electron-mifela-inventory");
                    if (sId) {
                        const snap = await getDoc(doc(db, `artifacts/${aId}/stores/${sId}/settings/profile`));
                        if (snap.exists() && snap.data().razorpayKeyId) isRazorpaySetup = true;
                    }
                } catch (e) { console.warn("Razorpay check fallback failed", e); }
            }

            if (!isRazorpaySetup) {
                await processCheckout(method, overrideDate); // 🚀 FIX: Must be awaited
                return;
            }

            if (method === 'Card') {
                await triggerPaymentGateway(total, method); // 🚀 FIX: Must be awaited
                return;
            }

            if (method === 'UPI') {
                const paymentRoute = await promptForPaymentRoute(method, total);
                if (paymentRoute === 'CANCEL') return;
                if (paymentRoute === 'INTERNAL') {
                    await triggerPaymentGateway(total, method); // 🚀 FIX: Must be awaited
                    return;
                }
                if (paymentRoute === 'EXTERNAL') {
                    await processCheckout(method, overrideDate); // 🚀 FIX: Must be awaited
                    return;
                }
            }
            return;
        }

        // 🚀 4. Final Execution
        await processCheckout(method, overrideDate); // 🚀 FIX: Must be awaited

    } catch (error) {
        console.error("Checkout Error:", error);
        showModal('Transaction Failed', error.message, 'error');
    } finally {
        // 🚀 5. Guaranteed UI Unlock
        isProcessingCheckout = false;
        setCheckoutLoadingState(false);
    }
}


async function resolveAndCreateCustomer(ops) {
    // 🚀 THE FIX: Strict, direct DOM access bypassing the flawed DOM object map
    const nameInput = document.getElementById('pos-cust-name');
    const phoneInput = document.getElementById('pos-cust-phone');
    const idInput = document.getElementById('pos-cust-id');

    const name = nameInput ? nameInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim().replace(/\s/g, '') : '';
    const id = idInput ? idInput.value.trim() : '';

    // Fallback to Walk-In if empty
    if (!name || name.toLowerCase() === 'walk-in customer') {
        return { id: 'WALK-IN', name: 'Walk-in Customer', phone: '' };
    }

    // Match by ID
    if (id) {
        const localMatch = localCustomerIndex.find(c => c.id === id || c.merchantId === id);
        if (localMatch) return { ...localMatch, name, phone };
        return { id, name, phone };
    }

    // Match by Phone
    if (phone) {
        const existingCust = localCustomerIndex.find(c => c.phone === phone);
        if (existingCust) {
            return { ...existingCust, name: name || existingCust.name, phone };
        }
    }

    // Create New Customer on the fly
    const newId = `CUST-${Date.now().toString().slice(-8)}`;
    const newCustomer = {
        id: newId,
        name: name,
        phone: phone || '',
        type: 'customer',
        tradeType: 'D2C',
        createdAt: new Date().toISOString(),
        totalVisits: 0,
        totalSpent: 0,
        lastVisit: null,
        locationId: typeof activePosContainerId !== 'undefined' ? activePosContainerId : 'main'
    };

    ops.push({ type: 'set', col: 'customers', id: newId, data: newCustomer });
    localCustomerIndex.push(newCustomer);

    if (typeof populateCustomerDatalists === 'function') populateCustomerDatalists();
    if (idInput) idInput.value = newId;

    return newCustomer;
}

async function processCheckout(method, overrideDate = null) {
    if (!window.dbAPI || !window.dbAPI.executeBatch) throw new Error("Offline Database not ready.");
    const ops = [];
    const { subtotal, tax, cess, total, discount, fee, dues, totalCost, profit, cartTotal } = calculateTotals();
    const currencyCode = typeof getCurrencyCode === 'function' ? getCurrencyCode() : 'INR';
    const currencySymbol = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';
    const userId = typeof getUserId === 'function' ? getUserId() : 'SYSTEM';

    const cashierName = 'Terminal User';

    const finalCustomerData = await resolveAndCreateCustomer(ops);

    let customerUpdates = {};
    if (finalCustomerData.id !== 'WALK-IN') {
        customerUpdates = {
            totalVisits: (finalCustomerData.totalVisits || 0) + 1,
            totalSpent: (parseFloat(finalCustomerData.totalSpent) || 0) + cartTotal,
            lastVisit: new Date().toISOString(),
            name: finalCustomerData.name,
            phone: finalCustomerData.phone
        };

        let totalPaidNow = 0;
        if (method === 'Cash' || method === 'UPI' || method === 'Card') {
            totalPaidNow = total;
        } else if (method === 'Split' && splitPaymentDetails) {
            totalPaidNow = (parseFloat(splitPaymentDetails.cash) || 0) +
                (parseFloat(splitPaymentDetails.card) || 0) +
                (parseFloat(splitPaymentDetails.upi) || 0);
        }

        const ledgerChange = cartTotal - totalPaidNow;

        if (ledgerChange !== 0) {
            customerUpdates.dues = (parseFloat(finalCustomerData.dues || finalCustomerData.balance || 0)) + ledgerChange;
            const localCust = localCustomerIndex.find(c => c.id === finalCustomerData.id);
            if (localCust) {
                localCust.dues = customerUpdates.dues;
            }
        }

        ops.push({ type: 'update', col: 'customers', id: finalCustomerData.id, data: customerUpdates });
    } else if (method === 'Credit' || (method === 'Split' && splitPaymentDetails && splitPaymentDetails.credit > 0)) {
        throw new Error("Credit sales require a valid registered customer profile.");
    }

    const storeName = document.getElementById('setting-store-name')?.value || document.getElementById('dashboard-store-name')?.textContent || 'Store';
    const storeAddress = document.getElementById('setting-store-address')?.value || '';
    const storePhone = document.getElementById('setting-store-phone')?.value || '';
    const storeEmail = document.getElementById('setting-store-email')?.value || '';
    const storeTaxId = document.getElementById('setting-store-tax-id')?.value || '';
    const storePan = document.getElementById('setting-store-pan')?.value || '';
    const storeLogo = document.getElementById('setting-store-logo')?.value || document.getElementById('logo-preview-img')?.src || '';
    const currentCart = typeof getCurrentCart === 'function' ? getCurrentCart() : [];

    const transactionId = typeof generateInvoiceId === 'function' ? generateInvoiceId() : `INV-${Date.now()}`;

    const realNow = new Date();
    let effectiveDate = realNow;
    if (overrideDate) {
        const [y, m, d] = overrideDate.split('-');
        effectiveDate = new Date(y, m - 1, d, realNow.getHours(), realNow.getMinutes(), realNow.getSeconds());
    }
    const localTimestamp = effectiveDate.toISOString();

    let finalRevenue = 0;
    if (method === 'Cash' || method === 'UPI' || method === 'Card') finalRevenue = total;
    else if (method === 'Split' && splitPaymentDetails) finalRevenue = ((parseFloat(splitPaymentDetails.cash) || 0) + (parseFloat(splitPaymentDetails.card) || 0) + (parseFloat(splitPaymentDetails.upi) || 0));

    const isB2BTrade = finalCustomerData.gstin && finalCustomerData.gstin.trim().length >= 15;
    const globalTradeType = isB2BTrade ? 'B2B' : 'D2C';

    // Include Razorpay gateway verification data if available (for ONLINE_GATEWAY payments)
    let gatewayVerification = null;
    if (method === 'ONLINE_GATEWAY') {
        const storedVerification = localStorage.getItem('mifela_gateway_verification');
        if (storedVerification) {
            try {
                gatewayVerification = JSON.parse(storedVerification);
            } catch (e) {
                console.error('Failed to parse gateway verification data', e);
            }
        }
    }

    const transactionData = {
        id: transactionId,
        invoiceId: transactionId,
        tradeType: globalTradeType,
        timestamp: localTimestamp,
        localTimestamp: localTimestamp,
        customInvoiceDate: overrideDate,
        cashierId: userId,
        cashierName: cashierName,
        locationId: activePosContainerId,
        storeDetails: { name: storeName, address: storeAddress, phone: storePhone, email: storeEmail, gstin: storeTaxId, pan: storePan, logoUrl: storeLogo, branch: activePosContainerId },
        customer: finalCustomerData,
        items: currentCart.map(item => {
            const rate = parseFloat(item.taxRate || item.gstSlab || 0);
            const cessRate = parseFloat(item.cess || 0);
            const lineTotal = safeMath.multiply(item.price, item.quantity);

            const combinedTaxRate = rate + cessRate;
            const baseTaxable = lineTotal / (1 + (combinedTaxRate / 100));
            const taxAmt = baseTaxable * (rate / 100);
            const cessAmt = baseTaxable * (cessRate / 100);

            return {
                id: item.id, name: item.name, sku: item.sku, quantity: item.quantity,
                mrp: item.mrp || item.price || 0, price: item.price, cost: item.cost || 0,
                type: item.type || 'standard', taxRate: rate, gstSlab: rate, cessRate: cessRate,
                isOms: false, subtotal: lineTotal, taxableValue: baseTaxable, taxAmount: taxAmt, cessAmount: cessAmt,
                hsn: item.hsn || '', batch: item.batch || '', mfd: item.mfd || '', expiry: item.expiry || ''
            };
        }),
        summary: {
            subtotal, discount, tax, cess: cess || 0, convenienceFee: fee,
            dues: dues || 0, stagedDuesPayment: stagedDuesPayment || 0,
            revenue: finalRevenue, total, cartTotal, totalCost, profit,
            paymentMethod: method, paymentDetails: splitPaymentDetails || null, transactionType: 'SALE',
            // Razorpay gateway verification details
            gatewayVerification: gatewayVerification || null
        },
        currency: { code: currencyCode, symbol: currencySymbol }
    };

    ops.push({ type: 'set', col: 'transactions', id: transactionId, data: transactionData });

    // Decrement local inventory cache dynamically
    const processFifoDepletion = (productId, qtyToDeduct) => {
        const localMatch = localProductIndex.find(p => p.id === productId);
        if (!localMatch) return null;

        let currentBatches = localMatch.batches ? JSON.parse(JSON.stringify(localMatch.batches)).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)) : [];
        let qtyToRemove = qtyToDeduct;

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
        localMatch.batches = currentBatches;
        return currentBatches;
    };

    currentCart.forEach(item => {
        if (item.id) {
            if (item.type === 'bundle' && Array.isArray(item.bundleComponents) && item.bundleComponents.length > 0) {
                item.bundleComponents.forEach(comp => {
                    const totalDeduction = comp.qty * item.quantity;

                    const updatedBatches = processFifoDepletion(comp.id, totalDeduction);

                    // 🚀 THE FIX: Look up real stock from the local index, as components aren't fully in the cart
                    const realComp = localProductIndex.find(p => p.id === comp.id);
                    const currentStock = realComp ? (parseFloat(realComp.stockLevel) || 0) : 0;

                    const pData = { stockLevel: currentStock - totalDeduction };

                    if (updatedBatches !== null) pData.batches = updatedBatches;

                    ops.push({ type: 'update', col: 'products', id: comp.id, data: pData });

                    // Update UI Memory
                    if (realComp) realComp.stockLevel = currentStock - totalDeduction;
                });
                if (typeof recalculateBundleStocks === 'function') recalculateBundleStocks();
            } else {
                const updatedBatches = processFifoDepletion(item.id, item.quantity);

                // 🚀 THE FIX: Read 'item.stock' instead of 'item.stockLevel' for cart items
                const pData = { stockLevel: (parseFloat(item.stock) || 0) - item.quantity };

                if (updatedBatches !== null) pData.batches = updatedBatches;

                ops.push({ type: 'update', col: 'products', id: item.id, data: pData });

                // Update UI Memory
                const localMatch = localProductIndex.find(p => p.id === item.id);
                if (localMatch) localMatch.stockLevel = (parseFloat(localMatch.stockLevel) || 0) - item.quantity;
            }
        }
    });

    // Push everything to SQLite!
    await window.dbAPI.executeBatch(ops);
    if (typeof AppState !== 'undefined') {
        AppState.notify('products_updated');
        AppState.notify('transactions_updated');
        if (finalCustomerData.id !== 'WALK-IN') {
            AppState.notify('customers_updated');
        }
    }

    transactionData.timestamp = new Date();

    // Print Handler
    if (isAutoPrintEnabled) {
        const formatSelector = document.getElementById('pos-export-format-selector');
        const selectedFormat = formatSelector ? formatSelector.value : '80mm';

        try {
            if (selectedFormat === '80mm') {
                if (typeof buildAndPrintInvoice === 'function') buildAndPrintInvoice(transactionData, storeName);
            } else if (selectedFormat === 'print_a3') {
                if (typeof window.printA3InvoiceHtml === 'function') window.printA3InvoiceHtml(transactionData, storeName);
            } else if (selectedFormat === 'pdf_a3') {
                if (typeof generatePosPdf === 'function') generatePosPdf(transactionData, storeName);
                else window.printA3InvoiceHtml(transactionData, storeName);
            } else if (selectedFormat === 'excel') {
                if (typeof exportPosCartToExcel === 'function') exportPosCartToExcel(transactionData, storeName);
            } else if (selectedFormat === 'csv') {
                if (typeof exportPosCartToCsv === 'function') exportPosCartToCsv(transactionData, storeName);
            }
        } catch (exportErr) {
            console.error("Export Error:", exportErr);
        }
    }

    if (typeof clearCart === 'function') clearCart();
    document.getElementById('generic-modal')?.remove();
}


// --- REPLACE IN src/components/pos.js ---

async function updateParkedIndicator(plan) {
    const btn = document.getElementById('pos-retrieve-btn');
    if (!btn) return;
    if (plan === 'free') {
        btn.classList.add('hidden');
        btn.classList.remove('flex');
        return;
    }

    try {
        const locationId = typeof getCurrentLocationId === 'function' ? getCurrentLocationId() : 'main';
        const parkedStr = localStorage.getItem(`mifela_parked_${locationId}`) || '[]';
        const parkedCarts = JSON.parse(parkedStr);

        if (parkedCarts.length > 0) {
            btn.classList.remove('hidden');
            btn.classList.add('flex', 'items-center', 'justify-center', 'gap-1');
            btn.innerHTML = `<svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> Recall <span class="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 min-w-[1.2rem] text-center">${parkedCarts.length}</span>`;
        } else {
            btn.classList.add('hidden');
            btn.classList.remove('flex');
        }
    } catch (e) { }
}

async function handleParkSale() {
    const plan = normalizePlan(typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free');
    const currentCart = typeof getCurrentCart === 'function' ? getCurrentCart() : [];

    if (plan === 'free') {
        if (typeof showModal === 'function') showModal('Upgrade Plan', 'Parking sales is available on Silver, Gold, and Platinum plans.', 'info');
        return;
    }

    if (currentCart.length === 0) {
        if (typeof showModal === 'function') showModal('Empty Cart', 'Cannot park an empty cart.', 'error');
        return;
    }

    const locationId = typeof getCurrentLocationId === 'function' ? getCurrentLocationId() : 'main';

    let label = `Order #${Date.now().toString().slice(-4)}`;
    if (typeof promptForInput === 'function') {
        const userInput = await promptForInput('Park Sale', "Enter a reference name (e.g. Cart 5):", label);
        if (userInput === null) return;
        label = userInput;
    }

    try {
        const newParked = {
            id: `park_${Date.now()}`,
            label: label,
            cart: currentCart,
            customerId: DOM.pos?.customer?.id ? DOM.pos.customer.id.value.trim() : '',
            customerName: DOM.pos?.customer?.name ? DOM.pos.customer.name.value.trim() : '',
            customerPhone: DOM.pos?.customer?.phone ? DOM.pos.customer.phone.value.trim() : '',
            locationId: locationId,
            timestamp: Date.now()
        };

        const parkedStr = localStorage.getItem(`mifela_parked_${locationId}`) || '[]';
        const parkedCarts = JSON.parse(parkedStr);
        parkedCarts.push(newParked);
        localStorage.setItem(`mifela_parked_${locationId}`, JSON.stringify(parkedCarts));

        if (typeof clearCart === 'function') clearCart();
        if (typeof updateParkedIndicator === 'function') updateParkedIndicator(plan);

        if (typeof showToast === 'function') showToast('Parked', 'Sale put on hold.', 'success');
    } catch (e) {
        console.error("Failed to park sale locally:", e);
    }
}

async function showParkedSalesList() {
    const plan = normalizePlan(typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free');
    if (plan === 'free') return;

    const locationId = typeof getCurrentLocationId === 'function' ? getCurrentLocationId() : 'main';

    try {
        const parkedStr = localStorage.getItem(`mifela_parked_${locationId}`) || '[]';
        let cloudCarts = JSON.parse(parkedStr);

        if (cloudCarts.length === 0) {
            if (typeof showModal === 'function') showModal('No Parked Sales', 'There are no sales currently on hold for this branch.', 'info');
            if (typeof updateParkedIndicator === 'function') updateParkedIndicator(plan);
            return;
        }

        const modalId = 'parked-sales-list-modal';
        document.getElementById(modalId)?.remove();

        cloudCarts.sort((a, b) => b.timestamp - a.timestamp);

        let listHtml = '';
        cloudCarts.forEach((data, i) => {
            let timeStr = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const customerBadge = data.customerName ? `<span class="bg-SLATE-100 text-SLATE-700 px-2 py-0.5 rounded text-[10px] font-bold ml-2 truncate max-w-[120px] inline-block align-bottom pointer-events-none">${escapeHTML(data.customerName)}</span>` : '';

            listHtml += `
                <button class="retrieve-parked-btn w-full text-left p-4 border border-slate-200 rounded-xl mb-3 hover:border-SLATE-500 hover:shadow-md transition-all group bg-white" data-index="${i}">
                    <div class="flex justify-between items-start pointer-events-none">
                        <div class="min-w-0 pr-4">
                            <h4 class="font-black text-slate-800 text-lg group-hover:text-SLATE-600 transition-colors truncate">${escapeHTML(data.label)}</h4>
                            <div class="flex items-center mt-1">
                                <span class="text-xs text-slate-500 font-medium whitespace-nowrap">${data.cart?.length || 0} items</span>
                                ${customerBadge}
                            </div>
                        </div>
                        <span class="text-xs text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded shrink-0">${timeStr}</span>
                    </div>
                </button>
            `;
        });

        const html = `
            <div id="${modalId}" class="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[150] p-4">
                <div class="bg-slate-50 rounded-[2rem] shadow-2xl w-full max-w-md flex flex-col max-h-[80vh] overflow-hidden border border-white/20">
                    <div class="px-6 py-5 border-b border-slate-200 bg-white flex justify-between items-center shrink-0">
                        <h3 class="text-xl font-black text-slate-800 flex items-center gap-2">
                            <span class="bg-amber-100 text-amber-600 p-2 rounded-xl">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            </span>
                            Parked Sales
                        </h3>
                        <button id="close-parked-modal-btn" class="text-slate-400 hover:text-red-500 bg-slate-100 rounded-full p-2 hover:bg-red-50 transition border border-slate-200">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    <div id="parked-sales-container" class="p-6 overflow-y-auto custom-scrollbar flex-1">
                        ${listHtml}
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);

        const modalNode = document.getElementById(modalId);
        document.getElementById('close-parked-modal-btn').addEventListener('click', () => modalNode.remove());

        document.getElementById('parked-sales-container').addEventListener('click', async (e) => {
            const btn = e.target.closest('.retrieve-parked-btn');
            if (!btn) return;

            const index = parseInt(btn.getAttribute('data-index'), 10);

            if (index >= 0 && index < cloudCarts.length) {
                const sale = cloudCarts[index];
                const currentCart = typeof getCurrentCart === 'function' ? getCurrentCart() : [];

                if (currentCart.length > 0) {
                    if (!confirm("Current cart will be cleared. Continue?")) return;
                }

                modalNode.remove();

                if (typeof setCurrentCart === 'function') setCurrentCart(sale.cart || []);
                if (typeof persistCart === 'function') persistCart();

                if (sale.customerId && DOM.pos?.customer?.id) {
                    applyCustomerPosState({
                        id: sale.customerId,
                        name: sale.customerName,
                        phone: sale.customerPhone,
                        dues: 0
                    });
                } else {
                    resetCustomerPosState();
                }

                if (typeof renderCart === 'function') renderCart();

                // 🚀 Remove from LocalStorage directly
                cloudCarts.splice(index, 1);
                localStorage.setItem(`mifela_parked_${locationId}`, JSON.stringify(cloudCarts));

                if (typeof updateParkedIndicator === 'function') updateParkedIndicator(plan);
                if (typeof showToast === 'function') showToast('Loaded', `Retrieved: ${escapeHTML(sale.label)}`, 'success');
            }
        });
    } catch (e) { console.error("Failed to fetch parked sales:", e); }
}

async function handleSplitPayment() {
    const currentCart = getCurrentCart();

    const allowSplit = true; // Unlocked

    if (!allowSplit) {
        showModal('Upgrade Required', 'Split payments are available to Gold and Platinum users.', 'info');
        return;
    }

    if (currentCart.length === 0) {
        showModal('Error', 'Cart is empty.', 'error');
        return;
    }

    const totalAmount = parseFloat(DOM.pos.totals.final.textContent.replace(/[^0-9.-]+/g, '') || '0');
    const result = await promptForSplitPayment(totalAmount);

    if (result) {
        splitPaymentDetails = result;
        setActivePaymentMethod('Split');
        showModal('Split Ready', `Complete checkout to finalize.\nCash: ${result.cash}, Card: ${result.card}, UPI: ${result.upi}, Credit: ${result.credit}`, 'success');
    }
}


export function clearCart() {
    setCurrentCart([]);
    persistCart();
    setActivePaymentMethod('Cash');
    splitPaymentDetails = null;

    const tenderedInput = document.getElementById('cash-tendered-input');
    if (tenderedInput) tenderedInput.value = '';
    if (typeof window.updateCashChange === 'function') window.updateCashChange();

    resetCustomerPosState(); // Replaces 16 lines of duplicated cleanup code

    if (isVisualGridEnabled) {
        const searchInput = DOM.pos.manualInput;
        renderVisualPosGrid(searchInput ? searchInput.value.trim() : '');
    }

    renderCart();

    if (typeof updateVisualGridStock === 'function') updateVisualGridStock();
}

export async function handleManualAdd(e) {
    // If triggered by the physical button click, open the Custom Product Modal
    if (e && e.type === 'click') {
        if (typeof window.openCustomProductModal === 'function') {
            window.openCustomProductModal();
            return;
        }
    }

    if (!DOM.pos.manualInput) return;
    const query = DOM.pos.manualInput.value.trim();
    if (!query) return;

    // 🚀 THE FIX: Check if the grid is open and has an auto-focused search result
    const gridWrapper = document.getElementById('visual-pos-grid-wrapper');
    const firstResult = document.querySelector('.first-grid-result');

    // If the blue outline is active, click it!
    if (gridWrapper && gridWrapper.style.display !== 'none' && firstResult) {
        firstResult.click();
        return; // Halt here, the quantity modal will take over
    }

    let qtyToAdd = parseFloat(DOM.pos.quantityInput?.value || 1);
    if (isNaN(qtyToAdd) || qtyToAdd === 0) qtyToAdd = 1; // 🚀 THE FIX: Allowed negatives

    await findAndAddToCart(query, qtyToAdd);

    DOM.pos.manualInput.value = '';
    DOM.pos.quantityInput.value = '1';

    // Force native input event so Clear button hides AND Catalog Auto-Closes
    DOM.pos.manualInput.dispatchEvent(new Event('input', { bubbles: true }));

    DOM.pos.manualInput.focus();
}

window.openCustomProductModal = function () {
    const modalId = 'custom-pos-product-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();

    const currencySymbol = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';
    let defaultQty = 1;
    if (DOM.pos && DOM.pos.quantityInput) {
        defaultQty = parseFloat(DOM.pos.quantityInput.value) || 1;
    }

    const html = `
        <div id="${modalId}" class="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[250]   p-4">
            <div class="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 border border-slate-100 transform animate-scaleIn">
                <div class="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                    <h3 class="text-xl font-black text-SLATE-900 flex items-center gap-2">
                        <svg class="w-6 h-6 text-SLATE-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"></path></svg>
                        Add Custom Item
                    </h3>
                    <button type="button" id="close-custom-item-btn" class="text-slate-400 hover:text-red-500 transition-colors bg-slate-50 hover:bg-red-50 p-2 rounded-full">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                <div class="space-y-4 mb-6">
                    <div>
                        <label class="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1">Item Name</label>
                        <input type="text" id="custom-item-name" value="Other" class="w-full border-2 border-slate-200 rounded-xl p-3 text-sm font-bold text-slate-800 focus:border-SLATE-500 outline-none transition-colors shadow-inner bg-slate-50 focus:bg-white" onfocus="this.select()">
                    </div>
                    <div class="flex gap-3">
                        <div class="flex-1">
                            <label class="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1">Price</label>
                            <div class="relative">
                                <span class="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400">${currencySymbol}</span>
                                <input type="number" id="custom-item-price" placeholder="0.00" min="0" step="0.01" class="w-full pl-7 border-2 border-slate-200 rounded-xl p-3 text-lg font-black text-SLATE-700 focus:border-SLATE-500 outline-none transition-colors shadow-inner bg-slate-50 focus:bg-white">
                            </div>
                        </div>
                        <div class="w-1/3">
                            <label class="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1">Qty</label>
                            <input type="number" id="custom-item-qty" value="${defaultQty}" step="0.01" class="w-full border-2 border-slate-200 rounded-xl p-3 text-lg font-black text-slate-800 text-center focus:border-SLATE-500 outline-none transition-colors shadow-inner bg-slate-50 focus:bg-white">
                            </div>
                    </div>
                </div>

                <div class="flex justify-end gap-3 pt-2 border-t border-slate-100">
                    <button id="cancel-custom-item" class="flex-1 px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-colors">Cancel</button>
                    <button id="confirm-custom-item" class="flex-[1.5] px-5 py-3.5 bg-SLATE-600 hover:bg-SLATE-700 text-white font-black rounded-xl shadow-lg shadow-SLATE-200 transition-all active:scale-95">Add to Cart</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    const modal = document.getElementById(modalId);
    const nameInput = document.getElementById('custom-item-name');
    const priceInput = document.getElementById('custom-item-price');
    const qtyInput = document.getElementById('custom-item-qty');
    const confirmBtn = document.getElementById('confirm-custom-item');

    // Focus price input automatically since name defaults to "Other"
    setTimeout(() => { priceInput.focus(); }, 50);

    const cleanup = () => {
        modal.classList.add('opacity-0');
        setTimeout(() => modal.remove(), 200);
        if (DOM.pos && DOM.pos.manualInput) DOM.pos.manualInput.focus();
    };

    document.getElementById('close-custom-item-btn').onclick = cleanup;
    document.getElementById('cancel-custom-item').onclick = cleanup;

    const submitCustomItem = () => {
        const name = nameInput.value.trim() || 'Other';
        const price = parseFloat(priceInput.value);
        const qty = parseFloat(qtyInput.value) || 1;

        if (isNaN(price) || price <= 0) {
            priceInput.classList.add('border-red-500', 'bg-red-50');
            setTimeout(() => priceInput.classList.remove('border-red-500', 'bg-red-50'), 500);
            if (typeof showToast === 'function') showToast('Invalid Price', 'Please enter a valid amount.', 'error');
            return;
        }

        const customId = `CUSTOM-${Date.now()}`;
        const customProduct = {
            id: customId,
            name: name,
            sku: 'MANUAL',
            barcode: '',
            mrp: price,
            price: price,
            cost: 0, // No cost tracking for custom items
            stockLevel: 9999, // Infinite stock so it doesn't throw warnings
            taxRate: 0,
            cess: 0,
            type: 'standard',
            locationId: typeof activePosContainerId !== 'undefined' ? activePosContainerId : 'main'
        };

        // Add to local cache so the Checkout loop validator accepts it
        if (typeof localProductIndex !== 'undefined') {
            localProductIndex.push(customProduct);
        }

        // Add to cart directly
        if (typeof addProductToCart === 'function') {
            addProductToCart(customId, customProduct, qty);
        }

        if (DOM.pos && DOM.pos.quantityInput) DOM.pos.quantityInput.value = '1';

        cleanup();
    };

    confirmBtn.onclick = submitCustomItem;

    priceInput.onkeydown = (e) => { if (e.key === 'Enter') submitCustomItem(); };
    qtyInput.onkeydown = (e) => { if (e.key === 'Enter') submitCustomItem(); };
    nameInput.onkeydown = (e) => { if (e.key === 'Enter') priceInput.focus(); };
};

function handleCustomerNameInput(e) {
    // Real-time lookup
}

// ============================================================================
// 🚀 DYNAMIC B2B RATE APPLIER
// ============================================================================
function applyB2BRatesToCart(customer) {
    const currentCart = typeof getCurrentCart === 'function' ? getCurrentCart() : [];
    if (!currentCart || currentCart.length === 0) return;

    let hasChanges = false;
    const updatedCart = currentCart.map(item => {
        // Find the original base selling price from the global inventory
        const originalProd = localProductIndex.find(p => p.id === item.id);
        const basePrice = originalProd ? parseFloat(originalProd.price || 0) : parseFloat(item.mrp || item.price || 0);

        let newPrice = basePrice;

        // Override with custom B2B rate if it exists in the customer's dictionary
        if (customer && customer.customPricing && customer.customPricing[item.id]) {
            newPrice = parseFloat(customer.customPricing[item.id].price);
        }

        if (newPrice !== parseFloat(item.price)) {
            hasChanges = true;
            return { ...item, price: newPrice };
        }
        return item;
    });

    if (hasChanges) {
        setCurrentCart(updatedCart);
        persistCart();
        renderCart(); // Force UI update

        if (customer) {
            if (typeof showToast === 'function') showToast('B2B Rates Applied', `Cart prices updated for ${customer.name}.`, 'info');
        } else {
            if (typeof showToast === 'function') showToast('Rates Reverted', `Restored standard store pricing.`, 'info');
        }
    }
}

// --- REPLACE IN src/components/pos.js ---

async function refreshCustomerIndex() {
    try {
        if (!window.dbAPI || !window.dbAPI.getCustomers) {
            console.warn("Offline Database not ready.");
            return;
        }

        const customers = await window.dbAPI.getCustomers();

        // 🚀 THE FIX: Populate local cache from SQLite, filtering out system docs
        localCustomerIndex = customers.filter(c => {
            const cid = c.id || c.docId || '';
            if (c.role !== undefined) return false; // Hide Staff
            if (cid.includes('_att_') || cid.includes('shifts_') || cid.startsWith('helper_') || cid.startsWith('staff_') || cid.startsWith('user_')) return false;
            return true;
        });

        populateCustomerDatalists();
    } catch (e) {
        console.warn("POS: Local customer fetch failed", e);
    }
}

export async function handleCustomerIdLookup(e) {
    const id = e.target.value.trim();
    if (!id) return resetCustomerPosState();

    const localMatch = localCustomerIndex.find(c =>
        c.id === id || c.merchantId === id || c.docId === id || c.nfcCardId === id || c.cardNumber === id
    );

    if (localMatch) return applyCustomerPosState(localMatch);

    try {
        if (window.dbAPI && window.dbAPI.getDoc) {
            const data = await window.dbAPI.getDoc('customers', id);
            if (data) applyCustomerPosState(data);
        }
    } catch (error) { console.error("Lookup error:", error); }
}

export async function handleCustomerNameLookup(e) {
    const name = e.target.value.trim();
    if (!name) return resetCustomerPosState();

    const match = localCustomerIndex.find(c => c.name === name);
    if (match) applyCustomerPosState(match);
}



function promptForSplitPayment(total) {
    return new Promise((resolve) => {
        const existing = document.getElementById('split-pay-modal');
        if (existing) existing.remove();

        const currencySymbol = getCurrencySymbol();

        const modalHtml = `
            <div id="split-pay-modal" class="fixed inset-0 bg-gray-900/60   flex items-center justify-center z-[80] ">
                <div class="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full  border border-gray-100 transform scale-100">
                    <div class="flex justify-between items-center mb-4 border-b pb-3">
                        <h3 class="text-xl font-bold text-gray-800">Split Payment</h3>
                        <div class="text-sm bg-SLATE-100 text-SLATE-700 px-2 py-1 rounded font-bold uppercase tracking-wider">Options</div>
                    </div>
                    
                    <div class="bg-SLATE-50 p-4 rounded-xl mb-6 text-center border border-SLATE-100">
                         <span class="text-xs text-SLATE-500 uppercase font-bold tracking-wider">Total Due</span>
                         <p class="text-3xl font-bold text-SLATE-700 mt-1">${currencySymbol}${total.toFixed(2)}</p>
                    </div>
                    
                    <div class="space-y-4 mb-6">
                        <div class="flex items-center gap-3">
                            <span class="w-12 text-2xl flex justify-center"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg></span>
                            <div class="flex-1">
                                <label class="text-xs text-gray-500 font-semibold uppercase">Cash</label>
                                <input type="number" id="split-cash" class="split-input w-full border border-gray-300 p-2 rounded-lg text-right font-medium focus:ring-2 focus:ring-SLATE-500 focus:border-SLATE-500 outline-none transition-all" placeholder="0.00">
                            </div>
                        </div>
                        <div class="flex items-center gap-3">
                            <span class="w-12 text-2xl flex justify-center"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg></span>
                             <div class="flex-1">
                                <label class="text-xs text-gray-500 font-semibold uppercase">Card</label>
                                <input type="number" id="split-card" class="split-input w-full border border-gray-300 p-2 rounded-lg text-right font-medium focus:ring-2 focus:ring-SLATE-500 focus:border-SLATE-500 outline-none transition-all" placeholder="0.00">
                            </div>
                        </div>
                        <div class="flex items-center gap-3">
                            <span class="w-12 text-2xl flex justify-center"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg></span>
                             <div class="flex-1">
                                <label class="text-xs text-gray-500 font-semibold uppercase">UPI</label>
                                <input type="number" id="split-upi" class="split-input w-full border border-gray-300 p-2 rounded-lg text-right font-medium focus:ring-2 focus:ring-SLATE-500 focus:border-SLATE-500 outline-none transition-all" placeholder="0.00">
                            </div>
                        </div>
                        <div class="flex items-center gap-3">
                            <span class="w-12 text-2xl flex justify-center"><svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg></span>
                             <div class="flex-1">
                                <label class="text-xs text-gray-500 font-semibold uppercase">Credit (Udhaar)</label>
                                <input type="number" id="split-credit" class="split-input w-full border border-gray-300 p-2 rounded-lg text-right font-medium focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all" placeholder="0.00">
                            </div>
                        </div>
                        
                        <div class="flex justify-between items-center text-sm pt-4 border-t mt-2">
                            <span class="text-gray-500 font-medium">Remaining Amount:</span>
                            <span id="split-remaining" class="font-bold text-lg text-red-500 transition-colors duration-300">${total.toFixed(2)}</span>
                        </div>
                    </div>

                    <div class="flex justify-end gap-3">
                        <button id="split-cancel" class="px-5 py-2.5 bg-white border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 font-bold transition">Cancel</button>
                        <button id="split-confirm" class="px-5 py-2.5 bg-SLATE-600 text-white rounded-xl hover:bg-SLATE-700 font-bold shadow-lg shadow-SLATE-200 disabled:opacity-50 disabled:shadow-none transition" disabled>Confirm Split</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById('split-pay-modal');
        const inputs = modal.querySelectorAll('.split-input');
        const remainEl = document.getElementById('split-remaining');
        const confirmBtn = document.getElementById('split-confirm');

        setTimeout(() => document.getElementById('split-cash').focus(), 50);

        const updateCalc = () => {
            let sum = 0;
            inputs.forEach(i => sum += parseFloat(i.value || 0));

            const rem = typeof safeMath?.subtract === 'function' ? safeMath.subtract(total, sum) : total - sum;
            remainEl.textContent = rem.toFixed(2);

            if (Math.abs(rem) < 0.1) {
                remainEl.className = "font-bold text-lg text-green-600";
                remainEl.textContent = "Balanced ✓";
                confirmBtn.disabled = false;
            } else {
                remainEl.className = "font-bold text-lg text-red-500";
                confirmBtn.disabled = true;
            }
        };

        inputs.forEach(i => i.addEventListener('input', updateCalc));

        document.getElementById('split-cancel').onclick = () => { modal.remove(); resolve(null); };
        confirmBtn.onclick = () => {
            const result = {
                cash: parseFloat(document.getElementById('split-cash').value || 0),
                card: parseFloat(document.getElementById('split-card').value || 0),
                upi: parseFloat(document.getElementById('split-upi').value || 0),
                credit: parseFloat(document.getElementById('split-credit').value || 0) // Extracts the Credit
            };
            modal.remove();
            resolve(result);
        };
    });
}
function promptForInput(title, message, defaultValue = '') {
    return new Promise((resolve) => {
        const existing = document.getElementById('custom-prompt-modal');
        if (existing) existing.remove();

        const modalHtml = `
            <div id="custom-prompt-modal" class="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-[90]">
                <div class="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full  border border-gray-100">
                    <h3 class="text-xl font-bold text-gray-800 mb-2">${escapeHTML(title)}</h3>
                    <p class="text-sm text-gray-600 mb-5 whitespace-pre-wrap leading-relaxed">${escapeHTML(message)}</p>
                    <input type="text" id="custom-prompt-input" value="${escapeHTML(defaultValue)}" class="w-full border-2 border-SLATE-100 bg-SLATE-50/30 p-3 rounded-xl mb-6 text-lg focus:outline-none focus:border-SLATE-500 focus:bg-white transition-all shadow-inner">
                    <div class="flex justify-end space-x-3">
                        <button id="custom-prompt-cancel" class="px-5 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-600 font-bold hover:bg-gray-50 transition">Cancel</button>
                        <button id="custom-prompt-confirm" class="px-5 py-2.5 bg-SLATE-600 text-white rounded-xl font-bold hover:bg-SLATE-700 shadow-lg shadow-SLATE-200 transition">Confirm</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById('custom-prompt-modal');
        const input = document.getElementById('custom-prompt-input');

        input.select();
        input.focus();

        document.getElementById('custom-prompt-cancel').onclick = () => { modal.remove(); resolve(null); };
        document.getElementById('custom-prompt-confirm').onclick = () => { modal.remove(); resolve(input.value.trim()); };

        input.onkeydown = (e) => {
            if (e.key === 'Enter') document.getElementById('custom-prompt-confirm').click();
            if (e.key === 'Escape') document.getElementById('custom-prompt-cancel').click();
        };
    });
}

function addProductToCart(id, product, qty) {
    if (typeof getExpirationStatus === 'function' && getExpirationStatus(product.expirationDate) === 'expired') {
        showModal('Expired Product', `Cannot sell **${product.name}** as it has expired on ${product.expirationDate}.`, 'error');
        return;
    }

    const currentCart = getCurrentCart();
    const existingIndex = currentCart.findIndex(item => item.id === id);
    const currentQtyInCart = existingIndex > -1 ? currentCart[existingIndex].quantity : 0;

    // 🚀 THE FIX: Only block if we are SELLING (qty > 0) more than we have. Returns (qty < 0) are always allowed.
    if (qty > 0 && (product.stockLevel || 0) < (currentQtyInCart + qty)) {
        if (typeof showToast === 'function') {
            showToast('Stock Error', `${product.name}: Only ${product.stockLevel || 0} left`, 'error');
        }
        const input = DOM.pos.manualInput || document.getElementById('pos-manual-input');
        if (input) {
            input.classList.add('animate-shake', 'border-red-500', 'ring-red-200');
            setTimeout(() => input.classList.remove('animate-shake', 'border-red-500', 'ring-red-200'), 500);
        }
        return;
    }

    // 🚀 THE FIX: EXTRACT ACTIVE SELLING BATCH (FEFO / FIFO)
    let activeBatch = null;
    if (Array.isArray(product.batches) && product.batches.length > 0) {
        const todayTime = new Date().setHours(0, 0, 0, 0);

        // Filter out expired quarantine stock, then sort by Earliest Expiry
        const sellableBatches = product.batches.filter(b => {
            if (!b.expirationDate) return true;
            return new Date(b.expirationDate).getTime() >= todayTime;
        }).filter(b => parseFloat(b.qty) > 0);

        if (sellableBatches.length > 0) {
            sellableBatches.sort((a, b) => {
                const hasExpA = Boolean(a.expirationDate);
                const hasExpB = Boolean(b.expirationDate);
                if (hasExpA && hasExpB) return new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime();
                if (hasExpA) return -1;
                if (hasExpB) return 1;
                return (a.timestamp || 0) - (b.timestamp || 0);
            });
            activeBatch = sellableBatches[0];
        }
    }

    // 🚀 THE FIX: Pull ALL details strictly from the Active Batch
    let basePrice = activeBatch?.price !== undefined && activeBatch?.price !== null ? activeBatch.price : product.price;
    let baseCost = activeBatch?.cost !== undefined && activeBatch?.cost !== null ? activeBatch.cost : product.cost;
    let baseMrp = activeBatch?.mrp !== undefined && activeBatch?.mrp !== null ? activeBatch.mrp : (product.mrp || basePrice);

    let batchNo = activeBatch?.batchNo || activeBatch?.batch || product.batch || product.batchNo || '-';
    let mfd = activeBatch?.date || activeBatch?.packagedDate || activeBatch?.mfgDate || product.mfgDate || product.packagedDate || '-';
    let expiry = activeBatch?.expirationDate || activeBatch?.expiry || product.expirationDate || product.expiry || '-';

    let finalPrice = parseFloat(basePrice) || 0;

    // B2B Override Check
    const customerId = DOM.pos.customer.id ? DOM.pos.customer.id.value.trim() : null;
    if (customerId) {
        const activeCustomer = localCustomerIndex.find(c => c.id === customerId || c.merchantId === customerId);
        if (activeCustomer && activeCustomer.customPricing && activeCustomer.customPricing[id]) {
            finalPrice = parseFloat(activeCustomer.customPricing[id].price);
            if (typeof showToast === 'function') {
                showToast('Special Rate Applied', `${activeCustomer.name} gets ${product.name} for ₹${finalPrice.toFixed(2)}`, 'info');
            }
        }
    }

    if (existingIndex > -1) {
        const updatedCart = [...currentCart];
        updatedCart[existingIndex] = {
            ...updatedCart[existingIndex],
            quantity: updatedCart[existingIndex].quantity + qty
        };
        setCurrentCart(updatedCart);
    } else {
        addToCart({
            id: id,
            name: product.name,
            sku: product.sku || product.barcode || '',
            originalPrice: basePrice, // Protects the batch rate from being wiped during B2B toggling
            mrp: parseFloat(baseMrp) || 0,
            price: finalPrice,
            cost: parseFloat(baseCost) || 0,
            quantity: qty,
            stock: product.stockLevel || 0,
            taxRate: product.gstSlab || product.taxRate || 0,
            cess: product.cess || 0,
            type: product.type || 'standard',
            bundleComponents: product.bundleComponents || [],
            // Pass Active Metadata to Cart
            hsn: product.hsn || product.hsnCode || '-',
            batch: batchNo,
            mfd: mfd,
            expiry: expiry
        });
    }
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (row) {
        row.classList.add('bg-emerald-100');
        setTimeout(() => row.classList.remove('bg-emerald-100'), 300);
    }
    persistCart();
    renderCart();
}

function removeFromCart(id) {
    const currentCart = getCurrentCart();
    const newCart = currentCart.filter(item => item.id !== id);
    setCurrentCart(newCart);
    persistCart();
    renderCart();

    // 🚀 THE FIX: Tell the visual grid to instantly recalculate!
    if (typeof updateVisualGridStock === 'function') {
        updateVisualGridStock();
    }
    if (isVisualGridEnabled) {
        const searchInput = DOM.pos.manualInput;
        renderVisualPosGrid(searchInput ? searchInput.value.trim() : '');
    }

}

function handleQtyChange(id, newQty, skipRender = false) {
    const currentCart = getCurrentCart();
    const index = currentCart.findIndex(i => i.id === id);
    if (index > -1) {
        const item = currentCart[index];

        // 🚀 THE FIX: Allow negative quantities for instant POS returns
        const requestedQty = parseFloat(newQty) || 0;

        if (requestedQty === 0) {
            removeFromCart(id);
            return;
        }

        // Only block if we are SELLING more than we have in stock
        if (requestedQty > 0 && requestedQty > item.stock) {
            if (typeof showToast === 'function') showToast('Limit Reached', `Max stock for ${item.name} is ${item.stock}`, 'warning');
            if (!skipRender) renderCart();
            return;
        }

        const updatedCart = [...currentCart];
        updatedCart[index] = { ...updatedCart[index], quantity: requestedQty };
        setCurrentCart(updatedCart);
        persistCart();

        if (skipRender) {
            updateCartSummary();
            const row = document.querySelector(`tr[data-id="${id}"]`);
            if (row) {
                const totalCell = row.querySelector('.row-total-cell');
                if (totalCell) totalCell.textContent = ((parseFloat(item.price) || 0) * requestedQty).toFixed(2);
            }
        } else {
            renderCart();
        }

        if (typeof updateVisualGridStock === 'function') updateVisualGridStock();
    }
}

function handlePriceChange(id, newPrice, skipRender = false) {
    // 🚀 THE FIX: Removed Plan Restriction. Anyone can edit prices!
    const currentCart = getCurrentCart();
    const index = currentCart.findIndex(i => i.id === id);
    if (index > -1) {
        const updatedCart = [...currentCart];
        updatedCart[index] = { ...updatedCart[index], price: parseFloat(newPrice) || 0 };
        setCurrentCart(updatedCart);
        persistCart();

        if (skipRender) {
            updateCartSummary();
            const row = document.querySelector(`tr[data-id="${id}"]`);
            if (row) {
                const totalCell = row.querySelector('.row-total-cell');
                if (totalCell) totalCell.textContent = ((parseFloat(newPrice) || 0) * updatedCart[index].quantity).toFixed(2);
            }
        } else {
            renderCart();
        }
    }
}
function calculateTotals() {
    let subtotal = 0;
    let totalCost = 0;
    let includedGst = 0;
    let includedCess = 0;
    let itemSavings = 0;
    const currentCart = getCurrentCart();

    const isMathReady = typeof safeMath?.multiply === 'function';

    currentCart.forEach(item => {
        const lineTotal = isMathReady ? safeMath.multiply(item.price, item.quantity) : (item.price * item.quantity);
        const lineCost = isMathReady ? safeMath.multiply(item.cost || 0, item.quantity) : ((item.cost || 0) * item.quantity);

        subtotal = isMathReady ? safeMath.add(subtotal, lineTotal) : subtotal + lineTotal;
        totalCost = isMathReady ? safeMath.add(totalCost, lineCost) : totalCost + lineCost;

        const itemMrp = parseFloat(item.mrp || item.price || 0);
        if (itemMrp > item.price) {
            const savingsOnThisItem = (itemMrp - item.price) * item.quantity;
            itemSavings = isMathReady ? safeMath.add(itemSavings, savingsOnThisItem) : itemSavings + savingsOnThisItem;
        }

        const itemGstRate = parseFloat(item.taxRate || item.gstSlab || 0);
        const itemCessRate = parseFloat(item.cess || 0);

        if (itemGstRate > 0 || itemCessRate > 0) {
            const combinedRate = itemGstRate + itemCessRate;
            const basePrice = lineTotal / (1 + (combinedRate / 100));

            const gstAmount = basePrice * (itemGstRate / 100);
            const cessAmount = basePrice * (itemCessRate / 100);

            includedGst = isMathReady ? safeMath.add(includedGst, gstAmount) : includedGst + gstAmount;
            includedCess = isMathReady ? safeMath.add(includedCess, cessAmount) : includedCess + cessAmount;
        }
    });

    const discountInput = DOM.pos.totals.discount;
    const discountVal = parseFloat(discountInput ? discountInput.value : 0) || 0;

    const netSubtotal = isMathReady ? safeMath.subtract(subtotal, discountVal) : subtotal - discountVal;

    const feePercentage = getConvenienceFee() || 0;
    const feeVal = isMathReady ? safeMath.multiply(netSubtotal, feePercentage / 100) : netSubtotal * (feePercentage / 100);

    // 🚀 THE FIX: Isolate the Cart Goods Total vs the Final Payable Total
    let cartTotal = isMathReady ? safeMath.add(netSubtotal, feeVal) : netSubtotal + feeVal;
    cartTotal = Math.max(0, cartTotal);

    // The Final Total includes the goods PLUS whatever dues they are paying right now
    const total = isMathReady ? safeMath.add(cartTotal, stagedDuesPayment) : cartTotal + stagedDuesPayment;

    const profit = isMathReady ? safeMath.subtract(netSubtotal, totalCost) : netSubtotal - totalCost;

    return {
        subtotal, tax: includedGst, cess: includedCess,
        total, cartTotal, // <-- Exposing both totals
        discount: discountVal, fee: feeVal, dues: currentCustomerDues,
        totalCost, profit, itemSavings
    };
}

export function updateCartSummary() {
    const { subtotal, tax, cess, total, fee, dues, itemSavings } = calculateTotals();
    const currencySymbol = getCurrencySymbol();

    const t = DOM.pos.totals;
    if (t.sub) t.sub.textContent = `${currencySymbol}${subtotal.toFixed(2)}`;
    if (t.tax) t.tax.textContent = `${currencySymbol}${tax.toFixed(2)}`;
    if (t.fee) t.fee.textContent = `${currencySymbol}${fee.toFixed(2)}`;
    if (t.final) t.final.textContent = `${currencySymbol}${total.toFixed(2)}`;

    let savingsRow = document.getElementById('pos-savings-summary-row');
    if (itemSavings > 0) {
        if (!savingsRow && t.sub) {
            const subRow = t.sub.closest('.flex');
            savingsRow = document.createElement('div');
            savingsRow.id = 'pos-savings-summary-row';
            savingsRow.className = "flex justify-between text-sm text-green-600 font-bold mb-2 pt-1  ";
            savingsRow.innerHTML = `<span>Product Savings (MRP):</span><span id="pos-summary-savings-val">-${currencySymbol}${itemSavings.toFixed(2)}</span>`;
            subRow.parentNode.insertBefore(savingsRow, subRow.nextSibling);
        } else if (savingsRow) {
            document.getElementById('pos-summary-savings-val').textContent = `-${currencySymbol}${itemSavings.toFixed(2)}`;
        }
    } else if (savingsRow) {
        savingsRow.remove();
    }

    let cessRow = document.getElementById('pos-cess-summary-row');
    if (cess > 0) {
        if (!cessRow && t.tax) {
            const taxRow = t.tax.closest('.flex');
            cessRow = document.createElement('div');
            cessRow.id = 'pos-cess-summary-row';
            cessRow.className = "flex justify-between text-sm text-gray-500 font-medium mb-2  ";
            cessRow.innerHTML = `<span>Included Cess:</span><span id="pos-summary-cess-val">${currencySymbol}${cess.toFixed(2)}</span>`;
            taxRow.parentNode.insertBefore(cessRow, taxRow.nextSibling);
        } else if (cessRow) {
            document.getElementById('pos-summary-cess-val').textContent = `${currencySymbol}${cess.toFixed(2)}`;
        }
    } else if (cessRow) {
        cessRow.remove();
    }

    // 🚀 THE FIX: Independent "Pay Now" Row
    let duesRow = document.getElementById('pos-dues-summary-row');
    if (dues !== 0) {
        const duesHtml = `
            <div class="flex flex-col w-full">
                <div class="flex justify-between items-center w-full">
                    <span>${dues > 0 ? 'Pending Dues:' : 'Advance Balance:'}</span>
                    <div class="flex items-center gap-3">
                        <span id="pos-summary-dues-val">${dues > 0 ? '' : '-'}${currencySymbol}${Math.abs(dues).toFixed(2)}</span>
                        <button type="button" onclick="window.promptPosDuesPayment()" class="bg-${dues > 0 ? 'red' : 'emerald'}-100 text-${dues > 0 ? 'red' : 'emerald'}-700 hover:bg-${dues > 0 ? 'red' : 'emerald'}-200 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-colors shadow-sm active:scale-95">
                            ${dues > 0 ? 'Pay Now' : 'Refund'}
                        </button>
                    </div>
                </div>
            </div>
        `;
        if (!duesRow) {
            const feeRow = t.fee ? t.fee.closest('.flex') : null;
            if (feeRow) {
                duesRow = document.createElement('div');
                duesRow.id = 'pos-dues-summary-row';
                duesRow.className = `flex justify-between text-sm font-bold mb-3 pb-2 border-b border-dashed border-slate-200   ${dues > 0 ? 'text-red-600' : 'text-emerald-600'}`;
                duesRow.innerHTML = duesHtml;
                feeRow.parentNode.insertBefore(duesRow, feeRow.nextSibling);
            }
        } else {
            duesRow.className = `flex justify-between text-sm font-bold mb-3 pb-2 border-b border-dashed border-slate-200   ${dues > 0 ? 'text-red-600' : 'text-emerald-600'}`;
            duesRow.innerHTML = duesHtml;
        }
    } else if (duesRow) {
        duesRow.remove();
    }

    // 🚀 THE FIX: Show the currently staged dues payment on the bill
    let stagedRow = document.getElementById('pos-staged-dues-row');
    if (stagedDuesPayment > 0) {
        const stagedHtml = `
            <span>Settling Past Dues:</span>
            <div class="flex items-center gap-2">
                <span class="font-mono text-slate-700 font-black">+${currencySymbol}${stagedDuesPayment.toFixed(2)}</span>
                <button type="button" onclick="window.clearStagedDues()" class="text-red-400 hover:text-red-600 transition-colors p-1" title="Remove Dues Payment">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        `;
        if (!stagedRow && t.fee) {
            const feeRow = t.fee.closest('.flex');
            stagedRow = document.createElement('div');
            stagedRow.id = 'pos-staged-dues-row';
            stagedRow.className = "flex justify-between items-center text-sm text-SLATE-700 bg-SLATE-50 border border-SLATE-100 px-3 py-2 rounded-lg font-bold mb-2 mt-2 shadow-sm  ";
            stagedRow.innerHTML = stagedHtml;
            feeRow.parentNode.insertBefore(stagedRow, feeRow.nextSibling);
        } else if (stagedRow) {
            stagedRow.innerHTML = stagedHtml;
        }
    } else if (stagedRow) {
        stagedRow.remove();
    }

    const badge = document.getElementById('cart-item-count-badge');
    if (badge) {
        const cart = getCurrentCart();
        const count = cart.length;
        badge.textContent = `${count} Item${count !== 1 ? 's' : ''}`;
    }

    const customerId = DOM.pos.customer.id ? DOM.pos.customer.id.value.trim() : null;
    const loyaltyBadgeContainer = document.getElementById('pos-loyalty-container');

    if (customerId && customerId !== 'WALK-IN') {
        const activeCustomer = localCustomerIndex.find(c => c.id === customerId || c.merchantId === customerId);
        const baseTokens = activeCustomer ? (activeCustomer.loyaltyPoints || activeCustomer.loyaltyTokens || 0) : 0;
        const pendingDeduction = window.__pendingTokenDeduction || 0;
        const tokens = Math.max(0, baseTokens - pendingDeduction);

        if (tokens > 0) {
            if (!loyaltyBadgeContainer && DOM.pos.totals.sub) {
                const container = document.createElement('div');
                container.id = 'pos-loyalty-container';
                container.className = "flex justify-between items-center text-sm font-bold mb-3 pt-3 border-t border-dashed border-gray-200  ";
                container.innerHTML = `
                    <span class="text-yellow-600 flex items-center gap-1">Available Tokens: ${tokens}</span>
                    <button onclick="window.triggerTokenRedemption(${tokens})" class="bg-yellow-100 text-yellow-700 hover:bg-yellow-200 px-3 py-1 rounded text-xs transition-colors">Redeem</button>
                `;
                DOM.pos.totals.sub.closest('.flex').parentNode.insertBefore(container, DOM.pos.totals.sub.closest('.flex'));
            } else if (loyaltyBadgeContainer) {
                loyaltyBadgeContainer.querySelector('span').innerHTML = ` Available Tokens: ${tokens}`;
                loyaltyBadgeContainer.querySelector('button').setAttribute('onclick', `window.triggerTokenRedemption(${tokens})`);
            }
        } else if (loyaltyBadgeContainer) {
            loyaltyBadgeContainer.remove();
        }
    } else if (loyaltyBadgeContainer) {
        loyaltyBadgeContainer.remove();
    }

    const plan = normalizePlan(typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free');
    updateParkedIndicator(plan);
    if (typeof window.updateCashChange === 'function') window.updateCashChange();
}

// 🚀 POS-Specific Dues Prompt
window.promptPosDuesPayment = function () {
    if (currentCustomerDues <= 0) return;

    const absBalance = Math.abs(currentCustomerDues);
    const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';
    const modalId = 'pos-dues-prompt-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();

    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[300] bg-slate-900/60 flex items-center justify-center p-4  ">
            <div class="bg-white rounded-3xl shadow-2xl w-full max-w-sm border border-slate-100 overflow-hidden text-center">
                <div class="bg-red-50 p-6 border-b border-red-100">
                    <div class="w-12 h-12 bg-white text-red-500 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border border-red-100">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <h3 class="text-lg font-black text-red-800">Settle Past Dues</h3>
                    <p class="text-sm font-medium text-red-600 mt-1">Pending: ${currency}${absBalance.toFixed(2)}</p>
                </div>
                <div class="p-6">
                    <label class="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">Amount paying right now</label>
                    <input type="number" id="pos-staged-dues-input" value="${absBalance.toFixed(2)}" max="${absBalance}" min="0.01" step="0.01" class="w-full text-center text-3xl font-black text-slate-800 border-2 border-slate-200 rounded-xl p-4 focus:ring-4 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all shadow-inner mb-6">
                    
                    <div class="flex gap-3">
                        <button onclick="document.getElementById('${modalId}').remove()" class="flex-1 py-3.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors">Cancel</button>
                        <button id="pos-staged-dues-confirm" class="flex-1 py-3.5 bg-red-600 text-white font-black rounded-xl hover:bg-red-700 shadow-lg shadow-red-200 transition-colors active:scale-95 transform">Add to Bill</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);

    const input = document.getElementById('pos-staged-dues-input');
    input.select();
    input.focus();

    document.getElementById('pos-staged-dues-confirm').onclick = () => {
        const val = parseFloat(input.value);
        if (isNaN(val) || val <= 0) return alert("Enter a valid amount");
        if (val > absBalance) return alert("Cannot pay more than pending dues!");

        stagedDuesPayment = val;
        updateCartSummary();
        document.getElementById(modalId).remove();
    };
};

window.clearStagedDues = function () {
    stagedDuesPayment = 0;
    updateCartSummary();
};



// --- High-Performance State ---
const cartNodeMap = new Map();

function renderCart() {
    if (!DOM.pos.cartBody) return;
    const currentCart = getCurrentCart();

    // 🚀 THE FIX: Dynamically set the table header to exactly 6 columns
    const theadRow = DOM.pos.cartBody.previousElementSibling?.querySelector('tr');
    if (theadRow && !theadRow.dataset.headersUpdated) {
        theadRow.dataset.headersUpdated = 'true';
        theadRow.innerHTML = `
            <th class="px-4 py-3.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Product</th>
            <th class="px-4 py-3.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">SKU</th>
            <th class="px-4 py-3.5 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Unit Price</th>
            <th class="px-4 py-3.5 text-center text-[10px] font-black text-slate-500 uppercase tracking-widest">Qty</th>
            <th class="px-4 py-3.5 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Subtotal</th>
            <th class="px-4 py-3.5 text-center text-[10px] font-black text-slate-500 uppercase tracking-widest">Act</th>
        `;
    }

    if (currentCart.length === 0) {
        cartNodeMap.clear();
        DOM.pos.cartBody.innerHTML = `
            <tr>
                <td colspan="6" class="py-20 text-center opacity-60">
                    <div class="flex flex-col items-center">
                        <svg class="h-12 w-12 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
                        <h4 class="text-gray-900 font-medium">Cart is empty</h4>
                    </div>
                </td>
            </tr>`;
        updateCartSummary();

        if (typeof updateVisualGridStock === 'function') updateVisualGridStock();
        return;
    }

    if (cartNodeMap.size === 0) DOM.pos.cartBody.innerHTML = '';

    const fragment = document.createDocumentFragment();
    const currentIds = new Set(currentCart.map(item => item.id));

    for (const [id, node] of cartNodeMap.entries()) {
        if (!currentIds.has(id)) {
            node.remove();
            cartNodeMap.delete(id);
        }
    }

    currentCart.forEach(item => {
        if (cartNodeMap.has(item.id)) {
            const row = cartNodeMap.get(item.id);
            const qtyInput = row.querySelector('.qty-input');
            const totalCell = row.querySelector('.row-total-cell');
            const priceInput = row.querySelector('.price-input');

            if (qtyInput && parseFloat(qtyInput.value) !== item.quantity) qtyInput.value = item.quantity;
            if (priceInput && parseFloat(priceInput.value) !== item.price) priceInput.value = (item.price || 0).toFixed(2);
            if (totalCell) totalCell.textContent = ((item.price || 0) * item.quantity).toFixed(2);

        } else {
            const row = document.createElement('tr');
            row.className = "border-b border-gray-100 hover:bg-SLATE-50/30 transition-colors  ";
            row.dataset.id = item.id;

            row.innerHTML = `
                <td class="px-4 py-3 text-sm text-gray-800"><div class="font-bold">${escapeHTML(item.name)}</div></td>
                <td class="px-4 py-3 text-sm text-gray-500 font-mono">${escapeHTML(item.sku || '-')}</td>
                <td class="px-4 py-3 text-right">
                    <input type="number" class="price-input w-24 border border-SLATE-200 bg-SLATE-50 text-SLATE-900 font-bold rounded-md px-2 py-1.5 text-right text-sm focus:border-SLATE-500 focus:bg-white outline-none transition-colors" data-id="${item.id}" value="${(item.price || 0).toFixed(2)}" step="0.01">
                </td>
                <td class="px-4 py-3 text-center">
                    <input type="number" class="qty-input w-20 border border-gray-200 rounded-md py-1.5 text-center text-sm font-bold text-SLATE-700" data-id="${item.id}" value="${item.quantity}" step="0.01">
                </td>
                <td class="px-4 py-3 text-right font-bold text-gray-900 text-sm row-total-cell">${((item.price || 0) * item.quantity).toFixed(2)}</td>
                <td class="px-4 py-3 text-center">
                    <button class="remove-item-btn text-gray-300 hover:text-red-500 p-2" data-id="${item.id}"><svg class="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </td>
            `;
            cartNodeMap.set(item.id, row);
            fragment.appendChild(row);
        }
    });

    DOM.pos.cartBody.appendChild(fragment);
    updateCartSummary();

    if (typeof updateVisualGridStock === 'function') updateVisualGridStock();
}

function injectPosLocationSelector() {
    const role = typeof getUserRole === 'function' ? getUserRole() : 'manager';
    const plan = normalizePlan(typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free');
    const hasMultiLoc = checkPlanLimits(plan, 'multi_location');

    if ((role !== 'admin' && role !== 'accountant') || !hasMultiLoc) return;

    const section = DOM.pos.section || document.getElementById('pos');
    if (!section || document.getElementById('pos-location-selector-container')) return;

    const availLocs = typeof getAvailableLocations === 'function' ? getAvailableLocations() : [];
    let optionsHtml = '';
    if (availLocs && availLocs.length > 0) {
        optionsHtml = availLocs.map(loc =>
            `<option value="${loc.id}" ${loc.id === activePosContainerId ? 'selected' : ''}>${escapeHTML(loc.name || loc.id)}</option>`
        ).join('');
    } else {
        optionsHtml = `<option value="main">Main Store</option>`;
    }

    const container = document.createElement('div');
    container.id = 'pos-location-selector-container';
    container.className = "mb-4 bg-SLATE-50 p-3 rounded-lg border border-SLATE-100 flex items-center justify-between shadow-sm col-span-full";
    container.innerHTML = `
        <div class="flex items-center gap-2">
            <svg class="w-5 h-5 text-SLATE-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
            <span class="text-sm font-bold text-SLATE-900">Active Register Location:</span>
        </div>
        <select id="pos-location-selector" class="ml-2 text-sm border-gray-300 rounded-md p-1.5 focus:ring-SLATE-500 focus:border-SLATE-500 shadow-sm font-medium text-gray-700 bg-white">
            ${optionsHtml}
        </select>
    `;

    if (section.firstChild) {
        section.insertBefore(container, section.firstChild);
    } else {
        section.appendChild(container);
    }

    document.getElementById('pos-location-selector').addEventListener('change', (e) => {
        if (typeof setCurrentLocation === 'function') {
            const newLoc = e.target.value;
            const currentCart = getCurrentCart();
            if (currentCart.length > 0) {
                if (!confirm("Switching locations will clear the current cart. Continue?")) {
                    e.target.value = activePosContainerId;
                    return;
                }
                clearCart();
            }

            let productList = document.getElementById('pos-product-search-list');
            if (productList) productList.innerHTML = '';

            activePosContainerId = newLoc;
            setCurrentLocation(newLoc);
            refreshProductIndex();
            showModal('Location Switched', `Active POS location is now: ${e.target.options[e.target.selectedIndex].text}`, 'success');
        }
    });
}
// 1. Trigger the hidden file picker
window.triggerPosImageUpload = function (sku) {
    currentImageUploadSku = sku;
    let input = document.getElementById('hidden-pos-image-input');

    // Create the hidden input if it doesn't exist yet
    if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = 'hidden-pos-image-input';
        input.accept = 'image/*';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file || !currentImageUploadSku) return;

            if (typeof window.showModal === 'function') {
                window.showModal('Processing...', 'Optimizing image for POS...', 'info');
            }

            try {
                // Auto-compress the image using an HTML Canvas
                const compressedBase64 = await compressImageForPos(file);

                // Save it to IndexedDB
                await savePosImage(currentImageUploadSku, compressedBase64);

                // Refresh the table to show the new picture!
                if (typeof renderInventoryTable === 'function') renderInventoryTable();

                // Close the modal
                const modal = document.getElementById('custom-modal');
                if (modal) modal.remove();

            } catch (error) {
                console.error("Image save failed:", error);
                alert("Failed to save image.");
            } finally {
                input.value = ''; // Reset input
            }
        });
    }

    input.click();
};

// 2. The Auto-Compressor (Shrinks 5MB photos down to ~30kb)
function compressImageForPos(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                // Force a perfectly square aspect ratio for the POS tiles (e.g., 300x300)
                const size = 300;
                canvas.width = size;
                canvas.height = size;

                const ctx = canvas.getContext('2d');
                ctx.fillStyle = "#F8FAFC"; // Light slate background for transparent PNGs
                ctx.fillRect(0, 0, size, size);

                // Crop and center the image
                const scale = Math.max(size / img.width, size / img.height);
                const x = (size / 2) - (img.width / 2) * scale;
                const y = (size / 2) - (img.height / 2) * scale;
                ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

                // Export as a lightweight JPEG (0.7 quality)
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
}

// --- Visual Grid State ---
let isVisualGridEnabled = false;
let isCatalogPinned = false;

function syncCatalogVisibility(searchTerm = '', skipDOMRebuild = false) {
    const toggleBtn = document.getElementById('toggle-catalog-btn');
    const term = searchTerm.trim();

    // Truth table: Show if user pinned it ON, or if they are actively typing a search
    const shouldShow = isCatalogPinned || term.length > 0;
    isVisualGridEnabled = shouldShow;

    // Instant UI paint for the toggle button
    if (toggleBtn) {
        toggleBtn.classList.toggle('bg-SLATE-600', isCatalogPinned);
        toggleBtn.classList.toggle('text-white', isCatalogPinned);
        toggleBtn.classList.toggle('bg-slate-100', !isCatalogPinned);
        toggleBtn.classList.toggle('text-slate-600', !isCatalogPinned);
    }

    if (shouldShow) {
        if (!skipDOMRebuild) {
            renderVisualPosGrid(term);
        }
        // 🚀 THE FIX: Query the DOM *after* render runs in case the wrapper was just born
        const wrapper = document.getElementById('visual-pos-grid-wrapper');
        if (wrapper) wrapper.style.display = 'block'; // Overpowers any CSS class
    } else {
        // 🚀 THE FIX: Force it shut at the hardware inline-style level
        const wrapper = document.getElementById('visual-pos-grid-wrapper');
        if (wrapper) wrapper.style.display = 'none';
    }
}

function injectVisualGridToggle() {
    const searchInput = DOM.pos.manualInput || document.getElementById('pos-manual-input');
    if (!searchInput || document.getElementById('toggle-catalog-btn')) return;

    const searchFlexRow = searchInput.closest('.flex');

    // 🚀 THE FIX: Wrap the input in a relative container so the absolute 'x' button positions correctly
    const inputWrapper = document.createElement('div');
    inputWrapper.className = "relative flex-grow w-full";

    // Insert wrapper where input is, then move input inside it
    searchInput.parentNode.insertBefore(inputWrapper, searchInput);
    inputWrapper.appendChild(searchInput);

    // Make room for the 'x' button inside the input text area
    searchInput.classList.add('pr-10');
    searchInput.classList.remove('flex-grow'); // The wrapper handles flex-grow now

    const clearBtn = document.createElement('button');
    clearBtn.id = 'clear-search-btn';
    clearBtn.type = 'button';
    // 🚀 Positioned perfectly relative to the new wrapper
    clearBtn.className = "absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500 hidden transition-all p-1 z-10 cursor-pointer bg-transparent rounded-md";
    clearBtn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>`;

    inputWrapper.appendChild(clearBtn);

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'toggle-catalog-btn';
    toggleBtn.type = 'button';
    toggleBtn.className = "ml-3 px-4 py-2 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-sm font-bold hover:bg-slate-200 transition-colors flex items-center gap-2 shadow-sm shrink-0 select-none";
    toggleBtn.innerHTML = `
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
        Catalog
    `;
    searchFlexRow.appendChild(toggleBtn);

    toggleBtn.onclick = () => {
        const gridWasAlreadyVisible = isVisualGridEnabled;
        isCatalogPinned = !isCatalogPinned;

        // If grid was already showing because they were typing, SKIP rebuilding the heavy HTML!
        const bypassHTMLGeneration = gridWasAlreadyVisible && isCatalogPinned;
        syncCatalogVisibility(searchInput.value, bypassHTMLGeneration);
    };

    clearBtn.onclick = () => {
        searchInput.value = '';
        searchInput.focus();
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    };

    searchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        clearBtn.classList.toggle('hidden', val.length === 0);
        syncCatalogVisibility(val, false);
    });
}


// 🚀 THE FIX: Dynamic POS Bundle Recalculator
function recalculateBundleStocks() {
    if (!localProductIndex || localProductIndex.length === 0) return;

    localProductIndex.forEach(product => {
        if (product.type === 'bundle' && Array.isArray(product.bundleComponents) && product.bundleComponents.length > 0) {
            let maxBundlesPossible = Infinity;

            product.bundleComponents.forEach(comp => {
                const realProduct = localProductIndex.find(p => p.id === comp.id);
                const realStockAvailable = realProduct ? parseFloat(realProduct.stockLevel || 0) : 0;

                const possibleWithThisItem = Math.floor(realStockAvailable / comp.qty);
                if (possibleWithThisItem < maxBundlesPossible) {
                    maxBundlesPossible = possibleWithThisItem;
                }
            });

            if (maxBundlesPossible === Infinity) maxBundlesPossible = 0;

            // Override the POS memory stock level for this bundle!
            product.stockLevel = maxBundlesPossible;
        }
    });
}
// 🚀 NEW: Surgically updates live stock numbers on the Visual Grid without causing screen flashes!
export function updateVisualGridStock() {
    const gridWrapper = document.getElementById('visual-pos-grid-wrapper');
    // 🚀 Check physical style instead of Tailwind classes
    const isOpen = gridWrapper && gridWrapper.style.display !== 'none';

    if (!isOpen || !localProductIndex) return;// Halt safely if grid is closed

    const currentCart = getCurrentCart();

    localProductIndex.forEach(prod => {
        const stockSpan = document.getElementById(`grid-stock-${prod.id}`);
        if (stockSpan) {
            // Find how many of this item are currently in the cart
            const cartItem = currentCart.find(i => i.id === prod.id);
            const cartQty = cartItem ? cartItem.quantity : 0;

            // Calculate live remaining stock
            const liveStock = (parseFloat(prod.stockLevel) || 0) - cartQty;

            stockSpan.textContent = `${liveStock} in stock`;

            // Update color if it drops below low stock threshold
            const threshold = parseFloat(prod.lowStockThreshold || 0);
            if (liveStock <= threshold) {
                stockSpan.className = 'text-[8px] font-bold text-orange-500';
            } else {
                stockSpan.className = 'text-[8px] font-bold text-emerald-500';
            }
        }
    });
}
function injectPaperlessToggle() {
    // Targets the Customer Details card
    const customerCard = document.querySelector('.customer-details-container') || DOM.pos.customer.name?.closest('.bg-white');
    if (!customerCard || document.getElementById('paperless-toggle-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'paperless-toggle-wrapper';
    wrapper.className = "mt-4 pt-3 border-t border-slate-100 flex items-center justify-between  ";

    wrapper.innerHTML = `
        <div id="print-mode-label" class="flex flex-col"></div>
        <label class="relative inline-flex items-center cursor-pointer group">
            <input type="checkbox" id="print-mode-toggle" class="sr-only peer" ${isPaperlessMode ? 'checked' : ''}>
            <div class="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:width-4 after:transition-all peer-checked:bg-green-500 shadow-inner"></div>
        </label>
    `;
    customerCard.appendChild(wrapper);
}

function updatePrintModeUI() {
    const label = document.getElementById('print-mode-label');
    const checkoutBtn = DOM.pos.checkoutBtn;
    if (!label) return;

    label.innerHTML = isPaperlessMode
        ? `<span class="text-green-600 flex items-center gap-1.5 font-bold text-[11px] uppercase tracking-wider">
            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.347-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
            WhatsApp Mode
          </span>`
        : `<span class="text-slate-500 flex items-center gap-1.5 font-bold text-[11px] uppercase tracking-wider">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
            Paper Mode
          </span>`;

    // 🚀 NEW: Dynamic Button Coloring
    if (checkoutBtn) {
        if (isPaperlessMode) {
            checkoutBtn.classList.replace('from-SLATE-600', 'from-green-600');
            checkoutBtn.classList.replace('to-SLATE-700', 'to-green-700');
        } else {
            checkoutBtn.classList.replace('from-green-600', 'from-SLATE-600');
            checkoutBtn.classList.replace('to-green-700', 'to-SLATE-700');
        }
    }
}
async function sendWhatsAppInBackground(transactionData, customerPhone) {
    const storeId = typeof getStoreId === 'function' ? getStoreId() : window.primaryStoreId;

    if (!customerPhone || customerPhone.length < 10) return;

    showToast('Sending', 'Generating digital receipt...', 'info');

    try {
        const whatsappCaller = httpsCallable(functions, 'sendWhatsAppReceipt');
        const cleanPhone = customerPhone.replace(/\D/g, '');

        const safeStoreName = transactionData.storeDetails?.name || 'Mifela POS';
        const customerName = transactionData.customer?.name || 'Valued Customer';

        // 🚀 THE UPGRADE: Bundle the cart into a multi-line string
        const cartItems = transactionData.items || [];
        let itemListString = cartItems.map(item =>
            `▪ ${item.quantity}x ${item.name}`
        ).join('\n');

        // Failsafe: WhatsApp has limits. If they buy 50 unique items, we truncate it so it doesn't crash Meta.
        if (cartItems.length > 15) {
            itemListString = cartItems.slice(0, 15).map(item => `▪ ${item.quantity}x ${item.name}`).join('\n') + `\n...and ${cartItems.length - 15} more items`;
        }

        // If the cart is empty (e.g. paying off Udhaar), show a default message
        if (!itemListString) itemListString = "▪ Custom Payment / Dues";

        const payload = {
            phone: String(cleanPhone),
            storeName: String(safeStoreName),
            invoiceId: String(transactionData.id),
            customerName: String(customerName),
            itemList: String(itemListString), // 🚀 Pushing the bundled list
            total: String(parseFloat(transactionData.summary.total).toFixed(2)),
            storeId: String(storeId)
        };

        await whatsappCaller(payload);
        showToast('Delivered 💬', 'WhatsApp receipt sent successfully!', 'success');

    } catch (error) {
        console.error("WhatsApp Delivery Failed:", error);
        if (error.message && error.message.includes('not configured')) {
            showToast('Setup Required', 'WhatsApp is disabled or API keys are missing in Settings.', 'warning');
        } else {
            showToast('Delivery Failed', 'Could not send WhatsApp receipt.', 'error');
        }
    }
}
// --- WhatsApp Configuration Check ---
async function verifyWhatsAppSetup() {
    try {
        const plan = typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free';

        // Example: Only allow WhatsApp billing on higher tiers
        if (plan === 'free') {
            console.warn("WhatsApp billing requires a premium plan.");
            return false;
        }

        // You can later add logic here to ping your Cloud Function 
        // to ensure the WhatsApp API Gateway keys are valid.
        console.log("WhatsApp Gateway verified and ready.");
        return true;

    } catch (error) {
        console.error("Failed to verify WhatsApp setup:", error);
        return false;
    }
}
// ============================================================================
// 🚀 ROUTING MODAL & CHECKOUT LOGIC
// ============================================================================

function promptForPaymentRoute(method, total) {
    return new Promise((resolve) => {
        const existing = document.getElementById('payment-route-modal');
        if (existing) existing.remove();

        const currencySymbol = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';

        const modalHtml = `
            <div id="payment-route-modal" class="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-[150]  ">
                <div class="bg-white p-8 rounded-[2rem] shadow-2xl max-w-sm w-full border border-slate-100 transform animate-scaleIn">
                    <div class="flex items-center justify-between mb-2">
                        <h3 class="text-2xl font-black text-slate-800 tracking-tight">Process ${method}</h3>
                        <div class="bg-SLATE-50 text-SLATE-600 p-2 rounded-xl">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                        </div>
                    </div>
                    <p class="text-sm font-medium text-slate-500 mb-8">Choose how the customer is paying the <span class="font-bold text-slate-800">${currencySymbol}${total.toFixed(2)}</span> total.</p>
                    
                    <div class="space-y-4">
                        <button id="route-internal" class="w-full p-4 bg-white border-2 border-slate-200 hover:border-SLATE-600 hover:bg-SLATE-50 rounded-2xl flex items-center gap-4 transition-all text-left group shadow-sm">
                            <div class="bg-SLATE-100 p-3 rounded-xl shadow-inner group-hover:scale-110 transition-transform">
                                <svg class="w-6 h-6 text-SLATE-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                            </div>
                            <div>
                                <div class="font-black text-slate-800 group-hover:text-SLATE-900 text-sm">Send to Razorpay Gateway</div>
                                <div class="text-[10px] font-bold text-slate-400 group-hover:text-SLATE-500 uppercase tracking-widest mt-0.5">Generate Live Link</div>
                            </div>
                        </button>
                        
                        <button id="route-external" class="w-full p-4 bg-white border-2 border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 rounded-2xl flex items-center gap-4 transition-all text-left group shadow-sm">
                            <div class="bg-emerald-100 p-3 rounded-xl shadow-inner group-hover:scale-110 transition-transform">
                                <svg class="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
                            </div>
                            <div>
                                <div class="font-black text-slate-800 group-hover:text-emerald-900 text-sm">External Terminal / QR</div>
                                <div class="text-[10px] font-bold text-slate-400 group-hover:text-emerald-500 uppercase tracking-widest mt-0.5">Already Paid Directly</div>
                            </div>
                        </button>
                    </div>
                    
                    <div class="mt-8 text-center">
                        <button id="route-cancel" class="text-xs font-black text-slate-400 hover:text-red-500 uppercase tracking-[0.2em] transition-colors py-2 px-4 rounded-lg hover:bg-red-50">Cancel Checkout</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        document.getElementById('route-internal').onclick = () => { document.getElementById('payment-route-modal').remove(); resolve('INTERNAL'); };
        document.getElementById('route-external').onclick = () => { document.getElementById('payment-route-modal').remove(); resolve('EXTERNAL'); };
        document.getElementById('route-cancel').onclick = () => { document.getElementById('payment-route-modal').remove(); resolve('CANCEL'); };
    });
}
window.triggerTokenRedemption = async function (availableTokens) {
    const config = await getLoyaltyConfig();
    if (!config.enabled) return showToast('Error', 'Loyalty program disabled.', 'error');

    // 🚀 FIX: Prevent over-redemption
    const tokensToRedeemStr = await promptForInput(
        'Redeem Tokens',
        `Available: ${availableTokens} tokens. Value: ₹${config.tokenValue}/token.\n\nEnter tokens to redeem:`,
        availableTokens.toString()
    );

    if (tokensToRedeemStr === null) return;

    let parsedTokens = parseInt(tokensToRedeemStr, 10);
    if (isNaN(parsedTokens) || parsedTokens <= 0) return;

    // Cap at available balance
    if (parsedTokens > availableTokens) parsedTokens = availableTokens;

    const discountAmount = parsedTokens * config.tokenValue;
    const discountInput = DOM.pos.totals.discount;

    if (discountInput) {
        // 🚀 FIX: Set the pending deduction globally and explicitly
        window.__pendingTokenDeduction = parsedTokens;

        const currentDisc = parseFloat(discountInput.value) || 0;
        discountInput.value = (currentDisc + discountAmount).toFixed(2);
        discountInput.dispatchEvent(new Event('input'));

        showToast('Tokens Redeemed', `Applied ₹${discountAmount.toFixed(2)} discount!`, 'success');
    }
};


const getPinnedCustomersKey = () => `mifela_pinned_customers_${typeof getUserId === 'function' ? getUserId() : 'guest'}`;

window.renderCustomerDropdown = function (searchTerm = '') {
    const dropdown = document.getElementById('pinned-customers-dropdown');
    const quickAccess = document.getElementById('quick-pinned-customers');

    const term = searchTerm.toLowerCase().trim();
    const pinnedKey = getPinnedCustomersKey();
    const pinnedCustomers = JSON.parse(localStorage.getItem(pinnedKey) || "[]");

    // Ensure Quick Access is populated immediately regardless of dropdown state
    if (quickAccess) {
        const pinnedData = localCustomerIndex.filter(c => pinnedCustomers.includes(c.id));
        quickAccess.innerHTML = pinnedData.map(c => `
            <div class="flex items-center bg-SLATE-50 border border-SLATE-200 rounded-md overflow-hidden shadow-sm hover:bg-SLATE-100 transition-colors">
                <button type="button" onclick="selectCustomerFromDropdown('${c.id}')" class="px-2 py-1.5 text-SLATE-700 text-[10px] font-bold flex items-center gap-1 uppercase tracking-wider h-full">
                    <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path></svg>
                    ${escapeHTML(c.name || c.phone)}
                </button>
                <button type="button" onclick="togglePinCustomer(event, '${c.id}')" class="px-1.5 py-1.5 text-SLATE-400 hover:text-red-500 hover:bg-SLATE-200 transition-colors h-full border-l border-SLATE-200 flex items-center justify-center">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        `).join('');
    }

    if (!dropdown) return;

    let filteredCustomers = localCustomerIndex.filter(c => {
        if (!term) return true;
        return (c.name || '').toLowerCase().includes(term) ||
            (c.phone || '').includes(term) ||
            (c.id || '').toLowerCase().includes(term);
    });

    filteredCustomers.sort((a, b) => {
        const aPinned = pinnedCustomers.includes(a.id);
        const bPinned = pinnedCustomers.includes(b.id);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;

        // Alphabetical sort fallback
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
    });

    filteredCustomers = filteredCustomers.slice(0, 20);

    if (filteredCustomers.length === 0) {
        dropdown.innerHTML = `<div class="p-3 text-center text-xs text-gray-500 font-medium">No customers found.</div>`;
        return;
    }

    dropdown.innerHTML = filteredCustomers.map(cust => {
        const isPinned = pinnedCustomers.includes(cust.id);
        return `
            <div class="flex items-center justify-between p-2.5 border-b border-gray-100 hover:bg-SLATE-50 cursor-pointer transition-colors">
                <div class="flex-1 min-w-0" onclick="selectCustomerFromDropdown('${cust.id}')">
                    <div class="text-sm font-bold text-gray-800 truncate">${escapeHTML(cust.name || 'Unknown')}</div>
                    <div class="text-xs text-gray-500 font-mono">${escapeHTML(cust.phone || 'No Phone')}</div>
                </div>
                <button type="button" class="ml-2 p-1.5 rounded-full transition-colors ${isPinned ? 'text-SLATE-600 bg-SLATE-100 hover:bg-SLATE-200' : 'text-gray-300 hover:text-SLATE-500 hover:bg-gray-100'}" onclick="togglePinCustomer(event, '${cust.id}')" title="${isPinned ? 'Unpin' : 'Pin'}">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path></svg>
                </button>
            </div>
        `;
    }).join('');
};

window.togglePinCustomer = function (e, custId) {
    e.preventDefault();
    e.stopPropagation();

    const pinnedKey = getPinnedCustomersKey();
    let pinned = JSON.parse(localStorage.getItem(pinnedKey) || "[]");

    if (pinned.includes(custId)) {
        pinned = pinned.filter(id => id !== custId);
    } else {
        pinned.push(custId);
    }

    localStorage.setItem(pinnedKey, JSON.stringify(pinned));

    const searchInput = DOM.pos?.customer?.name || document.getElementById('pos-cust-name');
    renderCustomerDropdown(searchInput ? searchInput.value : '');
};

window.selectCustomerFromDropdown = async function (custId) {
    const dropdown = document.getElementById('pinned-customers-dropdown');
    if (dropdown) dropdown.classList.add('hidden');

    const custIdInput = DOM.pos?.customer?.id || document.getElementById('pos-cust-id');
    if (custIdInput) {
        custIdInput.value = custId;
        // Force the lookup to trigger dynamic rate updates
        if (typeof handleCustomerIdLookup === 'function') {
            await handleCustomerIdLookup({ target: { value: custId } });
        } else {
            custIdInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }
};

window.applyB2BRatesToCart = function (customer) {
    const currentCart = typeof getCurrentCart === 'function' ? getCurrentCart() : [];
    if (!currentCart || currentCart.length === 0) return;

    let hasChanges = false;
    const updatedCart = currentCart.map(item => {
        // 🚀 THE FIX: Use the batch's originalPrice, NOT the global product index price
        let basePrice = parseFloat(item.originalPrice || item.price || 0);

        let newPrice = basePrice;

        if (customer && customer.customPricing && customer.customPricing[item.id]) {
            newPrice = parseFloat(customer.customPricing[item.id].price);
        }

        if (newPrice !== parseFloat(item.price)) {
            hasChanges = true;
            return { ...item, price: newPrice };
        }
        return item;
    });

    if (hasChanges) {
        setCurrentCart(updatedCart);
        persistCart();
        renderCart();
        updateCartSummary();

        if (customer && customer.customPricing) {
            if (typeof showToast === 'function') showToast('Rates Applied', `Pricing updated for ${customer.name}`, 'info');
        } else {
            if (typeof showToast === 'function') showToast('Rates Reverted', 'Restored standard pricing.', 'info');
        }
    }
};
// 2. Append this block inside the existing `setupPosListeners()` function

const custNameInput = DOM.pos?.customer?.name || document.getElementById('pos-cust-name');
if (custNameInput) {
    custNameInput.addEventListener('focus', (e) => {
        renderCustomerDropdown(e.target.value);
        document.getElementById('pinned-customers-dropdown').classList.remove('hidden');
    });

    custNameInput.addEventListener('input', (e) => {
        renderCustomerDropdown(e.target.value);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#pos-cust-name') && !e.target.closest('#pinned-customers-dropdown')) {
            const dropdown = document.getElementById('pinned-customers-dropdown');
            if (dropdown) dropdown.classList.add('hidden');
        }
    });
}
document.addEventListener('click', (e) => {
    // Target the "CHANGE" button in the Customer Details card
    const btn = e.target.closest('button') || e.target.closest('a') || e.target;
    if (btn && btn.textContent.trim().toUpperCase() === 'CHANGE') {
        e.preventDefault();
        resetCustomerPosState();
        // if (DOM.pos.customer.id) DOM.pos.customer.id.value = '';
        // if (DOM.pos.customer.name) {
        //     DOM.pos.customer.name.value = '';
        //     DOM.pos.customer.name.classList.remove('border-emerald-500', 'bg-emerald-50', 'transition-colors');
        // }
        // if (DOM.pos.customer.phone) DOM.pos.customer.phone.value = '';

        // currentCustomerDues = 0;
        // const balanceBadge = document.getElementById('pos-customer-balance-badge');
        // if (balanceBadge) balanceBadge.classList.add('hidden');

        // window.__pendingTokenDeduction = 0;
        // if (DOM.pos.totals.discount) {
        //     DOM.pos.totals.discount.value = '';
        // }

        // if (typeof applyB2BRatesToCart === 'function') applyB2BRatesToCart(null);
        // updateCartSummary();
    }
});
// 3. Functional 5 Min Auto Cart Cleanup
let cartIdleTimer;
let activityTimeout = null;
const CART_TIMEOUT_MS = 5 * 60 * 1000;

function resetCartIdleTimer() {
    clearTimeout(cartIdleTimer);
    const currentCart = typeof getCurrentCart === 'function' ? getCurrentCart() : [];
    if (currentCart.length > 0 || currentCustomerDues > 0) {
        cartIdleTimer = setTimeout(() => {
            if (typeof clearCart === 'function') {
                clearCart();
                if (typeof showToast === 'function') showToast('Cart Cleared', 'Inactivity timeout (5 mins) reached.', 'warning');
            }
        }, CART_TIMEOUT_MS);
    }
}

// 🚀 THE FIX: Use the throttled function in the event listeners!
function throttledReset() {
    if (activityTimeout) return;
    activityTimeout = setTimeout(() => {
        resetCartIdleTimer();
        activityTimeout = null;
    }, 1000); // Only process activity once per second max
}

['click', 'keypress', 'scroll', 'mousemove', 'touchstart'].forEach(evt => {
    // 🚀 THE FIX: Changed 'resetCartIdleTimer' to 'throttledReset'
    document.addEventListener(evt, throttledReset, { passive: true });
});
// ============================================================================
// 🚀 IN-STORE SECURE PAYMENT VERIFICATION ENGINE (POS)
// ============================================================================

async function triggerPaymentGateway(totalAmount, method) {
    const currencySymbol = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';
    const storeId = typeof getStoreId === 'function' ? getStoreId() : window.primaryStoreId;
    let paymentLink = null;

    try {
        const storeSnap = await getDoc(doc(db, `artifacts/${appId}/stores/${storeId}/settings/profile`));
        if (storeSnap.exists() && storeSnap.data().customPaymentLinks && storeSnap.data().customPaymentLinks['pos']) {
            paymentLink = storeSnap.data().customPaymentLinks['pos'];
        } else {
            showModal("Missing Setup", "No custom payment link configured for this POS terminal. Configure it in Settings > Directory.", "error");
            return false;
        }
    } catch (e) {
        console.error(e);
        return false;
    }

    return new Promise((resolve) => {
        const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(paymentLink)}`;

        const html = `
            <div id="pos-qr-payment-modal" class="fixed inset-0 z-[10000] bg-gray-900 bg-opacity-90 flex items-center justify-center p-4 transition-opacity">
                <div class="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-8 flex flex-col items-center text-center relative">
                    <h3 class="text-xl font-black text-slate-800 mb-1">Scan to Pay</h3>
                    <p class="text-sm font-bold text-slate-500 uppercase tracking-widest mb-6">Store Purchase</p>
                    <div class="bg-slate-50 border-2 border-dashed border-SLATE-200 p-4 rounded-2xl mb-6 shadow-inner">
                        <img src="${qrSrc}" alt="QR Code" class="w-48 h-48 object-contain mix-blend-multiply">
                    </div>
                    <div class="text-3xl font-black text-SLATE-600 mb-6">${currencySymbol}${parseFloat(totalAmount).toFixed(2)}</div>
                    
                    <button id="pos-qr-confirm-btn" class="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black shadow-lg shadow-emerald-200 transition-all active:scale-95 mb-3">
                        I Have Paid
                    </button>
                    <button id="pos-qr-cancel-btn" class="w-full py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition-all active:scale-95">
                        Cancel
                    </button>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', html);
        const modal = document.getElementById('pos-qr-payment-modal');
        const cleanup = () => modal.remove();

        document.getElementById('pos-qr-cancel-btn').onclick = () => {
            cleanup();
            resolve(false);
        };

        // 🚀 THE FIX: Await the actual database write so errors don't escape!
        document.getElementById('pos-qr-confirm-btn').onclick = async () => {
            const btn = document.getElementById('pos-qr-confirm-btn');
            btn.disabled = true;
            btn.innerHTML = `<svg class="animate-spin h-5 w-5 text-white inline-block" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Generating Transaction...`;

            setTimeout(async () => {
                cleanup();
                try {
                    await processCheckout(method);
                } catch (e) {
                    showModal('Transaction Failed', e.message, 'error');
                }
                resolve(true);
            }, 2000);
        };
    });
}

window.promptForCatalogQuantity = function (product) {
    const modalId = 'catalog-qty-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const modalHtml = `
        <div id="${modalId}" class="fixed inset-0 z-[250] bg-slate-900/60 flex items-center justify-center p-4  ">
            <div class="bg-white p-8 rounded-[2rem] shadow-2xl w-full max-w-xs border border-slate-100 transform animate-scaleIn text-center">
                <div class="w-16 h-16 bg-SLATE-50 text-SLATE-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                </div>
                <h3 class="text-lg font-black text-slate-800 tracking-tight leading-tight mb-1 line-clamp-2">${escapeHTML(product.name)}</h3>
                <p class="text-xs font-medium text-slate-500 mb-6 uppercase tracking-widest">Enter Quantity</p>
                
<input type="number" id="catalog-qty-input" value="1" step="0.01" class="w-full border-2 border-SLATE-100 bg-SLATE-50/50 p-4 rounded-xl text-center text-4xl font-black text-SLATE-700 focus:outline-none focus:border-SLATE-500 focus:bg-white focus:ring-4 focus:ring-SLATE-500/20 transition-all shadow-inner mb-6">                
                <div class="flex gap-3">
                    <button type="button" id="catalog-qty-cancel" class="flex-1 px-4 py-3.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors">Cancel</button>
                    <button type="button" id="catalog-qty-confirm" class="flex-[1.5] px-4 py-3.5 bg-SLATE-600 text-white font-black rounded-xl hover:bg-SLATE-700 shadow-lg shadow-SLATE-200 transition-colors">Add</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modal = document.getElementById(modalId);
    const input = document.getElementById('catalog-qty-input');
    const confirmBtn = document.getElementById('catalog-qty-confirm');
    const cancelBtn = document.getElementById('catalog-qty-cancel');

    // Auto-focus and select all text so typing immediately overwrites "1"
    setTimeout(() => {
        input.focus();
        input.select();
    }, 50);

    const closeAndCleanup = () => {
        modal.classList.add('opacity-0');
        setTimeout(() => modal.remove(), 200);

        // Return focus to main search bar after closing
        const mainInput = document.getElementById('pos-manual-input');
        if (mainInput) mainInput.focus();
    };

    const submitQty = () => {
        const qty = parseFloat(input.value);
        if (isNaN(qty) || qty <= 0) {
            input.classList.add('border-red-500', 'bg-red-50');
            setTimeout(() => input.classList.remove('border-red-500', 'bg-red-50'), 500);
            return;
        }

        // Push the item to the cart with the confirmed quantity
        addProductToCart(product.id, product, qty);

        // 🚀 THE FIX: Clear the main search bar automatically after a successful catalog add
        const mainInput = document.getElementById('pos-manual-input') || DOM.pos.manualInput;
        if (mainInput && mainInput.value.trim() !== '') {
            mainInput.value = '';
            mainInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        closeAndCleanup();
    };

    confirmBtn.onclick = submitQty;
    cancelBtn.onclick = closeAndCleanup;

    // Listen for Return (Enter) to submit instantly
    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitQty();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closeAndCleanup();
        }
    };
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
// ============================================================================
// 🚨 SMART ALERTS: BACKGROUND LOW-STOCK MONITOR
// ============================================================================
export async function triggerLowStockAlerts(purchasedItems) {
    const alerts = [];
    const storeId = typeof getStoreId === 'function' ? getStoreId() : window.primaryStoreId;

    purchasedItems.forEach(item => {
        const match = localProductIndex.find(p => p.id === item.id);
        if (match) {
            const currentStock = parseFloat(match.stockLevel) || 0;
            // Default threshold is 5 if not explicitly set by the merchant
            const threshold = parseFloat(match.lowStockThreshold) || 5;

            if (currentStock <= threshold && currentStock > 0) {
                alerts.push(`⚠️ ${match.name} (SKU: ${match.sku}) is running low! Only ${currentStock} left in stock.`);
            } else if (currentStock <= 0) {
                alerts.push(`🚨 OUT OF STOCK: ${match.name} (SKU: ${match.sku}) has been completely depleted!`);
            }
        }
    });

    if (alerts.length > 0) {
        try {
            // Trigger Firebase Cloud Function to dispatch WhatsApp/SMS to the Store Owner
            const alertCaller = httpsCallable(functions, 'sendLowStockAlert');
            alertCaller({
                storeId: storeId,
                locationId: activePosContainerId, // Isolates the alert to the specific Godown
                messages: alerts
            });
        } catch (e) {
            console.warn("Silent alert failure:", e);
        }
    }
}


