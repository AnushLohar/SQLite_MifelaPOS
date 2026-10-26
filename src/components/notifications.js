// src/components/notifications.js

import { getUserId } from '../store/state.js';
import { getExpirationStatus } from './inventory.js';
import { escapeHTML } from '../utils/security.js';

let currentActiveAlerts = [];

export function setupNotificationDrawer() {
    const bellBtn = document.getElementById('notification-btn');
    const closeBtn = document.getElementById('close-notif-btn');
    const backdrop = document.getElementById('notif-backdrop');
    const sidebar = document.getElementById('notif-sidebar');
    const dismissAllBtn = document.getElementById('dismiss-all-notif-btn');
    const notifList = document.getElementById('notif-list');

    if (!bellBtn || !sidebar || !backdrop) return;

    // 🚀 THE FIX: GPU-Accelerated Slide & Fade Logic
    const toggleDrawer = () => {
        // Check if it's currently off-screen
        const isClosed = sidebar.classList.contains('translate-x-full');
        
        if (isClosed) {
            // OPEN SEQUENCE
            // 1. Remove the display:none so elements are in the DOM (but invisible/offscreen)
            backdrop.classList.remove('hidden');
            sidebar.classList.remove('hidden');
            
            // 2. Force browser to register the display change before animating
            void sidebar.offsetWidth; 
            
            // 3. Trigger the animations!
            sidebar.classList.remove('translate-x-full');
            sidebar.classList.add('translate-x-0');
            
            backdrop.classList.remove('opacity-0');
            backdrop.classList.add('opacity-100');
            
            generateSystemAlerts();
            
            const badge = document.getElementById('notif-badge');
            if (badge) badge.classList.add('hidden');
            
        } else {
            // CLOSE SEQUENCE
            // 1. Trigger the slide-out and fade-out animations
            sidebar.classList.remove('translate-x-0');
            sidebar.classList.add('translate-x-full');
            
            backdrop.classList.remove('opacity-100');
            backdrop.classList.add('opacity-0');
            
            // 2. Wait exactly for the 300ms CSS transition to finish, then hide them from DOM
            setTimeout(() => {
                backdrop.classList.add('hidden');
                sidebar.classList.add('hidden');
            }, 300);
        }
    };

    bellBtn.addEventListener('click', toggleDrawer);
    closeBtn.addEventListener('click', toggleDrawer);
    backdrop.addEventListener('click', toggleDrawer);
    
    // --- Event Delegation for Individual Pin & Dismiss ---
    notifList.addEventListener('click', (e) => {
        const userId = typeof getUserId === 'function' ? getUserId() : 'guest';
        
        // 1. Handle Individual Dismiss
        const dismissBtn = e.target.closest('.dismiss-alert-btn');
        if (dismissBtn) {
            const alertKey = dismissBtn.dataset.key;
            const storageKey = `mifela_dismissed_alerts_${userId}`;
            const dismissed = JSON.parse(localStorage.getItem(storageKey) || "[]");
            
            if (!dismissed.includes(alertKey)) dismissed.push(alertKey);
            localStorage.setItem(storageKey, JSON.stringify(dismissed));
            
            // Instantly re-render to cleanly update UI and counts
            generateSystemAlerts();
            return;
        }

        // 2. Handle Pin to Top
        const pinBtn = e.target.closest('.pin-alert-btn');
        if (pinBtn) {
            const alertKey = pinBtn.dataset.key;
            const storageKey = `mifela_pinned_alerts_${userId}`;
            let pinned = JSON.parse(localStorage.getItem(storageKey) || "[]");
            
            if (pinned.includes(alertKey)) {
                pinned = pinned.filter(k => k !== alertKey); // Unpin
            } else {
                pinned.push(alertKey); // Pin
            }
            localStorage.setItem(storageKey, JSON.stringify(pinned));
            
            generateSystemAlerts();
        }
    });

    // Dismiss All Logic
    dismissAllBtn.addEventListener('click', () => {
        const userId = typeof getUserId === 'function' ? getUserId() : 'guest';
        const storageKey = `mifela_dismissed_alerts_${userId}`;
        
        const existingDismissed = JSON.parse(localStorage.getItem(storageKey) || "[]");
        const newDismissed = [...new Set([...existingDismissed, ...currentActiveAlerts])];
        localStorage.setItem(storageKey, JSON.stringify(newDismissed));

        notifList.innerHTML = `
            <div class="flex flex-col items-center justify-center py-16 opacity-60  ">
                <div class="w-16 h-16 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mb-4">
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
                </div>
                <p class="text-slate-800 font-bold text-lg">All Caught Up!</p>
                <p class="text-xs text-slate-500 mt-1">Alerts have been muted.</p>
            </div>
        `;
        
        const badge = document.getElementById('notif-badge');
        if (badge) badge.classList.add('hidden');
    });
}
export async function generateSystemAlerts() {
    // 🚀 THE FIX: Abort silently if the database bridge hasn't connected yet
    if (!window.dbAPI || typeof window.dbAPI.getProducts !== 'function') {
        console.warn("Database API booting. Skipping notification scan.");
        return []; 
    }
    const list = document.getElementById('notif-list');
    currentActiveAlerts = []; 
    let generatedAlerts = []; 

    try {
        // 🚀 THE FIX: Rip out Firebase getDocs and use the local SQLite API
        if (!window.dbAPI || !window.dbAPI.getAllProducts) {
            throw new Error("Offline database API is missing.");
        }

        const rawProducts = await window.dbAPI.getAllProducts();
        const products = rawProducts.map(p => ({ docId: p.id, ...p })); // Normalize IDs

        const userId = typeof getUserId === 'function' ? getUserId() : 'guest';
        const dismissedKey = `mifela_dismissed_alerts_${userId}`;
        const pinnedKey = `mifela_pinned_alerts_${userId}`;
        
        const dismissedAlerts = JSON.parse(localStorage.getItem(dismissedKey) || "[]");
        const pinnedAlerts = JSON.parse(localStorage.getItem(pinnedKey) || "[]");

        products.forEach(prod => {
            const stock = parseFloat(prod.stockLevel || 0);
            const threshold = parseFloat(prod.lowStockThreshold || 0);
            const isExpired = (typeof getExpirationStatus === 'function') ? getExpirationStatus(prod.expirationDate) === 'expired' : false;

            if (isExpired) {
                const alertKey = `expired_${prod.docId}_${prod.expirationDate}`;
                if (!dismissedAlerts.includes(alertKey)) {
                    currentActiveAlerts.push(alertKey);
                    generatedAlerts.push({
                        key: alertKey,
                        isPinned: pinnedAlerts.includes(alertKey),
                        html: buildAlertCard(alertKey, pinnedAlerts.includes(alertKey), 'Expired', `<strong>${escapeHTML(prod.name)}</strong> has passed its expiration date.`, 'red')
                    });
                }
            } else if (stock <= threshold && threshold > 0) {
                const alertKey = `lowstock_${prod.docId}_qty${stock}`;
                if (!dismissedAlerts.includes(alertKey)) {
                    currentActiveAlerts.push(alertKey);
                    generatedAlerts.push({
                        key: alertKey,
                        isPinned: pinnedAlerts.includes(alertKey),
                        html: buildAlertCard(alertKey, pinnedAlerts.includes(alertKey), 'Low Stock', `<strong>${escapeHTML(prod.name)}</strong> is critically low (${stock} units left).`, 'orange')
                    });
                }
            }
        });

        if (generatedAlerts.length === 0) {
            list.innerHTML = `
                <div class="flex flex-col items-center justify-center py-16 opacity-60">
                    <div class="w-16 h-16 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mb-4">
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                    <p class="text-slate-800 font-bold text-lg">No New Alerts</p>
                    <p class="text-xs text-slate-500 mt-1">Your inventory is looking good.</p>
                </div>
            `;
            const badge = document.getElementById('notif-badge');
            if (badge) badge.classList.add('hidden');
        } else {
            // Sort the array: Pinned alerts float to the top
            generatedAlerts.sort((a, b) => (a.isPinned === b.isPinned) ? 0 : a.isPinned ? -1 : 1);
            
            list.innerHTML = generatedAlerts.map(a => a.html).join('');
            
            const badge = document.getElementById('notif-badge');
            if (badge) badge.classList.remove('hidden');
        }

    } catch (e) {
        console.error("Alert Generation Failed:", e);
        list.innerHTML = '<div class="text-center text-red-500 text-sm font-bold mt-10">Failed to load alerts.</div>';
    }
}

// --- NEW: Added Pin and Dismiss Buttons to the Card ---
function buildAlertCard(alertKey, isPinned, title, message, color) {
    const colorClasses = {
        red: 'bg-red-50 border-red-200 text-red-800',
        orange: 'bg-amber-50 border-amber-200 text-amber-800',
        indigo: 'bg-indigo-50 border-indigo-200 text-indigo-800'
    };

    const icons = {
        red: '<svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>',
        orange: '<svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
        indigo: '<svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
    };

    const theme = colorClasses[color] || colorClasses.indigo;
    const icon = icons[color] || icons.indigo;
    
    // Pin styling based on active state
    const pinClass = isPinned ? 'text-indigo-600 fill-indigo-600 opacity-100' : 'text-slate-400 opacity-0 group-hover:opacity-100 hover:text-indigo-600';

    return `
        <div class="relative p-4 rounded-xl border shadow-sm flex items-start gap-3 transition-all hover:shadow-md group ${theme} ${isPinned ? 'ring-2 ring-indigo-200 shadow-md' : ''}">
            
            <div class="absolute top-2 right-2 flex items-center gap-1">
                <button class="pin-alert-btn p-1.5 rounded-lg hover:bg-white/80 transition-all ${pinClass}" data-key="${alertKey}" title="${isPinned ? 'Unpin' : 'Pin to Top'}">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path></svg>
                </button>
                <button class="dismiss-alert-btn p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-100/50 opacity-0 group-hover:opacity-100 transition-all" data-key="${alertKey}" title="Dismiss Alert">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>

            <div class="mt-0.5 shrink-0 bg-white p-1.5 rounded-lg shadow-sm border border-black/5">
                ${icon}
            </div>
            <div class="pr-12">
                <h4 class="text-xs font-black uppercase tracking-wider mb-1 opacity-80">${title}</h4>
                <p class="text-sm leading-relaxed">${message}</p>
            </div>
        </div>
    `;
}