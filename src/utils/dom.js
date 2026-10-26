// src/utils/dom.js

export const DOM = {
    // 1. Layout & Global
    header: null,
    loadingScreen: null,
    content: null,
    toasts: null,
    activityLog: null,

    // 2. Authentication (Updated for Offline Activation)
    auth: {
        view: null,
        statusLabel: null,
        logoutBtn: null,
        profileBtn: null,
        settingsBtn: null,
        error: null,
        // 🚀 THE FIX: New offline activation elements
        activation: {
            form: null,
            fingerprint: null,
            licenseKey: null,
            activateBtn: null
        }
    },

    // 3. Inventory
    inventory: {
        section: null,
        table: null,
        search: null,
        sort: null,
        exportBtn: null,
        form: document.getElementById('product-form'),
        formTitle: document.getElementById('form-title'),
        saveBtn: null,
        cancelBtn: null,
        genBarcodeBtn: null,
        listContainer: null,
        inputs: {
            name: null, sku: null, barcode: null, price: null, cost: null,
            stock: null, lowStock: null, unit: null, gst: null,
            dealer: null, dealerId: null, dealerGst: null, dealerPhone: null,
            invoice: null, date: null,
            expiry: null, bestBefore: null, packaged: null
        },
        bundle: {
            container: null,
            search: null,
            addBtn: null,
            table: null,
            totalCost: null,
            typeRadios: null
        }
    },

    // 4. POS (Point of Sale)
    pos: {
        section: null,
        manualInput: null,
        quantityInput: null,
        addBtn: null,
        cartBody: null,
        totals: { sub: null, tax: null, final: null, discount: null, fee: null },
        customer: { name: null, phone: null, id: null },
        paymentMethod: null,
        checkoutBtn: null,
        clearBtn: null,
        taxDisplay: null,
        parkBtn: null, 
        viewParkedBtn: null,
        parkedCountBadge: null
    },

    // 5. Dashboard
    dashboard: {
        grid: null,
        storeName: null,
        planName: null,
        attendanceContainer: null
    },

    // 6. Reports
    reports: {
        grid: null
    },

    // 7. Customers
    customers: {
        form: null,
        formTitle: null,
        inputs: {
            name: null, id: null, phone: null, email: null, address: null,
            gstin: null, state: null, type: null,
            dealerType: null, bankName: null, accNum: null, ifsc: null, branch: null
        },
        table: null,
        filter: null,
        saveBtn: null,
        cancelBtn: null,
        exportBtn: null,
        exportDealersBtn: null
    },

    // 8. Transactions
    transactions: {
        table: null,
        search: null,
        filter: null,
        dateStart: null,
        dateEnd: null,
        clearBtn: null,
        exportBtn: null,
        rangeDisplay: null
    },

    

    // 10. Settings
    settings: {
        section: null,
        taxRate: null,
        currency: null,
        saveBtn: null,
        profile: { email: null, name: null },
        store: { 
            name: null, phone: null, email: null, address: null, taxId: null,
            tagline: null, website: null, footer: null,
            saveBtn: null
        },
        prefs: { tax: null, currency: null, fee: null, saveBtn: null },
        data: { backupBtn: null, restoreBtn: null, resetBtn: null },
        security: { 
            strictMode: null, 
            adminBypass: null, 
            masterTerminal: null, 
            masterLocSelect: null 
        }
    },

    // 11. Staff
    staff: {
        section: null,
        table: null,
        form: null,
        search: null,
        sort: null,
        refreshBtn: null,
        addBtn: null,
        exportBtn: null,
        exportRange: null,
        cancelBtn: null,
        inputs: {
            name: null, username: null, email: null, password: null, role: null,
            status: null, idHidden: null, joiningDate: null
        },
        stats: { overdue: null, paidMonth: null }
    },

    // 12. Modals
    modals: {
        generic: { self: null, title: null, msg: null, confirmBtn: null, cancelBtn: null, actions: null, icon: null },
        transaction: { self: null, title: null, content: null, close: null, print: null },
        stock: { self: null, title: null, current: null, form: null, change: null, reason: null, cancel: null, confirm: null },
        history: { self: null, title: null, subtitle: null, content: null, close: null, print: null },
        payroll: { 
            self: null, title: null, close: null, recordBtn: null, historyList: null,
            inputs: { daily: null, days: null, bonus: null, deduction: null, advance: null, notes: null }, 
            display: { total: null, unit: null, rate: null },
            sections: { salary: null, advance: null }
        },
        scanner: { self: null, video: null, close: null }
    },

    // 13. Datalists
    datalists: {
        product: null, customer: null, dealer: null, customerId: null, dealerId: null, staff: null
    },

    // 14. Updater
    updater: {
        toast: null, title: null, message: null, actionBtn: null, dismissBtn: null, progress: null, container: null
    }
};

export function initDOMElements() {
    const safeGet = (id, optional = false) => {
        const el = document.getElementById(id);
        if (!el && !optional) console.warn(`DOM Element Missing: ${id}`);
        return el;
    };

    // Global
    DOM.header = safeGet('app-header');
    DOM.loadingScreen = safeGet('loading-screen');
    DOM.content = safeGet('app-content');
    DOM.toasts = safeGet('toast-container');
    DOM.activityLog = safeGet('activity-log-container', true);

    // Auth (Updated for Offline Activation)
    DOM.auth.view = safeGet('auth-container'); // 🚀 THE FIX: Updated ID
    DOM.auth.logoutBtn = safeGet('logout-btn');
    DOM.auth.profileBtn = safeGet('profile-btn');
    DOM.auth.settingsBtn = safeGet('settings-btn');
    DOM.auth.error = safeGet('login-error');
    
    // 🚀 THE FIX: Map the new activation inputs
    DOM.auth.activation.form = safeGet('activation-form');
    DOM.auth.activation.fingerprint = safeGet('hardware-fingerprint-display');
    DOM.auth.activation.licenseKey = safeGet('license-key-input');
    DOM.auth.activation.activateBtn = safeGet('activate-license-btn');

    // Inventory
    DOM.inventory.section = safeGet('inventory');
    DOM.inventory.table = safeGet('inventory-table-body');
    DOM.inventory.search = safeGet('inventory-search');
    DOM.inventory.sort = safeGet('inventory-sort');
    DOM.inventory.exportBtn = safeGet('export-inventory-btn');
    DOM.inventory.form = safeGet('product-form');
    DOM.inventory.title = safeGet('form-title');
    DOM.inventory.saveBtn = safeGet('save-product-btn');
    DOM.inventory.cancelBtn = safeGet('cancel-edit-btn');
    DOM.inventory.genBarcodeBtn = safeGet('generate-barcode-btn', true);
    DOM.inventory.listContainer = safeGet('inventory-list-container', true);
    
    const i = DOM.inventory.inputs;
    i.name = safeGet('name'); i.sku = safeGet('sku'); i.barcode = safeGet('barcode', true);
    i.price = safeGet('price'); i.cost = safeGet('cost'); i.stock = safeGet('stockLevel');
    i.lowStock = safeGet('lowStockThreshold'); 
    i.unit = safeGet('unit'); 
    i.gst = safeGet('gst-slab');
    i.cess = safeGet('prod-cess', true); // <--- ADD THIS LINE
    i.dealer = safeGet('prod-dealer'); 
    i.dealerId = safeGet('prod-dealer-id', true);
    i.dealerGst = safeGet('prod-gstin', true); 
    i.dealerPhone = safeGet('prod-dealer-phone', true); 
    i.invoice = safeGet('prod-invoice', true); 
    i.date = safeGet('prod-date', true);
    i.expiry = safeGet('expirationDate', true); i.bestBefore = safeGet('best-before-months', true); i.packaged = safeGet('packagedDate', true);

    DOM.inventory.bundle.container = safeGet('bundle-builder', true);

    // POS
    DOM.pos.section = safeGet('pos');
    DOM.pos.manualInput = safeGet('manual-pos-input', true);
    DOM.pos.quantityInput = safeGet('pos-quantity-input', true);
    DOM.pos.addBtn = safeGet('manual-add-btn', true);
    DOM.pos.cartBody = safeGet('cart-table-body');
    DOM.pos.totals.sub = safeGet('cart-subtotal');
    DOM.pos.totals.tax = safeGet('cart-tax');
    DOM.pos.totals.final = safeGet('cart-total');
    DOM.pos.totals.discount = safeGet('cart-discount');
    DOM.pos.totals.fee = safeGet('cart-fee');
    DOM.pos.customer.name = safeGet('pos-cust-name');
    DOM.pos.customer.phone = safeGet('pos-cust-phone');
    DOM.pos.customer.id = safeGet('pos-cust-id');
    DOM.pos.paymentMethod = safeGet('payment-method', true);
    DOM.pos.checkoutBtn = safeGet('checkout-btn');
    DOM.pos.clearBtn = safeGet('clear-cart-btn');
    DOM.pos.taxDisplay = safeGet('tax-rate-display', true);
    DOM.pos.parkBtn = safeGet('park-cart-btn', true);
    DOM.pos.viewParkedBtn = safeGet('view-parked-btn', true);
    DOM.pos.parkedCountBadge = safeGet('parked-count', true);

    // Dashboard
    DOM.dashboard.grid = safeGet('dashboard-grid');
    DOM.dashboard.storeName = safeGet('dashboard-store-name');

    // Reports
    DOM.reports.grid = safeGet('reports-grid');

    // Customers
    DOM.customers.form = safeGet('customer-form');
    DOM.customers.formTitle = safeGet('customer-form-title');
    DOM.customers.table = safeGet('customer-table-body',);
    DOM.customers.filter = safeGet('customer-list-filter', true);
    DOM.customers.saveBtn = safeGet('save-customer-btn');
    DOM.customers.cancelBtn = safeGet('cancel-customer-edit-btn');
    DOM.customers.exportBtn = safeGet('dynamic-export-btn', true); // Update ID to match your new button
    DOM.customers.exportDealersBtn = safeGet('export-dealers-btn', true);
    
    
    const ci = DOM.customers.inputs;
    ci.name = safeGet('cust-form-name'); ci.id = safeGet('cust-form-id'); ci.phone = safeGet('cust-form-phone');
    ci.email = safeGet('cust-form-email'); ci.address = safeGet('cust-form-address'); ci.gstin = safeGet('cust-form-gstin');
    ci.state = safeGet('cust-form-state', true); ci.type = safeGet('cust-form-type'); ci.dealerType = safeGet('cust-form-dealer-type', true);
    ci.bankName = safeGet('cust-form-bank-name', true); ci.accNum = safeGet('cust-form-account-num', true); ci.ifsc = safeGet('cust-form-ifsc', true);
    ci.branch = safeGet('cust-form-branch', true);

    // Transactions
    DOM.transactions.table = safeGet('transactions-table-body');
    DOM.transactions.search = safeGet('tx-search');
    DOM.transactions.filter = safeGet('tx-payment-filter');
    DOM.transactions.dateStart = safeGet('tx-start-date');
    DOM.transactions.dateEnd = safeGet('tx-end-date');
    DOM.transactions.clearBtn = safeGet('tx-clear-filters-btn');
    DOM.transactions.exportBtn = safeGet('export-tx-btn');
    DOM.transactions.rangeDisplay = safeGet('tx-export-range');

   

    // Settings
    DOM.settings.section = safeGet('settings');

    // Staff
    DOM.staff.section = safeGet('staff');
    DOM.staff.table = safeGet('staff-table-body', true);
    
    // Modals
    DOM.modals.generic.self = safeGet('generic-modal') || safeGet('app-modal');
    if (DOM.modals.generic.self) {
        DOM.modals.generic.title = safeGet('generic-modal-title') || safeGet('modal-title');
        DOM.modals.generic.msg = safeGet('generic-modal-msg') || safeGet('modal-message');
        DOM.modals.generic.confirmBtn = safeGet('generic-modal-confirm') || safeGet('modal-confirm');
        DOM.modals.generic.cancelBtn = safeGet('generic-modal-cancel') || safeGet('modal-cancel');
        DOM.modals.generic.actions = safeGet('generic-modal-actions') || safeGet('modal-actions');
        DOM.modals.generic.icon = safeGet('generic-modal-icon');
    }

    DOM.modals.transaction.self = safeGet('tx-detail-modal') || safeGet('transaction-modal');
    if (DOM.modals.transaction.self) {
        DOM.modals.transaction.title = safeGet('tx-modal-title');
        DOM.modals.transaction.content = safeGet('tx-modal-content');
        DOM.modals.transaction.close = safeGet('tx-modal-close') || safeGet('close-tx-modal');
        DOM.modals.transaction.print = safeGet('tx-modal-print') || safeGet('print-tx-btn');
    }

    DOM.modals.stock.self = safeGet('stock-adjustment-modal');
    if (DOM.modals.stock.self) {
        DOM.modals.stock.title = safeGet('stock-modal-title');
        DOM.modals.stock.current = safeGet('stock-modal-current');
        DOM.modals.stock.form = safeGet('stock-adjustment-form');
        DOM.modals.stock.change = safeGet('stock-modal-change');
        DOM.modals.stock.reason = safeGet('stock-modal-reason');
        DOM.modals.stock.cancel = safeGet('stock-modal-cancel');
        DOM.modals.stock.confirm = safeGet('stock-modal-confirm');
    }

    DOM.modals.history.self = safeGet('cust-history-modal', true);
    if (DOM.modals.history.self) {
        DOM.modals.history.title = safeGet('history-modal-title');
        DOM.modals.history.subtitle = safeGet('history-modal-subtitle');
        DOM.modals.history.content = safeGet('history-modal-content');
        DOM.modals.history.close = safeGet('history-modal-close');
        DOM.modals.history.print = safeGet('history-modal-print');
    }

    DOM.modals.payroll.self = safeGet('payroll-modal');
    if(DOM.modals.payroll.self) {
        DOM.modals.payroll.title = safeGet('payroll-title') || safeGet('payroll-staff-name');
        DOM.modals.payroll.close = safeGet('payroll-close-btn') || safeGet('close-payroll-modal');
        DOM.modals.payroll.recordBtn = safeGet('payroll-record-btn') || safeGet('record-payment-btn');
        DOM.modals.payroll.historyList = safeGet('payroll-history-list') || safeGet('payroll-history-body');
        
        const pi = DOM.modals.payroll.inputs;
        pi.daily = safeGet('payroll-daily-rate') || safeGet('pay-daily-rate'); 
        pi.days = safeGet('payroll-days') || safeGet('pay-days');
        pi.bonus = safeGet('payroll-bonus') || safeGet('pay-bonus'); 
        pi.deduction = safeGet('payroll-deduction') || safeGet('pay-deduction');
        pi.advance = safeGet('payroll-advance-amount') || safeGet('pay-advance');
        pi.notes = safeGet('pay-notes'); 
        
        DOM.modals.payroll.display.total = safeGet('payroll-total');
        DOM.modals.payroll.display.unit = safeGet('payroll-unit-label');
        DOM.modals.payroll.display.rate = safeGet('payroll-rate-label');
        DOM.modals.payroll.sections.salary = safeGet('payroll-salary-fields');
        DOM.modals.payroll.sections.advance = safeGet('payroll-advance-fields');
    }

    // Scanner
    DOM.modals.scanner.self = safeGet('scanner-modal');
    if (DOM.modals.scanner.self) {
        DOM.modals.scanner.video = safeGet('scanner-video');
        DOM.modals.scanner.close = safeGet('close-scanner-btn');
    }

    // Datalists
    DOM.datalists.product = safeGet('product-search-list');
    DOM.datalists.customer = safeGet('customer-search-list');
    DOM.datalists.dealer = safeGet('dealer-search-list');
    DOM.datalists.customerId = safeGet('customer-id-list');
    DOM.datalists.dealerId = safeGet('dealer-id-list');
    DOM.datalists.staff = safeGet('staff-search-list');

    // Updater
    DOM.updater.toast = safeGet('update-toast', true);
    DOM.updater.title = safeGet('update-title', true);
    DOM.updater.message = safeGet('update-message', true);
    DOM.updater.actionBtn = safeGet('update-action-btn', true);
    DOM.updater.dismissBtn = safeGet('update-dismiss-btn', true);
    DOM.updater.progress = safeGet('update-progress-bar', true);
    DOM.updater.container = safeGet('update-progress-container', true);

    console.log("✅ DOM Elements Hydrated");
}

export function showToast(title, message, type = 'info') {
    if (!DOM.toasts) return;
    
    const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-indigo-600', warning: 'bg-orange-500' };
    const bgColor = colors[type] || colors.info;
    
    const toast = document.createElement('div');
    toast.className = `toast w-full ${bgColor} text-white p-4 rounded-lg shadow-lg flex items-start space-x-3 mb-3 animate-slideInFromRight`;
    toast.innerHTML = `
        <div class="flex-1">
            <h4 class="font-bold">${title}</h4>
            <p class="text-sm">${message.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
        </div>`;
    
    DOM.toasts.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-x-full', 'transition-all', 'duration-500');
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

// --- NEW SAAS-STYLE MODAL (Updated to support Images) ---
export function showModal(title, message, type = 'info', callback = null, imgUrl = null) {
    // 1. Remove any existing custom modals
    const existing = document.getElementById('global-custom-modal');
    if (existing) existing.remove();

    const legacyModal = DOM.modals?.generic?.self;
    if (legacyModal) {
        legacyModal.classList.add('hidden');
        legacyModal.classList.remove('flex');
    }

    // 2. Define themes
    let iconHtml = '';
    let iconBg = '';
    let iconColor = '';
    let btnColor = '';

    if (type === 'success') {
        iconBg = 'bg-emerald-100';
        iconColor = 'text-emerald-600';
        btnColor = 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200';
        iconHtml = `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>`;
    } else if (type === 'error') {
        iconBg = 'bg-red-100';
        iconColor = 'text-red-600';
        btnColor = 'bg-red-500 hover:bg-red-600 shadow-red-200';
        iconHtml = `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path></svg>`;
    } else if (type === 'warning') {
        iconBg = 'bg-amber-100';
        iconColor = 'text-amber-600';
        btnColor = 'bg-amber-500 hover:bg-amber-600 shadow-amber-200';
        iconHtml = `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;
    } else if (type === 'confirm') {
        iconBg = 'bg-blue-100';
        iconColor = 'text-blue-600';
        btnColor = 'bg-blue-600 hover:bg-blue-700 shadow-blue-200';
        iconHtml = `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
    } else {
        iconBg = 'bg-indigo-100';
        iconColor = 'text-indigo-600';
        btnColor = 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200';
        iconHtml = `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
    }

    // 🚀 NEW: Build the Image HTML block
    const imageHtml = imgUrl ? `
        <div class="w-full h-48 mb-6 overflow-hidden rounded-t-[2rem]">
            <img src="${imgUrl}" class="w-full h-full object-cover" alt="Broadcast Image">
        </div>
    ` : '';

    // 3. Handle Buttons
    let buttonsHtml = '';
    if (type === 'confirm') {
        buttonsHtml = `
            <div class="flex gap-3 mt-8">
                <button id="close-custom-modal-btn" class="flex-1 py-3.5 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all active:scale-95">Cancel</button>
                <button id="confirm-custom-modal-btn" class="flex-1 py-3.5 rounded-xl font-bold text-white transition-all shadow-lg active:scale-95 ${btnColor}">Confirm</button>
            </div>
        `;
    } else {
        buttonsHtml = `
            <button id="close-custom-modal-btn" class="w-full mt-8 py-3.5 rounded-xl font-bold text-white transition-all shadow-lg active:scale-95 ${btnColor}">Close</button>
        `;
    }

    // 4. Build the HTML structure
    const modalHtml = `
        <div id="global-custom-modal" class="fixed inset-0 z-[9999] flex items-center justify-center px-4 bg-slate-900/60  ">
            <div class="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm overflow-hidden transform transition-all scale-100  border border-white/20">
                ${imageHtml} <div class="p-8 text-center">
                    ${!imgUrl ? `<div class="w-20 h-20 rounded-full mx-auto flex items-center justify-center mb-5 ${iconBg} ${iconColor} shadow-inner ring-8 ring-white">${iconHtml}</div>` : ''}
                    <h3 class="text-2xl font-black text-slate-800 mb-2 tracking-tight">${title}</h3>
                    <div class="max-h-48 overflow-y-auto custom-scrollbar">
                        <p class="text-sm text-slate-500 leading-relaxed px-2">${message}</p>
                    </div>
                    ${buttonsHtml}
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = document.getElementById('global-custom-modal');
    
    // 5. Closing Logic
    const closeModal = () => {
        if (!modal) return;
        modal.classList.add('opacity-0'); 
        setTimeout(() => { if (document.body.contains(modal)) modal.remove(); }, 200); 
    };

    const closeBtn = document.getElementById('close-custom-modal-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    
    const confirmBtn = document.getElementById('confirm-custom-modal-btn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            if (typeof callback === 'function') callback();
            closeModal();
        });
    }
}

// 6. Provide a global hideModal that specifically targets our new custom modal
export function hideModal() {
    const customModal = document.getElementById('global-custom-modal');
    if (customModal) {
        customModal.classList.add('opacity-0'); 
        setTimeout(() => {
            if (document.body.contains(customModal)) customModal.remove();
        }, 200); 
    }
    
    // Also try to hide the legacy DOM modal just in case
    const legacyModal = DOM.modals?.generic?.self;
    if (legacyModal) {
        legacyModal.classList.add('hidden');
        legacyModal.classList.remove('flex');
    }
}