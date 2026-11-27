// src/store/widgetConfig.js

/**
 * MASTER_WIDGET_LIST
 * The source of truth for all available widgets.
 * Icons are SVG (Heroicons Outline) for a professional, platform-agnostic look.
 */

// Local helper to prevent ReferenceError
const escapeHTML = (str) => {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};
export const MASTER_WIDGET_LIST = [
    // --- KEY METRICS (Top Row) ---
    {
        id: 'revenueToday',
        title: 'Revenue (Today)',
        description: 'Total sales revenue collected today.',
        color: 'text-green-600',
        bg: 'bg-green-100',
        // Icon: Currency Dollar
        icon: '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>'
    },
    {
        id: 'totalTransactionsToday',
        title: 'Sales Count',
        description: 'Transactions processed today.',
        color: 'text-blue-600',
        bg: 'bg-blue-100',
        // Icon: Receipt Refund
        icon: '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" /></svg>'
    },
    {
        id: 'availableStaff',
        title: 'Staff On Duty',
        description: 'Staff marked present.',
        color: 'text-teal-600',
        bg: 'bg-teal-100',
        // Icon: User Group
        icon: '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 5.472m0 0a9.09 9.09 0 00-3.246 1.598 3 3 0 004.664 1.757M12 12.75a3 3 0 110-6 3 3 0 010 6z" /></svg>'
    },
    {
        id: 'stockValueAtRisk',
        title: 'Value at Risk',
        description: 'Value of expiring stock.',
        color: 'text-orange-700',
        bg: 'bg-orange-100',
        // Icon: Exclamation Triangle
        icon: '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>'
    },

    // --- SECONDARY METRICS ---
    {
        id: 'totalProducts',
        title: 'Total SKU Count',
        description: 'Unique products in inventory.',
        color: 'text-SLATE-600',
        bg: 'bg-SLATE-100',
        // Icon: Cube
        icon: '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" /></svg>'
    },
    {
        id: 'outOfStockCount',
        title: 'Out of Stock',
        description: 'Items with 0 quantity.',
        color: 'text-red-600',
        bg: 'bg-red-100',
        // Icon: Archive Box X Mark
        icon: '<svg fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>'
    },

    // --- CHARTS & TABLES ---
    {
        id: 'salesChart',
        title: 'Revenue Trend (7 Days)',
        description: 'Sales performance over last week.',
        colSpan: 'lg:col-span-2',
        rowSpan: 'lg:row-span-2'
    },
    {
        id: 'topProductsToday',
        title: 'Top Sellers (Today)',
        description: 'Best performing items.',
        colSpan: 'lg:col-span-1',
        rowSpan: 'lg:row-span-2'
    },

    // --- ALERTS ---
    {
        id: 'expiredList',
        title: 'Expired Items Log',
        description: 'Items past best before date.',
        colSpan: 'lg:col-span-1',
        rowSpan: 'lg:row-span-2'
    },
    {
        id: 'lowStockList',
        title: 'Low Stock Warnings',
        description: 'Items below reorder level.',
        colSpan: 'lg:col-span-1',
        rowSpan: 'lg:row-span-2'
    },
    // --- NEW: TOP GROSSING PRODUCTS WIDGET ---
    {
        id: 'fastMovingItems',
        title: 'Highest Grossing',
        description: 'Displays the highest revenue-generating products.',
        colSpan: 'lg:col-span-1', // 🚀 THE FIX: Prevents it from breaking onto a new row
        rowSpan: 'lg:row-span-2',
        roles: ['admin', 'store_manager'],
        render: (metrics, currency) => {
            // 🚀 THE FIX: Use fast movers if available, otherwise fallback to live today's top products
            let topProducts = [];
            if (metrics.fastMovingItems && metrics.fastMovingItems.length > 0) {
                topProducts = metrics.fastMovingItems;
            } else if (metrics.topProductsToday && metrics.topProductsToday.length > 0) {
                topProducts = metrics.topProductsToday;
            }

            let maxProductRev = 100;
            if (topProducts.length > 0) {
                const rawMaxP = Math.max(...topProducts.map(p => p.revenue || p.total || p.qty || 0));
                if (rawMaxP > 0) maxProductRev = rawMaxP;
            }

            const rankStyles = [
                'bg-gradient-to-br from-yellow-300 to-yellow-600 text-yellow-900 border-yellow-200 shadow-[0_0_10px_rgba(253,224,71,0.5)]',
                'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800 border-slate-300',
                'bg-gradient-to-br from-orange-200 to-orange-400 text-orange-900 border-orange-300',
                'bg-SLATE-50 text-SLATE-600 border-SLATE-100',
                'bg-SLATE-50 text-SLATE-600 border-SLATE-100'
            ];

            const productBars = topProducts.slice(0, 5).map((p, idx) => {
                const rev = p.revenue || p.total || p.qty || 0;
                return `
                <div class="mb-4 group">
                    <div class="flex justify-between items-end text-xs mb-1.5">
                        <div class="flex items-center gap-2 overflow-hidden pr-2">
                            <span class="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black border ${rankStyles[idx]} shrink-0">${idx + 1}</span>
                            <span class="font-bold text-slate-700 truncate text-sm group-hover:text-SLATE-600 transition-colors">${escapeHTML(p.name)}</span>
                        </div>
                        <span class="font-black text-SLATE-700 font-mono tracking-tight shrink-0">${currency}${rev.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                    </div>
                    <div class="w-full bg-slate-100 rounded-full h-2.5 shadow-inner overflow-hidden">
                        <div class="bg-gradient-to-r from-SLATE-500 via-purple-500 to-SLATE-400 h-full rounded-full transition-all duration-1000 ease-out group-hover:brightness-110 relative" style="width: ${(rev / maxProductRev) * 100}%">
                            <div class="absolute inset-0 bg-white/20 w-full h-full animate-[shimmer_2s_infinite]"></div>
                        </div>
                    </div>
                </div>
                `;
            }).join('') || `
                <div class="flex flex-col items-center justify-center h-full text-slate-400 py-6">
                    <svg class="w-10 h-10 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
                    <p class="text-xs font-bold uppercase tracking-widest opacity-60">Awaiting Data</p>
                </div>`;

            return `
                <style>@keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }</style>
                <div class="h-full flex flex-col">
                    <div class="flex justify-between items-start mb-6">
                        <h3 class="font-extrabold text-slate-900 flex items-center gap-2 text-lg tracking-tight">
                            <span class="p-1.5 bg-amber-100 rounded-lg text-amber-600 shadow-sm">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z"></path></svg>
                            </span> 
                            Highest Grossing
                        </h3>
                        <span class="text-[9px] font-bold bg-SLATE-50 text-SLATE-600 px-2 py-1 rounded uppercase tracking-wide">Live</span>
                    </div>
                    <div class="flex-1 flex flex-col justify-center">
                        ${productBars}
                    </div>
                </div>
            `;
        }
    },
];