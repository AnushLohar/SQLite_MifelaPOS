// src/store/listeners.js


import {
    userSettingsRef,
    setDashboardWidgets,
    setUserSettingsListener,
    setConvenienceFee,
    setCurrency,
    setPlan,
    userRole,
    userAssignedLocationId,
    getStoreId,
    setAvailableLocations,
    registerListener,
    appId as staticAppId,
    getProductsRef
} from './state.js';

import { renderDynamicDashboard } from './dashboard.js';
import { escapeHTML } from '../utils/security.js';
import { updateNavigationUIForPlan } from '../components/navigation.js';
import { populateSettingsUI } from '../components/settings.js';

const APP_VERSION = '1.0.0';
let _legacyStores = [];
let _collectionStores = [];

// --- Prevent Multiple Listeners (DOUBLING FIX) ---
const activeListeners = {
    settings: false,
    stores: false,
    inventory: false,
    global: false
};

/**
 * Main entry point for starting all real-time background synchronization.
 */
export function startAllListeners() {
    console.log("🔌 Initializing Real-time Data Sync...");
    setupUserSettingsListener();
    setupStoresListener();
    setupInventoryStatsListener();
    setupGlobalListeners();
}

/**
 * Dashboard Inventory Stats Engine
 * This listener fetches all products and calculates aggregate metrics 
 * (Low Stock, Expired, Value at Risk) based on role/location.
 */
function setupInventoryStatsListener() {
    if (activeListeners.inventory) return; // Prevent double registration

    const productsRef = getProductsRef();
    if (!productsRef) return;

    activeListeners.inventory = true;

    const unsub = onSnapshot(productsRef, (snapshot) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Dashboard Metrics
        let lowStockCount = 0;
        let expiredCount = 0;
        let valueAtRisk = 0;
        let totalInventoryValue = 0;

        // Collect actual item lists for Dashboard display
        const lowStockList = [];
        const expiredList = [];

        const role = userRole || 'manager';
        const assignedLoc = userAssignedLocationId || 'main';

        snapshot.forEach(docSnap => {
            const data = docSnap.data();

            // 1. Role-Based Access Filter
            if (role !== 'admin' && role !== 'accountant') {
                if ((data.locationId || 'main') !== assignedLoc) return;
            }

            // 2. Data Standardizing
            const stock = Number(data.stockLevel || 0);
            const threshold = Number(data.lowStockThreshold || 0);
            const cost = Number(data.cost || 0);
            const expiryStr = data.expirationDate || null;
            const productName = data.name || 'Unknown Product';

            // 3. Expiry Check
            let isExpired = false;
            if (expiryStr) {
                const expiryDate = new Date(expiryStr);
                isExpired = expiryDate < today;
            }

            // 4. Status Flags
            const isLow = stock <= threshold && stock > 0;
            const isOut = stock <= 0;
            const itemValue = stock * cost;

            // 5. Aggregation & List Building
            if (isLow || isOut) {
                lowStockCount++;
                lowStockList.push({
                    id: docSnap.id,
                    name: productName,
                    stock: stock,
                    status: isOut ? 'Out' : 'Low'
                });
            }

            if (isExpired && stock > 0) {
                expiredCount++;
                expiredList.push({
                    id: docSnap.id,
                    name: productName,
                    expiry: expiryStr
                });
            }

            // Value at Risk = Value of stock that is either expired or at reorder point
            if ((isLow || isExpired) && stock > 0) {
                valueAtRisk += itemValue;
            }

            totalInventoryValue += itemValue;
        });

        // Broadcast stats for the Dashboard UI
        const stats = {
            lowStockCount,
            expiredCount,
            valueAtRisk,
            totalInventoryValue,
            lowStockList,
            expiredList,
            timestamp: Date.now()
        };

        // Attach to global window for synchronous widget access
        window.__inventoryStats = stats;

        // Trigger an event so components can react
        window.dispatchEvent(new CustomEvent('inventory-stats-updated', { detail: stats }));

        // FIX: Defer execution and use dynamic import to completely eliminate circular dependencies
        setTimeout(async () => {
            try {
                const dashboard = document.getElementById('dashboard');
                if (dashboard && !dashboard.classList.contains('hidden')) {
                    renderDynamicDashboard(false); // Don't force recalculations, just re-render
                }
            } catch (err) {
                console.error("Dashboard dynamic import failed:", err);
            }
        }, 0);

        console.log(`📊 Stats Sync: Low[${lowStockCount}] Exp[${expiredCount}] Risk[${valueAtRisk.toFixed(2)}]`);
    }, (error) => {
        activeListeners.inventory = false;
        console.error("Inventory Stats Sync Error:", error);
    });

    registerListener(unsub);
}

// --- Store Location Management ---

function updateGlobalStoreState() {
    const storeMap = new Map();
    _legacyStores.forEach(s => {
        const id = s.id || s.storeId;
        if (!id) return;
        storeMap.set(id, { id, storeName: cleanStoreName(s.name || s.storeName || id), type: 'legacy', ...s });
    });
    _collectionStores.forEach(s => {
        const id = s.id;
        const existing = storeMap.get(id) || {};
        let rawName = s.storeName || s.name || existing.storeName || id;
        let displayName = cleanStoreName(rawName);
        storeMap.set(id, { ...existing, ...s, storeName: displayName, name: displayName, type: 'document' });
    });
    const finalStores = Array.from(storeMap.values()).sort((a, b) => {
        const nameA = (a.storeName || '').toLowerCase();
        const nameB = (b.storeName || '').toLowerCase();
        if (nameA.includes('main')) return -1;
        if (nameB.includes('main')) return 1;
        return nameA.localeCompare(nameB);
    });
    if (finalStores.length > 0) setAvailableLocations(finalStores);
    else setAvailableLocations([{ id: 'main', name: 'Main Store' }]);
}

function cleanStoreName(raw) {
    if (!raw) return 'Unnamed Store';
    return raw.toString().replace(/_/g, ' ').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function setupStoresListener() {
    if (activeListeners.stores) return; // Prevent double registration
    const currentAppId = (typeof window !== 'undefined' && window.__app_id) ? window.__app_id : staticAppId;
    if (!currentAppId || !auth.currentUser) return;

    activeListeners.stores = true;

    if (userRole === 'admin') {
        const storesRef = collection(db, `artifacts/${currentAppId}/stores`);
        const q = query(storesRef, where("ownerId", "==", auth.currentUser.uid));
        const unsub = onSnapshot(q, (snapshot) => {
            _collectionStores = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // CRITICAL FIX: Fallback if the root store document is missing for older accounts
            if (_collectionStores.length === 0) {
                const fallbackId = getStoreId();
                if (fallbackId) {
                    _collectionStores = [{ id: fallbackId, storeName: 'Main Store', ownerId: auth.currentUser.uid }];
                }
            }

            updateGlobalStoreState();
        });
        registerListener(unsub);
    } else {
        const targetId = userAssignedLocationId || getStoreId();
        if (targetId) {
            const docRef = doc(db, `artifacts/${currentAppId}/stores/${targetId}`);
            const unsub = onSnapshot(docRef, (docSnap) => {
                _collectionStores = docSnap.exists() ? [{ id: docSnap.id, ...docSnap.data() }] : [];

                // CRITICAL FIX: Fallback for staff if root store document is missing
                if (_collectionStores.length === 0) {
                    _collectionStores = [{ id: targetId, storeName: 'Assigned Store' }];
                }

                updateGlobalStoreState();
            });
            registerListener(unsub);
        }
    }
}

// --- Settings & Profile Sync ---

function setupUserSettingsListener() {
    if (activeListeners.settings) return; // Prevent double registration
    if (!userSettingsRef) return;

    activeListeners.settings = true;

    const unsub = onSnapshot(userSettingsRef, (docSnap) => {
        if (docSnap.exists()) {
            const settings = docSnap.data();
            if (settings.status === 'suspended') {
                if (!document.getElementById('suspended-screen')) {
                    document.body.insertAdjacentHTML('beforeend', `<div id="suspended-screen" class="fixed inset-0 bg-red-900/95 z-[999] flex items-center justify-center text-white text-3xl font-bold">Account Suspended</div>`);
                }
                return;
            } else { document.getElementById('suspended-screen')?.remove(); }

            setDashboardWidgets(settings.dashboardWidgets || []);
            setConvenienceFee(settings.convenienceFee);
            setCurrency(settings.currency || 'INR');
            setPlan(settings.plan);
            _legacyStores = Array.isArray(settings.locations) ? settings.locations : [];

            updateGlobalStoreState();

            // FIX: Defeat ReferenceError and Circular Dependencies by dynamically importing UI modules
            setTimeout(async () => {
                try {
                    updateNavigationUIForPlan();

                    populateSettingsUI(settings, auth.currentUser);

                    const dash = document.getElementById('dashboard');
                    if (dash && !dash.classList.contains('hidden')) {

                        renderDynamicDashboard(true);
                    }
                } catch (err) {
                    console.error("UI Module dynamic import failed:", err);
                }
            }, 0);
        }
    }, (error) => console.warn("Settings Sync Warning:", error.code));

    setUserSettingsListener(unsub);
    registerListener(unsub);
}

// --- System Global Listeners ---

function setupGlobalListeners() {
    if (activeListeners.global) return; // Prevent double registration
    const currentAppId = (typeof window !== 'undefined' && window.__app_id) ? window.__app_id : staticAppId;
    if (!currentAppId) return;

    activeListeners.global = true;

    try {
        const marketingRef = doc(db, `artifacts/${currentAppId}/public_data/marketing`);
        registerListener(onSnapshot(marketingRef, (snap) => {
            if (snap.exists() && snap.data().active) {
                const last = localStorage.getItem('mifela_last_ad');
                if (last !== snap.data().updatedAt) {
                    const html = `<div id="marketing-modal" class="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4"><div class="bg-white rounded-xl p-6 relative max-w-sm"><h3>${escapeHTML(snap.data().title)}</h3><p class="text-sm text-gray-500 my-2">${escapeHTML(snap.data().body)}</p><button onclick="this.closest('#marketing-modal').remove()" class="w-full bg-SLATE-600 text-white py-2 rounded-lg font-bold">Close</button></div></div>`;
                    document.body.insertAdjacentHTML('beforeend', html);
                }
            }
        }));
    } catch (e) { }
}