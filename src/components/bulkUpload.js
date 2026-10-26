// src/components/bulkUpload.js


// Helper to prevent HTML injection errors
function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
}

// 🚀 NEW: The Guide Modal
function openBulkGuideModal() {
    const modalId = 'bulk-guide-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();

    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[300] bg-slate-900/70 flex items-center justify-center p-4 animate-fadeIn">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden max-h-[90vh] animate-scaleIn">
                <div class="px-6 py-4 border-b border-slate-100 bg-indigo-50 flex justify-between items-center shrink-0">
                    <h2 class="text-xl font-black text-indigo-900 flex items-center gap-2">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        Bulk Upload Guide
                    </h2>
                    <button id="close-bulk-guide" class="text-indigo-400 hover:text-indigo-700 bg-white rounded-full p-1.5 transition shadow-sm">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                
                <div class="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6 text-sm text-slate-600 bg-slate-50">
                    
                    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <h3 class="font-black text-slate-800 text-base mb-2 border-b pb-2">📦 Stock Calculation</h3>
                        <p class="mb-2">The system calculates physical stock automatically based on what you received in the delivery:</p>
                        <ul class="list-disc pl-5 space-y-1 font-medium">
                            <li><strong class="text-slate-800">CS (Cases):</strong> Master cartons.</li>
                            <li><strong class="text-slate-800">UPC:</strong> Units Per Case (How many items are inside one carton).</li>
                            <li><strong class="text-slate-800">Pcs (Loose):</strong> Individual loose units.</li>
                            <li><strong class="text-emerald-600">Free (FOC):</strong> Free items given by the supplier (Not taxed, but adds to physical stock).</li>
                        </ul>
                        <div class="mt-3 p-3 bg-slate-50 rounded text-xs font-mono text-slate-500 border border-slate-100">
                            Math: (CS × UPC) + Pcs + Free = Total Stock
                        </div>
                    </div>

                    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <h3 class="font-black text-slate-800 text-base mb-2 border-b pb-2">⚖️ Tax Interpretation Toggle</h3>
                        <p class="mb-3">This switch determines how the system reads the <strong>Base Rate</strong> you type in.</p>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="bg-slate-50 p-3 rounded-lg border border-slate-200">
                                <h4 class="font-bold text-slate-800 mb-1">Exclusive (+GST)</h4>
                                <p class="text-xs">The Base Rate is the item price <strong class="text-indigo-600">without tax</strong>. The system will calculate GST on top of it to figure out the Net Amount.</p>
                            </div>
                            <div class="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
                                <h4 class="font-bold text-indigo-800 mb-1">Inclusive (Net)</h4>
                                <p class="text-xs">The Base Rate you type is the <strong class="text-indigo-600">final total</strong>. The system will reverse-calculate to figure out what the tax and subtotal were.</p>
                            </div>
                        </div>
                    </div>

                    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <h3 class="font-black text-slate-800 text-base mb-2 border-b pb-2">🏷️ Product Types & Validation</h3>
                        <ul class="space-y-3 font-medium">
                            <li><strong class="text-slate-800 bg-slate-100 px-2 py-0.5 rounded">GST Product:</strong> Standard inventory. Requires supplier info and applies tax rules.</li>
                            <li><strong class="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">Non-GST:</strong> Home-made or local goods. Forces GST to 0% and does not require strict supplier compliance IDs (GSTIN, PAN, Invoice).</li>
                            <li><strong class="text-amber-700 bg-amber-50 px-2 py-0.5 rounded">Raw Material:</strong> Ingredients. Hidden from the POS retail billing screen automatically.</li>
                        </ul>
                    </div>

                    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <h3 class="font-black text-slate-800 text-base mb-2 border-b pb-2">💵 Cost & Pricing</h3>
                        <p class="mb-2"><strong>Unit Cost</strong> is permanently greyed out because it is <strong class="text-indigo-600">auto-calculated</strong>. It divides the <em>Total Net Amount</em> by the <em>Total Stock</em> to give you an exact, blended per-item cost.</p>
                        <p><strong>MRP vs Selling Price:</strong> You can quickly copy prices across rows using the <strong class="text-slate-800">Push</strong> buttons in the table headers.</p>
                    </div>

                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('close-bulk-guide').onclick = () => document.getElementById(modalId).remove();
}

export function openManualBulkUpload(onSave, dealersCache = [], productsCache = []) {
    // 📊 LOCAL TELEMETRY: Track UI interaction offline for your automated workflows
    if (window.dbAPI && window.dbAPI.logTelemetry) {
        window.dbAPI.logTelemetry('ui_interaction', { 
            action: 'opened_manual_bulk_upload', 
            timestamp: new Date().toISOString() 
        });
    }

    const existing = document.getElementById('manual-bulk-overlay');
    if (existing) existing.remove();

    const todayISO = new Date().toISOString().split('T')[0];
    const unitOptions = [
        { value: 'units', label: 'Units' },
        { value: 'kilogram', label: 'Kilograms (kg)' },
        { value: 'grams', label: 'Grams (g)' },
        { value: 'litres', label: 'Litres (L)' },
        { value: 'mililitres', label: 'Millilitres (ml)' }
    ];

    const datalistHtml = `
        <datalist id="bulk-dealer-list">
            ${dealersCache.map(d => `<option value="${escapeHTML(d.name || d.storeName)}"></option>`).join('')}
        </datalist>
        <datalist id="bulk-product-list">
            ${productsCache.map(p => `<option value="${escapeHTML(p.name)}"></option>`).join('')}
        </datalist>
    `;

    const generateEmptyRow = (index = 0) => {
        const autoSku = `SKU${Date.now().toString().slice(-5)}${Math.floor(Math.random()*1000)}${index}`;
        return `
        <tr class="hover:bg-indigo-50/30 transition-all duration-200 group bulk-row animate-fadeIn">
            <td class="p-1 min-w-[200px]"><input type="text" list="bulk-product-list" class="inp-name w-full border border-slate-200 focus:border-indigo-500 rounded p-1.5 text-sm font-bold text-slate-800" placeholder="Product Name *"></td>
            <td class="p-1 min-w-[120px]"><input type="text" class="inp-sku w-full border border-slate-200 focus:border-indigo-500 rounded p-1.5 text-sm font-mono text-slate-600" value="${autoSku}"></td>
            <td class="p-1 min-w-[120px]"><input type="text" class="inp-barcode w-full border border-slate-200 focus:border-indigo-500 rounded p-1.5 text-sm font-mono text-slate-600" placeholder="Scan/Type"></td>
            <td class="p-1 min-w-[100px]"><input type="number" class="inp-mrp w-full border border-slate-200 focus:border-indigo-500 rounded p-1.5 text-sm font-bold text-slate-600" placeholder="0.00"></td>
            <td class="p-1 min-w-[120px]"><input type="number" class="inp-selling-price w-full border border-indigo-300 bg-indigo-50 focus:border-indigo-500 rounded p-1.5 text-sm font-bold text-indigo-900" placeholder="Required *"></td>
            
            <td class="p-1 min-w-[100px]"><input type="number" class="inp-unit-cost w-full border border-slate-200 bg-slate-100 text-slate-500 rounded p-1.5 text-sm font-bold cursor-not-allowed select-none focus:ring-0" placeholder="Auto" readonly tabindex="-1"></td>
            
            <td class="p-1 bg-slate-100 border-l border-r border-slate-200/60"><input type="number" class="inp-total-stock w-full bg-transparent border-none text-center rounded p-1.5 text-sm font-bold text-slate-400 focus:outline-none" readonly tabindex="-1" value="0"></td>
            
            <td class="p-1"><input type="number" class="inp-cs w-full border border-slate-200 focus:border-indigo-500 rounded p-1.5 text-sm text-center font-bold text-slate-800 calc-trigger" placeholder="0"></td>
            <td class="p-1"><input type="number" class="inp-upc w-full border border-slate-200 focus:border-indigo-500 rounded p-1.5 text-sm text-center font-bold text-slate-800 calc-trigger" value="1"></td>
            <td class="p-1"><input type="number" class="inp-pcs w-full border border-slate-200 focus:border-indigo-500 rounded p-1.5 text-sm text-center font-bold text-slate-800 calc-trigger" placeholder="0"></td>
            
            <td class="p-1"><input type="number" class="inp-free-qty w-full border border-emerald-200 bg-emerald-50 hover:bg-white focus:border-emerald-500 rounded p-1.5 text-sm text-center font-bold text-emerald-700 calc-trigger" placeholder="0" value="0"></td>
            <td class="p-1">
                <select class="inp-unit w-full border border-slate-200 focus:border-indigo-500 rounded p-1.5 text-sm font-bold text-slate-600 bg-white">
                    ${unitOptions.map(u => `<option value="${u.value}">${u.label}</option>`).join('')}
                </select>
            </td>
            
            <td class="p-1">
                <select class="inp-type w-full border border-slate-200 rounded p-1.5 text-[10px] font-bold uppercase bg-white focus:border-indigo-500">
                    <option value="standard">GST Product</option>
                    <option value="non_gst">Non-GST</option>
                    <option value="raw_material">Raw Mat.</option>
                </select>
            </td>
            
            <td class="p-1"><input type="number" class="inp-base-rate w-full border border-slate-200 focus:border-indigo-500 rounded p-1.5 text-sm font-bold text-slate-800 calc-trigger" placeholder="0.00"></td>
            <td class="p-1 min-w-[120px]">
                <div class="flex items-stretch border border-slate-200 rounded focus-within:border-indigo-500 overflow-hidden bg-white">
                    <input type="number" class="inp-sch-disc w-full min-w-0 border-none p-1.5 text-sm font-bold text-slate-800 calc-trigger focus:ring-0" placeholder="0">
                    <select class="inp-sch-type bg-slate-100 text-slate-600 text-[10px] font-black border-l border-slate-200 px-1 cursor-pointer calc-trigger outline-none">
                        <option value="rs">₹</option><option value="pct">%</option>
                    </select>
                </div>
            </td>
            <td class="p-1 min-w-[120px]">
                <div class="flex items-stretch border border-slate-200 rounded focus-within:border-indigo-500 overflow-hidden bg-white">
                    <input type="number" class="inp-rs-disc w-full min-w-0 border-none p-1.5 text-sm font-bold text-slate-800 calc-trigger focus:ring-0" placeholder="0">
                    <select class="inp-rs-type bg-slate-100 text-slate-600 text-[10px] font-black border-l border-slate-200 px-1 cursor-pointer calc-trigger outline-none">
                        <option value="rs">₹</option><option value="pct">%</option>
                    </select>
                </div>
            </td>
            
            <td class="p-1 min-w-[100px]"><input type="number" class="inp-taxable w-full border border-slate-200 bg-slate-50 focus:border-indigo-500 rounded p-1.5 text-sm font-bold text-slate-600 calc-trigger" placeholder="0.00"></td>
            
            <td class="p-1 min-w-[90px]">
                <select class="inp-gst w-full border border-slate-200 focus:border-indigo-500 rounded p-1.5 text-sm text-center font-bold text-slate-800 calc-trigger bg-white">
                    <option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option>
                </select>
            </td>
            
            <td class="p-1 min-w-[80px]"><input type="number" class="inp-cess w-full border border-slate-200 focus:border-indigo-500 rounded p-1.5 text-sm text-center font-bold text-red-600 calc-trigger" placeholder="0%"></td>
            
            <td class="p-1">
                <div class="flex gap-1">
                    <input type="number" class="inp-cgst w-full border border-slate-200 bg-slate-50 focus:border-indigo-500 rounded p-1.5 text-xs font-medium text-slate-500" placeholder="CGST" tabindex="-1">
                    <input type="number" class="inp-sgst w-full border border-slate-200 bg-slate-50 focus:border-indigo-500 rounded p-1.5 text-xs font-medium text-slate-500" placeholder="SGST" tabindex="-1">
                </div>
            </td>
            
            <td class="p-1 min-w-[120px]"><input type="number" class="inp-net w-full border border-slate-200 bg-slate-50 focus:border-indigo-500 rounded p-1.5 text-sm font-bold text-slate-900 calc-trigger" placeholder="0.00"></td>
            
            <td class="p-1"><input type="text" class="inp-hsn w-full border border-slate-200 focus:border-indigo-500 rounded p-1.5 text-sm font-mono text-slate-600" placeholder="HSN"></td>
            <td class="p-1"><input type="text" class="inp-batch w-full border border-slate-200 focus:border-indigo-500 rounded p-1.5 text-sm text-slate-600 uppercase" placeholder="Batch"></td>
            <td class="p-1"><input type="date" class="inp-expiry w-full border border-slate-200 focus:border-indigo-500 rounded p-1.5 text-sm text-slate-600"></td>
            
            <td class="p-1 text-center">
                <button type="button" class="delete-row-btn text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors" title="Remove Item" tabindex="-1">
                    <svg class="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </td>
        </tr>
        `;
    };

    let initialRows = '';
    for(let i=0; i<5; i++) initialRows += generateEmptyRow(i);

    const html = `
    ${datalistHtml}
    <div id="manual-bulk-overlay" class="fixed inset-0 z-[200] bg-slate-900 flex flex-col animate-fadeIn">
        <header class="flex justify-between items-center p-6 bg-slate-800 border-b border-slate-700 shadow-lg shrink-0">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-indigo-500/20 text-indigo-400 flex items-center justify-center rounded-2xl shadow-inner">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                </div>
                <div>
                    <h2 class="text-2xl font-black text-white tracking-tight">Manual Bulk Upload</h2>
                    <p class="text-slate-400 text-sm font-medium">Type rapidly. Use the Tab key to move between fields.</p>
                </div>
            </div>
            <div class="flex gap-3">
                <button id="btn-open-guide" class="px-4 py-3 bg-indigo-900/50 text-indigo-300 hover:text-white hover:bg-indigo-700 rounded-xl font-bold transition-colors flex items-center gap-2 border border-indigo-500/30">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    Guide
                </button>
                <button id="cancel-bulk-btn" class="px-6 py-3 text-slate-300 font-bold hover:text-white hover:bg-slate-700 rounded-xl transition-colors">Discard</button>
                <button id="confirm-bulk-btn" class="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-indigo-500/20 transition-all active:scale-95 flex items-center gap-2">
                    Save to Database
                </button>
            </div>
        </header>

        <div class="flex-1 bg-slate-50 flex flex-col overflow-hidden relative">
            
            <div class="bg-white p-6 border-b border-slate-200 shrink-0 shadow-sm z-10 flex flex-col gap-4">
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-100 pb-3 gap-4">
                    <h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Supplier & Invoice Details</h3>
                    
                    <div class="flex items-center gap-3 bg-indigo-50/50 border border-indigo-100 p-1.5 rounded-xl shadow-sm">
                        <label class="text-[10px] font-black text-indigo-600 uppercase tracking-wider pl-2">Upload Context:</label>
                        <select id="bulk-upload-type-select" class="bg-white border border-indigo-200 rounded-lg p-1.5 text-xs font-black text-indigo-700 outline-none cursor-pointer focus:border-indigo-500 transition-colors shadow-sm">
                            <option value="standard">Purchase Invoice (Standard)</option>
                            <option value="non_gst">Local / Non-GST Goods</option>
                        </select>
                    </div>
                </div>

                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div><label class="text-[10px] font-bold text-slate-500">Dealer Phone</label><input type="text" id="bulk-supplier-phone" class="w-full border-b border-slate-300 p-1 text-sm font-bold focus:border-indigo-500 outline-none bg-transparent hover:bg-slate-50" placeholder="Search by Phone"></div>
                    <div><label class="text-[10px] font-bold text-slate-500">Store / Dealer Name *</label><input type="text" id="bulk-supplier-name" list="bulk-dealer-list" class="w-full border-b border-slate-300 p-1 text-sm font-bold focus:border-indigo-500 outline-none bg-transparent hover:bg-slate-50" placeholder="Required"></div>
                    <div>
    <label class="text-[10px] font-bold text-slate-500">Supplier GSTIN</label>
    <div class="relative">
        <input type="text" id="bulk-supplier-gstin" class="w-full border-b border-slate-300 p-1 pr-16 text-sm font-bold uppercase focus:border-indigo-500 outline-none bg-transparent hover:bg-slate-50">
        <button type="button" id="bulk-verify-gstin-btn" class="absolute right-0 bottom-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors hidden bg-slate-50 px-2 py-0.5 rounded">Verify</button>
    </div>
</div>
                    <div><label class="text-[10px] font-bold text-slate-500">Purchase Date</label><input type="date" id="bulk-purchase-date" value="${todayISO}" class="w-full border-b border-slate-300 p-1 text-sm font-bold focus:border-indigo-500 outline-none bg-transparent hover:bg-slate-50"></div>
                    
                    <div><label class="text-[10px] font-bold text-slate-500">Supplier PAN</label><input type="text" id="bulk-supplier-pan" class="w-full border-b border-slate-300 p-1 text-sm font-bold uppercase focus:border-indigo-500 outline-none bg-transparent hover:bg-slate-50"></div>
                
                    <div><label class="text-[10px] font-bold text-slate-500">Invoice Number</label><input type="text" id="bulk-invoice-no" class="w-full border-b border-slate-300 p-1 text-sm font-bold focus:border-indigo-500 outline-none bg-transparent hover:bg-slate-50"></div>
                </div>
            </div>

            <div class="flex-1 overflow-auto dark-scrollbar bg-slate-50 p-6 relative flex flex-col">
                
                <div class="flex items-center justify-between bg-indigo-50/80 p-4 rounded-xl mb-6 border border-indigo-200 shadow-sm shrink-0 gap-4">
                    <div class="flex items-center gap-3 flex-1">
                        <div class="p-2.5 bg-indigo-100 text-indigo-700 rounded-lg shrink-0">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                        </div>
                        <div class="min-w-0">
                            <h4 class="text-sm font-black text-indigo-900 tracking-tight">Manual Tax Interpretation</h4>
                            <p class="text-[11px] text-indigo-600 font-bold uppercase tracking-wider mt-0.5 truncate">Flip switch if the rates you are typing already include tax.</p>
                        </div>
                    </div>
                    
                    <div class="flex items-center gap-3 bg-white px-4 py-2.5 rounded-lg border border-indigo-100 shadow-sm shrink-0">
                        <span class="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Exclusive (+GST)</span>
                        <label class="flex items-center cursor-pointer relative z-10">
                            <input type="checkbox" id="bulk-tax-override-toggle" class="sr-only">
                            <div class="w-12 h-6 bg-slate-300 rounded-full transition-colors duration-300 ease-in-out"></div>
                            <div class="dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-300 ease-in-out shadow-sm transform translate-x-0"></div>
                        </label>
                        <span class="text-[11px] font-black text-indigo-700 uppercase tracking-widest">Inclusive (Net)</span>
                    </div>
                </div>

                <table class="w-full text-left border-collapse" id="bulk-manual-table">
                    <thead class="sticky top-0 bg-slate-100 shadow-sm z-20">
                        <tr class="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                            <th class="p-2 min-w-[200px]">Product Name*</th>
                            <th class="p-2 min-w-[120px]">SKU/Code</th>
                            <th class="p-2 min-w-[120px]">Barcode</th>
                            
                            <th class="p-2 min-w-[100px]">
                                <div class="flex items-center gap-1.5">
                                    <span>MRP</span>
                                    <button type="button" id="push-mrp-btn" class="text-slate-400 hover:text-indigo-600 bg-transparent hover:bg-indigo-100/80 p-1 rounded-md transition-colors" title="Push MRP into Selling Price">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                                    </button>
                                </div>
                            </th>
                            <th class="p-2 min-w-[120px] text-indigo-600 bg-indigo-50/50">
                                <div class="flex items-center gap-1.5">
                                    <button type="button" id="push-sp-btn" class="text-indigo-400 hover:text-indigo-700 bg-transparent hover:bg-indigo-200/50 p-1 rounded-md transition-colors" title="Push Selling Price into MRP">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                                    </button>
                                    <span>Selling Price*</span>
                                </div>
                            </th>
                            <th class="p-2 min-w-[100px]">Unit Cost</th>
                            <th class="p-2 min-w-[90px] text-slate-400 bg-slate-200/50 border-l border-r border-slate-300">Total Stock</th>
                            <th class="p-2 min-w-[90px]">CS</th>
                            <th class="p-2 min-w-[90px]">UPC</th>
                            <th class="p-2 min-w-[90px]">Pcs Loose</th>
                            <th class="px-3 py-2 text-center text-xs font-bold text-emerald-600 uppercase tracking-wider bg-emerald-50">Free (FOC)</th>
                            
                            <th class="p-2 min-w-[110px]">
                                <div class="flex flex-col gap-1">
                                    <span>Unit Type</span>
                                    <select id="bulk-unit-select" class="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded p-1 cursor-pointer outline-none">
                                        <option value="">-- Bulk --</option>
                                        ${unitOptions.map(u => `<option value="${u.value}">${u.label}</option>`).join('')}
                                    </select>
                                </div>
                            </th>
                            
                            <th class="p-2">
                                <div class="flex flex-col gap-1">
                                    <span>Type</span>
                                    <select id="global-type-sync" class="text-[9px] font-bold text-indigo-700 bg-white border border-indigo-200 rounded p-0.5 cursor-pointer">
                                        <option value="standard">GST Product</option>
                                        <option value="non_gst">Non-GST</option>
                                        <option value="raw_material">Raw Mat.</option>
                                    </select>
                                </div>
                            </th>
                            
                            <th class="p-2 min-w-[110px]">Base Rate</th>
                            <th class="p-2 min-w-[90px]">Sch Disc</th>
                            <th class="p-2 min-w-[90px]">Rs Disc</th>
                            <th class="p-2 min-w-[100px]">Taxable Amt</th>
                            <th class="p-2 min-w-[90px]">
                                <div class="flex flex-col gap-1">
                                    <span>GST %</span>
                                    <select id="bulk-gst-select" class="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded p-1 cursor-pointer outline-none">
                                        <option value="">- Bulk -</option>
                                        <option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option>
                                    </select>
                                </div>
                            </th>
                            <th class="p-2 min-w-[80px] text-red-600 bg-red-50/50">CESS %</th>
                            <th class="p-2 min-w-[140px]">CGST/SGST</th>
                            <th class="p-2 min-w-[120px]">Net Amount</th>
                            <th class="p-2 min-w-[110px]">HSN Code</th>
                            <th class="p-2 min-w-[120px]">Batch</th>
                            <th class="p-2 min-w-[140px]">Expiry</th>
                            <th class="p-2 min-w-[60px] text-center">Del</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200 bg-white" id="bulk-tbody">
                        ${initialRows}
                    </tbody>
                </table>
                
                <div class="mt-4 flex justify-center pb-8">
                    <button id="add-bulk-row-btn" class="flex items-center gap-2 px-6 py-2.5 bg-white hover:bg-indigo-50 text-indigo-600 font-black tracking-wide rounded-xl transition-colors shadow-sm border border-indigo-100">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        Add 5 More Rows
                    </button>
                </div>
            </div>

            <div class="bg-white border-t border-slate-200 p-5 pb-20 shrink-0 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.05)] z-30 flex flex-col gap-4">
                <div class="flex justify-between items-center w-full">
                    <div class="flex flex-col gap-1">
                        <p class="text-xs text-slate-400 font-medium">✏️ Adjust the <strong class="text-amber-500">Round Off</strong> field to match the physical bill.</p>
                        <div class="flex items-center gap-2 mt-2">
                            <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Payment Mode:</span>
                            <select id="bulk-payment-method" class="border border-slate-300 rounded-lg p-1.5 text-sm font-bold text-indigo-700 outline-none focus:border-indigo-500 bg-white shadow-sm cursor-pointer">
                                <option value="CASH">Cash</option>
                                <option value="CHEQUE">Cheque</option>
                                <option value="UPI">UPI</option>
                                <option value="CREDIT">Credit (Udhaar)</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="flex items-center gap-6">
                        <div class="flex flex-col items-end">
                            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Subtotal</span>
                            <span id="bulk-subtotal-display" class="text-lg font-black text-slate-600">₹0.00</span>
                        </div>
                        <div class="text-slate-300 text-3xl font-light leading-none">-</div>
                        <div class="flex flex-col items-end">
                            <span class="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Round Off</span>
                            <div class="relative">
                                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-amber-700 font-bold">₹</span>
                                <input type="number" id="bulk-round-off" class="w-28 bg-amber-50 border border-amber-200 text-amber-900 font-black text-xl rounded-xl py-1.5 pr-3 pl-8 text-right outline-none transition-all shadow-inner" placeholder="0.00">
                            </div>
                        </div>
                        <div class="text-slate-300 text-3xl font-light leading-none">=</div>
                        <div class="flex flex-col items-end">
                            <span class="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Final Total</span>
                            <div class="relative">
                                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-700 font-black text-xl">₹</span>
                                <input type="number" id="bulk-invoice-total" class="w-40 bg-emerald-50 border border-emerald-200 text-emerald-900 font-black text-2xl rounded-xl py-1.5 pr-3 pl-8 text-right outline-none shadow-inner" readonly>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="bulk-cheque-details" class="hidden flex gap-3 justify-start items-center bg-indigo-50/50 p-3 rounded-xl border border-indigo-100">
                    <span class="text-indigo-800 font-bold text-[10px] uppercase tracking-wide">Cheque Info:</span>
                    <input type="text" id="bulk-cheque-bank" placeholder="Bank Name" class="border border-indigo-200 rounded p-1.5 text-sm w-40">
                    <input type="text" id="bulk-cheque-no" placeholder="Cheque No" class="border border-indigo-200 rounded p-1.5 text-sm w-40 font-mono">
                    <input type="date" id="bulk-cheque-date" class="border border-indigo-200 rounded p-1.5 text-sm text-slate-600">
                </div>
            </div>

        </div>
    </div>
    <style>
        .dark-scrollbar::-webkit-scrollbar { width: 12px; height: 12px; }
        .dark-scrollbar::-webkit-scrollbar-track { background: #f8fafc; border-radius: 8px; }
        .dark-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 8px; border: 2px solid #f8fafc; }
        .dark-scrollbar::-webkit-scrollbar-thumb:hover { background: #0f172a; } 
        #bulk-tax-override-toggle:checked + div { background-color: #4f46e5; }
        #bulk-tax-override-toggle:checked ~ .dot { transform: translateX(24px); }
    </style>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    
    // Wire the Guide button
    document.getElementById('btn-open-guide').addEventListener('click', openBulkGuideModal);

    // Sync Item Type
    document.getElementById('global-type-sync').addEventListener('change', (e) => {
        const val = e.target.value;
        document.querySelectorAll('.inp-type').forEach(el => {
            el.value = val;
            el.dispatchEvent(new Event('change', { bubbles: true })); // 🚀 THE FIX: Wakes up the row listener!
        });
    });

    // 2. INITIALIZE LOCK-BREAKER STATE & ELEMENTS (Inside the scope)
    let bulkDealerState = { id: null, phone: '', name: '' };
    const supplierInput = document.getElementById('bulk-supplier-name');
    const phoneInput = document.getElementById('bulk-supplier-phone');
    const gstinInput = document.getElementById('bulk-supplier-gstin');
    const panInput = document.getElementById('bulk-supplier-pan');

    const clearDealerDetails = (wipeName = false) => {
        if (wipeName && supplierInput) supplierInput.value = '';
        if (gstinInput) gstinInput.value = '';
        if (panInput) panInput.value = '';
        [supplierInput, phoneInput, gstinInput, panInput].forEach(el => {
            if(el) el.classList.remove('bg-gray-100');
        });
    };

    const fillDealerFields = (data) => {
        if (supplierInput && supplierInput !== document.activeElement) supplierInput.value = data.name || data.storeName || '';
        if (phoneInput && phoneInput !== document.activeElement) phoneInput.value = data.phone || '';
        if (gstinInput) { gstinInput.value = data.gstin || ''; gstinInput.classList.add('bg-gray-100'); }
        if (panInput) { panInput.value = data.pan || ''; panInput.classList.add('bg-gray-100'); }
    };

    // 3. LISTENERS
    if (phoneInput) {
        phoneInput.addEventListener('input', (e) => {
            const rawDigits = e.target.value.replace(/\D/g, '');
            // Lock Breaker: Wipe if phone is cleared or radically changed
            if (rawDigits.length < 3 || (bulkDealerState.id && !bulkDealerState.phone.includes(rawDigits))) {
                bulkDealerState = { id: null, phone: '', name: '' };
                clearDealerDetails(true);
            }
            if (rawDigits.length >= 10) {
                const match = dealersCache.find(d => (d.phone || '').replace(/\D/g, '').endsWith(rawDigits.slice(-10)));
                if (match) {
                    bulkDealerState = { id: match.id, phone: match.phone, name: match.name };
                    fillDealerFields(match);
                }
            }
        });
    }

    if (supplierInput) {
        supplierInput.addEventListener('input', (e) => {
            const val = e.target.value.trim().toLowerCase();
            if (!val) {
                bulkDealerState = { id: null, phone: '', name: '' };
                clearDealerDetails(false);
                return;
            }
            if (bulkDealerState.id && bulkDealerState.name.toLowerCase() !== val) {
                bulkDealerState = { id: null, phone: '', name: '' };
                clearDealerDetails(false);
            }
            const match = dealersCache.find(d => (d.name || d.storeName || '').toLowerCase() === val);
            if (match) {
                bulkDealerState = { id: match.id, phone: match.phone, name: match.name };
                fillDealerFields(match);
            }
        });
    }


    // ------------------------------------------------------------------------
    // 🚀 SMART DIRECTORY SYNC, GHOST +91, & GLOBAL FETCH (Bulletproof)
    // ------------------------------------------------------------------------
    const supName = document.getElementById('bulk-supplier-name');
    const supPhone = document.getElementById('bulk-supplier-phone');
    const supGstin = document.getElementById('bulk-supplier-gstin');
    const verifyGstinBtn = document.getElementById('bulk-verify-gstin-btn');

    if (supGstin && verifyGstinBtn) {
        supGstin.addEventListener('input', (e) => {
            const val = e.target.value.toUpperCase();
            if (val.length === 15) {
                verifyGstinBtn.classList.remove('hidden');
            } else {
                verifyGstinBtn.classList.add('hidden');
            }
        });

        verifyGstinBtn.addEventListener('click', async () => {
            const gstin = supGstin.value.toUpperCase();
            if (gstin.length !== 15) return;

            // In a fully offline SQLite app, we cannot hit the live Govt portal.
            // We rely purely on local syntax validation and extracting the PAN.
            try {
                verifyGstinBtn.disabled = true;
                
                // Extract PAN from GSTIN (Characters 3 through 12)
                const extractedPan = gstin.substring(2, 12);
                
                if (supPan && !supPan.value) {
                    supPan.value = extractedPan;
                    supPan.classList.add('bg-emerald-50', 'transition-colors');
                    setTimeout(() => supPan.classList.remove('bg-emerald-50'), 800);
                }
                
                if (typeof showToast === 'function') {
                    showToast('Offline Validation', `Extracted PAN: ${extractedPan}`, 'success');
                }
            } catch (err) {
                console.warn("Local GSTIN extraction error:", err);
            } finally {
                verifyGstinBtn.disabled = false;
            }
        });
    }
    const supPan = document.getElementById('bulk-supplier-pan');

    let activeBulkDealerState = { id: null, phone: '', name: '' };
    let bulkDealerLookupDebounce;

    const unlockBulkDealerFields = () => {
        if (supGstin) supGstin.classList.remove('bg-gray-100');
        if (supPan) supPan.classList.remove('bg-gray-100');
    };

    const fillSupplierSafe = (data) => {
        if (!data) return unlockBulkDealerFields();
        
        const dbName = (data.name || data.storeName || data.tradeName || data.legalName || '').trim();
        let dbPhone = (data.phone || '').trim();
        dbPhone = dbPhone.replace(/^\+?91/, ''); // Ghost +91
        const dbGst = (data.gstin || data.taxId || '').trim();
        const dbPan = (data.pan || '').trim();

        if (dbName && supName && !supName.value) {
            supName.value = dbName;
            supName.classList.add('bg-indigo-50', 'transition-colors');
            setTimeout(() => supName.classList.remove('bg-indigo-50'), 800);
        }
        if (dbPhone && supPhone && !supPhone.value) {
            supPhone.value = dbPhone;
            supPhone.classList.add('bg-indigo-50', 'transition-colors');
            setTimeout(() => supPhone.classList.remove('bg-indigo-50'), 800);
        }
        if (supGstin && dbGst) supGstin.value = dbGst; 
        if (supPan && dbPan) supPan.value = dbPan; 

        unlockBulkDealerFields(); // Never lock fields
    };

    const handleBulkDealerSync = async (triggerField, rawValue) => {
        let val = (rawValue || '').trim();
        const rawDigits = val.replace(/\D/g, '');

        if (!val || (triggerField === 'phone' && rawDigits.length < 3)) {
            activeBulkDealerState = { id: null, phone: '', name: '' };
            unlockBulkDealerFields();
            return;
        }

        if (activeBulkDealerState.id) {
            if (triggerField === 'phone' && !activeBulkDealerState.phone.includes(rawDigits)) {
                activeBulkDealerState = { id: null, phone: '', name: '' };
            } else if (triggerField === 'name' && activeBulkDealerState.name.toLowerCase() !== val.toLowerCase()) {
                activeBulkDealerState = { id: null, phone: '', name: '' };
            }
        }

        let match = null;

        // 1. Local Cache Check
        if (triggerField === 'name') {
            match = dealersCache.find(d => (d.name || d.storeName || '').toLowerCase() === val.toLowerCase());
        } else if (triggerField === 'phone' && rawDigits.length >= 10) {
            const last10 = rawDigits.slice(-10);
            match = dealersCache.find(d => (d.phone || '').replace(/\D/g, '').endsWith(last10));
        } else if (triggerField === 'gstin' && val.length >= 15) {
            match = dealersCache.find(d => (d.gstin || '').toUpperCase() === val.toUpperCase());
        } 

        // 2. Local SQLite Fetch if not found in cache
        if (!match && triggerField !== 'name') {
            try {
                if (triggerField === 'phone' && rawDigits.length >= 10) {
                    if (supPhone) supPhone.classList.add('animate-pulse');
                    match = await window.dbAPI.getSupplierByPhone(rawDigits.slice(-10));
                } else if (triggerField === 'gstin' && val.length === 15) {
                    if (supGstin) supGstin.classList.add('animate-pulse');
                    match = await window.dbAPI.getSupplierByGSTIN(val);
                } 

                if (match) {
                    if (typeof showToast === 'function') showToast("Database Match", "Supplier Profile Loaded", "success");
                }
            } catch (err) {
                console.warn("SQLite directory fetch failed", err);
            } finally {
                if (supPhone) supPhone.classList.remove('animate-pulse');
                if (supGstin) supGstin.classList.remove('animate-pulse');
            }
        }

        if (match) {
            activeBulkDealerState = { id: match.id || match.merchantId, phone: match.phone || '', name: match.name || match.storeName || '' };
            fillSupplierSafe(match);
        } else {
            unlockBulkDealerFields();
        }
    };

    // Attach listeners directly to inputs for Bulk Modal
    if (supName) supName.addEventListener('input', (e) => handleBulkDealerSync('name', e.target.value));
    
    if (supPhone) {
        supPhone.addEventListener('input', (e) => {
            let val = e.target.value.replace(/[^\d+]/g, ''); 
            if (val.startsWith('+91')) val = val.substring(3);
            else if (val.startsWith('91') && val.length > 10) val = val.substring(2);
            if (val.length > 10) val = val.substring(0, 10);
            if (e.target.value !== val) e.target.value = val;

            clearTimeout(bulkDealerLookupDebounce);
            bulkDealerLookupDebounce = setTimeout(() => handleBulkDealerSync('phone', val), 400);
        });
    }

    if (supGstin) {
        supGstin.addEventListener('input', async (e) => {
            let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (e.target.value !== val) e.target.value = val;

            if (val.length === 15) {
                if (supPan && !supPan.value) {
                    supPan.value = val.substring(2, 12);
                    supPan.classList.add('bg-emerald-50', 'transition-colors');
                    setTimeout(() => supPan.classList.remove('bg-emerald-50'), 800);
                }
                clearTimeout(bulkDealerLookupDebounce);
                bulkDealerLookupDebounce = setTimeout(() => handleBulkDealerSync('gstin', val), 400);
            } else {
                if (val.length < 15) {
                    if (supPan) supPan.value = '';
                    if (supName) supName.value = '';
                    if (supPhone) supPhone.value = '';
                    activeBulkDealerState = { id: null, phone: '', name: '' };
                }
            }
        });
    }

    

    const uploadTypeSelect = document.getElementById('bulk-upload-type-select');
    if (uploadTypeSelect) {
        uploadTypeSelect.addEventListener('change', (e) => {
            const isNonGst = e.target.value === 'non_gst';
            const globalTypeSync = document.getElementById('global-type-sync');
            
            if (isNonGst) {
                // Lock out irrelevant strict sourcing fields, but leave Name and Phone open!
                [gstinInput, panInput, document.getElementById('bulk-invoice-no')].forEach(el => {
                    if (el) {
                        el.value = '';
                        el.disabled = true;
                        el.classList.add('bg-gray-100');
                    }
                });
                // Sync all table rows to Non-GST automatically
                if (globalTypeSync) {
                    globalTypeSync.value = 'non_gst';
                    globalTypeSync.dispatchEvent(new Event('change'));
                }
            } else {
                // Unlock everything for Standard
                [gstinInput, panInput, document.getElementById('bulk-invoice-no')].forEach(el => {
                    if (el) {
                        el.disabled = false;
                        el.classList.remove('bg-gray-100');
                    }
                });
                if (globalTypeSync) {
                    globalTypeSync.value = 'standard';
                    globalTypeSync.dispatchEvent(new Event('change'));
                }
            }
        });
    }

    const tbody = document.getElementById('bulk-tbody');
    
    // 🚀 THE FIX 1: Auto-Highlight text safely using an async boundary
    tbody.addEventListener('focusin', (e) => {
        if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
            // Using a 10ms timeout prevents a fatal Electron race condition. 
            // It allows the native mouse click to finish placing the text caret 
            // BEFORE we programmatically highlight the text.
            setTimeout(() => {
                if (document.activeElement === e.target) {
                    e.target.select();
                }
            }, 10);
        }
    });

    // 🚀 THE FIX 2: Bi-Directional "Push" Sync Logic

    // 🚀 NEW: Row-level TYPE change listener (to force GST to 0 for non-gst)
    tbody.addEventListener('change', (e) => {
        if (e.target.classList.contains('inp-type')) {
            const row = e.target.closest('tr');
            if (!row) return;
            const typeValue = e.target.value;
            
            if (typeValue === 'non_gst') {
                const gstEl = row.querySelector('.inp-gst');
                const cessEl = row.querySelector('.inp-cess');
                if (gstEl) {
                    gstEl.value = '0';
                    gstEl.dispatchEvent(new Event('input', { bubbles: true }));
                }
                if (cessEl) {
                    cessEl.value = '0';
                    cessEl.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        }
    });

    // 🚀 THE FIX 2: Bi-Directional "Push" Sync Logic
    
    // Push FORWARD (MRP -> Selling Price)
    document.getElementById('push-mrp-btn')?.addEventListener('click', () => {
        const rows = document.querySelectorAll('#bulk-manual-table tbody tr.bulk-row');
        let count = 0;
        rows.forEach(row => {
            const mrp = row.querySelector('.inp-mrp').value;
            const spEl = row.querySelector('.inp-selling-price');
            if (mrp && spEl) {
                spEl.value = mrp;
                // 🚀 WAKE UP MATH ENGINE: Force taxes & base rate to recalculate based on new Selling Price!
                spEl.dispatchEvent(new Event('input', { bubbles: true }));
                count++;
            }
        });
        if (typeof showToast === 'function') showToast("Synced", `Pushed MRP to Selling Price for ${count} rows.`, "success");
    });

    // Push BACKWARD (Selling Price -> MRP)
    document.getElementById('push-sp-btn')?.addEventListener('click', () => {
        const rows = document.querySelectorAll('#bulk-manual-table tbody tr.bulk-row');
        let count = 0;
        rows.forEach(row => {
            const sp = row.querySelector('.inp-selling-price').value;
            const mrpEl = row.querySelector('.inp-mrp');
            if (sp && mrpEl) { 
                mrpEl.value = sp; 
                count++; 
            }
        });
        if (typeof showToast === 'function') showToast("Synced", `Pushed Selling Price to MRP for ${count} rows.`, "success");
    });
    let isInclusiveMode = false;

    const recalculateTotal = () => {
        const netInputs = document.querySelectorAll('.inp-net');
        let sum = 0;
        netInputs.forEach(n => sum += (parseFloat(n.value) || 0));
        
        const roundOffVal = parseFloat(document.getElementById('bulk-round-off').value) || 0;
        const finalTotal = sum - roundOffVal;

        document.getElementById('bulk-subtotal-display').innerText = `₹${sum.toFixed(2)}`;
        document.getElementById('bulk-invoice-total').value = finalTotal.toFixed(2);
    };

    recalculateTotal();
    document.getElementById('bulk-round-off').addEventListener('input', recalculateTotal);

    // Cheque Drawer
    document.getElementById('bulk-payment-method').addEventListener('change', (e) => {
        const drawer = document.getElementById('bulk-cheque-details');
        if (e.target.value === 'CHEQUE') {
            drawer.classList.remove('hidden'); drawer.classList.add('flex');
        } else {
            drawer.classList.add('hidden'); drawer.classList.remove('flex');
        }
    });

    // Add Rows Button
    document.getElementById('add-bulk-row-btn').addEventListener('click', () => {
        const currentCount = tbody.querySelectorAll('tr').length;
        let newRows = '';
        for(let i = 0; i < 5; i++) newRows += generateEmptyRow(currentCount + i);
        tbody.insertAdjacentHTML('beforeend', newRows);
        
        const scrollContainer = document.querySelector('.dark-scrollbar');
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
    });

    // Bulk Unit Change
    const bulkUnitSelect = document.getElementById('bulk-unit-select'); 
    if (bulkUnitSelect) {
        bulkUnitSelect.addEventListener('change', (e) => {
            const selectedUnit = e.target.value;
            if (!selectedUnit) return; 
            document.querySelectorAll('.inp-unit').forEach(select => select.value = selectedUnit);
        });
    }
    // 🚀 NEW: Bulk GST Change
    const bulkGstSelect = document.getElementById('bulk-gst-select'); 
    if (bulkGstSelect) {
        bulkGstSelect.addEventListener('change', (e) => {
            const selectedGst = e.target.value;
            if (!selectedGst) return; 
            document.querySelectorAll('.inp-gst').forEach(select => {
                select.value = selectedGst;
                // Trigger the math engine for each row!
                select.dispatchEvent(new Event('input', { bubbles: true }));
            });
        });
    }
    // Delete Row
    tbody.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.delete-row-btn');
        if (deleteBtn) {
            const row = deleteBtn.closest('tr');
            if (row) {
                row.style.opacity = "0";
                setTimeout(() => {
                    row.remove();
                    recalculateTotal(); 
                }, 200);
            }
        }
    });

    // TAX TOGGLE PARADIGM
    document.getElementById('bulk-tax-override-toggle').addEventListener('change', (e) => {
        isInclusiveMode = e.target.checked;
        const rows = document.querySelectorAll('#bulk-manual-table tbody tr.bulk-row');
        
        rows.forEach((row) => {
            const getVal = (cls) => parseFloat(row.querySelector(cls)?.value) || 0;
            const setVal = (cls, val) => { const el = row.querySelector(cls); if(el && el !== document.activeElement) el.value = val; };

            const qty = getVal('.inp-total-stock') || 1;
            const gst = getVal('.inp-gst');
            const cess = getVal('.inp-cess');
            const schDisc = getVal('.inp-sch-disc');
            const rsDisc = getVal('.inp-rs-disc');

            const printedRate = getVal('.inp-base-rate');
            if (printedRate === 0) return; 

            const taxMultiplier = 1 + (gst / 100) + (cess / 100);
            let newTaxable, newNet;

            if (isInclusiveMode) {
                const rawLineTotal = (printedRate * qty) - schDisc - rsDisc;
                newNet = Math.max(0, rawLineTotal);
                newTaxable = newNet / taxMultiplier;
            } else {
                const rawTaxable = (printedRate * qty) - schDisc - rsDisc;
                newTaxable = Math.max(0, rawTaxable);
                newNet = newTaxable * taxMultiplier;
            }

            const totalTaxAmt = newNet - newTaxable;
            const halfTax = totalTaxAmt / 2;

            setVal('.inp-taxable', newTaxable.toFixed(2));
            setVal('.inp-net', newNet.toFixed(2));
            setVal('.inp-cgst', halfTax.toFixed(2));
            setVal('.inp-sgst', halfTax.toFixed(2));
            
            const unitCostInput = row.querySelector('.inp-unit-cost');
            if (unitCostInput && newNet > 0) unitCostInput.value = (newNet / qty).toFixed(2);
        });
        recalculateTotal();
    });

    // OMNI-DIRECTIONAL MATH ENGINE & BARCODE ROUTER
    tbody.addEventListener('input', (e) => {
        const row = e.target.closest('tr');
        const target = e.target;
        if (!row || !target) return;
        
        // 🚀 SCENARIO 1: BARCODE AUTO-FETCH
        if (target.classList.contains('inp-barcode')) {
            const code = target.value.trim();
            // Wait for at least 3 characters before searching memory
            if (code.length >= 3 && productsCache.length > 0) {
                const match = productsCache.find(p => p.barcode === code || p.sku === code);
                if (match) {
                    const setVal = (cls, val) => { const el = row.querySelector(cls); if(el) el.value = val; };
                    setVal('.inp-name', match.name || '');
                    setVal('.inp-mrp', match.mrp || match.price || '');
                    setVal('.inp-selling-price', match.price || '');
                    setVal('.inp-unit-cost', match.cost || '');
                    setVal('.inp-gst', match.gstSlab || '0');
                    setVal('.inp-cess', match.cess || '0');
                    setVal('.inp-hsn', match.hsn || '');
                    setVal('.inp-type', match.type || 'standard');
                    
                    // 🚀 NEW: Explicitly load the Base Rate for the math engine
                    setVal('.inp-base-rate', match.baseRate || match.cost || '');
                    
                    // 🚀 FORCE THE MATH ENGINE TO WAKE UP USING BASE RATE
                    const baseRateEl = row.querySelector('.inp-base-rate');
                    if (baseRateEl) {
                        baseRateEl.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    
                    if (typeof showToast === 'function') showToast('Product Found', `Loaded: ${match.name}`, 'success');
                }
            }
            return; // Exit here. No math needed unless it triggers the line above.
        }

        // 🚀 SCENARIO 2: LIVE MATH
        const isQty = target.classList.contains('inp-cs') || target.classList.contains('inp-upc') || target.classList.contains('inp-pcs') || target.classList.contains('inp-free-qty');
        const isRate = target.classList.contains('inp-base-rate');
        const isDisc = target.classList.contains('inp-sch-disc') || target.classList.contains('inp-rs-disc') || target.classList.contains('inp-sch-type') || target.classList.contains('inp-rs-type');
        const isTaxable = target.classList.contains('inp-taxable');
        const isTaxPct = target.classList.contains('inp-gst') || target.classList.contains('inp-cess');
        const isNet = target.classList.contains('inp-net');

        // 🚀 THE FIX: Determine the Math Anchor (Forward vs Reverse)
        if (isRate) row.dataset.mathAnchor = 'rate';
        if (isNet || isTaxable) row.dataset.mathAnchor = 'net';
        const anchor = row.dataset.mathAnchor || 'rate';

        if (isQty || isRate || isDisc || isTaxable || isTaxPct || isNet) {
            const cases = parseFloat(row.querySelector('.inp-cs')?.value) || 0;
            const upc = parseFloat(row.querySelector('.inp-upc')?.value) || 1;
            const pcs = parseFloat(row.querySelector('.inp-pcs')?.value) || 0;
            const freeQty = parseFloat(row.querySelector('.inp-free-qty')?.value) || 0; 
            
            const paidStock = (cases * upc) + pcs;
            const totalStock = paidStock + freeQty;
            const calcQty = paidStock > 0 ? paidStock : 1; 
            
            const gstPct = parseFloat(row.querySelector('.inp-gst')?.value) || 0;
            const cessPct = parseFloat(row.querySelector('.inp-cess')?.value) || 0;
            const taxMultiplier = 1 + (gstPct / 100) + (cessPct / 100);
            
            const schDiscVal = parseFloat(row.querySelector('.inp-sch-disc')?.value) || 0;
            const schDiscType = row.querySelector('.inp-sch-type')?.value || 'rs';
            const rsDiscVal = parseFloat(row.querySelector('.inp-rs-disc')?.value) || 0;
            const rsDiscType = row.querySelector('.inp-rs-type')?.value || 'rs';
            
            let printedRate = parseFloat(row.querySelector('.inp-base-rate')?.value) || 0;
            let taxable = parseFloat(row.querySelector('.inp-taxable')?.value) || 0;
            let netAmt = parseFloat(row.querySelector('.inp-net')?.value) || 0;
            
            // 🚀 REVERSE MATH ALGEBRA
            if (anchor === 'net') {
                if (isTaxable) {
                    taxable = parseFloat(target.value) || 0;
                    netAmt = taxable * taxMultiplier;
                } else {
                    netAmt = parseFloat(row.querySelector('.inp-net')?.value) || 0;
                    taxable = netAmt / taxMultiplier;
                }

                // Target Line Total BEFORE tax
                let targetLineTotal = isInclusiveMode ? netAmt : taxable;
                
                let pctSum = 0;
                let absSum = 0;
                if (schDiscType === 'pct') pctSum += (schDiscVal / 100); else absSum += schDiscVal;
                if (rsDiscType === 'pct') pctSum += (rsDiscVal / 100); else absSum += rsDiscVal;
                
                // Solve for X (Base Rate * Qty) algebraically
                let X = 0;
                if (1 - pctSum !== 0) {
                    X = (targetLineTotal + absSum) / (1 - pctSum);
                }
                printedRate = X / calcQty;

            } 
            // 🚀 FORWARD MATH ALGEBRA
            else {
                printedRate = parseFloat(row.querySelector('.inp-base-rate')?.value) || 0;
                const X = printedRate * calcQty;
                
                let schDisc = schDiscType === 'pct' ? X * (schDiscVal / 100) : schDiscVal;
                let rsDisc = rsDiscType === 'pct' ? X * (rsDiscVal / 100) : rsDiscVal;

                let targetLineTotal = Math.max(0, X - schDisc - rsDisc);

                if (isInclusiveMode) {
                    netAmt = targetLineTotal;
                    taxable = netAmt / taxMultiplier;
                } else {
                    taxable = targetLineTotal;
                    netAmt = taxable * taxMultiplier;
                }
            }

            const totalTaxAmt = netAmt - taxable;
            const cgst = totalTaxAmt / 2;
            const sgst = totalTaxAmt / 2;

            const write = (cls, val) => {
                const el = row.querySelector(cls);
                if (el && el !== document.activeElement) el.value = val;
            };

            write('.inp-total-stock', totalStock);
            write('.inp-base-rate', printedRate.toFixed(2));
            write('.inp-taxable', taxable.toFixed(2));
            write('.inp-cgst', cgst.toFixed(2));
            write('.inp-sgst', sgst.toFixed(2));
            write('.inp-net', netAmt.toFixed(2));
            
            const unitCost = totalStock > 0 ? (netAmt / totalStock) : 0;
            write('.inp-unit-cost', unitCost.toFixed(2));

            recalculateTotal();
        }
    });

    const debounceMap = new Map();
    const taxDictionary = [
        { keys: ['coffee', 'nescafe', 'bru'], hsn: '0901', gst: 5, cess: 0 },
        { keys: ['tea', 'chai', 'green tea'], hsn: '0902', gst: 5, cess: 0 },
        { keys: ['spice', 'masala', 'pepper', 'chilli', 'clove', 'cardamom'], hsn: '0910', gst: 5, cess: 0 },
        { keys: ['sugar'], hsn: '1701', gst: 5, cess: 0 },
        { keys: ['milk', 'dudh'], hsn: '0401', gst: 0, cess: 0 },
        { keys: ['cheese', 'butter', 'ghee'], hsn: '0406', gst: 12, cess: 0 },
        { keys: ['paneer'], hsn: '0406', gst: 5, cess: 0 }, 
        { keys: ['rice', 'basmati'], hsn: '1006', gst: 5, cess: 0 },
        { keys: ['wheat', 'atta', 'maida'], hsn: '1001', gst: 5, cess: 0 },
        { keys: ['flour', 'besan'], hsn: '1101', gst: 5, cess: 0 },
        { keys: ['dal', 'pulses', 'lentil', 'moong', 'toor'], hsn: '0713', gst: 5, cess: 0 },
        { keys: ['oil', 'mustard', 'sunflower', 'soyabean'], hsn: '1507', gst: 5, cess: 0 },
        { keys: ['soap', 'santoor', 'lux', 'dove'], hsn: '3401', gst: 18, cess: 0 },
        { keys: ['shampoo', 'conditioner', 'hair'], hsn: '3305', gst: 18, cess: 0 },
        { keys: ['toothpaste', 'colgate', 'pepsodent'], hsn: '3306', font: 18, cess: 0 },
        { keys: ['water', 'bisleri', 'kinley', 'aquafina'], hsn: '2201', gst: 18, cess: 0 },
        { keys: ['biscuit', 'cookies', 'parle', 'britannia', 'oreo'], hsn: '1905', gst: 18, cess: 0 },
        { keys: ['chocolate', 'dairy milk', 'cadbury', 'snickers'], hsn: '1806', gst: 18, cess: 0 },
        { keys: ['snack', 'chips', 'kurkure', 'lays', 'doritos', 'namkeen'], hsn: '2106', gst: 12, cess: 0 },
        { keys: ['electronics', 'mobile', 'charger', 'cable'], hsn: '8517', gst: 18, cess: 0 },
        { keys: ['clothing', 'shirt', 'tshirt', 'pant'], hsn: '6205', gst: 12, cess: 0 },
        { keys: ['medicine', 'tablet', 'syrup', 'paracetamol'], hsn: '3004', gst: 12, cess: 0 },
        { keys: ['aerated', 'coke', 'pepsi', 'sprite', 'thums up', 'cold drink'], hsn: '2202', gst: 28, cess: 12 },
        { keys: ['tobacco', 'cigarette', 'cigar', 'pan masala'], hsn: '2402', gst: 28, cess: 12 }
    ];

    tbody.addEventListener('input', (e) => {
        const target = e.target;
        
        if (target.classList.contains('inp-name')) {
            const row = target.closest('tr');
            const nameVal = target.value.trim();
            const lowerName = nameVal.toLowerCase();
            
            const hsnInput = row.querySelector('.inp-hsn');
            const gstInput = row.querySelector('.inp-gst');
            const cessInput = row.querySelector('.inp-cess');
            const skuInput = row.querySelector('.inp-sku');
            const barcodeInput = row.querySelector('.inp-barcode');
            const unitInput = row.querySelector('.inp-unit');
            
            const setVal = (el, val, triggerMath = false) => { 
                if (el && val !== undefined && val !== null && el.value !== String(val)) {
                    el.value = val; 
                    el.classList.add('bg-indigo-50', 'transition-colors');
                    setTimeout(() => el.classList.remove('bg-indigo-50'), 800);
                    if (triggerMath) el.dispatchEvent(new Event('input', { bubbles: true }));
                }
            };

            const wipeFields = () => {
                if (target.dataset.lastMatch) {
                    target.dataset.lastMatch = ''; 
                    if (hsnInput) hsnInput.value = '';
                    if (barcodeInput) barcodeInput.value = '';
                    if (skuInput) skuInput.value = `SKU${Date.now().toString().slice(-5)}${Math.floor(Math.random()*1000)}`;
                    if (gstInput) { gstInput.value = '0'; gstInput.dispatchEvent(new Event('input', { bubbles: true })); }
                    if (cessInput) { cessInput.value = '0'; cessInput.dispatchEvent(new Event('input', { bubbles: true })); }
                }
            };
            
            if (nameVal.length < 3) {
                wipeFields();
                return;
            }

            // 1. AUTO-SYNC: Check existing memory
            const existingMatch = productsCache.find(p => (p.name || '').toLowerCase() === lowerName);
            
            if (existingMatch) {
                target.dataset.lastMatch = lowerName; 
                
                setVal(hsnInput, existingMatch.hsn || '');
                setVal(gstInput, existingMatch.gstSlab || '0', true);
                setVal(cessInput, existingMatch.cess || '0', true);
                setVal(skuInput, existingMatch.sku || '');
                setVal(barcodeInput, existingMatch.barcode || '');
                setVal(unitInput, existingMatch.unit || 'units');
                return;
            }
            
            // Wipe previous sync if name changed to an unmatched product
            wipeFields();
            
           // 3. LOCAL DICTIONARY PREDICTION (Cloud AI removed for offline-first)
            clearTimeout(debounceMap.get(target));
            debounceMap.set(target, setTimeout(() => {
                if (nameVal.length < 3) return;
                
                target.classList.add('animate-pulse');
                
                // Fall back to the built-in taxDictionary array
                const dictMatch = taxDictionary.find(entry => entry.keys.some(k => lowerName.includes(k)));
                
                if (dictMatch) {
                    if (!hsnInput.value) setVal(hsnInput, dictMatch.hsn);
                    if (gstInput && gstInput.value === '0') {
                        setVal(gstInput, dictMatch.gst, true);
                        setVal(cessInput, dictMatch.cess, true);
                        if (typeof showToast === 'function') showToast('Auto-Tax', `Applied ${dictMatch.gst}% GST based on name`, 'success');
                    }
                }
                
                target.classList.remove('animate-pulse');
            }, 400));
        }
    });

    // Handle Auto-Capitalization when leaving the input field
    tbody.addEventListener('focusout', (e) => {
        const target = e.target;
        if (target.classList.contains('inp-name')) {
            const val = target.value.trim();
            if (val) {
                target.value = val.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
            }
        }
    });

    // ------------------------------------------------------------------------
    // 🚀 FINAL SAVE LOGIC 
    // ------------------------------------------------------------------------

    document.getElementById('cancel-bulk-btn').addEventListener('click', () => {
        if (confirm("Discard all entries?")) document.getElementById('manual-bulk-overlay').remove();
    });

    document.getElementById('confirm-bulk-btn').addEventListener('click', async () => {
        const supplierName = document.getElementById('bulk-supplier-name').value.trim();
        const rows = document.querySelectorAll('.bulk-row');
        const finalPayload = [];
        let hasErrors = false;

        rows.forEach(row => {
            const nameInput = row.querySelector('.inp-name');
            const priceInput = row.querySelector('.inp-selling-price');
            const type = row.querySelector('.inp-type')?.value || 'standard';
            const name = nameInput.value.trim();
            const price = parseFloat(priceInput.value);

            if (name !== '') {
                if (isNaN(price) || price <= 0) {
                    priceInput.classList.remove('border-indigo-300', 'bg-indigo-50');
                    priceInput.classList.add('border-red-500', 'bg-red-50', 'ring-2', 'ring-red-200');
                    hasErrors = true;
                } else {
                    priceInput.classList.remove('border-red-500', 'bg-red-50', 'ring-2', 'ring-red-200');
                    
                    const extract = (cls, isFloat = false) => {
                        const el = row.querySelector(cls);
                        if (!el) return isFloat ? 0 : '';
                        return isFloat ? (parseFloat(el.value) || 0) : el.value.trim();
                    };

                    const printedRate = extract('.inp-base-rate', true);
                    const finalTotalStock = parseInt(extract('.inp-total-stock')) || 1;
                    const taxableAmt = extract('.inp-taxable', true);
                    
                    const schDiscVal = extract('.inp-sch-disc', true);
                    const schDiscType = row.querySelector('.inp-sch-type')?.value || 'rs';
                    const rsDiscVal = extract('.inp-rs-disc', true);
                    const rsDiscType = row.querySelector('.inp-rs-type')?.value || 'rs';
                    
                    const trueBaseRate = isInclusiveMode ? (taxableAmt / finalTotalStock) : printedRate;
                    const rawLineTotal = trueBaseRate * finalTotalStock;
                    
                    const finalSchDisc = schDiscType === 'pct' ? rawLineTotal * (schDiscVal / 100) : schDiscVal;
                    const finalRsDisc = rsDiscType === 'pct' ? rawLineTotal * (rsDiscVal / 100) : rsDiscVal;

                    finalPayload.push({
                        name: name, 
                        sku: extract('.inp-sku'), 
                        barcode: extract('.inp-barcode'),
                        price: price, 
                        mrp: extract('.inp-mrp', true), 
                        cost: extract('.inp-unit-cost', true),
                        stockLevel: extract('.inp-total-stock', true), 
                        cases: parseInt(extract('.inp-cs')) || 0,
                        pieces: parseInt(extract('.inp-pcs')) || 0, 
                        freeQty: parseInt(extract('.inp-free-qty')) || 0,
                        upc: parseInt(extract('.inp-upc')) || 1, 
                        unit: extract('.inp-unit') || 'units',
                        baseRate: trueBaseRate,  
                        type: type, 
                        
                        schDisc: finalSchDisc, 
                        rsDisc: finalRsDisc,   
                        
                        taxableAmt: taxableAmt,
                        gstSlab: type === 'homemade' ? 0 : extract('.inp-gst', true), 
                        permitRetail: type !== 'raw_material',
                        inPoCatalog: type !== 'homemade',
                        cess: extract('.inp-cess', true), 
                        cgstAmt: extract('.inp-cgst', true),
                        sgstAmt: extract('.inp-sgst', true), 
                        netAmt: extract('.inp-net', true),
                        hsn: extract('.inp-hsn'), 
                        batch: extract('.inp-batch'), 
                        expirationDate: extract('.inp-expiry') || null,
                        isTaxInclusive: isInclusiveMode
                    });
                }
            }
        });

        if (hasErrors) {
            alert("Please fix the highlighted errors. Selling Price is required for all named items.");
            return;
        }

        if (finalPayload.length === 0) {
            alert("No data to save. Please fill out at least one row.");
            return;
        }
const hasExternalPurchases = finalPayload.some(item => item.type === 'standard');
        if (hasExternalPurchases && !supplierName) {
            alert("Supplier / Store Name is strictly required when uploading Standard GST Products.");
            document.getElementById('bulk-supplier-name').focus();
            return;
        }

        const paymentMode = document.getElementById('bulk-payment-method').value;
        const supplierData = {
            dealerName: supplierName, // We'll handle fallbacks row-by-row now
            dealerPhone: document.getElementById('bulk-supplier-phone').value.trim(),
            gstin: document.getElementById('bulk-supplier-gstin').value.trim(),
            dealerPan: document.getElementById('bulk-supplier-pan').value.trim(),
            supplierInvoice: document.getElementById('bulk-invoice-no').value.trim(),
            purchaseDate: document.getElementById('bulk-purchase-date').value,
            invoiceTotalOverride: parseFloat(document.getElementById('bulk-invoice-total').value) || 0,
            roundOffApplied: parseFloat(document.getElementById('bulk-round-off').value) || 0,
            paymentMethod: paymentMode,
            chequeDetails: paymentMode === 'CHEQUE' ? {
                bank: document.getElementById('bulk-cheque-bank').value.trim(),
                chequeNo: document.getElementById('bulk-cheque-no').value.trim(),
                clearanceDate: document.getElementById('bulk-cheque-date').value,
                status: 'PENDING'
            } : null
        };

        // 🚀 MAP OVERRIDE: Retain item.type individually and apply safe fallbacks for optional fields
        const completeInventoryData = finalPayload.map(item => {
            const isNonGst = item.type === 'non_gst';
            const isHomemade = item.type === 'homemade';
            const isRaw = item.type === 'raw_material';
            const isBundle = item.type === 'bundle';
            
            // Safe fallback name if they left the supplier box blank for optional items
            let fallbackName = 'Unknown Supplier';
            if (isHomemade) fallbackName = 'Internal Production';
            else if (isNonGst) fallbackName = 'Local / Non-GST';
            else if (isRaw) fallbackName = 'Local Vendor';
            else if (isBundle) fallbackName = 'Internal Bundle';

            return {
                ...item, 
                ...supplierData,
                // Assign name if typed, otherwise use appropriate fallback
                dealerName: supplierData.dealerName || fallbackName,
                dealerPhone: isHomemade || isBundle ? '' : supplierData.dealerPhone,
                
                // Strip strict compliance details for internal or non-gst items
                gstin: isNonGst || isHomemade || isBundle ? '' : supplierData.gstin,
                dealerPan: isNonGst || isHomemade || isBundle ? '' : supplierData.dealerPan,
                supplierInvoice: isNonGst || isHomemade || isBundle ? '' : supplierData.supplierInvoice,
                
                inPoCatalog: !isHomemade && !isBundle, // Hide internal items from Purchase Orders
                permitRetail: !isRaw, // Hide raw materials from POS
                lowStockThreshold: 10, 
                type: item.type // Keeps actual row level item mapping safe
            };
        });

        const btn = document.getElementById('confirm-bulk-btn');
        const originalText = btn.innerHTML;
        btn.innerHTML = 'Saving...';
        btn.disabled = true;

        try {
            if (typeof onSave === 'function') await onSave(completeInventoryData);
            document.getElementById('manual-bulk-overlay').remove();
        } catch (error) {
            console.error("Manual Bulk Save failed:", error);
            alert("Failed to save: " + error.message);
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });
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
        
        if (typeof setCheckoutLoadingState === 'function') {
            isProcessingCheckout = false;
            setCheckoutLoadingState(false);
        }
    }
});