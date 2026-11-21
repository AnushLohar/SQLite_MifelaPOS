// --- App Constants ---
export const appId = typeof window !== 'undefined' && window.__app_id
    ? window.__app_id
    : 'electron-mifela-inventory';

// --- Global State Variables (Private) ---
let _storeId = null;
let _userId = null;
let _userRole = null;
let _currentUserPlan = null; // Set from session; falls back to null (uninitialized)

// --- Multi-Location State ---
let _currentLocationId = 'main';
let _userAssignedLocationId = 'main';
let _availableLocations = [{ id: 'main', name: 'Main Store' }];



// --- UI/App State ---
let _dashboardWidgets = [];
let _currentCart = [];
let _currentProductCount = 0;
let _editingProductId = null;
let _editingCustomerId = null;
let _salesChartInstance = null;

// --- Settings / Defaults ---
let _convenienceFee = 0;
let _currencyCode = 'INR';
let _currencySymbol = '₹';
export const AppState = {
    // 1. Emit an event across the entire browser window
    notify: (eventName, payload = null) => {
        const event = new CustomEvent(`mifela:${eventName}`, { detail: payload });
        document.dispatchEvent(event);
    },
    // 2. Listen for an event
    subscribe: (eventName, callback) => {
        document.addEventListener(`mifela:${eventName}`, (e) => callback(e.detail));
    }
};
export const EXPIRATION_WARNING_DAYS = 30;

export const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥' };

// --- 🚀 THE FIX: Legacy Plan Function Mocks (prevents import crashes) ---
export const PLAN_LIMITS = {};
export const PLAN_PRICING = {};
export const getLoyaltyRatio = async () => 1;
export const hasFeatureAccess = () => true;
export const checkQuota = () => ({ allowed: true, limit: Infinity, remaining: Infinity });
export const setPlan = () => { };
export const normalizePlan = () => 'unlocked';
export const safePlan = () => 'unlocked';

// --- LISTENER REGISTRY ---
const activeListeners = [];

// --- LEGACY COMPATIBILITY EXPORTS ---
export let storeId = null;
export let userId = null;
export let userRole = null;
export let currentUserPlan = 'unlocked';
export let currentLocationId = 'main';
export let userAssignedLocationId = 'main';
export let availableLocations = [{ id: 'main', name: 'Main Store' }];
export let CURRENT_CURRENCY_CODE = 'INR';
export let CURRENT_CURRENCY_SYMBOL = '₹';
export let convenienceFee = 0;
export let dashboardWidgets = [];
export let currentCart = [];
export let currentProductCount = 0;

export let editingProductId = null;
export let editingCustomerId = null;
export let salesChartInstance = null;

// Mock Firebase Refs
export let productsRef = true;
export let transactionsRef = true;
export let customersRef = true;
export let staffRef = true;
export let userSettingsRef = true;
export let userDocRef = true;
export const getStoreId = () => storeId || localStorage.getItem('mifela_active_store') || 'DEFAULT_STORE';
export const getUserId = () => userId || localStorage.getItem('mifela_active_user') || 'admin_sys';
export const getUserRole = () => {
    if (userRole) return userRole;
    try {
        const session = JSON.parse(localStorage.getItem('mifela_user_session') || '{}');
        return session.role || 'staff'; // Default to restricted role
    } catch {
        return 'staff';
    }
};
export const getCurrentUserPlan = () => {
    if (currentUserPlan !== 'unlocked') return currentUserPlan;
    try {
        const session = JSON.parse(localStorage.getItem('mifela_user_session') || '{}');
        return session.plan || 'trial';
    } catch {
        return 'trial';
    }
};
export const getCurrentLocationId = () => currentLocationId || 'main';
export const getUserAssignedLocationId = () => userAssignedLocationId || 'main';
export const getAvailableLocations = () => [{ id: 'main', name: 'Main Store' }];

export const getProductsRef = () => true;
export const getTransactionsRef = () => true;
export const getCustomersRef = () => true;
export const getStaffRef = () => true;
export const getUserSettingsRef = () => true;
export const getUserDocRef = () => true;

export const getDashboardWidgets = () => dashboardWidgets;
export const getCurrentCart = () => [...currentCart];

export async function getCurrentProductCount() {
    if (window.dbAPI && window.dbAPI.getProducts) {
        const prods = await window.dbAPI.getProducts();
        return prods.length;
    }
    return 0;
}

export const getEditingProductId = () => editingProductId;
export const getEditingCustomerId = () => editingCustomerId;
export const getSalesChartInstance = () => salesChartInstance;

export const getConvenienceFee = () => convenienceFee;
export const getCurrencyCode = () => CURRENT_CURRENCY_CODE;
export const getCurrencySymbol = () => CURRENT_CURRENCY_SYMBOL;


// --- State Setters & Logic ---

export function registerListener(unsub) {
    if (typeof unsub === 'function') activeListeners.push(unsub);
}

export function setStoreAndUserRefs(uid, sid, role, assignedLoc = 'main') {
    // Map state to offline bypasses and sync to localStorage
    _userId = uid || 'admin_sys';
    _storeId = sid || 'DEFAULT_STORE';
    _userRole = role || 'staff';
    _userAssignedLocationId = assignedLoc;
    _currentLocationId = assignedLoc;

    userId = _userId;
    storeId = _storeId;
    userRole = _userRole;
    userAssignedLocationId = _userAssignedLocationId;
    currentLocationId = _currentLocationId;

    localStorage.setItem('mifela_active_user', userId);
    localStorage.setItem('mifela_active_store', storeId);

    console.log(`✅ Offline State Initialized: Role=${_userRole}, Location=${assignedLoc}`);
}

export function getUserProfilePath(uid) {
    return `userProfiles/${uid}`;
}

export function clearUserSessionState() {
    activeListeners.forEach(unsub => {
        try { unsub(); } catch (e) { console.error(e); }
    });
    activeListeners.length = 0;

    // Reset to bypass defaults instead of null
    _storeId = 'DEFAULT_STORE';
    _userId = 'admin_sys';
    _userRole = 'staff';
    _currentLocationId = 'main';
    _currentCart = [];
    _dashboardWidgets = [];
    _salesChartInstance = null;

    cachedProducts = null;
    isFetchingProducts = false;
    productFetchPromise = null;

    storeId = 'DEFAULT_STORE';
    userId = 'admin_sys';
    userRole = 'staff';
    currentLocationId = 'main';

    currentCart = [];
    dashboardWidgets = [];
    editingProductId = null;
    editingCustomerId = null;
    salesChartInstance = null;

    setConvenienceFee(0);
    setCurrency('INR');

    if (typeof window.userSettingsListenerUnsubscribe === 'function') {
        window.userSettingsListenerUnsubscribe();
        window.userSettingsListenerUnsubscribe = null;
    }
}

export function setUserSettingsListener(unsub) {
    registerListener(unsub);
    window.userSettingsListenerUnsubscribe = unsub;
}

export function setCurrentCart(data) {
    _currentCart = [...data];
    currentCart = _currentCart;
}

export function addToCart(item) {
    _currentCart = [..._currentCart, item];
    currentCart = _currentCart;
}

export function removeFromCart(index) {
    const newCart = [..._currentCart];
    newCart.splice(index, 1);
    _currentCart = newCart;
    currentCart = _currentCart;
}

export function clearCart() {
    _currentCart = [];
    currentCart = [];
}

export function setConvenienceFee(amount) {
    _convenienceFee = parseFloat(amount) || 0;
    convenienceFee = _convenienceFee;
}

export function setCurrency(code) {
    _currencyCode = code || 'INR';
    _currencySymbol = CURRENCY_SYMBOLS[_currencyCode] || '₹';
    CURRENT_CURRENCY_CODE = _currencyCode;
    CURRENT_CURRENCY_SYMBOL = _currencySymbol;
}

export function setCurrentProductCount(count) {
    _currentProductCount = count;
    currentProductCount = count;
}

export function setEditingProductId(id) {
    _editingProductId = id;
    editingProductId = id;
}

export function setEditingCustomerId(id) {
    _editingCustomerId = id;
    editingCustomerId = id;
}

export function setSalesChartInstance(chart) {
    _salesChartInstance = chart;
    salesChartInstance = chart;
}

export function setDashboardWidgets(widgets) {
    _dashboardWidgets = widgets;
    dashboardWidgets = widgets;
}

export function setAvailableLocations(locations) {
    _availableLocations = [{ id: 'main', name: 'Main Store' }];
    availableLocations = _availableLocations;
}

export function setCurrentLocation(locId) {
    _currentLocationId = 'main';
    currentLocationId = 'main';
    cachedProducts = null;
}

// ============================================================================
// 🚀 GLOBAL INVENTORY CACHE ENGINE
// ============================================================================
let cachedProducts = null;
let isFetchingProducts = false;
let productFetchPromise = null;

export async function fetchAllProducts(forceRefresh = false) {
    if (cachedProducts && !forceRefresh) {
        return cachedProducts;
    }

    if (isFetchingProducts) {
        return productFetchPromise;
    }

    isFetchingProducts = true;

    productFetchPromise = (async () => {
        try {
            if (window.dbAPI && window.dbAPI.getProducts) {
                cachedProducts = await window.dbAPI.getProducts();
                return cachedProducts;
            } else {
                console.warn("Local DB API not found! Returning empty array.");
                return [];
            }
        } catch (error) {
            console.warn("Global product cache fetch failed:", error);
            return [];
        } finally {
            isFetchingProducts = false;
        }
    })();

    return productFetchPromise;
}

export function invalidateProductCache() {
    cachedProducts = null;
    isFetchingProducts = false;
}

export function getCachedProducts() {
    return cachedProducts || [];
}

export function deductLocalProductStock(productId, qtySold) {
    if (!cachedProducts) return;
    const product = cachedProducts.find(p => p.id === productId);
    if (product) {
        product.stockLevel = (parseFloat(product.stockLevel) || 0) - qtySold;
    }
}



export function hasPermission(role, viewName) {
    // Admin has full access to all views
    if (role === 'admin' || role === 'owner') return true;

    // View-specific permission matrix
    const rolePermissions = {
        staff: ['pos', 'inventory', 'customers', 'dashboard'],
        cashier: ['pos', 'dashboard'],
        manager: ['pos', 'inventory', 'customers', 'reports', 'dashboard'],
    };

    const allowedViews = rolePermissions[role] || rolePermissions.staff;
    return allowedViews.includes(viewName);
}