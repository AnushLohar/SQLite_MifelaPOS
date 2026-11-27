// src/utils/gstinAutoFill.js
// Universal GSTIN Auto-Fill Utility
// Attaches to any GSTIN input field and fetches/auto-fills related details

/**
 * Standard field mappings for different form contexts
 * Each context defines which GSTIN input field maps to which target fields
 */
export const GSTIN_FIELD_MAPS = {
    // Customer/Partner form (customers.js)
    customer: {
        gstinField: 'cust-form-gstin',
        panField: 'cust-form-pan',
        targetFields: {
            name: 'cust-form-name',
            phone: 'cust-form-phone',
            email: 'cust-form-email',
            address: 'cust-form-address',
            state: 'cust-form-state',
        }
    },
    // Bulk Upload Supplier form (bulkUpload.js)
    bulkSupplier: {
        gstinField: 'bulk-supplier-gstin',
        panField: 'bulk-supplier-pan',
        targetFields: {
            name: 'bulk-supplier-name',
            phone: 'bulk-supplier-phone',
            address: 'bulk-supplier-address',
            state: 'bulk-supplier-state',
        }
    },
    // Inventory/Production dealer form (inventory.js)
    inventoryDealer: {
        gstinField: 'prod-gstin',
        panField: 'prod-dealer-pan',
        targetFields: {
            name: 'prod-dealer',
            phone: 'prod-dealer-phone',
            address: 'prod-dealer-address',
            state: 'prod-dealer-state',
        }
    },
    // Store settings (settings.js)
    storeSettings: {
        gstinField: 'setting-store-tax-id',
        panField: 'setting-store-pan',
        targetFields: {
            name: 'setting-store-name',
            phone: 'setting-store-phone',
            email: 'setting-store-email',
            address: 'setting-store-address',
            state: 'setting-store-state',
        }
    },
    // Setup modal (app.js)
    setupModal: {
        gstinField: 'setup-gstin',
        panField: 'setup-store-pan',
        targetFields: {
            name: 'setup-store-name',
            phone: 'setup-store-phone',
            email: 'setup-store-email',
            address: 'setup-store-address',
            state: 'setup-store-state',
        }
    }
};

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Validate GSTIN format using official regex.
 */
export function validateGstinFormat(gstin) {
    if (!gstin || typeof gstin !== 'string') return false;
    return GSTIN_REGEX.test(gstin.trim().toUpperCase());
}

/**
 * Extract PAN from GSTIN (characters 3-12, 0-indexed: 2-11)
 */
export function extractPanFromGstin(gstin) {
    if (!gstin || gstin.length < 12) return '';
    return gstin.substring(2, 12).toUpperCase();
}

/**
 * Extract state code from GSTIN (first 2 characters)
 */
export function extractStateCodeFromGstin(gstin) {
    if (!gstin || gstin.length < 2) return '';
    return gstin.substring(0, 2).toUpperCase();
}

/**
 * GST State code to name mapping
 */
export const GST_STATE_CODES = {
    '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
    '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
    '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
    '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
    '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
    '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli', '27': 'Maharashtra', '29': 'Karnataka',
    '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
    '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh'
};

/**
 * Get state name from state code
 */
export function getStateNameFromCode(code) {
    return GST_STATE_CODES[code] || '';
}

/**
 * Apply visual feedback to an element (flash animation)
 */
function flashElement(el, className = 'bg-emerald-50') {
    if (!el) return;
    el.classList.add(className, 'transition-colors');
    setTimeout(() => el.classList.remove(className), 800);
}

/**
 * Show invalid GSTIN format feedback (red ring, fades out)
 */
function markGstinInvalid(el) {
    if (!el) return;
    const invalidClass = 'ring-2 ring-red-500 ring-offset-1';
    const shakeClass = 'animate-shake';
    el.classList.add(invalidClass, shakeClass, 'transition-all');
    setTimeout(() => {
        el.classList.remove(invalidClass);
    }, 3000);
}

// Expose markGstinInvalid for testing
export { markGstinInvalid };

/**
 * Set value on element if empty, with optional flash
 */
function setIfEmpty(el, value, flash = true) {
    if (!el || !value) return false;
    if (el.value && el.value.trim()) return false; // Don't overwrite user input
    el.value = value;
    if (flash) flashElement(el);
    // Trigger input event for any auto-save listeners
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

/**
 * Normalize phone number to +91XXXXXXXXXX format
 */
function normalizePhone(phone) {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return '+91' + digits;
    if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
    if (digits.length === 11 && digits.startsWith('0')) return '+91' + digits.substring(1);
    return phone;
}

/**
 * Fill form fields from fetched entity data
 */
export function fillFormFromEntity(entity, fieldMap, options = {}) {
    const { targetFields, panField, gstinField } = fieldMap;
    const { flash = true, overwrite = false } = options;

    if (!entity) return false;

    let filled = false;

    // Fill PAN from GSTIN if available
    if (panField) {
        const panInput = document.getElementById(panField);
        const entityPan = entity.pan || extractPanFromGstin(entity.gstin || entity.taxId);
        if (setIfEmpty(panInput, entityPan, flash)) filled = true;
    }

    // Fill state from GSTIN
    const stateInput = document.getElementById(targetFields.state);
    const gstinVal = entity.gstin || entity.taxId;
    if (stateInput && gstinVal && gstinVal.length >= 2) {
        const stateCode = extractStateCodeFromGstin(gstinVal);
        const stateName = getStateNameFromCode(stateCode);

        if (stateName) {
            if (stateInput.tagName === 'SELECT') {
                // Match select option
                const options = Array.from(stateInput.options);
                const match = options.find(o =>
                    o.value.toLowerCase().includes(stateCode.toLowerCase()) ||
                    o.textContent.toLowerCase().includes(stateName.toLowerCase())
                );
                if (match) {
                    stateInput.value = match.value;
                    stateInput.dispatchEvent(new Event('change', { bubbles: true }));
                    if (flash) flashElement(stateInput);
                    filled = true;
                }
            } else if (setIfEmpty(stateInput, `${stateCode}-${stateName}`, flash)) {
                filled = true;
            }
        }
    }

    // Fill other fields
    const fieldMappings = [
        { key: 'name', sources: ['name', 'storeName', 'tradeName', 'legalName'] },
        { key: 'phone', sources: ['phone', 'contact', 'mobile'], transform: normalizePhone },
        { key: 'email', sources: ['email', 'emailId'] },
        { key: 'address', sources: ['address', 'fullAddress', 'billingAddress'] },
    ];

    for (const mapping of fieldMappings) {
        const targetId = targetFields[mapping.key];
        if (!targetId) continue;

        const targetEl = document.getElementById(targetId);
        if (!targetEl) continue;

        // Find first available value from sources
        let value = '';
        for (const sourceKey of mapping.sources) {
            if (entity[sourceKey]) {
                value = entity[sourceKey];
                break;
            }
        }

        if (value && mapping.transform) {
            value = mapping.transform(value);
        }

        if (value && setIfEmpty(targetEl, value, flash)) {
            filled = true;
        }
    }

    return filled;
}

/**
 * Debounce function
 */
function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

/**
 * Main function to attach GSTIN auto-fill to a field
 * @param {Object} fieldMap - Configuration from GSTIN_FIELD_MAPS or custom
 * @param {Object} options - Additional options
 */
export function attachGstinAutoFill(fieldMap, options = {}) {
    const {
        gstinField,
        panField,
        targetFields,
        debounceMs = 300,
        onSuccess,
        onError,
        validateGstin = (v) => v.length === 15
    } = fieldMap;

    const gstinInput = document.getElementById(gstinField);
    if (!gstinInput) {
        console.warn(`GSTIN AutoFill: Element #${gstinField} not found`);
        return null;
    }

    // Prevent duplicate attachment
    if (gstinInput.dataset.gstinBound === 'true') {
        return gstinInput;
    }
    gstinInput.dataset.gstinBound = 'true';

        // Auto-extract PAN on input
    gstinInput.addEventListener('input', (e) => {
        // Preserve cursor position during normalization
        const start = e.target.selectionStart;
        const end = e.target.selectionEnd;
        let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (val.length > 15) val = val.substring(0, 15);
        if (e.target.value !== val) {
            e.target.value = val;
            // Restore cursor position (approximately: preserve offset from start when trimming)
            const offset = Math.max(0, Math.min(start, val.length));
            e.target.setSelectionRange(offset, offset);
        }

        // Auto-fill PAN when GSTIN has 12+ chars
        if (val.length >= 12 && panField) {
            const panInput = document.getElementById(panField);
            const pan = extractPanFromGstin(val);
            if (panInput && !panInput.value) {
                panInput.value = pan;
                flashElement(panInput);
                panInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    });

    // Debounced lookup on complete GSTIN
    const debouncedLookup = debounce(async (gstin) => {
        if (!validateGstinFormat(gstin)) {
            markGstinInvalid(gstinInput);
            return;
        }

        gstinInput.classList.add('animate-pulse');

        try {
            // Try local database first
            let entity = null;
            if (window.dbAPI && typeof window.dbAPI.getEntityByGSTIN === 'function') {
                entity = await window.dbAPI.getEntityByGSTIN(gstin);
            }

            if (entity) {
                const filled = fillFormFromEntity(entity, fieldMap);
                if (filled && typeof showToast === 'function') {
                    showToast('Auto-filled', `Details loaded for ${entity.name || entity.storeName || 'partner'}`, 'success');
                }
                if (onSuccess) onSuccess(entity);
            } else if (typeof showToast === 'function') {
                showToast('Not Found', 'No matching record in local database', 'info');
            }
        } catch (err) {
            console.warn('GSTIN AutoFill lookup failed:', err);
            if (onError) onError(err);
        } finally {
            gstinInput.classList.remove('animate-pulse');
        }
    }, debounceMs);

    // Attach the debounced lookup
    gstinInput.addEventListener('input', (e) => {
        const val = e.target.value.toUpperCase().trim();
        if (val.length === 15) {
            debouncedLookup(val);
        }
    });

    // Also trigger on blur if complete
    gstinInput.addEventListener('blur', (e) => {
        const val = e.target.value.toUpperCase().trim();
        if (val.length === 15) {
            debouncedLookup(val);
        }
    });

    return gstinInput;
}

/**
 * Attach auto-fill to multiple field maps at once
 */
export function attachGstinAutoFillAll(fieldMaps, options = {}) {
    return fieldMaps.map(map => attachGstinAutoFill(map, options)).filter(Boolean);
}

/**
 * Initialize all known GSTIN fields in the app
 * Call this after DOM is ready
 */
export function initAllGstinAutoFill() {
    const results = [];

    // Attach to all known contexts
    for (const [contextName, fieldMap] of Object.entries(GSTIN_FIELD_MAPS)) {
        const gstinInput = document.getElementById(fieldMap.gstinField);
        if (gstinInput) {
            console.log(`[GSTIN AutoFill] Attaching to ${contextName} (#${fieldMap.gstinField})`);
            const result = attachGstinAutoFill(fieldMap);
            if (result) results.push({ context: contextName, element: result });
        }
    }

    return results;
}

export default {
    GSTIN_FIELD_MAPS,
    extractPanFromGstin,
    extractStateCodeFromGstin,
    getStateNameFromCode,
    fillFormFromEntity,
    attachGstinAutoFill,
    attachGstinAutoFillAll,
    initAllGstinAutoFill,
    markGstinInvalid
};