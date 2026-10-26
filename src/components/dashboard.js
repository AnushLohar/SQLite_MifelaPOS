// src/components/dashboard.js

import { MASTER_WIDGET_LIST } from '../store/widgetConfig.js';
import { 
    dashboardWidgets, storeId, appId, userId, userRole, 
    currentLocationId, currentUserPlan, availableLocations, 
    getCurrencySymbol, getStoreId, getUserRole, getCurrentLocationId, 
    getAvailableLocations, getUserId, getCurrentUserPlan,
    AppState // 🚀 THE FIX: Import the event bus to replace onSnapshot
} from '../store/state.js';
import { DOM, showModal } from '../utils/dom.js'; 
import { 
    calculateAllMetrics, 
    renderWidgetById, 
    renderChartToCanvas,
    handleWidgetInteraction 
} from './widgetRenderer.js';
import { escapeHTML } from '../utils/security.js';

// --- Safe State Getters (Prevents stale ID queries on app load) ---
const safeStoreId = () => typeof getStoreId === 'function' ? getStoreId() : storeId;
const safeUserRole = () => typeof getUserRole === 'function' ? getUserRole() : userRole;
const safeLocationId = () => typeof getCurrentLocationId === 'function' ? getCurrentLocationId() : currentLocationId;
const safeLocations = () => typeof getAvailableLocations === 'function' ? getAvailableLocations() : availableLocations;
const safeUserId = () => typeof getUserId === 'function' ? getUserId() : userId;
const safeAppId = () => (typeof window !== 'undefined' && window.__app_id) ? window.__app_id : appId;
const historicalDataCache = {};
// --- Helper: Normalize Plan ---
function normalizePlan(planString) {
    if (!planString) return 'free';
    const plan = planString.toLowerCase();
    if (plan === 'standard') return 'silver';
    if (plan === 'premium') return 'platinum'; 
    return plan;
}

const safePlan = () => {
    const rawPlan = typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : currentUserPlan;
    return normalizePlan(rawPlan);
};

// --- State ---
let isDashboardLoaded = false;
let isDashboardListenersAttached = false; 

// --- NEW: Rendering Lock & Session Tracker ---
let isRenderingDashboard = false;
let queuedDashboardRender = null;
let hasFetchedThisSession = false; 
let isDailyStatsListening = false;

export function listenToLiveDailyStats() {
    if (typeof AppState === 'undefined') return;

    const updateStats = async () => {
        if (!window.dbAPI || !window.dbAPI.getTransactionsSince) return;
        
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        try {
            const txs = await window.dbAPI.getTransactionsSince(startOfToday.toISOString());
            
            let totalRev = 0;
            let totalCount = 0;
            let totalPur = 0;

            txs.forEach((data) => {
                const type = (data.type || data.summary?.transactionType || '').toUpperCase();
                if (type === 'SALE') {
                    totalRev += Math.abs(data.summary?.revenue || data.summary?.total || data.total || 0);
                    totalCount += 1;
                } else if (type === 'PURCHASE' || type === 'EXPENSE') {
                    totalPur += Math.abs(data.summary?.total || data.total || 0);
                }
            });

            const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';

            const revWidget = document.querySelector('[data-widget="revenueToday"]');
            if (revWidget) {
                const valEl = revWidget.querySelector('.text-3xl, .text-4xl, h3, h4'); 
                if (valEl) valEl.textContent = `${currency}${totalRev.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            }

            const txWidget = document.querySelector('[data-widget="totalTransactionsToday"]');
            if (txWidget) {
                const valEl = txWidget.querySelector('.text-3xl, .text-4xl, h3, h4');
                if (valEl) valEl.textContent = totalCount.toString();
            }

            const purWidget = document.querySelector('[data-widget="purchasesToday"]');
            if (purWidget) {
                const valEl = purWidget.querySelector('.text-3xl, .text-4xl, h3, h4');
                if (valEl) valEl.textContent = `${currency}${totalPur.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            }
        } catch (e) {
            console.error("Dashboard Live Sync Error:", e);
        }
    };

    // 🚀 THE FIX: Only subscribe once, never call unsubscribe()
    if (!isDailyStatsListening) {
        if (typeof AppState.subscribe === 'function') {
            AppState.subscribe('transactions_updated', updateStats);
            isDailyStatsListening = true;
        }
    }

    // Fire immediately on load
    updateStats();
}

const MASTER_DEVICE_KEY = 'mifela_master_terminal_v1'; 
const DASHBOARD_CACHE_KEY = 'mifela_dashboard_metrics_v1';

// --- Helper: Get Local Date String (YYYY-MM-DD) ---
function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- Hybrid Device Signature Detection ---
async function getDeviceSignature() {
    if (window.electronAPI && window.electronAPI.getMachineId) {
        try {
            const hwId = await window.electronAPI.getMachineId();
            if (hwId) return { type: 'hardware', value: hwId };
        } catch (e) { console.warn("Hardware ID failed", e); }
    }

    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return { type: 'ip', value: data.ip };
    } catch (error) {
        console.warn("Could not determine IP:", error);
        return null;
    }
}

export async function performAutoIpUpdate() {
    return; 
}

window.toggleIpSecurity = async function(isEnabled) {
    
    const checkbox = document.getElementById('ip-security-toggle');
    if(checkbox) checkbox.checked = false;
};

async function setupWelcomeBanner() {
    updateDashboardHeader();
    
    const planEl = DOM.dashboard?.planName || document.getElementById('dashboard-plan-name');
    const welcomeCard = planEl ? planEl.closest('.rounded-xl') : document.querySelector('#dashboard > div.rounded-xl');
    if (!welcomeCard) return;

    if (!document.getElementById('refresh-dashboard-btn')) {
        const header = welcomeCard.querySelector('h2');
        if (header) {
            const btnContainer = document.createElement('div');
            btnContainer.className = "flex items-center justify-between w-full mb-4";
            
            const h2Clone = header.cloneNode(true);
            header.parentNode.replaceChild(btnContainer, header);
            btnContainer.appendChild(h2Clone);

            const refreshBtn = document.createElement('button');
            refreshBtn.id = 'refresh-dashboard-btn';
            refreshBtn.className = "text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 bg-indigo-50 px-4 py-2 rounded-full transition-colors cursor-pointer border border-indigo-100 hover:bg-indigo-100 shadow-sm";
            refreshBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> Refresh`;
            refreshBtn.onclick = async () => {
                refreshBtn.innerHTML = `<div class="animate-spin h-4 w-4 border-2 border-indigo-600 rounded-full border-t-transparent"></div>`;
                refreshBtn.disabled = true;
                await renderDynamicDashboard(true); 
                setTimeout(() => {
                    const newBtn = document.getElementById('refresh-dashboard-btn');
                    if(newBtn) {
                         newBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> Refresh`;
                         newBtn.disabled = false;
                    }
                }, 300);
            };
            btnContainer.appendChild(refreshBtn);
        }
    }
    
    // 🚀 THE FIX: Wipe out any old clock-in containers from the DOM
    const oldContainer = document.getElementById('dashboard-attendance-container');
    if (oldContainer) oldContainer.remove();
}


// 4. Rip out Cloud Computed Aggregations
export async function syncWeeklyFastMovers() {
    // Cannot be run offline efficiently, gracefully skipping
    window.__mifela_fast_movers = []; 
    return;
}

export async function syncMonthlyForecasting() {
    // Cannot be run offline efficiently, gracefully skipping
    window.__mifela_monthly_forecast = []; 
    return;
}

// --- Location Validation Logic ---
async function validateLocation() {
    try {
        const profileRef = doc(db, `artifacts/${safeAppId()}/stores/${safeStoreId()}/settings/profile`);
        const snap = await getDoc(profileRef);

        if (!snap.exists() || !snap.data().security || !snap.data().security.enabled) return true; 

        const allowedSignature = snap.data().security.allowedIp; 
        const userSignature = await getDeviceSignature(); 

        if (!userSignature) throw new Error("Cannot verify location. Check internet connection.");
        
        if (userSignature.value !== allowedSignature) {
            throw new Error(`Location Mismatch. You are not on the Store Network or Master Terminal.`);
        }

        return true; 
    } catch (e) {
        if (e.code === 'permission-denied') return true;
        throw e;
    }
}

// --- EXPOSED: Settings Toggle Functions ---
window.toggleIpSecurity = async function(isEnabled) {
    const role = safeUserRole();
    if (role !== 'admin' && role !== 'store_manager') {
        showModal('Permission Denied', 'Only Admins can change security settings.', 'error');
        const checkbox = document.getElementById('ip-security-toggle');
        if(checkbox) checkbox.checked = !isEnabled;
        return;
    }

    try {
        const profileRef = doc(db, `artifacts/${safeAppId()}/stores/${safeStoreId()}/settings/profile`);
        
        if (isEnabled) {
            showModal('Securing...', 'Detecting network signature...', 'info');
            const signature = await getDeviceSignature();
            
            if (!signature) {
                showModal('Error', 'Could not detect signature. Check internet.', 'error');
                const checkbox = document.getElementById('ip-security-toggle');
                if(checkbox) checkbox.checked = false;
                return;
            }

            const isAuto = confirm("ENABLE AUTO-SECURE?\n\nOK (Recommended): Mark THIS computer as the 'Master Terminal'.\nCANCEL: Manually lock to the current IP only.");

            await setDoc(profileRef, {
                security: {
                    allowedIp: signature.value,
                    lockType: signature.type,
                    enabled: true,
                    updatedAt: new Date().toISOString(),
                    updatedBy: safeUserId(),
                    autoSecureEnabled: isAuto
                }
            }, { merge: true });

            if (isAuto) localStorage.setItem(MASTER_DEVICE_KEY, 'true');
            else localStorage.removeItem(MASTER_DEVICE_KEY);
            
            showModal('Security Enabled', `Location locked to: ${signature.value}`, 'success');

        } else {
            if(!confirm("Are you sure? Employees will be able to mark attendance from ANY location.")) {
                const checkbox = document.getElementById('ip-security-toggle');
                if(checkbox) checkbox.checked = true;
                return;
            }

            await setDoc(profileRef, { security: { enabled: false } }, { merge: true });
            localStorage.removeItem(MASTER_DEVICE_KEY); 
            showModal('Security Disabled', 'Location restrictions removed.', 'info');
        }
        
        const btnContainer = document.getElementById('dashboard-attendance-container');
        if(btnContainer) {
             btnContainer.innerHTML = ''; 
             await checkAttendance(btnContainer);
        }

    } catch(e) {
        showModal('Error', 'Failed to save security setting.', 'error');
        const checkbox = document.getElementById('ip-security-toggle');
        if(checkbox) checkbox.checked = !isEnabled;
    }
};

window.loadSecurityState = async function() {
    if (!safeStoreId()) return;
    try {
        const profileRef = doc(db, `artifacts/${safeAppId()}/stores/${safeStoreId()}/settings/profile`);
        const snap = await getDoc(profileRef);
        const enabled = snap.exists() ? snap.data().security?.enabled : false;
        const checkbox = document.getElementById('ip-security-toggle');
        if (checkbox) checkbox.checked = !!enabled;
    } catch(e) { console.warn("Failed to load security state", e); }
};

export async function renderDynamicDashboard(forceRefresh = false) {
    if (!getUserId() || !getStoreId()) return;
    if (!DOM.dashboard.grid) return; 

    if (!safeAppId() || !safeStoreId()) {
        setTimeout(() => renderDynamicDashboard(forceRefresh), 500);
        return;
    }

    if (isRenderingDashboard) {
        queuedDashboardRender = { forceRefresh: forceRefresh || (queuedDashboardRender?.forceRefresh) };
        return;
    }
    isRenderingDashboard = true;

    try {
        DOM.dashboard.grid.innerHTML = '';
        if (safeUserRole() === 'admin') performAutoIpUpdate();

        try { await setupWelcomeBanner(); } 
        catch (e) { console.warn("Welcome init failed:", e); }
        
        let metrics = {};
        
        const shouldFetch = forceRefresh || !hasFetchedThisSession;
        
        try {
            if (shouldFetch) {
                metrics = await calculateAllMetrics();
                hasFetchedThisSession = true;
            } else {
                const cachedMetrics = loadMetricsFromCache();
                if (cachedMetrics) {
                    metrics = cachedMetrics;
                } else {
                    metrics = await calculateAllMetrics();
                    hasFetchedThisSession = true;
                }
            }
        } catch (e) {
            console.error("Dashboard calculation error:", e);
            DOM.dashboard.grid.innerHTML = `
                <div class="col-span-full bg-red-50 p-6 rounded-xl border border-red-200 text-center shadow-sm">
                    <h3 class="text-red-800 font-bold mb-2">Dashboard Error</h3>
                    <p class="text-red-600 text-sm mb-4">${escapeHTML(e.message)}</p>
                    <button onclick="location.reload()" class="px-5 py-2.5 bg-white border border-red-300 text-red-700 font-bold rounded-lg shadow-sm hover:bg-red-50 transition-colors">Reload App</button>
                </div>`;
            return; 
        }

        try {
            const presentList = await getPresentStaffToday();
            metrics.staffOnDuty = presentList.length;
            metrics.availableStaff = presentList.length; 
            metrics.staffCount = presentList.length; 
        } catch(e) {
            console.warn("Could not fetch today's staff on duty for dashboard:", e);
            metrics.staffOnDuty = 0;
            metrics.availableStaff = 0;
        }
        
        saveMetricsToCache(metrics);

        if (safeUserRole() === 'admin') {
            setTimeout(() => {
                if (!getUserId() || !getStoreId()) return; 
                if (typeof syncWeeklyFastMovers === 'function') syncWeeklyFastMovers().catch(() => {});
                if (typeof syncMonthlyForecasting === 'function') syncMonthlyForecasting().catch(() => {});
            }, 2000); 
        }

        if (window.__inventoryStats) {
            metrics.lowStockCount = window.__inventoryStats.lowStockCount || metrics.lowStockCount || 0;
            metrics.expiredCount = window.__inventoryStats.expiredCount || metrics.expiredCount || 0;
            metrics.lowStockList = window.__inventoryStats.lowStockList || metrics.lowStockList || [];
            metrics.expiredList = window.__inventoryStats.expiredList || metrics.expiredList || [];
            metrics.valueAtRisk = window.__inventoryStats.valueAtRisk || metrics.valueAtRisk || 0;
            
            metrics.stockValueAtRisk = metrics.valueAtRisk; 
            metrics.outOfStockCount = (metrics.lowStockList).filter(item => item.status === 'Out' || item.type === 'out').length;
        }

        const inventoryRoles = ['admin', 'store_manager', 'assistant_manager', 'stock_keeper', 'supervisor'];
        if (!safeUserRole() || inventoryRoles.includes(safeUserRole())) {
            setupDashboardAlertLists(metrics);
        }

        await renderAnalyticsWidgets(metrics);

        const ind = document.getElementById('dashboard-cache-indicator');
        if (ind) ind.remove();
        
        const existingFooter = document.getElementById('dashboard-copyright-footer');
        if (existingFooter) existingFooter.remove();
        
        const footer = document.createElement('div');
        footer.id = 'dashboard-copyright-footer';
        footer.className = "col-span-full py-8 text-center border-t border-gray-100 mt-8";
        footer.innerHTML = `
            <div class="flex flex-col items-center gap-1.5">
                <p class="text-[10px] font-bold text-gray-400 tracking-[0.3em] uppercase">Mifela Inventory Management</p>
                <p class="text-[11px] text-gray-500 font-medium">© 2026 All Rights Reserved</p>
            </div>
        `;
        DOM.dashboard.grid.appendChild(footer); 

        if (!isDashboardListenersAttached) {
            let lastTapTime = 0;
            let tapTimeout;
            
            DOM.dashboard.grid.addEventListener('click', (e) => { 
                const btn = e.target.closest('button');
                
                if (btn) {
                    const text = (btn.textContent || btn.innerText || '').trim().toLowerCase();
                    const btnId = (btn.id || '').toLowerCase();

                    if (text.includes('cheque') || btnId.includes('cheque') || text.includes('review cheques')) {
                        e.preventDefault(); e.stopPropagation();
                        if (typeof window.openFinancialRegistry === 'function') window.openFinancialRegistry('CHEQUES');
                        return;
                    }
                    if (text.includes('collect dues') || btnId.includes('collect')) {
                        e.preventDefault(); e.stopPropagation();
                        if (typeof window.openFinancialRegistry === 'function') window.openFinancialRegistry('RECEIVABLES');
                        return;
                    }
                    if (text.includes('repay') || text.includes('payables') || text.includes('settle') || btnId.includes('repay')) {
                        e.preventDefault(); e.stopPropagation();
                        if (typeof window.openFinancialRegistry === 'function') window.openFinancialRegistry('PAYABLES');
                        return;
                    }
                }

                const card = e.target.closest('.widget-card');
                if (!card || !card.dataset.widget) return;

                const currentTime = new Date().getTime();
                const tapLength = currentTime - lastTapTime;
                clearTimeout(tapTimeout);

                if (tapLength > 0 && tapLength < 400) {
                    e.preventDefault();
                    card.classList.add('ring-4', 'ring-indigo-200');
                    setTimeout(() => card.classList.remove('ring-4', 'ring-indigo-200'), 200);
                    
                    const widgetId = card.dataset.widget;
                    
                    if (widgetId === 'stockValueAtRisk' || widgetId === 'valueAtRisk') {
                        if (typeof showValueAtRiskModal === 'function') showValueAtRiskModal();
                    } else if (widgetId === 'revenueToday' || widgetId === 'totalTransactionsToday' || widgetId === 'topProductsToday' || widgetId === 'purchasesToday') {
                        if (typeof showSafeHistoryModal === 'function') showSafeHistoryModal(widgetId, metrics);
                    } else if (widgetId === 'availableStaff' || widgetId === 'staffOnDuty' || widgetId === 'staffCount') {
                        // 🚀 THE FIX: Opens a modal with the list of present/absent staff instead of navigating
                        if (typeof showStaffAttendanceModal === 'function') showStaffAttendanceModal();
                    } else if (typeof handleWidgetInteraction === 'function') {
                        handleWidgetInteraction(widgetId);
                    }
                } else {
                    tapTimeout = setTimeout(() => { /* single tap ignored */ }, 400);
                }
                lastTapTime = currentTime;
            });
            isDashboardListenersAttached = true;
        }

        listenToLiveDailyStats();
        isDashboardLoaded = true;

    } finally {
        isRenderingDashboard = false;
        if (queuedDashboardRender) {
            const nextRefresh = queuedDashboardRender.forceRefresh;
            queuedDashboardRender = null;
            setTimeout(() => renderDynamicDashboard(nextRefresh), 0);
        }
    }
}
async function showStaffAttendanceModal() {
    const modalId = 'staff-attendance-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();

    const presentStaffList = await getPresentStaffToday();

    const listHtml = presentStaffList.length > 0 ? presentStaffList.map(s => `
        <div class="flex items-center justify-between p-4 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
            <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center font-black text-sm shadow-sm border border-emerald-100">
                    ${s.name.charAt(0).toUpperCase()}
                </div>
                <div>
                    <p class="text-sm font-bold text-slate-800">${escapeHTML(s.name)}</p>
                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">${escapeHTML(s.role)}</p>
                </div>
            </div>
            <div class="px-3 py-1 rounded-full text-xs font-bold border bg-emerald-100 text-emerald-700 border-emerald-200 shadow-sm">
                ${s.statusStr}
            </div>
        </div>
    `).join('') : '<div class="text-center py-8 text-slate-500 font-medium">No staff members currently marked present.</div>';

    const html = `
        <div id="${modalId}" class="fixed inset-0 bg-gray-900 bg-opacity-60 hidden items-center justify-center z-[70] transition-opacity opacity-0 p-4">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden transform scale-95 transition-transform border border-slate-100">
                <div class="flex justify-between items-center px-6 py-5 border-b border-slate-100 bg-white">
                    <h3 class="text-xl font-black text-slate-800">Staff On Duty</h3>
                    <button id="close-${modalId}-x" class="text-slate-400 hover:text-slate-600 transition-colors bg-white rounded-full p-1.5 hover:bg-slate-100">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="p-2 max-h-[60vh] overflow-y-auto custom-scrollbar bg-slate-50/30">
                    ${listHtml}
                </div>
                <div class="px-6 py-4 border-t border-slate-100 bg-white flex justify-end">
                    <button id="close-${modalId}-btn" class="px-6 py-2.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 font-bold rounded-xl text-sm transition-all shadow-sm active:scale-95">Close</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    const modalEl = document.getElementById(modalId);

    const closeFunc = () => {
        modalEl.classList.add('opacity-0');
        modalEl.querySelector('div').classList.remove('scale-100');
        modalEl.querySelector('div').classList.add('scale-95');
        setTimeout(() => { modalEl.classList.add('hidden'); modalEl.classList.remove('flex'); modalEl.remove(); }, 200);
    };

    document.getElementById(`close-${modalId}-x`).onclick = closeFunc;
    document.getElementById(`close-${modalId}-btn`).onclick = closeFunc;

    modalEl.classList.remove('hidden');
    setTimeout(() => {
        modalEl.classList.remove('opacity-0');
        modalEl.querySelector('div').classList.remove('scale-95');
        modalEl.querySelector('div').classList.add('scale-100');
        modalEl.classList.add('flex');
    }, 10);
}
async function getPresentStaffToday() {
    const todayStr = getLocalDateString(new Date()); // e.g., "2026-10-20"
    const monthStr = todayStr.substring(0, 7);       // "2026-10"
    const dayNum = parseInt(todayStr.split('-')[2], 10); // e.g., 20 for day 20
    
    let presentStaffMap = new Map(); 
    
    // 1. Fetch Staff Directory from SQLite or LocalStorage cache
    let staffDirectory = [];
    try {
        if (window.dbAPI && typeof window.dbAPI.getStaff === 'function') {
            staffDirectory = await window.dbAPI.getStaff() || [];
        }
    } catch(e){}
    
    if (!staffDirectory || staffDirectory.length === 0) {
        try {
            const cacheKeys = ['mifela_staff_directory', 'mifela_staff_list', 'mifela_staff_cache'];
            for (let k of cacheKeys) {
                const parsed = JSON.parse(localStorage.getItem(k) || '[]');
                if (Array.isArray(parsed) && parsed.length > 0) {
                    staffDirectory = parsed;
                    break;
                }
            }
        } catch(e){}
    }

    // Map staff directory by ID/Name/Phone for universal matching
    const staffDict = {};
    staffDirectory.forEach(s => {
        const id = String(s.id || s.docId || s.phone || s.name || '').trim();
        if (id) staffDict[id] = s;
        if (s.name) {
            staffDict[String(s.name).trim().toLowerCase()] = s;
        }
    });

    const isMarkedPresent = (statusVal) => {
        if (!statusVal) return false;
        const sStr = typeof statusVal === 'object' ? (statusVal.status || '') : String(statusVal);
        // Matches standard registry dots like 'P', 'HD', or true/present indicators
        return sStr === 'P' || sStr === 'HD' || sStr === 'Present' || sStr === true || sStr === '.';
    };

    // 2. Scan staff.js LocalStorage Monthly / Daily Attendance Matrix
    try {
        // Staff.js often saves matrices like mifela_staff_attendance_2026-10 where records contain day columns
        const monthKey = `mifela_staff_attendance_${monthStr}`;
        const monthAtt = JSON.parse(localStorage.getItem(monthKey) || '{}');
        
        Object.entries(monthAtt).forEach(([staffKey, records]) => {
            if (!records) return;
            
            // Check both date format ("2026-10-20") and numeric day index format (20 or "20")
            const todayRecord = records[todayStr] || records[dayNum] || records[String(dayNum)];
            
            if (isMarkedPresent(todayRecord)) {
                const matchedStaff = staffDict[staffKey] || staffDict[String(staffKey).toLowerCase()] || { name: staffKey, role: 'Staff' };
                const realName = matchedStaff.name || matchedStaff.storeName || staffKey;
                
                presentStaffMap.set(realName, {
                    name: realName,
                    role: matchedStaff.role || matchedStaff.designation || 'Staff',
                    statusStr: (typeof todayRecord === 'object' && todayRecord.status === 'HD') ? 'Half Day' : 'Present'
                });
            }
        });
    } catch(e) {
        console.warn("Error parsing staff attendance matrix:", e);
    }

    // 3. Scan SQLite Database Attendance if available
    try {
        if (window.dbAPI && typeof window.dbAPI.getAttendanceByDate === 'function') {
            const dbAtt = await window.dbAPI.getAttendanceByDate(todayStr);
            if (dbAtt) {
                Object.entries(dbAtt).forEach(([uid, val]) => {
                    if (isMarkedPresent(val)) {
                        const matchedStaff = staffDict[uid] || staffDict[String(uid).toLowerCase()] || { name: uid, role: 'Staff' };
                        const realName = matchedStaff.name || matchedStaff.storeName || uid;
                        
                        presentStaffMap.set(realName, {
                            name: realName,
                            role: matchedStaff.role || matchedStaff.designation || 'Staff',
                            statusStr: 'Present'
                        });
                    }
                });
            }
        }
    } catch(e){}

    // 4. Scan alternative fallback keys
    try {
        const altKeys = [`mifela_attendance_${todayStr}`, `mifela_attendance_main_${todayStr}`];
        altKeys.forEach(ak => {
            const altData = JSON.parse(localStorage.getItem(ak) || '{}');
            Object.entries(altData).forEach(([uid, val]) => {
                if (isMarkedPresent(val)) {
                    const matchedStaff = staffDict[uid] || staffDict[String(uid).toLowerCase()] || { name: uid, role: 'Staff' };
                    const realName = matchedStaff.name || matchedStaff.storeName || uid;
                    presentStaffMap.set(realName, {
                        name: realName,
                        role: matchedStaff.role || matchedStaff.designation || 'Staff',
                        statusStr: 'Present'
                    });
                }
            });
        });
    } catch(e){}

    return Array.from(presentStaffMap.values());
}
async function showSafeHistoryModal(widgetId, currentMetrics) {
    const modalId = 'safe-history-modal';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();

    let title = 'History';
    if (widgetId === 'revenueToday') title = 'Revenue History';
    if (widgetId === 'purchasesToday') title = 'Purchases History'; 
    if (widgetId === 'totalTransactionsToday') title = 'Sales Count History';
    if (widgetId === 'topProductsToday') title = 'Top Products (Expanded)';

    const html = `
        <div id="${modalId}" class="fixed inset-0 bg-gray-900 bg-opacity-60 hidden items-center justify-center z-[60] transition-opacity opacity-0">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden transform scale-95 transition-transform">
                <div class="flex justify-between items-center px-6 py-4 border-b bg-gray-50">
                    <h3 class="text-lg font-bold text-gray-800">${title}</h3>
                    <button id="close-safe-history-btn" class="text-gray-400 hover:text-gray-600 transition-colors bg-white rounded-full p-1 hover:bg-gray-200">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="p-6" id="safe-history-content">
                    <div class="flex justify-center items-center py-8">
                        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    modal = document.getElementById(modalId);

    document.getElementById('close-safe-history-btn').onclick = () => {
        modal.classList.add('opacity-0');
        modal.querySelector('div').classList.remove('scale-100');
        modal.querySelector('div').classList.add('scale-95');
        setTimeout(() => { modal.classList.add('hidden'); modal.classList.remove('flex'); modal.remove(); }, 200);
    };

    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('div').classList.remove('scale-95');
        modal.querySelector('div').classList.add('scale-100');
        modal.classList.add('flex');
    }, 10);

    const sAppId = safeAppId();
    const sid = safeStoreId();
    const contentContainer = document.getElementById('safe-history-content');

    if (widgetId === 'topProductsToday') {
        const items = currentMetrics.topProductsToday || [];
        if (items.length === 0) {
            contentContainer.innerHTML = `<div class="text-center py-8 text-gray-500">No sales recorded today yet.</div>`;
            return;
        }
        let listHtml = `<div class="overflow-hidden rounded-lg border border-gray-200"><table class="w-full text-sm text-left"><thead class="bg-indigo-50 text-indigo-700 uppercase text-xs"><tr><th class="px-4 py-3">Rank</th><th class="px-4 py-3">Product Name</th><th class="px-4 py-3 text-right">Qty Sold</th></tr></thead><tbody class="divide-y divide-gray-100">`;
        items.forEach((item, index) => {
            let rankClass = "bg-gray-100 text-gray-500";
            if (index === 0) rankClass = "bg-yellow-100 text-yellow-700";
            if (index === 1) rankClass = "bg-gray-200 text-gray-700";
            if (index === 2) rankClass = "bg-orange-100 text-orange-700";
            listHtml += `<tr class="hover:bg-gray-50"><td class="px-4 py-3"><span class="w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${rankClass}">${index + 1}</span></td><td class="px-4 py-3 font-medium text-gray-700">${escapeHTML(item.name)}</td><td class="px-4 py-3 text-right font-bold text-indigo-600">${item.qty}</td></tr>`;
        });
        listHtml += `</tbody></table></div>`;
        contentContainer.innerHTML = listHtml;

    } else if (widgetId === 'revenueToday' || widgetId === 'totalTransactionsToday' || widgetId === 'purchasesToday') {
        const isRev = widgetId === 'revenueToday';
        const isPur = widgetId === 'purchasesToday';
        const isMoney = isRev || isPur;
        const currencySymbol = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';
        
        let colName = isRev ? 'Revenue' : (isPur ? 'Purchases' : 'Transactions');
        let listHtml = `<div class="overflow-hidden rounded-lg border border-gray-200"><table class="w-full text-sm text-left"><thead class="bg-gray-50 text-gray-500 uppercase text-xs"><tr><th class="px-4 py-3">Date</th><th class="px-4 py-3 ${isMoney ? 'text-right' : 'text-center'}">${colName}</th></tr></thead><tbody class="divide-y divide-gray-100">`;
        
        let totalVal = 0;
        const todayStr = getLocalDateString(new Date());

        for (let i = 0; i < 7; i++) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const dateStr = getLocalDateString(d);
            const displayDate = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            
            let val = 0;
            
            if (dateStr === todayStr) {
                if (isRev) val = currentMetrics.revenueToday || 0;
                else if (isPur) val = currentMetrics.purchasesToday || 0;
                else val = currentMetrics.totalTransactionsToday || 0;
            } else {
                if (!historicalDataCache[dateStr]) {
                    historicalDataCache[dateStr] = { revenue: 0, purchases: 0, transactions: 0 };
                    
                    // 🚀 THE FIX: Use local SQLite instead of Firebase query/getDocs
                    try {
                        const startOfDay = new Date(dateStr);
                        startOfDay.setHours(0, 0, 0, 0);
                        
                        if (window.dbAPI && window.dbAPI.getTransactionsSince) {
                            const snap = await window.dbAPI.getTransactionsSince(startOfDay.toISOString());
                            
                            let dayPurchases = 0;
                            let dayRevenue = 0;
                            let dayCount = 0;
                            
                            snap.forEach(data => {
                                // Filter in-memory to ensure it belongs to the exact day
                                const txDate = new Date(data.timestamp).toISOString().split('T')[0];
                                if (txDate === dateStr) {
                                    const tType = (data.type || data.summary?.transactionType || "").toUpperCase();
                                    if (tType === 'PURCHASE' || tType === 'EXPENSE') {
                                        dayPurchases += Math.abs(data.summary?.total || data.total || 0);
                                    } else if (tType === 'SALE') {
                                        dayRevenue += Math.abs(data.summary?.total || data.total || 0);
                                        dayCount++;
                                    }
                                }
                            });
                            
                            historicalDataCache[dateStr].purchases = dayPurchases;
                            historicalDataCache[dateStr].revenue = dayRevenue;
                            historicalDataCache[dateStr].transactions = dayCount;
                        }
                    } catch (e) {
                        console.warn(`Failed to fetch history for ${dateStr}`, e);
                    }
                }
                
                if (isRev) val = historicalDataCache[dateStr].revenue;
                else if (isPur) val = historicalDataCache[dateStr].purchases;
                else val = historicalDataCache[dateStr].transactions;
            }
            
            totalVal += val;
            
            const valDisplay = isMoney ? `${currencySymbol}${val.toFixed(2)}` : val;
            const valClass = isRev ? 'text-right font-bold text-green-600' : (isPur ? 'text-right font-bold text-red-500' : 'text-center font-bold text-indigo-600');
            
            listHtml += `<tr class="hover:bg-gray-50"><td class="px-4 py-3 font-medium text-gray-700">${displayDate}${dateStr===todayStr?' <span class="text-[10px] text-indigo-500 ml-1">(Today)</span>':''}</td><td class="px-4 py-3 ${valClass}">${valDisplay}</td></tr>`;
        }
        
        const totalDisplay = isMoney ? `${currencySymbol}${totalVal.toFixed(2)}` : totalVal;
        const totalClass = isMoney ? 'text-right' : 'text-center';
        
        listHtml += `</tbody><tfoot class="bg-gray-50 font-bold text-gray-800"><tr><td class="px-4 py-3">Total (7 Days)</td><td class="px-4 py-3 ${totalClass}">${totalDisplay}</td></tr></tfoot></table></div>`;
        
        contentContainer.innerHTML = listHtml; 
    }
}

async function showValueAtRiskModal() {
    const modalId = 'value-at-risk-modal';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();

    const html = `
        <div id="${modalId}" class="fixed inset-0 bg-gray-900 bg-opacity-60 hidden items-center justify-center z-[60] transition-opacity opacity-0">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden transform scale-95 transition-transform">
                <div class="flex justify-between items-center px-6 py-4 border-b bg-gray-50">
                    <h3 class="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <span class="text-orange-500">⚠️</span> Value at Risk Details
                    </h3>
                    <button id="close-var-btn" class="text-gray-400 hover:text-gray-600 transition-colors bg-white rounded-full p-1 hover:bg-gray-200">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="p-6" id="var-modal-content">
                    <div class="min-h-[150px] flex items-center justify-center">
                        <div class="animate-spin h-8 w-8 border-4 border-indigo-100 border-t-indigo-600 rounded-full"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    modal = document.getElementById(modalId);

    document.getElementById('close-var-btn').onclick = () => {
        modal.classList.add('opacity-0');
        modal.querySelector('div').classList.remove('scale-100');
        modal.querySelector('div').classList.add('scale-95');
        setTimeout(() => { modal.classList.add('hidden'); modal.classList.remove('flex'); modal.remove(); }, 200);
    };

    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('div').classList.remove('scale-95');
        modal.querySelector('div').classList.add('scale-100');
        modal.classList.add('flex');
    }, 10);

    const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';
    let itemsHtml = '';
    let calculatedTotal = 0;

    try {
        let rawProducts = [];
        
        // 🚀 THE FIX: Try multiple SQLite method names, then fallback to LocalStorage
        if (window.dbAPI) {
            if (typeof window.dbAPI.getProducts === 'function') {
                rawProducts = await window.dbAPI.getProducts();
            } else if (typeof window.dbAPI.getAllProducts === 'function') {
                rawProducts = await window.dbAPI.getAllProducts();
            }
        }
        
        if (!rawProducts || rawProducts.length === 0) {
            const sid = typeof getStoreId === 'function' ? getStoreId() : 'main';
            const localProds = localStorage.getItem(`mifela_products_${sid}`) || localStorage.getItem('mifela_products');
            if (localProds) rawProducts = JSON.parse(localProds);
        }

        if (!rawProducts || rawProducts.length === 0) {
            throw new Error("No products found in database or cache.");
        }

        const today = new Date();
        today.setHours(0,0,0,0);
        const atRiskDetails = [];

        rawProducts.forEach(data => {
            const stock = Number(data.stockLevel || 0);
            const cost = Number(data.cost || 0);
            const threshold = Number(data.lowStockThreshold || 0);
            const expiryStr = data.expirationDate || null;

            let isExpired = false;
            if (expiryStr) {
                const expiryDate = new Date(expiryStr);
                isExpired = expiryDate < today;
            }
            const isLow = stock <= threshold && stock > 0;

            if ((isLow || isExpired) && stock > 0) {
                const itemVal = stock * cost;
                calculatedTotal += itemVal;
                atRiskDetails.push({
                    name: data.name,
                    stock: stock,
                    cost: cost,
                    value: itemVal,
                    isExpired,
                    isLow
                });
            }
        });

        atRiskDetails.sort((a, b) => b.value - a.value);

        if (atRiskDetails.length > 0) {
            itemsHtml = atRiskDetails.map(p => `
                <div class="flex justify-between items-center py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 px-2 rounded transition-colors">
                    <div class="flex flex-col w-3/5 pr-2">
                        <span class="text-sm font-medium text-gray-800 truncate" title="${escapeHTML(p.name)}">${escapeHTML(p.name)}</span>
                        <div class="flex gap-2 mt-1">
                            ${p.isExpired ? '<span class="text-[9px] text-red-600 bg-red-100 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Expired</span>' : ''}
                            ${p.isLow && !p.isExpired ? '<span class="text-[9px] text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Low Stock</span>' : ''}
                        </div>
                    </div>
                    <div class="text-right flex flex-col items-end w-2/5">
                        <span class="text-sm font-black text-gray-800">${currency}${p.value.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                        <span class="text-[10px] text-gray-400 font-medium">${p.stock} units @ ${currency}${p.cost}</span>
                    </div>
                </div>
            `).join('');
        } else {
            itemsHtml = '<p class="text-sm text-gray-500 py-6 text-center italic">No items currently at risk.</p>';
        }

    } catch (e) {
        console.error("Failed to fetch detailed risk items", e);
        itemsHtml = `<p class="text-sm text-red-500 py-6 text-center">${escapeHTML(e.message)}</p>`;
    }

    const totalStr = Number(calculatedTotal || 0).toLocaleString(undefined, {minimumFractionDigits: 2});

    const contentDiv = document.getElementById('var-modal-content');
    if (contentDiv) {
        contentDiv.innerHTML = `
            <div class="bg-gradient-to-br from-orange-50 to-amber-50 text-orange-900 p-5 rounded-xl mb-4 text-center border border-orange-100 shadow-sm">
                <p class="text-xs font-bold uppercase tracking-widest opacity-70 mb-1">Total Value at Risk</p>
                <p class="text-3xl font-black tracking-tight">${currency}${totalStr}</p>
            </div>
            <div class="max-h-64 overflow-y-auto custom-scrollbar pr-2">
                ${itemsHtml}
            </div>
        `;
    }
}
function loadMetricsFromCache() {
    try {
        const raw = localStorage.getItem(DASHBOARD_CACHE_KEY);
        if (!raw) return null;
        
        const cache = JSON.parse(raw);
        const isValid = (cache.storeId === safeStoreId()) && (cache.locationId === safeLocationId());
        return isValid ? cache.data : null;
    } catch (e) { return null; }
}

function saveMetricsToCache(metrics) {
    try {
        localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
            timestamp: Date.now(),
            storeId: safeStoreId(),
            locationId: safeLocationId(),
            data: metrics
        }));
    } catch (e) { console.warn("LocalStorage full, skipping cache save."); }
}

export function updateDashboardHeader(forceStoreName = null) {
    const planEl = DOM.dashboard?.planName || document.getElementById('dashboard-plan-name');
    const storeNameEl = document.getElementById('dashboard-store-name');

    if (planEl) planEl.textContent = safePlan().toUpperCase();

    if (storeNameEl) {
        let displayName = forceStoreName;
        const locs = safeLocations();

        if (!displayName || displayName === 'Your Store' || displayName === 'Main Store') {
            const locId = safeLocationId();
            const activeLocId = (locId && locId !== 'all') ? locId : safeStoreId();
            const currentStore = (locs || []).find(s => s.id === activeLocId) || (locs || [])[0];
            if (currentStore && (currentStore.name || currentStore.storeName)) displayName = currentStore.name || currentStore.storeName;
        }

        if ((!displayName || displayName === 'Your Store' || displayName === 'Main Store') && window.__mifela_prefetched_store_name__) {
            displayName = window.__mifela_prefetched_store_name__;
        }

        if (!displayName) displayName = 'Your Store';
        storeNameEl.textContent = escapeHTML(displayName);
    }

    // 🚀 THE FIX: Inject the Device IP Badge in the bottom right corner
    if (!document.getElementById('device-ip-badge')) {
        const ipBadge = document.createElement('div');
        ipBadge.id = 'device-ip-badge';
        ipBadge.className = 'fixed bottom-5 right-5 bg-slate-800/90 text-white font-mono text-[10px] px-3 py-1.5 rounded-full shadow-lg z-[999] backdrop-blur-sm border border-slate-600 flex items-center gap-2 transition-all hover:scale-105';
        ipBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Node: 127.0.0.1`;
        
        if (window.electronAPI && typeof window.electronAPI.getLocalIP === 'function') {
            window.electronAPI.getLocalIP().then(ip => {
                if(ip) ipBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Terminal: ${ip}`;
            }).catch(()=>{});
        }
        
        document.body.appendChild(ipBadge);
    }
}




function setupDashboardAlertLists(metrics) {
    let alertsContainer = document.getElementById('dashboard-alert-lists');
    
    if (!alertsContainer) {
        alertsContainer = document.createElement('div');
        alertsContainer.id = 'dashboard-alert-lists';
        alertsContainer.className = "grid grid-cols-1 md:grid-cols-2 gap-6 mb-8";
        
        const welcomeCard = DOM.dashboard.planName?.closest('.rounded-xl') || document.querySelector('#dashboard > div.rounded-xl');
        if (welcomeCard && welcomeCard.nextSibling) DOM.dashboard.grid.parentNode.insertBefore(alertsContainer, welcomeCard.nextSibling);
        else if (welcomeCard) DOM.dashboard.grid.parentNode.appendChild(alertsContainer);
    }

    const expiredList = metrics.expiredList || [];
    let expiredHtml = expiredList.length > 0 
        ? expiredList.map(p => `<li class="flex justify-between items-center py-2 border-b last:border-0 border-red-100"><span class="text-sm font-medium text-red-800 truncate w-2/3">${escapeHTML(p.name)}</span><span class="text-xs font-bold text-red-600 bg-red-100 px-2 py-1 rounded">Exp: ${escapeHTML(p.value || p.expiry || '')}</span></li>`).join('') 
        : `<li class="text-sm text-green-600 italic py-2 flex items-center"><svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> No expired products.</li>`;

    const lowStockList = metrics.lowStockList || [];
    let lowStockHtml = lowStockList.length > 0 
        ? lowStockList.map(p => {
            const type = p.type || (p.status === 'Out' ? 'out' : 'low');
            const val = p.value !== undefined ? p.value : (p.stock || 0);
            return `<li class="flex justify-between items-center py-2 border-b last:border-0 border-yellow-100"><span class="text-sm font-medium text-yellow-800 truncate w-2/3">${escapeHTML(p.name)}</span><span class="text-xs font-bold ${type === 'out' ? 'text-red-600 bg-red-100' : 'text-yellow-700 bg-yellow-100'} px-2 py-1 rounded">${type === 'out' ? 'Out of Stock' : `Stock: ${escapeHTML(val)}`}</span></li>`;
        }).join('') 
        : `<li class="text-sm text-green-600 italic py-2 flex items-center"><svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Healthy stock levels.</li>`;

    alertsContainer.innerHTML = `
        <div class="bg-white rounded-xl shadow-md border-l-4 border-red-500 overflow-hidden">
            <div class="bg-red-50 px-4 py-3 border-b border-red-100 flex justify-between items-center">
                <h3 class="font-bold text-red-800 flex items-center gap-2">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                    Expired Products
                </h3>
                <span class="bg-white text-red-600 text-xs font-bold px-2 py-1 rounded shadow-sm">${expiredList.length}</span>
            </div>
            <ul class="p-4 max-h-48 overflow-y-auto scrollbar-hide">${expiredHtml}</ul>
        </div>
        <div class="bg-white rounded-xl shadow-md border-l-4 border-yellow-500 overflow-hidden">
            <div class="bg-yellow-50 px-4 py-3 border-b border-yellow-100 flex justify-between items-center">
                <h3 class="font-bold text-yellow-800 flex items-center gap-2">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"></path></svg>
                    Low Stock Alerts
                </h3>
                <span class="bg-white text-yellow-600 text-xs font-bold px-2 py-1 rounded shadow-sm">${lowStockList.length}</span>
            </div>
            <ul class="p-4 max-h-48 overflow-y-auto scrollbar-hide">${lowStockHtml}</ul>
        </div>`;
}

async function renderAnalyticsWidgets(metrics) {
    // Determine which widgets to show based on standard layout
    const activeWidgets = [
        'revenueToday',         
        'purchasesToday',       
        'stockValueAtRisk',  
        'inventoryForecast',   
        'availableStaff',       
        'totalTransactionsToday',
        'salesChart', 
        'fastMovingItems' // 🚀 The new Top Grossing Widget
    ];
    
    const fragment = document.createDocumentFragment();
    const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';

    activeWidgets.forEach(widgetId => {
        const widgetMeta = MASTER_WIDGET_LIST.find(w => w.id === widgetId) || { id: widgetId, colSpan: 'lg:col-span-1', rowSpan: 'lg:row-span-1' };

        const colSpan = widgetMeta.colSpan || 'lg:col-span-1';
        const rowSpan = widgetMeta.rowSpan || 'lg:row-span-1';
        
        const widgetEl = document.createElement('div');
        widgetEl.className = `widget-card bg-white p-6 rounded-3xl shadow-xl border border-slate-100 ${colSpan} ${rowSpan} hover:shadow-2xl transition-shadow duration-200 relative group cursor-pointer overflow-hidden`;
        widgetEl.dataset.widget = widgetId; 
        
        // Use the custom render function if the widget provides one
        if (typeof widgetMeta.render === 'function') {
            widgetEl.innerHTML = widgetMeta.render(metrics, currency);
        } else if (typeof renderWidgetById === 'function') {
            widgetEl.innerHTML = renderWidgetById(widgetId, metrics);
        }
        
        fragment.appendChild(widgetEl);
        
        // Bind the canvas chart if this is the sales trend widget
        if (widgetId === 'salesChart') {
            const canvas = widgetEl.querySelector('.dynamic-chart-canvas');
            if (canvas) setTimeout(() => { renderChartToCanvas(canvas, metrics.salesChartData); }, 0);
        }
    });
    
    DOM.dashboard.grid.appendChild(fragment); 
}





// ============================================================================
// 🚀 ELECTRON AUTO-UPDATER UI
// ============================================================================

// if (window.electronAPI) {
//     window.electronAPI.on('updater-event', (eventName, data) => {
        
//         // PHASE 1: Update is available to download
//         if (eventName === 'update-available') {
//             const version = data.version;
//             const releaseNotesHTML = data.releaseNotes || "<p class='text-sm text-gray-500'>General bug fixes and performance improvements.</p>";
//             showUpdateAvailableModal(version, releaseNotesHTML);
//         }

//         // PHASE 2: Download finished! Don't force restart, just let them know.
//         if (eventName === 'update-downloaded') {
            
//             // Remove the previous "Downloading..." modal if it's still there
//             const oldModal = document.getElementById('update-available-modal');
//             if (oldModal) oldModal.remove();

//             // Create a friendly, dismissible "Ready" modal
//             const readyHtml = `
//                 <div id="update-ready-modal" class="fixed inset-0 bg-gray-900 bg-opacity-60 z-[70] flex items-center justify-center transition-opacity opacity-0">
//                     <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden transform scale-95 transition-transform">
                        
//                         <div class="px-6 py-4 border-b bg-green-50 flex items-center gap-3">
//                             <div class="p-2 bg-green-100 rounded-full text-green-600">
//                                 <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
//                             </div>
//                             <div>
//                                 <h3 class="text-lg font-bold text-green-900">Update Ready!</h3>
//                                 <p class="text-xs text-green-600 font-medium">The new version has been downloaded safely.</p>
//                             </div>
//                         </div>

//                         <div class="p-6 bg-white">
//                             <p class="text-sm text-gray-700 mb-4 font-medium">
//                                 The update is waiting in the background. It will be installed automatically the next time you close and reopen Mifela.
//                             </p>
//                             <p class="text-sm text-gray-500">
//                                 You can continue working safely, or restart the app now to apply the new features immediately.
//                             </p>
//                         </div>

//                         <div class="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
//                             <button id="btn-later-update" class="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">Apply Later</button>
//                             <button id="btn-restart-now" class="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-lg shadow-sm transition-colors flex items-center gap-2">
//                                 Restart App Now
//                             </button>
//                         </div>

//                     </div>
//                 </div>
//             `;
//             document.body.insertAdjacentHTML('beforeend', readyHtml);

//             const readyModal = document.getElementById('update-ready-modal');
            
//             // Animate In
//             readyModal.classList.remove('hidden');
//             setTimeout(() => {
//                 readyModal.classList.remove('opacity-0');
//                 readyModal.querySelector('div').classList.remove('scale-95');
//                 readyModal.querySelector('div').classList.add('scale-100');
//             }, 10);

//             // 🚀 If they click "Apply Later", just close the window and let them work!
//             document.getElementById('btn-later-update').onclick = () => {
//                 readyModal.remove();
//             };

//             // 🚀 If they actually want to restart now, trigger the backend manually!
//             document.getElementById('btn-restart-now').onclick = () => {
//                 const btn = document.getElementById('btn-restart-now');
//                 btn.innerHTML = `<div class="animate-spin h-4 w-4 border-2 border-white rounded-full border-t-transparent"></div> Restarting...`;
//                 btn.disabled = true;
//                 window.electronAPI.installUpdateNow();
//             };
//         }
//     });
// }

// function showUpdateAvailableModal(version, notesHTML) {
//     const modalId = 'update-available-modal';
//     if (document.getElementById(modalId)) document.getElementById(modalId).remove();

//     const html = `
//         <div id="${modalId}" class="fixed inset-0 bg-gray-900 bg-opacity-60 flex items-center justify-center z-[80] transition-opacity opacity-0">
//             <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden transform scale-95 transition-transform">
//                 <div class="px-6 py-4 border-b bg-indigo-50 flex items-center gap-3">
//                     <div class="p-2 bg-indigo-100 rounded-full text-indigo-600 animate-pulse">
//                         <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
//                     </div>
//                     <div>
//                         <h3 class="text-lg font-bold text-indigo-900">Update Available!</h3>
//                         <p class="text-xs text-indigo-600 font-medium">Version ${version} is ready to download.</p>
//                     </div>
//                 </div>
//                 <div class="p-6 bg-white">
//                     <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Release Notes</h4>
//                     <div class="max-h-40 overflow-y-auto custom-scrollbar pr-2 text-sm text-gray-700 prose prose-sm prose-indigo border-b border-gray-100 pb-4 mb-4">
//                         ${notesHTML}
//                     </div>
//                     <div class="flex items-start gap-2 text-xs text-indigo-700 bg-indigo-50 p-3 rounded-lg border border-indigo-100">
//                         <svg class="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
//                         <p><strong>Non-disruptive update:</strong> Downloading will not interrupt your work. It is processing in the background.</p>
//                     </div>
//                 </div>
//                 <div class="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
//                     <button id="btn-skip-update" class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg shadow-sm transition-colors">Understood</button>
//                 </div>
//             </div>
//         </div>
//     `;
    
//     document.body.insertAdjacentHTML('beforeend', html);
//     const modal = document.getElementById(modalId);

//     setTimeout(() => {
//         modal.classList.remove('opacity-0');
//         modal.querySelector('div').classList.remove('scale-95');
//     }, 10);

//     document.getElementById('btn-skip-update').onclick = () => {
//         modal.classList.add('opacity-0');
//         setTimeout(() => modal.remove(), 200);
//     };
// }
// --- CHEQUE REVIEW SYSTEM (WITH INCOMING/OUTGOING LOGIC) ---

window.openChequeReview = async function(type = 'INCOMING') {
    const modal = document.getElementById('cheque-review-modal');
    const tbody = document.getElementById('cheque-table-body');
    if (!modal || !tbody) return;

    const tabIn = document.getElementById('cheque-tab-incoming');
    const tabOut = document.getElementById('cheque-tab-outgoing');
    if (tabIn && tabOut) {
        if (type === 'INCOMING') {
            tabIn.className = "px-6 py-2.5 text-sm font-bold rounded-lg bg-green-50 text-green-700 transition-all shadow-sm flex items-center gap-2";
            tabOut.className = "px-6 py-2.5 text-sm font-medium rounded-lg bg-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2";
        } else {
            tabOut.className = "px-6 py-2.5 text-sm font-bold rounded-lg bg-orange-50 text-orange-700 transition-all shadow-sm flex items-center gap-2";
            tabIn.className = "px-6 py-2.5 text-sm font-medium rounded-lg bg-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2";
        }
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-16 text-gray-400 font-medium animate-pulse">Scanning database for pending cheques...</td></tr>`;

    try {
        // 🚀 THE FIX: Use local SQLite instead of Firebase
        let allPendingCheques = [];
        if (window.dbAPI && window.dbAPI.getPendingCheques) {
            allPendingCheques = await window.dbAPI.getPendingCheques();
        }

        let pendingCheques = [];
        
        allPendingCheques.forEach(data => {
            const txType = (data.type || '').toUpperCase();
            const isIncoming = txType === 'SALE' || txType === 'REFUND_RECEIVED' || txType === 'PAYMENT_RECEIVED';
            const isOutgoing = txType === 'PURCHASE' || txType === 'EXPENSE' || txType === 'REFUND' || txType === 'PAYMENT_MADE';

            if (type === 'INCOMING' && isIncoming) pendingCheques.push(data);
            else if (type === 'OUTGOING' && isOutgoing) pendingCheques.push(data);
        });

        pendingCheques.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (pendingCheques.length === 0) {
            const msg = type === 'INCOMING' ? 'No pending incoming cheques from customers!' : 'No pending outgoing cheques to suppliers!';
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="p-0">
                        <div class="flex flex-col items-center justify-center h-64 w-full bg-white">
                            <div class="bg-gray-50 h-16 w-16 flex items-center justify-center rounded-full text-3xl shadow-sm border border-gray-100 mb-3">🎉</div>
                            <span class="font-bold text-gray-500 text-sm tracking-wide">${msg}</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';
        
        tbody.innerHTML = pendingCheques.map(tx => {
            const partyName = tx.customer?.name || (type === 'INCOMING' ? 'Walk-in Customer' : 'General Supplier');
            const badgeColor = type === 'INCOMING' ? 'text-green-700 bg-green-50 border-green-200' : 'text-orange-700 bg-orange-50 border-orange-200';
            const badgeText = type === 'INCOMING' ? 'RECEIVABLE' : 'PAYABLE';
            
            return `
            <tr class="hover:bg-slate-50 transition-colors group">
                <td class="px-6 py-5 whitespace-nowrap">
                    <div class="text-sm font-bold text-slate-700">${new Date(tx.timestamp).toLocaleDateString()}</div>
                    <div class="text-[10px] text-indigo-400 font-bold tracking-wider uppercase mt-1">#${tx.invoiceId}</div>
                </td>
                <td class="px-6 py-5">
                    <div class="text-base font-black text-slate-800">${escapeHTML(partyName)}</div>
                    <div class="mt-1.5 inline-flex items-center text-[9px] font-black px-2 py-0.5 rounded border uppercase tracking-widest ${badgeColor}">${badgeText}</div>
                </td>
                <td class="px-6 py-5">
                    <div class="text-sm font-bold text-slate-700 flex items-center gap-2">🏦 ${escapeHTML(tx.summary.chequeDetails.bank)}</div>
                    <div class="text-xs text-slate-500 font-mono mt-1 px-2 py-0.5 bg-gray-100 rounded w-fit">No: ${escapeHTML(tx.summary.chequeDetails.chequeNo)}</div>
                    <div class="text-xs text-amber-600 font-bold mt-1.5 flex items-center gap-1">⏱️ Clear by: ${tx.summary.chequeDetails.clearanceDate}</div>
                </td>
                <td class="px-6 py-5 text-right whitespace-nowrap">
                    <div class="text-xl font-black text-slate-800">${currency}${Math.abs(tx.summary.total).toFixed(2)}</div>
                </td>
                <td class="px-6 py-5 text-center whitespace-nowrap">
                    <div class="flex items-center justify-center gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button onclick="window.updateChequeStatus('${tx.id}', 'CLEARED', '${type}')" class="px-4 py-2 bg-green-500 text-white hover:bg-green-600 font-black rounded-xl text-xs uppercase tracking-wider transition-transform active:scale-95 shadow-md shadow-green-200">Pass</button>
                        <button onclick="window.updateChequeStatus('${tx.id}', 'BOUNCED', '${type}')" class="px-4 py-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 font-bold rounded-xl text-xs uppercase tracking-wider transition-transform active:scale-95">Bounce</button>
                    </div>
                </td>
            </tr>
        `}).join('');

    } catch (error) {
        console.error("Error fetching cheques:", error);
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-red-500 font-bold">Failed to load cheques. See console.</td></tr>`;
    }
};

window.updateChequeStatus = async function(txId, newStatus, currentTab) {
    if (!confirm(`Are you sure you want to mark this cheque as ${newStatus}?`)) return;

    try {
        // 🚀 THE FIX: Use offline SQLite API instead of updateDoc
        if (window.dbAPI && window.dbAPI.updateChequeStatus) {
            await window.dbAPI.updateChequeStatus(txId, newStatus, new Date().toISOString());
        }

        if (typeof showToast === 'function') {
            showToast("Updated", `Cheque marked as ${newStatus}`, newStatus === 'CLEARED' ? "success" : "error");
        } else {
            alert(`Cheque successfully marked as ${newStatus}`);
        }
        
        window.openChequeReview(currentTab); 
    } catch (error) {
        console.error("Error updating cheque:", error);
        alert("Failed to update cheque status.");
    }
};
document.addEventListener('input', async (e) => {
    const target = e.target;
    
    // Check if the user is typing into an IFSC field
    if (target.id === 'cust-form-ifsc' || target.id === 'staff-ifsc') {
        const ifscCode = target.value.trim().toUpperCase();
        target.value = ifscCode; // Auto-capitalize as they type
        
        // Standard Indian IFSC codes are exactly 11 characters
        if (ifscCode.length === 11) {
            target.classList.add('animate-pulse', 'border-indigo-400', 'bg-indigo-50');
            
            try {
                // Free, open API for IFSC lookups
                const response = await fetch(`https://ifsc.razorpay.com/${ifscCode}`);
                if (response.ok) {
                    const data = await response.json();
                    
                    // Route the data based on which form is currently open
                    if (target.id === 'cust-form-ifsc') {
                        const bankInput = document.getElementById('cust-form-bank-name');
                        const branchInput = document.getElementById('cust-form-branch');
                        
                        if (bankInput) { 
                            bankInput.value = data.BANK; 
                            bankInput.classList.add('bg-green-50', 'border-green-300', 'text-green-800'); 
                        }
                        if (branchInput) { 
                            branchInput.value = data.BRANCH; 
                            branchInput.classList.add('bg-green-50', 'border-green-300', 'text-green-800'); 
                        }
                    } else if (target.id === 'staff-ifsc') {
                        const bankInput = document.getElementById('staff-bank-name');
                        if (bankInput) { 
                            // Combine Bank and Branch for the single Staff field
                            bankInput.value = `${data.BANK} - ${data.BRANCH}`; 
                            bankInput.classList.add('bg-green-50', 'border-green-300', 'text-green-800'); 
                        }
                    }
                    
                    // Flash the IFSC field green to indicate success
                    target.classList.remove('animate-pulse', 'border-indigo-400', 'bg-indigo-50');
                    target.classList.add('border-green-500', 'bg-green-50');
                    
                    // Clean up colors after 2 seconds
                    setTimeout(() => {
                        target.classList.remove('border-green-500', 'bg-green-50');
                        document.querySelectorAll('#cust-form-bank-name, #cust-form-branch, #staff-bank-name').forEach(i => {
                            i.classList.remove('bg-green-50', 'border-green-300', 'text-green-800');
                        });
                    }, 2500);
                } else {
                    // API returned 404 (Invalid IFSC)
                    target.classList.remove('animate-pulse', 'border-indigo-400', 'bg-indigo-50');
                    target.classList.add('border-red-500', 'bg-red-50');
                    setTimeout(() => target.classList.remove('border-red-500', 'bg-red-50'), 2500);
                }
            } catch (error) {
                console.error("IFSC Fetch failed:", error);
                target.classList.remove('animate-pulse', 'border-indigo-400', 'bg-indigo-50');
            }
        }
    }
});