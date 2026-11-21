// src/components/staff.js



import { DOM, showModal } from '../utils/dom.js';

import { 
    getStoreId, 
    CURRENT_CURRENCY_SYMBOL, appId, 
    getUserId, getUserRole, 
    getAvailableLocations, getUserAssignedLocationId,
    getCurrentUserPlan, PLAN_LIMITS, AppState 
} from '../store/state.js';
import { safeMath } from '../utils/math.js';
import { escapeHTML } from '../utils/security.js';

// --- Safe ID Getter to prevent Race Conditions ---
const safeAppId = () => (typeof window !== 'undefined' && window.__app_id) ? window.__app_id : appId;

// --- Helper: Normalize Plan ---
function normalizePlan(planString) {
    if (!planString) return 'free';
    const plan = planString.toLowerCase();
    if (plan === 'standard') return 'silver';
    if (plan === 'premium') return 'platinum'; 
    return plan;
}

// --- State ---
let localStaffCache = [];
let localShiftsCache = [];
let selectedStaffForPayroll = null;
let isStaffInitialized = false;
let searchDebounceTimer = null;
let currentPayrollFreq = 'Monthly'; 
let currentStaffLocationFilter = 'all'; 
let currentAttLocationFilter = 'all'; 
let currentAttendanceMonth = new Date(); 

// --- Helper Functions ---

function to12Hour(time) {
    if (!time) return '';
    let [h, m] = time.split(':');
    let ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    h = h ? h : 12; 
    return `${h}:${m} ${ampm}`;
}
function checkPlanLimits(plan, feature) {
    // Offline POS systems operate as a single local node, so multi-location is false
    if (feature === 'multi_location') return false; 
    
    // Unlock everything else natively (like Payroll, Advanced Reports)
    return true; 
}
function updateStaffDatalist() {
    const list = document.getElementById('staff-search-list');
    if (!list) return;

    list.innerHTML = '';
    const frag = document.createDocumentFragment();
    localStaffCache.forEach(s => { 
        if(s.name) {
            const opt = document.createElement('option'); 
            opt.value = s.name; 
            frag.appendChild(opt); 
        }
    });
    list.appendChild(frag);
}
export async function toggleAttendanceStatus(staffId, dateStr, currentStatus) {
    if (!staffId || !dateStr) return;
    
    // Cycle logic: Absent (A) -> Present (P) -> Half Day (HD) -> Absent (A)
    let newStatus = 'P'; 
    if (currentStatus === 'P') newStatus = 'HD';
    else if (currentStatus === 'HD') newStatus = 'A';
    else if (currentStatus === 'A') newStatus = 'P';

    const monthStr = dateStr.substring(0, 7);
    
    try {
        // 1. Save to SQLite (if API is available)
        if (window.dbAPI && typeof window.dbAPI.saveAttendance === 'function') {
            await window.dbAPI.saveAttendance({ staffId, date: dateStr, status: newStatus });
        }

        // 2. Save to LocalStorage Monthly Grid (For the staff.js UI)
        const monthKey = `mifela_staff_attendance_${monthStr}`;
        const monthAtt = JSON.parse(localStorage.getItem(monthKey) || '{}');
        if (!monthAtt[staffId]) monthAtt[staffId] = {};
        monthAtt[staffId][dateStr] = newStatus;
        localStorage.setItem(monthKey, JSON.stringify(monthAtt));

        // 3. Save to LocalStorage Daily Fallback (For the dashboard UI)
        const dayKey = `mifela_attendance_${dateStr}`;
        const dayAtt = JSON.parse(localStorage.getItem(dayKey) || '{}');
        if (!dayAtt[staffId]) dayAtt[staffId] = {};
        dayAtt[staffId].status = newStatus;
        localStorage.setItem(dayKey, JSON.stringify(dayAtt));

        // 🚀 THE FIX: Announce to the Dashboard that attendance just changed!
        if (typeof AppState !== 'undefined') {
            AppState.notify('attendance_updated');
        }

        return newStatus;
    } catch (error) {
        console.error("Failed to save attendance locally:", error);
        throw error;
    }
}

export async function markAllVisiblePresent(dateStr, visibleStaffIds) {
    if (!dateStr || !visibleStaffIds || visibleStaffIds.length === 0) return;
    
    const monthStr = dateStr.substring(0, 7);
    
    try {
        const monthKey = `mifela_staff_attendance_${monthStr}`;
        const monthAtt = JSON.parse(localStorage.getItem(monthKey) || '{}');
        
        const dayKey = `mifela_attendance_${dateStr}`;
        const dayAtt = JSON.parse(localStorage.getItem(dayKey) || '{}');

        const promises = [];

        visibleStaffIds.forEach(staffId => {
            // SQLite
            if (window.dbAPI && typeof window.dbAPI.saveAttendance === 'function') {
                promises.push(window.dbAPI.saveAttendance({ staffId, date: dateStr, status: 'P' }));
            }

            // LocalStorage Update
            if (!monthAtt[staffId]) monthAtt[staffId] = {};
            monthAtt[staffId][dateStr] = 'P';

            if (!dayAtt[staffId]) dayAtt[staffId] = {};
            dayAtt[staffId].status = 'P';
        });

        if (promises.length > 0) await Promise.all(promises);

        // Commit all changes to local memory
        localStorage.setItem(monthKey, JSON.stringify(monthAtt));
        localStorage.setItem(dayKey, JSON.stringify(dayAtt));

        // 🚀 THE FIX: Announce the bulk update to the Dashboard
        if (typeof AppState !== 'undefined') {
            AppState.notify('attendance_updated');
        }
        
        return true;
    } catch (error) {
        console.error("Failed to mark all present:", error);
        throw error;
    }
}
export async function loadAttendanceForMonth(year, month) {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    try {
        // 1. Try SQLite First
        if (window.dbAPI && typeof window.dbAPI.getMonthlyAttendance === 'function') {
            const dbAtt = await window.dbAPI.getMonthlyAttendance(monthStr);
            if (dbAtt && Object.keys(dbAtt).length > 0) return dbAtt;
        }
        
        // 2. Fallback to LocalStorage
        return JSON.parse(localStorage.getItem(`mifela_staff_attendance_${monthStr}`) || '{}');
    } catch (error) {
        console.error("Failed to load attendance offline:", error);
        return {};
    }
}
function updateShiftDropdown() {
    const select = document.getElementById('staff-shift');
    if (select) {
        const currentVal = select.value;
        select.innerHTML = '<option value="">No Shift Assigned</option>';
        
        localShiftsCache.forEach(shift => {
            const opt = document.createElement('option');
            opt.value = shift.id;
            opt.textContent = `${escapeHTML(shift.name)} (${to12Hour(shift.start)} - ${to12Hour(shift.end)})`;
            select.appendChild(opt);
        });
        
        if (currentVal) select.value = currentVal;
    }
}

function ensureConfirmPasswordInput() {
    const pwInput = document.getElementById('staff-password');
    if (pwInput && !document.getElementById('staff-password-confirm')) {
        const div = document.createElement('div');
        div.className = "mt-4"; 
        div.innerHTML = `
            <label class="block text-xs font-bold text-orange-800 mb-1.5 uppercase tracking-wide">Confirm Password</label>
            <input type="password" id="staff-password-confirm" class="w-full text-sm rounded-lg border-orange-200 shadow-sm p-2.5 border focus:ring-orange-500 focus:border-orange-500 bg-white transition-all" placeholder="Re-enter password">
        `;
        pwInput.parentNode.insertAdjacentElement('afterend', div);
    }
}

function injectStaffControls() {
    const tableBody = document.getElementById('staff-table-body');
    if (!tableBody) return;
    if (document.getElementById('staff-controls-row')) return;

    const controlsHtml = `
        <div id="staff-controls-row" class="mb-6 relative z-10 bg-white border border-gray-100 shadow-sm py-4 px-4 rounded-xl">
            <div class="flex flex-col md:flex-row justify-between items-center gap-4">
                <div class="relative w-full md:max-w-md group">
                    <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                        <svg class="h-5 w-5 text-gray-400 group-focus-within:text-indigo-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                        </svg>
                    </div>
                    <input type="text" id="staff-search-input-dynamic" 
                        class="block w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all" 
                        placeholder="Search staff...">
                </div>

                <div class="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-1 md:pb-0 no-scrollbar">
                    <div class="relative min-w-[180px]">
                        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"></path>
                            </svg>
                        </div>
                        <select id="staff-sort-dynamic" 
                            class="block w-full pl-9 pr-8 py-2.5 text-sm border-gray-200 rounded-lg bg-gray-50 text-gray-600 focus:outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer appearance-none hover:border-gray-300 transition-colors">
                            <option value="name_asc">Name (A-Z)</option>
                            <option value="name_desc">Name (Z-A)</option>
                            <option value="role_wise">Role Priority</option>
                            <option value="join_date_new">Joined (Newest)</option>
                            <option value="payment_due">Payment Due</option>
                            <option value="balance_due">Unpaid Balance</option>
                        </select>
                        <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    if (tableBody.parentNode) {
        tableBody.insertAdjacentHTML('beforebegin', controlsHtml);
    }

    const searchEl = document.getElementById('staff-search-input-dynamic');
    const sortEl = document.getElementById('staff-sort-dynamic');

    if (searchEl) {
        searchEl.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(renderStaffTable, 300);
        });
    }

    if (sortEl) {
        sortEl.addEventListener('change', renderStaffTable);
    }
}

function getRoleColor(role) {
    if (!role) return 'bg-gray-100 text-gray-600 border-gray-200';
    switch (role) {
        case 'admin': return 'bg-purple-100 text-purple-700 border-purple-200 ring-purple-500/20';
        case 'store_manager': return 'bg-blue-100 text-blue-700 border-blue-200 ring-blue-500/20';
        case 'cashier': return 'bg-emerald-100 text-emerald-700 border-emerald-200 ring-emerald-500/20';
        case 'accountant': return 'bg-amber-100 text-amber-700 border-amber-200 ring-amber-500/20';
        case 'helpers': return 'bg-gray-200 text-gray-700 border-gray-300 ring-gray-500/20'; 
        default: return 'bg-gray-100 text-gray-600 border-gray-200 ring-gray-500/10';
    }
}

function renderStaffSummary() {
    const overdueEl = document.getElementById('stats-total-overdue');
    const paidEl = document.getElementById('stats-paid-month');
    
    if (!overdueEl || !paidEl) return;
    
    const container = document.getElementById('staff-summary-stats');
    if(container) container.classList.remove('hidden');
    
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    let totalPaidThisMonth = 0;
    let overdueCount = 0;

    localStaffCache.forEach(staff => {
        if (staff.paymentHistory) {
            staff.paymentHistory.forEach(pay => {
                const payDate = new Date(pay.date);
                if (payDate >= startOfMonth) totalPaidThisMonth = safeMath.add(totalPaidThisMonth, pay.amount || 0);
            });
        }
        if (staff.balance < 0) overdueCount++;
    });
    
    overdueEl.textContent = `${overdueCount} Staff`;
    paidEl.textContent = `${CURRENT_CURRENCY_SYMBOL}${totalPaidThisMonth.toFixed(2)}`;
}

function renderStaffTable() {
    const tableBody = document.getElementById('staff-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    tableBody.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-32"; 

    const searchEl = document.getElementById('staff-search-input-dynamic');
    const sortEl = document.getElementById('staff-sort-dynamic');

    const searchTerm = searchEl ? (searchEl.value || '').toLowerCase() : '';
    const sortValue = sortEl ? (sortEl.value || 'name_asc') : 'name_asc'; 
    
    const plan = normalizePlan(typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free');
    const hasMultiLoc = checkPlanLimits(plan, 'multi_location');
    const currentRole = typeof getUserRole === 'function' ? getUserRole() : 'cashier';
    const assignedLoc = typeof getUserAssignedLocationId === 'function' ? getUserAssignedLocationId() : 'main';
    const uid = typeof getUserId === 'function' ? getUserId() : '';
    const availLocs = typeof getAvailableLocations === 'function' ? getAvailableLocations() : [];

    let filtered = localStaffCache.filter(s => {
        const matchesSearch = (s.name || '').toLowerCase().includes(searchTerm) || 
                              (s.email || '').toLowerCase().includes(searchTerm) || 
                              (s.role || '').toLowerCase().includes(searchTerm);
        
        let matchesLoc = true;
        if (currentRole === 'admin') {
            if (hasMultiLoc && currentStaffLocationFilter !== 'all') {
                matchesLoc = (s.assignedLocationId === currentStaffLocationFilter) || (s.role === 'admin');
            }
        } else {
            matchesLoc = (s.assignedLocationId === assignedLoc) || (s.role === 'admin');
        }
        
        return matchesSearch && matchesLoc;
    });

    // Sort
    filtered.sort((a, b) => {
        const nameA = a.name || '';
        const nameB = b.name || '';
        const roleA = a.role || '';
        const roleB = b.role || '';

        // Force Admin to top
        if (roleA === 'admin' && roleB !== 'admin') return -1;
        if (roleB === 'admin' && roleA !== 'admin') return 1;

        switch (sortValue) {
            case 'name_asc': return nameA.localeCompare(nameB);
            case 'name_desc': return nameB.localeCompare(nameA);
            case 'role': 
            case 'role_wise': return roleA.localeCompare(roleB);
            case 'join_date_new': return new Date(b.joiningDate || 0) - new Date(a.joiningDate || 0);
            case 'join_date_old': return new Date(a.joiningDate || 0) - new Date(b.joiningDate || 0);
            case 'payment_due':
                const dateA = a.nextPaymentDate ? new Date(a.nextPaymentDate) : new Date(9999, 11, 31);
                const dateB = b.nextPaymentDate ? new Date(b.nextPaymentDate) : new Date(9999, 11, 31);
                return dateA - dateB;
            case 'balance_due': return (b.balance || 0) - (a.balance || 0);
            case 'balance_advance': return (a.balance || 0) - (b.balance || 0);
            default: return 0;
        }
    });

    renderStaffSummary();

    const copyrightHtml = `
        <div class="col-span-full mt-12 py-10 text-center border-t border-gray-100 opacity-60">
            <div class="flex flex-col items-center gap-2">
                <p class="text-[10px] font-bold text-gray-400 tracking-[0.3em] uppercase">Mifela Inventory Management</p>
                <p class="text-[11px] text-gray-500 font-medium">© 2026 All Rights Reserved</p>
            </div>
        </div>
    `;

    if (filtered.length === 0) { 
        tableBody.className = "block w-full"; 
        tableBody.innerHTML = `
            <div class="col-span-full py-16 text-center text-gray-500 bg-white border border-dashed border-gray-200 rounded-2xl mb-8 shadow-sm">
                <div class="flex flex-col items-center gap-3">
                    <div class="p-3 bg-gray-50 rounded-full">
                        <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                    </div>
                    <p class="font-medium text-gray-600">No staff members found matching your search.</p>
                    <button onclick="document.getElementById('staff-search-input-dynamic').value = ''; window.renderStaffTable();" class="text-sm text-indigo-600 font-bold hover:underline">Clear Filters</button>
                </div>
            </div>
            ${copyrightHtml}
        `; 
        return; 
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach(staff => {
        const safeName = escapeHTML(staff.name || 'Unknown Staff');
        const safeRole = staff.role || 'staff';
        const safeInitial = safeName.charAt(0).toUpperCase();
        
        const roleColor = getRoleColor(safeRole);
        const lastPaid = staff.lastPaymentDate ? new Date(staff.lastPaymentDate).toLocaleDateString() : 'Never';
        const balance = staff.balance || 0;
        
        const balanceClass = balance < 0 ? 'text-red-600 font-bold' : (balance > 0 ? 'text-emerald-600 font-bold' : 'text-gray-400');
        const balanceText = balance === 0 ? '-' : `${CURRENT_CURRENCY_SYMBOL}${Math.abs(balance).toFixed(2)}`;

        let locName = staff.assignedStoreName;
        if (!locName) {
            locName = availLocs.find(l => l.id === staff.assignedLocationId)?.name || 'Main Store';
        }
        
        const locBadge = `<span class="inline-flex items-center gap-1 text-[10px] font-semibold bg-gray-100 text-gray-600 px-2 py-1 rounded-md border border-gray-200">
            <svg class="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
            ${escapeHTML(locName)}
        </span>`;

        let nextDueDateStr = 'N/A';
        if (staff.nextPaymentDate) {
             nextDueDateStr = new Date(staff.nextPaymentDate).toLocaleDateString();
        } else if (staff.lastPaymentDate) {
            const lastDate = new Date(staff.lastPaymentDate);
            const freq = staff.jobDetails?.salaryFreq || 'Monthly';
            let nextDate = new Date(lastDate);
            if (freq === 'Monthly' || freq === 'DailyMonthly') nextDate.setMonth(nextDate.getMonth() + 1);
            else if (freq === 'Weekly') nextDate.setDate(nextDate.getDate() + 7);
            else if (freq === 'Daily') nextDate.setDate(nextDate.getDate() + 1);
            nextDueDateStr = nextDate.toLocaleDateString();
        } else if (staff.joiningDate) {
             const join = new Date(staff.joiningDate);
             join.setMonth(join.getMonth() + 1);
             nextDueDateStr = join.toLocaleDateString();
        }

        const card = document.createElement('div');
        card.className = "bg-white rounded-2xl border border-gray-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)] hover:-translate-y-1 transition-all duration-300 flex flex-col overflow-hidden group";
        
        const isAdminRow = safeRole === 'admin';
        const isSelf = staff.docId === uid; 
        
        let controlsHtml = '';
        if (!isAdminRow) {
            const editBtnClass = "text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50";
            const delBtnClass = "text-red-500 hover:text-red-700 hover:bg-red-50";
            const payBtnClass = "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow-md transform active:scale-95";
            
            controlsHtml = `
                <div class="p-4 grid grid-cols-5 gap-2 bg-white">
                    <button class="${payBtnClass} col-span-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1" data-action="pay" data-id="${staff.docId}">
                        Pay
                    </button>
                    <button class="col-span-1 py-2.5 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 border border-gray-200 rounded-xl transition-colors flex items-center justify-center ${editBtnClass}" data-action="edit" data-id="${staff.docId}" title="Edit">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    </button>
                    <button class="col-span-1 py-2.5 text-gray-500 hover:text-red-600 hover:bg-red-50 border border-gray-200 rounded-xl transition-colors flex items-center justify-center ${delBtnClass}" data-action="delete" data-id="${staff.docId}" data-name="${safeName}" title="Delete">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            `;
        } else {
            // Admin cards have no edit, delete, or permissions controls
            controlsHtml = `
                <div class="p-4 flex justify-center items-center bg-slate-50 text-xs font-bold text-slate-400 uppercase tracking-widest border-t border-slate-100">
                    System Administrator
                </div>
            `;
        }

        const dailyWorkHours = staff.jobDetails?.dailyWorkHours || 8; 
        const totalHoursWorked = (staff.totalHoursClocked || 0); 
        const equivalentDays = totalHoursWorked > 0 ? (totalHoursWorked / dailyWorkHours).toFixed(1) : 0;

        const savingsBal = parseFloat(staff.savingsBalance || 0);

        if (isAdminRow) {
            // 🚀 THE FIX: Exclusive, clean UI specifically for System Administrators
            card.innerHTML = `
                <div class="p-8 flex flex-col items-center text-center bg-gradient-to-b from-white to-slate-50 flex-1 relative overflow-hidden">
                    <!-- Decorative background element -->
                    <div class="absolute -top-10 -right-10 text-slate-100 opacity-50 transform rotate-12">
                        <svg class="w-40 h-40" fill="currentColor" viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
                    </div>

                    <div class="relative mb-6 z-10 mt-4">
                        <div class="w-28 h-28 rounded-full p-1.5 bg-white border-4 border-indigo-50 shadow-md transition-transform hover:scale-105">
                            <div class="w-full h-full rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-4xl font-black shadow-inner">
                                ${safeInitial}
                            </div>
                        </div>
                        <div class="absolute -bottom-2 -right-2 bg-white rounded-full p-1.5 shadow-sm">
                            <div class="bg-indigo-100 text-indigo-600 p-1.5 rounded-full">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                            </div>
                        </div>
                    </div>
                    
                    <h3 class="font-black text-slate-800 text-xl leading-tight mb-2 truncate w-full px-2 relative z-10" title="${safeName}">${safeName}</h3>
                    
                    <span class="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest bg-indigo-100 text-indigo-700 border border-indigo-200 mb-6 relative z-10 shadow-sm">
                        System Admin
                    </span>
                    
                    <div class="w-full mt-auto relative z-10">
                        <div class="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-center gap-4 shadow-sm">
                            <div class="text-emerald-500 bg-emerald-50 p-2.5 rounded-xl">
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                            </div>
                            <div class="text-left">
                                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Store Access</p>
                                <p class="text-sm font-black text-slate-700">Unrestricted</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Standard Staff Card for Cashiers, Helpers, Managers
            card.innerHTML = `
                <div class="p-6 flex flex-col items-center text-center pb-4">
                    <div class="relative mb-4">
                        <div class="w-24 h-24 rounded-full p-1 bg-white border-2 border-indigo-50 shadow-sm">
                            <div class="w-full h-full rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-3xl font-bold shadow-inner">
                                ${safeInitial}
                            </div>
                        </div>
                        <span class="absolute bottom-1 right-1 w-5 h-5 rounded-full border-2 border-white ${staff.status === 'Active' ? 'bg-emerald-500' : 'bg-gray-400'} shadow-sm" title="${staff.status}"></span>
                    </div>
                    
                    <h3 class="font-bold text-gray-900 text-lg leading-tight mb-1 truncate w-full px-2" title="${safeName}">${safeName}</h3>
                    <span class="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border mb-3 ${roleColor}">
                        ${safeRole.replace('_', ' ')}
                    </span>
                    <div class="mb-2">${locBadge}</div>
                </div>
                
                <div class="px-4 py-4 bg-gray-50/50 border-t border-b border-gray-100 flex-1">
                    <div class="grid grid-cols-2 gap-2 text-center divide-x divide-gray-200 mb-3">
                         <div class="px-1 flex flex-col justify-center">
                            <p class="text-[9px] text-gray-500 font-bold uppercase tracking-tighter mb-0.5">Loan/Adv</p>
                            <p class="${balanceClass} font-bold font-mono text-[11px] truncate" title="${balanceText}">${balanceText}</p>
                         </div>
                         <div class="px-1 flex flex-col justify-center">
                            <p class="text-[9px] text-purple-500 font-bold uppercase tracking-tighter mb-0.5">Savings</p>
                            <p class="text-purple-600 font-bold font-mono text-[11px] truncate" title="${CURRENT_CURRENCY_SYMBOL}${savingsBal.toFixed(2)}">${CURRENT_CURRENCY_SYMBOL}${savingsBal.toFixed(2)}</p>
                         </div>
                    </div>
                    
                    <div class="bg-white border border-gray-200 rounded-lg p-2 mb-3 shadow-sm flex justify-between items-center px-3">
                         <span class="text-[9px] text-gray-500 font-bold uppercase tracking-widest">Next Due</span>
                         <span class="text-gray-800 font-bold text-xs truncate" title="${nextDueDateStr}">${nextDueDateStr}</span>
                    </div>
                    
                    <div class="pt-3 border-t border-gray-200">
                        <p class="text-[9px] text-indigo-500 font-bold uppercase tracking-wider mb-1">Time Conversion (${dailyWorkHours}hr shift)</p>
                        <div class="flex justify-between items-center bg-white px-2 py-1.5 rounded-lg border border-gray-200 shadow-sm">
                            <span class="font-mono text-xs text-gray-500">${totalHoursWorked} hrs clocked</span>
                            <span class="font-bold text-xs text-indigo-600">≈ ${equivalentDays} Days</span>
                        </div>
                    </div>
                </div>

                <div class="px-6 py-4 bg-gray-50/50 border-b border-gray-100 flex-1">
                    <div class="grid grid-cols-2 gap-y-4 gap-x-2 text-sm">
                         <div>
                            <p class="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-0.5">Last Paid</p>
                            <p class="text-gray-700 text-xs font-bold">${lastPaid}</p>
                         </div>
                         <div class="text-right">
                            <p class="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-0.5">Status</p>
                            <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${staff.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}">
                                ${escapeHTML(staff.status || 'Active')}
                            </span>
                         </div>
                    </div>
                </div>
                ${controlsHtml}
            `;
        }
        
        fragment.appendChild(card);
    });
    

    const footerDiv = document.createElement('div');
    footerDiv.className = "col-span-full"; 
    footerDiv.innerHTML = copyrightHtml;
    fragment.appendChild(footerDiv);

    tableBody.appendChild(fragment);
}
// Expose for DOM inline clicks
window.renderStaffTable = renderStaffTable;

// --- Public Functions ---

export async function loadStaffList() {
    console.log("🚀 Staff Load Started (Offline Mode)");
    
    let activeStoreId = getStoreId();

    if (activeStoreId === 'main') {
        activeStoreId = `store_${typeof getUserId === 'function' ? getUserId() : ''}`;
    }

    const currentRole = typeof getUserRole === 'function' ? getUserRole() : 'cashier';

    // 🚀 THE FIX: Mock the hasMultiLoc var locally so UI injectors don't crash
    const plan = normalizePlan(typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free');
    const hasMultiLoc = false; 
    
    if (!activeStoreId) {
        console.warn("Store ID not ready, retrying...");
        setTimeout(loadStaffList, 500);
        return;
    }

    const tableBody = document.getElementById('staff-table-body');
    if (!tableBody) return;

    tableBody.className = "block w-full"; 
    tableBody.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center py-20 min-h-[400px]">
            <div class="relative mb-4">
                <div class="w-12 h-12 rounded-full border-4 border-indigo-100 border-t-indigo-600 animate-spin"></div>
            </div>
            <p class="text-sm font-semibold text-gray-600 animate-pulse">Loading Team Members locally...</p>
        </div>
    `;

    try {
        ensureHelperRoleOption(); 
        ensureAccountantRoleOption();
        injectAttendanceButton();
        injectShiftsButton();
        ensureConfirmPasswordInput(); 
        injectStaffControls(); 
        fixSalaryInputUI(); // 🚀 THE FIX: Repair the Salary HTML structure
        
        if (currentRole === 'admin') {
            injectStaffLocationSelector();
            injectStaffListLocationFilter(); 
        }
        injectDailyMonthlyOption();
        
        const locFilter = document.getElementById('att-location-filter');
        if (currentRole === 'admin' && locFilter && hasMultiLoc) {
            locFilter.classList.remove('hidden');
        } else if (locFilter) {
            locFilter.classList.add('hidden');
        }
    } catch (uiError) {
        console.warn("UI Injection Error:", uiError);
    }

    if (!isStaffInitialized) {
        setupStaffListeners();
        isStaffInitialized = true;
    }

    try {
        await loadShifts();

        localStaffCache = [];

        // 🚀 THE FIX: Load userProfiles from the SQLite database via API bridge
        let profiles = [];
        if (window.dbAPI && window.dbAPI.getCustomers) {
            const allProfiles = await window.dbAPI.getCustomers(); // Reuse the local JSON extractor
            profiles = allProfiles.filter(p => p.role); // Filter strictly for profiles that have roles
        }

        const docsMap = new Map();
        profiles.forEach(p => docsMap.set(p.docId || p.id, p));

        // 🚀 THE FIX: SQLite stores nested objects as strings. Parse them so jobDetails & banking work offline!
        localStaffCache = Array.from(docsMap.values()).map(data => {
            const safeParse = (obj, fallback) => {
                if (typeof obj === 'string') {
                    try { return JSON.parse(obj); } catch(e) { return fallback; }
                }
                return obj || fallback;
            };
            
            return { 
                ...data, 
                docId: data.id,
                jobDetails: safeParse(data.jobDetails, {}),
                banking: safeParse(data.banking, {}),
                permissions: safeParse(data.permissions, {}),
                paymentHistory: safeParse(data.paymentHistory, [])
            };
        });

    } catch (fetchError) {
        console.error("❌ Fetch Failed:", fetchError);
        showModal('Error', 'Could not load staff list. Check local database connection.', 'error');
        localStaffCache = []; 
    }
    
    try {
        updateStaffDatalist();
        updateShiftDropdown();
        renderStaffTable(); 
    } catch (renderError) {
        console.error("❌ Render Crashed:", renderError);
        if (document.getElementById('staff-table-body')) {
            document.getElementById('staff-table-body').innerHTML = `<div class="p-4 text-red-500">Render Error: ${renderError.message}</div>`;
        }
    }
}

async function loadShifts() {
    try {
        const activeStoreId = getStoreId();
        if (!activeStoreId) return;

        // 🚀 THE FIX: Safely route shift data requests directly to the SQLite 'customers' table for offline use
        // Note: For full architectural compliance, shifts would normally be inside a specific table. 
        // Here we map it dynamically for offline resilience.
        localShiftsCache = []; 
        if (window.dbAPI && window.dbAPI.getDoc) {
             const shiftsData = await window.dbAPI.getDoc('customers', `shifts_${activeStoreId}`);
             if (shiftsData && shiftsData.records) {
                 localShiftsCache = shiftsData.records;
             }
        }
    } catch (e) {
        console.error("Error loading shifts:", e);
    }
}

// --- UI Injectors ---

function ensureHelperRoleOption() {
    const roleSelect = document.getElementById('staff-role');
    if (!roleSelect) return;
    if ([...roleSelect.options].some(o => o.value === 'helpers')) return;
    
    const optgroup = roleSelect.querySelector('optgroup[label="Staff"]');
    if (optgroup) {
        const opt = document.createElement('option');
        opt.value = 'helpers';
        opt.textContent = 'Helper (No App Access)';
        optgroup.appendChild(opt);
    }
}

function injectDailyMonthlyOption() {
    const select = document.getElementById('staff-salary-freq');
    if (!select) return;
    if (!select.querySelector('option[value="DailyMonthly"]')) {
        const opt = document.createElement('option');
        opt.value = 'DailyMonthly';
        opt.textContent = 'Daily (Paid Monthly)';
        select.appendChild(opt);
    }
}

function injectStaffListLocationFilter() {
    const plan = normalizePlan(typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free');
    const hasMultiLoc = checkPlanLimits(plan, 'multi_location');
    if (!hasMultiLoc) return;

    const headerContainer = document.getElementById('staff-search-input-dynamic')?.parentNode?.parentNode;
    if (!headerContainer || document.getElementById('staff-list-loc-filter')) return;
    
    const filterContainer = headerContainer.querySelector('.flex.items-center.gap-3');
    if (!filterContainer) return;

    const select = document.createElement('select');
    select.id = 'staff-list-loc-filter';
    select.className = "block pl-3 pr-8 py-2.5 text-sm border-gray-200 rounded-lg bg-gray-50 text-gray-600 focus:outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer shadow-sm hover:border-gray-300 transition-colors";
    
    let opts = `<option value="all">📍 All Locations</option>`;
    const availLocs = typeof getAvailableLocations === 'function' ? getAvailableLocations() : [];
    if (availLocs) {
        availLocs.forEach(loc => {
            opts += `<option value="${loc.id}">📍 ${escapeHTML(loc.name)}</option>`;
        });
    }
    select.innerHTML = opts;
    
    select.addEventListener('change', (e) => {
        currentStaffLocationFilter = e.target.value;
        renderStaffTable();
    });
    
    filterContainer.insertBefore(select, filterContainer.firstChild);
}

function injectStaffLocationSelector() {
    const roleSelect = document.getElementById('staff-role');
    if(!roleSelect) return;
    if (document.getElementById('staff-location-select')) return;

    const plan = normalizePlan(typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free');
    const hasMultiLoc = checkPlanLimits(plan, 'multi_location');
    
    const container = document.createElement('div');
    container.className = "mt-4"; 
    
    const disabledAttr = !hasMultiLoc ? 'disabled' : '';
    const opacityClass = !hasMultiLoc ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'bg-white';
    const upgradeText = !hasMultiLoc ? ' <span class="text-[10px] text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded ml-1">(Diamond Only)</span>' : '';

    const availLocs = typeof getAvailableLocations === 'function' ? getAvailableLocations() : [];

    
    
    if (roleSelect.parentNode.classList.contains('grid') || roleSelect.parentNode.parentNode.classList.contains('grid')) {
         roleSelect.parentNode.parentNode.appendChild(container);
    } else {
         roleSelect.parentNode.insertAdjacentElement('afterend', container);
    }
}

function ensureAccountantRoleOption() {
    const roleSelect = document.getElementById('staff-role');
    if (!roleSelect) return;
    if ([...roleSelect.options].some(o => o.value === 'accountant')) return;
    const opt = document.createElement('option');
    opt.value = 'accountant';
    opt.textContent = 'Accountant';
    if (roleSelect.options.length > 2) roleSelect.add(opt, 2); 
    else roleSelect.add(opt);
}

function injectAttendanceButton() {
    const refreshBtn = document.getElementById('refresh-staff-btn');
    if (refreshBtn && !document.getElementById('attendance-btn')) {
        const btn = document.createElement('button');
        btn.id = 'attendance-btn';
        btn.className = "px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-200 flex items-center gap-2 transition-all active:scale-95";
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2-2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg> Attendance`;
        btn.onclick = openAttendanceModal;
        refreshBtn.parentNode.insertBefore(btn, refreshBtn);
    }
}

function injectShiftsButton() {
    const currentRole = typeof getUserRole === 'function' ? getUserRole() : 'cashier';
    if (currentRole === 'admin') {
        const refreshBtn = document.getElementById('refresh-staff-btn');
        if (refreshBtn && !document.getElementById('shifts-btn')) {
            const btn = document.createElement('button');
            btn.id = 'shifts-btn';
            btn.className = "px-4 py-2 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-md shadow-teal-200 flex items-center gap-2 transition-all active:scale-95 ml-2";
            btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Shifts`;
            btn.onclick = openShiftsModal;
            refreshBtn.parentNode.insertBefore(btn, refreshBtn);
        }
    }
}

export function resetStaffForm() {
    const form = document.getElementById('add-staff-form');
    if (form) form.reset();
    
    const idHidden = document.getElementById('staff-id-hidden');
    const title = document.getElementById('staff-form-title'); 
    const btn = document.getElementById('add-staff-btn');
    const pwContainer = document.getElementById('staff-password-container');
    const roleInput = document.getElementById('staff-role');
    const shiftInput = document.getElementById('staff-shift');
    const locInput = document.getElementById('staff-location-select');
    const confirmPw = document.getElementById('staff-password-confirm'); 

    ensureAccountantRoleOption();
    ensureHelperRoleOption();

    if(idHidden) idHidden.value = '';
    // 🚀 THE FIX: Use the new SVG-based UI header format
    if(title) title.innerHTML = `
        <div class="bg-indigo-100 text-indigo-600 p-2 rounded-xl shadow-sm">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
        </div> Add Staff
    `;
    if(btn) btn.innerHTML = `
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg> Create Account
    `;
    
    if(pwContainer) pwContainer.classList.remove('hidden'); 
    
    if (roleInput) {
        roleInput.disabled = false;
        roleInput.value = 'cashier';
    }

    if (shiftInput) {
        shiftInput.value = ''; 
    }
    
    if (locInput) {
        const availLocs = typeof getAvailableLocations === 'function' ? getAvailableLocations() : [];
        const mainStore = availLocs.find(l => l.storeName?.toLowerCase().includes('main')) || availLocs[0];
        locInput.value = mainStore ? mainStore.id : (getStoreId() || 'main'); 
        
        const plan = normalizePlan(typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free');
        const hasMultiLoc = checkPlanLimits(plan, 'multi_location');
        locInput.disabled = !hasMultiLoc;
    }
    
    if (confirmPw) {
        confirmPw.value = '';
    }

    const gender = document.getElementById('staff-gender');
    const status = document.getElementById('staff-status');
    const freq = document.getElementById('staff-salary-freq');
    const joinDate = document.getElementById('staff-start-date');

    if(gender) gender.value = 'Male';
    if(status) status.value = 'Active';
    if(freq) freq.value = 'Monthly';
    if(joinDate) joinDate.value = new Date().toISOString().split('T')[0]; 
    
    const emailInput = document.getElementById('staff-email');
    if (emailInput) emailInput.setAttribute('required', 'true');
}

export async function handleAddStaff(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    
    const idHiddenInput = document.getElementById('staff-id-hidden');
    const editingId = idHiddenInput ? idHiddenInput.value : null;
    const roleInput = document.getElementById('staff-role');
    const selectedRole = roleInput ? roleInput.value : 'cashier';
    const name = document.getElementById('staff-name');
    const btn = document.getElementById('add-staff-btn');

    if (!name || !name.value.trim()) { 
        if (typeof showModal === 'function') showModal('Error', 'Name is required.', 'error'); 
        return; 
    }

    let rawPhone = document.getElementById('staff-phone')?.value || '';
    let formattedPhone = rawPhone.replace(/\D/g, '');
    if (formattedPhone && !formattedPhone.startsWith('+')) {
        formattedPhone = formattedPhone.length === 10 ? '+91' + formattedPhone : '+' + formattedPhone;
    }

    const activeStoreId = typeof getStoreId === 'function' ? getStoreId() : 'main';
    const joinDateInput = document.getElementById('staff-start-date');
    const joinDateStr = (joinDateInput && joinDateInput.value) ? joinDateInput.value : new Date().toISOString().split('T')[0];
    const nextPayObj = new Date(joinDateStr);
    nextPayObj.setMonth(nextPayObj.getMonth() + 1); 

    const existingStaff = localStaffCache.find(s => s.docId === editingId) || {};
        const fallbackIncDate = existingStaff.jobDetails?.lastIncrementDate || joinDateStr;
        const currentHiddenIncDate = document.getElementById('staff-last-increment-hidden')?.value;

        const data = {
            name: name.value.trim(),
            email: document.getElementById('staff-email')?.value?.trim() || '', 
            role: selectedRole,
            status: document.getElementById('staff-status')?.value || 'Active',
            shiftId: document.getElementById('staff-shift')?.value || '', 
            assignedLocationId: activeStoreId,
            storeId: activeStoreId,
            assignedStoreName: 'Main Store', 
            joiningDate: joinDateStr,         
            nextPaymentDate: nextPayObj.toISOString().split('T')[0],  
            gender: document.getElementById('staff-gender')?.value || 'Male',
            dob: document.getElementById('staff-dob')?.value || '',
            phone: formattedPhone, 
            address: document.getElementById('staff-address')?.value || '',
            passwordHash: document.getElementById('staff-password') ? await window.hashSecurely(document.getElementById('staff-password').value) : '',
            
            // 🚀 THE FIX: Save the new Increment Frequency, Value, and Last Increment Tracker to the database
            jobDetails: {
                startDate: joinDateStr,
                salary: parseFloat(document.getElementById('staff-salary')?.value || 0),
                salaryFreq: document.getElementById('staff-salary-freq')?.value || 'Monthly',
                dailyWorkHours: parseFloat(document.getElementById('staff-work-hours')?.value || 8),
                autoSavings: parseFloat(document.getElementById('staff-auto-savings')?.value || 0),
                autoSavingsType: document.getElementById('staff-auto-savings-type')?.value || 'rs',
                
                incrementFreq: document.getElementById('dyn-increment-freq')?.value || document.getElementById('staff-increment-freq')?.value || 'None',
                incrementValue: parseFloat(document.getElementById('dyn-increment-val')?.value || document.getElementById('increment-val')?.value || 0),
                incrementType: document.getElementById('dyn-increment-type')?.value || document.getElementById('increment-type')?.value || '%',
                lastIncrementDate: currentHiddenIncDate || fallbackIncDate
            },
            
            banking: {
                bankName: document.getElementById('staff-bank-name')?.value || '',
                accountNum: document.getElementById('staff-account-num')?.value || '',
                ifsc: document.getElementById('staff-ifsc')?.value || '',
                upiId: document.getElementById('staff-upi-id')?.value || '' 
            }
        };

    if (btn) { btn.disabled = true; btn.innerHTML = 'Saving...'; }

    try {
        if (!window.dbAPI || !window.dbAPI.executeBatch) throw new Error("Offline Database not ready.");
        
        const ops = [];

        if (editingId) {
            ops.push({ type: 'update', col: 'customers', id: editingId, data: data });
            await window.dbAPI.executeBatch(ops);
            if (typeof showModal === 'function') showModal('Success', 'Staff updated.', 'success');
        } else {
            const newUid = `staff_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            const newProfile = {
                ...data, docId: newUid, id: newUid,
                createdAt: new Date().toISOString(),
                paymentHistory: [], lastPaymentDate: null,
                permissions: { viewReports: true, manageInventory: true, deleteTransactions: true, canMarkAttendance: true, showInventory: true, showPOS: true, showReports: true, showOrders: true, showCustomers: true } 
            };
            ops.push({ type: 'set', col: 'customers', id: newUid, data: newProfile });
            await window.dbAPI.executeBatch(ops);
            if (typeof showModal === 'function') showModal('Success', 'Staff member added.', 'success');
        }
        
        // 🚀 THE FIX: Notify AppState to instantly sync the UI globally
        if (typeof AppState !== 'undefined') AppState.notify('staff_updated');
        
        if (typeof resetStaffForm === 'function') resetStaffForm();
        if (typeof window.closeStaffFormModal === 'function') window.closeStaffFormModal();
    } catch (error) {
        console.error("Staff Op Error:", error);
        if (typeof showModal === 'function') showModal('Error', error.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = editingId ? 'Update Staff' : 'Create Staff'; }
    }
}



async function openShiftsModal() {
    if (!document.getElementById('shifts-modal')) {
        const modalHtml = `
            <div id="shifts-modal" class="fixed inset-0 bg-gray-900 bg-opacity-60 hidden items-center justify-center p-4 z-50">
                <div class="bg-white p-0 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
                    <div class="flex justify-between items-center px-6 py-4 border-b bg-gray-50">
                        <h3 class="text-lg font-bold text-gray-800">Work Shifts</h3>
                        <button id="close-shifts-btn" class="text-gray-400 hover:text-gray-600 transition-colors bg-white rounded-full p-1 hover:bg-gray-200">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    <div class="p-6">
                        <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Create New Shift</h4>
                        <div class="grid grid-cols-2 gap-3 mb-4">
                            <input type="text" id="new-shift-name" placeholder="Shift Name (e.g. Morning)" class="col-span-2 block w-full rounded-lg border-gray-300 shadow-sm p-2.5 text-sm border focus:ring-teal-500 focus:border-teal-500">
                            <input type="time" id="new-shift-start" class="block w-full rounded-lg border-gray-300 shadow-sm p-2.5 text-sm border focus:ring-teal-500 focus:border-teal-500">
                            <input type="time" id="new-shift-end" class="block w-full rounded-lg border-gray-300 shadow-sm p-2.5 text-sm border focus:ring-teal-500 focus:border-teal-500">
                        </div>
                        <button id="create-shift-btn" class="w-full bg-teal-600 text-white rounded-lg p-2.5 text-sm font-bold hover:bg-teal-700 shadow-md transition-all active:scale-95">Add Shift</button>
                    </div>
                    <div class="flex-1 overflow-y-auto max-h-60 border-t bg-gray-50 p-6 custom-scrollbar">
                        <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Existing Shifts</h4>
                        <ul id="shifts-list" class="space-y-2"></ul>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        document.getElementById('close-shifts-btn').onclick = () => {
            document.getElementById('shifts-modal').classList.add('hidden');
            document.getElementById('shifts-modal').classList.remove('flex');
            document.body.classList.remove('overflow-hidden');
            document.documentElement.classList.remove('overflow-hidden');
        };
        document.getElementById('create-shift-btn').onclick = createShift;
    }

    const modal = document.getElementById('shifts-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    renderShiftsList();
}

async function createShift() {
    const name = document.getElementById('new-shift-name').value.trim();
    const start = document.getElementById('new-shift-start').value;
    const end = document.getElementById('new-shift-end').value;
    let activeStoreId = typeof getStoreId === 'function' ? getStoreId() : 'main';

    if (!name || !start || !end) {
        if (typeof showModal === 'function') showModal('Error', 'Please fill all fields.', 'error');
        return;
    }

    try {
        if (!window.dbAPI || !window.dbAPI.executeBatch) throw new Error("Offline Database not ready.");
        
        const newShift = { id: `shift_${Date.now()}`, name, start, end };
        const docId = `shifts_${activeStoreId}`;
        let currentShifts = [];
        
        const existingData = await window.dbAPI.getDoc('customers', docId);
        if (existingData && existingData.records) {
            currentShifts = existingData.records;
        }
        
        currentShifts.push(newShift);
        
        await window.dbAPI.executeBatch([
            { type: 'set', col: 'customers', id: docId, data: { records: currentShifts } }
        ]);
        
        document.getElementById('new-shift-name').value = '';
        document.getElementById('new-shift-start').value = '';
        document.getElementById('new-shift-end').value = '';
        
        if (typeof loadShifts === 'function') await loadShifts();
        if (typeof renderShiftsList === 'function') renderShiftsList();
        if (typeof updateShiftDropdown === 'function') updateShiftDropdown();
        
    } catch (e) {
        console.error(e);
        if (typeof showModal === 'function') showModal('Error', 'Failed to create shift locally.', 'error');
    }
}

async function deleteShift(id) {
    const activeStoreId = typeof getStoreId === 'function' ? getStoreId() : 'main';

    const executeDelete = async () => {
        try {
            if (!window.dbAPI || !window.dbAPI.executeBatch) throw new Error("Offline Database not ready.");
            const docId = `shifts_${activeStoreId}`;
            let currentShifts = [];
            
            const existingData = await window.dbAPI.getDoc('customers', docId);
            if (existingData && existingData.records) {
                currentShifts = existingData.records.filter(s => s.id !== id);
            }

            await window.dbAPI.executeBatch([
                { type: 'set', col: 'customers', id: docId, data: { records: currentShifts } }
            ]);

            await loadShifts();
            renderShiftsList();
            updateShiftDropdown();
        } catch (e) {
            console.error(e);
            if (typeof showModal === 'function') showModal('Error', 'Failed to delete shift.', 'error');
        }
    };

    if (typeof showModal === 'function') showModal('Confirm Delete', 'Delete this shift?', 'confirm', executeDelete);
    else if (confirm("Delete this shift?")) executeDelete();
}

function renderShiftsList() {
    const list = document.getElementById('shifts-list');
    list.innerHTML = '';
    
    if (localShiftsCache.length === 0) {
        list.innerHTML = '<p class="text-xs text-gray-400 italic text-center py-4">No shifts defined yet.</p>';
        return;
    }

    localShiftsCache.forEach(shift => {
        const li = document.createElement('li');
        li.className = "flex justify-between items-center bg-white p-3 rounded-lg border border-gray-200 shadow-sm";
        li.innerHTML = `
            <div class="flex flex-col">
                <span class="font-bold text-sm text-gray-800">${escapeHTML(shift.name)}</span>
                <span class="text-xs text-gray-500 font-mono bg-gray-100 px-1.5 py-0.5 rounded w-fit mt-1">${to12Hour(shift.start)} - ${to12Hour(shift.end)}</span>
            </div>
            <button class="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-md transition del-shift-btn" data-id="${shift.id}" title="Delete">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
        `;
        li.querySelector('.del-shift-btn').onclick = () => deleteShift(shift.id);
        list.appendChild(li);
    });
}

// --- ATTENDANCE SYSTEM ---

let attendanceModal = null;

async function openAttendanceModal() {
    if (!document.getElementById('attendance-modal')) {
        const modalHtml = `
            <div id="attendance-modal" class="fixed inset-0 bg-gray-900 bg-opacity-60 hidden items-center justify-center p-4 z-50">
                <div class="bg-white p-0 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
                    <div class="flex justify-between items-center px-6 py-4 border-b bg-gray-50">
                        <h3 class="text-lg font-bold text-gray-800 flex items-center gap-2">
                            <span class="text-2xl">📅</span> Attendance Register
                        </h3>
                        <button id="close-attendance-btn" class="text-gray-400 hover:text-gray-600 transition-colors bg-white rounded-full p-1 hover:bg-gray-200">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    
                    <div class="p-4 bg-white border-b border-gray-100 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div class="flex items-center gap-3 w-full md:w-auto">
                            <div class="relative w-full md:w-48">
                                <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                                </span>
                                <input type="text" id="att-staff-search" placeholder="Find Staff..." class="pl-9 block w-full rounded-lg border-gray-300 text-sm p-2 focus:ring-indigo-500 focus:border-indigo-500" />
                            </div>
                            
                            <!-- Location Filter Dropdown -->
                            <select id="att-location-filter" class="hidden w-full md:w-auto text-sm border-gray-300 rounded-lg p-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-sm cursor-pointer">
                                <option value="all">All Locations</option>
                            </select>
                        </div>
                        
                        <div class="flex items-center bg-gray-100 rounded-lg p-1">
                            <button id="prev-att-month" class="p-1.5 hover:bg-white rounded-md text-gray-600 transition shadow-sm hover:shadow">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                            </button>
                            <span id="att-month-label" class="font-bold text-gray-800 text-sm w-32 text-center select-none">...</span>
                            <button id="next-att-month" class="p-1.5 hover:bg-white rounded-md text-gray-600 transition shadow-sm hover:shadow">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                            </button>
                        </div>

                        <div class="flex items-center gap-2 w-full md:w-auto justify-end">
                             <button id="mark-all-p-btn" class="px-3 py-2 text-xs font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition border border-emerald-200" title="Mark All Visible as Present">Mark All Present</button>
                             <!-- 🚀 THE FIX: Removed the Save Today button entirely -->
                        </div>
                    </div>

                    <div class="flex-1 overflow-auto bg-gray-50 relative custom-scrollbar">
                        <table class="w-full text-sm text-left border-collapse relative">
                            <thead class="bg-gray-100 text-gray-700 sticky top-0 z-20 shadow-sm" id="att-grid-header"></thead>
                            <tbody id="att-grid-body" class="divide-y divide-gray-200 bg-white"></tbody>
                        </table>
                    </div>
                    
                    <div class="p-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex justify-center gap-8">
                        <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 bg-green-500 rounded-full"></span> Present (1)</span>
                        <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 bg-orange-400 rounded-full"></span> Half Day (0.5)</span>
                        <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 bg-red-400 rounded-full"></span> Absent (0)</span>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        document.getElementById('close-attendance-btn').onclick = () => {
            document.getElementById('attendance-modal').classList.add('hidden');
            document.getElementById('attendance-modal').classList.remove('flex');
            document.body.classList.remove('overflow-hidden');
            document.documentElement.classList.remove('overflow-hidden');
        };
        
        document.getElementById('prev-att-month').onclick = () => changeAttMonth(-1);
        document.getElementById('next-att-month').onclick = () => changeAttMonth(1);
        
        document.getElementById('att-staff-search').addEventListener('input', (e) => {
             const term = e.target.value.toLowerCase();
             const rows = document.querySelectorAll('#att-grid-body tr');
             rows.forEach(row => {
                 const name = row.getAttribute('data-name').toLowerCase();
                 row.style.display = name.includes(term) ? '' : 'none';
             });
        });
        
        document.getElementById('mark-all-p-btn').onclick = () => batchMarkToday('P');
    }

    // Populate Location Filter if Admin
    const locFilter = document.getElementById('att-location-filter');
    if (locFilter) {
        const plan = normalizePlan(typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free');
        const hasMultiLoc = checkPlanLimits(plan, 'multi_location');
        const currentRole = typeof getUserRole === 'function' ? getUserRole() : 'cashier';

        if (currentRole === 'admin' && hasMultiLoc) {
            locFilter.classList.remove('hidden');
            let opts = `<option value="all">📍 All Locations</option>`;
            const availLocs = typeof getAvailableLocations === 'function' ? getAvailableLocations() : [];
            if (availLocs) {
                availLocs.forEach(loc => {
                    opts += `<option value="${loc.id}">${escapeHTML(loc.name || loc.storeName || loc.id)}</option>`;
                });
            }
            // Force the root store explicitly if no sub-locations map properly
            const rootStoreId = getStoreId();
            if (!opts.includes(rootStoreId)) {
                 opts += `<option value="${rootStoreId}">Main Store</option>`;
            }
            locFilter.innerHTML = opts;
            locFilter.value = currentAttLocationFilter;

            // Remove old listener if re-rendered
            const newLocFilter = locFilter.cloneNode(true);
            locFilter.parentNode.replaceChild(newLocFilter, locFilter);
            
            newLocFilter.addEventListener('change', (e) => {
                currentAttLocationFilter = e.target.value;
                loadAttendanceGrid();
            });
        } else {
            locFilter.classList.add('hidden');
        }
    }

    attendanceModal = document.getElementById('attendance-modal');
    attendanceModal.classList.remove('hidden');
    attendanceModal.classList.add('flex');
    
    currentAttendanceMonth = new Date(); 
    await loadAttendanceGrid();
}

function changeAttMonth(delta) {
    currentAttendanceMonth.setMonth(currentAttendanceMonth.getMonth() + delta);
    loadAttendanceGrid();
}

async function loadAttendanceGrid() {
    const month = currentAttendanceMonth.getMonth();
    const year = currentAttendanceMonth.getFullYear();
    const monthName = currentAttendanceMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
    document.getElementById('att-month-label').textContent = monthName;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th class="p-3 border-b border-r bg-gray-50 sticky left-0 z-30 w-48 shadow-sm text-gray-600 font-bold uppercase text-xs tracking-wider">Staff Name</th>';
    
    const todayDate = new Date().getDate();
    const isCurrentMonth = (new Date().getMonth() === month && new Date().getFullYear() === year);

    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month, d);
        const dayName = dateObj.toLocaleDateString('default', { weekday: 'narrow' });
        const isToday = isCurrentMonth && d === todayDate;
        const bgClass = isToday ? 'bg-indigo-100 text-indigo-900 border-indigo-200' : 'bg-gray-50 border-gray-200';
        
        headerRow.innerHTML += `
            <th class="p-1 border-b border-r text-center w-10 min-w-[40px] ${bgClass}">
                <div class="text-[9px] text-gray-500 font-normal uppercase">${dayName}</div>
                <div class="text-sm font-bold">${d}</div>
            </th>`;
    }
    headerRow.innerHTML += '<th class="p-2 border-b bg-gray-50 w-24 text-center font-bold text-gray-600 sticky right-0 z-20 shadow-md border-l border-gray-200">Total</th>'; 
    
    document.getElementById('att-grid-header').innerHTML = '';
    document.getElementById('att-grid-header').appendChild(headerRow);

    const activeStoreId = typeof getStoreId === 'function' ? getStoreId() : 'main';
    if (!activeStoreId) return;

    // 🚀 THE FIX: Instantly build the attendance map from LocalStorage for all days at once
    const attendanceMap = {}; 
    const monthStr = `${year}-${String(month+1).padStart(2,'0')}`;

    try {
        // 1. Pull the unified monthly grid
        const monthAtt = JSON.parse(localStorage.getItem(`mifela_staff_attendance_${monthStr}`) || '{}');
        Object.entries(monthAtt).forEach(([staffId, days]) => {
            Object.entries(days).forEach(([dateStr, status]) => {
                if (!attendanceMap[dateStr]) attendanceMap[dateStr] = {};
                attendanceMap[dateStr][staffId] = status;
            });
        });

        // 2. Overlay any explicit daily records (Dashboard overwrites)
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const dayAtt = JSON.parse(localStorage.getItem(`mifela_attendance_${dateStr}`) || '{}');
            Object.entries(dayAtt).forEach(([staffId, val]) => {
                if (!attendanceMap[dateStr]) attendanceMap[dateStr] = {};
                attendanceMap[dateStr][staffId] = val;
            });
            
            const storeDayAtt = JSON.parse(localStorage.getItem(`mifela_attendance_${activeStoreId}_${dateStr}`) || '{}');
            Object.entries(storeDayAtt).forEach(([staffId, val]) => {
                if (!attendanceMap[dateStr]) attendanceMap[dateStr] = {};
                attendanceMap[dateStr][staffId] = val;
            });
        }
    } catch(e) { console.warn("Local attendance parsing error:", e); }

    const tbody = document.getElementById('att-grid-body');
    tbody.innerHTML = '';
    
    const plan = normalizePlan(typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free');
    const hasMultiLoc = checkPlanLimits(plan, 'multi_location');
    const currentRole = typeof getUserRole === 'function' ? getUserRole() : 'cashier';

    const staffList = localStaffCache.filter(s => {
        if (s.role === 'admin' || s.status !== 'Active') return false;
        if (currentRole === 'admin' && hasMultiLoc && currentAttLocationFilter !== 'all') {
            const resolvedFilter = currentAttLocationFilter === 'main' ? activeStoreId : currentAttLocationFilter;
            let staffLoc = s.assignedLocationId === 'main' ? activeStoreId : s.assignedLocationId;
            if (staffLoc !== resolvedFilter) return false;
        }
        return true;
    });

    if (staffList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${daysInMonth + 2}" class="text-center py-8 text-gray-400">No staff found for this location.</td></tr>`;
        return;
    }

    staffList.forEach(staff => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-name', staff.name); 
        tr.className = "hover:bg-gray-50 transition-colors group";
        
        const nameCell = document.createElement('td');
        nameCell.className = "p-3 border-b border-r font-medium text-gray-800 sticky left-0 bg-white group-hover:bg-gray-50 z-20 shadow-sm truncate max-w-[192px]";
        
        let subLocBadge = '';
        if (currentAttLocationFilter === 'all' && staff.assignedStoreName) {
            subLocBadge = `<span class="text-[9px] text-indigo-600 bg-indigo-50 px-1 rounded ml-1 border border-indigo-100">${escapeHTML(staff.assignedStoreName).substring(0,8)}</span>`;
        }

        nameCell.innerHTML = `
            <div class="flex items-center gap-2">
                <div class="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">${(staff.name||'U').charAt(0).toUpperCase()}</div>
                <div class="truncate">
                    <div class="truncate text-sm" title="${escapeHTML(staff.name)}">${escapeHTML(staff.name)}</div>
                    <div class="text-[10px] text-gray-400 truncate uppercase tracking-wider">${escapeHTML(staff.role)}${subLocBadge}</div>
                </div>
            </div>`;
        tr.appendChild(nameCell);

        let presentCount = 0;

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const status = attendanceMap[dateStr]?.[staff.docId]; 
            
            const dateObj = new Date(year, month, d);
            const isFuture = dateObj > new Date().setHours(23, 59, 59, 999);
            
            let effectiveStatus = 'A'; 
            let rawRecord = status; 
            let isLocked = false; 

            if (typeof status === 'string') {
                effectiveStatus = status;
                rawRecord = { status: status, in: '', out: '', hours: 0 };
            } else if (status && typeof status === 'object') {
                if (status.in && !status.out && status.status !== 'A') {
                    effectiveStatus = 'P';
                } else {
                    effectiveStatus = status.status || 'A';
                }
                isLocked = Boolean(status.out && status.out.trim() !== '');
                rawRecord = status; 
            } else if (!status && !isFuture) {
                effectiveStatus = 'A';
                rawRecord = { status: 'A', in: '', out: '', hours: 0 };
            } else {
                effectiveStatus = ''; 
                rawRecord = { status: '', in: '', out: '', hours: 0 };
            }

            let cellContent = '';
            let bgClass = '';
            
            if (effectiveStatus === 'P') {
                cellContent = '●';
                bgClass = 'text-green-500 bg-green-50/50';
                presentCount += 1;
            } else if (effectiveStatus === 'HD') {
                cellContent = '◑';
                bgClass = 'text-orange-400 bg-orange-50/50';
                presentCount += 0.5;
            } else if (effectiveStatus === 'A') {
                cellContent = '✕';
                bgClass = 'text-red-400 bg-red-50/50';
            }
            
            const isToday = isCurrentMonth && d === todayDate;
            const borderClass = isToday ? 'border-2 border-indigo-400' : 'border-b border-r border-gray-100';
            const cursorClass = 'cursor-pointer hover:bg-gray-200 transition-colors'; 
            const cellId = `cell_${staff.docId}_${dateStr}`; 

            const td = document.createElement('td');
            td.id = cellId;
            td.className = `p-1 text-center text-xs select-none ${borderClass} ${bgClass} ${cursorClass}`;
            td.innerHTML = cellContent;
            
            td.title = "Click to log hours & status";
            td.onclick = () => { if (typeof openTimeClockModal === 'function') openTimeClockModal(staff, dateStr, rawRecord, td); };
            
            tr.appendChild(td);
        }

        const totalCell = document.createElement('td');
        totalCell.className = "p-2 border-b border-l border-gray-200 text-center font-bold text-gray-700 bg-gray-50 sticky right-0 z-10 shadow-sm";
        totalCell.textContent = presentCount;
        tr.appendChild(totalCell);

        tbody.appendChild(tr);
    });
}

async function fetchMonthlyAttendanceCount(staffId, year, month) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let targetStoreId = localStaffCache.find(s => s.docId === staffId)?.assignedLocationId || (typeof getStoreId === 'function' ? getStoreId() : 'main');
    if (targetStoreId === 'main') targetStoreId = typeof getStoreId === 'function' ? getStoreId() : 'main';

    let count = 0;
    try {
        if (!window.dbAPI || !window.dbAPI.getDoc) return 0;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const docId = `${targetStoreId}_att_${dateStr}`;
            const data = await window.dbAPI.getDoc('customers', docId);
            
            if (data && data.records && data.records[staffId]) {
                const record = data.records[staffId];
                const status = (record !== null && typeof record === 'object') ? record.status : record;
                if (status === 'P') count += 1; 
                else if (status === 'HD') count += 0.5;
            }
        }
        return count;
    } catch(e) { return 0; }
}

async function fetchUnpaidAttendanceCount(staffId, startDateStr) {
    const endStr = new Date().toISOString().split('T')[0];
    if (startDateStr > endStr) return 0;

    let targetStoreId = localStaffCache.find(s => s.docId === staffId)?.assignedLocationId || (typeof getStoreId === 'function' ? getStoreId() : 'main');
    if (targetStoreId === 'main') targetStoreId = typeof getStoreId === 'function' ? getStoreId() : 'main';

    let count = 0;
    try {
        if (!window.dbAPI || !window.dbAPI.getDoc) return 0;

        let currDate = new Date(startDateStr);
        const endDate = new Date(endStr);
        
        while (currDate <= endDate) {
            const dateStr = currDate.toISOString().split('T')[0];
            const docId = `${targetStoreId}_att_${dateStr}`;
            
            const data = await window.dbAPI.getDoc('customers', docId);
            if (data && data.records && data.records[staffId]) {
                const record = data.records[staffId];
                const status = (record !== null && typeof record === 'object') ? record.status : record;
                if (status === 'P') count += 1; 
                else if (status === 'HD') count += 0.5;
            }
            currDate.setDate(currDate.getDate() + 1);
        }
        return count;
    } catch(e) { 
        console.error("Attendance Fetch Error:", e);
        return 0; 
    }
}

async function openTimeClockModal(staff, dateStr, currentRecord, tdElement) {
    const existing = document.getElementById('time-clock-modal');
    if (existing) existing.remove();

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const isFutureDate = dateStr > todayStr;
    
    // 🚀 NEW: Check if the date is before the staff member joined
    const joinDateStr = staff.jobDetails?.startDate || staff.joiningDate || "2000-01-01";
    const isBeforeJoinDate = dateStr < joinDateStr;

    const currentLocalTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    let clockIn = (currentRecord && currentRecord.in) ? currentRecord.in : '';
    let clockOut = (currentRecord && currentRecord.out) ? currentRecord.out : '';
    let status = (currentRecord && currentRecord.status) ? currentRecord.status : (isFutureDate || isBeforeJoinDate ? 'A' : 'P'); 
    
    // Enforce "Present" if they are actively clocked in
    if (clockIn && !clockOut && status !== 'A') {
        status = 'P';
    }

    const standardShiftHours = staff.jobDetails?.dailyWorkHours || 8; 
    // Lock the record if they clocked out, OR if it's before they joined
    const isLocked = Boolean(clockOut && clockOut.trim() !== '') || isBeforeJoinDate;

    if (isFutureDate || isBeforeJoinDate) {
        status = 'A';
        clockIn = '';
        clockOut = '';
    } else if (!isLocked && status !== 'A') {
        if (!clockIn) {
            clockIn = currentLocalTime;
            status = 'P'; 
        } else if (clockIn && !clockOut) {
            // If they are opening an ACTIVE shift, prepopulate the out-time with NOW
            clockOut = currentLocalTime;
        }
    }

    const inputProps = (isLocked || isFutureDate) ? 'disabled' : '';
    const lockBg = (isLocked || isFutureDate) ? 'bg-slate-100 opacity-60 cursor-not-allowed text-slate-500' : 'bg-white';

    const modalHtml = `
        <div id="time-clock-modal" class="fixed inset-0 z-[150] bg-slate-900/60 flex items-center justify-center p-4">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100">
                <div class="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <div>
                        <h3 class="text-lg font-black text-slate-800">${escapeHTML(staff.name)}</h3>
                        <div class="flex items-center gap-3 mt-1">
                            <button id="btn-prev-day" class="text-slate-400 hover:text-indigo-600 transition p-1 rounded hover:bg-slate-200" title="Previous Day">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                            </button>
                            <p class="text-xs font-bold text-slate-500 uppercase tracking-widest select-none w-24 text-center">${dateStr}</p>
                            <button id="btn-next-day" class="text-slate-400 hover:text-indigo-600 transition p-1 rounded hover:bg-slate-200" title="Next Day">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                            </button>
                        </div>
                    </div>
                    <button id="close-time-clock" class="text-slate-400 hover:text-red-500 transition-colors bg-white p-1.5 rounded-full shadow-sm border border-slate-200">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                
                <div class="p-6">
                    ${isFutureDate ? `<div class="mb-4 p-2 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold rounded-lg text-center">Future Date: Only Absent status allowed</div>` : ''}
                    ${isBeforeJoinDate ? `<div class="mb-4 p-2 bg-slate-100 border border-slate-300 text-slate-600 text-xs font-bold rounded-lg text-center">Date is prior to joining (${joinDateStr})</div>` : ''}
                    ${isLocked && !isBeforeJoinDate ? `<div class="mb-4 p-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold rounded-lg text-center flex items-center justify-center gap-2">Shift Completed & Locked</div>` : ''}
                    
                    <label class="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Attendance Status</label>
                    <div class="grid grid-cols-2 gap-2 mb-6">
                        <button type="button" id="btn-status-P" class="att-status-btn py-2 text-xs font-bold rounded-lg border transition-all ${status === 'P' ? 'bg-green-100 text-green-700 border-green-300 ring-2' : 'bg-white border-slate-200 text-slate-600'}" data-val="P" ${isLocked || isFutureDate ? 'disabled' : ''}>Present</button>
                        <button type="button" id="btn-status-A" class="att-status-btn py-2 text-xs font-bold rounded-lg border transition-all ${status === 'A' ? 'bg-red-100 text-red-700 border-red-300 ring-2' : 'bg-white border-slate-200 text-slate-600'}" data-val="A" ${isLocked ? 'disabled' : ''}>Absent</button>
                    </div>

                    <div class="grid grid-cols-2 gap-4 mb-6">
                        <div>
                            <label class="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Clock In</label>
                            <input type="time" id="time-in" value="${clockIn}" ${inputProps} class="w-full rounded-lg border-slate-200 shadow-sm p-2.5 text-sm font-bold text-slate-700 focus:ring-indigo-500 focus:border-indigo-500 transition-all ${lockBg}">
                        </div>
                        <div>
                            <label class="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Clock Out</label>
                            <input type="time" id="time-out" value="${clockOut}" ${inputProps} class="w-full rounded-lg border-slate-200 shadow-sm p-2.5 text-sm font-bold text-slate-700 focus:ring-indigo-500 focus:border-indigo-500 transition-all ${lockBg}">
                        </div>
                    </div>

                    <div class="flex flex-col gap-2 mb-6">
                        <div class="bg-slate-50 p-3 rounded-lg border border-slate-100 flex justify-between items-center">
                            <span class="text-xs font-bold text-slate-600">Total Hours Worked</span>
                            <span id="calculated-hours" class="font-mono font-black text-slate-800">0.0</span>
                        </div>
                        <div id="overtime-display" class="bg-indigo-50 p-3 rounded-lg border border-indigo-100 flex justify-between items-center hidden transition-all">
                            <span class="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">Overtime Generated</span>
                            <span id="calculated-overtime" class="font-mono font-black text-indigo-700">+0.0 hrs</span>
                        </div>
                    </div>

                    <button id="save-time-clock" ${isLocked ? 'disabled' : ''} class="w-full py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-md shadow-indigo-200 hover:bg-indigo-700 transition-colors flex justify-center items-center gap-2 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                        ${isLocked ? 'Record Locked' : 'Save Record'}
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    let activeStatus = status;
    let currentCalculatedHours = 0;
    let currentOvertimeHours = 0;

    const timeIn = document.getElementById('time-in');
    const timeOut = document.getElementById('time-out');
    const displayHours = document.getElementById('calculated-hours');
    const displayOvertimeWrapper = document.getElementById('overtime-display');
    const displayOvertimeText = document.getElementById('calculated-overtime');

    const navigateDay = (delta) => {
        const d = new Date(dateStr);
        d.setDate(d.getDate() + delta);
        const targetStr = d.toISOString().split('T')[0];
        const targetCell = document.getElementById(`cell_${staff.docId}_${targetStr}`);
        if (targetCell) targetCell.click();
        else if (typeof showToast === 'function') showToast("Navigation", "Date out of current view bounds.", "info");
    };
    document.getElementById('btn-prev-day').onclick = () => navigateDay(-1);
    document.getElementById('btn-next-day').onclick = () => navigateDay(1);

    const updateStatusUI = () => {
        // Reset all buttons
        document.querySelectorAll('.att-status-btn').forEach(b => {
            b.className = `att-status-btn py-2 text-xs font-bold rounded-lg border transition-all ${isLocked ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`;
        });
        
        // Highlight active button
        if (activeStatus === 'P') document.getElementById('btn-status-P').className = "att-status-btn py-2 text-xs font-bold rounded-lg border transition-all bg-green-100 text-green-700 border-green-300 ring-2";
        if (activeStatus === 'A') document.getElementById('btn-status-A').className = "att-status-btn py-2 text-xs font-bold rounded-lg border transition-all bg-red-100 text-red-700 border-red-300 ring-2";

        // Handle field visibility/disability based on state
        if (activeStatus === 'A' && !isLocked) {
            timeIn.value = '';
            timeOut.value = '';
            timeIn.disabled = true;
            timeOut.disabled = true;
            timeIn.classList.add('opacity-50', 'bg-slate-100', 'cursor-not-allowed');
            timeOut.classList.add('opacity-50', 'bg-slate-100', 'cursor-not-allowed');
            displayHours.textContent = "0.0";
            displayOvertimeWrapper.classList.add('hidden');
            currentCalculatedHours = 0;
            currentOvertimeHours = 0;
        } else if (!isLocked && !isFutureDate && !isBeforeJoinDate) {
            // Unlocked & Present: Ready for input
            timeIn.disabled = false;
            timeOut.disabled = false;
            timeIn.classList.remove('opacity-50', 'bg-slate-100', 'cursor-not-allowed');
            timeOut.classList.remove('opacity-50', 'bg-slate-100', 'cursor-not-allowed');
            if (!timeIn.value) timeIn.value = currentLocalTime; 
        } else if (isLocked) {
            displayHours.textContent = currentCalculatedHours > 0 ? currentCalculatedHours.toFixed(1) : "0.0";
            if (currentOvertimeHours > 0) {
                displayOvertimeText.textContent = `+${currentOvertimeHours} hrs`;
                displayOvertimeWrapper.classList.remove('hidden');
            } else {
                displayOvertimeWrapper.classList.add('hidden');
            }
        }
    };

    document.querySelectorAll('.att-status-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (isLocked || (isFutureDate && e.target.dataset.val !== 'A')) return; 
            activeStatus = e.target.dataset.val;
            updateStatusUI();
            if (activeStatus !== 'A') calcHoursAndStatus(); 
        });
    });

    const calcHoursAndStatus = () => {
        if (isLocked || activeStatus === 'A' || isFutureDate || isBeforeJoinDate) return;

        if (!timeIn.value) {
            displayHours.textContent = "0.0";
            displayOvertimeWrapper.classList.add('hidden');
            activeStatus = 'A';
            updateStatusUI();
            return;
        }

        if (!timeOut.value) {
            displayHours.textContent = "Working...";
            displayOvertimeWrapper.classList.add('hidden');
            activeStatus = 'P'; 
            updateStatusUI();
            return;
        }
        
        const [inH, inM] = timeIn.value.split(':').map(Number);
        const [outH, outM] = timeOut.value.split(':').map(Number);
        
        let inDate = new Date(2000, 0, 1, inH, inM);
        let outDate = new Date(2000, 0, 1, outH, outM);
        
        if (outDate < inDate) outDate.setDate(outDate.getDate() + 1);
        
        const diffMs = outDate - inDate;
        currentCalculatedHours = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(1));
        displayHours.textContent = currentCalculatedHours.toFixed(1);

        if (currentCalculatedHours > standardShiftHours) {
            currentOvertimeHours = parseFloat((currentCalculatedHours - standardShiftHours).toFixed(1));
            displayOvertimeText.textContent = `+${currentOvertimeHours} hrs`;
            displayOvertimeWrapper.classList.remove('hidden');
        } else {
            currentOvertimeHours = 0;
            displayOvertimeWrapper.classList.add('hidden');
        }

        activeStatus = currentCalculatedHours >= (standardShiftHours / 2) ? 'P' : 'A';
        updateStatusUI();
    };

    timeIn.addEventListener('input', calcHoursAndStatus);
    timeOut.addEventListener('input', calcHoursAndStatus);
    
    if (isLocked && currentRecord) {
        currentCalculatedHours = parseFloat(currentRecord.hours || 0);
        currentOvertimeHours = parseFloat(currentRecord.overtime || 0);
    }
    
    if (activeStatus === 'A' || isFutureDate || isLocked) updateStatusUI();
    else calcHoursAndStatus();

    document.getElementById('close-time-clock').onclick = () => {
        document.getElementById('time-clock-modal').remove();
    };
    document.getElementById('save-time-clock').onclick = async () => {
        if (isLocked) return;
        
        const btn = document.getElementById('save-time-clock');
        btn.disabled = true;
        btn.innerHTML = `Saving...`;
        
        let targetStoreId = staff.assignedLocationId || (typeof getStoreId === 'function' ? getStoreId() : 'main');
        if (targetStoreId === 'main') targetStoreId = typeof getStoreId === 'function' ? getStoreId() : 'main';

        const payload = {
            status: activeStatus,
            in: timeIn.value,
            out: timeOut.value,
            hours: currentCalculatedHours,
            overtime: currentOvertimeHours,
            date: dateStr,
            staffId: staff.docId
        };

        try {
            const previousHours = parseFloat(currentRecord?.hours || 0);
            const previousOvertime = parseFloat(currentRecord?.overtime || 0);
            const hoursDelta = currentCalculatedHours - previousHours;
            const overtimeDelta = currentOvertimeHours - previousOvertime;

            // 1. 🚀 THE FIX: Update Local Cache Optimistically FIRST for instant UI updates
            if (hoursDelta !== 0 || overtimeDelta !== 0) {
                const cachedStaffIndex = localStaffCache.findIndex(s => s.docId === staff.docId);
                if (cachedStaffIndex > -1) {
                    localStaffCache[cachedStaffIndex].totalHoursClocked = parseFloat(localStaffCache[cachedStaffIndex].totalHoursClocked || 0) + hoursDelta;
                    localStaffCache[cachedStaffIndex].totalOvertimeClocked = parseFloat(localStaffCache[cachedStaffIndex].totalOvertimeClocked || 0) + overtimeDelta;
                    
                    // Immediately re-render the directory cards to reflect the new hours
                    if (typeof renderStaffTable === 'function') renderStaffTable();
                }
            }

            // 2. SQLite Batch Save
            if (window.dbAPI && window.dbAPI.executeBatch) {
                const ops = [];
                const attDocId = `${targetStoreId}_att_${dateStr}`;
                
                ops.push({
                    type: 'set', col: 'customers', id: attDocId, data: {
                        date: dateStr,
                        records: { [staff.docId]: payload }, 
                        updatedAt: new Date().toISOString(),
                        locationId: targetStoreId
                    }
                });
                
                if (hoursDelta !== 0 || overtimeDelta !== 0) {
                    const currentStaffTotal = parseFloat(staff.totalHoursClocked || 0);
                    const currentStaffOT = parseFloat(staff.totalOvertimeClocked || 0);
                    
                    ops.push({
                        type: 'update', col: 'customers', id: staff.docId, data: {
                            totalHoursClocked: currentStaffTotal + hoursDelta,
                            totalOvertimeClocked: currentStaffOT + overtimeDelta
                        }
                    });
                }
                await window.dbAPI.executeBatch(ops);
            }

            // 3. Sync to LocalStorage Grids
            const monthStr = dateStr.substring(0, 7);
            const monthKey = `mifela_staff_attendance_${monthStr}`;
            const monthAtt = JSON.parse(localStorage.getItem(monthKey) || '{}');
            if (!monthAtt[staff.docId]) monthAtt[staff.docId] = {};
            monthAtt[staff.docId][dateStr] = activeStatus;
            localStorage.setItem(monthKey, JSON.stringify(monthAtt));

            const dayKey = `mifela_attendance_${dateStr}`;
            const dayAtt = JSON.parse(localStorage.getItem(dayKey) || '{}');
            if (!dayAtt[staff.docId]) dayAtt[staff.docId] = {};
            dayAtt[staff.docId] = payload;
            localStorage.setItem(dayKey, JSON.stringify(dayAtt));

            // 4. Notify AppState Event Bus (Only attendance, not staff, to protect our optimistic UI math)
            if (typeof AppState !== 'undefined') {
                AppState.notify('attendance_updated');
            }

            // 5. Clean up UI
            const timeClockModal = document.getElementById('time-clock-modal');
            if (timeClockModal) timeClockModal.remove();
            
            // Re-render attendance grid
            loadAttendanceGrid();

        } catch (e) { 
            console.error(e); 
            btn.disabled = false;
            btn.innerHTML = 'Save Failed';
        }
    };
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
        document.documentElement.classList.remove('overflow-hidden');
        
        if (typeof setCheckoutLoadingState === 'function') {
            isProcessingCheckout = false;
            setCheckoutLoadingState(false);
        }
    }
});

// 1. PURE PASSIVE SWEEPER: Only cleans orphaned or completely invisible backdrops
setInterval(() => {
    let activeModals = 0;
    const overlays = document.querySelectorAll('.fixed.inset-0:not(.hidden)');

    overlays.forEach(overlay => {
        const style = window.getComputedStyle(overlay);
        const isTransparent = style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none';
        
        // Check if it's an empty shell left behind
        const isEmpty = overlay.children.length === 0;

        if (isEmpty || isTransparent) {
            overlay.classList.add('hidden');
            overlay.classList.remove('flex');
            overlay.style.pointerEvents = 'none';
        } else {
            activeModals++;
        }
    });

    // Fallback: If no modals are active but the page is locked, release it
    if (activeModals === 0 && (document.body.classList.contains('overflow-hidden') || document.documentElement.classList.contains('overflow-hidden'))) {
        document.body.classList.remove('overflow-hidden');
        document.documentElement.classList.remove('overflow-hidden');
    }
}, 1500);

// 2. SAFE INVISIBLE-WALL INTERCEPTOR
document.addEventListener('mousedown', function(e) {
    const target = e.target;
    if (!target) return;

    // ONLY evaluate elements that are positioned to cover the screen
    const isFullScreenWrapper = target.classList.contains('fixed') || target.classList.contains('absolute');
    if (!isFullScreenWrapper) return;

    // Ensure we never intercept clicks inside actual modal content cards, forms, or inputs
    if (target.closest('.bg-white, .bg-slate-50, form, table, input, button, select, textarea')) return;

    const style = window.getComputedStyle(target);
    
    // ONLY destroy the element if it is completely INVISIBLE.
    // Legitimate dark backdrops (e.g., bg-slate-900/80) will now be ignored by the Ghostbuster.
    const isTransparent = style.opacity === '0' || style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === 'transparent' || style.display === 'none';

    if (isTransparent) {
        console.log('🛡️ Ghostbuster shattered an invisible click-trap:', target.id || target.className);
        
        target.classList.add('hidden');
        target.classList.remove('flex');
        target.style.pointerEvents = 'none';

        e.preventDefault();
        e.stopPropagation();

        // Forward the click to the trapped element underneath
        target.style.display = 'none';
        const realTarget = document.elementFromPoint(e.clientX, e.clientY);
        target.style.display = '';

        if (realTarget && realTarget !== target) {
            const eventConfig = { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY };
            realTarget.dispatchEvent(new MouseEvent('mousedown', eventConfig));
            realTarget.dispatchEvent(new MouseEvent('mouseup', eventConfig));
            realTarget.dispatchEvent(new MouseEvent('click', eventConfig));
            
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(realTarget.tagName)) {
                setTimeout(() => realTarget.focus({ preventScroll: true }), 10);
            }
        }
    }
}, { capture: true });



async function batchMarkToday(status) {
    const today = new Date().toISOString().split('T')[0];
    const monthStr = today.substring(0, 7);
    const plan = normalizePlan(typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free');
    const hasMultiLoc = checkPlanLimits(plan, 'multi_location');
    const currentRole = typeof getUserRole === 'function' ? getUserRole() : 'cashier';
    const activeStoreId = typeof getStoreId === 'function' ? getStoreId() : 'main';

    const staffList = localStaffCache.filter(s => {
        if (s.role === 'admin' || s.status !== 'Active') return false;
        if (currentRole === 'admin' && hasMultiLoc && currentAttLocationFilter !== 'all') {
            const filterRes = currentAttLocationFilter === 'main' ? getStoreId() : currentAttLocationFilter;
            const staffLoc = s.assignedLocationId === 'main' ? getStoreId() : s.assignedLocationId;
            if (staffLoc !== filterRes) return false;
        }
        return true;
    });

    if (staffList.length === 0) return;

    try {
        const ops = [];
        const updateMap = {};
        
        // 1. Prepare SQLite Data
        for (const s of staffList) {
            updateMap[s.docId] = { status: status, in: '', out: '', hours: 0, overtime: 0, date: today, staffId: s.docId };
            if (window.dbAPI && typeof window.dbAPI.saveAttendance === 'function') {
                await window.dbAPI.saveAttendance(updateMap[s.docId]);
            }
        }
        
        if (window.dbAPI && window.dbAPI.executeBatch) {
            const docId = `${activeStoreId}_att_${today}`;
            ops.push({
                type: 'set', col: 'customers', id: docId, data: {
                    date: today, records: updateMap, updatedAt: new Date().toISOString(), locationId: activeStoreId
                }
            });
            await window.dbAPI.executeBatch(ops); 
        }

        // 2. 🚀 THE FIX: Force Sync LocalStorage (Monthly Grid)
        const monthKey = `mifela_staff_attendance_${monthStr}`;
        const monthAtt = JSON.parse(localStorage.getItem(monthKey) || '{}');
        staffList.forEach(s => {
            if (!monthAtt[s.docId]) monthAtt[s.docId] = {};
            monthAtt[s.docId][today] = status;
        });
        localStorage.setItem(monthKey, JSON.stringify(monthAtt));

        // 3. 🚀 THE FIX: Force Sync LocalStorage (Daily Dashboard View)
        const dayKey = `mifela_attendance_${today}`;
        const dayAtt = JSON.parse(localStorage.getItem(dayKey) || '{}');
        staffList.forEach(s => {
            if (!dayAtt[s.docId]) dayAtt[s.docId] = {};
            dayAtt[s.docId] = updateMap[s.docId];
        });
        localStorage.setItem(dayKey, JSON.stringify(dayAtt));
        
        localStorage.setItem(`mifela_attendance_${activeStoreId}_${today}`, JSON.stringify(updateMap));

        // 4. Notify Dashboard
        if (typeof AppState !== 'undefined') AppState.notify('attendance_updated');

        showModal('Batch Update', `Marked ${staffList.length} staff as Present (Manual Override).`, 'success');
        loadAttendanceGrid(); 
    } catch(e) { 
        console.error(e); 
        showModal('Error', 'Failed to update attendance.', 'error');
    }
}

async function saveAttendanceToday() {
    const btn = document.getElementById('save-attendance-btn');
    const originalText = btn.innerHTML;
    
    btn.disabled = true;
    btn.classList.replace('bg-indigo-600', 'bg-green-600');
    btn.innerHTML = `<span>✅</span> Saved`;
    
    // Refresh data in background
    await loadAttendanceGrid();

    setTimeout(() => {
        btn.disabled = false;
        btn.classList.replace('bg-green-600', 'bg-indigo-600');
        btn.innerHTML = originalText;
    }, 2000);
}

function handleEditStaff(id) {
    const staff = localStaffCache.find(s => s.docId === id);
    if (!staff) return;
    if (staff.role === 'admin') { showModal('Access Denied', 'Admin profiles cannot be edited here.', 'message'); return; }
    
    resetStaffForm(); 
    
    document.getElementById('staff-id-hidden').value = staff.docId;
    
    // 🚀 THE FIX: Use the new SVG-based UI header format for Editing
    document.getElementById('staff-form-title').innerHTML = `
        <div class="bg-emerald-100 text-emerald-600 p-2 rounded-xl shadow-sm">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
        </div> Edit ${escapeHTML(staff.name)}
    `;
    
    const saveBtn = document.getElementById('add-staff-btn');
    saveBtn.innerHTML = `
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg> Update Staff
    `;
    
    document.getElementById('staff-password-container').classList.add('hidden'); 

    if(document.getElementById('staff-name')) document.getElementById('staff-name').value = staff.name || '';
    if(document.getElementById('staff-email')) document.getElementById('staff-email').value = staff.email || '';
    if(document.getElementById('staff-status')) document.getElementById('staff-status').value = staff.status || 'Active';
    
    const roleInput = document.getElementById('staff-role');
    if(roleInput) {
        roleInput.value = staff.role || 'cashier';
        roleInput.disabled = (staff.role === 'admin');
        roleInput.dispatchEvent(new Event('change'));
    }
    
    if (document.getElementById('staff-shift')) document.getElementById('staff-shift').value = staff.shiftId || '';
    if (document.getElementById('staff-location-select')) document.getElementById('staff-location-select').value = staff.assignedLocationId || 'main';
    if(document.getElementById('staff-gender')) document.getElementById('staff-gender').value = staff.gender || 'Male';
    if(document.getElementById('staff-dob')) document.getElementById('staff-dob').value = staff.dob || '';
    if(document.getElementById('staff-phone')) document.getElementById('staff-phone').value = staff.phone || '';
    if(document.getElementById('staff-address')) document.getElementById('staff-address').value = staff.address || '';
    if(document.getElementById('staff-gov-id')) document.getElementById('staff-gov-id').value = staff.govId || '';
    if(document.getElementById('staff-upi-id')) document.getElementById('staff-upi-id').value = staff.banking?.upiId || '';
    
    ensureIncrementFrequencyUI();

    if (staff.jobDetails) {
        if(document.getElementById('staff-start-date')) document.getElementById('staff-start-date').value = staff.jobDetails.startDate || '';
        if(document.getElementById('staff-salary-freq')) document.getElementById('staff-salary-freq').value = staff.jobDetails.salaryFreq || 'Monthly';
        if(document.getElementById('staff-work-hours')) document.getElementById('staff-work-hours').value = staff.jobDetails.dailyWorkHours || 8; 
        if(document.getElementById('staff-auto-savings')) document.getElementById('staff-auto-savings').value = staff.jobDetails.autoSavings || '';
        if(document.getElementById('staff-auto-savings-type')) document.getElementById('staff-auto-savings-type').value = staff.jobDetails.autoSavingsType || 'rs';
        
        const salaryInput = document.getElementById('staff-salary');
        if (salaryInput) {
            salaryInput.value = staff.jobDetails.salary || '';
            
            let tenureBadge = document.getElementById('dynamic-tenure-badge');
            if (!tenureBadge) {
                tenureBadge = document.createElement('div');
                tenureBadge.id = 'dynamic-tenure-badge';
                tenureBadge.className = 'text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-md mt-2 flex items-center gap-1 w-fit shadow-sm';
                
                // Mount it to the parent column grid, NOT inside the input wrapper
                const outerCol = salaryInput.closest('.col-span-2') || salaryInput.parentElement.parentElement;
                if (outerCol) outerCol.appendChild(tenureBadge);
            }
            
            let hiddenIncDate = document.getElementById('staff-last-increment-hidden');
            if (!hiddenIncDate) {
                hiddenIncDate = document.createElement('input');
                hiddenIncDate.type = 'hidden';
                hiddenIncDate.id = 'staff-last-increment-hidden';
                document.body.appendChild(hiddenIncDate);
            }
            
            const joinDate = staff.jobDetails.startDate || staff.joiningDate || new Date().toISOString().split('T')[0];
            hiddenIncDate.value = staff.jobDetails.lastIncrementDate || joinDate;
            const freqInput = document.getElementById('staff-increment-freq');
            if (freqInput) {
                freqInput.value = staff.jobDetails.incrementFreq || 'Yearly';
            }
            injectIncrementUI(staff);
            const updateBadge = () => {
                const currentFreq = freqInput ? freqInput.value : 'Yearly';
                const nextInc = calculateNextIncrementDate(hiddenIncDate.value, currentFreq);
                const nextIncStr = nextInc ? `<span class="ml-1 text-emerald-600">Next Due: ${nextInc.toLocaleDateString()}</span>` : '<span class="ml-1 text-slate-500">Manual Only</span>';

                // We reuse the existing calculateTenure function from your file
                tenureBadge.innerHTML = `
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> 
                    Tenure: ${calculateTenure(joinDate)}
                    <span class="mx-1 text-indigo-200">|</span>
                    ${nextIncStr}
                `;
            };
            
            if (freqInput) freqInput.onchange = updateBadge;
            updateBadge();
        }
    }
    if (staff.banking) {
        if(document.getElementById('staff-bank-name')) document.getElementById('staff-bank-name').value = staff.banking.bankName || '';
        if(document.getElementById('staff-account-num')) document.getElementById('staff-account-num').value = staff.banking.accountNum || '';
        if(document.getElementById('staff-ifsc')) document.getElementById('staff-ifsc').value = staff.banking.ifsc || '';
        if(document.getElementById('staff-upi-id')) document.getElementById('staff-upi-id').value = staff.banking.upiId || ''; // 🚀 Added UPI loader
    }

    // 🚀 THE FIX: Open the modal instead of scrolling
    const modal = document.getElementById('staff-form-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.classList.add('overflow-hidden');
    }
}
function calculateNextIncrementDate(lastDateStr, freq) {
    if (!lastDateStr || !freq || freq === 'None' || freq === 'Manual') return null;
    const start = new Date(lastDateStr);
    const now = new Date();
    now.setHours(0,0,0,0);
    
    let next = new Date(start);
    let monthsToAdd = 0;
    
    if (freq === 'Monthly') monthsToAdd = 1;
    else if (freq === 'Quarterly') monthsToAdd = 3;
    else if (freq === 'Half-Yearly') monthsToAdd = 6;
    else if (freq === 'Yearly') monthsToAdd = 12;

    if (monthsToAdd === 0) return null;

    // Fast-forward the frequency cycle until the due date is strictly in the future (or today)
    while (next < now) {
        next.setMonth(next.getMonth() + monthsToAdd);
    }
    return next;
}

function injectIncrementUI(staff) {
    // 1. Hide the old static HTML block to prevent ID collisions
    const oldVal = document.getElementById('increment-val');
    if (oldVal && oldVal.id === 'increment-val') {
        const wrap = oldVal.closest('.bg-indigo-50\\/10') || oldVal.closest('.bg-slate-50') || oldVal.parentElement.parentElement;
        if (wrap) wrap.style.display = 'none';
    }

    let incContainer = document.getElementById('dynamic-increment-container');
    const autoSavingsInput = document.getElementById('staff-auto-savings');
    const referenceNode = autoSavingsInput ? autoSavingsInput.closest('.grid') : null;
    
    if (!incContainer && referenceNode) {
        incContainer = document.createElement('div');
        incContainer.id = 'dynamic-increment-container';
        incContainer.className = "col-span-full mt-4";
        referenceNode.insertAdjacentElement('afterend', incContainer);
    }

    if (!incContainer) return;

    const freq = staff?.jobDetails?.incrementFreq || 'None';
    const val = staff?.jobDetails?.incrementValue || '';
    const type = staff?.jobDetails?.incrementType || '%';

    incContainer.innerHTML = `
        <div class="bg-indigo-50/10 border border-indigo-100 p-3 sm:p-4 rounded-xl flex flex-row items-center justify-between gap-2 shadow-sm w-full overflow-hidden">
            
            <!-- Left Side Label -->
            <div class="flex items-center gap-2 text-indigo-800 font-black text-[10px] sm:text-[11px] uppercase tracking-widest shrink-0 truncate">
                <svg class="w-4 h-4 text-indigo-600 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                <span class="hidden sm:inline">Apply Increment</span>
                <span class="sm:hidden">Increment</span>
            </div>
            
            <!-- Right Side Controls (Forced Inline) -->
            <div class="flex items-center gap-1.5 shrink-0 flex-nowrap">
                <select id="dyn-increment-freq" class="h-9 sm:h-10 w-24 sm:w-28 border border-slate-200 bg-white text-slate-700 text-[11px] sm:text-sm font-bold rounded-lg px-1 sm:px-2 outline-none focus:border-indigo-500 shadow-sm cursor-pointer transition-colors">
                    <option value="None" ${freq === 'None' ? 'selected' : ''}>Manual</option>
                    <option value="Monthly" ${freq === 'Monthly' ? 'selected' : ''}>Monthly</option>
                    <option value="Quarterly" ${freq === 'Quarterly' ? 'selected' : ''}>Quarterly</option>
                    <option value="Half-Yearly" ${freq === 'Half-Yearly' ? 'selected' : ''}>Half-Yearly</option>
                    <option value="Yearly" ${freq === 'Yearly' ? 'selected' : ''}>Yearly</option>
                </select>
                
                <input type="number" id="dyn-increment-val" value="${val}" class="h-9 sm:h-10 w-14 sm:w-16 border border-slate-200 bg-white text-slate-800 text-[11px] sm:text-sm font-bold rounded-lg px-1 sm:px-2 outline-none focus:border-indigo-500 shadow-sm text-center transition-colors" placeholder="0">
                
                <select id="dyn-increment-type" class="h-9 sm:h-10 w-10 sm:w-12 border border-slate-200 bg-white text-slate-700 text-[11px] sm:text-sm font-bold rounded-lg px-1 outline-none focus:border-indigo-500 shadow-sm cursor-pointer transition-colors">
                    <option value="%" ${type === '%' ? 'selected' : ''}>%</option>
                    <option value="flat" ${type === 'flat' ? 'selected' : ''}>₹</option>
                </select>
                
                <button type="button" onclick="window.applySalaryIncrement()" class="h-9 sm:h-10 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] sm:text-xs px-2 sm:px-4 rounded-lg shadow-sm transition-all active:scale-95 uppercase tracking-wider shrink-0">Apply</button>
                
                <button type="button" onclick="window.removeSalaryIncrement()" class="h-9 w-9 sm:h-10 sm:w-10 shrink-0 flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-lg shadow-sm transition-all active:scale-95 border border-red-200" title="Remove Scheduled Increment">
                    <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </div>
            
        </div>
    `;
    
    // Wire up the live date calculation for the tenure badge
    const freqInput = document.getElementById('dyn-increment-freq');
    if (freqInput) {
        freqInput.onchange = () => {
            const hiddenIncDate = document.getElementById('staff-last-increment-hidden');
            const joinDate = staff?.jobDetails?.startDate || staff?.joiningDate || new Date().toISOString().split('T')[0];
            const nextInc = calculateNextIncrementDate(hiddenIncDate?.value || joinDate, freqInput.value);
            const nextIncStr = nextInc ? `<span class="ml-1 text-emerald-600">Next Due: ${nextInc.toLocaleDateString()}</span>` : '<span class="ml-1 text-slate-500">Manual Only</span>';
            
            const tenureBadge = document.getElementById('dynamic-tenure-badge');
            if (tenureBadge) {
                tenureBadge.innerHTML = `
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> 
                    Tenure: ${calculateTenure(joinDate)}
                    <span class="mx-1 text-indigo-200">|</span>
                    ${nextIncStr}
                `;
            }
        };
        freqInput.dispatchEvent(new Event('change'));
    }
}

window.removeSalaryIncrement = function() {
    const valInput = document.getElementById('dyn-increment-val') || document.getElementById('increment-val');
    const freqInput = document.getElementById('dyn-increment-freq') || document.getElementById('staff-increment-freq');
    
    if (valInput) valInput.value = '';
    if (freqInput) {
        freqInput.value = 'None';
        freqInput.dispatchEvent(new Event('change'));
    }
    
    if (typeof showToast === 'function') showToast('Removed', 'Auto-increment schedule cleared. Click Update to save.', 'info');
}

function ensureIncrementFrequencyUI() {
    const valInput = document.getElementById('increment-val');
    if (valInput && !document.getElementById('staff-increment-freq')) {
        const wrapper = valInput.parentElement; 
        
        const freqSelect = document.createElement('select');
        freqSelect.id = 'staff-increment-freq';
        freqSelect.className = "w-28 border border-indigo-200 bg-white text-indigo-700 text-sm font-bold rounded-lg px-2 py-2 outline-none focus:border-indigo-500 mr-2 shadow-sm cursor-pointer";
        freqSelect.innerHTML = `
            <option value="None">Manual</option>
            <option value="Monthly">Monthly</option>
            <option value="Quarterly">Quarterly</option>
            <option value="Half-Yearly">Half-Yearly</option>
            <option value="Yearly" selected>Yearly</option>
        `;
        // Inject the frequency dropdown cleanly inside the blue box, right before the amount input
        wrapper.insertBefore(freqSelect, valInput);
    }
}
function fixSalaryInputUI() {
    const salaryInput = document.getElementById('staff-salary');
    if (salaryInput) {
        const relativeWrapper = salaryInput.parentElement;
        if (relativeWrapper && relativeWrapper.classList.contains('relative') && !relativeWrapper.classList.contains('flex')) {
            // Convert to a clean Flexbox row
            relativeWrapper.className = "flex rounded-lg shadow-sm border border-gray-300 focus-within:ring-1 focus-within:ring-indigo-500 focus-within:border-indigo-500 overflow-hidden bg-white w-full mt-1.5";
            
            const iconDiv = relativeWrapper.querySelector('div');
            if (iconDiv) {
                iconDiv.className = "flex items-center justify-center pl-3 pr-3 bg-slate-50 border-r border-gray-200 text-slate-500 font-bold shrink-0";
                iconDiv.style.position = 'static';
            }
            
            salaryInput.className = "block w-full border-0 p-2.5 text-sm font-mono font-bold outline-none ring-0";
            salaryInput.style.paddingLeft = '10px';
        }
    }
}
function handleDeleteStaff(id, name) {
    const staff = localStaffCache.find(s => s.docId === id);
    if (staff && staff.role === 'admin') { 
        if (typeof showModal === 'function') showModal('Action Blocked', 'The Administrator account cannot be deleted.', 'error'); 
        return; 
    }
    
    const deleteAction = async () => {
        try {
            if (!window.dbAPI || !window.dbAPI.deleteDoc) throw new Error("Offline Database not ready.");
            
            await window.dbAPI.deleteDoc('customers', id);
            
            // 🚀 THE FIX: Notify AppState to instantly sync UI
            if (typeof AppState !== 'undefined') AppState.notify('staff_updated');
            
            if (typeof showModal === 'function') showModal('Success', 'Staff removed.', 'success');
        } catch (error) { 
            console.error(error); 
            if (typeof showModal === 'function') showModal('Error', 'Failed to delete staff.', 'error');
        }
    };

    if (typeof showModal === 'function') showModal('Confirm Delete', `Remove **${escapeHTML(name)}**?`, 'confirm', deleteAction);
    else if (confirm(`Remove ${name}?`)) deleteAction();
}




async function openPayrollModal(id) {
    const plan = normalizePlan(typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free');
    
    selectedStaffForPayroll = localStaffCache.find(s => s.docId === id);
    if (!selectedStaffForPayroll) return;

    const m = document.getElementById('payroll-modal');
    if (!m) return;

    document.getElementById('payroll-title').textContent = escapeHTML(selectedStaffForPayroll.name);

    // 1. 🚀 THE FIX: Dynamic Terms based on Frequency
    const salary = parseFloat(selectedStaffForPayroll.jobDetails?.salary) || 0;
    const freq = selectedStaffForPayroll.jobDetails?.salaryFreq || 'Monthly';
    currentPayrollFreq = freq;

    let unitRate = salary;
    let unitLabel = 'Days Present';
    let displayFreq = freq;

    if (freq === 'Monthly') { unitRate = salary; unitLabel = 'Days Present'; }
    else if (freq === 'Weekly') { unitRate = salary; unitLabel = 'Weeks Present'; }
    else if (freq === 'Daily') { unitRate = salary; unitLabel = 'Days Present'; }
    else if (freq === 'DailyMonthly') { unitRate = salary; unitLabel = 'Days Present'; displayFreq = 'Daily'; }

    const rateLabelEl = document.getElementById('payroll-rate-label');
    if (rateLabelEl) rateLabelEl.textContent = `${displayFreq} Rate (${CURRENT_CURRENCY_SYMBOL})`;
    
    const unitLabelEl = document.getElementById('payroll-unit-label');
    if (unitLabelEl) unitLabelEl.textContent = unitLabel;
    
    // 2. Reset Fields
    document.getElementById('payroll-daily-rate').value = unitRate.toFixed(2);
    document.getElementById('payroll-bonus').value = 0;
    document.getElementById('payroll-deduction').value = 0;
    document.getElementById('payroll-advance-amount').value = '';
    document.getElementById('payroll-extra-bonus').value = '';
    document.getElementById('pay-notes').value = '';
    
    const salaryRadio = document.querySelector('input[name="payrollType"][value="SALARY"]');
    if(salaryRadio) salaryRadio.checked = true;

    // 3. Time & Attendance Calculations
    let startDateStr = selectedStaffForPayroll.jobDetails?.startDate || selectedStaffForPayroll.joiningDate || new Date().toISOString().split('T')[0];
    if (selectedStaffForPayroll.lastPaymentDate) {
        const lastDate = new Date(selectedStaffForPayroll.lastPaymentDate);
        lastDate.setDate(lastDate.getDate() + 1);
        startDateStr = lastDate.toISOString().split('T')[0];
    }
    const attendanceCount = await fetchUnpaidAttendanceCount(id, startDateStr);

    const dailyWorkHours = selectedStaffForPayroll.jobDetails?.dailyWorkHours || 8;
    const totalHoursWorked = selectedStaffForPayroll.totalHoursClocked || 0;
    let dynamicOt = selectedStaffForPayroll.totalOvertimeClocked || 0;

    let standardHours = 0;
    let exactEquivalentDays = 0;

    if (totalHoursWorked > 0) {
        if (dynamicOt > totalHoursWorked) dynamicOt = totalHoursWorked; 
        standardHours = totalHoursWorked - dynamicOt;
        exactEquivalentDays = standardHours / dailyWorkHours; 
    } else {
        exactEquivalentDays = attendanceCount;
        standardHours = attendanceCount * dailyWorkHours;
        dynamicOt = 0; 
    }

    exactEquivalentDays = parseFloat(exactEquivalentDays.toFixed(2));
    dynamicOt = parseFloat(dynamicOt.toFixed(2));

    let autoHourlyRate = 0;
    if (freq === 'Monthly') autoHourlyRate = (salary / 30) / dailyWorkHours;
    else if (freq === 'Weekly') autoHourlyRate = (salary / 7) / dailyWorkHours;
    else if (freq === 'Daily') autoHourlyRate = salary / dailyWorkHours;
    autoHourlyRate = parseFloat(autoHourlyRate.toFixed(2)) || 0;

    const daysInput = document.getElementById('payroll-days');
    const helperEl = document.getElementById('payroll-conversion-helper');
    const btnAuto = document.getElementById('btn-pay-mode-auto');
    const btnManual = document.getElementById('btn-pay-mode-manual');

    const setPayrollMode = (auto) => {
        if (auto) {
            if (btnAuto) btnAuto.className = "px-2 py-0.5 text-[9px] font-bold rounded bg-white text-indigo-700 shadow-sm transition-colors";
            if (btnManual) btnManual.className = "px-2 py-0.5 text-[9px] font-bold rounded text-slate-500 hover:text-slate-700 transition-colors";
            if (daysInput) {
                daysInput.readOnly = true;
                daysInput.classList.add('bg-slate-50', 'text-slate-500', 'cursor-not-allowed');
                daysInput.classList.remove('bg-white', 'text-slate-800');
                daysInput.value = exactEquivalentDays;
            }
            if (helperEl) {
                if (totalHoursWorked > 0) helperEl.innerHTML = `${totalHoursWorked.toFixed(1)} total hrs - ${dynamicOt.toFixed(1)} OT = ${standardHours.toFixed(1)} std hrs<br>÷ ${dailyWorkHours}hr shift = <strong>${exactEquivalentDays} Days</strong>`;
                else helperEl.innerHTML = `Based on ${attendanceCount} attendance marks. (No clock-in data)`;
            }
        } else {
            if (btnManual) btnManual.className = "px-2 py-0.5 text-[9px] font-bold rounded bg-white text-indigo-700 shadow-sm transition-colors";
            if (btnAuto) btnAuto.className = "px-2 py-0.5 text-[9px] font-bold rounded text-slate-500 hover:text-slate-700 transition-colors";
            if (daysInput) {
                daysInput.readOnly = false;
                daysInput.classList.remove('bg-slate-50', 'text-slate-500', 'cursor-not-allowed');
                daysInput.classList.add('bg-white', 'text-slate-800');
            }
            if (helperEl) helperEl.innerHTML = `Manual Override Active`;
        }
        updatePayrollCalc();
    };

    if (btnAuto) btnAuto.onclick = () => setPayrollMode(true);
    if (btnManual) btnManual.onclick = () => setPayrollMode(false);
    setPayrollMode(true);

    document.getElementById('payroll-ot-hours').value = dynamicOt;
    document.getElementById('payroll-ot-rate').value = autoHourlyRate;

    // Populate Loan Logic
    const outstandingLoan = (selectedStaffForPayroll.balance < 0) ? Math.abs(selectedStaffForPayroll.balance) : 0;
    const loanDisplayEl = document.getElementById('payroll-display-loan');
    if (loanDisplayEl) loanDisplayEl.textContent = `${CURRENT_CURRENCY_SYMBOL}${outstandingLoan.toFixed(2)}`;
    
    const advanceBalEl = document.getElementById('advance-current-balance');
    if (advanceBalEl) advanceBalEl.textContent = `${CURRENT_CURRENCY_SYMBOL}${outstandingLoan.toFixed(2)}`;
    
    if (outstandingLoan > 0) {
        document.getElementById('dynamic-loan-ui').classList.remove('hidden');
        const loanToggle = document.getElementById('toggle-loan-deduction');
        if (loanToggle) loanToggle.checked = false; 
        document.getElementById('loan-amount-wrapper').classList.add('hidden');
    } else {
        document.getElementById('dynamic-loan-ui').classList.add('hidden');
    }

    const autoSavingsRate = parseFloat(selectedStaffForPayroll.jobDetails?.autoSavings) || 0;
    const savingsBal = parseFloat(selectedStaffForPayroll.savingsBalance || 0);
    const bonusSavingsEl = document.getElementById('bonus-accumulated-savings');
    if (bonusSavingsEl) bonusSavingsEl.textContent = `${CURRENT_CURRENCY_SYMBOL}${savingsBal.toFixed(2)}`;
    
    const liquidateToggle = document.getElementById('toggle-liquidate-savings');
    if (liquidateToggle) liquidateToggle.checked = false; 

    // 🚀 THE FIX: Always show Savings block, but disable if unset so it's not "missing"
    const savingsUiBlock = document.getElementById('dynamic-savings-deduction-ui');
    const svToggle = document.getElementById('toggle-savings-deduction');
    const savingsRateEl = document.getElementById('payroll-display-savings-rate');

    if (savingsUiBlock) {
        savingsUiBlock.classList.remove('hidden');
        if (autoSavingsRate > 0) {
            const savingsType = selectedStaffForPayroll.jobDetails?.autoSavingsType || 'rs';
            if (savingsRateEl) savingsRateEl.innerHTML = savingsType === 'pct' ? `${autoSavingsRate}%` : `${CURRENT_CURRENCY_SYMBOL}${autoSavingsRate.toFixed(2)}`;
            if (svToggle) svToggle.checked = true;
        } else {
            if (savingsRateEl) savingsRateEl.innerHTML = 'Not Set';
            if (svToggle) svToggle.checked = false;
        }
    }

    // 🚀 THE FIX: Assign clean `.oninput` bindings to prevent overlapping calculations
    document.querySelectorAll('input[name="payrollType"]').forEach(r => r.onchange = togglePayrollMode);
    ['payroll-days', 'payroll-holidays', 'payroll-bonus', 'payroll-deduction', 'payroll-ot-hours', 'payroll-ot-rate', 'payroll-advance-amount', 'payroll-loan-recovery-amount', 'payroll-extra-bonus', 'toggle-savings-deduction', 'toggle-liquidate-savings', 'toggle-loan-deduction'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.oninput = updatePayrollCalc;
            el.onchange = updatePayrollCalc;
        }
    });

    m.classList.remove('hidden');
    m.classList.add('flex');
    document.body.classList.add('overflow-hidden');

    togglePayrollMode(); 
    renderPayrollHistory(); 
    updatePayrollCalc();
}
function togglePayrollMode() {
    const checkedRadio = document.querySelector('input[name="payrollType"]:checked');
    const mode = checkedRadio ? checkedRadio.value : 'SALARY';
    
    // View Blocks
    const views = {
        'SALARY': document.getElementById('payroll-salary-fields'),
        'ADVANCE': document.getElementById('payroll-advance-fields'),
        'BONUS': document.getElementById('payroll-bonus-fields')
    };
    
    // Hide all
    Object.values(views).forEach(v => v && v.classList.add('hidden'));

    // Controls
    const recordBtn = document.getElementById('payroll-record-btn');
    const advLabel = document.getElementById('payroll-advance-label');
    
    if (mode === 'SALARY') {
        views['SALARY']?.classList.remove('hidden'); 
        if (recordBtn) recordBtn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg> Record Salary';
    } 
    else if (mode === 'ADVANCE') {
        views['ADVANCE']?.classList.remove('hidden');
        if (advLabel) advLabel.textContent = 'Advance / Loan Amount Issued';
        if (recordBtn) recordBtn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg> Record Loan';
    } 
    else if (mode === 'REPAYMENT') {
        views['ADVANCE']?.classList.remove('hidden');
        if (advLabel) advLabel.textContent = 'Amount Returned by Staff';
        if (recordBtn) recordBtn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg> Record Repayment';
    }
    else if (mode === 'BONUS') {
        views['BONUS']?.classList.remove('hidden');
        if (recordBtn) recordBtn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg> Issue Payout';
    }

    updatePayrollCalc();
}

function updatePayrollCalc() {
    const checkedRadio = document.querySelector('input[name="payrollType"]:checked');
    const mode = checkedRadio ? checkedRadio.value : 'SALARY';
    
    const slipBase = document.getElementById('slip-base');
    const slipOt = document.getElementById('slip-ot');
    const slipBonus = document.getElementById('slip-bonus');
    const slipDeduct = document.getElementById('slip-deduct');
    const slipLoan = document.getElementById('slip-loan');
    const slipPf = document.getElementById('slip-pf');
    const totalDisplay = document.getElementById('payroll-total');

    [slipBase, slipOt, slipBonus, slipDeduct, slipLoan, slipPf].forEach(el => { if(el) el.textContent = '₹0.00'; });

    let netTotal = 0;

    if (mode === 'BONUS') {
        const liquidate = document.getElementById('toggle-liquidate-savings')?.checked;
        const accumSavings = liquidate ? parseFloat(selectedStaffForPayroll.savingsBalance || 0) : 0;
        const extraBonus = parseFloat(document.getElementById('payroll-extra-bonus')?.value || 0);
        
        netTotal = accumSavings + extraBonus;
        
        if (slipBonus) slipBonus.textContent = `₹${extraBonus.toFixed(2)}`;
        if (slipBase && liquidate) slipBase.textContent = `₹${accumSavings.toFixed(2)} (Savings)`;
        if (totalDisplay) totalDisplay.textContent = `${CURRENT_CURRENCY_SYMBOL}${netTotal.toFixed(2)}`;
        return;
    }
    
    if (mode === 'ADVANCE' || mode === 'REPAYMENT') {
        netTotal = parseFloat(document.getElementById('payroll-advance-amount')?.value || 0) || 0;
        if (totalDisplay) totalDisplay.textContent = `${CURRENT_CURRENCY_SYMBOL}${netTotal.toFixed(2)}`;
        if (slipBase) slipBase.textContent = `₹${netTotal.toFixed(2)}`;
        return;
    }

    // 🚀 THE FIX: Dynamic Overtime Re-Calculation Engine
    const otHours = parseFloat(document.getElementById('payroll-ot-hours')?.value || 0);
    const otRate = parseFloat(document.getElementById('payroll-ot-rate')?.value || 0);
    const otPay = otHours * otRate;

    const btnAuto = document.getElementById('btn-pay-mode-auto');
    const isAuto = btnAuto && btnAuto.classList.contains('bg-white'); 

    if (isAuto && selectedStaffForPayroll) {
        const dailyWorkHours = selectedStaffForPayroll.jobDetails?.dailyWorkHours || 8;
        const totalHoursWorked = selectedStaffForPayroll.totalHoursClocked || 0;
        
        if (totalHoursWorked > 0) {
            const standardHours = Math.max(0, totalHoursWorked - otHours);
            const exactEquivalentDays = parseFloat((standardHours / dailyWorkHours).toFixed(2));
            
            const helperEl = document.getElementById('payroll-conversion-helper');
            if (helperEl) {
                helperEl.innerHTML = `${totalHoursWorked.toFixed(1)} total hrs - ${otHours.toFixed(1)} OT = ${standardHours.toFixed(1)} std hrs<br>÷ ${dailyWorkHours}hr shift = <strong>${exactEquivalentDays} Days</strong>`;
            }
            
            const daysInput = document.getElementById('payroll-days');
            if (daysInput && daysInput.value != exactEquivalentDays) {
                daysInput.value = exactEquivalentDays;
            }
        }
    }

    // Handle Loan UI toggles explicitly
    const recoveryToggle = document.getElementById('toggle-loan-deduction');
    const loanWrap = document.getElementById('loan-amount-wrapper');
    if (loanWrap) loanWrap.classList.toggle('hidden', !(recoveryToggle && recoveryToggle.checked));

    // Core Salary Math
    const days = parseFloat(document.getElementById('payroll-days')?.value || 0);
    const holidays = parseFloat(document.getElementById('payroll-holidays')?.value || 0);
    const bonus = parseFloat(document.getElementById('payroll-bonus')?.value || 0);
    const deduction = parseFloat(document.getElementById('payroll-deduction')?.value || 0);
    const rate = parseFloat(document.getElementById('payroll-daily-rate')?.value || 0);
    
    const totalUnits = days + holidays;
    let basePay = (currentPayrollFreq === 'Monthly') ? (rate / 30) * totalUnits : rate * totalUnits;
    
    let gross = safeMath.add(basePay, bonus);
    gross = safeMath.add(gross, otPay); 

    // Deductions
    let advanceToRecover = 0;
    if (recoveryToggle && recoveryToggle.checked) {
        advanceToRecover = parseFloat(document.getElementById('payroll-loan-recovery-amount')?.value || 0);
        const maxLoan = Math.abs(selectedStaffForPayroll.balance || 0);
        if (advanceToRecover > maxLoan) advanceToRecover = maxLoan;
        if (advanceToRecover > gross) advanceToRecover = gross; 
        document.getElementById('payroll-loan-recovery-amount').value = advanceToRecover.toFixed(2);
    }
    
    let savingsToDeduct = 0;
    const savingsToggle = document.getElementById('toggle-savings-deduction');
    if (savingsToggle && savingsToggle.checked) {
        const savingsRate = parseFloat(selectedStaffForPayroll.jobDetails?.autoSavings || 0);
        const savingsType = selectedStaffForPayroll.jobDetails?.autoSavingsType || 'rs';
        
        let intendedDeduction = 0;
        if (savingsType === 'pct') intendedDeduction = basePay * (savingsRate / 100);
        else intendedDeduction = savingsRate;

        // 🚀 THE FIX: Visually cap the auto-savings UI so the user understands why it is 0
        const availableNet = gross - deduction - advanceToRecover;
        savingsToDeduct = intendedDeduction > availableNet ? Math.max(0, availableNet) : intendedDeduction;
        
        const displayRateEl = document.getElementById('payroll-display-savings-rate');
        if (displayRateEl && savingsRate > 0) {
            displayRateEl.innerHTML = `${CURRENT_CURRENCY_SYMBOL}${savingsToDeduct.toFixed(2)}`;
            if (intendedDeduction > availableNet) {
                displayRateEl.innerHTML += `<span class="text-[9px] text-red-500 font-bold block leading-none mt-1">Capped by Net Pay</span>`;
            }
        }
    }
    
    const totalDeductions = deduction + advanceToRecover + savingsToDeduct;
    netTotal = Math.max(0, safeMath.subtract(gross, totalDeductions));

    // Update Live Payslip
    if (slipBase) slipBase.textContent = `₹${basePay.toFixed(2)}`;
    if (slipOt) slipOt.textContent = `₹${otPay.toFixed(2)}`;
    if (slipBonus) slipBonus.textContent = `₹${bonus.toFixed(2)}`;
    if (slipDeduct) slipDeduct.textContent = `-₹${deduction.toFixed(2)}`;
    if (slipLoan) slipLoan.textContent = `-₹${advanceToRecover.toFixed(2)}`;
    if (slipPf) slipPf.textContent = `-₹${savingsToDeduct.toFixed(2)}`;
    if (totalDisplay) totalDisplay.textContent = `${CURRENT_CURRENCY_SYMBOL}${netTotal.toFixed(2)}`;
}
function calculateTenure(dateString) {
    if (!dateString) return 'N/A';
    const start = new Date(dateString);
    const now = new Date();
    if (now < start) return 'Not Started';

    let years = now.getFullYear() - start.getFullYear();
    let months = now.getMonth() - start.getMonth();
    let days = now.getDate() - start.getDate();

    if (days < 0) {
        months--;
        const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        days += prevMonth.getDate();
    }
    if (months < 0) {
        years--;
        months += 12;
    }

    let parts = [];
    if (years > 0) parts.push(`${years} yr${years > 1 ? 's' : ''}`);
    if (months > 0) parts.push(`${months} mo${months > 1 ? 's' : ''}`);
    if (years === 0 && months === 0 && days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
    
    return parts.length > 0 ? parts.join(', ') : 'Joined Today';
}
async function handlePayrollRecord() {
    if (!selectedStaffForPayroll) return;
    const checkedRadio = document.querySelector('input[name="payrollType"]:checked');
    const mode = checkedRadio ? checkedRadio.value : 'SALARY';
    const recordBtn = document.getElementById('payroll-record-btn');
    
    let totalPay = 0, notes = '', days = 0, bonus = 0, deduction = 0, rateVal = 0;
    let otHours = 0, otRate = 0, otTotal = 0;
    const uid = typeof getUserId === 'function' ? getUserId() : '';
    let advanceToRecover = 0;
    let savingsDeposit = 0;

    if (mode === 'SALARY') {
        days = parseFloat(document.getElementById('payroll-days')?.value || 0); 
        const holidays = parseFloat(document.getElementById('payroll-holidays')?.value || 0); 
        
        bonus = parseFloat(document.getElementById('payroll-bonus')?.value || 0);
        deduction = parseFloat(document.getElementById('payroll-deduction')?.value || 0); 
        rateVal = parseFloat(document.getElementById('payroll-daily-rate')?.value || 0);
        
        otHours = parseFloat(document.getElementById('payroll-ot-hours')?.value || 0);
        otRate = parseFloat(document.getElementById('payroll-ot-rate')?.value || 0);
        otTotal = otHours * otRate;

        const totalPayableUnits = days + holidays;
        let basePay = (currentPayrollFreq === 'Monthly') ? (rateVal / 30) * totalPayableUnits : rateVal * totalPayableUnits;
        
        totalPay = safeMath.add(basePay, bonus);
        totalPay = safeMath.add(totalPay, otTotal);
        totalPay = safeMath.subtract(totalPay, deduction);

        const recoveryToggle = document.getElementById('toggle-loan-deduction');
        if (recoveryToggle && recoveryToggle.checked) {
            advanceToRecover = parseFloat(document.getElementById('payroll-loan-recovery-amount')?.value) || 0;
        }
        totalPay = safeMath.subtract(totalPay, advanceToRecover);
        
        const savingsToggle = document.getElementById('toggle-savings-deduction');
        if (savingsToggle && savingsToggle.checked) {
            const savingsRate = parseFloat(selectedStaffForPayroll.jobDetails?.autoSavings || 0);
            const savingsType = selectedStaffForPayroll.jobDetails?.autoSavingsType || 'rs';
            if (savingsType === 'pct') savingsDeposit = basePay * (savingsRate / 100);
            else savingsDeposit = savingsRate;
            
            if (savingsDeposit > totalPay) savingsDeposit = totalPay;
            totalPay = safeMath.subtract(totalPay, savingsDeposit);
        }
        
        notes = `Salary (${currentPayrollFreq}). Units: ${days} worked`;
        if (holidays > 0) notes += ` + ${holidays} holidays`;
        if (otTotal > 0) notes += ` | OT: ${otHours}hrs (${CURRENT_CURRENCY_SYMBOL}${otTotal.toFixed(2)})`;
        if (advanceToRecover > 0) notes += ` | Recovered: ${CURRENT_CURRENCY_SYMBOL}${advanceToRecover.toFixed(2)}`;
        if (savingsDeposit > 0) notes += ` | Auto-Saved: ${CURRENT_CURRENCY_SYMBOL}${savingsDeposit.toFixed(2)}`;
    }
    else if (mode === 'BONUS') {
        const extraBonus = parseFloat(document.getElementById('payroll-extra-bonus')?.value || 0);
        const liquidate = document.getElementById('toggle-liquidate-savings')?.checked;
        const accumSavings = liquidate ? parseFloat(selectedStaffForPayroll.savingsBalance || 0) : 0;
        
        totalPay = accumSavings + extraBonus;
        notes = `Bonus/Payout:`;
        if (liquidate) notes += ` Savings Liquidated (${CURRENT_CURRENCY_SYMBOL}${accumSavings.toFixed(2)})`;
        if (extraBonus > 0) notes += ` Employer Bonus (${CURRENT_CURRENCY_SYMBOL}${extraBonus.toFixed(2)})`;
    }
    else if (mode === 'REPAYMENT') {
        totalPay = parseFloat(document.getElementById('payroll-advance-amount')?.value || 0);
        notes = 'Direct Loan Repayment from Staff';
        
        if (selectedStaffForPayroll.balance >= 0) {
            showModal("Error", "This staff member has no outstanding loan to repay.", "error"); return;
        }
        if (totalPay > Math.abs(selectedStaffForPayroll.balance)) {
            showModal("Error", "Repayment cannot exceed the outstanding loan balance.", "error"); return;
        }
    }
    else {
        totalPay = parseFloat(document.getElementById('payroll-advance-amount')?.value || 0);
        notes = 'Advance / Loan Issued';
    }
    
    // Grab Custom Notes
    const customNotes = document.getElementById('pay-notes')?.value.trim();
    if (customNotes) notes = customNotes + " - " + notes;

    if (totalPay < 0) { showModal('Error', 'Calculated amount cannot be negative.', 'message'); return; }
    if (totalPay === 0 && advanceToRecover === 0 && savingsDeposit === 0 && mode === 'SALARY' && days === 0) { 
        showModal('Error', 'No payable amount or days worked.', 'message'); return; 
    }
    if (totalPay <= 0 && (mode === 'ADVANCE' || mode === 'REPAYMENT' || mode === 'BONUS') && !document.getElementById('toggle-liquidate-savings')?.checked) { 
        showModal('Error', 'Amount > 0 required.', 'message'); return; 
    }

    try {
        if (recordBtn) { recordBtn.disabled = true; recordBtn.innerHTML = '<div class="animate-spin h-4 w-4 border-2 border-indigo-600 rounded-full border-t-transparent mr-2"></div> Recording...'; }
        
        if (!window.dbAPI || !window.dbAPI.executeBatch) throw new Error("Offline Database not ready.");

        const paymentRecord = { 
            type: mode, date: new Date().toISOString(), amount: totalPay, 
            breakdown: {
                daysPresent: days, dailyRate: rateVal, bonus: bonus, deduction: deduction, 
                overtimeHours: otHours, overtimeRate: otRate, overtimeTotal: otTotal, 
                loanRecovered: advanceToRecover, savingsDeducted: savingsDeposit
            },
            notes: notes, processedBy: uid 
        };

        // 🚀 Calculate Local Array Unions and Increments manually
        let newLastPayDate = selectedStaffForPayroll.lastPaymentDate;
        let newBalance = selectedStaffForPayroll.balance || 0;
        let newSavings = selectedStaffForPayroll.savingsBalance || 0;
        let newTotalHours = selectedStaffForPayroll.totalHoursClocked || 0;
        let newTotalOT = selectedStaffForPayroll.totalOvertimeClocked || 0;
        const newHistory = [...(selectedStaffForPayroll.paymentHistory || []), paymentRecord];

        if (mode === 'SALARY') {
            newLastPayDate = new Date().toISOString().split('T')[0];
            if (advanceToRecover > 0) newBalance += advanceToRecover; 
            if (savingsDeposit > 0) newSavings += savingsDeposit; 
            newTotalHours = 0;
            newTotalOT = 0;
        } else if (mode === 'ADVANCE') {
            newBalance -= totalPay; 
        } else if (mode === 'REPAYMENT') {
            newBalance += totalPay; 
        } else if (mode === 'BONUS') {
            if (document.getElementById('toggle-liquidate-savings')?.checked) newSavings = 0; 
        }
        
        const updatePayload = {
            paymentHistory: newHistory,
            lastPaymentDate: newLastPayDate,
            balance: newBalance,
            savingsBalance: newSavings,
            totalHoursClocked: newTotalHours,
            totalOvertimeClocked: newTotalOT
        };

        const ops = [{ type: 'update', col: 'customers', id: selectedStaffForPayroll.docId, data: updatePayload }];

        let targetStoreId = selectedStaffForPayroll.assignedLocationId || getStoreId();
        if (targetStoreId === 'main') targetStoreId = getStoreId();

        if (targetStoreId && totalPay > 0) {
            let txType = 'EXPENSE';
            let txAmount = -Math.abs(totalPay);
            
            if (mode === 'REPAYMENT') {
                txType = 'INCOME';
                txAmount = Math.abs(totalPay);
            }

            const txId = `TXN-${Date.now()}`;
            ops.push({
                type: 'set', col: 'transactions', id: txId, data: {
                    id: txId,
                    invoiceId: txId,
                    type: txType,
                    category: mode === 'REPAYMENT' ? 'Loan Recovery' : 'Payroll',
                    amount: totalPay,
                    description: `${notes} for ${selectedStaffForPayroll.name}`,
                    date: new Date().toISOString(),
                    timestamp: new Date().toISOString(),
                    locationId: targetStoreId,
                    summary: { total: txAmount, paymentMethod: 'Cash', user: uid }
                }
            });
        }

        await window.dbAPI.executeBatch(ops);

        // 🚀 THE FIX: Notify AppState to instantly sync UI
        if (typeof AppState !== 'undefined') AppState.notify('staff_updated');

        showModal('Success', 'Record saved successfully.', 'success'); 
        closePayrollModal(); 
    } catch (e) { 
        console.error(e); 
        showModal('Error', 'Failed to record payroll: ' + e.message, 'error');
    } finally { 
        if (recordBtn) { 
            recordBtn.disabled = false; 
            recordBtn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg> Record Payment'; 
        } 
    }
}

window.closePayrollModal = function() {
    const m = document.getElementById('payroll-modal');
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    document.body.classList.remove('overflow-hidden');
    document.documentElement.classList.remove('overflow-hidden');
    selectedStaffForPayroll = null;
};
document.getElementById('payroll-close-btn').onclick = closePayrollModal;


function closePayrollModal() {
    const m = document.getElementById('payroll-modal');
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    selectedStaffForPayroll = null;
}

function renderPayrollHistory() {
    const historyList = document.getElementById('payroll-history-list');
    if (!historyList || !selectedStaffForPayroll) return;
    historyList.innerHTML = '';
    if (selectedStaffForPayroll.paymentHistory?.length > 0) {
        const sorted = [...selectedStaffForPayroll.paymentHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
        sorted.slice(0, 5).forEach(pay => {
            const d = new Date(pay.date).toLocaleDateString();
            let typeBadge = pay.type === 'SALARY' ? `<span class="text-[10px] font-bold text-green-600 bg-green-100 px-1 rounded mr-1">Salary</span>` : `<span class="text-[10px] font-bold text-amber-600 bg-amber-100 px-1 rounded mr-1">Loan</span>`;
            const div = document.createElement('div');
            div.className = "flex justify-between items-center border-b border-gray-100 py-1";
            div.innerHTML = `<div><span class="font-mono text-xs text-gray-600">${d}</span> ${typeBadge}</div><span class="font-bold text-gray-800 text-xs">${CURRENT_CURRENCY_SYMBOL}${pay.amount.toFixed(2)}</span>`;
            historyList.appendChild(div);
        });
    } else { historyList.innerHTML = '<p class="text-xs text-gray-400 italic text-center">No history.</p>'; }
}

function setupStaffListeners() {
    const search = document.getElementById('staff-search-input-dynamic');
    const sort = document.getElementById('staff-sort-dynamic');
    const table = document.getElementById('staff-table-body');
    const form = document.getElementById('add-staff-form');
    const cancel = document.getElementById('cancel-staff-edit-btn');
    const closePay = document.getElementById('payroll-close-btn');
    const recPay = document.getElementById('payroll-record-btn');

    if (search) search.addEventListener('input', () => { clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(renderStaffTable, 300); });
    if (sort) sort.addEventListener('change', renderStaffTable);
    if (table) table.addEventListener('click', (e) => {
        const btn = e.target.closest('button'); if (!btn) return;
        const action = btn.dataset.action; const id = btn.dataset.id;
        if (action === 'edit') handleEditStaff(id); 
        else if (action === 'delete') handleDeleteStaff(id, btn.dataset.name); 
        else if (action === 'pay') openPayrollModal(id);
        else if (action === 'permissions') handleManagePermissions(id); 
    });

    

    if (form) form.addEventListener('submit', handleAddStaff);
    if (cancel) cancel.addEventListener('click', resetStaffForm);
    if (closePay) closePay.addEventListener('click', closePayrollModal);
    if (recPay) recPay.addEventListener('click', handlePayrollRecord);
    
    const inputs = [document.getElementById('payroll-days'), document.getElementById('payroll-bonus'), document.getElementById('payroll-deduction'), document.getElementById('payroll-daily-rate'), document.getElementById('payroll-advance-amount')];
    inputs.forEach(i => i?.addEventListener('input', updatePayrollCalc));
    
    document.querySelectorAll('input[name="payrollType"]').forEach(r => r.addEventListener('change', togglePayrollMode));
    
    // Toggles the Email and Password requirements visually based on Helper role selection
    const roleInput = document.getElementById('staff-role');
    if (roleInput) {
        roleInput.addEventListener('change', (e) => {
            const isHelper = e.target.value === 'helpers';
            const pwContainer = document.getElementById('staff-password-container');
            const confirmPwContainer = document.getElementById('staff-password-confirm')?.parentElement;
            const emailInput = document.getElementById('staff-email');

            if (isHelper) {
                if (pwContainer) pwContainer.classList.add('hidden');
                if (confirmPwContainer) confirmPwContainer.classList.add('hidden');
                if (emailInput) {
                    emailInput.removeAttribute('required');
                    emailInput.placeholder = "Optional for Helpers";
                }
            } else {
                if (pwContainer) pwContainer.classList.remove('hidden');
                if (confirmPwContainer) confirmPwContainer.classList.remove('hidden');
                if (emailInput) {
                    emailInput.setAttribute('required', 'true');
                    emailInput.placeholder = "Email (Required for Login)";
                }
            }
        });
    }
    if (table) table.addEventListener('click', (e) => {
        const btn = e.target.closest('button'); if (!btn) return;
        const action = btn.dataset.action; const id = btn.dataset.id;
        if (action === 'edit') handleEditStaff(id); 
        else if (action === 'delete') handleDeleteStaff(id, btn.dataset.name); 
        else if (action === 'pay') openPayrollModal(id);
        else if (action === 'permissions') handleManagePermissions(id); 
    });

    // 🚀 THE FIX: Attach AppState listeners to enact working hours changes immediately
    if (typeof AppState !== 'undefined' && !window._staffAppStateBound) {
        const syncStaff = async () => {
            // Only reload if the staff tab is actually open
            if (document.getElementById('staff-table-body')) {
                await loadStaffList();
            }
        };
        AppState.subscribe('attendance_updated', syncStaff);
        AppState.subscribe('staff_updated', syncStaff);
        window._staffAppStateBound = true;
    }
}
async function handleManagePermissions(id) {
    const staff = localStaffCache.find(s => s.docId === id);
    if (!staff) return;

    const perms = staff.permissions || { 
        viewReports: false, 
        manageInventory: true, 
        deleteTransactions: false,
        canMarkAttendance: true,
        // Page Visibility Toggles
        showInventory: true,
        showPOS: true,
        showReports: false,
        showOrders: true,
        showCustomers: true
    };

    const modalHtml = `
        <div id="perms-modal" class="fixed inset-0 bg-gray-900 bg-opacity-60 flex items-center justify-center z-[70] p-4">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
                <div class="p-6 border-b bg-gray-50">
                    <h3 class="font-black text-gray-800">Security & Page Access: ${escapeHTML(staff.name)}</h3>
                    <p class="text-xs text-gray-500 uppercase font-bold">Restrict Access Levels & Visible Pages</p>
                </div>
                <div class="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1">
                    <p class="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Security Privileges</p>
                    ${renderPermToggle('View Financial Reports', 'viewReports', perms.viewReports)}
                    ${renderPermToggle('Manage Master Inventory', 'manageInventory', perms.manageInventory)}
                    ${renderPermToggle('Delete Transactions', 'deleteTransactions', perms.deleteTransactions)}
                    ${renderPermToggle('Mark Attendance (Self)', 'canMarkAttendance', perms.canMarkAttendance)}
                    
                    <hr class="border-slate-100 my-2">
                    <p class="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Page & Module Visibility</p>
                    ${renderPermToggle('Visible: Inventory Page', 'showInventory', perms.showInventory ?? true)}
                    ${renderPermToggle('Visible: Billing (POS) Page', 'showPOS', perms.showPOS ?? true)}
                    ${renderPermToggle('Visible: Reports Page', 'showReports', perms.showReports ?? false)}
                    ${renderPermToggle('Visible: Purchase Orders', 'showOrders', perms.showOrders ?? true)}
                    ${renderPermToggle('Visible: Trade & Customers', 'showCustomers', perms.showCustomers ?? true)}
                </div>
                <div class="p-4 bg-gray-50 flex gap-2 border-t">
                    <button id="close-perms-btn" class="flex-1 py-2 text-sm font-bold text-gray-500">Cancel</button>
                    <button id="save-perms-btn" class="flex-1 py-2 text-sm font-bold bg-indigo-600 text-white rounded-lg shadow-md">Apply Security</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    document.getElementById('close-perms-btn').onclick = () => {
        document.getElementById('perms-modal').remove();
        document.body.classList.remove('overflow-hidden');
        document.documentElement.classList.remove('overflow-hidden');
    };
    document.getElementById('save-perms-btn').onclick = async () => {
        const updatedPerms = {
            viewReports: document.getElementById('perm-viewReports').checked,
            manageInventory: document.getElementById('perm-manageInventory').checked,
            deleteTransactions: document.getElementById('perm-deleteTransactions').checked,
            canMarkAttendance: document.getElementById('perm-canMarkAttendance').checked,
            showInventory: document.getElementById('perm-showInventory').checked,
            showPOS: document.getElementById('perm-showPOS').checked,
            showReports: document.getElementById('perm-showReports').checked,
            showOrders: document.getElementById('perm-showOrders').checked,
            showCustomers: document.getElementById('perm-showCustomers').checked
        };

        try {
            if (!window.dbAPI || !window.dbAPI.executeBatch) throw new Error("Offline Database not ready.");
            
            await window.dbAPI.executeBatch([{ type: 'update', col: 'customers', id: id, data: { permissions: updatedPerms } }]);
            
            showModal('Updated', 'Permissions & page visibility updated successfully.', 'success');
            document.getElementById('perms-modal').remove();
            await loadStaffList();
        } catch (e) { showModal('Error', 'Failed to update.', 'error'); }
    };
}

function renderPermToggle(label, key, isChecked) {
    return `
        <div class="flex items-center justify-between">
            <span class="text-sm font-bold text-gray-700">${label}</span>
            <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="perm-${key}" class="sr-only peer" ${isChecked ? 'checked' : ''}>
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
        </div>
    `;
}


window.applySalaryIncrement = function() {
    const valInput = document.getElementById('dyn-increment-val') || document.getElementById('increment-val');
    const typeInput = document.getElementById('dyn-increment-type') || document.getElementById('increment-type');
    
    const salaryInput = document.getElementById('staff-salary');
    const val = parseFloat(valInput?.value) || 0;
    const type = typeInput?.value || '%';
    const currentSalary = parseFloat(salaryInput?.value) || 0;
    
    if (val <= 0 || currentSalary <= 0) return;
    
    let newSalary = currentSalary;
    if (type === '%') newSalary = currentSalary + (currentSalary * (val / 100));
    else newSalary = currentSalary + val;
    
    salaryInput.value = newSalary.toFixed(2);
    salaryInput.classList.add('bg-green-100', 'border-green-400', 'text-green-800');
    setTimeout(() => salaryInput.classList.remove('bg-green-100', 'border-green-400', 'text-green-800'), 800);
    
    // 🚀 THE FIX: Automatically update the Last Increment Date in hidden memory so it resets the cycle
    let hiddenIncDate = document.getElementById('staff-last-increment-hidden');
    if (hiddenIncDate) {
        hiddenIncDate.value = new Date().toISOString().split('T')[0]; 
    }
    
    const freqInput = document.getElementById('dyn-increment-freq') || document.getElementById('staff-increment-freq');
    if (freqInput) freqInput.dispatchEvent(new Event('change'));
    
    if (typeof showToast === 'function') showToast('Increment Applied', `Salary bumped to ${CURRENT_CURRENCY_SYMBOL}${newSalary.toFixed(2)}. Click Update to save.`, 'success');
};
window.openStaffFormModal = function() {
    resetStaffForm(); // Ensure the form is empty for a new entry
    const modal = document.getElementById('staff-form-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.classList.add('overflow-hidden');
    }
};

window.closeStaffFormModal = function() {
    const modal = document.getElementById('staff-form-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.classList.remove('overflow-hidden');
        document.documentElement.classList.remove('overflow-hidden');
    }
};
window.triggerStaffUpiPayment = function() {
    if (!selectedStaffForPayroll) return;
    
    // 1. Prevent payout actions during a loan repayment
    const checkedRadio = document.querySelector('input[name="payrollType"]:checked');
    const mode = checkedRadio ? checkedRadio.value : 'SALARY';
    if (mode === 'REPAYMENT') {
        if (typeof showToast === 'function') {
            showToast('Invalid Action', 'For Repayments, the staff member pays the store.', 'warning');
        }
        return;
    }

    // 2. Validate Staff UPI ID
    const upiId = selectedStaffForPayroll.banking?.upiId || document.getElementById('staff-upi-id')?.value;
    if (!upiId || !upiId.includes('@')) {
        if (typeof showModal === 'function') {
            showModal('Missing UPI ID', `Please edit ${escapeHTML(selectedStaffForPayroll.name)}'s profile and save a valid UPI ID (e.g. mobile@upi) in Banking Details.`, 'error');
        }
        return;
    }

    // 3. Extract the net payable amount
    const totalDisplay = document.getElementById('payroll-total');
    if (!totalDisplay) return;
    
    const amountStr = totalDisplay.textContent.replace(/[^0-9.-]+/g, '');
    const amount = parseFloat(amountStr);

    if (isNaN(amount) || amount <= 0) {
        if (typeof showToast === 'function') {
            showToast('Invalid Amount', 'Payable amount must be greater than zero to trigger UPI.', 'error');
        }
        return;
    }

    // 4. Build standard UPI Intent payload
    const staffName = selectedStaffForPayroll.name || 'Staff Member';
    const customNotes = document.getElementById('pay-notes')?.value?.trim();
    const note = customNotes || `${mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase()} - Mifela`;

    const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(staffName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(upiUri)}`;

    // 5. Render Scan-to-Pay Modal on Windows
    const modalId = 'staff-upi-qr-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const currencySymbol = typeof CURRENT_CURRENCY_SYMBOL !== 'undefined' ? CURRENT_CURRENCY_SYMBOL : '₹';

    const modalHtml = `
        <div id="${modalId}" class="fixed inset-0 z-[300] bg-slate-900/70 flex items-center justify-center p-4   ">
            <div class="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 flex flex-col items-center text-center border border-slate-100 ">
                
                <div class="flex items-center justify-between w-full mb-4 border-b border-slate-100 pb-3">
                    <div class="text-left">
                        <h3 class="text-lg font-black text-slate-800">Scan to Pay Staff</h3>
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${escapeHTML(staffName)}</p>
                    </div>
                    <button type="button" id="close-upi-qr-btn" class="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 p-1.5 rounded-full transition-colors">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                <div class="bg-slate-50 border-2 border-dashed border-indigo-200 p-3 rounded-2xl mb-4 shadow-inner">
                    <img src="${qrSrc}" alt="UPI QR" class="w-48 h-48 object-contain mix-blend-multiply" />
                </div>

                <div class="mb-4">
                    <div class="text-3xl font-black text-indigo-700">${currencySymbol}${amount.toFixed(2)}</div>
                    <div class="text-xs font-mono text-slate-500 mt-1 bg-slate-100 px-2 py-0.5 rounded-md inline-block">${escapeHTML(upiId)}</div>
                </div>

                <p class="text-xs text-slate-500 font-medium mb-6 leading-relaxed">
                    Open <strong>GPay, PhonePe, or Paytm</strong> on your mobile phone and scan this QR code to complete the transfer.
                </p>

                <div class="w-full space-y-2">
                    <button type="button" id="upi-confirm-recorded-btn" class="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl shadow-lg shadow-emerald-200 transition-all active:scale-95 text-sm">
                        I Have Completed Payment
                    </button>
                    <button type="button" id="upi-cancel-btn" class="w-full py-2.5 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // 🚀 THE FIX: Lock the background scroll
    document.body.classList.add('overflow-hidden');

    const modal = document.getElementById(modalId);
    const close = () => {
        modal.remove();
        // 🚀 THE FIX: Release the background scroll
        document.body.classList.remove('overflow-hidden');
    };

    document.getElementById('close-upi-qr-btn').onclick = close;
    document.getElementById('upi-cancel-btn').onclick = close;

    // After scanning and paying on mobile, admin clicks to record the transaction
    document.getElementById('upi-confirm-recorded-btn').onclick = () => {
        close();
        const recordBtn = document.getElementById('payroll-record-btn');
        if (recordBtn) recordBtn.click();
    };
};