// src/utils/scanner.js

import { DOM, showModal, showToast } from './dom.js'; 
import { findAndAddToCart } from '../components/pos.js';
import { isMobile } from './platform.js';

let barcodeString = '';
let lastKeyTime = Date.now();

// --- 1. GLOBAL KEY LISTENER (Desktop USB Scanner) ---
export function handleGlobalScan(e) {
    // Safety Gate
    if (!e || typeof e.key !== 'string') return;

    // Ignore modifier keys and mobile devices
    if (isMobile() || (e.key.length > 1 && e.key !== 'Enter')) return;

    const currentTime = Date.now();
    const timeDiff = currentTime - lastKeyTime;
    lastKeyTime = currentTime;

    // 1. HARDWARE SCANNER DETECTION
    if (timeDiff > 30) {
        barcodeString = '';
    }

    // 2. ACCUMULATE CHARACTERS
    if (e.key !== 'Enter') {
        barcodeString += e.key;
    }

    // 3. END OF SCAN
    if (e.key === 'Enter' && barcodeString.length >= 4) {
        
        // --- PLAN FEATURE CHECK ---
            const allowed = ['silver', 'gold', 'platinum', 'standard', 'premium'].includes(plan.toLowerCase());
        
        if (!allowed) {
            showModal('Upgrade Required', 'Barcode scanning is a premium feature.', 'info');
            barcodeString = '';
            e.preventDefault();
            return;
        }

        e.preventDefault(); 
        e.stopPropagation();

        const finalBarcode = barcodeString;
        barcodeString = ''; 

        // --- 🚀 MAGIC CLEANUP (THE ERASER) ---
        const activeEl = document.activeElement;
        const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

        if (isInputFocused) {
            const currentVal = activeEl.value;
            if (currentVal.endsWith(finalBarcode)) {
                activeEl.value = currentVal.slice(0, -finalBarcode.length);
            } else if (currentVal === finalBarcode) {
                activeEl.value = '';
            }
        }

        // --- ROUTING ENGINE ---

        // 🚀 SCENARIO A: Active Focus Override (Manual Bulk Entry & Grids)
        // If the user has clicked into a specific cell, put the barcode exactly there 
        // and ignore all other background screens!
        if (isInputFocused) {
            // Allow the POS search bar to fall through to Scenario B
            if (activeEl.id !== 'manual-pos-input') {
                activeEl.value = finalBarcode;
                // Dispatch events so your spreadsheet/grid knows the data changed
                activeEl.dispatchEvent(new Event('input', { bubbles: true }));
                activeEl.dispatchEvent(new Event('change', { bubbles: true }));
                showToast("Scanned", "Barcode applied.", "success");
                return; // STOP ROUTING
            }
        }
        
        // SCENARIO B: Billing / POS Screen
        const posView = document.getElementById('pos');
        if (posView && !posView.classList.contains('hidden')) {
            if (typeof findAndAddToCart === 'function') {
                findAndAddToCart(finalBarcode, 1);
                showToast("Scanned", `Item added to cart.`, "success");
            }
            return;
        }

        // SCENARIO C: Inventory Restock / Add Screen
        const invView = document.getElementById('inventory');
        // 🚀 ANTI-HIJACK GUARD: Ensure no modals are currently floating over the screen
        const anyModalOpen = document.querySelector('[id*="modal"]:not(.hidden), .fixed.inset-0:not(.hidden)');

        if (invView && !invView.classList.contains('hidden') && !anyModalOpen) {
            const invBarcodeField = document.getElementById('inv-form-barcode') || document.getElementById('barcode');
            if (invBarcodeField) {
                invBarcodeField.value = finalBarcode;
                invBarcodeField.dispatchEvent(new Event('change', { bubbles: true }));
                showToast("Scanned", "Barcode captured in Inventory", "success");
            }
            return;
        }

        // SCENARIO D: Trade & Customers (Global Dealer Lookup)
        const customersView = document.getElementById('customers');
        if (customersView && !customersView.classList.contains('hidden')) {
            const dealerPhoneInput = document.getElementById('cust-form-phone') || document.querySelector('input[name="phone"]');
            const dealerIdInput = document.getElementById('cust-form-id') || document.querySelector('input[name="id"]');
            
            const target = dealerPhoneInput || dealerIdInput;
            if (target) {
                target.value = finalBarcode;
                target.dispatchEvent(new Event('input', { bubbles: true }));
                showToast("Scanned", "Dealer data fetching...", "info");
            }
            return;
        }
        
        // FALLBACK: Clipboard
        showToast("Scanner Ready", `Code ${finalBarcode} copied.`, "info");
        if (navigator.clipboard) navigator.clipboard.writeText(finalBarcode).catch(()=>{});
    }
}

// --- 2. MOBILE CAMERA SCANNER (Unchanged) ---
let html5QrcodeScanner = null;

export function initMobileScanner() {
    const scanBtn = document.getElementById('mobile-scan-btn');
    const modal = DOM.modals?.scanner?.self || document.getElementById('scanner-modal');
    const closeBtn = DOM.modals?.scanner?.close || document.getElementById('close-scanner-btn');

    if (!scanBtn || !modal || !closeBtn) return;

    if (isMobile()) {
        scanBtn.style.display = 'flex';
    }

    const newScanBtn = scanBtn.cloneNode(true);
    scanBtn.parentNode.replaceChild(newScanBtn, scanBtn);
    
    newScanBtn.addEventListener('click', () => {
            const allowed = ['silver', 'gold', 'platinum', 'standard', 'premium'].includes(plan.toLowerCase());

        if (!allowed) {
            showModal('Upgrade Required', 'Mobile camera scanning is a premium feature. Please upgrade your plan to use the scanner.', 'info');
            return;
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        startCamera();
    });

    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
    newCloseBtn.addEventListener('click', stopCamera);
}

function startCamera() {
    if (html5QrcodeScanner) return;
    if (!window.Html5Qrcode) {
        showModal("Error", "Scanner library not loaded. Check internet connection.", "error");
        return;
    }

    const html5QrCode = new Html5Qrcode("reader");
    html5QrcodeScanner = html5QrCode;
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    
    html5QrCode.start(
        { facingMode: "environment" }, 
        config,
        (decodedText) => {
            stopCamera();
            
            // Route Mobile Scans using the same logic!
            const posView = document.getElementById('pos');
            if (posView && !posView.classList.contains('hidden')) {
                if (typeof findAndAddToCart === 'function') findAndAddToCart(decodedText, 1);
            } else {
                const invBarcodeField = document.getElementById('inv-form-barcode') || document.getElementById('barcode');
                if (invBarcodeField) {
                    invBarcodeField.value = decodedText;
                    invBarcodeField.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            if (navigator.vibrate) navigator.vibrate(100); 
        },
        (errorMessage) => {}
    ).catch(err => {
        showModal("Error", "Camera access denied. Please allow permissions in your browser.", "error");
        stopCamera();
    });
}

function stopCamera() {
    const modal = DOM.modals?.scanner?.self || document.getElementById('scanner-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
            html5QrcodeScanner.clear();
            html5QrcodeScanner = null;
        }).catch(err => console.warn("Failed to stop scanner cleanly.", err));
    }
}