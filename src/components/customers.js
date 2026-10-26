// src/components/customers.js

import { 
    getCustomersRef,        
    getTransactionsRef,     
    CURRENT_CURRENCY_SYMBOL, 
    getCurrentUserPlan,
    registerListener,
    currentLocationId,
    userRole,
    appId,
    editingCustomerId, 
    setEditingCustomerId,
    getAvailableLocations,
    getUserRole,
    getCurrentLocationId,
    setCurrentLocation,
    getUserAssignedLocationId,
    getCurrencySymbol,
    getCurrencyCode,
    getUserId,
    getStoreId,
    AppState
} from '../store/state.js';
import { DOM, showModal, showToast } from '../utils/dom.js';
import { escapeHTML } from '../utils/security.js'; 
import { generateMerchantId, generateCustomerId } from '../utils/ids.js'; 
// --- State ---
let localCustomersCache = [];
let localTransactionsCache = []; 
let isListenersAttached = false; 
let customerUnsubscribe = null;
let lookupDebounceTimer = null;
let currentPartnerTab = 'customer'; // Default tab
let currentCustomersPage = 1;
const itemsPerPage = 10;

// Inside src/components/customers.js

// --- Helper: Role & Location Context ---
function getUserContext() {
    const role = typeof getUserRole === 'function' ? getUserRole() : 'admin';
    const assignedLoc = typeof getUserAssignedLocationId === 'function' ? getUserAssignedLocationId() : 'main';
    let currentLoc = typeof getCurrentLocationId === 'function' ? getCurrentLocationId() : 'main';
    
    // 🚀 THE FIX: Removed the undefined 'hasMultiLoc' variable. 
    // Admins and Accountants now inherently have multi-location access offline.
    const canAccessAllLocations = (role === 'admin' || role === 'accountant');
    
    if (currentLoc === 'all') currentLoc = 'main';

    return { role, assignedLoc, currentLoc, canAccessAllLocations };
}

export async function loadCustomersPage() {
    try {
        if (!isListenersAttached) {
            setupCustomerListeners();
            upgradePartnerTypeDropdown();
            injectExtraCustomerFields();
            injectClearButton();
            reorderPartnerFields();
            injectFetchInstruction();
            injectLocationDropdown();
            injectLocationFilterDropdown();
            injectCleanupButton();
            injectRegistryButton();
            injectCustomersCopyright();
            isListenersAttached = true;
            
            // 🚀 THE FIX: Bind AppState Re-Renders
            if (typeof AppState !== 'undefined') {
                AppState.subscribe('customers_updated', async () => {
                    const custSection = document.getElementById('customers');
                    if (custSection && !custSection.classList.contains('hidden')) {
                        await refreshCustomerIndex();
                    }
                });
                
                AppState.subscribe('transactions_updated', async () => {
                    const custSection = document.getElementById('customers');
                    if (custSection && !custSection.classList.contains('hidden')) {
                        // Update today's live sales/purchases stats on the cards
                        fetchAndInjectTodayStats(localCustomersCache);
                    }
                });
            }
        }

        // --- Execute the initial load ---
        await refreshCustomerIndex();
        
    } catch (error) {
        console.error("Setup Error in Customers:", error);
    }
}

async function refreshCustomerIndex() {
    if (window.dbAPI && window.dbAPI.getCustomers) {
        const rawCustomers = await window.dbAPI.getCustomers();
        
        localCustomersCache = rawCustomers.filter(c => {
            const cid = String(c.id || c.docId || c.merchantId || '');
            if (c.role !== undefined || c.permissions !== undefined) return false;
            if (c.date !== undefined && c.records !== undefined) return false;
            if (cid.includes('shifts_') || Array.isArray(c.records)) return false;
            if (cid.includes('_att_') || cid.includes('helper_') || cid.includes('staff_') || cid.includes('user_')) return false;
            return true;
        });
        
        if (typeof renderCustomerTable === 'function') {
            renderCustomerTable();
        }
        
        // 🚀 THE FIX: Use the correct datalist function name for customers.js
        if (typeof updateDatalists === 'function') {
            updateDatalists();
        }
        
        if (typeof renderCustomerDropdown === 'function') {
            renderCustomerDropdown('');
        }
    }
}

// --- DOM Injection Helpers ---
function upgradePartnerTypeDropdown() {
    const typeDropdown = document.getElementById('cust-form-type') || document.querySelector('select[name="type"]');
    
    if (typeDropdown && !typeDropdown.querySelector('option[value="supplier"]')) {
        const currentVal = typeDropdown.value;
        
        typeDropdown.innerHTML = `
            <option value="customer">Retail Customer</option>
            <option value="dealer">Wholesale Dealer / Trader</option>
            <option value="supplier">Supplier (Raw Materials)</option>
            <option value="store">Internal Store / Branch</option>
        `;
        
        if (currentVal) typeDropdown.value = currentVal;
    }
}
function injectCleanupButton() {
    const container = document.getElementById('dynamic-actions-container');
    if (container && !document.getElementById('run-cleanup-btn')) {
        const btn = document.createElement('button');
        btn.id = 'run-cleanup-btn';
        btn.className = "bg-orange-50 text-orange-600 border border-orange-200 px-4 py-2.5 rounded-xl text-sm font-bold shadow-sm hover:bg-orange-100 transition-all whitespace-nowrap flex items-center gap-2";
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg> Fix Duplicates`;
        
        btn.onclick = async () => {
            if(confirm("Scan the directory and merge all duplicate partners based on their phone numbers?")) {
                btn.innerHTML = `<svg class="animate-spin h-4 w-4 inline-block mr-1" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Processing...`;
                btn.disabled = true;
                try {
                    const result = await runDirectoryCleanup((msg) => console.log(msg));
                    if(result.success) showModal("Success", `Merged ${result.mergedCount} duplicate groups!`, "success");
                    else showModal("Complete", "No duplicates found.", "info");
                } catch (e) {
                    showModal("Error", "Cleanup failed: " + e.message, "error");
                }
                btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg> Fix Duplicates`;
                btn.disabled = false;
            }
        };
        container.appendChild(btn);
    }
}


function injectCustomersCopyright() {
    const customersSection = document.getElementById('customers');
    if (customersSection && !document.getElementById('customers-copyright-footer')) {
        const footer = document.createElement('div');
        footer.id = 'customers-copyright-footer';
        footer.className = "py-8 text-center border-t border-gray-100 mt-8";
        footer.innerHTML = `
            <div class="flex flex-col items-center gap-1.5">
                <p class="text-[10px] font-bold text-gray-400 tracking-[0.3em] uppercase">Mifela Inventory Management</p>
                <p class="text-[11px] text-gray-500 font-medium">© 2026 All Rights Reserved</p>
            </div>
        `;
        customersSection.appendChild(footer);
    }
}
export function getLoyaltyTier(points) {
    if (points >= 5000) return { name: 'PLATINUM', color: 'bg-indigo-600 text-white border border-indigo-700' };
    if (points >= 2000) return { name: 'GOLD', color: 'bg-amber-400 text-white border border-amber-500' };
    if (points >= 500) return { name: 'SILVER', color: 'bg-slate-300 text-slate-800 border border-slate-400' };
    return { name: 'BRONZE', color: 'bg-orange-200 text-orange-900 border border-orange-300' };
}

function injectExtraCustomerFields() {
    const form = DOM.customers.form || document.querySelector('#customer-form');
    if (!form) return;

    if (!document.getElementById('cust-form-alt-phone')) {
        let typeInput = document.getElementById('cust-form-type');
        if (typeInput) {
            const container = document.createElement('div');
            container.className = "mt-4";
            container.innerHTML = `
                <label class="block text-sm font-medium text-gray-700">Alternative Phone (Optional)</label>
                <input type="tel" id="cust-form-alt-phone" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border focus:ring-indigo-500 focus:border-indigo-500" placeholder="+91 88888 88888">
            `;
            typeInput.closest('div').insertAdjacentElement('afterend', container);

            const obContainer = document.createElement('div');
            obContainer.className = "mt-4 bg-amber-50 border border-amber-200 p-3 rounded-xl shadow-sm";
            obContainer.innerHTML = `
                <label class="block text-xs font-black text-amber-800 uppercase tracking-wide">Opening Balance / Prev Dues (₹)</label>
                <p class="text-[10px] text-amber-600 mb-1.5 font-medium leading-tight">Positive = They owe you. Negative = You owe them.</p>
                <input type="number" step="0.01" id="cust-form-opening-balance" class="mt-1 block w-full rounded-md border-amber-300 shadow-sm p-2 border font-bold text-amber-900 focus:ring-amber-500 focus:border-amber-500 bg-white placeholder-amber-300" placeholder="0.00">
            `;
            container.insertAdjacentElement('afterend', obContainer);
        }
    }

    if (!document.getElementById('cust-form-pan')) {
        let gstinInput = document.getElementById('cust-form-gstin');
        if (gstinInput) {
            const gstinWrapper = gstinInput.closest('div'); 
            if (gstinWrapper) {
                gstinWrapper.insertAdjacentHTML('afterend', `
                    <div id="cust-pan-wrapper" class="mt-4">
                        <label class="block text-sm font-medium text-gray-700">PAN NO</label>
                        <input type="text" id="cust-form-pan" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border uppercase font-mono focus:ring-indigo-500 focus:border-indigo-500" placeholder="ABCDE1234F">
                    </div>
                `);
            }
        }
    }
}

function injectClearButton() {
    const saveBtn = DOM.customers.saveBtn;
    if (saveBtn && saveBtn.parentNode && !document.getElementById('cust-form-clear-btn')) {
        const clearBtn = document.createElement('button');
        clearBtn.id = 'cust-form-clear-btn';
        clearBtn.type = 'button';
        clearBtn.className = "px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 mr-2 transition-colors";
        clearBtn.innerHTML = "Clear";
        clearBtn.onclick = resetCustomerForm;
        saveBtn.parentNode.insertBefore(clearBtn, saveBtn);
    }
}

function reorderPartnerFields() {
    const nameInput = DOM.customers.inputs.name;
    const phoneInput = DOM.customers.inputs.phone;
    const idInput = DOM.customers.inputs.id;

    if (nameInput && phoneInput && idInput) {
        const nameContainer = nameInput.closest('.col-span-1') || nameInput.parentElement;
        const phoneContainer = phoneInput.closest('.col-span-1') || phoneInput.parentElement;
        const idContainer = idInput.closest('.col-span-1') || idInput.parentElement;
        const parent = phoneContainer.parentNode;

        if (nameContainer && phoneContainer && idContainer && parent) {
            parent.insertBefore(phoneContainer, parent.firstChild);
            parent.insertBefore(idContainer, phoneContainer.nextSibling);
            parent.insertBefore(nameContainer, idContainer.nextSibling);
        }
    }
}

function injectFetchInstruction() {
    const idInput = DOM.customers.inputs.id;
    if (idInput && !document.getElementById('cust-fetch-instruction')) {
        const hint = document.createElement('div');
        hint.id = 'cust-fetch-instruction';
        hint.className = "text-[10px] text-indigo-600 font-bold mt-1.5 flex items-center gap-1 bg-indigo-50 p-2 rounded-lg border border-indigo-100 animate-pulse w-full shadow-sm mb-4";
        hint.innerHTML = `
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            Input Phone or ID above to Fetch Details
        `;
        const idContainer = idInput.closest('.col-span-1') || idInput.parentElement;
        if(idContainer) idContainer.appendChild(hint);
    }
}

function injectLocationDropdown() {
    const { canAccessAllLocations, currentLoc } = getUserContext();
    if (!canAccessAllLocations) return;

    const form = DOM.customers.form;
    if (!form || document.getElementById('cust-form-location-section')) return;

    const typeInput = DOM.customers.inputs.type;
    if (typeInput) {
        const availLocs = typeof getAvailableLocations === 'function' ? getAvailableLocations() : []; 
        let optionsHtml = '';
        if (availLocs && availLocs.length > 0) {
            optionsHtml = availLocs.map(loc => 
                `<option value="${loc.id}" ${loc.id === currentLoc ? 'selected' : ''}>${escapeHTML(loc.name || loc.id)}</option>`
            ).join('');
        } else {
            optionsHtml = `<option value="main">Main Store</option>`;
        }

        const container = document.createElement('div');
        container.id = 'cust-form-location-section';
        container.innerHTML = `
            <label class="block text-sm font-medium text-gray-700 mb-1">Assigned Location (Admin)</label>
            <select id="cust-form-location" class="block w-full rounded-md border-gray-300 shadow-sm p-2 border bg-white focus:ring-indigo-500 focus:border-indigo-500">
                ${optionsHtml}
            </select>
        `;
        
        const wrapper = typeInput.closest('.col-span-1') || typeInput.parentElement;
        if (wrapper) wrapper.insertAdjacentElement('afterend', container);
    }
}

function injectLocationFilterDropdown() {
    const { canAccessAllLocations } = getUserContext();
    if (!canAccessAllLocations) return;
    
    const typeFilter = DOM.customers.filter;
    if (!typeFilter || document.getElementById('cust-table-location-filter')) return;

    const availLocs = typeof getAvailableLocations === 'function' ? getAvailableLocations() : [];
    let optionsHtml = `<option value="all">All Locations</option>`;
    
    if (availLocs && availLocs.length > 0) {
        optionsHtml += availLocs.map(loc => 
            `<option value="${loc.id}">${escapeHTML(loc.name || loc.id)}</option>`
        ).join('');
    } else {
        optionsHtml += `<option value="main">Main Store</option>`;
    }

    const select = document.createElement('select');
    select.id = 'cust-table-location-filter';
    select.className = "ml-2 inline-block rounded-md border-gray-300 shadow-sm p-1.5 text-sm border bg-white focus:ring-indigo-500 focus:border-indigo-500";
    select.innerHTML = optionsHtml;

    select.addEventListener('change', () => {
        currentCustomersPage = 1;
        renderCustomerTable();
    });

    typeFilter.insertAdjacentElement('afterend', select);
}

// --- VALIDATION & HELPERS ---

function isDummyData(val) {
    const s = String(val || '').toLowerCase().trim();
    if (!s) return false; 
    const keywords = ["test", "dummy", "null", "placeholder"];
    return keywords.includes(s);
}

function validatePartnerData(data) {
    const { name, phone, altPhone, email, state, address, bankDetails, type, gstin } = data;

    if (!name || name.length < 2) return "Partner Name is required.";
    if (isDummyData(name)) return "Please enter a valid Name.";

    // --- NEW: Bypass all strict checks for Internal Stores! ---
    if (type === 'store') return null; 

    const phoneRegex = /^\+91\d{10}$/; 
    if (!phoneRegex.test(phone)) return "Valid 10-digit Phone Number is required.";
    
    if (altPhone && !phoneRegex.test(altPhone)) return "Alternative Phone must be a valid 10-digit number.";
    if (altPhone && phone === altPhone) return "Alternative phone cannot be same as main phone.";

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Invalid Email format.";

    const isDealer = type === 'dealer';

    if (isDealer) {
        if (!gstin || gstin.length < 15) return "GSTIN is mandatory for Dealers.";
        if (!address || address.length < 5) return "Address is mandatory for Dealers.";
        if (!state) return "State is mandatory for Dealers.";
    }

    const hasBankData = bankDetails.bankName || bankDetails.accountNumber || bankDetails.ifsc;
    
    if (hasBankData) {
        if (!bankDetails.bankName) return "Bank Name is required (since other bank details are present).";
        if (!bankDetails.accountNumber) return "Account Number is required.";
        if (!bankDetails.ifsc) return "IFSC Code is required.";
    }

    return null; 
}

async function handlePartnerLookup(triggerType) {
    const formInputs = {
        type: document.getElementById('cust-form-type'),
        id: document.getElementById('cust-form-id'),
        name: document.getElementById('cust-form-name'),
        phone: document.getElementById('cust-form-phone'),
        email: document.getElementById('cust-form-email'),
        address: document.getElementById('cust-form-address'),
        state: document.getElementById('cust-form-state'),
        gstin: document.getElementById('cust-form-gstin'),
        pan: document.getElementById('cust-form-pan'),
        altPhone: document.getElementById('cust-form-alt-phone'),
        bankName: document.getElementById('cust-form-bank-name'),
        accNum: document.getElementById('cust-form-account-num'),
        ifsc: document.getElementById('cust-form-ifsc'),
        branch: document.getElementById('cust-form-branch'),
        altBankName: document.getElementById('cust-form-alt-bank-name'),
        altAccNum: document.getElementById('cust-form-alt-account-num'),
        altIfsc: document.getElementById('cust-form-alt-ifsc'),
        altBranch: document.getElementById('cust-form-alt-branch')
    };

    let val = '';
    
    if (triggerType === 'id') {
        val = formInputs.id?.value.trim() || '';
        if (val.length < 3) return;
        if (val.toUpperCase().startsWith('CUST-')) return;
    } else if (triggerType === 'phone') {
        let rawVal = formInputs.phone?.value.trim() || '';
        const digits = rawVal.replace(/\D/g, '');
        if (digits.length < 10) return;
        val = (digits.length === 10) ? '+91' + digits : '+' + digits.slice(-12);
    }

    const inputEl = triggerType === 'id' ? formInputs.id : formInputs.phone;
    if (inputEl) inputEl.classList.add('animate-pulse', 'border-indigo-400');

    try {
        let found = null;
        
        // 🚀 THE FIX: Use local SQLite instead of Firebase collection()
        if (window.dbAPI && window.dbAPI.getCustomers) {
            const allCustomers = await window.dbAPI.getCustomers();
            
            if (triggerType === 'id') {
                found = allCustomers.find(c => c.id === val || c.merchantId === val);
            } else {
                const rawDigits = formInputs.phone?.value.replace(/\D/g, '').slice(-10) || ''; 
                if (rawDigits.length === 10) {
                    const candidates = [
                        `+91${rawDigits}`, rawDigits, `0${rawDigits}`, 
                        `+91 ${rawDigits.slice(0,5)} ${rawDigits.slice(5)}` 
                    ];
                    found = allCustomers.find(c => candidates.includes(c.phone));
                }
            }
        }

        if (found) {
            if (formInputs.name) formInputs.name.value = found.storeName || found.name || '';
            if (formInputs.email) formInputs.email.value = found.email || '';
            if (formInputs.address) formInputs.address.value = found.address || '';
            if (formInputs.state) formInputs.state.value = found.state || '';
            if (formInputs.id) formInputs.id.value = found.merchantId || found.id || '';
            if (formInputs.gstin) formInputs.gstin.value = found.gstin || ''; 
            
            if (triggerType === 'id' && formInputs.phone) formInputs.phone.value = found.phone || '';
            if (formInputs.type) formInputs.type.value = 'dealer'; 

            if (formInputs.pan) formInputs.pan.value = found.pan || '';
            if (formInputs.altPhone) formInputs.altPhone.value = found.altPhone || '';

            handlePartnerTypeChange();
            
            if (found.bankDetails) {
                 if (formInputs.bankName) formInputs.bankName.value = found.bankDetails.bankName || '';
                 if (formInputs.accNum) formInputs.accNum.value = found.bankDetails.accountNumber || '';
                 if (formInputs.ifsc) formInputs.ifsc.value = found.bankDetails.ifsc || '';
                 if (formInputs.branch) formInputs.branch.value = found.bankDetails.branch || '';
            }

            if (found.altBankDetails) {
                if (formInputs.altBankName) formInputs.altBankName.value = found.altBankDetails.bankName || '';
                if (formInputs.altAccNum) formInputs.altAccNum.value = found.altBankDetails.accountNumber || '';
                if (formInputs.altIfsc) formInputs.altIfsc.value = found.altBankDetails.ifsc || '';
                if (formInputs.altBranch) formInputs.altBranch.value = found.altBankDetails.branch || '';
            }
            
            const fieldsToLock = [
                formInputs.name, formInputs.email, formInputs.address, formInputs.state, formInputs.phone, formInputs.gstin,
                formInputs.bankName, formInputs.accNum, formInputs.ifsc, formInputs.branch, formInputs.type, formInputs.id,
                formInputs.pan,  formInputs.altPhone 
            ];

            fieldsToLock.forEach(el => {
                if (el) {
                    el.disabled = true;
                    el.classList.add('bg-gray-100', 'text-gray-500', 'cursor-not-allowed', 'border-gray-200');
                    el.classList.remove('bg-white', 'border-gray-300');
                }
            });

            if (typeof showToast === 'function') showToast("Success", `Merchant found locally: ${found.storeName || found.name}`, "success");
        }
    } catch (e) {
        console.error("Lookup failed", e);
    } finally {
        if (inputEl) inputEl.classList.remove('animate-pulse', 'border-indigo-400');
    }
}

export async function handleCustomerSubmit(e) {
    e.preventDefault();
    
    const formInputs = {
        type: document.getElementById('cust-form-type'),
        name: document.getElementById('cust-form-name'),
        phone: document.getElementById('cust-form-phone'),
        email: document.getElementById('cust-form-email'),
        address: document.getElementById('cust-form-address'),
        state: document.getElementById('cust-form-state'),
        gstin: document.getElementById('cust-form-gstin'),
        pan: document.getElementById('cust-form-pan'),
        altPhone: document.getElementById('cust-form-alt-phone'),
        nfcCardId: document.getElementById('cust-form-nfc-id'),
        dealerType: document.getElementById('cust-form-dealer-type'),
        bankName: document.getElementById('cust-form-bank-name'),
        accNum: document.getElementById('cust-form-account-num'),
        ifsc: document.getElementById('cust-form-ifsc'),
        branch: document.getElementById('cust-form-branch'),
        openingBalance: document.getElementById('cust-form-opening-balance'),
        altBankName: document.getElementById('cust-form-alt-bank-name'),
        altAccNum: document.getElementById('cust-form-alt-account-num'),
        altIfsc: document.getElementById('cust-form-alt-ifsc'),
        altBranch: document.getElementById('cust-form-alt-branch')
    };
    
    const normalizePhone = (val) => {
        const digits = (val || '').trim().replace(/\D/g, '');
        if (!digits) return '';
        if (digits.length === 10) return '91' + digits;
        if (digits.length > 10 && digits.startsWith('91')) return digits;
        return (val || '').trim();
    };

    const panVal = formInputs.pan?.value.trim().toUpperCase() || '';
    const dealerTypeVal = formInputs.dealerType?.value || 'regular';
    const altPhoneVal = formInputs.altPhone?.value || '';
    const openingBalanceVal = parseFloat(formInputs.openingBalance?.value) || 0;
    const nfcCardId = formInputs.nfcCardId?.value.trim() || '';
    const rawPhoneDigits = normalizePhone(formInputs.phone?.value);
    
    const rawData = {
        name: formInputs.name?.value.trim() || '',
        phone: rawPhoneDigits ? `+${rawPhoneDigits}` : '',
        altPhone: normalizePhone(altPhoneVal) ? `+${normalizePhone(altPhoneVal)}` : '',
        type: formInputs.type?.value || 'customer',
        email: formInputs.email?.value.trim() || '',
        state: formInputs.state?.value.trim() || '',
        address: formInputs.address?.value.trim() || '',
        gstin: formInputs.gstin ? formInputs.gstin.value.trim() : '',
        pan: panVal,
        dealerType: dealerTypeVal,
        bankDetails: {
            bankName: formInputs.bankName?.value.trim() || '',
            accountNumber: formInputs.accNum?.value.trim() || '',
            ifsc: formInputs.ifsc?.value.trim().toUpperCase() || '',
            branch: formInputs.branch?.value.trim() || ''
        },
        altBankDetails: {
            bankName: formInputs.altBankName?.value.trim() || '',
            accountNumber: formInputs.altAccNum?.value.trim() || '',
            ifsc: formInputs.altIfsc?.value.trim().toUpperCase() || '',
            branch: formInputs.altBranch?.value.trim() || ''
        },
        nfcCardId: nfcCardId,
        cardNumber: nfcCardId
    };

    const errorMsg = validatePartnerData(rawData);
    if (errorMsg) {
        showModal('Validation Failed', errorMsg, 'error');
        return;
    }

    const { canAccessAllLocations, assignedLoc } = getUserContext();
    let safeLocation = assignedLoc; 
    if (canAccessAllLocations) {
        const locDropdown = document.getElementById('cust-form-location');
        if (locDropdown && locDropdown.value) safeLocation = locDropdown.value;
        else safeLocation = 'main'; 
    }

    try {
        const generateSafeId = (str) => {
            let hash = 0x811c9dc5;
            for (let i = 0; i < str.length; i++) hash = ((hash ^= str.charCodeAt(i)) * 0x01000193) >>> 0;
            return hash.toString(36).toUpperCase().padStart(6, '0');
        };

        let finalId = editingCustomerId || (rawPhoneDigits.length >= 10 ? (rawData.type === 'customer' ? `CUST-${generateSafeId(rawPhoneDigits)}` : `MERCH-${generateSafeId(rawPhoneDigits)}`) : (rawData.type === 'customer' ? generateCustomerId() : generateMerchantId()));

        const payload = {
            id: finalId, name: rawData.name, phone: rawData.phone, altPhone: rawData.altPhone,
            type: rawData.type, email: rawData.email, state: rawData.state, address: rawData.address,
            gstin: rawData.gstin, pan: rawData.pan, dealerType: rawData.dealerType,
            bankDetails: rawData.bankDetails, altBankDetails: rawData.altBankDetails,
            searchKey: rawData.name.toLowerCase(), locationId: safeLocation,
            openingBalance: openingBalanceVal, updatedAt: new Date().toISOString()
        };

        let balanceDiff = 0;
        if (editingCustomerId) {
            const oldCustomerData = localCustomersCache.find(c => c.docId === editingCustomerId || c.id === editingCustomerId);
            const oldOB = parseFloat(oldCustomerData?.openingBalance || 0);
            balanceDiff = openingBalanceVal - oldOB;
            if (balanceDiff !== 0) payload.dues = (parseFloat(oldCustomerData?.dues) || 0) + balanceDiff;
        } else {
            if (openingBalanceVal !== 0) {
                payload.dues = openingBalanceVal;
                balanceDiff = openingBalanceVal;
            }
            payload.createdAt = new Date().toISOString();
        }

        let obTxData = null;
        if (balanceDiff !== 0) {
            obTxData = {
                id: `OB-ADJ-${Date.now().toString().slice(-6)}`,
                invoiceId: `OB-ADJ-${Date.now().toString().slice(-6)}`,
                locationId: safeLocation, timestamp: new Date().toISOString(), type: 'ADJUSTMENT',
                customer: { id: finalId, name: rawData.name, gstin: rawData.gstin || '' },
                summary: { total: balanceDiff, profit: 0, paymentMethod: 'SYSTEM', reason: editingCustomerId ? 'Opening Balance Correction' : 'Initial Opening Balance', transactionType: 'OPENING_BALANCE' },
                items: [], currency: { symbol: '₹' }
            };
        }

        // 🚀 THE FIX: Send the payload locally
        if (window.dbAPI && window.dbAPI.savePartnerWithOpeningBalance) {
            await window.dbAPI.savePartnerWithOpeningBalance({ customer: payload, obTransaction: obTxData });
        }

        showModal('Success', editingCustomerId ? 'Partner updated!' : 'New partner added!', 'success');
        resetCustomerForm();
        if (typeof loadCustomersPage === 'function') loadCustomersPage(); // Refresh local cache
    } catch (error) {
        showModal('Error', 'Failed to save: ' + error.message, 'error');
    }
}

export async function processEarnedTokens(customerId, transactionTotal) {
    if (customerId === 'WALK-IN') return;
    const config = await getLoyaltyConfig();
    if (!config.enabled) return;

    const tokensEarned = Math.floor(transactionTotal / config.earnRatio);
    if (tokensEarned <= 0) return;

    try {
        if (window.dbAPI && window.dbAPI.updateLoyaltyTokens) {
            await window.dbAPI.updateLoyaltyTokens(customerId, tokensEarned);
            showToast('Loyalty Tokens', `Customer earned ${tokensEarned} tokens!`, 'success');
        }
    } catch (e) { console.error("Token update failed:", e); }
}

export async function deleteCustomer(id, name) {
    const customer = localCustomersCache.find(c => c.id === id);
    const type = customer ? (customer.type || 'customer') : 'partner';

    if (!confirm(`Are you sure you want to permanently delete ${name} from the ${type.toUpperCase()} directory?\n\nTheir history will remain safely stored in the Ledger.`)) return;

    try {
        if (window.dbAPI && window.dbAPI.deleteCustomer) {
            await window.dbAPI.deleteCustomer(id);
            showModal('Deleted', `Successfully removed ${escapeHTML(name)}.`, 'success');
            if (typeof loadCustomersPage === 'function') loadCustomersPage();
        }
    } catch (error) { showModal('Error', error.message, 'error'); }
}

export async function resetPartnerAccount(id, name) {
    if (!confirm(`⚠️ HARD RESET: Are you sure you want to completely wipe the account for ${name}? This action cannot be undone.`)) return;

    try {
        if (window.dbAPI && window.dbAPI.resetPartnerAccount) {
            await window.dbAPI.resetPartnerAccount(id);
            showToast('Account Reset', `${escapeHTML(name)} is now a fresh entry.`, 'success');
            if (typeof loadCustomersPage === 'function') loadCustomersPage();
        }
    } catch (error) { showModal('Error', error.message, 'error'); }
}

export async function runDirectoryCleanup(logCallback) {
    try {
        const activeType = document.querySelector('.cust-tab-btn.active')?.dataset.type || 'customer';
        logCallback("Scanning local directory for duplicate phone numbers...");
        
        if (window.dbAPI && window.dbAPI.runDirectoryCleanup) {
            const result = await window.dbAPI.runDirectoryCleanup(activeType);
            if (result.success && result.mergedCount > 0) {
                if (typeof loadCustomersPage === 'function') loadCustomersPage();
                return result;
            }
            return { success: false, mergedCount: 0 };
        }
    } catch (error) { throw error; }
}

// 🚀 OMIT RECORD CALENDAR HISTORY ENTIRELY (SQLite calculates this dynamically, we don't need pre-aggregated docs)
export async function recordTransactionToCustomerHistory() { return; }

export function resetCustomerForm() {
    setEditingCustomerId(null);
    if(DOM.customers.form) DOM.customers.form.reset();
    if(DOM.customers.formTitle) DOM.customers.formTitle.textContent = 'Fetch / Add Partner';
    
    if (DOM.customers.saveBtn) DOM.customers.saveBtn.textContent = 'Save Partner';
    if (DOM.customers.cancelBtn) DOM.customers.cancelBtn.classList.add('hidden');
    
    const { canAccessAllLocations, currentLoc, assignedLoc } = getUserContext();
    const locDropdown = document.getElementById('cust-form-location');
    
    if (locDropdown) {
        if (!canAccessAllLocations) {
             locDropdown.value = assignedLoc;
        } else if (!locDropdown.value) {
             locDropdown.value = 'main';
        }
    }

    // 1. 🚀 DECLARE customerSection FIRST
    const customerSection = document.getElementById('customers');

    // 2. 🚀 UNLOCK OPENING BALANCE
    const obInput = customerSection?.querySelector('#cust-form-opening-balance');
    if (obInput) {
        obInput.value = '';
        obInput.disabled = false;
        obInput.classList.remove('bg-gray-100', 'text-gray-500', 'cursor-not-allowed', 'border-gray-200');
        obInput.classList.add('bg-white');
    }

    // 3. 👻 GHOST-PROOF CLEARING
    const extraSelectors = [
        '#cust-form-alt-phone', '#cust-form-alt-bank-name', 
        '#cust-form-alt-account-num', '#cust-form-alt-ifsc', '#cust-form-alt-branch',
        '#cust-form-pan', '#cust-form-nfc-id' 
    ];
    
    if (customerSection) {
        extraSelectors.forEach(selector => {
            const el = customerSection.querySelector(selector);
            if (el) el.value = '';
        });
    }
    
    const fieldsToUnlock = [
        DOM.customers.inputs.name, DOM.customers.inputs.phone, DOM.customers.inputs.email,
        DOM.customers.inputs.address, DOM.customers.inputs.state, DOM.customers.inputs.gstin,
        DOM.customers.inputs.bankName, DOM.customers.inputs.accNum,
        DOM.customers.inputs.ifsc, DOM.customers.inputs.branch,
        DOM.customers.inputs.type, 
        customerSection?.querySelector('#cust-form-alt-phone')
    ];

    fieldsToUnlock.forEach(el => {
        if(el) {
            el.disabled = false;
            el.classList.remove('bg-gray-100', 'text-gray-500', 'cursor-not-allowed', 'border-gray-200');
            el.classList.add('bg-white', 'border-gray-300');
        }
    });

    if(DOM.customers.inputs.id) {
        DOM.customers.inputs.id.disabled = false;
        DOM.customers.inputs.id.classList.remove('bg-gray-100', 'text-gray-500', 'cursor-not-allowed', 'border-gray-200');
    }
    
    if(DOM.customers.inputs.type) DOM.customers.inputs.type.value = 'customer';    
    toggleCustomerForm(false);
    handlePartnerTypeChange();
}

export function handlePartnerTypeChange() {
    const customerSection = document.getElementById('customers');
    if (!customerSection) return;

    const typeInput = DOM.customers.inputs.type || customerSection.querySelector('#cust-form-type');
    const type = typeInput?.value?.toLowerCase() || '';

    const gstinInput = DOM.customers.inputs.gstin || customerSection.querySelector('#cust-form-gstin');
    const panInput = customerSection.querySelector('#cust-form-pan');

    if (gstinInput) {
        const gstinWrapper = gstinInput.closest('div');
        const panWrapper = panInput?.closest('div');

        if (gstinWrapper) {
            if (type === 'dealer') {
                // Show fields
                gstinWrapper.classList.remove('hidden');
                if (panWrapper) panWrapper.classList.remove('hidden');
            } else {
                // Hide fields and clear out stray data
                gstinWrapper.classList.add('hidden');
                gstinInput.value = ''; 
                
                if (panWrapper) {
                    panWrapper.classList.add('hidden');
                    if (panInput) panInput.value = '';
                }
            }
        }
    }
}

export function handleCustomerFilterChange() {
    currentCustomersPage = 1;
    renderCustomerTable();
}

// --- Private Helpers ---
function setupCustomerListeners() {
    const tabContainer = document.getElementById('partner-tabs-container');
    if (tabContainer) {
        tabContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.cust-tab-btn');
            if (!btn) return;
            
            document.querySelectorAll('.cust-tab-btn').forEach(b => {
                b.classList.remove('active', 'bg-white', 'shadow-sm', 'text-indigo-600', 'border-indigo-200');
                b.classList.add('text-slate-500', 'hover:bg-slate-50');
            });
            
            btn.classList.remove('text-slate-500', 'hover:bg-slate-50');
            btn.classList.add('active', 'bg-white', 'shadow-sm', 'text-indigo-600', 'border-indigo-200');
            
            currentPartnerTab = btn.dataset.type;
            currentCustomersPage = 1;
            
            const exportBtn = document.getElementById('dynamic-export-btn');
            if (exportBtn) {
                if (currentPartnerTab === 'history') exportBtn.style.display = 'none';
                else {
                    exportBtn.style.display = 'block';
                    exportBtn.textContent = `Export ${currentPartnerTab.charAt(0).toUpperCase() + currentPartnerTab.slice(1)}s`;
                }
            }

            if (currentPartnerTab === 'history') renderGlobalHistoryTable();
            else renderCustomerTable();
        });
    }

    const searchInput = document.getElementById('customer-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            currentCustomersPage = 1; 
            if (currentPartnerTab === 'history') renderGlobalHistoryTable();
            else renderCustomerTable();
        });
    }

    const customerForm = document.getElementById('customer-form');
    if (customerForm) {
        customerForm.removeEventListener('submit', handleCustomerSubmit);
        customerForm.addEventListener('submit', handleCustomerSubmit);
    }
    
    document.getElementById('add-new-partner-btn')?.addEventListener('click', () => {
        resetCustomerForm();
        toggleCustomerModal(true);
    });

    document.getElementById('close-customer-modal-btn')?.addEventListener('click', () => { resetCustomerForm(); toggleCustomerModal(false); });
    document.getElementById('cancel-customer-edit-btn')?.addEventListener('click', () => { resetCustomerForm(); toggleCustomerModal(false); });
    document.getElementById('dynamic-export-btn')?.addEventListener('click', triggerExportForCurrentTab);

    // Auto-format Phones
    const applyGhostPrefix = (id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('blur', () => {
            let val = el.value.trim();
            const digits = val.replace(/\D/g, '');
            if (digits.length === 10) el.value = '+91' + digits;
        });
    };
    applyGhostPrefix('cust-form-phone');
    applyGhostPrefix('cust-form-alt-phone');

    // Table Event Delegation
    if (DOM.customers.table) {
        DOM.customers.table.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (btn && btn.dataset.action) {
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                const name = btn.dataset.name;
                
                if (action === 'details') { handleCustomerDetails(id); return; }
                if (action === 'prev-page') { changePage(-1); return; }
                if (action === 'next-page') { changePage(1); return; }
                if (action === 'loyalty') { window.openCustomerLoyaltyAnalytics(id); return; }
                if (action === 'history') { loadCustomerHistory(id, name); return; }
                if (action === 'reset') { resetPartnerAccount(id, name); return; }
                if (action === 'pay') { 
                    window.openLedgerPaymentModal(id, name, parseFloat(btn.dataset.balance || 0), btn.dataset.type); 
                    return; 
                }
                return; 
            }

            const headerRow = e.target.closest('.accordion-header');
            if (headerRow) {
                if (e.target.closest('.accordion-body')) return; 

                const bodyRow = headerRow.nextElementSibling;
                const arrow = headerRow.querySelector('.arrow-icon');
                
                if (bodyRow && bodyRow.classList.contains('accordion-body')) {
                    const tableBody = headerRow.parentElement;
                    if (tableBody) {
                        Array.from(tableBody.children).forEach(row => {
                            if (row.classList.contains('accordion-body') && row !== bodyRow && !row.classList.contains('hidden')) {
                                row.classList.add('hidden');
                                const prevHeader = row.previousElementSibling;
                                if (prevHeader && prevHeader.classList.contains('accordion-header')) {
                                    prevHeader.classList.remove('bg-indigo-50/40');
                                    const prevArrow = prevHeader.querySelector('.arrow-icon');
                                    if (prevArrow) prevArrow.classList.remove('rotate-180');
                                }
                            }
                        });
                    }

                    bodyRow.classList.toggle('hidden');
                    if (arrow) arrow.classList.toggle('rotate-180');
                    
                    if (!bodyRow.classList.contains('hidden')) {
                        headerRow.classList.add('bg-indigo-50/40');
                    } else {
                        headerRow.classList.remove('bg-indigo-50/40');
                    }
                }
            }
        });
    }

    // --- GSTIN and PAN Directory + API Fetch Logic ---
    const gstinInput = document.getElementById('cust-form-gstin');
    const panInput = document.getElementById('cust-form-pan');

    const fillFetchedData = (data, isFromApi = false) => {
        const inputs = {
            name: document.getElementById('cust-form-name'),
            address: document.getElementById('cust-form-address'),
            state: document.getElementById('cust-form-state'),
            email: document.getElementById('cust-form-email'),
            phone: document.getElementById('cust-form-phone'),
            gstin: document.getElementById('cust-form-gstin'),
            pan: document.getElementById('cust-form-pan')
        };

        const highlight = (el) => {
            if (!el) return;
            el.classList.add('bg-indigo-50', 'border-indigo-400', 'transition-colors');
            setTimeout(() => el.classList.remove('bg-indigo-50', 'border-indigo-400'), 800);
        };

        if (data) {
            if (inputs.name && !inputs.name.value) { inputs.name.value = data.tradeName || data.legalName || data.storeName || data.name || ''; highlight(inputs.name); }
            if (inputs.address && !inputs.address.value && data.address) { inputs.address.value = data.address; highlight(inputs.address); }
            if (inputs.state && !inputs.state.value && data.state) { inputs.state.value = data.state; highlight(inputs.state); }
            
            if (!isFromApi) {
                if (inputs.email && !inputs.email.value && data.email) { inputs.email.value = data.email; highlight(inputs.email); }
                if (inputs.phone && !inputs.phone.value && data.phone) { inputs.phone.value = data.phone; highlight(inputs.phone); }
                if (inputs.gstin && !inputs.gstin.value && data.gstin) { inputs.gstin.value = data.gstin; highlight(inputs.gstin); }
                if (inputs.pan && !inputs.pan.value && data.pan) { inputs.pan.value = data.pan; highlight(inputs.pan); }
            }
        }
    };

    if (gstinInput) {
        gstinInput.addEventListener('input', async (e) => {
            let val = e.target.value.toUpperCase().trim();
            e.target.value = val;
            
            if (val.length >= 12 && panInput && !panInput.value) {
                panInput.value = val.substring(2, 12);
                panInput.classList.add('bg-emerald-50', 'transition-colors');
                setTimeout(() => panInput.classList.remove('bg-emerald-50'), 800);
            }

            if (val.length === 15) {
                try {
                    e.target.classList.add('animate-pulse');
                    
                    const dirAppId = typeof appId !== 'undefined' ? appId : window.__app_id;
                    const dirRef = collection(db, `artifacts/${dirAppId}/directory_merchants`);
                    const q = query(dirRef, where('gstin', '==', val), limit(1));
                    const snap = await getDocs(q);

                    if (!snap.empty) {
                        fillFetchedData(snap.docs[0].data(), false);
                        if (typeof showToast === 'function') showToast("Found in Directory", "Partner details auto-filled from network.", "success");
                    } else {
                        const fetchGstinFn = httpsCallable(functions, 'verifyGSTIN'); 
                        const res = await fetchGstinFn({ gstin: val });
                        
                        if (res.data && res.data.valid) {
                            fillFetchedData(res.data, true);
                            if (typeof showToast === 'function') showToast("Verified", "Business details fetched from Govt API.", "success");
                        }
                    }
                } catch (err) { 
                    console.warn("GST Fetch Failed", err); 
                    if (typeof showToast === 'function') showToast("Lookup Failed", "Could not fetch details.", "warning");
                } 
                finally { 
                    e.target.classList.remove('animate-pulse'); 
                }
            }
        });
    }

    if (panInput) {
        panInput.addEventListener('input', async (e) => {
            let val = e.target.value.toUpperCase().trim();
            e.target.value = val;

            if (val.length === 10) {
                try {
                    e.target.classList.add('animate-pulse');
                    
                    const dirAppId = typeof appId !== 'undefined' ? appId : window.__app_id;
                    const dirRef = collection(db, `artifacts/${dirAppId}/directory_merchants`);
                    const q = query(dirRef, where('pan', '==', val), limit(1));
                    const snap = await getDocs(q);

                    if (!snap.empty) {
                        fillFetchedData(snap.docs[0].data(), false);
                        if (typeof showToast === 'function') showToast("Found in Directory", "Partner details auto-filled from network.", "success");
                    }
                } catch (err) {
                    console.warn("PAN Directory Fetch Failed", err);
                } finally {
                    e.target.classList.remove('animate-pulse');
                }
            }
        });
    }
}
export async function renderGlobalHistoryTable() {
    const tbody = document.getElementById('customer-table-body');
    const thead = document.getElementById('customer-table-head');
    if (!tbody || !thead) return;
    
    // 1. Change Headers for History View
    thead.innerHTML = `
      <tr>
        <th class="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Date / Time</th>
        <th class="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Partner Name</th>
        <th class="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Transaction Type</th>
        <th class="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Amount</th>
        <th class="px-4 py-3 text-center text-[10px] font-black text-slate-500 uppercase tracking-widest">Actions</th>
      </tr>
    `;
    
    tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-500 font-medium ">Fetching history logs...</td></tr>`;
    
    try {
        // 🚀 THE FIX: Fetch local transactions
        let txs = [];
        if (window.dbAPI && window.dbAPI.getTransactionsSince) {
            txs = await window.dbAPI.getTransactionsSince('1970-01-01');
            txs = txs.slice(0, 50); // Limit to latest 50 for UI
        }

        if (txs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-slate-500 font-medium">No history found.</td></tr>`;
            return;
        }

        const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';
        let html = '';
        
        txs.forEach(tx => {
            const dateObj = new Date(tx.timestamp);
            const dateStr = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
            
            html += `
                <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
                    <td class="p-4 align-middle"><div class="font-bold text-slate-800 text-sm">${dateStr}</div><div class="text-[10px] text-slate-400 font-mono">${timeStr}</div></td>
                    <td class="p-4 align-middle font-bold text-slate-700">${escapeHTML(tx.customer?.name || 'Walk-in')}</td>
                    <td class="p-4 align-middle text-xs font-bold text-indigo-600">${escapeHTML(tx.type || 'SALE').replace(/_/g, ' ')}</td>
                    <td class="p-4 align-middle text-right font-black text-slate-800">${currency}${Math.abs(tx.summary?.total || 0).toFixed(2)}</td>
                    <td class="p-4 align-middle text-center"><span class="text-xs text-slate-400">Logged Offline</span></td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-red-500 font-medium">Failed to load history.</td></tr>`;
    }
}


export function renderCustomerTable() {
    const container = document.getElementById('customer-table-body');
    const thead = document.getElementById('customer-table-head');
    if (!container || !thead) return;

    thead.innerHTML = `
      <tr>
        <th class="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Partner Details</th>
        <th class="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Partner ID</th>
        <th class="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Classification</th>
        <th class="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Contact</th>
        <th class="px-4 py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest pr-6">Actions</th>
      </tr>
    `;

    const searchInput = document.getElementById('customer-search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

    let filtered = localCustomersCache;

    if (searchTerm) {
        filtered = filtered.filter(c => 
            (c.name || '').toLowerCase().includes(searchTerm) ||
            (c.phone || '').toLowerCase().includes(searchTerm) ||
            (c.id || c.docId || '').toLowerCase().includes(searchTerm) ||
            (c.email || '').toLowerCase().includes(searchTerm)
        );
    }
    
    if (currentPartnerTab === 'supplier') {
        filtered = filtered.filter(c => c.type === 'supplier' || c.isSupplier === true);
    } else {
        filtered = filtered.filter(c => (c.type || 'customer') === currentPartnerTab);
    }

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    if (totalItems === 0) {
        container.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-slate-500 font-medium border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">No partners found in this category.</td></tr>`;
        return;
    }

    if (currentCustomersPage > totalPages) currentCustomersPage = totalPages;
    if (currentCustomersPage < 1) currentCustomersPage = 1;

    const start = (currentCustomersPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const paged = filtered.slice(start, end);
    const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';

    let html = paged.map(customer => { 
        const points = customer.loyaltyPoints || customer.loyaltyTokens || 0;
        const tier = getLoyaltyTier(points);        
        const typeStr = (customer.type || 'customer').toLowerCase();
        
        let typeBadge = '';
        if (typeStr === 'supplier') typeBadge = '<span class="bg-orange-50 text-orange-600 border border-orange-200 px-2.5 py-1 rounded text-[9px] font-black tracking-widest shadow-sm">SUPPLIER</span>';
        else if (typeStr === 'dealer') typeBadge = '<span class="bg-blue-50 text-blue-600 border border-blue-200 px-2.5 py-1 rounded text-[9px] font-black tracking-widest shadow-sm">DEALER</span>';
        else if (typeStr === 'store') typeBadge = '<span class="bg-purple-50 text-purple-600 border border-purple-200 px-2.5 py-1 rounded text-[9px] font-black tracking-widest shadow-sm">BRANCH</span>';
        else typeBadge = '<span class="bg-emerald-50 text-emerald-600 border border-emerald-200 px-2.5 py-1 rounded text-[9px] font-black tracking-widest shadow-sm">CUSTOMER</span>';

        const balance = (parseFloat(customer.dues) || 0) + (parseFloat(customer.balance) || 0); 
        
        // 🚀 Dynamic Payment Button Variables
        const isReceiving = balance >= 0;
        const payActionText = isReceiving ? 'Receive Payment' : 'Settle Payable';
        const payColor = isReceiving ? 'emerald' : 'blue';

        let balanceHtml = '';
        if (balance > 0.01) {
            balanceHtml = `<div class="mt-1.5 inline-flex items-center gap-1 bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded text-[10px] font-black tracking-widest uppercase shadow-sm">DUE: ${currency}${balance.toFixed(2)}</div>`;
        } else if (balance < -0.01) {
            balanceHtml = `<div class="mt-1.5 inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-black tracking-widest uppercase shadow-sm">PAYABLE: ${currency}${Math.abs(balance).toFixed(2)}</div>`;
        }
        
        let focBadge = customer.totalFocYield > 0 ? `<div class="mt-1.5 inline-flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded border uppercase tracking-widest text-emerald-700 bg-emerald-50 border-emerald-200 shadow-sm">+${customer.totalFocYield} FOC</div>` : '';

        const rowClass = typeStr === 'store' ? 'bg-purple-50/10' : 'bg-white';
        const cname = escapeHTML(customer.name).replace(/'/g, "\\'");
        const cid = customer.docId || customer.id;

        return `
        <tr class="${rowClass} hover:bg-slate-50 border-b border-slate-100 transition-colors group cursor-pointer accordion-header" data-id="${cid}">
            <td class="p-4 align-top w-[30%]">
                <div class="font-bold text-slate-800 text-sm mb-1">${escapeHTML(customer.name || 'Unknown')}</div>
                <div class="flex flex-col items-start gap-1">
                    ${balanceHtml}
                    ${focBadge}
                </div>
            </td>
            <td class="p-4 align-top w-[20%]">
                <div class="text-[11px] text-slate-500 font-mono mt-0.5 bg-slate-100 px-2 py-1 rounded inline-block border border-slate-200">${escapeHTML(customer.id || customer.docId)}</div>
            </td>
            <td class="p-4 align-top w-[15%]">
                ${typeBadge}
            </td>
            <td class="p-4 align-top w-[20%]">
                <div class="text-slate-700 text-sm font-bold font-mono">${escapeHTML(customer.phone || 'No Phone')}</div>    
            </td>
            <td class="p-4 align-top text-right w-[15%]">
                <div class="flex items-center justify-end gap-2">
                    <button data-action="details" data-id="${cid}" class="text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 px-4 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm">Edit</button>
                    <div class="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 group-hover:text-indigo-600 group-hover:border-indigo-300 transition-colors shrink-0">
                        <svg class="arrow-icon w-5 h-5 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                </div>
            </td>
        </tr>
        
        <tr class="accordion-body hidden bg-slate-50/40 border-b-2 border-indigo-100 shadow-inner">
            <td colspan="5" class="p-0">
                <div class="p-6">
                    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        
                        <!-- Left Side Stats (2x2 Grid) -->
                        <div class="grid grid-cols-2 gap-3">
                            <div class="bg-white border border-slate-200 p-3 rounded-xl shadow-sm flex flex-col justify-center items-center text-center">
                                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Loyalty Status</span>
                                <span class="${tier.color} px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-sm">${tier.name} TIER</span>
                            </div>
                            <div class="bg-white border border-slate-200 p-3 rounded-xl shadow-sm flex flex-col justify-center items-center text-center">
                                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Spent</span>
                                <span class="text-base font-black text-slate-800">${currency}${parseFloat(customer.totalSpent || 0).toFixed(2)}</span>
                            </div>
                            
                            <div id="today-sale-${cid}" ondblclick="window.openCalendarHistory('${cid}', '${cname}', 'SALE')" class="bg-emerald-50 border border-emerald-200 p-3 rounded-xl shadow-sm flex flex-col justify-center items-center text-center cursor-pointer hover:bg-emerald-100 transition-colors" title="Double click to view Sales Calendar">
                                <div class="w-full">
                                    <span class="text-[10px] font-bold text-emerald-600 uppercase tracking-widest block mb-1">Today's Sale</span>
                                    <svg class="animate-spin w-4 h-4 text-emerald-500 mx-auto" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                </div>
                            </div>
                            
                            <div id="today-purchase-${cid}" ondblclick="window.openCalendarHistory('${cid}', '${cname}', 'PURCHASE')" class="bg-orange-50 border border-orange-200 p-3 rounded-xl shadow-sm flex flex-col justify-center items-center text-center cursor-pointer hover:bg-orange-100 transition-colors" title="Double click to view Purchase Calendar">
                                <div class="w-full">
                                    <span class="text-[10px] font-bold text-orange-600 uppercase tracking-widest block mb-1">Today's Purchase</span>
                                    <svg class="animate-spin w-4 h-4 text-orange-500 mx-auto" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                </div>
                            </div>
                        </div>
                        
                        <!-- 🚀 PERFECT SYMMETRY: Right Side Actions -->
                        <div class="flex flex-col gap-3">
                            <!-- Massive Pay Button Spans Full Width Top -->
                            <button data-action="pay" data-id="${cid}" data-name="${cname}" data-balance="${balance}" data-type="${typeStr}" class="w-full bg-${payColor}-500 border border-${payColor}-600 text-white hover:bg-${payColor}-600 py-3 rounded-xl shadow-md flex justify-center items-center text-center transition-all active:scale-[0.98]">
                                <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                <span class="text-xs font-black uppercase tracking-widest">${payActionText} (${currency}${Math.abs(balance).toFixed(2)})</span>
                            </button>
                            
                            <!-- 2x2 Grid for Remaining Actions -->
                            <div class="grid grid-cols-2 gap-3 h-full">
                                <button data-action="loyalty" data-id="${cid}" data-name="${cname}" class="bg-yellow-50 border border-yellow-200 text-yellow-700 hover:bg-yellow-100 p-2.5 rounded-xl shadow-sm flex flex-col justify-center items-center text-center transition-transform active:scale-95 group">
                                    <svg class="w-5 h-5 mb-1 group-hover:scale-110 transition-transform duration-300 text-yellow-500" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                                    <span class="text-[10px] font-black uppercase tracking-widest">${points} Tokens</span>
                                </button>
                                <button data-action="details" data-id="${cid}" data-name="${cname}" class="bg-white border border-slate-200 text-indigo-600 hover:bg-indigo-50 p-2.5 rounded-xl shadow-sm flex flex-col justify-center items-center text-center transition-transform active:scale-95 group">
                                    <svg class="w-5 h-5 mb-1 group-hover:scale-110 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                                    <span class="text-[10px] font-black uppercase tracking-widest">Edit Profile</span>
                                </button>
                                <button data-action="history" data-id="${cid}" data-name="${cname}" class="bg-indigo-600 border border-indigo-700 text-white hover:bg-indigo-700 p-2.5 rounded-xl shadow-sm flex flex-col justify-center items-center text-center transition-transform active:scale-95 group">
                                    <svg class="w-5 h-5 mb-1 group-hover:scale-110 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> 
                                    <span class="text-[10px] font-black uppercase tracking-widest">View Ledger</span>
                                </button>
                                <button data-action="reset" data-id="${cid}" data-name="${cname}" class="bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 p-2.5 rounded-xl shadow-sm flex flex-col justify-center items-center text-center transition-transform active:scale-95 group">
                                    <svg class="w-5 h-5 mb-1 group-hover:scale-110 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                    <span class="text-[10px] font-black uppercase tracking-widest">Reset Account</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </td>
        </tr>
        `;
    }).join('');

    html += `
        <tr class="bg-white sticky bottom-0 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] border-t border-slate-200">
            <td colspan="5" class="p-4">
                <div class="flex items-center justify-between">
                    <div class="text-xs text-slate-500 font-medium font-mono">
                        Showing <span class="font-bold text-indigo-600">${totalItems > 0 ? start + 1 : 0}</span> to <span class="font-bold text-indigo-600">${Math.min(end, totalItems)}</span> of <span class="font-bold text-indigo-600">${totalItems}</span> partners
                    </div>
                    <div class="flex gap-2">
                        <button data-action="prev-page" class="px-4 py-1.5 text-xs font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-all" ${currentCustomersPage <= 1 ? 'disabled' : ''}>Prev</button>
                        <span class="text-xs font-bold text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-200 shadow-inner">Page ${currentCustomersPage} of ${totalPages}</span>
                        <button data-action="next-page" class="px-4 py-1.5 text-xs font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-all" ${currentCustomersPage >= totalPages ? 'disabled' : ''}>Next</button>
                    </div>
                </div>
            </td>
        </tr>
    `;

    container.innerHTML = html;
    fetchAndInjectTodayStats(paged);
}
export function toggleCustomerForm(show = true) {
    const formContainer = document.getElementById('customer-form-container');
    const dirContainer = document.getElementById('customer-directory-container');
    
    if (!formContainer || !dirContainer) return;
    
    if (show) {
        formContainer.classList.remove('hidden');
        dirContainer.classList.remove('lg:col-span-3');
        dirContainer.classList.add('lg:col-span-2');
    } else {
        formContainer.classList.add('hidden');
        dirContainer.classList.remove('lg:col-span-2');
        dirContainer.classList.add('lg:col-span-3');
    }
}
// src/components/customers.js

// Replace the changePage function and update the renderCustomerTable function call
function changePage(delta) {
    const filterType = DOM.customers.filter ? DOM.customers.filter.value : 'all';
    const locFilterDropdown = document.getElementById('cust-table-location-filter');
    const filterLocation = locFilterDropdown ? locFilterDropdown.value : 'all';

    let filtered = localCustomersCache;
    
    if (filterType !== 'all') {
        if (filterType === 'supplier') {
            filtered = filtered.filter(c => c.type === 'supplier' || c.isSupplier === true);
        } else {
            filtered = filtered.filter(c => c.type === filterType);
        }
    }

    if (filterLocation !== 'all') {
        filtered = filtered.filter(c => (c.locationId || 'main') === filterLocation);
    }

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    let newPage = currentCustomersPage + delta;
    
    // Boundary checks
    if (newPage < 1) newPage = 1;
    if (newPage > totalPages) newPage = totalPages;

    if (newPage !== currentCustomersPage) {
        currentCustomersPage = newPage;
        renderCustomerTable();
    }
}

export function toggleCustomerModal(show = true) {
    const modal = document.getElementById('customer-form-modal');
    if (!modal) return;
    if (show) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.classList.add('overflow-hidden'); // Lock background scroll
    } else {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.classList.remove('overflow-hidden'); // Unlock background scroll
    }
}

function updateDatalists() {
    const custSearch = DOM.datalists.customer;
    const dlrSearch = DOM.datalists.dealer;
    const custIdList = DOM.datalists.customerId;
    const dlrIdList = DOM.datalists.dealerId;

    if (custSearch) custSearch.innerHTML = '';
    if (dlrSearch) dlrSearch.innerHTML = '';
    if (custIdList) custIdList.innerHTML = '';
    if (dlrIdList) dlrIdList.innerHTML = '';

    localCustomersCache.forEach(c => {
        const safeName = escapeHTML(c.name);
        const safeId = escapeHTML(c.id || c.docId);
        const option = `<option value="${safeName}">`;
        const idOption = `<option value="${safeId}">${safeName}</option>`; 

        if (c.type === 'customer') {
            if (custSearch) custSearch.innerHTML += option;
            if (custIdList) custIdList.innerHTML += idOption;
        } else {
            if (dlrSearch) dlrSearch.innerHTML += option;
            if (dlrIdList) dlrIdList.innerHTML += idOption;
        }
    });
}

async function handleCustomerDetails(id) {
    const c = localCustomersCache.find(x => x.docId === id || x.id === id);
    if (!c) return;
    
    setEditingCustomerId(id);
    
    let foundGlobal = null;
    try {
        // 🚀 THE FIX: Use local SQLite instead of Firebase collection()
        if (window.dbAPI && window.dbAPI.getCustomers) {
            const allCustomers = await window.dbAPI.getCustomers();
            foundGlobal = allCustomers.find(cust => cust.id === id || cust.merchantId === id);
            
            if (!foundGlobal && c.phone) {
                const rawDigits = c.phone.replace(/\D/g, '').slice(-10);
                if (rawDigits.length === 10) {
                    const candidates = [
                        `+91${rawDigits}`, rawDigits, `0${rawDigits}`, 
                        `+91 ${rawDigits.slice(0,5)} ${rawDigits.slice(5)}`
                    ];
                    foundGlobal = allCustomers.find(cust => candidates.includes(cust.phone));
                }
            }
        }
    } catch (e) {
        console.warn("Global lookup failed", e);
    }

    const enrichedData = {
        ...foundGlobal,
        ...c, 
        bankDetails: c.bankDetails || foundGlobal?.bankDetails,
        altBankDetails: c.altBankDetails || foundGlobal?.altBankDetails,
        pan: c.pan || foundGlobal?.pan,
        gstin: c.gstin || foundGlobal?.gstin,
        address: c.address || foundGlobal?.address,
        state: c.state || foundGlobal?.state,
        email: c.email || foundGlobal?.email,
        dealerType: c.dealerType || foundGlobal?.dealerType || 'regular',
        nfcCardId: c.nfcCardId || foundGlobal?.nfcCardId || ''
    };

    const formInputs = {
        type: document.getElementById('cust-form-type'),
        id: document.getElementById('cust-form-id'),
        name: document.getElementById('cust-form-name'),
        phone: document.getElementById('cust-form-phone'),
        email: document.getElementById('cust-form-email'),
        address: document.getElementById('cust-form-address'),
        state: document.getElementById('cust-form-state'),
        gstin: document.getElementById('cust-form-gstin'),
        pan: document.getElementById('cust-form-pan'),
        altPhone: document.getElementById('cust-form-alt-phone'),
        nfcCardId: document.getElementById('cust-form-nfc-id'),
        dealerType: document.getElementById('cust-form-dealer-type'),
        bankName: document.getElementById('cust-form-bank-name'),
        accNum: document.getElementById('cust-form-account-num'),
        ifsc: document.getElementById('cust-form-ifsc'),
        branch: document.getElementById('cust-form-branch'),
        openingBalance: document.getElementById('cust-form-opening-balance'),
        altBankName: document.getElementById('cust-form-alt-bank-name'),
        altAccNum: document.getElementById('cust-form-alt-account-num'),
        altIfsc: document.getElementById('cust-form-alt-ifsc'),
        altBranch: document.getElementById('cust-form-alt-branch')
    };

    if (formInputs.type) formInputs.type.value = enrichedData.type || 'customer';
    handlePartnerTypeChange(); 

    if (formInputs.name) formInputs.name.value = enrichedData.name || enrichedData.storeName || '';
    if (formInputs.phone) formInputs.phone.value = enrichedData.phone || '';
    if (formInputs.id) formInputs.id.value = enrichedData.id || enrichedData.merchantId || c.docId || '';
    if (formInputs.email) formInputs.email.value = enrichedData.email || '';
    if (formInputs.address) formInputs.address.value = enrichedData.address || '';
    if (formInputs.state) formInputs.state.value = enrichedData.state || '';
    if (formInputs.gstin) formInputs.gstin.value = enrichedData.gstin || ''; 
    if (formInputs.dealerType) formInputs.dealerType.value = enrichedData.dealerType || 'regular';

    if (formInputs.nfcCardId) formInputs.nfcCardId.value = enrichedData.nfcCardId || '';
    if (formInputs.pan) formInputs.pan.value = enrichedData.pan || '';
    if (formInputs.altPhone) formInputs.altPhone.value = enrichedData.altPhone || '';

    if (enrichedData.bankDetails) {
        if (formInputs.bankName) formInputs.bankName.value = enrichedData.bankDetails.bankName || '';
        if (formInputs.accNum) formInputs.accNum.value = enrichedData.bankDetails.accountNumber || '';
        if (formInputs.ifsc) formInputs.ifsc.value = enrichedData.bankDetails.ifsc || '';
        if (formInputs.branch) formInputs.branch.value = enrichedData.bankDetails.branch || '';
    } else {
        if (formInputs.bankName) formInputs.bankName.value = '';
        if (formInputs.accNum) formInputs.accNum.value = '';
        if (formInputs.ifsc) formInputs.ifsc.value = '';
        if (formInputs.branch) formInputs.branch.value = '';
    }

    if (enrichedData.altBankDetails) {
        if (formInputs.altBankName) formInputs.altBankName.value = enrichedData.altBankDetails.bankName || '';
        if (formInputs.altAccNum) formInputs.altAccNum.value = enrichedData.altBankDetails.accountNumber || '';
        if (formInputs.altIfsc) formInputs.altIfsc.value = enrichedData.altBankDetails.ifsc || '';
        if (formInputs.altBranch) formInputs.altBranch.value = enrichedData.altBankDetails.branch || '';
    } else {
        if (formInputs.altBankName) formInputs.altBankName.value = '';
        if (formInputs.altAccNum) formInputs.altAccNum.value = '';
        if (formInputs.altIfsc) formInputs.altIfsc.value = '';
        if (formInputs.altBranch) formInputs.altBranch.value = '';
    }

    const locDropdown = document.getElementById('cust-form-location');
    if (locDropdown && enrichedData.locationId) {
        if (!Array.from(locDropdown.options).some(opt => opt.value === enrichedData.locationId)) {
            locDropdown.add(new Option(enrichedData.locationId, enrichedData.locationId));
        }
        locDropdown.value = enrichedData.locationId;
    }

    const fieldsToLock = [
        formInputs.name, formInputs.email, formInputs.address, formInputs.state, formInputs.phone, formInputs.gstin,
        formInputs.bankName, formInputs.accNum, formInputs.ifsc, formInputs.branch, formInputs.pan
    ];
    
    // In offline mode, we don't rigidly lock fields like the network does, so users can correct errors.
    fieldsToLock.forEach(el => {
        if (el) {
            el.disabled = false;
            el.classList.remove('bg-gray-100', 'text-gray-500', 'cursor-not-allowed', 'border-gray-200');
            el.classList.add('bg-white', 'border-gray-300');
        }
    });

    if (formInputs.type) {
        formInputs.type.disabled = true;
        formInputs.type.classList.add('bg-gray-100', 'text-gray-500', 'cursor-not-allowed', 'border-gray-200');
    }
    if (formInputs.id) {
        formInputs.id.disabled = true;
        formInputs.id.classList.add('bg-gray-100', 'text-gray-500', 'cursor-not-allowed', 'border-gray-200');
    }

    const fieldsToAlwaysUnlock = [
        formInputs.altPhone, formInputs.nfcCardId, formInputs.dealerType,
        formInputs.altBankName, formInputs.altAccNum, formInputs.altIfsc, formInputs.altBranch
    ];

    fieldsToAlwaysUnlock.forEach(el => {
        if (el) {
            el.disabled = false;
            el.classList.remove('bg-gray-100', 'text-gray-500', 'cursor-not-allowed', 'border-gray-200');
            el.classList.add('bg-white', 'border-gray-300');
        }
    });
    
    if (formInputs.openingBalance) {
        formInputs.openingBalance.value = enrichedData.openingBalance || '';
        formInputs.openingBalance.disabled = true; 
        formInputs.openingBalance.classList.add('bg-gray-100', 'text-gray-500', 'cursor-not-allowed', 'border-gray-200');
        formInputs.openingBalance.classList.remove('bg-white');
        formInputs.openingBalance.title = "Opening Balance cannot be edited. Use 'Issue Manual Credit' or 'Collect Dues' to adjust balance.";
    }
    
    const formTitle = document.getElementById('customer-form-title');
    const saveBtn = document.getElementById('save-customer-btn');
    const cancelBtn = document.getElementById('cancel-customer-edit-btn');

    if (formTitle) formTitle.innerHTML = ` Edit Profile: ${escapeHTML(enrichedData.name || enrichedData.storeName || '')}`;
    if (saveBtn) saveBtn.textContent = 'Update Profile';
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    
    toggleCustomerModal(true);
}

async function loadCustomerHistory(customerId, name) {
    let modal = document.getElementById('dynamic-history-modal');
    
    if (!modal) {
        // 🚀 PERFORMANCE FIX: Removed ' ' and 'transition-opacity'. Darkened bg to 80% to compensate.
        const modalHtml = `
        <div id="dynamic-history-modal" class="fixed inset-0 bg-slate-900/80 hidden items-center justify-center z-[150] p-4">
            <div class="bg-white rounded-[2rem] shadow-2xl w-full max-w-3xl flex flex-col h-[85vh] overflow-hidden border border-white/20">
                
                <div class="px-8 py-6 border-b border-slate-100 bg-white shrink-0 flex justify-between items-center shadow-sm z-10">
                    <div>
                        <h3 id="history-modal-title" class="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-3">
                            <span class="bg-indigo-50 text-indigo-600 p-2 rounded-xl text-lg shadow-sm">📜</span> Account History
                        </h3>
                        <p id="history-modal-subtitle" class="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1.5 ml-12">ID: ---</p>
                    </div>
                    <button id="close-history-modal" class="bg-slate-50 text-slate-400 hover:text-red-500 hover:bg-red-50 p-2.5 rounded-full transition-all duration-200">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                
                <div id="history-modal-content" class="p-8 overflow-y-auto flex-1 custom-scrollbar bg-slate-50/50">
                    <div class="text-center text-slate-400 font-medium">Loading...</div>
                </div>
                
                <div class="px-8 py-5 border-t border-slate-100 bg-white flex justify-between shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)] z-10">
                    <button id="execute-merge-btn" class="px-6 py-3 text-sm font-bold text-white bg-fuchsia-600 hover:bg-fuchsia-700 rounded-xl shadow-lg shadow-fuchsia-200 transition-all flex items-center gap-2 transform active:scale-95">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                        Merge Selected
                    </button>
                    <button id="print-history-btn" class="px-6 py-3 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center gap-2 transform active:scale-95">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                        Print Full Record
                    </button>
                </div>
            </div>
        </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modal = document.getElementById('dynamic-history-modal');

        document.getElementById('close-history-modal').onclick = () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.classList.remove('overflow-hidden'); // <--- ADD THIS
        };

        modal.addEventListener('click', (e) => {
            // 1. Check if Print Button was clicked
            const printBtn = e.target.closest('.print-single-tx-btn');
            if (printBtn) {
                e.stopPropagation(); 
                const txId = printBtn.dataset.txid;
                const tx = localTransactionsCache.find(t => t.id === txId);
                
                if (tx) {
                    printBtn.innerHTML = `<svg class="animate-spin w-4 h-4" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
                    
                    (async () => {
                        try {
                            const sId = typeof getStoreId === 'function' ? getStoreId() : null;
                            const aId = typeof appId !== 'undefined' ? appId : window.__app_id;
                            const uId = typeof getUserId === 'function' ? getUserId() : null;

                            // ==========================================
                            // HELPER: Number to Words Converter
                            // ==========================================
                            const numberToWords = (num) => {
                                const a = ['','One ','Two ','Three ','Four ', 'Five ','Six ','Seven ','Eight ','Nine ','Ten ','Eleven ','Twelve ','Thirteen ','Fourteen ','Fifteen ','Sixteen ','Seventeen ','Eighteen ','Nineteen '];
                                const b = ['', '', 'Twenty','Thirty','Forty','Fifty', 'Sixty','Seventy','Eighty','Ninety'];
                                if ((num = num.toString()).length > 9) return 'Overflow';
                                const n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
                                if (!n) return ''; 
                                let str = '';
                                str += (n[1] != 0) ? (a[Number(n[1])] || b[n[1][0]] + ' ' + a[n[1][1]]) + 'Crore ' : '';
                                str += (n[2] != 0) ? (a[Number(n[2])] || b[n[2][0]] + ' ' + a[n[2][1]]) + 'Lakh ' : '';
                                str += (n[3] != 0) ? (a[Number(n[3])] || b[n[3][0]] + ' ' + a[n[3][1]]) + 'Thousand ' : '';
                                str += (n[4] != 0) ? (a[Number(n[4])] || b[n[4][0]] + ' ' + a[n[4][1]]) + 'Hundred ' : '';
                                str += (n[5] != 0) ? ((str != '') ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0]] + ' ' + a[n[5][1]]) : '';
                                return str.trim();
                            };

                            // ==========================================
                            // 1. STORE TRUTH FETCH (Including Bank Details)
                            // ==========================================
                            let finalStore = { 
                                name: document.getElementById('setting-store-name')?.value || document.getElementById('dashboard-store-name')?.textContent || 'STORE', 
                                address: document.getElementById('setting-store-address')?.value || '', 
                                phone: document.getElementById('setting-store-phone')?.value || '', 
                                gstin: document.getElementById('setting-store-gst')?.value || '', 
                                pan: document.getElementById('setting-store-pan')?.value || '',
                                bankDetails: {}
                            };

                            if (sId && aId) {
                                try {
                                    // Fetch base store doc
                                    const storeDoc = await getDoc(doc(db, `artifacts/${aId}/stores/${sId}`));
                                    // Fetch settings profile doc (where settings.js saves bank details)
                                    const profileDoc = await getDoc(doc(db, `artifacts/${aId}/stores/${sId}/settings/profile`));
                                    
                                    let mergedData = {};
                                    if (storeDoc.exists()) mergedData = { ...mergedData, ...storeDoc.data() };
                                    if (profileDoc.exists()) mergedData = { ...mergedData, ...profileDoc.data() };

                                    const settings = mergedData.settings || {};
                                    
                                    finalStore.name = finalStore.name !== 'STORE' && finalStore.name ? finalStore.name : (mergedData.storeName || mergedData.name || 'STORE');
                                    finalStore.address = finalStore.address || mergedData.address || settings.address || '';
                                    finalStore.phone = finalStore.phone || mergedData.phone || settings.phone || '';
                                    finalStore.gstin = finalStore.gstin || mergedData.taxId || mergedData.gstin || settings.taxId || '';
                                    finalStore.pan = finalStore.pan || mergedData.pan || settings.pan || '';
                                    finalStore.bankDetails = mergedData.bankDetails || settings.bankDetails || {};
                                } catch(e) { console.warn("Store DB fetch failed", e); }
                            }

                            if (tx.storeDetails) {
                                if (!finalStore.name || finalStore.name === 'STORE') finalStore.name = tx.storeDetails.name;
                                if (!finalStore.address && tx.storeDetails.address) finalStore.address = tx.storeDetails.address;
                                if (!finalStore.phone && tx.storeDetails.phone) finalStore.phone = tx.storeDetails.phone;
                                if (!finalStore.gstin && tx.storeDetails.gstin) finalStore.gstin = tx.storeDetails.gstin;
                                if (!finalStore.pan && tx.storeDetails.pan) finalStore.pan = tx.storeDetails.pan;
                            }

                            // ==========================================
                            // 2. PARTNER TRUTH FETCH
                            // ==========================================
                            let finalPartner = {
                                name: tx.customer?.name || 'Walk-in Customer',
                                address: tx.customer?.address || '',
                                phone: tx.customer?.phone || '',
                                gstin: tx.customer?.gstin || '',
                                pan: tx.customer?.pan || '',
                                bankDetails: tx.customer?.bankDetails || {}
                            };

                            const activePartner = localCustomersCache.find(c => c.docId === customerId || c.id === customerId);
                            if (activePartner) {
                                finalPartner.name = activePartner.storeName || activePartner.name || finalPartner.name;
                                finalPartner.address = activePartner.address || finalPartner.address;
                                finalPartner.phone = activePartner.phone || finalPartner.phone;
                                finalPartner.gstin = activePartner.gstin || activePartner.taxId || finalPartner.gstin;
                                finalPartner.pan = activePartner.pan || activePartner.gstPan || finalPartner.pan;
                                finalPartner.bankDetails = activePartner.bankDetails || finalPartner.bankDetails;
                            } 
                            
                            if (sId && aId && customerId && (!finalPartner.gstin || !finalPartner.pan)) {
                                try {
                                    let pDoc = await getDoc(doc(db, `artifacts/${aId}/stores/${sId}/customers/${customerId}`));
                                    if (!pDoc.exists()) pDoc = await getDoc(doc(db, `artifacts/${aId}/directory_merchants/${customerId}`));
                                    if (pDoc.exists()) {
                                        const pData = pDoc.data();
                                        finalPartner.name = pData.storeName || pData.name || finalPartner.name;
                                        finalPartner.address = pData.address || finalPartner.address;
                                        finalPartner.phone = pData.phone || finalPartner.phone;
                                        finalPartner.gstin = pData.gstin || pData.taxId || finalPartner.gstin;
                                        finalPartner.pan = pData.pan || pData.gstPan || finalPartner.pan;
                                        finalPartner.bankDetails = pData.bankDetails || finalPartner.bankDetails;
                                    }
                                } catch(e) { console.warn("Partner fetch failed", e); }
                            }

                            // ==========================================
                            // 3. DYNAMIC ROUTING & MATH
                            // ==========================================
                            const txType = (tx.type || '').toUpperCase();
                            const isPurchase = txType === 'PURCHASE' || txType === 'REFUND_RECEIVED';

                            const seller = isPurchase ? finalPartner : finalStore;
                            const buyer  = isPurchase ? finalStore : finalPartner;
                            const sellerBank = seller.bankDetails || {};
                            const invoiceTitle = isPurchase ? 'PURCHASE INVOICE' : 'TAX INVOICE';

                            const dateObj = tx.timestamp?.toDate ? tx.timestamp.toDate() : new Date();
                            const dateStr = dateObj.toLocaleDateString('en-GB'); 

                            let itemsHtml = '';
                            let totalQty = 0, totalTaxable = 0, totalCgst = 0, totalSgst = 0, grandTotal = 0;

                            const processedItems = (tx.items || []).map((item, index) => {
                                const qty = parseFloat(item.quantity) || 0;
                                totalQty += qty;

                                const mrp = parseFloat(item.mrp || item.price || 0);
                                const rate = parseFloat(item.baseRate || item.cost || item.purchasePrice || item.price || 0);
                                const grsAmt = rate * qty;
                                const schDisc = parseFloat(item.schDisc || item.discount || 0);
                                
                                const taxRate = parseFloat(item.taxRate || item.gstSlab || item.gst || 0);
                                let taxableAmt = parseFloat(item.taxableValue || item.taxableAmt || item.subtotal || 0);
                                if (!taxableAmt || taxableAmt === 0) taxableAmt = (grsAmt - schDisc);
                                
                                let taxAmt = parseFloat(item.taxAmount || item.tax || 0);
                                if ((!taxAmt || taxAmt === 0) && taxRate > 0) taxAmt = (taxableAmt * taxRate / 100);
                                
                                const cgst = taxAmt / 2;
                                const sgst = taxAmt / 2;
                                const halfRate = taxRate / 2;
                                const netAmt = taxableAmt + taxAmt + parseFloat(item.cessAmount || item.cess || 0);

                                totalTaxable += taxableAmt;
                                totalCgst += cgst;
                                totalSgst += sgst;
                                grandTotal += netAmt;

                                return {
                                    index: index + 1,
                                    name: escapeHTML(item.name),
                                    hsn: escapeHTML(item.hsn || '-'),
                                    qty,
                                    unit: escapeHTML(item.unit || 'Ea'),
                                    rate, mrp, grsAmt, schDisc, taxableAmt, halfRate, sgst, cgst, netAmt
                                };
                            });

                            const roundedGrandTotal = Math.round(grandTotal);
                            let amountInWords = numberToWords(roundedGrandTotal) + ' Rupees Only';

                            // 4. PAGINATED FEATURE-RICH B2B HTML LAYOUT
                            // ==========================================
                            const ITEMS_PER_PAGE = 12; // Perfect fit for A3 Landscape
                            const totalPages = Math.ceil(processedItems.length / ITEMS_PER_PAGE) || 1;
                            let pagesHtml = '';

                            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                                const isLastPage = pageNum === totalPages;
                                const startIdx = (pageNum - 1) * ITEMS_PER_PAGE;
                                const pageItems = processedItems.slice(startIdx, startIdx + ITEMS_PER_PAGE);
                                
                                let pageItemsHtml = pageItems.map(item => `
                                    <tr>
                                        <td class="text-center">${item.index}</td>
                                        <td class="text-left font-bold">${item.name}</td>
                                        <td class="text-center">${item.hsn}</td>
                                        <td class="text-right font-bold">${item.qty}</td>
                                        <td class="text-center">${item.unit}</td>
                                        <td class="text-right">${item.rate.toFixed(2)}</td>
                                        <td class="text-right">${item.mrp.toFixed(2)}</td>
                                        <td class="text-right">${item.grsAmt.toFixed(2)}</td>
                                        <td class="text-right">0.00</td>
                                        <td class="text-right">0.00%</td>
                                        <td class="text-right">${item.schDisc.toFixed(2)}</td>
                                        <td class="text-right font-bold">${item.taxableAmt.toFixed(2)}</td>
                                        <td style="padding: 0;">
                                            <div style="display:flex; justify-content:space-between; padding: 10px 6px;">
                                                <span>${item.halfRate}%</span><span>${item.sgst.toFixed(2)}</span>
                                            </div>
                                        </td>
                                        <td style="padding: 0;">
                                            <div style="display:flex; justify-content:space-between; padding: 10px 6px;">
                                                <span>${item.halfRate}%</span><span>${item.cgst.toFixed(2)}</span>
                                            </div>
                                        </td>
                                        <td class="text-right font-black">${item.netAmt.toFixed(2)}</td>
                                    </tr>
                                `).join('');

                                let tfootHtml = '';
                                let footerHtml = '';

                                if (isLastPage) {
                                    tfootHtml = `
                                        <tr class="tfoot-row">
                                            <td colspan="3" class="text-right font-black" style="letter-spacing: 1px;">TOTAL</td>
                                            <td class="text-right font-black">${totalQty}</td>
                                            <td colspan="7"></td>
                                            <td class="text-right font-bold">${totalTaxable.toFixed(2)}</td>
                                            <td class="text-right font-bold">${totalSgst.toFixed(2)}</td>
                                            <td class="text-right font-bold">${totalCgst.toFixed(2)}</td>
                                            <td class="text-right font-black" style="font-size: 16pt;">${roundedGrandTotal.toFixed(2)}</td>
                                        </tr>
                                        <tr class="amount-words-row text-uppercase">
                                            <td colspan="15">
                                                <span class="font-bold tracking-wide">INVOICE AMOUNT IN WORDS: </span>
                                                <span class="font-black">${amountInWords}</span>
                                            </td>
                                        </tr>
                                    `;
                                    footerHtml = `
                                        <div class="footer-section text-uppercase">
                                            <div class="footer-left">
                                                <div class="section-title" style="margin-bottom: 8px;">BANK DETAILS</div>
                                                <div class="bank-grid">
                                                    <span class="font-bold">BANK NAME:</span> <span class="font-black">${escapeHTML(sellerBank.bankName || sellerBank.name || '-')}</span>
                                                    <span class="font-bold">A/C NO:</span> <span class="font-black">${escapeHTML(sellerBank.accountNumber || sellerBank.accNum || '-')}</span>
                                                    <span class="font-bold">IFSC CODE:</span> <span class="font-black">${escapeHTML(sellerBank.ifsc || sellerBank.ifscCode || '-')}</span>
                                                    <span class="font-bold">BRANCH:</span> <span>${escapeHTML(sellerBank.branch || '-')}</span>
                                                </div>
                                                
                                                <div style="margin-top: 15px;">
                                                    <div class="section-title" style="margin-bottom: 6px;">DECLARATION</div>
                                                    <div class="terms-text text-uppercase">
                                                        WE DECLARE THAT THIS INVOICE SHOWS THE ACTUAL PRICE OF THE GOODS DESCRIBED AND THAT ALL PARTICULARS ARE TRUE AND CORRECT.<br>
                                                        I/WE HEREBY CERTIFY THAT FOOD/FOODS MENTIONED IN THIS INVOICE IS/ARE WARRANTED TO BE OF THE NATURE AND QUALITY WHICH IT/THESE PURPORTS/PURPORTED TO BE.<br>
                                                        SUBJECT TO LOCAL JURISDICTION ONLY. E.& O.E.
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div class="footer-right">
                                                <div class="font-black text-right" style="font-size: 18pt; margin-bottom: 30px;">FOR ${escapeHTML(seller.name)}</div>
                                                <div class="font-bold text-right" style="font-size: 14pt;">AUTHORISED SIGNATORY</div>
                                            </div>
                                        </div>
                                    `;
                                } else {
                                    tfootHtml = `
                                        <tr class="tfoot-row">
                                            <td colspan="15" class="text-right font-black" style="letter-spacing: 1px;">CONTINUED ON PAGE ${pageNum + 1} ...</td>
                                        </tr>
                                    `;
                                    footerHtml = `<div style="flex: 1; min-height: 100px;"></div>`;
                                }

                                pagesHtml += `
                                    <div class="invoice-wrapper" style="${!isLastPage ? 'page-break-after: always;' : ''}">
                                        <div class="header-card text-uppercase">
                                            <div style="flex: 1.2;">
                                                <div class="seller-name">${escapeHTML(seller.name)}</div>
                                                <div style="margin-bottom: 4px; font-size: 12pt;">${escapeHTML(seller.address)}</div>
                                                <div style="font-size: 12pt;"><span class="font-bold">GSTIN:</span> ${escapeHTML(seller.gstin || '-')} &nbsp;&nbsp;|&nbsp;&nbsp; <span class="font-bold">PAN:</span> ${escapeHTML(seller.pan || '-')}</div>
                                                <div style="font-size: 12pt; margin-top: 2px;"><span class="font-bold">MOB:</span> ${escapeHTML(seller.phone || '-')}</div>
                                            </div>
                                            <div style="flex: 0.8; text-align: center;">
                                                <div class="invoice-title">${invoiceTitle}</div>
                                                <div style="font-size: 10pt; font-weight: bold;">PAGE ${pageNum} OF ${totalPages}</div>
                                            </div>
                                            <div style="flex: 1; text-align: right; font-size: 12pt;">
                                                <div style="margin-bottom: 4px;"><span class="font-bold">INVOICE DATE:</span> ${dateStr}</div>
                                                <div><span class="font-bold">INVOICE NO:</span> ${escapeHTML(tx.invoiceId)}</div>
                                            </div>
                                        </div>

                                        <div class="info-grid text-uppercase">
                                            <div class="info-col">
                                                <div class="section-title">BILLED TO</div>
                                                <div class="font-black" style="font-size: 14pt; margin-bottom: 4px;">${escapeHTML(buyer.name)}</div>
                                                <div style="margin-bottom: 4px; font-size: 12pt;">${escapeHTML(buyer.address)}</div>
                                                <div style="font-size: 12pt;"><span class="font-bold">GSTIN:</span> ${escapeHTML(buyer.gstin || '-')}</div>
                                                <div style="font-size: 12pt; margin-top: 2px;"><span class="font-bold">PAN:</span> ${escapeHTML(buyer.pan || '-')}</div>
                                            </div>
                                            <div class="info-col">
                                                <div class="section-title">PLACE OF DELIVERY</div>
                                                <div class="font-black" style="font-size: 14pt; margin-bottom: 4px;">${escapeHTML(buyer.name)}</div>
                                                <div style="font-size: 12pt;"><span class="font-bold">MOB NO:</span> ${escapeHTML(buyer.phone || '-')}</div>
                                            </div>
                                        </div>

                                        <div style="flex: 1;">
                                            <table>
                                                <thead>
                                                    <tr>
                                                        <th style="width: 50px;">S.N</th>
                                                        <th class="text-left" style="min-width: 200px;">ITEM NAME</th>
                                                        <th>HSN</th>
                                                        <th class="text-right">QTY</th>
                                                        <th>UNIT</th>
                                                        <th class="text-right">RATE</th>
                                                        <th class="text-right">MRP</th>
                                                        <th class="text-right">GRS AMT</th>
                                                        <th class="text-right">DB DISC</th>
                                                        <th class="text-right">SCH %</th>
                                                        <th class="text-right">SCH DISC</th>
                                                        <th class="text-right">TAXABLE</th>
                                                        <th style="width: 120px;">SGST %-AMT</th>
                                                        <th style="width: 120px;">CGST %-AMT</th>
                                                        <th class="text-right">NET AMT</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    ${pageItemsHtml}
                                                </tbody>
                                                <tfoot>
                                                    ${tfootHtml}
                                                </tfoot>
                                            </table>
                                        </div>
                                        ${footerHtml}
                                    </div>
                                `;
                            }

                            const printHtml = `
                                <!DOCTYPE html>
                                <html>
                                <head>
                                    <title>${invoiceTitle}</title>
                                    <style>
                                        @media print {
                                            @page { size: A3 landscape; margin: 12mm; } 
                                            body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                                        }
                                        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12pt; color: #000; background: #fff; margin: 0; padding: 0; }
                                        * { box-sizing: border-box; }
                                        
                                        .text-uppercase { text-transform: uppercase !important; }
                                        /* 🚀 THE FIX: Stripped min-height and margin-bottom to prevent overflowing to Page 2 */
                                        .invoice-wrapper { max-width: 100%; border: 2px solid #000; border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; page-break-inside: avoid; }
                                        
                                        .header-card { padding: 12px 15px; display: flex; justify-content: space-between; border-bottom: 2px solid #000; background: #fff; }
                                        .invoice-title { font-size: 24pt; font-weight: 900; color: #000; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 5px; }
                                        .seller-name { font-size: 18pt; font-weight: 900; color: #000; text-transform: uppercase; margin-bottom: 5px; }
                                        .font-bold { font-weight: bold; } .font-black { font-weight: 900; }
                                        
                                        .info-grid { display: flex; border-bottom: 2px solid #000; background: #fff; }
                                        .info-col { flex: 1; padding: 10px 15px; }
                                        .info-col:first-child { border-right: 2px solid #000; }
                                        .section-title { font-size: 12pt; font-weight: 900; color: #000; text-transform: uppercase; text-decoration: underline; margin-bottom: 6px; }
                                        
                                        table { width: 100%; border-collapse: collapse; background: #fff; }
                                        th { background-color: #fff; padding: 10px 6px; font-size: 10pt; font-weight: 800; color: #000; border-bottom: 2px solid #000; border-right: 1px solid #000; text-transform: uppercase; text-align: center; }
                                        th:last-child { border-right: none; }
                                        td { padding: 8px 6px; border-bottom: 1px solid #000; border-right: 1px solid #000; color: #000; font-size: 11pt; vertical-align: middle; }
                                        td:last-child { border-right: none; }
                                        
                                        .text-right { text-align: right; } .text-left { text-align: left; } .text-center { text-align: center; }
                                        .tfoot-row td { background-color: #fff; font-size: 12pt; border-top: 2px solid #000; border-bottom: none; color: #000; padding: 10px 6px; }
                                        
                                        .amount-words-row td { background-color: #fff; border-top: 2px solid #000; border-bottom: none; padding: 10px 15px; font-size: 11pt; }
                                        
                                        .footer-section { display: flex; margin-top: auto; border-top: 2px solid #000; background: #fff; }
                                        .footer-left { flex: 1; padding: 15px; border-right: 2px solid #000; }
                                        .footer-right { flex: 1; padding: 15px; display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; }
                                        
                                        .bank-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; font-size: 11pt; margin-bottom: 10px; }
                                        .terms-text { font-size: 10pt; color: #000; line-height: 1.3; }
                                    </style>
                                </head>
                                <!-- 🚀 THE FIX: Stripped inline body padding to reclaim border space -->
                                <body>
                                    ${pagesHtml}
                                </body>
                                </html>
                            `;

                            // ==========================================
                            // 5. POPUP-SAFE PRINT EXECUTION
                            // ==========================================
                            const isDesktop = window.electronAPI && typeof window.electronAPI.printSilent === 'function';
                            const silentToggle = document.getElementById('setting-silent-print') || document.querySelector('input[name="silentPrint"]');
                            const isSilentMode = (silentToggle && silentToggle.checked) || localStorage.getItem('mifela_silent_print') === 'true';

                            if (isDesktop && isSilentMode) {
                                window.electronAPI.printSilent(printHtml);
                                setTimeout(() => {
                                    printBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>`;
                                }, 800);
                            } else {
                                let printIframe = document.getElementById('b2b-print-iframe');
                                if (!printIframe) {
                                    printIframe = document.createElement('iframe');
                                    printIframe.id = 'b2b-print-iframe';
                                    printIframe.style.position = 'fixed';
                                    printIframe.style.width = '0px';
                                    printIframe.style.height = '0px';
                                    printIframe.style.border = 'none';
                                    document.body.appendChild(printIframe);
                                }
                                const iframeDoc = printIframe.contentWindow.document;
                                iframeDoc.open();
                                iframeDoc.write(printHtml);
                                iframeDoc.close();

                                setTimeout(() => {
                                    printIframe.contentWindow.focus();
                                    printIframe.contentWindow.print(); 
                                    printBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>`;
                                }, 800);
                            }
                        } catch (err) {
                            console.error("Print generation failed", err);
                            alert("Failed to generate print document. Check console.");
                            printBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>`;
                        }
                    })();
                }
                return;
            }
            const fullPrintBtn = e.target.closest('#print-history-btn');
        if (fullPrintBtn) {
            e.stopPropagation();

            const originalContent = fullPrintBtn.innerHTML;
            fullPrintBtn.innerHTML = `<svg class="animate-spin w-4 h-4 mr-2 inline" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Generating...`;
            fullPrintBtn.disabled = true;

            // 🚀 THE FIX: Generate a beautiful, pure CSS ledger directly from memory
            let ledgerRows = '';
            localTransactionsCache.forEach((tx, index) => {
                const dateObj = tx.timestamp?.toDate ? tx.timestamp.toDate() : new Date();
                const dateStr = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
                const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                const amount = Math.abs(tx.summary?.total || 0).toFixed(2);
                const type = escapeHTML(tx.type || 'SALE').replace(/_/g, ' ');
                const method = escapeHTML(tx.summary?.paymentMethod || 'SYSTEM');
                const invId = escapeHTML(tx.invoiceId || 'N/A');

                let itemRows = '';
                if (tx.items && tx.items.length > 0) {
                    itemRows = `<table class="item-table">`;
                    tx.items.forEach((item, i) => {
                        const qty = item.quantity || 0;
                        const price = parseFloat(item.price || item.cost || 0).toFixed(2);
                        itemRows += `<tr>
                            <td width="5%">${i+1}.</td>
                            <td width="50%">${escapeHTML(item.name)}</td>
                            <td width="20%">${qty} x ₹${price}</td>
                            <td width="25%" style="text-align:right; font-weight:bold;">₹${(qty * price).toFixed(2)}</td>
                        </tr>`;
                    });
                    itemRows += `</table>`;
                }

                ledgerRows += `
                    <div class="tx-block">
                        <div class="tx-header">
                            <div><strong>${invId}</strong> &nbsp;|&nbsp; ${type} &nbsp;|&nbsp; ${method}</div>
                            <div style="text-align: right;">
                                <div style="color: #64748b;">${dateStr} ${timeStr}</div>
                                <div class="tx-amount">₹${amount}</div>
                            </div>
                        </div>
                        ${itemRows}
                    </div>
                `;
            });

            const printHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Ledger History - ${escapeHTML(name)}</title>
                    <style>
                        @media print {
                            @page { size: A4; margin: 15mm; }
                            body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                        }
                        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.5; padding: 20px; max-width: 800px; margin: 0 auto; }
                        .header { border-bottom: 2px solid #1e293b; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
                        .title { font-size: 24px; font-weight: 900; text-transform: uppercase; margin: 0 0 5px 0; }
                        .subtitle { font-size: 18px; font-weight: bold; margin: 0; color: #334155; }
                        .meta { font-size: 12px; color: #64748b; font-family: monospace; }
                        .right-align { text-align: right; }
                        
                        .tx-block { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 12px; page-break-inside: avoid; }
                        .tx-header { display: flex; justify-content: space-between; border-bottom: 1px dashed #cbd5e1; padding-bottom: 8px; margin-bottom: 8px; font-size: 13px; }
                        .tx-amount { font-size: 16px; font-weight: 900; color: #0f172a; }
                        
                        .item-table { width: 100%; border-collapse: collapse; font-size: 11px; color: #475569; }
                        .item-table td { padding: 4px 0; border-bottom: 1px solid #f8fafc; vertical-align: top; }
                        .item-table tr:last-child td { border-bottom: none; }
                        
                        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 10px; color: #94a3b8; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <div>
                            <h1 class="title">Ledger Statement</h1>
                            <h2 class="subtitle">${escapeHTML(name)}</h2>
                            <span class="meta">ID: ${customerId}</span>
                        </div>
                        <div class="right-align">
                            <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #64748b;">Generated On</div>
                            <strong>${new Date().toLocaleString('en-IN')}</strong>
                        </div>
                    </div>
                    
                    <div>
                        ${ledgerRows || '<p style="text-align:center; padding: 40px; color: #94a3b8;">No transactions found.</p>'}
                    </div>

                    <div class="footer">
                        This is a computer-generated statement and does not require a signature.<br>
                        Powered by Mifela POS
                    </div>
                </body>
                </html>
            `;

            try {
                let printIframe = document.getElementById('ledger-full-print-iframe');
                if (!printIframe) {
                    printIframe = document.createElement('iframe');
                    printIframe.id = 'ledger-full-print-iframe';
                    printIframe.style.position = 'fixed';
                    printIframe.style.right = '0';
                    printIframe.style.bottom = '0';
                    printIframe.style.width = '0px';
                    printIframe.style.height = '0px';
                    printIframe.style.border = 'none';
                    document.body.appendChild(printIframe);
                }

                const iframeDoc = printIframe.contentWindow.document;
                iframeDoc.open();
                iframeDoc.write(printHtml);
                iframeDoc.close();

                setTimeout(() => {
                    try {
                        printIframe.contentWindow.focus();
                        printIframe.contentWindow.print();
                    } catch (printErr) {
                        console.error("Iframe print failed:", printErr);
                    } finally {
                        fullPrintBtn.innerHTML = originalContent;
                        fullPrintBtn.disabled = false;
                    }
                }, 500);

            } catch (err) {
                console.error("Ledger Print Failed:", err);
                alert("Failed to generate print document.");
                fullPrintBtn.innerHTML = originalContent;
                fullPrintBtn.disabled = false;
            }
            return;
        }
            // 🚀 2. THE ACCORDION TOGGLE LOGIC
            const header = e.target.closest('.accordion-header');
            if (header) {
                // Find the body inside the same wrapper container
                const body = header.parentElement.querySelector('.accordion-body');
                const arrow = header.querySelector('.arrow-icon');

                if (body) {
                    // Toggle the view
                    body.classList.toggle('hidden');
                    
                    // Flip the arrow
                    if (arrow) {
                        arrow.classList.toggle('rotate-180');
                    }
                }
            }
        });
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('overflow-hidden');
    
    const titleEl = document.getElementById('history-modal-title');
    const subtitleEl = document.getElementById('history-modal-subtitle');
    const contentEl = document.getElementById('history-modal-content');

    if (titleEl) titleEl.innerHTML = `<span class="bg-indigo-50 text-indigo-600 p-2 rounded-xl text-lg shadow-sm">📜</span> Ledger: ${escapeHTML(name)}`;
    if (subtitleEl) subtitleEl.textContent = `ID: ${customerId}`;
    contentEl.innerHTML = `<div class="flex flex-col items-center justify-center py-20 opacity-50"><div class="animate-spin rounded-full h-10 w-10 border-b-4 border-indigo-600 mb-4"></div><p class="text-sm font-bold text-slate-500 uppercase tracking-widest">Fetching Ledgers...</p></div>`;

    localTransactionsCache = []; 

    // 🚀 THE FIX: Dynamically assign the click handler every single time the modal is opened
    // This guarantees the button always has the correct customerId and customerName in memory!
    const mergeBtn = document.getElementById('execute-merge-btn');
    if (mergeBtn) {
        mergeBtn.onclick = () => {
            const selected = Array.from(document.querySelectorAll('.ledger-merge-cb:checked')).map(cb => cb.value);
            window.executeLedgerMerge(selected, customerId, name);
        };
    }

    setTimeout(async () => {
        try {
            // 🚀 THE FIX: Completely replaced Firebase queries with offline SQLite lookup
            if (!window.dbAPI || !window.dbAPI.getTransactionsForCustomer) {
                throw new Error("Offline database API is missing.");
            }

            const rawHistory = await window.dbAPI.getTransactionsForCustomer(customerId);
            
            // Sort Descending (Newest first) and limit to 50
            localTransactionsCache = rawHistory.sort((a, b) => {
                const tA = new Date(a.timestamp).getTime();
                const tB = new Date(b.timestamp).getTime();
                return tB - tA;
            }).slice(0, 50);
            
            if (localTransactionsCache.length === 0) {
                contentEl.innerHTML = `<div class="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-dashed border-slate-200"><span class="text-5xl mb-4 opacity-20">📁</span><p class="text-slate-500 font-bold">No history found for this partner.</p></div>`;
                return;
            }

            let html = '<div class="space-y-4">';

            localTransactionsCache.forEach(tx => {
                const dateObj = tx.timestamp?.toDate ? tx.timestamp.toDate() : new Date();
                const date = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
                const time = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                
                const total = Math.abs(tx.summary?.total || 0).toFixed(2);
                const method = escapeHTML(tx.summary?.paymentMethod || 'SYSTEM');
                
                let typeColor = 'text-blue-700 bg-blue-50 border-blue-200'; 
                let methodBadge = '';
                
                if (tx.type === 'PURCHASE') typeColor = 'text-purple-700 bg-purple-50 border-purple-200';
                if (tx.type === 'REFUND' || tx.type === 'LOSS') typeColor = 'text-red-700 bg-red-50 border-red-200';
                if (tx.type === 'PRODUCTION') typeColor = 'text-orange-700 bg-orange-50 border-orange-200';
                if (tx.type === 'MERGED_LEDGER') typeColor = 'text-fuchsia-700 bg-fuchsia-50 border-fuchsia-200';

                if (method === 'Internal Transfer') {
                    typeColor = 'text-emerald-700 bg-emerald-50 border-emerald-200';
                    methodBadge = '<span class="ml-2 px-2 py-0.5 rounded text-[9px] font-black tracking-widest uppercase bg-slate-800 text-white">DISPATCH</span>';
                }

                const items = tx.items || [];
                let itemsHtml = '';
                
                const trueSubtotal = items.reduce((sum, item) => {
                    const unitRate = parseFloat(item.cost || item.purchasePrice || item.price || 0);
                    const lineTotal = item.subtotal !== undefined ? parseFloat(item.subtotal) : (unitRate * item.quantity);
                    return sum + lineTotal;
                }, 0);

                if (items.length > 0) {
                    itemsHtml = items.map((item, index) => {
                        const unitRate = parseFloat(item.cost || item.purchasePrice || item.price || 0);
                        const lineTotal = item.subtotal !== undefined ? parseFloat(item.subtotal) : (unitRate * item.quantity);

                        // 🚀 NEW: Check for Free items in the historical record
                        const freeQty = parseInt(item.freeQty) || 0;
                        const freeBadge = freeQty > 0 ? `<span class="ml-2 text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded shadow-sm">+${freeQty} Free</span>` : '';

                        return `
                        <div class="flex justify-between items-start text-xs py-3 border-b border-slate-100 last:border-0 hover:bg-white transition-colors px-4 rounded-lg group">
                            <span class="text-slate-400 font-mono w-6 text-[10px] pt-0.5">${index + 1}.</span>
                            <div class="flex-1 pr-4">
                                <div class="text-slate-800 font-bold leading-tight flex items-center">${escapeHTML(item.name)} ${freeBadge}</div>
                                ${item.sku || item.barcode ? `<div class="text-[9px] text-slate-400 font-mono mt-0.5">${escapeHTML(item.sku || item.barcode || '')}</div>` : ''}
                            </div>
                            <div class="w-28 text-right flex flex-col items-end">
                                <span class="text-slate-500 font-mono">${item.quantity} <span class="text-[10px] text-slate-400">x</span> ₹${unitRate.toFixed(2)}</span>
                            </div>
                            <span class="text-slate-900 font-black w-24 text-right tracking-tight pt-0.5">₹${lineTotal.toFixed(2)}</span>
                        </div>
                        `;
                    }).join('');
                } else {
                    itemsHtml = '<div class="text-xs text-slate-400 italic py-4 px-4 text-center">No itemized details recorded.</div>';
                }

               // 🚀 THE FIX 1: Always allow selection, even for merged ledgers!
                const checkboxHtml = `<input type="checkbox" class="ledger-merge-cb w-5 h-5 text-indigo-600 rounded cursor-pointer border-slate-300 focus:ring-indigo-500" value="${tx.id}" onclick="event.stopPropagation();">`;

                // 🚀 THE FIX 2: Always include Print and Expand buttons, appending Undo only if it's a merge
                let actionsHtml = `<div class="flex items-center gap-2">`;
                
                if (tx.type === 'MERGED_LEDGER') {
                    actionsHtml += `
                        <button onclick="event.stopPropagation(); window.undoLedgerMerge('${tx.id}', '${customerId}', '${escapeHTML(name)}')" class="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-200 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition shadow-sm uppercase tracking-wider">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg>
                            Undo
                        </button>
                    `;
                }

                actionsHtml += `
                        <button data-txid="${tx.id}" class="print-single-tx-btn w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center hover:bg-indigo-600 hover:text-white transition-colors shadow-sm text-indigo-600" title="Print Individual Receipt">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                        </button>
                        <div class="w-8 h-8 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center group-hover:bg-indigo-50 group-hover:border-indigo-200 transition-colors shadow-inner">
                            <svg class="arrow-icon w-5 h-5 text-slate-400 group-hover:text-indigo-600 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                    </div>
                `;

                html += `
                    <div class="border border-slate-200 rounded-2xl bg-white shadow-sm overflow-hidden transition-all duration-200 hover:border-indigo-300 hover:shadow-md flex flex-row items-stretch">
                        <div class="pl-5 pt-6 flex items-start justify-center">
                            ${checkboxHtml}
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="accordion-header flex justify-between items-center p-5 pl-4 cursor-pointer select-none group transition-colors">
                                <div class="flex-1">
                                    <div class="flex items-center gap-2 mb-1.5">
                                        <span class="font-black text-slate-800 text-lg tracking-tight">${escapeHTML(tx.invoiceId || 'N/A')}</span>
                                        <span class="px-2.5 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase border ${typeColor}">${escapeHTML(tx.type || 'SALE')}</span>
                                        ${methodBadge}
                                    </div>
                                    <div class="text-[11px] font-medium text-slate-500 flex items-center gap-2">
                                        <span class="flex items-center gap-1"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg> ${date} • ${time}</span>
                                        <span class="w-1 h-1 rounded-full bg-slate-300"></span>
                                        <span class="text-slate-600 font-bold uppercase tracking-wider">${method}</span>
                                    </div>
                                </div>
                                
                                <div class="text-right flex items-center gap-5">
                                    <div class="flex flex-col items-end">
                                        <span class="font-black text-xl text-slate-900 tracking-tight">₹${total}</span>
                                        <span class="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mt-0.5">${items.length} Items</span>
                                    </div>
                                    ${actionsHtml}
                                </div>
                            </div>

                            <div class="accordion-body hidden border-t border-slate-100 bg-slate-50/50">
                                <div class="p-5">
                                    <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 pb-3 border-b border-slate-200/80 flex justify-between px-4">
                                        <span>Item Breakdown</span>
                                        <span>Total</span>
                                    </div>
                                    <div class="space-y-1">
                                        ${itemsHtml}
                                    </div>
                                    <div class="mt-4 pt-4 border-t border-slate-200/80 flex flex-col items-end gap-1.5 px-4 text-xs font-medium text-slate-500">
                                        <div class="flex justify-between w-48">
                                            <span>Subtotal:</span>
                                            <span class="font-mono text-slate-700">₹${trueSubtotal.toFixed(2)}</span>
                                        </div>
                                        ${parseFloat(tx.summary?.discount || 0) > 0 ? `
                                        <div class="flex justify-between w-48 text-emerald-600">
                                            <span>Discount:</span>
                                            <span class="font-mono font-bold">-₹${parseFloat(tx.summary.discount).toFixed(2)}</span>
                                        </div>` : ''}
                                        ${parseFloat(tx.summary?.tax || 0) > 0 ? `
                                        <div class="flex justify-between w-48">
                                            <span>Included Tax:</span>
                                            <span class="font-mono text-slate-700">₹${parseFloat(tx.summary.tax).toFixed(2)}</span>
                                        </div>` : ''}
                                        <div class="flex justify-between w-48 mt-2 pt-2 border-t border-slate-200 font-bold text-slate-900 text-sm">
                                            <span>Net Total:</span>
                                            <span class="font-mono">₹${total}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });

            html += '</div>';
            contentEl.innerHTML = html;

        } catch (error) {
            console.error("History Error:", error);
            contentEl.innerHTML = `
                <div class="bg-red-50 border border-red-200 p-6 rounded-2xl text-center shadow-inner">
                    <div class="w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-3">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                    </div>
                    <p class="text-base font-black text-red-800 mb-1 tracking-tight">Failed to load history</p>
                    <p class="text-xs text-red-600 font-medium">${escapeHTML(error.message)}</p>
                </div>
            `;
        }
    }, 50); 
}
export function openLedgerPaymentModal(partyId, partyName, currentBalance, partyType) {
    const modalId = 'ledger-payment-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();

    // 🚀 THE MATH FIX: Direction is determined purely by the balance, NOT the partner type.
    // Positive balance = they owe us (Receive). Negative = we owe them (Send).
    const isReceiving = currentBalance >= 0;
    const absBalance = Math.abs(currentBalance);
    const actionText = isReceiving ? 'Receive Payment' : 'Settle Payable';
    const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';
    
    // Explicit Tailwind classes to survive compiler minification
    const theme = isReceiving 
        ? {
            iconBg: 'bg-emerald-100', iconText: 'text-emerald-600',
            inputFocus: 'focus:border-emerald-500',
            btnBg: 'bg-emerald-600', btnHover: 'hover:bg-emerald-700', btnShadow: 'shadow-emerald-200'
        }
        : {
            iconBg: 'bg-blue-100', iconText: 'text-blue-600',
            inputFocus: 'focus:border-blue-500',
            btnBg: 'bg-blue-600', btnHover: 'hover:bg-blue-700', btnShadow: 'shadow-blue-200'
        };

    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[250] bg-slate-900/60   flex items-center justify-center p-4">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-100">
                <div class="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h3 class="text-lg font-black text-slate-800 flex items-center gap-2">
                        <span class="${theme.iconBg} ${theme.iconText} p-1.5 rounded-lg">${isReceiving ? '📥' : '📤'}</span> ${actionText}
                    </h3>
                    <button onclick="document.getElementById('${modalId}').remove()" class="text-slate-400 hover:text-red-500 transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="p-6 space-y-4">
                    <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 text-center">
                        <p class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">${escapeHTML(partyName)}</p>
                        <p class="text-2xl font-black text-slate-800">${currency}${absBalance.toFixed(2)} <span class="text-xs text-slate-400 uppercase">${isReceiving ? 'Due' : 'Payable'}</span></p>
                    </div>
                    
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Payment Amount (${currency})</label>
                        <input type="number" id="ledger-pay-amount" value="${absBalance.toFixed(2)}" max="${absBalance}" class="w-full border-2 border-slate-200 rounded-xl p-3 text-lg font-black text-slate-800 ${theme.inputFocus} outline-none transition-colors">
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Payment Mode</label>
                        <select id="ledger-pay-method" class="w-full border-2 border-slate-200 rounded-xl p-3 text-sm font-bold text-slate-700 ${theme.inputFocus} outline-none transition-colors bg-white">
                            <option value="CASH">Cash</option>
                            <option value="UPI">UPI / Digital</option>
                            <option value="CHEQUE">Cheque</option>
                            <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS)</option>
                        </select>
                    </div>
                    
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Reference / Notes (Optional)</label>
                        <input type="text" id="ledger-pay-notes" placeholder="Txn ID or Note" class="w-full border-2 border-slate-200 rounded-xl p-3 text-sm font-medium text-slate-700 ${theme.inputFocus} outline-none transition-colors">
                    </div>
                </div>
                <div class="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                    <button onclick="document.getElementById('${modalId}').remove()" class="px-6 py-2.5 text-slate-600 font-bold bg-white border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors">Cancel</button>
                    <button id="submit-ledger-payment" class="px-8 py-2.5 ${theme.btnBg} text-white font-black tracking-wide rounded-xl shadow-lg ${theme.btnShadow} ${theme.btnHover} active:scale-95 transition-all">Confirm Payment</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    document.body.classList.add('overflow-hidden');

    document.getElementById('submit-ledger-payment').onclick = async () => {
        const amount = parseFloat(document.getElementById('ledger-pay-amount').value);
        const method = document.getElementById('ledger-pay-method').value;
        const notes = document.getElementById('ledger-pay-notes').value.trim();

        if (!amount || amount <= 0) return alert("Enter a valid amount.");
        if (amount > absBalance) return alert("Amount cannot be greater than the outstanding balance.");

        const btn = document.getElementById('submit-ledger-payment');
        btn.disabled = true;
        btn.textContent = "Processing...";

        try {
            // 🚀 THE FIX: Process the transaction locally via SQLite
            const ledgerAmount = isReceiving ? -amount : amount;
            const txType = isReceiving ? 'PAYMENT_RECEIVED' : 'PAYMENT_MADE';

            const txData = {
                id: `FIN-${Date.now().toString().slice(-6)}`,
                invoiceId: `FIN-${Date.now().toString().slice(-6)}`,
                locationId: 'main', 
                timestamp: new Date().toISOString(),
                type: txType,
                customer: { id: partyId, name: partyName },
                summary: { 
                    total: ledgerAmount, 
                    profit: 0, 
                    paymentMethod: method, 
                    reason: notes || (isReceiving ? 'Received Dues' : 'Settled Payable'), 
                    transactionType: txType 
                },
                cashierId: 'SYSTEM', 
                currency: { symbol: currency }, 
                items: []
            };

            if (window.dbAPI && window.dbAPI.processFinancialTransaction) {
                await window.dbAPI.processFinancialTransaction({ 
                    transaction: txData, 
                    customerId: partyId, 
                    duesChange: ledgerAmount 
                });
            }

            document.getElementById(modalId).remove();
            document.body.classList.remove('overflow-hidden');
            
            if (typeof showToast === 'function') showToast("Payment Successful", `${currency}${amount.toFixed(2)} recorded.`, "success");
            
            const localCust = localCustomersCache.find(c => c.id === partyId);
            if (localCust) {
                localCust.dues = (parseFloat(localCust.dues || localCust.balance || 0)) + ledgerAmount;
            }
            if (typeof renderCustomerTable === 'function') renderCustomerTable();

            if (typeof window.handleCustomerIdLookup === 'function') {
                const posCustIdInput = document.getElementById('pos-cust-id');
                if (posCustIdInput && posCustIdInput.value === partyId) {
                    window.handleCustomerIdLookup({ target: { value: partyId } });
                }
            }
            if (document.getElementById('financial-registry-modal')) {
                if (typeof window.renderRegistryTab === 'function') {
                    window.renderRegistryTab(isReceiving ? 'RECEIVABLES' : 'PAYABLES');
                }
            }
        } catch (error) {
            console.error("Payment failed:", error);
            alert("Failed to process payment. Check console.");
            btn.disabled = false;
            btn.textContent = "Confirm Payment";
        }
    };
}
window.openLedgerPaymentModal = openLedgerPaymentModal;
// --- UTILITIES ---



function injectRegistryButton() {
    const container = document.getElementById('dynamic-actions-container');
    if (container && !document.getElementById('open-registry-btn')) {
        const btn = document.createElement('button');
        btn.id = 'open-registry-btn';
        btn.className = "bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-md hover:bg-indigo-700 transition-transform active:scale-95 whitespace-nowrap flex items-center gap-2";
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg> Financial Registry`;
        btn.onclick = () => window.openFinancialRegistry('RECEIVABLES');
        container.appendChild(btn);
    }
}
function triggerExportForCurrentTab() {
    const activeType = document.querySelector('.cust-tab-btn.active')?.dataset.type || 'customer';
    
    // 1. Filter local cache to match the current tab
    const exportData = localCustomersCache.filter(c => {
        if (activeType === 'supplier') return c.type === 'supplier' || c.isSupplier === true;
        return (c.type || 'customer') === activeType;
    }).map(c => {
        // Clean up data for Excel
        return {
            ID: c.docId || c.id,
            Name: c.name || '',
            Phone: c.phone || '',
            Email: c.email || '',
            State: c.state || '',
            Address: c.address || '',
            GSTIN: c.gstin || '',
            Total_Spent: c.totalSpent || 0,
            Outstanding_Dues: (parseFloat(c.dues) || 0) + (parseFloat(c.balance) || 0)
        };
    });

    if (exportData.length === 0) {
        showModal('Empty List', 'There are no partners in this category to export.', 'info');
        return;
    }

    // 2. Generate CSV
    const headers = Object.keys(exportData[0]).join(',');
    const rows = exportData.map(r => Object.values(r).map(val => `"${val}"`).join(',')).join('\n');
    const blob = new Blob([headers + '\n' + rows], { type: 'text/csv' });
    
    // 3. Download
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Mifela_${activeType.toUpperCase()}_Export_${Date.now()}.csv`;
    link.click();
}

window.openFinancialRegistry = async function(initialTab = 'RECEIVABLES') {
    const modalId = 'financial-registry-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();

    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[200] bg-slate-900/60 flex items-center justify-center p-4">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden border border-slate-100 flex flex-col max-h-[95vh]">
                
                <div class="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
                    <h3 class="text-xl font-black text-slate-800 flex items-center gap-2">
                     Financial Settlement Registry
                    </h3>
                    <button onclick="document.getElementById('${modalId}').remove(); document.body.classList.remove('overflow-hidden');" class="text-slate-400 hover:text-red-500 transition-colors bg-white p-2.5 rounded-full shadow-sm border border-slate-200 hover:bg-red-50">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                
                <!-- 🚀 NEW UI: Tab Bar With Custom Add Credit Button -->
                <div class="px-6 py-3 bg-white border-b border-slate-100 flex gap-2 shrink-0 overflow-x-auto items-center">
                    <button onclick="window.renderRegistryTab('RECEIVABLES')" id="reg-tab-RECEIVABLES" class="px-5 py-2 rounded-lg text-sm font-bold transition-colors text-slate-500 hover:bg-slate-100">Collect Dues</button>
                    <button onclick="window.renderRegistryTab('PAYABLES')" id="reg-tab-PAYABLES" class="px-5 py-2 rounded-lg text-sm font-bold transition-colors text-slate-500 hover:bg-slate-100">Settle Payables</button>
                    <button onclick="window.renderRegistryTab('CHEQUES')" id="reg-tab-CHEQUES" class="px-5 py-2 rounded-lg text-sm font-bold transition-colors text-slate-500 hover:bg-slate-100">Review Cheques</button>
                    
                    <div class="flex-1"></div> <!-- Spacer pushes button to the right -->
                    
                    <button onclick="window.openManualCreditModal()" class="px-5 py-2 rounded-xl text-sm font-black bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 transition-all active:scale-95 flex items-center gap-2 whitespace-nowrap">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 4v16m8-8H4"></path></svg>
                        Issue Manual Credit
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto p-6 bg-slate-50/50" id="registry-content-area">
                    <div class="text-center py-10 text-slate-400 font-bold">Loading Registry Data...</div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    document.body.classList.add('overflow-hidden'); 
    await window.renderRegistryTab(initialTab);
};

// ============================================================================
// 🚀 MANUAL CREDIT ENGINE (Add Udhaar without a POS Sale)
// ============================================================================
window.openManualCreditModal = function() {
    const modalId = 'manual-credit-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();

    const sortedCustomers = [...localCustomersCache].sort((a,b) => (a.name||'').localeCompare(b.name||''));
    let optionsHtml = '<option value="">-- Select Partner --</option>';
    sortedCustomers.forEach(c => {
        optionsHtml += `<option value="${c.id}">${escapeHTML(c.name)} ${c.phone ? '('+escapeHTML(c.phone)+')' : ''}</option>`;
    });

    const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';

    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[300] bg-slate-900/60 flex items-center justify-center p-4  ">
            <div class="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-100">
                <div class="px-6 py-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h3 class="text-lg font-black text-slate-800 flex items-center gap-2">
                        <span class="bg-indigo-100 text-indigo-600 p-1.5 rounded-lg">➕</span> Issue Manual Credit
                    </h3>
                    <!-- 🚀 THE FIX: Added body class removal to Close Button -->
                    <button onclick="document.getElementById('${modalId}').remove(); document.body.classList.remove('overflow-hidden');" class="text-slate-400 hover:text-red-500 bg-white border border-slate-200 rounded-full p-2 hover:bg-red-50 transition-colors shadow-sm">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="p-6 space-y-5">
                    <div>
                        <label class="block text-[11px] font-black text-slate-500 mb-1.5 uppercase tracking-widest">Select Partner</label>
                        <select id="mc-partner" class="w-full border-2 border-slate-200 rounded-xl p-3 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors bg-white shadow-sm">
                            ${optionsHtml}
                        </select>
                    </div>
                    <div>
                        <label class="block text-[11px] font-black text-slate-500 mb-1.5 uppercase tracking-widest">Amount (${currency})</label>
                        <input type="number" id="mc-amount" placeholder="0.00" class="w-full border-2 border-slate-200 rounded-xl p-3 text-lg font-black text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors shadow-sm">
                    </div>
                    <div>
                        <label class="block text-[11px] font-black text-slate-500 mb-1.5 uppercase tracking-widest">Type of Credit</label>
                        <select id="mc-type" class="w-full border-2 border-slate-200 rounded-xl p-3 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors bg-white shadow-sm">
                            <option value="give">I gave them money / goods (They owe me)</option>
                            <option value="take">I took money / goods (I owe them)</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[11px] font-black text-slate-500 mb-1.5 uppercase tracking-widest">Reason / Notes</label>
                        <input type="text" id="mc-notes" placeholder="e.g., Cash Loan, Opening Balance Correction" class="w-full border-2 border-slate-200 rounded-xl p-3 text-sm font-medium text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors shadow-sm">
                    </div>
                </div>
                <div class="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                    <!-- 🚀 THE FIX: Added body class removal to Cancel Button -->
                    <button onclick="document.getElementById('${modalId}').remove(); document.body.classList.remove('overflow-hidden');" class="px-6 py-3 text-slate-600 font-bold bg-white border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors shadow-sm">Cancel</button>
                    <button id="mc-submit" class="px-8 py-3 bg-indigo-600 text-white font-black tracking-wide rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all">Confirm Credit</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    document.body.classList.add('overflow-hidden');

    document.getElementById('mc-submit').onclick = async () => {
        const partnerId = document.getElementById('mc-partner').value;
        const amount = parseFloat(document.getElementById('mc-amount').value);
        const type = document.getElementById('mc-type').value;
        const notes = document.getElementById('mc-notes').value.trim();

        if (!partnerId) return alert("Please select a partner.");
        if (!amount || amount <= 0) return alert("Enter a valid amount.");
        if (!notes) return alert("Please enter a reason or note.");

        const btn = document.getElementById('mc-submit');
        btn.disabled = true;
        btn.textContent = "Processing...";

        try {
            // 🚀 THE FIX: Removed undefined references to currentBalance and absBalance.
            // In Manual Credit, 'give' means they owe us (positive dues), 'take' means we owe them (negative dues).
            const isGiven = (type === 'give');
            const ledgerAmount = isGiven ? amount : -amount;
            const txType = 'MANUAL_CREDIT';

            const txData = {
                id: `FIN-${Date.now().toString().slice(-6)}`,
                invoiceId: `FIN-${Date.now().toString().slice(-6)}`,
                locationId: 'main', 
                timestamp: new Date().toISOString(),
                type: txType,
                customer: { 
                    id: partnerId, 
                    name: document.getElementById('mc-partner').options[document.getElementById('mc-partner').selectedIndex].text 
                },
                summary: { 
                    total: ledgerAmount, 
                    profit: 0, 
                    paymentMethod: 'CASH', 
                    reason: notes, 
                    transactionType: txType 
                },
                cashierId: 'SYSTEM', 
                currency: { symbol: '₹' }, 
                items: []
            };

            if (window.dbAPI && window.dbAPI.processFinancialTransaction) {
                await window.dbAPI.processFinancialTransaction({ 
                    transaction: txData, 
                    customerId: partnerId, 
                    duesChange: ledgerAmount 
                });
            }

            document.getElementById(modalId).remove();
            document.body.classList.remove('overflow-hidden');
            
            if (typeof showToast === 'function') showToast("Success", "Transaction recorded locally.", "success");
            
            // 🚀 Keep UI perfectly in sync
            const localCust = localCustomersCache.find(c => c.id === partnerId);
            if (localCust) {
                localCust.dues = (parseFloat(localCust.dues || localCust.balance || 0)) + ledgerAmount;
            }
            if (typeof renderCustomerTable === 'function') renderCustomerTable();
            
        } catch(e) {
            console.error("Manual Credit Error:", e);
            alert("Failed to process transaction.");
            btn.disabled = false;
            btn.textContent = "Confirm Credit";
        }
    };
};

window.renderRegistryTab = async function(tab) {
    const contentArea = document.getElementById('registry-content-area');
    if (!contentArea) return;

    // Reset Tabs UI
    ['RECEIVABLES', 'PAYABLES', 'CHEQUES'].forEach(t => {
        const btn = document.getElementById(`reg-tab-${t}`);
        if (btn) btn.className = "px-5 py-2 rounded-lg text-sm font-bold transition-colors text-slate-500 hover:bg-slate-100";
    });

    const activeBtn = document.getElementById(`reg-tab-${tab}`);
    if (activeBtn) {
        if (tab === 'RECEIVABLES') activeBtn.className = "px-5 py-2 rounded-lg text-sm font-black transition-colors bg-amber-50 text-amber-700 border border-amber-200 shadow-sm";
        if (tab === 'PAYABLES') activeBtn.className = "px-5 py-2 rounded-lg text-sm font-black transition-colors bg-blue-50 text-blue-700 border border-blue-200 shadow-sm";
        if (tab === 'CHEQUES') activeBtn.className = "px-5 py-2 rounded-lg text-sm font-black transition-colors bg-red-50 text-red-700 border border-red-200 shadow-sm";
    }

    contentArea.innerHTML = `<div class="text-center py-10 text-slate-400 font-bold">Scanning live ledgers for ${tab}...</div>`;
    const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';

    if (tab === 'RECEIVABLES' || tab === 'PAYABLES') {
        const isRec = tab === 'RECEIVABLES';
        
        try {
            let list = [];
            if (window.dbAPI && window.dbAPI.getCustomers) {
                const rawCustomers = await window.dbAPI.getCustomers();
                
                rawCustomers.forEach(data => {
                    // 🚀 THE FIX: Prevent staff payroll advances and attendance logs from showing up in B2B ledgers
                    const cid = data.id || data.docId || '';
                    if (data.role !== undefined || cid.includes('_att_') || cid.includes('shifts_')) return;

                    const rawBal = (parseFloat(data.dues) || 0) + (parseFloat(data.balance) || 0);
                    if (isRec && rawBal > 0.01) list.push({ ...data, rawBal });
                    if (!isRec && rawBal < -0.01) list.push({ ...data, rawBal });
                });
            }

            if (list.length === 0) {
                contentArea.innerHTML = `
                    <div class="flex flex-col items-center justify-center py-20 text-center">
                        <div class="text-5xl mb-4">✨</div>
                        <p class="text-slate-600 font-black">No pending ${tab.toLowerCase()} found.</p>
                        <p class="text-slate-400 text-sm mt-1">Everything is settled for now!</p>
                    </div>`;
                return;
            }

            const rows = list.map(c => {
                const bal = Math.abs(c.rawBal);
                const safeName = escapeHTML(c.name || c.storeName || 'Unknown').replace(/'/g, "\\'");
                
                return `
                    <tr class="bg-white border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td class="p-4 font-bold text-slate-800">${escapeHTML(c.name || c.storeName || 'Unknown')} <br><span class="text-[10px] font-mono text-slate-400">${escapeHTML(c.phone || c.id)}</span></td>
                        <td class="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">${escapeHTML(c.type || 'Partner')}</td>
                        <td class="p-4 text-right font-black text-lg ${isRec ? 'text-amber-600' : 'text-blue-600'}">${currency}${bal.toFixed(2)}</td>
                        <td class="p-4 text-right">
                            <button onclick="document.getElementById('financial-registry-modal').remove(); if(window.openLedgerPaymentModal) { window.openLedgerPaymentModal('${c.id}', '${safeName}', ${c.rawBal}, '${c.type || 'customer'}'); } else { alert('Payment modal not found. Please refresh the page.'); }" 
                                class="px-5 py-2.5 text-xs font-black text-white rounded-xl shadow-sm transition-transform active:scale-95 ${isRec ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'}">
                                ${isRec ? 'Receive Payment' : 'Settle Due'}
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');

            contentArea.innerHTML = `
                <div class="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
                    <table class="w-full text-left">
                        <thead class="bg-slate-100 border-b border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                            <tr><th class="p-4">Partner Name</th><th class="p-4">Type</th><th class="p-4 text-right">Outstanding Amount</th><th class="p-4 text-right">Action</th></tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;
        } catch (err) {
            console.error("Registry Fetch Error:", err);
            contentArea.innerHTML = `<div class="text-center py-10 text-red-500 font-bold">Failed to load data. Please check your connection.</div>`;
        }
    }
    else if (tab === 'CHEQUES') {
        try {
            let pendingCheques = [];
            // 🚀 THE FIX: Fetch directly from SQLite
            if (window.dbAPI && window.dbAPI.getPendingCheques) {
                pendingCheques = await window.dbAPI.getPendingCheques();
            }

            pendingCheques.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            if (pendingCheques.length === 0) {
                contentArea.innerHTML = `<div class="flex flex-col items-center justify-center py-16"><div class="text-4xl mb-4">🎉</div><div class="text-slate-500 font-bold tracking-widest uppercase">No pending cheques to review!</div></div>`;
                return;
            }

            const rows = pendingCheques.map(tx => {
                const partyName = tx.customer?.name || 'Unknown Partner';
                const txType = (tx.type || '').toUpperCase();
                const isIncoming = txType === 'SALE' || txType === 'REFUND_RECEIVED' || txType === 'PAYMENT_RECEIVED';
                const badgeColor = isIncoming ? 'text-green-700 bg-green-50 border-green-200' : 'text-orange-700 bg-orange-50 border-orange-200';
                const badgeText = isIncoming ? 'INCOMING (RECEIVABLE)' : 'OUTGOING (PAYABLE)';

                return `
                <tr class="bg-white border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td class="p-4">
                        <div class="font-bold text-slate-800">${escapeHTML(partyName)}</div>
                        <div class="mt-1 inline-flex items-center text-[9px] font-black px-2 py-0.5 rounded border uppercase tracking-widest ${badgeColor}">${badgeText}</div>
                    </td>
                    <td class="p-4">
                        <div class="text-sm font-bold text-slate-700">🏦 ${escapeHTML(tx.summary.chequeDetails.bank || 'Unknown Bank')}</div>
                        <div class="text-xs text-slate-500 font-mono mt-1">No: ${escapeHTML(tx.summary.chequeDetails.chequeNo || 'N/A')}</div>
                        <div class="text-xs text-amber-600 font-bold mt-1">Clear by: ${tx.summary.chequeDetails.clearanceDate || 'N/A'}</div>
                    </td>
                    <td class="p-4 text-right font-black text-lg text-slate-800">${currency}${Math.abs(tx.summary.total || 0).toFixed(2)}</td>
                    <td class="p-4 text-right flex flex-col items-end gap-2 justify-center h-full pt-6">
                        <button onclick="window.updateRegistryCheque('${tx.id}', 'CLEARED')" class="px-4 py-1.5 bg-green-500 text-white hover:bg-green-600 font-black rounded-lg text-xs uppercase tracking-wider shadow-sm transition-transform active:scale-95 w-24">Pass</button>
                        <button onclick="window.updateRegistryCheque('${tx.id}', 'BOUNCED')" class="px-4 py-1.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 font-bold rounded-lg text-xs uppercase tracking-wider shadow-sm transition-transform active:scale-95 w-24">Bounce</button>
                    </td>
                </tr>
                `;
            }).join('');

            contentArea.innerHTML = `
                <div class="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
                    <table class="w-full text-left">
                        <thead class="bg-slate-100 border-b border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                            <tr><th class="p-4">Partner</th><th class="p-4">Cheque Details</th><th class="p-4 text-right">Amount</th><th class="p-4 text-right">Action</th></tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;
        } catch (err) {
            console.error(err);
            contentArea.innerHTML = `<div class="text-center py-10 text-red-500 font-bold">Failed to load cheques.</div>`;
        }
    }
};

window.updateRegistryCheque = async function(txId, newStatus) {
    if (!confirm(`Mark this cheque as ${newStatus}?`)) return;
    try {
        if (window.dbAPI && window.dbAPI.updateChequeStatus) {
            await window.dbAPI.updateChequeStatus(txId, newStatus, new Date().toISOString());
            if (typeof showToast === 'function') showToast("Updated", `Cheque marked as ${newStatus}`, "success");
            window.renderRegistryTab('CHEQUES'); 
        }
    } catch (error) {
        console.error("Error updating cheque:", error);
        alert("Failed to update cheque status.");
    }
};

// ============================================================================
// 🧬 LEDGER MERGE & DEMERGE ENGINE
// ============================================================================

/**
 * Merges an array of transaction IDs into a single ledger entry.
 * @param {Array} selectedTxIds - Array of transaction document IDs (e.g., ['PAY-169801', 'PAY-290472'])
 * @param {String} customerId - The ID of the customer the ledger belongs to
 */

/**
 * Undoes a merge, destroying the merged record and restoring the originals exactly as they were.
 * @param {String} mergedTxId - The ID of the MERGED_LEDGER transaction
 */

window.executeLedgerMerge = async function(selectedTxIds, customerId, customerName) {
    if (!selectedTxIds || selectedTxIds.length < 2) {
        return alert("You must select at least 2 records to merge.");
    }
    if (!confirm(`Are you sure you want to merge these ${selectedTxIds.length} records into one?`)) return;

    try {
        // 🚀 THE FIX: Offload the heavy merge logic to SQLite
        if (window.dbAPI && window.dbAPI.executeLedgerMerge) {
            const result = await window.dbAPI.executeLedgerMerge({ selectedTxIds, customerId, customerName });
            if (result.success) {
                if (typeof showToast === 'function') showToast("Merged Successfully", `Records bundled into ${result.mergedId}`, "success");
                if (typeof loadCustomerHistory === 'function') loadCustomerHistory(customerId, customerName);
            }
        }
    } catch (error) {
        console.error("Merge Error:", error);
        alert("Failed to merge records: " + error.message);
    }
};

window.undoLedgerMerge = async function(mergedTxId, customerId, customerName) {
    if (!confirm("Undo this merge and restore the original separate records?")) return;

    try {
        if (window.dbAPI && window.dbAPI.undoLedgerMerge) {
            await window.dbAPI.undoLedgerMerge(mergedTxId);
            if (typeof showToast === 'function') showToast("Undo Successful", "Original records restored.", "success");
            if (typeof loadCustomerHistory === 'function') loadCustomerHistory(customerId, customerName);
        }
    } catch (error) {
        console.error("Demerge Error:", error);
        alert("Failed to undo merge: " + error.message);
    }
};


// ============================================================================
// 🧹 DIRECTORY CLEANUP ENGINE (Statically Linked for Electron .EXE)
// ============================================================================



export async function getLoyaltyConfig() {
    try {
        // 🚀 THE FIX: Fetch from local memory instead of Firebase doc()
        const currentAppId = typeof window !== 'undefined' && window.__app_id ? window.__app_id : 'electron-mifela-inventory';
        const sId = typeof getStoreId === 'function' ? getStoreId() : 'LOCAL_STORE_01';
        
        const rawConfig = localStorage.getItem(`mifela_loyalty_config_${sId}`);
        if (rawConfig) {
            return JSON.parse(rawConfig);
        }
        
        // Default Offline Config if none is found
        return { enabled: true, earnRatio: 100, tokenValue: 1 };
        
    } catch (e) {
        console.warn("Could not fetch loyalty config:", e);
        return { enabled: false, earnRatio: 100, tokenValue: 1 };
    }
}



export async function addLoyaltyPoints(customerId, totalAmount) {
}

window.openCustomerLoyaltyAnalytics = async function(customerId) {
    const c = localCustomersCache.find(x => x.docId === customerId || x.id === customerId);
    if (!c) return showToast('Error', 'Customer not found.', 'error');

    const modalId = 'customer-loyalty-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();

    // 1. Fetch Dynamic Config safely
    let earnRatio = 100;
    let tokenValue = 1; 
    try {
        const config = await getLoyaltyConfig();
        earnRatio = config.earnRatio || 100;
        tokenValue = config.tokenValue || 1;
    } catch(e) {
        console.warn("Could not fetch loyalty config", e);
    }

    // 2. Calculate Tier & Progress
    const points = c.loyaltyPoints || c.loyaltyTokens || 0;
    const totalSpent = parseFloat(c.totalSpent || 0);
    const monetaryValue = (points * tokenValue).toFixed(2);
    const currency = typeof CURRENT_CURRENCY_SYMBOL !== 'undefined' ? CURRENT_CURRENCY_SYMBOL : '₹';

    const currentTier = getLoyaltyTier(points);
    let nextTierName = 'MAX TIER';
    let pointsNeeded = 0;
    let progressPercent = 100;

    if (points < 500) { nextTierName = 'SILVER'; pointsNeeded = 500 - points; progressPercent = (points/500)*100; }
    else if (points < 2000) { nextTierName = 'GOLD'; pointsNeeded = 2000 - points; progressPercent = ((points-500)/1500)*100; }
    else if (points < 5000) { nextTierName = 'PLATINUM'; pointsNeeded = 5000 - points; progressPercent = ((points-2000)/3000)*100; }

    // 3. Build UI
    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[200] bg-slate-900/60 flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100 transform ">
                <div class="px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-yellow-50 to-white flex justify-between items-center">
                    <h3 class="text-lg font-black text-slate-800 flex items-center gap-2">
                         Loyalty Analytics
                    </h3>
                    <button onclick="document.getElementById('${modalId}').remove(); document.body.classList.remove('overflow-hidden');" class="text-slate-400 hover:text-red-500 transition-colors bg-white p-2 rounded-full shadow-sm border border-slate-100">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                
                <div class="p-6 space-y-6">
                    <div class="text-center">
                        <h4 class="text-xl font-bold text-slate-900">${escapeHTML(c.name)}</h4>
                        <div class="mt-2 inline-block ${currentTier.color} px-3 py-1 rounded-full text-xs font-black tracking-widest uppercase shadow-sm">
                            ${currentTier.name} MEMBER
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center shadow-inner">
                            <p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Token Balance</p>
                            <p class="text-2xl font-black text-slate-800">${points}</p>
                        </div>
                        <div class="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 text-center shadow-inner">
                            <p class="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">Rupee Value</p>
                            <p class="text-2xl font-black text-emerald-700">${currency}${monetaryValue}</p>
                        </div>
                    </div>

                    <div class="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                        <div class="flex justify-between text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">
                            <span>Progress to ${nextTierName}</span>
                            <span>${pointsNeeded > 0 ? `${pointsNeeded} pts to go` : 'MAXED'}</span>
                        </div>
                        <div class="w-full bg-slate-100 rounded-full h-3 mb-4 shadow-inner overflow-hidden">
                            <div class="bg-gradient-to-r from-yellow-400 to-yellow-500 h-3 rounded-full transition-all duration-1000" style="width: ${progressPercent}%"></div>
                        </div>
                        
                        <div class="flex justify-between items-center pt-4 border-t border-slate-100 text-sm">
                            <span class="font-medium text-slate-500">Total Lifetime Spend:</span>
                            <span class="font-black text-slate-800">${currency}${totalSpent.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    document.body.classList.add('overflow-hidden');
};

// ============================================================================
// 📅 FULL-SIZED WIDE CALENDAR HISTORY ENGINE (Fetched Only on Request)
// ============================================================================

let currentCalendarDate = new Date();
let currentCalendarCurrency = '₹';

window.openCalendarHistory = async function(customerId, customerName, txType) {
    const modalId = 'customer-calendar-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();
    currentCalendarCurrency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';

    const themeColor = 'indigo'; // Neutral color for unified calendar

    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[260] bg-slate-900/70 flex items-center justify-center p-4 ">
            <!-- 🚀 EXPANDED LAYOUT: w-[850px] for massive 7-digit numbers -->
            <div class="bg-white rounded-[2rem] shadow-2xl w-full max-w-[850px] h-[85vh] min-h-[600px] flex flex-col overflow-hidden border border-slate-100">
                <div class="px-6 py-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
                    <div>
                        <h3 class="text-2xl font-black text-slate-800 flex items-center gap-2">
                            <span class="bg-${themeColor}-100 text-${themeColor}-600 p-2 rounded-xl text-base">
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            </span> 
                            Monthly Ledger
                        </h3>
                        <p class="text-xs font-bold text-slate-500 mt-1 uppercase tracking-widest truncate max-w-sm">${escapeHTML(customerName)}</p>
                    </div>
                    <button onclick="document.getElementById('${modalId}').remove(); document.body.classList.remove('overflow-hidden');" class="text-slate-400 hover:text-red-500 transition-colors bg-white p-2.5 rounded-full shadow-sm border border-slate-200 hover:bg-red-50 shrink-0">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                
                <div class="p-6 flex-1 flex flex-col bg-white overflow-y-auto">
                    <div class="grid grid-cols-[50px_1fr_50px] items-center mb-5 bg-slate-50 p-2 rounded-xl border border-slate-200 shrink-0 shadow-sm">
                        <button onclick="window.changeCalendarMonth(-1, '${customerId}', '${themeColor}')" class="w-12 h-12 bg-white rounded-lg hover:bg-slate-100 border border-slate-200 shadow-sm transition-colors text-slate-600 flex items-center justify-center active:scale-95">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"></path></svg>
                        </button>
                        <h4 id="cal-month-year" class="text-xl font-black text-slate-800 uppercase tracking-widest text-center truncate">Loading...</h4>
                        <button onclick="window.changeCalendarMonth(1, '${customerId}', '${themeColor}')" class="w-12 h-12 bg-white rounded-lg hover:bg-slate-100 border border-slate-200 shadow-sm transition-colors text-slate-600 flex items-center justify-center active:scale-95">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"></path></svg>
                        </button>
                    </div>

                    <div class="grid grid-cols-7 gap-3 text-center text-sm font-black text-slate-400 mb-2 uppercase tracking-widest shrink-0">
                        <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
                    </div>
                    
                    <div id="cal-grid" class="grid grid-cols-7 grid-rows-6 gap-3 flex-1 min-h-[500px]">
                        <div class="col-span-7 row-span-6 flex flex-col items-center justify-center text-slate-400 font-bold py-20">
                            <svg class="animate-spin w-12 h-12 mb-4 text-indigo-500" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            Scanning transactions...
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    document.body.classList.add('overflow-hidden');

    currentCalendarDate = new Date();
    await window.fetchAndRenderCalendar(customerId, themeColor);
};

window.changeCalendarMonth = async function(delta, customerId, themeColor) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + delta);
    await window.fetchAndRenderCalendar(customerId, themeColor);
};

window.fetchAndRenderCalendar = async function(customerId, themeColor) {
    const grid = document.getElementById('cal-grid');
    const header = document.getElementById('cal-month-year');
    if (!grid || !header) return;

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth(); 
    
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    header.textContent = `${monthNames[month]} ${year}`;

    let calendarData = {};
    try {
        // 🚀 THE FIX: Use local SQLite lookup
        if (window.dbAPI && window.dbAPI.getTransactionsForCustomer) {
            const snap = await window.dbAPI.getTransactionsForCustomer(customerId);
            
            snap.forEach(tx => {
                const dateObj = new Date(tx.timestamp);
                
                if (dateObj.getFullYear() === year && dateObj.getMonth() === month) {
                    const dayStr = String(dateObj.getDate()).padStart(2, '0');
                    if (!calendarData[dayStr]) calendarData[dayStr] = { sale: 0, purchase: 0 };
                    
                    const type = (tx.summary?.transactionType || tx.type || '').toUpperCase();
                    const total = Math.abs(tx.summary?.total || 0);
                    
                    if (type === 'SALE') calendarData[dayStr].sale += total;
                    if (type === 'PURCHASE') calendarData[dayStr].purchase += total;
                }
            });
        }
    } catch (e) {
        console.error("Calendar fetch error:", e);
    }

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalSlots = 42; 

    const todayObj = new Date();
    const isCurrentMonth = todayObj.getMonth() === month && todayObj.getFullYear() === year;
    const todayDate = todayObj.getDate();

    let html = '';

    for (let i = 0; i < firstDayIndex; i++) {
        html += `<div class="bg-slate-50/40 rounded-xl border border-transparent h-full w-full"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dayStr = String(day).padStart(2, '0');
        const saleAmt = calendarData[dayStr]?.sale || 0;
        const purchaseAmt = calendarData[dayStr]?.purchase || 0;
        
        const isToday = isCurrentMonth && day === todayDate;
        const boxClass = isToday ? `bg-indigo-50/50 border-indigo-300 shadow-sm ring-2 ring-indigo-200` : `bg-white border-slate-200 hover:border-indigo-400 hover:shadow-md`;
        const dateClass = isToday ? `text-indigo-700` : `text-slate-500`;

        let badgesHtml = '';
        if (saleAmt > 0) {
            badgesHtml += `
            <div class="bg-emerald-100 border border-emerald-200 text-emerald-800 px-1.5 py-1 rounded-md text-xs font-black w-full flex items-center justify-between mb-1.5 shadow-sm" title="Sale: ${saleAmt.toFixed(2)}">
                <span>S:</span><span class="truncate pl-1 tracking-tight">${currentCalendarCurrency}${saleAmt.toFixed(0)}</span>
            </div>`;
        }
        if (purchaseAmt > 0) {
            badgesHtml += `
            <div class="bg-red-100 border border-red-200 text-red-800 px-1.5 py-1 rounded-md text-xs font-black w-full flex items-center justify-between shadow-sm" title="Purchase: ${purchaseAmt.toFixed(2)}">
                <span>P:</span><span class="truncate pl-1 tracking-tight">${currentCalendarCurrency}${purchaseAmt.toFixed(0)}</span>
            </div>`;
        }

        html += `
            <div class="border rounded-2xl p-2 min-h-[90px] h-full w-full flex flex-col transition-all ${boxClass}">
                <span class="text-sm font-black ${dateClass} leading-none mb-2">${day}</span>
                <div class="mt-auto w-full flex flex-col justify-end">
                    ${badgesHtml || '<div class="h-4 w-full"></div>'}
                </div>
            </div>
        `;
    }

    const filledSlots = firstDayIndex + daysInMonth;
    for (let i = filledSlots; i < totalSlots; i++) {
        html += `<div class="bg-slate-50/40 rounded-xl border border-transparent h-full w-full"></div>`;
    }

    grid.innerHTML = html;
};

window.renderCalendarGrid = function(themeColor) {
    const grid = document.getElementById('cal-grid');
    const header = document.getElementById('cal-month-year');
    if (!grid || !header) return;

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth(); // 0-11
    
    // Set Header text
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    header.textContent = `${monthNames[month]} ${year}`;

    // Calculate dates
    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // Get today's formatting for highlighting
    const todayObj = new Date();
    const isCurrentMonth = todayObj.getMonth() === month && todayObj.getFullYear() === year;
    const todayDate = todayObj.getDate();

    let html = '';

    // Empty padding slots for days before the 1st
    for (let i = 0; i < firstDayIndex; i++) {
        html += `<div class="bg-slate-50/50 rounded-xl border border-transparent min-h-[70px]"></div>`;
    }

    // Days slots
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const totalAmount = currentCalendarTxData[dateStr];
        
        const isToday = isCurrentMonth && day === todayDate;
        const boxClass = isToday ? `bg-${themeColor}-50 border-${themeColor}-200 shadow-inner ring-2 ring-${themeColor}-100` : `bg-white border-slate-200 hover:border-slate-300`;
        const dateClass = isToday ? `text-${themeColor}-700` : `text-slate-500`;

        html += `
            <div class="border rounded-xl p-2 min-h-[75px] flex flex-col justify-between transition-colors ${boxClass}">
                <span class="text-xs font-black ${dateClass}">${day}</span>
                ${totalAmount > 0 ? `
                    <div class="mt-2 text-center">
                        <span class="inline-block w-full bg-${themeColor}-100 text-${themeColor}-800 px-1 py-1 rounded text-[10px] font-black tracking-tight leading-none shadow-sm truncate">
                            ${currentCalendarCurrency}${totalAmount.toFixed(0)}
                        </span>
                    </div>
                ` : `<div class="mt-2 h-4 w-full"></div>`}
            </div>
        `;
    }

    grid.innerHTML = html;
};



// ============================================================================
// ⚡ LAZY-LOAD TODAY'S STATS FOR UI (LIVE FETCH)
// ============================================================================
async function fetchAndInjectTodayStats(customersList) {
    if (!customersList || customersList.length === 0) return;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    try {
        let txs = [];
        if (window.dbAPI && window.dbAPI.getTransactionsSince) {
            txs = await window.dbAPI.getTransactionsSince(startOfToday.toISOString());
        }
        
        const todayAggs = {};
        txs.forEach(tx => {
            if (tx.customer && tx.customer.id) {
                const cid = tx.customer.id;
                if (!todayAggs[cid]) todayAggs[cid] = { sale: 0, purchase: 0 };
                const type = (tx.summary?.transactionType || tx.type || '').toUpperCase();
                const total = Math.abs(tx.summary?.total || 0);
                if (type === 'SALE') todayAggs[cid].sale += total;
                if (type === 'PURCHASE') todayAggs[cid].purchase += total;
            }
        });

        const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';
        customersList.forEach((c) => {
            const cid = c.docId || c.id;
            const sale = todayAggs[cid]?.sale || 0;
            const purchase = todayAggs[cid]?.purchase || 0;
            
            const saleEl = document.getElementById(`today-sale-${cid}`);
            const purEl = document.getElementById(`today-purchase-${cid}`);
            
            if (saleEl) {
                const textContainer = saleEl.querySelector('div.w-full');
                if (textContainer) {
                    textContainer.innerHTML = `
                        <p class="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-0.5">Today's Sale</p>
                        <p class="text-base font-black text-emerald-900 leading-tight">${currency}${sale.toFixed(2)}</p>
                    `;
                }
            }
            if (purEl) {
                const textContainer = purEl.querySelector('div.w-full');
                if (textContainer) {
                    textContainer.innerHTML = `
                        <p class="text-[10px] font-bold text-orange-600 uppercase tracking-widest mb-0.5">Today's Purchase</p>
                        <p class="text-base font-black text-orange-900 leading-tight">${currency}${purchase.toFixed(2)}</p>
                    `;
                }
            }
        });
    } catch (e) {
        console.warn("Could not fetch live today stats", e);
    }
}
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