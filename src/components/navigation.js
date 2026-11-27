// src/components/navigation.js

import { DOM, showModal } from '../utils/dom.js';
import { renderDynamicDashboard } from './dashboard.js';
import { loadInventoryPage } from './inventory.js';
import { loadCustomersPage } from './customers.js';
import { loadTransactionsPage } from './transactions.js';
import { loadPosPage } from './pos.js';
import { populateSettingsUI } from './settings.js';
import { getUserRole, hasPermission } from '../store/state.js';

// 🚀 THE FIX: Use static imports and wildcard aliases to guarantee Vite bundles them
import * as ReportsModule from './reports.js';
import * as StaffModule from './staff.js';

let isNavigationInitialized = false;
let currentActiveViewId = null;

const moduleMap = {
    'dashboard': () => import('./dashboard.js'),
    'reports': () => import('./reports.js'),
    'inventory': () => import('./inventory.js'),
    'pos': () => import('./pos.js'),
    'customers': () => import('./customers.js'),
    'transactions': () => import('./transactions.js'),
    'staff': () => import('./staff.js'),
    'settings': () => import('./settings.js'),
    'about': () => null
};

export function handleNavigationView() {
    const tabs = document.querySelectorAll('.tab-button');
    const views = document.querySelectorAll('.view-section');

    // Force all tabs to be visible to everyone (RBAC permanently removed)
    window.showNavItemsForRole = function () {
        tabs.forEach(tab => {
            tab.classList.remove('hidden');
            tab.style.display = 'block';
        });
    };

    tabs.forEach(tab => {
        // Remove restricted listeners safely
        const newTab = tab.cloneNode(true);
        tab.parentNode.replaceChild(newTab, tab);

        newTab.addEventListener('click', (e) => {
            const targetView = e.currentTarget.getAttribute('data-view');
            attemptNavigation(targetView, document.querySelectorAll('.tab-button'), views);
        });
    });
}

export async function attemptNavigation(targetView, tabs, views) {
    // 1. Update UI Tabs
    tabs.forEach(t => t.classList.remove('active', 'bg-SLATE-800', 'border-b-4', 'border-white'));
    const activeTab = Array.from(tabs).find(t => t.getAttribute('data-view') === targetView);
    if (activeTab) {
        activeTab.classList.add('active', 'bg-SLATE-800', 'border-b-4', 'border-white');
    }

    // 2. Hide all views, show target view
    views.forEach(v => {
        v.classList.remove('active', 'block');
        v.classList.add('hidden');
    });

    const viewEl = document.getElementById(targetView);
    if (viewEl) {
        viewEl.classList.remove('hidden');
        viewEl.classList.add('active', 'block');
    }

    // 3. Destroy any cached access denied modals
    const blockedModal = document.getElementById('access-denied-modal');
    if (blockedModal) blockedModal.remove();

    // 🚀 4. THE FIX: Restore the Dynamic Data Loaders
    // This intelligent router automatically finds and executes the correct fetch/render function for any clicked tab.
    try {
        if (moduleMap[targetView]) {
            const mod = await moduleMap[targetView]();
            if (mod) {
                // Loop through all exports in the target file and trigger the loaders
                for (const [fnName, fn] of Object.entries(mod)) {
                    if (typeof fn === 'function' &&
                        (fnName.startsWith('load') ||
                            fnName.startsWith('render') ||
                            fnName.startsWith('init') ||
                            fnName.startsWith('fetch'))) {
                        fn();
                    }
                }
            }
        }
    } catch (err) {
        console.error(`Router failed to auto-load data for ${targetView}:`, err);
    }
}

export function updateNavigationUIForRole() {
    const role = typeof getUserRole === 'function' ? getUserRole() : 'admin';

    document.querySelectorAll('.tab-button, .mobile-nav-link, .nav-item, [data-view], [data-target]').forEach(btn => {
        const view = btn.dataset.view || btn.dataset.target;
        if (!view) return;

        if (!hasPermission(role, view)) {
            btn.classList.add('opacity-50', 'cursor-not-allowed', 'hidden');
        } else {
            btn.classList.remove('opacity-50', 'cursor-not-allowed', 'hidden');
        }
    });
}

export function showNavItemsForRole(role) {
    updateNavigationUIForRole();
}



export async function switchView(viewId) {
    let targetSectionId = (viewId === 'profile' || viewId === 'settings') ? 'settings' : viewId;

    if (targetSectionId !== currentActiveViewId) {
        document.querySelectorAll('.view-section').forEach(sec => {
            sec.classList.remove('active', 'block');
            sec.classList.add('hidden');
        });

        const targetSection = document.getElementById(targetSectionId);
        if (targetSection) {
            targetSection.classList.remove('hidden');
            targetSection.classList.add('block');
            setTimeout(() => targetSection.classList.add('active'), 10);
            window.scrollTo(0, 0);
        }
    }

    document.querySelectorAll('.tab-button, .mobile-nav-link, .nav-item, [data-view], [data-target]').forEach(btn => {
        btn.classList.remove('bg-SLATE-800', 'text-white', 'shadow-inner');
        if (btn.classList.contains('tab-button') || btn.classList.contains('nav-item')) {
            btn.classList.add('text-SLATE-100', 'hover:bg-SLATE-600');
        }
    });

    const newBtn = document.querySelector(`[data-view="${viewId}"]`) || document.querySelector(`[data-target="${viewId}"]`);
    if (newBtn) {
        newBtn.classList.remove('text-SLATE-100', 'hover:bg-SLATE-600');
        newBtn.classList.add('bg-SLATE-800', 'text-white', 'shadow-inner');
    }

    currentActiveViewId = targetSectionId;

    try {
        switch (viewId) {
            case 'dashboard': await renderDynamicDashboard(); break;
            case 'pos': loadPosPage(); break;
            case 'inventory': await loadInventoryPage(); break;
            case 'customers': await loadCustomersPage(); break;
            case 'transactions': await loadTransactionsPage(); break;
            // 🚀 THE FIX: Safely route to whatever export name is used in your files!
            case 'reports':
                if (typeof ReportsModule.renderReportLibraryPage === 'function') await ReportsModule.renderReportLibraryPage();
                else if (typeof ReportsModule.initReports === 'function') await ReportsModule.initReports();
                break;

            case 'staff':
                if (typeof StaffModule.loadStaffList === 'function') await StaffModule.loadStaffList();
                break;

            case 'settings':
            case 'profile':
                if (typeof populateSettingsUI === 'function') populateSettingsUI({}, null, viewId);
                break;
        }
    } catch (error) {
        console.error(`Error loading view "${viewId}":`, error);
    }
}