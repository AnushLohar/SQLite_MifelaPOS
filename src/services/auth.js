
// src/services/auth.js

import { getStoreId, getUserId, setStoreAndUserRefs } from '../store/state.js';
import { loadInventoryPage } from '../components/inventory.js';
import { getNetworkStatus } from './network.js';

export async function verifyLocalLicense() {
    try {
        const storedToken = await window.electronAPI.getToken();
        
        if (!storedToken) {
            return { valid: false, reason: 'NO_TOKEN' };
        }

        const parts = storedToken.split('.');
        if (parts.length !== 3) {
            await window.electronAPI.deleteToken();
            return { valid: false, reason: 'INVALID_FORMAT' };
        }

        const payload = JSON.parse(atob(parts[1]));
        
        // ENFORCEMENT 1: Time-based Expiration
        const now = Date.now();
        if (payload.expiresAt && now > new Date(payload.expiresAt).getTime()) {
            return { valid: false, reason: 'EXPIRED' };
        }

        // ENFORCEMENT 2: Hardware Fingerprint / IP Binding
        const hardwareFp = await window.electronAPI.getMachineId();
        if (payload.fingerprint !== hardwareFp) {
            console.error("Hardware mismatch detected. License is bound to another terminal.");
            await window.electronAPI.deleteToken();
            return { valid: false, reason: 'HARDWARE_MISMATCH' };
        }

        // ENFORCEMENT 3: Identity & Store Binding
        const sysDetailsRaw = localStorage.getItem('mifela_sys_details');
        if (sysDetailsRaw) {
            const sysDetails = JSON.parse(sysDetailsRaw);
            
            if (payload.email && payload.email.toLowerCase() !== (sysDetails.email || '').toLowerCase()) {
                console.error("Identity mismatch. License email does not match local terminal owner.");
                await window.electronAPI.deleteToken();
                return { valid: false, reason: 'IDENTITY_MISMATCH' };
            }
        }

        const localUser = {
            uid: payload.accountId || 'OFFLINE_USER',
            email: payload.email || 'local@mifela.com',
            displayName: payload.storeName || 'Admin',
            role: 'admin',
            isOfflineBound: true
        };

        localStorage.setItem('mifela_local_user', JSON.stringify(localUser));
        
        // 🚀 THE FIX: We MUST NOT set 'mifela_user_session' here automatically. 
        // Setting it here forces an auto-login and breaks the logout button.
        // The session is strictly created in app.js -> unlockSystem() when the PIN is entered.

        return { valid: true, payload };

    } catch (error) {
        console.error("Offline license verification failed:", error);
        return { valid: false, reason: error.message };
    }
}

export async function verifyLicenseState() {
    const status = await verifyLocalLicense();
    return status.valid ? 'APPROVED' : 'DENIED';
}

export async function initializeAuth() {
    const loadingScreen = document.getElementById('loading-screen') || document.querySelector('.fixed.inset-0.bg-white.z-50'); 
    
    try {
        const state = await window.electronAPI.getSecurityState();

        if (state.status === 'UNPROVISIONED') {
            const fpInput = document.getElementById('hardware-fingerprint-display');
            if (fpInput && window.electronAPI) {
                const hwId = await window.electronAPI.getMachineId();
                fpInput.value = hwId || 'UNAVAILABLE';
            }
            // Let window.checkStartupSequence handle routing.
            return;
        }

        if (state.status === 'VERIFICATION_REQUIRED') {
            if (getNetworkStatus() === 'offline') {
                document.getElementById('auth-error-msg').textContent = "MANDATORY VERIFICATION REQUIRED. Connect to the internet to continue.";
                return;
            }

            const verified = await executeSilentVerification(state.payload);
            if (!verified) {
                document.getElementById('auth-error-msg').textContent = "Verification Failed. Hardware altered or keys revoked.";
                return;
            }
        }

        // 🚀 THE FIX: DO NOT manually force the app UI to open here!
        // If the hardware license is ACTIVE, we simply exit this function.
        // Next, app.js automatically calls checkStartupSequence(), which checks if the user is 
        // actually logged in, and correctly renders the lock screen if they are not.

    } catch (error) {
        console.error("Auth Init Error:", error);
        const errorMsgEl = document.getElementById('auth-error-msg');
        if (errorMsgEl) {
            errorMsgEl.textContent = "System Security Error: " + error.message;
        }
    } finally {
        if (loadingScreen) loadingScreen.classList.add('hidden');
    }
}

async function executeSilentVerification(localPayload) {
    try {
        // Re-provision through the live cloud-signed license path (verifyNodeLicense),
        // which enforces payment/activation status and extends the 90-day deadline.
        const result = await window.electronAPI.provisionSecurity({
            email: localPayload.email,
            storeName: ''
        });

        if (!result.success) {
            console.error("Silent verification rejected:", result.error);
            return false;
        }

        return true;
    } catch (e) {
        console.error("Silent Sync Failed:", e);
        return false;
    }
}

export async function activateSoftware(inputString) {
    if (!inputString || typeof inputString !== 'string') {
        throw new Error("Invalid license string.");
    }

    const finalJwt = inputString.trim();

    // Verify payment/activation status via the live cloud function. Only
    // payment-verified, ACTIVE nodes can proceed to license generation.
    const fingerprint = await window.electronAPI.getMachineId();
    const response = await fetch('https://asia-south1-mifela-pos-sqlite.cloudfunctions.net/verifyNodeActivation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            token: finalJwt,
            hardwareId: fingerprint,
            email: ''
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Gateway rejected the token. Ensure payment is complete.");
    }

    const data = await response.json();
    if (!data.data || (data.data.status !== 'PAID' && data.data.status !== 'ACTIVE')) {
        throw new Error("Payment is pending. Please complete checkout.");
    }

    // Provision the local license (cloud-signed, enforces payment status)
    const provisionRes = await window.electronAPI.provisionSecurity({
        email: data.data.email,
        storeName: ''
    });
    if (!provisionRes.success) {
        throw new Error(provisionRes.error || "License provisioning failed.");
    }

    const status = await verifyLocalLicense();
    if (!status.valid) {
        await window.electronAPI.deleteToken();
        throw new Error(`Activation failed: ${status.reason}`);
    }

    return true;
}

export async function logoutUser() {
    // 1. Wipe the user credentials from memory
    localStorage.removeItem('mifela_local_user');
    localStorage.removeItem('mifela_user_session');
    localStorage.removeItem('mifela_active_store');
    localStorage.removeItem('mifela_active_user');
    
    // 2. Clear quarantine so the reload isn't blocked by the failed audit screen
    localStorage.removeItem('mifela_security_quarantine'); 

    // 3. Immediately switch the UI visually to the login screen
    if (typeof window.showAuthView === 'function') {
        window.showAuthView('login');
    }

    // 4. Force a clean state refresh
    setTimeout(() => location.reload(), 500);
}
