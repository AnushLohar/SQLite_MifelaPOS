// src/components/widgetRenderer.js

import {
    appId,
    EXPIRATION_WARNING_DAYS,
    getSalesChartInstance,
    setSalesChartInstance,
    getCurrentUserPlan,
    getCurrentLocationId,
    getUserRole,
    getStoreId,
    getCurrencySymbol
} from '../store/state.js';
import Chart from 'chart.js/auto';
import { MASTER_WIDGET_LIST } from '../store/widgetConfig.js';
import { safeMath } from '../utils/math.js';
import { showModal } from '../utils/dom.js';

// --- Helper: Get Local Date String (YYYY-MM-DD) ---
function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- Helper: Safe Query Execution ---
async function safeGetDocs(queryRef) {
    try {
        return await getDocs(queryRef);
    } catch (error) {
        console.warn("Widget query fallback triggered:", error.message);
        return { empty: true, docs: [], forEach: () => { } };
    }
}

export async function calculateAllMetrics() {
    const plan = typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free';
    const currentLoc = typeof getCurrentLocationId === 'function' ? getCurrentLocationId() : 'main';
    const storeId = typeof getStoreId === 'function' ? getStoreId() : null;

    if (!storeId) return null;

    // A. Time Boundaries
    const today = new Date();
    const todayStr = getLocalDateString(today);
    today.setHours(0, 0, 0, 0);
    const startOfDayISO = today.toISOString();

    // Setup fallback variables
    let rawProducts = [];
    let rawTransactions = [];
    let chartDaysData = [];

    // B. Data Fetching (SQLite Offline)
    try {
        if (window.dbAPI) {
            // 1. Fetch Products
            if (typeof window.dbAPI.getAllProducts === 'function') {
                rawProducts = await window.dbAPI.getAllProducts();
            }

            // 2. Fetch Transactions (Today)
            if (typeof window.dbAPI.getTransactionsSince === 'function') {
                rawTransactions = await window.dbAPI.getTransactionsSince(startOfDayISO);
            }

            // 3. Fetch Historical Data (Last 7 Days) for Chart
            // We calculate this live offline instead of reading pre-aggregated cloud summaries
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            sevenDaysAgo.setHours(0, 0, 0, 0);

            if (typeof window.dbAPI.getTransactionsSince === 'function') {
                const weekTxs = await window.dbAPI.getTransactionsSince(sevenDaysAgo.toISOString());

                // Group by day string
                const grouped = {};
                weekTxs.forEach(tx => {
                    if (currentLoc !== 'all' && tx.locationId !== currentLoc) return;
                    // Skip bounced cheques
                    if (tx.summary?.paymentMethod === 'CHEQUE' && tx.summary?.chequeDetails?.status === 'BOUNCED') return;

                    const type = (tx.type || tx.summary?.transactionType || 'SALE').toUpperCase();
                    if (type !== 'SALE' && type !== 'REFUND') return;

                    const dateObj = new Date(tx.timestamp);
                    const dStr = getLocalDateString(dateObj);

                    const txTotal = Math.abs(tx.summary?.revenue || tx.summary?.total || tx.total || 0);
                    const amount = type === 'REFUND' ? -txTotal : txTotal;

                    grouped[dStr] = (grouped[dStr] || 0) + amount;
                });

                // Build the 7-day array
                for (let i = 6; i >= 0; i--) {
                    const d = new Date();
                    d.setDate(d.getDate() - i);
                    const dStr = getLocalDateString(d);
                    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
                    chartDaysData.push({
                        dateStr: dStr,
                        dayName: dayName,
                        revenue: grouped[dStr] || 0
                    });
                }
            }
        }
    } catch (e) {
        console.error("Offline Metric Calculation Error:", e);
    }

    // Fallback if chart data didn't generate
    if (chartDaysData.length === 0) {
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            chartDaysData.push({ dateStr: getLocalDateString(d), dayName: d.toLocaleDateString('en-US', { weekday: 'short' }), revenue: 0 });
        }
    }

    // --- 4. Process Live Data ---

    let revenueToday = 0;
    let salesCountToday = 0;
    let profitToday = 0;
    let purchasesToday = 0;
    const productSalesMap = {};

    rawTransactions.forEach(tx => {
        if (currentLoc !== 'all' && tx.locationId !== currentLoc) return;
        if (tx.summary?.paymentMethod === 'CHEQUE' && tx.summary?.chequeDetails?.status === 'BOUNCED') return;

        const txTotal = Math.abs(tx.summary?.total || 0);
        const txRevenue = tx.summary?.revenue !== undefined ? Math.abs(tx.summary.revenue) : txTotal;
        const txProfit = Math.abs(tx.summary?.profit || 0);

        if (tx.type === 'PURCHASE') {
            purchasesToday = safeMath.add(purchasesToday, txTotal);
            return;
        }
        if (tx.type === 'ADJUSTMENT' || tx.type === 'LOSS') return;

        const type = (tx.type || tx.summary?.transactionType || 'SALE').toUpperCase();
        if (type === 'RETURN' || type === 'REFUND') {
            revenueToday = safeMath.subtract(revenueToday, txRevenue);
            profitToday = safeMath.subtract(profitToday, txProfit);
        } else {
            revenueToday = safeMath.add(revenueToday, txRevenue);
            profitToday = safeMath.add(profitToday, txProfit);

            if (type === 'SALE') {
                salesCountToday++;
                tx.items?.forEach(item => {
                    const name = item.name || 'Unknown';
                    const qty = Math.abs(item.quantity || 0);
                    const rev = safeMath.multiply(parseFloat(item.price || item.cost || 0), qty);

                    if (qty > 0) {
                        if (!productSalesMap[name]) productSalesMap[name] = { qty: 0, revenue: 0 };
                        productSalesMap[name].qty += qty;
                        productSalesMap[name].revenue += rev;
                    }
                });
            }
        }
    });

    const topProductsToday = Object.entries(productSalesMap)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 5)
        .map(([name, data]) => ({ name, qty: data.qty, revenue: data.revenue }));

    // --- 5. Process Chart Data ---
    const labels = chartDaysData.map(d => d.dayName);
    const chartData = chartDaysData.map(d => {
        // Ensure today's live calculated value overrides the historical lookup for accuracy
        return d.dateStr === todayStr ? revenueToday : d.revenue;
    });

    // --- 6. Process Inventory Health ---
    let stockValueAtRisk = 0;
    const expiredList = [];
    let outOfStockCount = 0;
    const lowStockList = [];

    let totalProductsCount = 0;
    let totalInventoryValue = 0;

    const warningDate = new Date();
    warningDate.setDate(new Date().getDate() + EXPIRATION_WARNING_DAYS);

    rawProducts.forEach(p => {
        if (currentLoc !== 'all' && (p.locationId || 'main') !== currentLoc) return;

        totalProductsCount++;
        const cost = Number(p.cost || 0);
        const stock = Number(p.stockLevel || 0);
        totalInventoryValue += (cost * stock);

        // Check Expiration
        if (p.expirationDate) {
            const expDate = new Date(p.expirationDate);
            if (expDate <= warningDate) {
                if (expiredList.length < 10) expiredList.push({ name: p.name, value: p.expirationDate, type: expDate < today ? 'expired' : 'nearing' });
                stockValueAtRisk = safeMath.add(stockValueAtRisk, safeMath.multiply(cost, stock));
            }
        }

        // Check Low Stock
        if (stock <= 0) {
            outOfStockCount++;
            if (lowStockList.length < 10) lowStockList.push({ name: p.name, value: 0, type: 'out' });
        } else if (stock <= (p.lowStockThreshold || 5)) {
            if (lowStockList.length < 10) lowStockList.push({ name: p.name, value: stock, type: 'low' });
        }
    });

    let customerCount = 0;
    try {
        if (window.dbAPI && window.dbAPI.getCustomers) {
            const custs = await window.dbAPI.getCustomers();
            customerCount = custs.length;
        }
    } catch (e) { }

    // In offline mode, skip global "fast movers" and "forecast" as they require cloud CRON jobs
    const fastMovingItems = [];
    const forecastData = [];

    // --- 8. Final Return ---
    return {
        totalProducts: totalProductsCount,
        customerCount: customerCount,
        inventoryValue: totalInventoryValue,
        outOfStockCount,
        stockValueAtRisk,
        expiredList,
        lowStockList,
        revenueToday,
        purchasesToday,
        profitToday,
        totalTransactionsToday: salesCountToday,
        avgSaleValueToday: salesCountToday > 0 ? safeMath.divide(revenueToday, salesCountToday) : 0,
        availableStaff: 0, // Injected downstream by dashboard.js
        nextBigSale: "Spring Sale",
        topProductsToday,
        fastMovingItems,
        inventoryForecast: forecastData,
        salesChartData: { labels, data: chartData }
    };
}


export function renderWidgetById(widgetId, data) {
    let widget = MASTER_WIDGET_LIST.find(w => w.id === widgetId);

    if (!widget) {
        if (widgetId === 'purchasesToday') {
            widget = { id: 'purchasesToday', title: 'Purchases (Today)', icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>', bg: 'bg-red-50', color: 'text-red-600' };
        } else if (widgetId === 'fastMovingItems') {
            widget = { id: 'fastMovingItems', title: 'Fast-Moving (30D)', icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>', bg: 'bg-white', color: 'text-SLATE-600' };
        } else if (widgetId === 'inventoryForecast') {
            widget = { id: 'inventoryForecast', title: 'Stock-Up Suggestions', icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>', bg: 'bg-amber-50', color: 'text-amber-700' };
        }
    }

    if (!widget) return '';

    // --- SMART TITLE INJECTION ---
    let displayTitle = widget.title;
    if (displayTitle.includes('(Today)')) {
        const todayStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        displayTitle = displayTitle.replace('(Today)', `(Today, ${todayStr})`);
    }

    // 🚀 THE FIX: Strip out cloud subscription checks. Offline mode gets everything unlocked.
    const hasAdvancedReports = true;

    // --- ROLE SECURITY ---
    const role = typeof getUserRole === 'function' ? getUserRole() : 'cashier';
    const isMgmt = role === 'admin' || role === 'store_manager';
    const canViewProfit = hasAdvancedReports && isMgmt;

    const currencySymbol = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';
    const bgClass = widget.bg || 'bg-SLATE-50';
    const iconHtml = widget.icon || '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>';
    // Chart Restriction
    if (widgetId === 'salesChart' && data.salesChartData === null) {
        return `<div class="text-center p-8 text-gray-400 bg-gray-50 rounded-xl h-full flex flex-col justify-center items-center border border-dashed border-gray-300">
                    <svg class="w-8 h-8 mb-2 opacity-50 text-SLATE-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                    <p class="text-sm font-bold text-gray-500">Upgrade to view sales trends</p>
                 </div>`;
    }

    // Profit Hiding (Only prompt Management to upgrade. Staff just see standard revenue without the lock prompt)
    if (widgetId === 'revenueToday' && !hasAdvancedReports && isMgmt) {
        const val = Number(data.revenueToday) || 0;
        return `
            <div class="relative h-full flex flex-col justify-center group">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">${displayTitle}</p>
                        <div class="flex flex-col mt-1">
                            <p class="text-3xl font-extrabold text-gray-800 tracking-tight">
                                <span class="text-lg opacity-50 mr-0.5">${currencySymbol}</span>${val.toFixed(2)}
                            </p>
                            <div class="text-xs font-bold text-SLATE-400 mt-1.5 flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg> Unlock Profit Stats</div>
                        </div>
                    </div>
                    <div class="p-3.5 rounded-2xl ${bgClass} text-opacity-80 ${widget.color || 'text-SLATE-600'} shadow-sm">
                        ${iconHtml}
                    </div>
                </div>
            </div>
        `;
    }

    const simpleWidgets = ['totalProducts', 'customerCount', 'totalTransactionsToday', 'outOfStockCount', 'availableStaff'];
    const currencyWidgets = ['inventoryValue', 'revenueToday', 'avgSaleValueToday', 'stockValueAtRisk', 'purchasesToday']; // <-- Added it here!

    if (widgetId === 'nextBigSale') {
        return `
            <div class="relative h-full flex flex-col justify-center">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">${displayTitle}</p>
                        <p class="text-lg font-bold text-purple-700 mt-1">${data.nextBigSale || 'None'}</p>
                    </div>
                    <div class="p-3.5 rounded-2xl bg-purple-50 text-purple-600 shadow-sm border border-purple-100">
                        ${iconHtml}
                    </div>
                </div>
            </div>`;
    }

    if (simpleWidgets.includes(widgetId)) {
        let val = data[widgetId] !== undefined ? Number(data[widgetId]) : 0;
        return `
            <div class="relative h-full flex flex-col justify-center group cursor-default">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">${displayTitle}</p>
                        <p class="text-3xl font-extrabold tracking-tight ${widget.color || 'text-gray-800'} mt-1">${val}</p>
                    </div>
                    <div class="p-3.5 rounded-2xl ${bgClass} ${widget.color || 'text-gray-600'} shadow-sm border border-gray-100">
                        ${iconHtml}
                    </div>
                </div>
                ${hasAdvancedReports ? `<div class="text-[10px] font-medium text-gray-400 mt-3 text-right opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-end gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path></svg> Double-click for details</div>` : ''}
            </div>
        `;
    }

    if (currencyWidgets.includes(widgetId)) {
        let val = Number(data[widgetId]) || 0;
        let profit = Number(data.profitToday) || 0;

        return `
            <div class="relative h-full flex flex-col justify-center group cursor-default">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">${displayTitle}</p>
                        <div class="flex flex-col mt-1">
                            <p class="text-3xl font-extrabold tracking-tight ${val < 0 ? 'text-red-600' : (widget.color || 'text-gray-800')}">
                                <span class="text-lg opacity-50 mr-0.5">${currencySymbol}</span>${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            ${(widgetId === 'revenueToday' && canViewProfit) ? `<div class="text-xs ${profit >= 0 ? 'text-green-600' : 'text-red-600'} font-bold mt-1.5 flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="${profit >= 0 ? 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' : 'M13 17h8m0 0v-8m0 8l-8-8-4 4-6-6'}"></path></svg> Net: ${currencySymbol}${Math.abs(profit).toFixed(2)}</div>` : ''}
                        </div>
                    </div>
                    <div class="p-3.5 rounded-2xl ${bgClass} ${widget.color || 'text-gray-600'} shadow-sm border border-gray-100">
                        ${iconHtml}
                    </div>
                </div>
                ${hasAdvancedReports ? `<div class="text-[10px] font-medium text-gray-400 mt-3 text-right opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-end gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path></svg> Double-click for details</div>` : ''}
            </div>
        `;
    }

    // Top Products Widget
    if (widgetId === 'topProductsToday') {
        const items = data.topProductsToday || [];
        const listHtml = items.length > 0 ? items.map((item, i) => `
            <li class="flex justify-between items-center py-2.5 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors px-2 rounded-lg">
                <div class="flex items-center overflow-hidden">
                    <span class="text-[10px] font-extrabold text-gray-400 w-6 flex-shrink-0 bg-gray-100 rounded-full h-5 flex items-center justify-center mr-2">#${i + 1}</span>
                    <span class="text-sm font-semibold text-gray-700 truncate w-32" title="${item.name}">${item.name}</span>
                </div>
                <span class="text-xs font-bold text-SLATE-700 bg-SLATE-50 border border-SLATE-100 px-2.5 py-1 rounded-full flex-shrink-0 ml-2 shadow-sm">${item.qty} sold</span>
            </li>
        `).join('') : '<li class="text-sm text-gray-400 italic py-6 text-center border border-dashed border-gray-200 rounded-lg bg-gray-50 mt-2">No sales yet today.</li>';

        return `
            <div class="relative h-full flex flex-col group cursor-default">
                <div class="flex items-center justify-between mb-3 border-b border-gray-100 pb-3">
                    <h3 class="font-bold text-gray-800 flex items-center gap-2">
                        <span class="text-yellow-500 bg-yellow-50 p-1.5 rounded-lg border border-yellow-100">${widget.icon || '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"></path></svg>'}</span> ${displayTitle}
                    </h3>
                    <span class="text-[10px] font-bold bg-SLATE-50 text-SLATE-600 px-2 py-1 rounded uppercase tracking-wide">Live</span>
                </div>
                <ul class="space-y-0.5 flex-1 overflow-y-auto scrollbar-hide">
                    ${listHtml}
                </ul>
                ${hasAdvancedReports ? `<div class="text-[10px] font-medium text-gray-400 mt-3 text-right opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-end gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path></svg> Double-click for more</div>` : ''}
            </div>
        `;
    }

    // Chart Widget
    if (widgetId === 'salesChart') {
        return `
            <div class="relative h-full flex flex-col">
                <div class="flex items-center justify-between mb-4 border-b border-gray-100 pb-3 pr-2">
                    <h3 class="font-bold text-gray-800 flex items-center gap-2"><span class="bg-SLATE-50 text-SLATE-600 p-1.5 rounded-lg border border-SLATE-100">${widget.icon || '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>'}</span> ${widget.title}</h3>
                    <span class="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-1 rounded uppercase tracking-wide">Revenue (7 Days)</span>
                </div>
                <div class="flex-1 w-full relative min-h-[160px]">
                    <canvas class="dynamic-chart-canvas"></canvas>
                </div>
            </div>
        `;
    }

    // NEW: Fast Moving Items Widget
    if (widgetId === 'fastMovingItems') {
        const items = data.fastMovingItems || [];
        const listHtml = items.length > 0 ? items.map((item, i) => `
            <div class="flex justify-between items-center py-2.5 border-b border-gray-50 last:border-0">
                <div class="flex items-center gap-3">
                    <span class="text-[10px] font-black text-gray-300">0${i + 1}</span>
                    <span class="text-sm font-bold text-gray-700 truncate w-28">${item.name}</span>
                </div>
                <div class="text-right">
                    <span class="text-xs font-black text-SLATE-600">${item.qty}</span>
                    <span class="text-[9px] text-gray-400 font-bold uppercase ml-1">Sold</span>
                </div>
            </div>
        `).join('') : '<div class="flex items-center justify-center h-full text-xs text-gray-400 italic py-10">Calculating monthly trends...</div>';

        return `
            <div class="h-full flex flex-col">
                <div class="flex justify-between items-start mb-4 border-b border-gray-50 pb-3">
                    <div>
                        <h3 class="font-bold text-gray-800 text-sm tracking-tight">Fast-Moving (30D)</h3>
                        <p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Monthly Trailing</p>
                    </div>
                    <span class="bg-SLATE-50 p-2 rounded-lg border border-SLATE-100 text-SLATE-600"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg></span>
                </div>
                <div class="flex-1 overflow-y-auto scrollbar-hide">
                    ${listHtml}
                </div>
            </div>
        `;
    }

    // Inside renderWidgetById (src/components/widgetRenderer.js)

    // Add to the bypass list at the top
    // And immediately after the bypass check, make sure the fallback object also uses the SVG:
    if (!widget && widgetId === 'inventoryForecast') {
        widget = { id: 'inventoryForecast', title: 'Stock-Up Suggestions', icon: '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>', bg: 'bg-amber-50', color: 'text-amber-700' };
    }
    // Add the HTML block
    if (widgetId === 'inventoryForecast') {
        const items = data.inventoryForecast || [];
        const currentMonth = new Date().toLocaleString('default', { month: 'long' });

        const listHtml = items.length > 0 ? items.map(item => `
            <div class="flex items-center justify-between py-2 border-b border-amber-100 last:border-0">
                <div class="flex flex-col">
                    <span class="text-sm font-bold text-gray-800">${item.name}</span>
                    <span class="text-[9px] text-amber-600 font-bold uppercase tracking-tighter">${item.reason}</span>
                </div>
                <div class="bg-amber-100 px-2 py-1 rounded text-right">
                    <p class="text-[9px] font-bold text-amber-800 uppercase leading-none">Stock Target</p>
                    <p class="text-sm font-black text-amber-900">${item.expectedDemand}</p>
                </div>
            </div>
        `).join('') : '<div class="text-center py-6 text-gray-400 text-xs italic">Gathering seasonal data...</div>';

        return `
            <div class="h-full flex flex-col">
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <h3 class="font-black text-gray-800 text-sm tracking-tight">${currentMonth} Strategy</h3>
                        <p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Predictive Restock</p>
                    </div>
                    <span class="text-amber-500"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg></span>
                </div>
                <div class="flex-1 overflow-y-auto scrollbar-hide">
                    ${listHtml}
                </div>
            </div>
        `;
    }

    return '';
}
export function renderChartToCanvas(canvasElement, chartData) {
    const chartInstance = typeof getSalesChartInstance === 'function' ? getSalesChartInstance() : null;
    if (chartInstance) chartInstance.destroy();

    if (!canvasElement || !chartData) return;

    const ctx = canvasElement.getContext('2d');
    if (!ctx) return;

    const currencySymbol = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(79, 70, 229, 0.4)');
    gradient.addColorStop(1, 'rgba(79, 70, 229, 0.01)');

    const newChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [{
                label: 'Revenue',
                data: chartData.data,
                backgroundColor: gradient,
                borderColor: '#4F46E5',
                borderWidth: 2.5,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: '#4F46E5',
                pointBorderWidth: 2.5,
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.9)',
                    padding: 12,
                    titleFont: { size: 13, family: "'Inter', sans-serif" },
                    bodyFont: { size: 14, weight: 'bold', family: "'Inter', sans-serif" },
                    displayColors: false,
                    callbacks: {
                        label: (ctx) => `${currencySymbol}${ctx.raw.toFixed(2)}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(243, 244, 246, 0.8)', drawBorder: false },
                    border: { display: false },
                    ticks: {
                        font: { size: 10, family: "'Inter', sans-serif", weight: '500' },
                        color: '#9CA3AF',
                        padding: 8,
                        callback: (val) => `${currencySymbol}${val}`
                    }
                },
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { font: { size: 10, family: "'Inter', sans-serif", weight: '500' }, color: '#6B7280', padding: 8 }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index',
            },
        }
    });

    if (typeof setSalesChartInstance === 'function') {
        setSalesChartInstance(newChartInstance);
    }
}

// --- Helper: Strict IST Time Boundaries ---
function getISTBoundaries() {
    // 1. Get current date parts forced to IST (+5:30)
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const parts = formatter.formatToParts(new Date());
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;

    const todayStr = `${y}-${m}-${d}`;

    // 2. Create an exact Date object for 00:00:00 IST today
    // This allows Firestore to query the correct UTC timestamps
    const startOfDayISTString = `${y}-${m}-${d}T00:00:00.000+05:30`;
    const startOfDayUTC = new Date(startOfDayISTString);

    return { todayStr, startOfDayUTC };
}

// --- 3. Interaction Handlers (Dialog Logic) ---

// Helper to inject a dialog
function injectDialog(title, contentHtml) {
    const existing = document.getElementById('widget-detail-dialog');
    if (existing) existing.remove();

    const dialogHtml = `
        <div id="widget-detail-dialog" class="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-60   opacity-0 ">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 transform scale-95 transition-transform duration-300 flex flex-col max-h-[85vh] overflow-hidden border border-gray-200">
                <!-- Header -->
                <div class="px-6 py-5 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <h3 class="text-xl font-extrabold text-gray-800 tracking-tight">${title}</h3>
                    <button id="close-widget-dialog" class="text-gray-400 hover:text-gray-700 hover:bg-gray-200 p-1 rounded-md transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                
                <!-- Content -->
                <div class="p-6 overflow-y-auto custom-scrollbar bg-white">
                    ${contentHtml}
                </div>
                
                <!-- Footer -->
                <div class="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
                    <button id="close-widget-dialog-btn" class="px-5 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 font-bold transition-colors shadow-sm">
                        Close
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', dialogHtml);

    const dialog = document.getElementById('widget-detail-dialog');
    const closeIcon = document.getElementById('close-widget-dialog');
    const closeBtn = document.getElementById('close-widget-dialog-btn');

    requestAnimationFrame(() => {
        dialog.classList.remove('opacity-0');
        dialog.querySelector('div').classList.remove('scale-95');
        dialog.querySelector('div').classList.add('scale-100');
    });

    const closeHandler = () => {
        dialog.classList.add('opacity-0');
        dialog.querySelector('div').classList.remove('scale-100');
        dialog.querySelector('div').classList.add('scale-95');
        setTimeout(() => dialog.remove(), 300);
    };

    closeIcon.onclick = closeHandler;
    closeBtn.onclick = closeHandler;
    dialog.onclick = (e) => {
        if (e.target === dialog) closeHandler();
    };
}

export async function handleWidgetInteraction(widgetId) {
    const storeId = typeof getStoreId === 'function' ? getStoreId() : null;
    if (!storeId) return;

    // 🚀 THE FIX: Removed the checkPlanLimits upgrade block. All interactions are allowed offline.

    switch (widgetId) {
        case 'revenueToday':
            await showRevenueHistory();
            break;
        case 'totalTransactionsToday':
            await showSalesCountHistory();
            break;
        case 'stockValueAtRisk':
            await showRiskList();
            break;
        case 'availableStaff':
            // This is actually handled directly in dashboard.js now via double-click, 
            // but we leave it here for safety.
            if (typeof window.showView === 'function') window.showView('staff');
            break;
        case 'topProductsToday':
            await showTopProductsHistory();
            break;
        default:
            console.log("No interaction mapped for:", widgetId);
    }
}

async function showRevenueHistory() {
    injectDialog('Revenue History', `
        <div class="flex justify-center items-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-SLATE-600"></div>
        </div>
    `);

    const storeId = typeof getStoreId === 'function' ? getStoreId() : null;
    const currencySymbol = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';

    let html = `<div class="overflow-hidden rounded-xl border border-gray-200 shadow-sm"><table class="w-full text-sm text-left"><thead class="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wider font-bold"><tr><th class="px-5 py-3">Date</th><th class="px-5 py-3 text-right">Revenue</th></tr></thead><tbody class="divide-y divide-gray-100">`;

    let totalRev = 0;

    for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const dateStr = getLocalDateString(d);
        const displayDate = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

        try {
            const snap = await getDoc(doc(db, `artifacts/${appId}/stores/${storeId}/summaries_daily/${dateStr}`));

            // 🚀 THE FIX: Extract actual revenue, fallback to legacy 'sales' for older records
            let val = 0;
            if (snap.exists()) {
                const rawData = snap.data();
                val = rawData.revenue !== undefined ? rawData.revenue : (rawData.sales || 0);
            }

            html += `<tr class="hover:bg-gray-50 transition-colors"><td class="px-5 py-3 font-medium text-gray-800">${displayDate}</td><td class="px-5 py-3 text-right font-extrabold text-SLATE-600">${currencySymbol}${(val || 0).toFixed(2)}</td></tr>`;
            totalRev += (val || 0);
        } catch (e) { }
    }

    html += `</tbody><tfoot class="bg-gray-50 text-gray-800 font-bold border-t-2 border-gray-200"><tr><td class="px-5 py-3 uppercase text-xs tracking-wider text-gray-500">Total (7 Days)</td><td class="px-5 py-3 text-right text-lg text-gray-900">${currencySymbol}${totalRev.toFixed(2)}</td></tr></tfoot></table></div>`;

    const contentContainer = document.querySelector('#widget-detail-dialog .p-6');
    if (contentContainer) contentContainer.innerHTML = html;
}

async function showSalesCountHistory() {
    injectDialog('Sales Count History', `
        <div class="flex justify-center items-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-SLATE-600"></div>
        </div>
    `);

    const storeId = typeof getStoreId === 'function' ? getStoreId() : null;

    let html = `<div class="overflow-hidden rounded-xl border border-gray-200 shadow-sm"><table class="w-full text-sm text-left"><thead class="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wider font-bold"><tr><th class="px-5 py-3">Date</th><th class="px-5 py-3 text-center">Transactions</th></tr></thead><tbody class="divide-y divide-gray-100">`;

    let totalCount = 0;

    for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const dateStr = getLocalDateString(d);
        const displayDate = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

        try {
            const snap = await getDoc(doc(db, `artifacts/${appId}/stores/${storeId}/summaries_daily/${dateStr}`));
            const val = snap.exists() ? snap.data().sales : 0;
            html += `<tr class="hover:bg-gray-50 transition-colors"><td class="px-5 py-3 font-medium text-gray-800">${displayDate}</td><td class="px-5 py-3 text-center font-extrabold text-SLATE-600 bg-SLATE-50/30">${val || 0}</td></tr>`;
            totalCount += (val || 0);
        } catch (e) { }
    }
    html += `</tbody><tfoot class="bg-gray-50 font-bold text-gray-800 border-t-2 border-gray-200"><tr><td class="px-5 py-3 uppercase text-xs tracking-wider text-gray-500">Total (7 Days)</td><td class="px-5 py-3 text-center text-lg text-gray-900">${totalCount}</td></tr></tfoot></table></div>`;

    const contentContainer = document.querySelector('#widget-detail-dialog .p-6');
    if (contentContainer) contentContainer.innerHTML = html;
}

async function showRiskList() {
    injectDialog('Stock at Risk', `
        <div class="flex justify-center items-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-SLATE-600"></div>
        </div>
    `);

    const productsRef = getProductsRef();
    const currencySymbol = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';

    const q = query(productsRef, where("stockLevel", "<=", 5), limit(50));
    const snap = await getDocs(q);

    if (snap.empty) {
        const contentContainer = document.querySelector('#widget-detail-dialog .p-6');
        if (contentContainer) contentContainer.innerHTML = `<div class="text-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-200"><div class="text-emerald-500 mb-3 flex justify-center"><svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></div><p class="text-gray-800 font-bold">No low stock items found.</p><p class="text-sm text-gray-500 mt-1">Your inventory looks healthy!</p></div>`;
        return;
    }

    let html = `<div class="overflow-hidden rounded-xl border border-gray-200 shadow-sm"><table class="w-full text-sm text-left"><thead class="bg-red-50 text-red-700 uppercase text-[10px] tracking-wider font-bold"><tr><th class="px-5 py-3">Product</th><th class="px-5 py-3 text-right">Value at Risk</th></tr></thead><tbody class="divide-y divide-gray-100">`;
    snap.forEach(d => {
        const p = d.data();
        const val = safeMath.multiply(p.cost, p.stockLevel);
        html += `<tr class="hover:bg-red-50/30 transition-colors"><td class="px-5 py-3 font-semibold text-gray-800">${p.name} <span class="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full ml-2 shadow-sm border border-red-200">Qty: ${p.stockLevel}</span></td><td class="px-5 py-3 text-right text-gray-600 font-mono">${currencySymbol}${val.toFixed(2)}</td></tr>`;
    });
    html += `</tbody></table></div>`;

    const contentContainer = document.querySelector('#widget-detail-dialog .p-6');
    if (contentContainer) contentContainer.innerHTML = html;
}

async function showStaffOnDuty() {
    injectDialog('Staff On Duty', `
        <div class="flex justify-center items-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-SLATE-600"></div>
        </div>
    `);

    // Ensure we resolve the current staff member's specific branch assignment securely
    const storeId = typeof getStoreId === 'function' ? getStoreId() : null;
    const locId = typeof getCurrentLocationId === 'function' ? getCurrentLocationId() : null;
    let targetLocation = (locId && locId !== 'all') ? locId : storeId;
    if (targetLocation === 'main') targetLocation = storeId;

    const todayStr = getLocalDateString(new Date());
    const snap = await getDoc(doc(db, `artifacts/${appId}/stores/${targetLocation}/attendance/${todayStr}`));

    let content = '';

    if (!snap.exists() || !snap.data().records) {
        content = `<div class="text-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-500 font-medium">No attendance records found for today.</div>`;
    } else {
        const records = snap.data().records;
        const presentIds = Object.keys(records).filter(id => records[id] === 'P' || records[id] === 'HD');

        if (presentIds.length === 0) {
            content = `<div class="text-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-500 font-medium">No staff marked present today.</div>`;
        } else {
            let listItems = '';
            for (const uid of presentIds) {
                const userDoc = await getDoc(doc(db, 'userProfiles', uid));
                const name = userDoc.exists() ? userDoc.data().name : 'Unknown Staff';
                const status = records[uid] === 'P' ? 'Present' : 'Half Day';
                const statusColor = status === 'Present' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200';

                listItems += `
                    <li class="flex justify-between items-center p-4 bg-gray-50 border border-gray-100 rounded-xl hover:bg-white hover:shadow-md hover:border-gray-200 transition-all">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-SLATE-100 flex items-center justify-center text-SLATE-700 font-bold text-sm shadow-sm border border-SLATE-200">
                                ${name.charAt(0).toUpperCase()}
                            </div>
                            <span class="font-bold text-gray-800">${name}</span>
                        </div>
                        <span class="text-xs font-bold px-3 py-1 rounded-full border shadow-sm ${statusColor}">${status}</span>
                    </li>
                `;
            }
            content = `<ul class="space-y-3">${listItems}</ul>`;
        }
    }

    const contentContainer = document.querySelector('#widget-detail-dialog .p-6');
    if (contentContainer) contentContainer.innerHTML = content;
}

async function showTopProductsHistory() {
    injectDialog('Top Products (Expanded)', `
        <div class="flex justify-center items-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-SLATE-600"></div>
        </div>
    `);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const transactionsRef = getTransactionsRef();

    const q = query(
        transactionsRef,
        where("timestamp", ">=", startOfDay),
        orderBy("timestamp", "desc"),
        limit(200)
    );

    try {
        const snap = await getDocs(q);
        const productSalesMap = {};

        snap.forEach(doc => {
            const tx = doc.data();
            if (tx.items && Array.isArray(tx.items)) {
                tx.items.forEach(item => {
                    const name = item.name || 'Unknown';
                    const qty = item.quantity || 0;
                    if (qty > 0) {
                        productSalesMap[name] = (productSalesMap[name] || 0) + qty;
                    }
                });
            }
        });

        const topProducts = Object.entries(productSalesMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([name, qty]) => ({ name, qty }));

        if (topProducts.length === 0) {
            const contentContainer = document.querySelector('#widget-detail-dialog .p-6');
            if (contentContainer) contentContainer.innerHTML = `<div class="text-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-500 font-medium">No sales recorded today yet.</div>`;
            return;
        }

        let html = `<div class="overflow-hidden rounded-xl border border-gray-200 shadow-sm"><table class="w-full text-sm text-left"><thead class="bg-SLATE-50 text-SLATE-800 uppercase text-[10px] tracking-wider font-bold"><tr><th class="px-5 py-3">Rank</th><th class="px-5 py-3">Product Name</th><th class="px-5 py-3 text-right">Qty Sold</th></tr></thead><tbody class="divide-y divide-gray-100">`;

        topProducts.forEach((item, index) => {
            let rankClass = "bg-gray-100 text-gray-500 border border-gray-200 shadow-sm";
            if (index === 0) rankClass = "bg-gradient-to-br from-yellow-200 to-yellow-400 text-yellow-900 border border-yellow-400 shadow-md";
            if (index === 1) rankClass = "bg-gradient-to-br from-gray-200 to-gray-300 text-gray-800 border border-gray-400 shadow-sm";
            if (index === 2) rankClass = "bg-gradient-to-br from-orange-200 to-orange-300 text-orange-900 border border-orange-400 shadow-sm";

            html += `
                <tr class="hover:bg-gray-50 transition-colors">
                    <td class="px-5 py-3">
                        <span class="w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold ${rankClass}">${index + 1}</span>
                    </td>
                    <td class="px-5 py-3 font-semibold text-gray-800">${item.name}</td>
                    <td class="px-5 py-3 text-right font-extrabold text-SLATE-600 bg-SLATE-50/20">${item.qty}</td>
                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        const contentContainer = document.querySelector('#widget-detail-dialog .p-6');
        if (contentContainer) contentContainer.innerHTML = html;

    } catch (e) {
        console.error("Error fetching top products:", e);
        const contentContainer = document.querySelector('#widget-detail-dialog .p-6');
        if (contentContainer) contentContainer.innerHTML = `<div class="text-center py-8 text-red-500 font-bold">Error loading data.</div>`;
    }
}
export async function renderFinancialAlerts() {
    const dashboardContainer = document.getElementById('dashboard') || document.querySelector('.dashboard-wrapper');
    if (!dashboardContainer) return;

    const existingAlerts = document.getElementById('financial-alerts-container');
    if (existingAlerts) existingAlerts.remove();

    const alertsContainer = document.createElement('div');
    alertsContainer.id = 'financial-alerts-container';
    alertsContainer.className = 'w-full mb-6 space-y-3';

    let hasAlerts = false;
    let alertsHtml = '';
    const currency = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₹';

    try {
        let totalReceivables = 0; let receivablesCount = 0;
        let totalPayables = 0; let payablesCount = 0;

        // 1. 🚀 FETCH ALL PARTNER BALANCES (SQLite Offline)
        if (window.dbAPI && window.dbAPI.getCustomers) {
            const customers = await window.dbAPI.getCustomers();

            customers.forEach(data => {
                const rawBal = (parseFloat(data.dues) || 0) + (parseFloat(data.balance) || 0);

                if (rawBal > 0.01) {
                    totalReceivables += rawBal;
                    receivablesCount++;
                } else if (rawBal < -0.01) {
                    totalPayables += Math.abs(rawBal);
                    payablesCount++;
                }
            });
        }

        // 2. 🚀 FETCH PENDING CHEQUES (SQLite Offline)
        let pendingChequeCount = 0;
        let pendingChequeValue = 0;
        const today = new Date().toISOString().split('T')[0];

        if (window.dbAPI && window.dbAPI.getPendingCheques) {
            const cheques = await window.dbAPI.getPendingCheques();
            cheques.forEach(data => {
                const clDate = data.summary?.chequeDetails?.clearanceDate;
                if (clDate && clDate <= today) {
                    pendingChequeCount++;
                    pendingChequeValue += Math.abs(data.summary?.total || 0);
                }
            });
        }

        // 3. 🚀 BUILD THE UI BANNERS

        if (pendingChequeCount > 0) {
            hasAlerts = true;
            alertsHtml += `
                <div class="bg-red-50 border border-red-200 p-4 rounded-2xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div class="flex items-center gap-3">
                        <div class="bg-red-100 p-3 rounded-xl text-red-600 shrink-0">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        </div>
                        <div>
                            <h4 class="text-red-800 font-black text-sm tracking-tight">Action Required: Pending Cheques</h4>
                            <p class="text-red-600 text-xs mt-0.5 font-medium">You have <b class="text-red-800 text-sm">${pendingChequeCount}</b> cheque(s) totaling <b class="text-red-800 text-sm">${currency}${pendingChequeValue.toFixed(2)}</b> ready for bank clearance.</p>
                        </div>
                    </div>
                    <button onclick="document.querySelector('.tab-button[data-view=\\'customers\\']')?.click(); setTimeout(() => { if(window.openFinancialRegistry) window.openFinancialRegistry('CHEQUES'); }, 400);" class="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow border border-red-700 transition-transform active:scale-95 whitespace-nowrap w-full sm:w-auto">
                        Review Cheques
                    </button>
                </div>
            `;
        }

        if (totalReceivables > 0) {
            hasAlerts = true;
            alertsHtml += `
                <div class="bg-amber-50 border border-amber-200 p-4 rounded-2xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div class="flex items-center gap-3">
                        <div class="bg-amber-100 p-3 rounded-xl text-amber-600 shrink-0">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>
                        <div>
                            <h4 class="text-amber-800 font-black text-sm tracking-tight">Outstanding Market Credit</h4>
                            <p class="text-amber-600 text-xs mt-0.5 font-medium"><b class="text-amber-800">${receivablesCount}</b> partners currently owe you a total of <b class="text-amber-800">${currency}${totalReceivables.toFixed(2)}</b> in unpaid Udhaar.</p>
                        </div>
                    </div>
                    <button onclick="document.querySelector('.tab-button[data-view=\\'customers\\']')?.click(); setTimeout(() => { if(window.openFinancialRegistry) window.openFinancialRegistry('RECEIVABLES'); }, 400);" class="bg-amber-500 hover:bg-amber-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow border border-amber-600 transition-transform active:scale-95 whitespace-nowrap w-full sm:w-auto">
                        Collect Dues
                    </button>
                </div>
            `;
        }

        if (totalPayables > 0) {
            hasAlerts = true;
            alertsHtml += `
                <div class="bg-blue-50 border border-blue-200 p-4 rounded-2xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div class="flex items-center gap-3">
                        <div class="bg-blue-100 p-3 rounded-xl text-blue-600 shrink-0">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                        </div>
                        <div>
                            <h4 class="text-blue-800 font-black text-sm tracking-tight">Pending Payables</h4>
                            <p class="text-blue-600 text-xs mt-0.5 font-medium">You currently owe <b class="text-blue-800">${currency}${totalPayables.toFixed(2)}</b> to <b class="text-blue-800">${payablesCount}</b> partners.</p>
                        </div>
                    </div>
                    <button onclick="document.querySelector('.tab-button[data-view=\\'customers\\']')?.click(); setTimeout(() => { if(window.openFinancialRegistry) window.openFinancialRegistry('PAYABLES'); }, 400);" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow border border-blue-700 transition-transform active:scale-95 whitespace-nowrap w-full sm:w-auto">
                        Settle Payables
                    </button>
                </div>
            `;
        }

        // 4. 🚀 INJECT INTO DASHBOARD
        if (hasAlerts) {
            alertsContainer.innerHTML = alertsHtml;
            const firstRow = dashboardContainer.querySelector('.grid') || dashboardContainer.firstChild;
            if (firstRow) {
                alertsContainer.classList.add('mt-4', 'px-4', 'sm:px-6', 'lg:px-8');
                dashboardContainer.insertBefore(alertsContainer, firstRow);
            }
        }

    } catch (e) {
        console.error("Failed to load financial alerts:", e);
    }
}