// src/components/production.js


import {
    getProductsRef, getTransactionsRef, getCustomersRef, appId, getStoreId, getUserId,
    getCurrencyCode, getCurrencySymbol, hasFeatureAccess, getCurrentUserPlan, getCurrentLocationId
} from '../store/state.js';
import { showModal, showToast } from '../utils/dom.js';
import { escapeHTML } from '../utils/security.js';

let rawMaterials = [];
let recipes = [];
let currentRecipeComponents = [];
let unsubscribeProduction = null;

// Expose to window for inline HTML onclick handlers
window.openRecipeBuilderModal = openRecipeBuilderModal;
window.openProductionModal = openProductionModal;
window.processProductionBatch = processProductionBatch;
window.autoMergeRawMaterials = autoMergeRawMaterials;

window.removeRecipeComponent = function (index) {
    currentRecipeComponents.splice(index, 1);
    renderRecipeComponents();
};

export function initProductionUI(containerElement) {
    const userPlan = typeof getCurrentUserPlan === 'function' ? getCurrentUserPlan() : 'free';

    if (!hasFeatureAccess(userPlan, 'manufacturing')) {
        containerElement.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 px-4 text-center bg-white rounded-2xl shadow-sm border border-gray-200">
                <div class="w-20 h-20 bg-SLATE-50 text-SLATE-500 rounded-full flex items-center justify-center mb-6 shadow-inner">
                    <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                </div>
                <h2 class="text-2xl font-black text-gray-800 mb-2 tracking-tight">Manufacturing Locked</h2>
                <p class="text-gray-500 max-w-md mb-8 font-medium">The Manufacturing & Bill of Materials (BOM) module is exclusively available on the Platinum and Diamond plans.</p>
                <button onclick="document.querySelector('[data-view=\\'subscription\\']')?.click()" class="bg-SLATE-600 hover:bg-SLATE-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg shadow-SLATE-200 transition-transform active:scale-95 flex items-center gap-2">
                    <span>⭐</span> View Upgrade Options
                </button>
            </div>
        `;
        return; // 🛑 Halt the entire UI build!
    }
    const html = `
        <div class="  space-y-6 pb-20">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
                    </div>
                    <div>
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Raw Materials</p>
                        <h3 class="text-2xl font-black text-slate-800" id="metric-raw-count">0</h3>
                    </div>
                </div>
                <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
                    </div>
                    <div>
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Recipes</p>
                        <h3 class="text-2xl font-black text-slate-800" id="metric-recipe-count">0</h3>
                    </div>
                </div>
                <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                    </div>
                    <div>
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Batches Ready</p>
                        <h3 class="text-2xl font-black text-slate-800" id="metric-production-count">...</h3>
                    </div>
                </div>
            </div>

            <div class="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div class="flex gap-2">
                    <button id="btn-view-recipes" class="px-4 py-2 bg-slate-800 text-white text-sm font-bold rounded-lg shadow-sm transition-colors">Recipes / Output</button>
                    <button id="btn-view-raw" class="px-4 py-2 bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 text-sm font-bold rounded-lg transition-colors">Raw Materials</button>
                </div>
                <div class="flex gap-2">
                    <button onclick="window.autoMergeRawMaterials()" class="px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 text-sm font-bold rounded-lg transition-colors flex items-center gap-2" title="Merge identical raw materials to clean up your list">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg> Clean Duplicates
                    </button>
                    <button id="btn-add-raw" class="px-4 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 text-sm font-bold rounded-lg transition-colors flex items-center gap-2">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg> Add Raw Material
                    </button>
                    <button id="btn-add-recipe" class="px-4 py-2 bg-purple-600 text-white hover:bg-purple-700 text-sm font-bold rounded-lg shadow-md transition-colors flex items-center gap-2">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg> Create Recipe
                    </button>
                </div>
            </div>

            <div id="production-content-area" class="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden min-h-[400px]">
                <div class="p-8 text-center text-slate-500 font-bold animate-pulse">Loading manufacturing data...</div>
            </div>
        </div>
    `;

    containerElement.innerHTML = html;

    document.getElementById('btn-view-recipes').onclick = (e) => switchTab(e.target, 'recipes');
    document.getElementById('btn-view-raw').onclick = (e) => switchTab(e.target, 'raw');

    document.getElementById('btn-add-raw').onclick = openRawMaterialModal;
    document.getElementById('btn-add-recipe').onclick = () => openRecipeBuilderModal();

    setupProductionListener();
}

function switchTab(activeBtn, tabName) {
    ['btn-view-recipes', 'btn-view-raw'].forEach(id => {
        document.getElementById(id).className = "px-4 py-2 bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 text-sm font-bold rounded-lg transition-colors";
    });
    activeBtn.className = "px-4 py-2 bg-slate-800 text-white text-sm font-bold rounded-lg shadow-sm transition-colors";

    const contentArea = document.getElementById('production-content-area');

    if (tabName === 'raw') renderRawMaterialsTable(contentArea);
    else if (tabName === 'recipes') renderRecipesTable(contentArea);
}

// ============================================================================
// 📡 DATABASE ENGINE & AUTO-MERGE
// ============================================================================

function setupProductionListener() {
    const productsRef = getProductsRef();
    if (!productsRef) return;

    if (unsubscribeProduction) unsubscribeProduction();

    const q = query(productsRef, where("type", "in", ["raw_material", "manufactured"]));

    unsubscribeProduction = onSnapshot(q, (snapshot) => {
        rawMaterials = [];
        recipes = [];

        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            if (data.type === 'raw_material') rawMaterials.push(data);
            if (data.type === 'manufactured') recipes.push(data);
        });

        document.getElementById('metric-raw-count').textContent = rawMaterials.length;
        document.getElementById('metric-recipe-count').textContent = recipes.length;

        const activeTabBtn = document.querySelector('#btn-view-recipes').classList.contains('bg-slate-800') ? 'recipes' : 'raw';
        const contentArea = document.getElementById('production-content-area');

        if (activeTabBtn === 'raw') renderRawMaterialsTable(contentArea);
        else renderRecipesTable(contentArea);

    }, (error) => console.error("Production DB Error:", error));
}

async function autoMergeRawMaterials() {
    const btn = document.querySelector('button[title="Merge identical raw materials to clean up your list"]');
    if (btn) btn.innerHTML = `<svg class="animate-spin w-4 h-4" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Cleaning...`;

    try {
        const productsRef = getProductsRef();
        const batch = writeBatch(db);

        const groups = {};
        let mergedCount = 0;

        // Group materials by exact Name, Unit, and Cost
        rawMaterials.forEach(rm => {
            const key = `${rm.name.toLowerCase().trim()}_${rm.unit}_${parseFloat(rm.cost || 0).toFixed(2)}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(rm);
        });

        for (const [key, duplicates] of Object.entries(groups)) {
            if (duplicates.length > 1) {
                const master = duplicates[0];
                let totalStock = parseFloat(master.stockLevel || 0);

                for (let i = 1; i < duplicates.length; i++) {
                    const dup = duplicates[i];
                    totalStock += parseFloat(dup.stockLevel || 0);

                    // Mark duplicate for deletion
                    batch.delete(doc(productsRef, dup.id));
                    mergedCount++;
                }

                // Update Master with combined stock
                batch.update(doc(productsRef, master.id), { stockLevel: totalStock });
            }
        }

        if (mergedCount > 0) {
            await batch.commit();
            showToast("Directory Cleaned", `Merged ${mergedCount} duplicate raw materials!`, "success");
        } else {
            showToast("Clean", "No exact duplicates found.", "info");
        }

    } catch (e) {
        console.error(e);
        showToast("Error", "Merge failed.", "error");
    } finally {
        if (btn) btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg> Clean Duplicates`;
    }
}
// ============================================================================
// 📦 RAW MATERIALS TAB
// ============================================================================

function renderRawMaterialsTable(container) {
    if (rawMaterials.length === 0) {
        container.innerHTML = `<div class="p-10 text-center text-slate-400 font-medium">No raw materials defined yet.<br>Click "+ Add Raw Material" to start tracking supplies.</div>`;
        return;
    }

    let rows = rawMaterials.map(m => `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer group" ondblclick="window.viewRawMaterialDetails('${m.id}')">
            <td class="p-4 font-bold text-slate-800">${escapeHTML(m.name)}</td>
            <td class="p-4 text-slate-500 font-mono text-sm">${escapeHTML(m.sku || '-')}</td>
            <td class="p-4">
                <span class="font-black ${m.stockLevel > 0 ? 'text-blue-600' : 'text-red-500'}">${m.stockLevel}</span>
                <span class="text-xs text-slate-400 font-bold ml-1 uppercase">${escapeHTML(m.unit || 'units')}</span>
            </td>
            <td class="p-4 text-slate-600 font-medium">₹${parseFloat(m.cost || 0).toFixed(2)}</td>
            <td class="p-4 text-slate-500 font-medium">${parseFloat(m.gstSlab || 0)}%</td>
            <td class="p-4 text-right flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onclick="window.viewRawMaterialDetails('${m.id}')" class="text-SLATE-600 font-bold text-xs bg-SLATE-50 hover:bg-SLATE-100 px-3 py-1.5 rounded-lg transition-colors">Details</button>
                <button onclick="window.deleteRawMaterial('${m.id}', '${escapeHTML(m.name)}')" class="text-red-600 font-bold text-xs bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors">Del</button>
            </td>
        </tr>
    `).join('');

    container.innerHTML = `
        <table class="w-full text-left">
            <thead class="bg-slate-50 border-b border-slate-200">
                <tr class="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    <th class="p-4">Material Name</th>
                    <th class="p-4">Code/SKU</th>
                    <th class="p-4">Current Stock</th>
                    <th class="p-4">Est. Cost</th>
                    <th class="p-4">GST Slab</th>
                    <th class="p-4 text-right">Actions</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <p class="text-[10px] text-slate-400 text-center mt-3 font-medium uppercase tracking-widest">Double-click a row to view full details</p>
    `;
}

window.viewRawMaterialDetails = function (id) {
    const m = rawMaterials.find(x => x.id === id);
    if (!m) return;

    const modalId = 'raw-details-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[200] bg-slate-900/60   flex items-center justify-center p-4">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md  overflow-hidden border border-slate-100">
                <div class="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h3 class="font-black text-slate-800 text-lg flex items-center gap-2">
                        <span class="bg-blue-100 text-blue-600 p-1.5 rounded-lg">📦</span> ${escapeHTML(m.name)}
                    </h3>
                    <button onclick="document.getElementById('${modalId}').remove()" class="text-slate-400 hover:text-red-500 transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="p-6 space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div class="bg-slate-50 p-3 rounded-lg border border-slate-100">
                            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Current Stock</p>
                            <p class="text-xl font-black text-blue-600">${m.stockLevel} <span class="text-xs text-slate-500 uppercase">${escapeHTML(m.unit)}</span></p>
                        </div>
                        <div class="bg-slate-50 p-3 rounded-lg border border-slate-100">
                            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Unit Cost</p>
                            <p class="text-xl font-black text-slate-700">₹${parseFloat(m.cost || 0).toFixed(2)}</p>
                        </div>
                    </div>
                    <div class="border-t border-slate-100 pt-4 mt-2">
                        <h4 class="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-3">Primary Supplier Info</h4>
                        <div class="space-y-2 text-sm">
                            <div class="flex justify-between"><span class="text-slate-500 font-bold">Supplier Name:</span> <span class="font-medium text-slate-800">${escapeHTML(m.dealerName || 'N/A')}</span></div>
                            <div class="flex justify-between"><span class="text-slate-500 font-bold">Phone:</span> <span class="font-mono text-slate-800">${escapeHTML(m.dealerPhone || 'N/A')}</span></div>
                            <div class="flex justify-between"><span class="text-slate-500 font-bold">GSTIN:</span> <span class="font-mono text-slate-800">${escapeHTML(m.dealerGstin || 'N/A')}</span></div>
                            <div class="flex justify-between"><span class="text-slate-500 font-bold">Invoice:</span> <span class="font-mono text-slate-800">${escapeHTML(m.supplierInvoice || 'N/A')}</span></div>
                            <div class="flex justify-between"><span class="text-slate-500 font-bold">Merchant ID:</span> <span class="font-mono text-[10px] text-slate-400 mt-1">${escapeHTML(m.dealerId || 'N/A')}</span></div>
                            <div class="flex justify-between mt-2 pt-2 border-t border-slate-50"><span class="text-slate-500 font-bold">GST Slab:</span> <span class="font-medium text-slate-800">${m.gstSlab || 0}%</span></div>
                            <div class="flex justify-between"><span class="text-slate-500 font-bold">SKU Code:</span> <span class="font-mono text-slate-800">${escapeHTML(m.sku)}</span></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
};

window.deleteRawMaterial = async function (id, name) {
    // Check if this material is used in any active recipes
    const isUsed = recipes.some(r => r.recipe && r.recipe.some(c => c.rawMaterialId === id));
    if (isUsed) {
        showModal('Cannot Delete', `<b>${escapeHTML(name)}</b> is currently used in an active recipe. Remove it from all recipes first before deleting.`, 'error');
        return;
    }

    if (confirm(`Are you sure you want to permanently delete ${name}?`)) {
        try {
            // We now rely on the static imports at the top of the file.
            const productsRef = getProductsRef();
            await deleteDoc(doc(productsRef, id));

            if (typeof showToast === 'function') showToast("Deleted", `${name} has been removed.`, "success");
        } catch (e) {
            console.error(e);
            alert("Failed to delete raw material.");
        }
    }
};
function openRawMaterialModal() {
    const modalId = 'raw-material-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[150] bg-slate-900/60   flex items-center justify-center p-4">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl  overflow-hidden border border-slate-100 flex flex-col max-h-[95vh]">
                
                <div class="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
                    <div>
                        <h3 class="font-black text-slate-800 text-lg flex items-center gap-2">
                            <span class="bg-blue-100 text-blue-600 p-1.5 rounded-lg">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
                            </span> 
                            Purchase Raw Material
                        </h3>
                    </div>
                    <button id="close-raw-btn" class="text-slate-400 hover:text-red-500 transition-colors bg-white p-2 rounded-full border border-slate-100 shadow-sm">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto p-6 bg-slate-50 space-y-6">
                    
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div class="md:col-span-2">
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Product Name *</label>
                            <input type="text" id="raw-name" class="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:border-blue-500 outline-none font-bold text-slate-800" placeholder="e.g. Raw Milk">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Unit Type</label>
                            <select id="raw-unit" class="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:border-blue-500 outline-none bg-white font-medium text-slate-700">
                                <option value="kg">Kilograms (kg)</option>
                                <option value="L">Litres (L)</option>
                                <option value="units">Units (pcs)</option>
                                <option value="g">Grams (g)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Expiry / Best Before</label>
                            <input type="date" id="raw-expiry" class="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:border-blue-500 outline-none font-bold text-slate-700 bg-white">
                        </div>
                    </div>

                    <div class="bg-white border border-blue-100 rounded-xl shadow-sm overflow-hidden">
                        <div class="bg-blue-50/50 px-4 py-2 border-b border-blue-100 flex items-center gap-2">
                            <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                            <h4 class="text-[10px] font-black text-blue-700 uppercase tracking-widest">Purchase Invoice & Tax Breakdown</h4>
                        </div>
                        <div class="p-5 grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
                            <div class="relative">
                                <div class="flex justify-between mb-1">
                                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Base Rate (₹)</label>
                                    <label class="flex items-center cursor-pointer bg-slate-200/60 rounded px-0.5 py-0.5 border border-slate-200 select-none shadow-inner shrink-0" title="Is the tax already included in the base rate?">
                                        <input type="checkbox" id="raw-tax-inclusive" class="sr-only peer">
                                        <span class="px-1.5 py-[1px] text-[9px] font-bold rounded-sm transition-all peer-checked:text-slate-400 peer-checked:bg-transparent bg-white shadow-sm text-blue-700 whitespace-nowrap">+ TAX</span>
                                        <span class="px-1.5 py-[1px] text-[9px] font-bold rounded-sm transition-all peer-checked:bg-white peer-checked:shadow-sm peer-checked:text-blue-700 text-slate-400 bg-transparent whitespace-nowrap">INCL</span>
                                    </label>
                                </div>
                                <input type="number" id="raw-cost" class="w-full border border-slate-200 rounded-lg p-2 text-sm focus:border-blue-500 outline-none font-bold" placeholder="0.00">
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Qty Added</label>
                                <input type="number" id="raw-stock" class="w-full border border-blue-200 rounded-lg p-2 text-sm focus:border-blue-500 outline-none bg-blue-50 text-blue-900 font-black" placeholder="0">
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">GST Slab (%)</label>
                                <select id="raw-gst" class="w-full border border-slate-200 rounded-lg p-2 text-sm focus:border-blue-500 outline-none bg-white font-bold">
                                    <option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Taxable Amt</label>
                                <input type="text" id="raw-taxable-display" class="w-full border border-slate-100 bg-slate-50 rounded-lg p-2 text-sm font-medium text-slate-600" readonly value="₹0.00">
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Net Amount</label>
                                <input type="text" id="raw-net-display" class="w-full border border-blue-100 bg-blue-50 rounded-lg p-2 text-sm font-black text-blue-900 shadow-sm" readonly value="₹0.00">
                            </div>
                        </div>
                    </div>

                    <div class="bg-white border border-amber-100 rounded-xl shadow-sm overflow-hidden">
                        <div class="bg-amber-50/50 px-4 py-2 border-b border-amber-100 flex items-center gap-2">
                            <svg class="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path></svg>
                            <h4 class="text-[10px] font-black text-amber-700 uppercase tracking-widest">Supplier Routing & Compliance</h4>
                        </div>
                        <div class="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Dealer Phone</label>
                                <input type="text" id="raw-sup-phone" class="w-full border border-slate-200 rounded-lg p-2 text-sm focus:border-amber-500 outline-none font-mono" placeholder="10 Digits">
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Store Name (Supplier)</label>
                                <input type="text" id="raw-sup-name" class="w-full border border-slate-200 rounded-lg p-2 text-sm focus:border-amber-500 outline-none font-bold" placeholder="Auto-fetch profile">
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Invoice Number</label>
                                <input type="text" id="raw-sup-invoice" class="w-full border border-slate-200 rounded-lg p-2 text-sm focus:border-amber-500 outline-none font-bold uppercase" placeholder="e.g. SL-001">
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Supplier GSTIN</label>
                                <input type="text" id="raw-sup-gstin" class="w-full border border-slate-200 rounded-lg p-2 text-sm focus:border-amber-500 outline-none font-mono uppercase" placeholder="15 Chars">
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Supplier PAN</label>
                                <input type="text" id="raw-sup-pan" class="w-full border border-slate-200 rounded-lg p-2 text-sm focus:border-amber-500 outline-none font-mono uppercase" placeholder="10 Chars">
                            </div>
                            
                            <input type="hidden" id="raw-sup-id">
                        </div>
                    </div>

                    <div class="bg-SLATE-50 border border-SLATE-100 rounded-xl p-5">
                        <h4 class="text-[10px] font-black text-SLATE-800 uppercase tracking-widest mb-3">Payment Details (Settlement)</h4>
                        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-slate-500 mb-1">Payment Mode</label>
                                <select id="raw-payment-method" class="w-full border border-SLATE-200 rounded-lg p-2.5 text-sm font-bold text-SLATE-700 bg-white focus:ring-SLATE-500 outline-none shadow-sm cursor-pointer transition-colors hover:border-SLATE-300">
                                    <option value="CREDIT">Credit (Udhaar / Unpaid)</option>
                                    <option value="CASH">Cash (Paid Immediately)</option>
                                    <option value="UPI">UPI / Digital</option>
                                    <option value="CHEQUE">Cheque</option>
                                </select>
                            </div>
                            <div id="raw-cheque-drawer" class="hidden md:col-span-3 grid-cols-3 gap-3">
                                <div>
                                    <label class="block text-[10px] font-bold text-SLATE-400 uppercase mb-1">Bank Name</label>
                                    <input type="text" id="raw-cheque-bank" class="w-full border border-SLATE-100 rounded-lg p-2 text-sm outline-none" placeholder="e.g. SBI">
                                </div>
                                <div>
                                    <label class="block text-[10px] font-bold text-SLATE-400 uppercase mb-1">Cheque No.</label>
                                    <input type="text" id="raw-cheque-no" class="w-full border border-SLATE-100 rounded-lg p-2 text-sm font-mono outline-none" placeholder="6 Digits">
                                </div>
                                <div>
                                    <label class="block text-[10px] font-bold text-SLATE-400 uppercase mb-1">Clearance Date</label>
                                    <input type="date" id="raw-cheque-date" class="w-full border border-SLATE-100 rounded-lg p-2 text-sm outline-none text-slate-500">
                                </div>
                            </div>
                        </div>
                    </div>

                </div>

                <div class="p-5 border-t border-slate-100 bg-white flex justify-end gap-3 shrink-0">
                    <button id="cancel-raw-btn" class="px-6 py-3 text-slate-600 font-bold bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">Cancel</button>
                    <button id="save-raw-btn" class="px-8 py-3 bg-blue-600 text-white font-black tracking-wide rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all">Record Purchase</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    // Event Bindings
    const closeMod = () => document.getElementById(modalId).remove();
    document.getElementById('close-raw-btn').onclick = closeMod;
    document.getElementById('cancel-raw-btn').onclick = closeMod;

    // Toggle Cheque Fields
    document.getElementById('raw-payment-method').addEventListener('change', (e) => {
        const drawer = document.getElementById('raw-cheque-drawer');
        if (e.target.value === 'CHEQUE') {
            drawer.classList.remove('hidden'); drawer.classList.add('grid');
        } else {
            drawer.classList.add('hidden'); drawer.classList.remove('grid');
        }
    });

    // 🚀 NEW: Advanced Back-Calculation Math Engine
    const calcNet = () => {
        const cost = parseFloat(document.getElementById('raw-cost').value) || 0;
        const qty = parseFloat(document.getElementById('raw-stock').value) || 0;
        const gst = parseFloat(document.getElementById('raw-gst').value) || 0;
        const isInclusive = document.getElementById('raw-tax-inclusive').checked;

        const lineTotal = cost * qty;
        let taxableAmt = 0;
        let netAmt = 0;

        if (isInclusive) {
            netAmt = lineTotal;
            taxableAmt = lineTotal / (1 + (gst / 100));
        } else {
            taxableAmt = lineTotal;
            netAmt = lineTotal * (1 + (gst / 100));
        }

        document.getElementById('raw-taxable-display').value = `₹${taxableAmt.toFixed(2)}`;
        document.getElementById('raw-net-display').value = `₹${netAmt.toFixed(2)}`;
    };

    ['raw-cost', 'raw-stock', 'raw-gst', 'raw-tax-inclusive'].forEach(id => {
        document.getElementById(id).addEventListener('input', calcNet);
        if (id === 'raw-gst' || id === 'raw-tax-inclusive') {
            document.getElementById(id).addEventListener('change', calcNet);
        }
    });

    // Supplier Field Cleanup & Auto-Fetch logic
    let fetchDebounce;
    document.getElementById('raw-sup-phone').addEventListener('input', (e) => {
        clearTimeout(fetchDebounce);
        const val = e.target.value.replace(/\D/g, '').slice(-10);

        // Wipe fields immediately on change to avoid ghost data
        document.getElementById('raw-sup-id').value = '';
        ['raw-sup-name', 'raw-sup-gstin', 'raw-sup-pan'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; el.classList.remove('bg-amber-50', 'text-amber-800', 'border-amber-300'); }
        });

        if (val.length === 10) {
            fetchDebounce = setTimeout(async () => {
                try {
                    // 🚀 THE FIX: Removed the dynamic 'await import' lines!
                    // Safely grab the App ID
                    const currentAppId = typeof window !== 'undefined' && window.__app_id ? window.__app_id : appId;
                    const dirRef = collection(db, `artifacts/${currentAppId}/directory_merchants`);

                    const candidates = [`+91${val}`, val, `0${val}`];
                    const q = query(dirRef, where('phone', 'in', candidates), limit(1));
                    const snap = await getDocs(q);

                    if (!snap.empty) {
                        const data = snap.docs[0].data();
                        const setF = (id, v) => {
                            const el = document.getElementById(id);
                            if (el && v) { el.value = v; el.classList.add('bg-amber-50', 'text-amber-800', 'border-amber-300'); }
                        };
                        setF('raw-sup-name', data.storeName || data.name);
                        setF('raw-sup-gstin', data.gstin);
                        setF('raw-sup-pan', data.pan);

                        document.getElementById('raw-sup-id').value = data.merchantId || snap.docs[0].id;
                        if (typeof showToast === 'function') showToast("Profile Found", "Supplier details loaded.", "success");
                    }
                } catch (err) { console.error(err); }
            }, 600);
        }
    });

    // Save Handling
    document.getElementById('save-raw-btn').onclick = async () => {
        const name = document.getElementById('raw-name').value.trim();
        const unit = document.getElementById('raw-unit').value;
        const expiry = document.getElementById('raw-expiry').value;
        const cost = parseFloat(document.getElementById('raw-cost').value) || 0;
        const stock = parseFloat(document.getElementById('raw-stock').value) || 0;
        const gst = parseFloat(document.getElementById('raw-gst').value) || 0;
        const isInclusive = document.getElementById('raw-tax-inclusive').checked;

        const supPhoneRaw = document.getElementById('raw-sup-phone').value.replace(/\D/g, '').slice(-10);
        const supName = document.getElementById('raw-sup-name').value.trim();
        const supGstin = document.getElementById('raw-sup-gstin').value.trim().toUpperCase();
        const supPan = document.getElementById('raw-sup-pan').value.trim().toUpperCase();

        const supInvoice = document.getElementById('raw-sup-invoice').value.trim().toUpperCase();
        let existingSupId = document.getElementById('raw-sup-id').value.trim();

        const paymentMethod = document.getElementById('raw-payment-method').value;

        let chequeDetails = null;
        if (paymentMethod === 'CHEQUE') {
            chequeDetails = {
                bank: document.getElementById('raw-cheque-bank').value.trim(),
                chequeNo: document.getElementById('raw-cheque-no').value.trim(),
                clearanceDate: document.getElementById('raw-cheque-date').value,
                status: 'PENDING'
            };
            if (!chequeDetails.bank || !chequeDetails.chequeNo || !chequeDetails.clearanceDate) {
                return alert("Please fill all cheque details.");
            }
        }

        if (!name) return alert("Material Name is required.");
        if (supName && supPhoneRaw.length > 0 && supPhoneRaw.length < 10) return alert("Please enter a valid 10-digit phone number for the supplier.");

        // Calculate final transaction amounts
        const lineTotal = cost * stock;
        const taxableAmt = isInclusive ? lineTotal / (1 + (gst / 100)) : lineTotal;
        const netAmt = isInclusive ? lineTotal : lineTotal * (1 + (gst / 100));

        const btn = document.getElementById('save-raw-btn');
        btn.disabled = true;
        btn.textContent = "Processing...";

        try {
            // 🚀 THE FIX: Removed the dynamic 'await import' lines!
            // We now rely on the static imports at the top of the file.

            const productsRef = getProductsRef();
            const customersRef = getCustomersRef();
            const transactionsRef = getTransactionsRef();
            const batch = writeBatch(db);

            let finalDealerId = existingSupId;
            const normalizedPhone = supPhoneRaw.length === 10 ? `91${supPhoneRaw}` : '';

            // Generate an ID if it's a completely new supplier
            if (!finalDealerId && supName) {
                if (normalizedPhone) {
                    let hash = 0x811c9dc5;
                    for (let i = 0; i < normalizedPhone.length; i++) {
                        hash ^= normalizedPhone.charCodeAt(i);
                        hash = (hash * 0x01000193) >>> 0;
                    }
                    finalDealerId = `MERCH-${hash.toString(36).toUpperCase().padStart(6, '0')}`;
                } else {
                    finalDealerId = `DUMMY-SUP-${Date.now().toString(36)}`;
                }
            }

            // 🚀 THE FIX: Always push the captured data to the Local and Global profiles, 
            // even if the ID already existed. This captures updated GSTINs, PANs, etc.
            if (finalDealerId && supName && customersRef) {
                const supData = {
                    merchantId: finalDealerId,
                    name: supName,
                    storeName: supName,
                    type: 'supplier',
                    isSupplier: true, // Hard-code true for B2B queries
                    phone: normalizedPhone ? `+${normalizedPhone}` : '',
                    gstin: supGstin,
                    pan: supPan,
                    locationId: typeof getCurrentLocationId === 'function' ? getCurrentLocationId() : 'main',
                    updatedAt: serverTimestamp()
                };

                // Account for Credit Dues
                if (paymentMethod === 'CREDIT') {
                    supData.dues = increment(-netAmt); // Negative because we OWE them
                }

                // Update Local Store
                batch.set(doc(customersRef, finalDealerId), supData, { merge: true });

                // Update Global Directory
                if (appId) {
                    batch.set(doc(db, `artifacts/${appId}/directory_merchants/${finalDealerId}`), supData, { merge: true });
                }
            }

            const existingRaw = rawMaterials.find(m =>
                m.name.toLowerCase().trim() === name.toLowerCase() && m.unit === unit && parseFloat(m.cost || 0) === cost && parseFloat(m.gstSlab || 0) === gst
            );

            const targetDocRef = existingRaw ? doc(productsRef, existingRaw.id) : doc(productsRef);

            const productData = {
                dealerId: finalDealerId, dealerName: supName, dealerPhone: normalizedPhone ? `+${normalizedPhone}` : '', dealerGstin: supGstin, dealerPan: supPan, supplierInvoice: supInvoice, updatedAt: serverTimestamp()
            };

            if (expiry) productData.expirationDate = expiry; // Apply expiry to inventory

            if (existingRaw) {
                productData.stockLevel = increment(stock);
                batch.update(targetDocRef, productData);
            } else {
                Object.assign(productData, {
                    name: name, type: 'raw_material', unit: unit, cost: cost, price: 0, gstSlab: gst, stockLevel: stock, sku: `RAW-${Date.now().toString().slice(-6)}`, createdAt: new Date().toISOString()
                });
                batch.set(targetDocRef, productData);
            }

            // 🚀 LEDGER INJECTION: Log the Purchase Transaction using the Calculated Net Amount
            if (stock > 0) {
                const txRef = doc(transactionsRef);
                const invId = supInvoice || `RAW-PUR-${Date.now().toString().slice(-6)}`;

                batch.set(txRef, {
                    invoiceId: invId,
                    supplierInvoice: supInvoice,
                    storeId: getStoreId(),
                    locationId: typeof getCurrentLocationId === 'function' ? getCurrentLocationId() : 'main',
                    timestamp: serverTimestamp(),
                    type: 'PURCHASE',
                    customer: {
                        id: finalDealerId || 'INTERNAL',
                        name: supName || 'Internal Supply',
                        gstin: supGstin || ''
                    },
                    summary: {
                        total: -netAmt, // The true payable total including tax
                        profit: 0,
                        paymentMethod: paymentMethod,
                        chequeDetails: chequeDetails,
                        reason: 'Raw Material Restock',
                        itemCount: stock,
                        transactionType: 'PURCHASE'
                    },
                    items: [{
                        id: targetDocRef.id, name: name, quantity: stock, cost: cost, price: 0, taxRate: gst, type: 'raw_material',
                        subtotal: netAmt, taxableValue: taxableAmt // Deep reporting data
                    }],
                    cashierId: getUserId(),
                    currency: { code: getCurrencyCode(), symbol: getCurrencySymbol() }
                });

                // 🚀 ACCOUNTING FIX: Always tag as supplier, but only increment dues if bought on Udhaar!
                if (finalDealerId && customersRef) {
                    const partyUpdates = {
                        isSupplier: true, // Automatically makes them show up in Supplier filters forever
                        updatedAt: serverTimestamp()
                    };

                    if (paymentMethod === 'CREDIT') {
                        partyUpdates.dues = increment(-netAmt); // Negative because we OWE them
                    }

                    batch.set(doc(customersRef, finalDealerId), partyUpdates, { merge: true });
                }
            }

            await batch.commit();
            document.getElementById(modalId).remove();
            showToast("Success", "Material saved & Ledger updated.", "success");

        } catch (error) {
            console.error("Save Error:", error);
            alert("Failed to save material.");
            btn.disabled = false;
            btn.textContent = "Record Purchase";
        }
    };
}

// ============================================================================
// 🧪 RECIPE BUILDER TAB (Finished Goods)
// ============================================================================

function renderRecipesTable(container) {
    if (recipes.length === 0) {
        container.innerHTML = `<div class="p-10 text-center text-slate-400 font-medium">No manufactured goods defined.<br>Click "+ Create Recipe" to build a Bill of Materials.</div>`;
        return;
    }

    let rows = recipes.map(r => {
        let maxPossible = Infinity;
        const components = r.recipe || [];

        components.forEach(comp => {
            const rawItem = rawMaterials.find(rm => rm.id === comp.rawMaterialId);
            const available = rawItem ? (parseFloat(rawItem.stockLevel) || 0) : 0;
            const required = parseFloat(comp.qtyRequired) || 1;
            const canMake = Math.floor(available / required);
            if (canMake < maxPossible) maxPossible = canMake;
        });

        if (maxPossible === Infinity || components.length === 0) maxPossible = 0;

        return `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <td class="p-4">
                <div class="font-bold text-slate-800">${escapeHTML(r.name)}</div>
                <div class="text-[10px] text-slate-400 uppercase tracking-wider">${components.length} Ingredients</div>
            </td>
            <td class="p-4">
                <span class="font-black ${r.stockLevel > 0 ? 'text-emerald-600' : 'text-slate-400'}">${r.stockLevel || 0}</span>
                <span class="text-xs text-slate-400 font-bold ml-1 uppercase">In Stock</span>
            </td>
            <td class="p-4">
                <div class="inline-flex flex-col items-center bg-purple-50 border border-purple-100 rounded-lg px-3 py-1">
                    <span class="text-xs font-bold text-purple-400 uppercase tracking-widest">Base Yield</span>
                    <span class="font-black text-purple-700">${maxPossible}</span>
                </div>
            </td>
            <td class="p-4 text-slate-600 font-medium">₹${parseFloat(r.cost || 0).toFixed(2)}</td>
            <td class="p-4 text-right flex justify-end gap-2">
                <button onclick="window.openRecipeBuilderModal('${r.id}')" class="text-SLATE-600 font-bold text-xs bg-SLATE-50 hover:bg-SLATE-100 px-3 py-2 rounded-lg transition-all border border-SLATE-100">Edit</button>
                <button onclick="window.openProductionModal('${r.id}')" class="text-white font-bold text-xs bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg shadow-sm active:scale-95 transition-all">Start Batch</button>
            </td>
        </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="w-full text-left">
            <thead class="bg-slate-50 border-b border-slate-200">
                <tr class="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    <th class="p-4">Finished Good</th>
                    <th class="p-4">Ready Stock</th>
                    <th class="p-4">Raw Availability</th>
                    <th class="p-4">Standard Cost</th>
                    <th class="p-4 text-right">Actions</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function openRecipeBuilderModal(existingRecipeId = null) {
    let existingRecipe = null;
    currentRecipeComponents = [];

    if (existingRecipeId) {
        existingRecipe = recipes.find(r => r.id === existingRecipeId);
        if (existingRecipe) {
            currentRecipeComponents = existingRecipe.recipe.map(c => {
                const rawMat = rawMaterials.find(m => m.id === c.rawMaterialId);
                return {
                    ...c,
                    name: rawMat ? rawMat.name : 'Unknown Material',
                    unit: rawMat ? rawMat.unit : 'units',
                    unitCost: rawMat ? parseFloat(rawMat.cost || 0) : 0
                };
            });
        }
    }

    const modalId = 'recipe-builder-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const rawOptionsHtml = rawMaterials.map(m => `<option value="${m.id}">${escapeHTML(m.name)} (In Stock: ${m.stockLevel} ${escapeHTML(m.unit)})</option>`).join('');

    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[150] bg-slate-900/60   flex items-center justify-center p-4">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl  overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]">
                
                <div class="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
                    <div>
                        <h3 class="font-black text-slate-800 text-xl flex items-center gap-2">
                            <span class="bg-purple-100 text-purple-600 p-1.5 rounded-lg">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
                            </span> 
                            ${existingRecipe ? 'Edit Recipe' : 'Recipe Builder'}
                        </h3>
                        <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1 ml-10">Bill of Materials (BOM)</p>
                    </div>
                    <button id="close-recipe-btn" class="text-slate-400 hover:text-red-500 transition-colors p-2 bg-white rounded-full">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto p-6 bg-slate-50 flex flex-col md:flex-row gap-6">
                    
                    <div class="w-full md:w-1/3 space-y-6">
                        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                            <h4 class="text-sm font-black text-slate-800 mb-4 border-b pb-2">Output Specifications</h4>
                            
                            <div class="space-y-4">
                                <div>
                                    <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Product Name</label>
                                    <input type="text" id="recipe-name" value="${existingRecipe ? escapeHTML(existingRecipe.name) : ''}" class="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:border-purple-500 outline-none font-bold text-slate-800">
                                </div>
                                <div class="grid grid-cols-2 gap-2">
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Retail Price (₹)</label>
                                        <input type="number" id="recipe-price" value="${existingRecipe ? existingRecipe.price : ''}" class="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:border-purple-500 outline-none font-bold text-SLATE-700 bg-SLATE-50" placeholder="0.00">
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Output Unit</label>
                                        <select id="recipe-unit" class="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:border-purple-500 outline-none bg-white">
                                            <option value="kg" ${existingRecipe && existingRecipe.unit === 'kg' ? 'selected' : ''}>kg</option>
                                            <option value="units" ${existingRecipe && existingRecipe.unit === 'units' ? 'selected' : ''}>units</option>
                                            <option value="L" ${existingRecipe && existingRecipe.unit === 'L' ? 'selected' : ''}>Litres</option>
                                            <option value="g" ${existingRecipe && existingRecipe.unit === 'g' ? 'selected' : ''}>grams</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="grid grid-cols-2 gap-2">
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">GST Slab (%)</label>
                                        <select id="recipe-gst" class="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:border-purple-500 outline-none bg-white">
                                            <option value="0" ${existingRecipe && existingRecipe.gstSlab == 0 ? 'selected' : ''}>0%</option>
                                            <option value="5" ${existingRecipe && existingRecipe.gstSlab == 5 ? 'selected' : ''}>5%</option>
                                            <option value="12" ${existingRecipe && existingRecipe.gstSlab == 12 ? 'selected' : ''}>12%</option>
                                            <option value="18" ${existingRecipe && existingRecipe.gstSlab == 18 ? 'selected' : ''}>18%</option>
                                            <option value="28" ${existingRecipe && existingRecipe.gstSlab == 28 ? 'selected' : ''}>28%</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">HSN Code</label>
                                        <input type="text" id="recipe-hsn" value="${existingRecipe ? escapeHTML(existingRecipe.hsn || '') : ''}" class="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:border-purple-500 outline-none text-slate-600">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="w-full md:w-2/3 bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                        <div class="flex justify-between items-center mb-4 border-b pb-2">
                            <h4 class="text-sm font-black text-slate-800">Ingredients (Per 1 Unit of Output)</h4>
                            <div class="text-xs font-bold text-purple-600 bg-purple-50 px-3 py-1 rounded-md border border-purple-100">
                                Standard Cost: ₹<span id="recipe-total-cost">${existingRecipe ? existingRecipe.cost.toFixed(2) : '0.00'}</span>
                            </div>
                        </div>

                        <div class="flex gap-2 mb-4 bg-slate-50 p-2 rounded-lg border border-slate-200">
                            <select id="ingredient-select" class="flex-1 border border-slate-200 rounded-md p-2 text-sm bg-white outline-none">
                                <option value="">-- Select Raw Material --</option>
                                ${rawOptionsHtml}
                            </select>
                            <input type="number" id="ingredient-qty" class="w-24 border border-slate-200 rounded-md p-2 text-sm text-center outline-none" placeholder="Qty">
                            <button id="add-ingredient-btn" class="px-4 py-2 bg-slate-800 text-white font-bold text-sm rounded-md hover:bg-slate-700 transition">Add</button>
                        </div>

                        <div class="flex-1 overflow-y-auto">
                            <table class="w-full text-left text-sm">
                                <thead class="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 sticky top-0">
                                    <tr>
                                        <th class="p-2 rounded-l-lg">Material</th>
                                        <th class="p-2">Qty Required</th>
                                        <th class="p-2 text-right">Cost Impact</th>
                                        <th class="p-2 rounded-r-lg text-center">Del</th>
                                    </tr>
                                </thead>
                                <tbody id="recipe-components-list" class="divide-y divide-slate-100">
                                    <tr><td colspan="4" class="text-center py-4 text-slate-400 italic">Loading...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>

                <div class="p-5 border-t border-slate-100 bg-white flex justify-end shrink-0">
                    <button onclick="window.handleSaveRecipe('${existingRecipeId || ''}')" id="save-recipe-btn" class="px-8 py-3 bg-purple-600 text-white font-black tracking-wide rounded-xl shadow-lg shadow-purple-200 hover:bg-purple-700 active:scale-95 transition-all">${existingRecipe ? 'Update Recipe' : 'Save Recipe'}</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('close-recipe-btn').onclick = () => document.getElementById(modalId).remove();
    document.getElementById('add-ingredient-btn').onclick = handleAddIngredient;

    renderRecipeComponents(); // Initial render for edits
}

function handleAddIngredient() {
    const select = document.getElementById('ingredient-select');
    const qtyInput = document.getElementById('ingredient-qty');
    const rawId = select.value;
    const qty = parseFloat(qtyInput.value);

    if (!rawId || isNaN(qty) || qty <= 0) return alert("Select a material and enter a valid quantity.");

    const rawMat = rawMaterials.find(m => m.id === rawId);
    if (!rawMat) return;

    const existing = currentRecipeComponents.find(c => c.rawMaterialId === rawId);
    if (existing) {
        existing.qtyRequired += qty;
    } else {
        currentRecipeComponents.push({
            rawMaterialId: rawId,
            name: rawMat.name,
            unit: rawMat.unit,
            unitCost: parseFloat(rawMat.cost || 0),
            qtyRequired: qty
        });
    }

    select.value = '';
    qtyInput.value = '';
    renderRecipeComponents();
}

function renderRecipeComponents() {
    const tbody = document.getElementById('recipe-components-list');
    const costDisplay = document.getElementById('recipe-total-cost');

    if (currentRecipeComponents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-slate-400 italic">No ingredients added yet.</td></tr>`;
        costDisplay.textContent = "0.00";
        return;
    }

    let totalMfgCost = 0;
    let html = '';

    currentRecipeComponents.forEach((comp, index) => {
        const costImpact = comp.unitCost * comp.qtyRequired;
        totalMfgCost += costImpact;

        html += `
            <tr class="group hover:bg-slate-50">
                <td class="p-2 font-medium text-slate-700">${escapeHTML(comp.name)}</td>
                <td class="p-2 font-bold text-blue-600">${comp.qtyRequired} <span class="text-[10px] text-slate-400 uppercase">${escapeHTML(comp.unit)}</span></td>
                <td class="p-2 text-right text-slate-600 font-mono">₹${costImpact.toFixed(2)}</td>
                <td class="p-2 text-center">
                    <button onclick="window.removeRecipeComponent(${index})" class="text-slate-300 hover:text-red-500 font-bold">&times;</button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    costDisplay.textContent = totalMfgCost.toFixed(2);
}

window.handleSaveRecipe = async function (existingId) {
    const name = document.getElementById('recipe-name').value.trim();
    const price = parseFloat(document.getElementById('recipe-price').value) || 0;
    const unit = document.getElementById('recipe-unit').value;
    const gst = parseFloat(document.getElementById('recipe-gst').value) || 0;
    const hsn = document.getElementById('recipe-hsn').value.trim();
    const mfgCost = parseFloat(document.getElementById('recipe-total-cost').textContent);

    if (!name) return alert("Finished Good name is required.");
    if (currentRecipeComponents.length === 0) return alert("You must add at least one ingredient to the recipe.");

    const btn = document.getElementById('save-recipe-btn');
    btn.disabled = true;
    btn.textContent = "Saving Recipe...";

    try {
        const productsRef = getProductsRef();

        const targetDocRef = existingId ? doc(productsRef, existingId) : doc(productsRef);

        // 🚀 THE FIX: We explicitly save 'cost: mfgCost' so the POS can use it for Profit calculations!
        const payload = {
            name: name,
            type: 'manufactured',
            unit: unit,
            price: price,
            cost: mfgCost, // 👈 True ERP: Live BOM Cost becomes the Product's Base Cost
            gstSlab: gst,
            hsn: hsn,
            recipe: currentRecipeComponents.map(c => ({
                rawMaterialId: c.rawMaterialId,
                qtyRequired: c.qtyRequired
            })),
            updatedAt: serverTimestamp()
        };

        if (!existingId) {
            payload.stockLevel = 0;
            payload.sku = `MFG-${Date.now().toString().slice(-6)}`;
            payload.createdAt = new Date().toISOString();
        }

        await setDoc(targetDocRef, payload, { merge: true });

        document.getElementById('recipe-builder-modal').remove();
        showToast("Recipe Saved", `${name} is ready for production!`, "success");
    } catch (error) {
        console.error("Recipe Save Error:", error);
        alert("Failed to save recipe.");
        btn.disabled = false;
        btn.textContent = "Save Recipe";
    }
};
// 🚀 THE FIX: Dynamic Yield Batch Engine
function openProductionModal(recipeId) {
    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) return;

    const modalId = 'produce-batch-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[160] bg-slate-900/70   flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl shadow-2xl w-full max-w-xl  border border-slate-100 overflow-hidden flex flex-col max-h-[95vh]">
                
                <div class="bg-slate-800 p-6 text-white text-center relative shrink-0">
                    <h3 class="text-xl font-black mb-1">Start Production Batch</h3>
                    <p class="text-sm text-slate-300 font-medium">${escapeHTML(recipe.name)}</p>
                    <button onclick="document.getElementById('${modalId}').remove()" class="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                
                <div class="p-6 space-y-6 overflow-y-auto flex-1">
                    
                    <div class="bg-blue-50 border border-blue-100 rounded-xl p-4">
                        <h4 class="text-xs font-black text-blue-800 uppercase tracking-widest mb-3 border-b border-blue-200 pb-2">1. Raw Material Inputs</h4>
                        <label class="block text-xs font-bold text-blue-900 mb-2">Recipe Multiplier (Batch Size)</label>
                        <div class="flex items-center gap-3 mb-3">
                            <input type="number" id="batch-scale" class="w-full text-lg font-black text-blue-900 bg-white border border-blue-200 rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors" value="1" min="0.1" step="0.1">
                            <span class="text-xs font-bold text-blue-600 bg-blue-100 px-3 py-2.5 rounded-lg whitespace-nowrap border border-blue-200 shadow-inner">x Base Recipe</span>
                        </div>
                        
                        <div class="text-xs text-slate-600 bg-white/60 p-2 rounded border border-blue-100" id="raw-deduction-preview">
                            </div>
                    </div>

                    <div class="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                        <h4 class="text-xs font-black text-emerald-800 uppercase tracking-widest mb-3 border-b border-emerald-200 pb-2">2. Finished Good Yield</h4>
                        <div class="flex items-end gap-3">
                            <div class="flex-1">
                                <label class="block text-xs font-bold text-emerald-900 mb-2">Actual Units Produced</label>
                                <input type="number" id="actual-yield" class="w-full text-2xl font-black text-emerald-700 bg-white border-2 border-emerald-300 rounded-xl p-3 outline-none focus:border-emerald-500 transition-colors" value="1" step="0.1">
                            </div>
                            <div class="mb-3">
                                <span class="text-xs font-bold text-emerald-700 bg-emerald-100 px-4 py-3 rounded-lg border border-emerald-200 shadow-inner uppercase">${escapeHTML(recipe.unit)}</span>
                            </div>
                        </div>
                        <p class="text-[10px] text-emerald-600 font-bold mt-2" id="yield-status-text">Perfect Yield. No material lost.</p>
                    </div>

                   <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1" title="Labor, electricity, packaging, etc.">Batch Overhead (₹)</label>
                            <input type="number" id="produce-overhead" class="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:border-purple-500 font-medium text-slate-700" placeholder="0.00" value="0">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1" title="GST/Taxes applied to the overhead service">Mfg GST Slab (%)</label>
                            <select id="produce-tax" class="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:border-purple-500 font-bold text-slate-700 bg-white shadow-sm">
                                <option value="0">0% (Exempt)</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option>
                            </select>
                        </div>
                    </div>

                    <div class="bg-slate-50 p-4 rounded-xl border border-slate-200">
                        <div class="flex justify-between text-sm mb-1 text-slate-600"><span>Consumed Raw Cost:</span> <span id="disp-raw-cost" class="font-mono font-bold">₹0.00</span></div>
                        <div class="flex justify-between text-sm mb-1 text-slate-600"><span>Overheads + Tax:</span> <span id="disp-oh-cost" class="font-mono font-bold">₹0.00</span></div>
                        
                        <div class="flex justify-between text-sm mt-3 pt-3 border-t border-slate-200 font-black text-slate-900">
                            <span>Total Batch Cost:</span> <span id="disp-total-mfg-cost" class="font-mono text-lg text-purple-700">₹0.00</span>
                        </div>
                        <div class="flex justify-between text-[11px] mt-1 font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100">
                            <span>Final Unit Cost (COGM):</span> <span id="disp-unit-cost" class="font-mono">₹0.00 / ${escapeHTML(recipe.unit)}</span>
                        </div>
                    </div>
                </div>

                <div class="p-4 bg-gray-50 flex gap-3 shrink-0 border-t border-slate-100">
                    <button onclick="document.getElementById('${modalId}').remove()" class="flex-1 py-3 text-slate-600 font-bold bg-white border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors">Cancel</button>
                    <button onclick="window.processProductionBatch('${recipe.id}')" id="confirm-produce-btn" class="flex-1 py-3 bg-purple-600 text-white font-black rounded-xl hover:bg-purple-700 shadow-lg shadow-purple-200 active:scale-95 transition-all flex justify-center items-center gap-2">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg> Create Batch
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    // Live Math Logic
    const scaleInput = document.getElementById('batch-scale');
    const yieldInput = document.getElementById('actual-yield');
    const ohInput = document.getElementById('produce-overhead');
    const taxInput = document.getElementById('produce-tax');
    const rawPreviewBox = document.getElementById('raw-deduction-preview');

    let hasManuallyEditedYield = false;

    // Track user intent: if they edit yield, stop auto-scaling it.
    yieldInput.addEventListener('input', () => { hasManuallyEditedYield = true; });

    const calculateBatch = () => {
        const scale = parseFloat(scaleInput.value) || 0;
        let expectedYield = scale; // 1 scale = 1 unit of recipe output

        // Auto-update yield if they haven't touched it
        if (!hasManuallyEditedYield) {
            yieldInput.value = expectedYield;
        }

        const actualYield = parseFloat(yieldInput.value) || 0;
        const oh = parseFloat(ohInput.value) || 0;
        const taxPct = parseFloat(taxInput.value) || 0;

        // Calculate Raw Materials Cost & Generate Preview
        let totalRawCost = 0;
        let previewHtml = '<div class="font-bold mb-1 border-b border-blue-100 pb-1">Will deduct from stock:</div>';

        recipe.recipe.forEach(comp => {
            const rawItem = rawMaterials.find(rm => rm.id === comp.rawMaterialId);
            const rawCost = rawItem ? parseFloat(rawItem.cost || 0) : 0;
            const requiredBase = parseFloat(comp.qtyRequired || 0);

            const totalRequired = requiredBase * scale;
            const lineCost = totalRequired * rawCost;

            totalRawCost += lineCost;
            previewHtml += `<div class="flex justify-between font-mono"><span>- ${totalRequired.toFixed(2)} ${rawItem ? rawItem.unit : ''} ${rawItem ? escapeHTML(rawItem.name) : 'Unknown'}</span> <span>₹${lineCost.toFixed(2)}</span></div>`;
        });

        rawPreviewBox.innerHTML = previewHtml;

        // Calculate Overheads
        const ohTotal = oh + (oh * (taxPct / 100));
        const grandTotal = totalRawCost + ohTotal;

        // Unit Cost Math! 
        // 🚀 This absorbs all the costs (and losses) into the actual physical yield!
        const finalUnitCost = actualYield > 0 ? (grandTotal / actualYield) : 0;

        // Update UI
        document.getElementById('disp-raw-cost').textContent = `₹${totalRawCost.toFixed(2)}`;
        document.getElementById('disp-oh-cost').textContent = `₹${ohTotal.toFixed(2)}`;
        document.getElementById('disp-total-mfg-cost').textContent = `₹${grandTotal.toFixed(2)}`;
        document.getElementById('disp-unit-cost').textContent = `₹${finalUnitCost.toFixed(2)} / ${recipe.unit}`;

        // Loss Status Tracker
        const statusText = document.getElementById('yield-status-text');
        if (actualYield < expectedYield) {
            const diff = expectedYield - actualYield;
            statusText.textContent = `⚠️ Loss of ${diff.toFixed(2)} ${recipe.unit} detected. Cost absorbed into Final Unit Cost.`;
            statusText.className = "text-[10px] text-orange-600 font-bold mt-2";
        } else if (actualYield > expectedYield) {
            statusText.textContent = `✨ Over-yield detected. Final Unit Cost decreased.`;
            statusText.className = "text-[10px] text-blue-600 font-bold mt-2";
        } else {
            statusText.textContent = `Perfect Yield. No material lost.`;
            statusText.className = "text-[10px] text-emerald-600 font-bold mt-2";
        }
    };

    scaleInput.addEventListener('input', calculateBatch);
    yieldInput.addEventListener('input', calculateBatch);
    ohInput.addEventListener('input', calculateBatch);
    taxInput.addEventListener('input', calculateBatch);

    calculateBatch(); // Initial run
}
// 🚀 THE ENGINE: Deducts Raw, Adds Finished, Calculates Cost of Goods Manufactured
async function processProductionBatch(recipeId) {
    const scale = parseFloat(document.getElementById('batch-scale').value);
    const actualYield = parseFloat(document.getElementById('actual-yield').value);
    const overhead = parseFloat(document.getElementById('produce-overhead').value) || 0;
    const taxPct = parseFloat(document.getElementById('produce-tax').value) || 0;

    if (!scale || scale <= 0 || !actualYield || actualYield <= 0) return alert("Enter valid multipliers and yields.");

    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) return;

    const btn = document.getElementById('confirm-produce-btn');
    btn.disabled = true;
    btn.innerHTML = `<svg class="animate-spin w-5 h-5" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Processing...`;

    try {
        // 🚀 THE FIX: Removed the dynamic 'await import' lines!
        const batch = writeBatch(db);
        const productsRef = getProductsRef();
        const transactionsRef = getTransactionsRef();

        let totalRawCost = 0;
        let consumedItemsLog = [];

        // 1. Deduct Raw Materials based on Scale
        recipe.recipe.forEach(comp => {
            const rawItem = rawMaterials.find(rm => rm.id === comp.rawMaterialId);
            const rawCost = rawItem ? parseFloat(rawItem.cost || 0) : 0;

            const totalRequired = comp.qtyRequired * scale;
            totalRawCost += (totalRequired * rawCost);

            const rawRef = doc(productsRef, comp.rawMaterialId);
            batch.update(rawRef, {
                stockLevel: increment(-totalRequired),
                updatedAt: serverTimestamp()
            });

            consumedItemsLog.push({
                name: rawItem ? rawItem.name : 'Unknown Material',
                quantity: totalRequired,
                cost: rawCost
            });
        });

        // 2. Financial Math (Cost of Goods Manufactured)
        const totalOverheadWithTax = overhead + (overhead * (taxPct / 100));
        const totalBatchCost = totalRawCost + totalOverheadWithTax;
        const newUnitCost = totalBatchCost / actualYield; // The true accounting cost!

        // 3. Add Finished Good Stock
        const fgRef = doc(productsRef, recipeId);
        batch.update(fgRef, {
            stockLevel: increment(actualYield),
            cost: newUnitCost, // Dynamically updates the product's Base Cost in Inventory!
            updatedAt: serverTimestamp()
        });

        // 4. Log to Transactions Page as 'PRODUCTION'
        const expectedYield = scale;
        const lossAmount = expectedYield - actualYield;
        let reasonStr = `Manufactured ${actualYield} ${recipe.unit}. `;
        if (lossAmount > 0) reasonStr += `(Yield loss: ${lossAmount.toFixed(2)} ${recipe.unit})`;

        const txRef = doc(transactionsRef);
        batch.set(txRef, {
            invoiceId: `MFG-${Date.now().toString().slice(-6)}`,
            storeId: getStoreId(),
            locationId: 'main',
            timestamp: serverTimestamp(),
            type: 'PRODUCTION',
            customer: { id: 'INTERNAL', name: 'Internal Manufacturing', gstin: '' },
            summary: {
                total: totalBatchCost,
                profit: 0, // Profit is realized at sale, not production
                paymentMethod: 'SYSTEM',
                reason: reasonStr,
                transactionType: 'PRODUCTION',
                itemCount: actualYield,
                tax: overhead * (taxPct / 100)
            },
            items: [{
                id: recipe.id,
                name: recipe.name,
                sku: recipe.sku || 'MFG',
                quantity: actualYield,
                cost: newUnitCost,
                price: recipe.price,
                type: 'manufactured',
                taxRate: recipe.gstSlab || 0
            }],
            cashierId: getUserId(),
            currency: { code: getCurrencyCode(), symbol: getCurrencySymbol() }
        });

        await batch.commit();

        document.getElementById('produce-batch-modal').remove();
        showToast("Production Complete", `Successfully logged ${actualYield} ${recipe.unit} of ${recipe.name}. Unit cost updated.`, "success");

    } catch (error) {
        console.error("Production Error:", error);
        alert("Production failed. Check console.");
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg> Create Batch`;
    }
}