// src/components/scannerReview.js

export function renderReviewScreen(extractedData, imageSrc, onSave) {
    const existing = document.getElementById('scanner-review-overlay');
    if (existing) existing.remove();

    // 🚀 THE FIX: Safely map the header and provide a fallback 'dealer' alias to prevent crashes
    const header = extractedData.header || {};
    const items = extractedData.items || [];
    const todayISO = new Date().toISOString().split('T')[0];

    const unitOptions = [
        { value: 'units', label: 'Units' },
        { value: 'kilogram', label: 'Kilograms (kg)' },
        { value: 'grams', label: 'Grams (g)' },
        { value: 'litres', label: 'Litres (L)' },
        { value: 'mililitres', label: 'Millilitres (ml)' }
    ];

    // --- HELPER: Reusable Row Generator ---
    const generateRowHTML = (item) => `
        <tr class="hover:bg-SLATE-50/30 transition-all duration-200 group item-row  ">
            <td class="p-1 min-w-[150px]"><input type="text" class="inp-name w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm font-bold text-slate-800" value="${escapeHTML(item.name)}"></td>
            <td class="p-1"><input type="text" class="inp-sku w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm font-mono text-slate-600" value="${item.sku}"></td>
            <td class="p-1"><input type="text" class="inp-barcode w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm font-mono text-slate-600" value="${item.barcode}"></td>
            <td class="p-1"><input type="number" class="inp-mrp w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm font-bold text-slate-600" value="${item.mrp}"></td>
            <td class="p-1"><input type="number" class="inp-selling-price w-full border border-SLATE-300 bg-SLATE-50 focus:bg-white focus:border-SLATE-500 rounded p-1.5 text-sm font-bold text-SLATE-900" placeholder="Required" value="${item.sellingPrice}"></td>
            <td class="p-1"><input type="number" class="inp-unit-cost w-full border border-slate-200 bg-slate-50 hover:bg-white focus:border-SLATE-500 rounded p-1.5 text-sm font-bold text-slate-900" value="${item.unitCost}"></td>
            
            <td class="p-1 bg-slate-100 border-l border-r border-slate-200/60"><input type="number" class="inp-total-stock w-full bg-transparent border-none text-center rounded p-1.5 text-sm font-bold text-slate-400 cursor-not-allowed select-none focus:outline-none" readonly tabindex="-1" value="${item.totalStock}"></td>
            
            <td class="p-1"><input type="number" class="inp-cs w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm text-center font-bold text-slate-800 calc-trigger" value="${item.cases}"></td>
            <td class="p-1"><input type="number" class="inp-upc w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm text-center font-bold text-slate-800 calc-trigger" value="${item.upc}"></td>
            <td class="p-1"><input type="number" class="inp-pcs w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm text-center font-bold text-slate-800 calc-trigger" value="${item.pcsLoose}"></td>
            <td class="p-1"><input type="number" class="inp-free-qty w-full border border-emerald-200 bg-emerald-50 hover:bg-white focus:border-emerald-500 rounded p-1.5 text-sm text-center font-bold text-emerald-700 calc-trigger" value="${item.freeQty || 0}" placeholder="0"></td>
            <td class="p-1">
                <select class="inp-unit w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm font-bold text-slate-600 bg-white">
                    ${unitOptions.map(u => `<option value="${u.value}" ${item.unit === u.value ? 'selected' : ''}>${u.label}</option>`).join('')}
                </select>
            </td>
            
            <td class="p-1"><input type="number" class="inp-base-rate w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm font-bold text-slate-800 calc-trigger" value="${item.baseRate}"></td>
            <td class="p-1"><input type="number" class="inp-sch-disc w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm font-bold text-slate-800 calc-trigger" value="${item.schDisc}"></td>
            <td class="p-1"><input type="number" class="inp-rs-disc w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm font-bold text-slate-800 calc-trigger" value="${item.rsDisc}"></td>
            
            <td class="p-1 min-w-[100px]"><input type="number" class="inp-taxable w-full border border-slate-200 bg-slate-50 hover:bg-white focus:border-SLATE-500 rounded p-1.5 text-sm font-bold text-slate-600 calc-trigger" value="${item.taxableAmt}"></td>
            
            <td class="p-1 min-w-[90px]">
                <select class="inp-gst w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm text-center font-bold text-slate-800 calc-trigger bg-white">
                    <option value="0" ${item.gstSlab == 0 ? 'selected' : ''}>0%</option>
                    <option value="5" ${item.gstSlab == 5 ? 'selected' : ''}>5%</option>
                    <option value="12" ${item.gstSlab == 12 ? 'selected' : ''}>12%</option>
                    <option value="18" ${item.gstSlab == 18 ? 'selected' : ''}>18%</option>
                    <option value="28" ${item.gstSlab == 28 ? 'selected' : ''}>28%</option>
                </select>
            </td>
            
            <td class="p-1 min-w-[80px]"><input type="number" class="inp-cess w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm text-center font-bold text-red-600 calc-trigger" value="${item.cessPct}" placeholder="0%"></td>
            
            <td class="p-1">
                <div class="flex gap-1">
                    <input type="number" class="inp-cgst w-full border border-slate-200 bg-slate-50 hover:bg-white focus:border-SLATE-500 rounded p-1.5 text-xs font-medium text-slate-500" value="${item.cgst}" title="CGST">
                    <input type="number" class="inp-sgst w-full border border-slate-200 bg-slate-50 hover:bg-white focus:border-SLATE-500 rounded p-1.5 text-xs font-medium text-slate-500" value="${item.sgst}" title="SGST">
                </div>
            </td>
            
            <td class="p-1 min-w-[120px]"><input type="number" class="inp-net w-full border border-slate-200 bg-slate-50 hover:bg-white focus:border-SLATE-500 rounded p-1.5 text-sm font-bold text-slate-900 calc-trigger" value="${item.netAmt}"></td>
            
            <td class="p-1"><input type="text" class="inp-hsn w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm font-mono text-slate-600" value="${item.hsn}"></td>
            <td class="p-1"><input type="text" class="inp-batch w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm text-slate-600 uppercase" value="${item.batch}"></td>
            <td class="p-1"><input type="date" class="inp-expiry w-full border border-slate-200 hover:border-slate-300 focus:border-SLATE-500 rounded p-1.5 text-sm text-slate-600" value="${item.expiry}"></td>
            
            <td class="p-1 text-center">
                <button type="button" class="delete-row-btn text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors" title="Remove Item">
                    <svg class="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </td>
        </tr>
    `;

    const enrichedItems = items.map((item, index) => {
        const cases = parseFloat(item.cases) || 0;
        let upc = parseFloat(item.upc);
        if (isNaN(upc) || upc <= 0) upc = 1;
        const pcs = parseFloat(item.pcsLoose || item.pcs) || 0;
        const freeQty = parseFloat(item.freeQty || item.free_qty || item.foc) || 0; // 🚀 Catch AI aliases

        // 🚀 Total physical stock includes free items, but 'calcQty' (for finances) does not!
        const paidStock = (cases * upc) + pcs;
        const totalStock = paidStock + freeQty;
        const calcQty = paidStock > 0 ? paidStock : 1;

        const baseRate = parseFloat(item.baseRate || item.base_rate) || 0;
        const schDisc = parseFloat(item.schDisc || item.sch_disc) || 0;
        const rsDisc = parseFloat(item.rsDisc || item.rs_disc) || 0;

        const gstPct = parseFloat(item.gstSlab || item.gst_pct) || 0;
        const cessPct = parseFloat(item.cessPct || item.cess_pct) || 0;

        let taxable = parseFloat(item.taxableAmt || item.taxable);
        if (isNaN(taxable) || taxable <= 0) taxable = Math.max(0, (baseRate * calcQty) - (schDisc + rsDisc));

        const cgst = parseFloat(item.cgst || item.cgst_amt) > 0 ? parseFloat(item.cgst || item.cgst_amt) : (taxable * (gstPct / 2) / 100);
        const sgst = parseFloat(item.sgst || item.sgst_amt) > 0 ? parseFloat(item.sgst || item.sgst_amt) : (taxable * (gstPct / 2) / 100);
        const cessAmt = parseFloat(item.cess || item.cess_amt) > 0 ? parseFloat(item.cess || item.cess_amt) : (taxable * (cessPct / 100));

        let netAmt = parseFloat(item.netAmt || item.net_amt);
        if (isNaN(netAmt) || netAmt <= 0) netAmt = taxable + cgst + sgst + cessAmt;

        const unitCost = totalStock > 0 ? (netAmt / totalStock) : 0;
        const autoSku = `SKU${Date.now().toString().slice(-5)}${index.toString().padStart(3, '0')}`;

        return {
            name: item.name || '', sku: item.sku || autoSku, barcode: item.barcode || autoSku,
            mrp: item.mrp || '', sellingPrice: item.sellingPrice || item.mrp || '', unitCost: unitCost.toFixed(2),
            hsn: item.hsn || '', batch: item.batch || '', unit: item.unit || 'units', upc: upc,
            baseRate: baseRate.toFixed(2), schDisc: schDisc.toFixed(2), rsDisc: rsDisc.toFixed(2),
            taxableAmt: taxable.toFixed(2), gstSlab: gstPct, cessPct: cessPct,
            cgst: cgst.toFixed(2), sgst: sgst.toFixed(2),
            netAmt: netAmt.toFixed(2), cases: cases, pcsLoose: pcs, freeQty: freeQty, totalStock: totalStock, expiry: item.expiry || item.exp || ''
        };
    });

    const html = `
    <div id="scanner-review-overlay" class="fixed inset-0 z-[200] bg-slate-900 flex flex-col  ">
        <header class="flex justify-between items-center p-6 bg-slate-800 border-b border-slate-700 shadow-lg shrink-0">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-emerald-500/20 text-emerald-400 flex items-center justify-center rounded-2xl">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </div>
                <div>
                    <h2 class="text-2xl font-black text-white tracking-tight">Audit & Import Bill</h2>
                    <p class="text-slate-400 text-sm font-medium">Verify data. Subtotal and Final Total calculate automatically.</p>
                </div>
            </div>
            <div class="flex gap-4">
                <button id="cancel-scan-btn" class="px-6 py-3 text-slate-300 font-bold hover:text-white hover:bg-slate-700 rounded-xl transition-colors">Discard</button>
                <button id="confirm-scan-btn" class="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-emerald-500/20 transition-all active:scale-95 flex items-center gap-2">
                    Confirm & Bulk Upload
                </button>
            </div>
        </header>

        <div class="flex-1 flex overflow-hidden">
            <div id="preview-image-container" class="w-[25%] bg-[#0B1120] p-6 flex justify-center items-center border-r border-slate-700/50 relative shrink-0 group cursor-zoom-in select-none">
                <div class="absolute top-4 left-4 bg-slate-800/80 text-slate-300 text-xs font-black uppercase tracking-widest px-4 py-2 rounded-lg border border-slate-700 z-20 shadow-lg">Original Document</div>
                <div class="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center z-10 pointer-events-none">
                    <span class="bg-SLATE-600 text-white px-5 py-2.5 rounded-full text-xs font-black uppercase tracking-widest shadow-xl flex items-center gap-2">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"></path></svg>
                        Double Tap to Expand
                    </span>
                </div>
                <img src="${imageSrc}" class="max-w-full max-h-full object-contain rounded-xl shadow-2xl relative z-0 transition-transform duration-300 group-hover:scale-[1.02]">
            </div>

            <div class="w-[75%] bg-slate-50 flex flex-col h-full">
                <div class="bg-white p-6 border-b border-slate-200 shrink-0 shadow-sm z-10">
                    <h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Supplier & Invoice Details</h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div><label class="text-[10px] font-bold text-slate-500">Store / Dealer Name</label><input type="text" id="scan-supplier-name" value="${escapeHTML(header.dealerName || header.name || '')}" class="w-full border-b border-slate-300 p-1 text-sm font-bold focus:border-SLATE-500 outline-none bg-transparent hover:bg-slate-50"></div>
                        <div><label class="text-[10px] font-bold text-slate-500">Dealer Phone</label><input type="text" id="scan-supplier-phone" value="${escapeHTML(header.dealerPhone || header.phone || '')}" class="w-full border-b border-slate-300 p-1 text-sm font-bold focus:border-SLATE-500 outline-none bg-transparent hover:bg-slate-50"></div>
                        <div><label class="text-[10px] font-bold text-slate-500">Supplier GSTIN</label><input type="text" id="scan-supplier-gstin" value="${escapeHTML(header.dealerGstin || header.gstin || '')}" class="w-full border-b border-slate-300 p-1 text-sm font-bold uppercase focus:border-SLATE-500 outline-none bg-transparent hover:bg-slate-50"></div>
                        <div><label class="text-[10px] font-bold text-slate-500">Purchase Date</label><input type="date" id="scan-purchase-date" value="${escapeHTML(header.invoiceDate || todayISO)}" class="w-full border-b border-slate-300 p-1 text-sm font-bold focus:border-SLATE-500 outline-none bg-transparent hover:bg-slate-50"></div>
                        
                        <div><label class="text-[10px] font-bold text-slate-500">Supplier PAN</label><input type="text" id="scan-supplier-pan" value="${escapeHTML(header.dealerPan || header.pan || '')}" class="w-full border-b border-slate-300 p-1 text-sm font-bold uppercase focus:border-SLATE-500 outline-none bg-transparent hover:bg-slate-50"></div>
                        <div><label class="text-[10px] font-bold text-slate-500">Invoice Number</label><input type="text" id="scan-invoice-no" value="${escapeHTML(header.invoiceNumber || header.invoice_no || '')}" class="w-full border-b border-slate-300 p-1 text-sm font-bold focus:border-SLATE-500 outline-none bg-transparent hover:bg-slate-50"></div>
                    </div>
                </div>

                <div class="flex-1 overflow-auto custom-scrollbar bg-slate-50 p-6 relative flex flex-col">
                    
                    <table class="w-full text-left border-collapse" id="audit-items-table">
                        <thead class="sticky top-0 bg-slate-100 shadow-sm z-20">
                            <tr class="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                                <th class="p-2 min-w-[250px]">Product Name</th>
                                <th class="p-2 min-w-[140px]">SKU/Code</th>
                                <th class="p-2 min-w-[140px]">Barcode</th>
                                <th class="p-2 min-w-[120px]">MRP</th>
                                <th class="p-2 min-w-[130px] text-SLATE-600 bg-SLATE-50/50">Selling Price*</th>
                                <th class="p-2 min-w-[120px]">Unit Cost</th>
                                <th class="p-2 min-w-[110px] text-slate-400 bg-slate-200/50 border-l border-r border-slate-300">Total Stock</th>
                                <th class="p-2 min-w-[90px]">CS</th>
                                <th class="p-2 min-w-[90px]">UPC</th>
                                <th class="p-2 min-w-[100px]">Pcs Loose</th>
                                
                                <th class="px-3 py-2 text-center text-xs font-bold text-emerald-600 uppercase tracking-wider bg-emerald-50">Free (FOC)</th>
                                
                                <th class="p-2 min-w-[140px]">
                                    <div class="flex flex-col gap-1">
                                        <span>Unit Type</span>
                                        <select id="bulk-unit-select" class="text-[10px] font-bold text-SLATE-600 bg-SLATE-50 border border-SLATE-200 rounded p-1 cursor-pointer outline-none focus:ring-1 focus:ring-SLATE-500">
                                            <option value="">-- Bulk Change --</option>
                                            ${unitOptions.map(u => `<option value="${u.value}">${u.label}</option>`).join('')}
                                        </select>
                                    </div>
                                </th>
                                
                                <th class="p-2 min-w-[120px]">Base Rate</th>
                                <th class="p-2 min-w-[100px]">Sch Disc</th>
                                <th class="p-2 min-w-[100px]">Rs Disc</th>
                                <th class="p-2 min-w-[130px]">Taxable Amt</th>
                                <th class="p-2 min-w-[90px]">GST %</th>
                                <th class="p-2 min-w-[90px] text-red-600 bg-red-50/50">CESS %</th>
                                <th class="p-2 min-w-[140px]">CGST/SGST</th>
                                <th class="p-2 min-w-[130px]">Net Amount</th>
                                <th class="p-2 min-w-[110px]">HSN Code</th>
                                <th class="p-2 min-w-[130px]">Batch</th>
                                <th class="p-2 min-w-[140px]">Expiry (YYYY-MM-DD)</th>
                                
                                <th class="p-2 min-w-[60px] text-center"><span class="sr-only">Delete</span></th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200 bg-white">
                            ${enrichedItems.map(generateRowHTML).join('')}
                        </tbody>
                    </table>


                    <div class="mt-4 flex justify-center pb-8">
                        <button id="add-custom-row-btn" class="flex items-center gap-2 px-6 py-2.5 bg-white hover:bg-SLATE-50 text-SLATE-600 font-black tracking-wide rounded-xl transition-colors shadow-sm border border-SLATE-100">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                            Add Missing Item
                        </button>
                    </div>
                </div>

                <div class="bg-white border-t border-slate-200 p-5 shrink-0 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.05)] z-30 flex flex-col gap-4">
                
                    <div class="flex items-center justify-between bg-SLATE-50/80 p-4 rounded-xl mb-6 border border-SLATE-200/50 shadow-sm shrink-0">
                        <div class="flex items-center gap-3">
                            <div class="p-2 bg-SLATE-100 text-SLATE-600 rounded-lg">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                            </div>
                            <div>
                                <h4 class="text-sm font-black text-SLATE-900 tracking-tight">AI Tax Interpretation</h4>
                                <p class="text-[10px] text-SLATE-600 font-bold uppercase tracking-wider mt-0.5">Flip this switch if the AI misread how the supplier calculates GST.</p>
                            </div>
                        </div>
                        
                        <div class="flex items-center gap-3 bg-white p-2 rounded-lg border border-SLATE-100 shadow-sm">
                            <span class="text-xs font-bold text-slate-500 uppercase tracking-widest">Exclusive (+GST)</span>
                            <label class="flex items-center cursor-pointer relative z-10">
                                <input type="checkbox" id="ai-tax-override-toggle" class="sr-only">
                                <div class="w-12 h-6 bg-slate-200 rounded-full transition-colors duration-300 ease-in-out"></div>
                                <div class="dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-300 ease-in-out shadow-sm transform translate-x-0"></div>
                            </label>
                            <span class="text-xs font-black text-SLATE-700 uppercase tracking-widest">Inclusive (Net)</span>
                        </div>
                    </div>
                    <style>
                        /* Made it slightly thicker (12px) for easier grabbing horizontally */
                        .dark-scrollbar::-webkit-scrollbar { width: 12px; height: 12px; }
                        .dark-scrollbar::-webkit-scrollbar-track { background: #f8fafc; border-radius: 8px; }
                        
                        /* Deep Slate-700 color so it pops against the white background */
                        .dark-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 8px; border: 2px solid #f8fafc; }
                        
                        /* Turns almost black when you hover over it */
                        .dark-scrollbar::-webkit-scrollbar-thumb:hover { background: #0f172a; } 
                        
                        /* Toggle specific styles */
                        #ai-tax-override-toggle:checked + div { background-color: #4f46e5; }
                        #ai-tax-override-toggle:checked ~ .dot { transform: translateX(24px); }
                    </style>
                <div class="flex justify-between items-center w-full">
                        <div class="flex flex-col gap-1">
                            <p class="text-xs text-slate-400 font-medium">✏️ Adjust the <strong class="text-amber-500">Round Off / Offer</strong> field to perfectly match the printed bill total.</p>
                            <div class="flex items-center gap-2 mt-2">
                                <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Payment Mode:</span>
                                <select id="scan-payment-method" class="border border-slate-300 rounded-lg p-1.5 text-sm font-bold text-SLATE-700 outline-none focus:border-SLATE-500 bg-white shadow-sm cursor-pointer">
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
                                <span id="scan-subtotal-display" class="text-lg font-black text-slate-600">₹0.00</span>
                            </div>
                            
                            <div class="text-slate-300 text-3xl font-light leading-none">-</div>
                            
                            <div class="flex flex-col items-end">
                                <span class="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Round Off / Offer</span>
                                <div class="relative">
                                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-amber-700 font-bold">₹</span>
                                    <input type="number" id="scan-round-off" class="w-28 bg-amber-50 border border-amber-200 text-amber-900 font-black text-xl rounded-xl py-1.5 pr-3 pl-8 text-right focus:bg-white focus:ring-2 focus:ring-amber-500 outline-none transition-all shadow-inner" placeholder="0.00">
                                </div>
                            </div>

                            <div class="text-slate-300 text-3xl font-light leading-none">=</div>
                            
                            <div class="flex flex-col items-end">
                                <span class="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Final Total</span>
                                <div class="relative">
                                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-700 font-black text-xl">₹</span>
                                    <input type="number" id="scan-invoice-total" class="w-40 bg-emerald-50 border border-emerald-200 text-emerald-900 font-black text-2xl rounded-xl py-1.5 pr-3 pl-8 text-right outline-none shadow-inner" readonly>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div id="scan-cheque-details" class="hidden flex gap-3 justify-start items-center bg-SLATE-50/50 p-3 rounded-xl border border-SLATE-100">
                        <span class="text-SLATE-800 font-bold text-[10px] uppercase tracking-wide">Cheque Info:</span>
                        <input type="text" id="scan-cheque-bank" placeholder="Bank Name (e.g., HDFC)" class="border border-SLATE-200 rounded p-1.5 text-sm w-40 outline-none focus:border-SLATE-500 bg-white">
                        <input type="text" id="scan-cheque-no" placeholder="Cheque No (6 Digits)" class="border border-SLATE-200 rounded p-1.5 text-sm w-40 font-mono outline-none focus:border-SLATE-500 bg-white">
                        <input type="date" id="scan-cheque-date" class="border border-SLATE-200 rounded p-1.5 text-sm outline-none focus:border-SLATE-500 text-slate-600 bg-white" title="Clearance Date">
                    </div>
                </div>

            </div>
        </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    // ------------------------------------------------------------------------
    // 🚀 FIXED: UI TOGGLES, SCROLLBARS, AND RECALCULATION ENGINE
    // ------------------------------------------------------------------------

    // 1. The Safe Recalculation Engine
    const recalculateTotal = () => {
        const netInputs = document.querySelectorAll('.inp-net');
        let sum = 0;
        netInputs.forEach(n => sum += (parseFloat(n.value) || 0));

        const roundOffInput = document.getElementById('scan-round-off');
        const roundOffVal = parseFloat(roundOffInput ? roundOffInput.value : 0) || 0;
        const finalTotal = sum - roundOffVal;

        const subDisplay = document.getElementById('scan-subtotal-display');
        if (subDisplay) subDisplay.innerText = `₹${sum.toFixed(2)}`;

        const totDisplay = document.getElementById('scan-invoice-total');
        if (totDisplay) totDisplay.value = finalTotal.toFixed(2);
    };

    // Initialize Totals
    recalculateTotal();

    const roundOffEl = document.getElementById('scan-round-off');
    if (roundOffEl) roundOffEl.addEventListener('input', recalculateTotal);

    // 2. The AI Tax Override Toggle
    const taxOverrideToggle = document.getElementById('ai-tax-override-toggle');
    if (taxOverrideToggle) {
        // Default check based on AI output
        if (enrichedItems.length > 0 && enrichedItems[0].isTaxInclusive) {
            taxOverrideToggle.checked = true;
        }

        taxOverrideToggle.addEventListener('change', (e) => {
            const forceInclusive = e.target.checked;

            // 🚀 FIXED: Iterate over ACTUAL DOM rows to preserve manual user edits!
            const rows = document.querySelectorAll('#audit-items-table tbody tr.item-row');

            rows.forEach((row, index) => {
                // Safe DOM getters/setters
                const getVal = (cls) => parseFloat(row.querySelector(cls)?.value) || 0;
                const setVal = (cls, val) => { const el = row.querySelector(cls); if (el) el.value = val; };

                const qty = getVal('.inp-total-stock') || 1;
                const gst = getVal('.inp-gst');
                const cess = getVal('.inp-cess');
                const schDisc = getVal('.inp-sch-disc');
                const rsDisc = getVal('.inp-rs-disc');

                // 🚀 THE MAGIC ANCHOR: Freeze the original rate so math doesn't compound!
                const baseRateInput = row.querySelector('.inp-base-rate');
                let originalRate = parseFloat(baseRateInput.dataset.originalRate);

                if (isNaN(originalRate)) {
                    // First time toggling: freeze the current base rate into the dataset
                    originalRate = getVal('.inp-base-rate') || getVal('.inp-unit-cost');
                    baseRateInput.dataset.originalRate = originalRate;
                }

                const taxMultiplier = 1 + (gst / 100) + (cess / 100);
                let newBaseRate, newTaxable, newNet;

                if (forceInclusive) {
                    // INCLUSIVE: The anchor rate ALREADY includes tax
                    const rawLineTotal = (originalRate * qty) - schDisc - rsDisc;
                    newNet = Math.max(0, rawLineTotal);
                    newTaxable = newNet / taxMultiplier;
                    newBaseRate = newTaxable / qty;
                } else {
                    // EXCLUSIVE: Tax is added on top of the anchor rate
                    const rawTaxable = (originalRate * qty) - schDisc - rsDisc;
                    newTaxable = Math.max(0, rawTaxable);
                    newNet = newTaxable * taxMultiplier;
                    newBaseRate = originalRate;
                }

                const totalTaxAmt = newNet - newTaxable;
                const halfTax = totalTaxAmt / 2;

                // Write directly back to inputs (No innerHTML overwrite = no flashing!)
                setVal('.inp-base-rate', newBaseRate.toFixed(2));
                setVal('.inp-taxable', newTaxable.toFixed(2));
                setVal('.inp-net', newNet.toFixed(2));
                setVal('.inp-cgst', halfTax.toFixed(2));
                setVal('.inp-sgst', halfTax.toFixed(2));

                const unitCostInput = row.querySelector('.inp-unit-cost');
                if (unitCostInput) unitCostInput.value = (newNet / qty).toFixed(2);

                // Keep background payload synced for saving
                if (enrichedItems[index]) {
                    enrichedItems[index].baseRate = newBaseRate.toFixed(2);
                    enrichedItems[index].taxableAmt = newTaxable.toFixed(2);
                    enrichedItems[index].netAmt = newNet.toFixed(2);
                    enrichedItems[index].cgst = halfTax.toFixed(2);
                    enrichedItems[index].sgst = halfTax.toFixed(2);
                    enrichedItems[index].isTaxInclusive = forceInclusive;
                }
            });

            recalculateTotal();
            if (typeof showToast === 'function') {
                showToast("Taxes Recalculated", forceInclusive ? "Switched to Inclusive Mode" : "Switched to Exclusive Mode", "info");
            }
        });
    }

    // 3. Cheque Drawer Logic
    const paymentSelect = document.getElementById('scan-payment-method');
    if (paymentSelect) {
        paymentSelect.addEventListener('change', (e) => {
            const drawer = document.getElementById('scan-cheque-details');
            if (drawer) {
                if (e.target.value === 'CHEQUE') {
                    drawer.classList.remove('hidden');
                    drawer.classList.add('flex');
                } else {
                    drawer.classList.add('hidden');
                    drawer.classList.remove('flex');
                }
            }
        });
    }

    // 4. Custom Row Logic
    const addRowBtn = document.getElementById('add-custom-row-btn');
    if (addRowBtn) {
        addRowBtn.addEventListener('click', () => {
            const tbody = document.querySelector('#audit-items-table tbody');
            if (!tbody) return;

            const emptyItem = {
                name: '', sku: `SKU${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 100)}`, barcode: '',
                mrp: '', sellingPrice: '', unitCost: '0.00', totalStock: 0, cases: 0, upc: 1, pcsLoose: 0,
                unit: 'units', baseRate: '0.00', schDisc: '0.00', rsDisc: '0.00', taxableAmt: '0.00', gstSlab: 0,
                cessPct: 0, cgst: '0.00', sgst: '0.00', netAmt: '0.00', hsn: '', batch: '', expiry: ''
            };

            tbody.insertAdjacentHTML('beforeend', generateRowHTML(emptyItem));
            const scrollContainer = document.querySelector('.custom-scrollbar');
            if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
        });
    }

    // 5. Bulk Unit Selection
    const bulkUnitSelect = document.getElementById('bulk-unit-select');
    if (bulkUnitSelect) {
        bulkUnitSelect.addEventListener('change', (e) => {
            const selectedUnit = e.target.value;
            if (!selectedUnit) return;
            document.querySelectorAll('.inp-unit').forEach(select => select.value = selectedUnit);
        });
    }

    // 6. Image Zoom Logic
    const imgContainer = document.getElementById('preview-image-container');
    if (imgContainer) {
        imgContainer.addEventListener('dblclick', () => {
            const previewHtml = `
            <div id="fullscreen-receipt-zoom" class="fixed inset-0 z-[300] bg-black/95   flex flex-col items-center justify-center p-4   cursor-zoom-out" title="Click anywhere to close">
                <div class="absolute top-6 right-6 text-white bg-white/10 hover:bg-white/20 p-3 rounded-full cursor-pointer transition-colors z-10 shadow-lg">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </div>
                <img src="${imageSrc}" class="max-w-full max-h-[95vh] object-contain rounded-xl shadow-2xl">
            </div>
            `;
            document.body.insertAdjacentHTML('beforeend', previewHtml);
            const zoomEl = document.getElementById('fullscreen-receipt-zoom');
            if (zoomEl) {
                zoomEl.onclick = function () {
                    this.classList.replace(' ', 'animate-fadeOut');
                    setTimeout(() => this.remove(), 200);
                };
            }
        });
    }
    // ------------------------------------------------------------------------
    // 🚀 FIXED: BULLETPROOF OMNI-DIRECTIONAL MATH ENGINE
    // ------------------------------------------------------------------------

    const table = document.getElementById('audit-items-table');
    if (table) {
        // DELETE ROW LISTENER
        table.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.delete-row-btn');
            if (deleteBtn) {
                const row = deleteBtn.closest('tr');
                if (row) {
                    row.style.transition = "all 0.2s ease-out";
                    row.style.opacity = "0";
                    row.style.transform = "scaleY(0.8)";
                    setTimeout(() => {
                        row.remove();
                        recalculateTotal();
                    }, 200);
                }
            }
        });

        // INPUT MATH LISTENER
        table.addEventListener('input', (e) => {
            const row = e.target.closest('tr');
            const target = e.target;
            if (!row || !target) return;

            const isQty = target.classList.contains('inp-cs') || target.classList.contains('inp-upc') || target.classList.contains('inp-pcs') || target.classList.contains('inp-free-qty');
            const isRate = target.classList.contains('inp-base-rate');
            const isDisc = target.classList.contains('inp-sch-disc') || target.classList.contains('inp-rs-disc');
            const isTaxable = target.classList.contains('inp-taxable');
            const isTaxPct = target.classList.contains('inp-gst') || target.classList.contains('inp-cess');
            const isTaxAmt = target.classList.contains('inp-cgst') || target.classList.contains('inp-sgst');
            const isNet = target.classList.contains('inp-net');

            // 🚀 THE FIX: Keep a stable anchor if the user manually overrides the base rate
            if (isRate) {
                target.dataset.originalRate = target.value;
            }

            if (isQty || isRate || isDisc || isTaxable || isTaxPct || isTaxAmt || isNet) {
                // Safe Number Parsers
                const cases = parseFloat(row.querySelector('.inp-cs')?.value) || 0;
                const upc = parseFloat(row.querySelector('.inp-upc')?.value) || 1;
                const pcs = parseFloat(row.querySelector('.inp-pcs')?.value) || 0;
                const freeQty = parseFloat(row.querySelector('.inp-free-qty')?.value) || 0;

                // Physical vs Paid Stock Math
                const paidStock = (cases * upc) + pcs;
                const totalStock = paidStock + freeQty;
                const calcQty = paidStock > 0 ? paidStock : 1;

                const gstPct = parseFloat(row.querySelector('.inp-gst')?.value) || 0;
                const cessPct = parseFloat(row.querySelector('.inp-cess')?.value) || 0;
                const schDisc = parseFloat(row.querySelector('.inp-sch-disc')?.value) || 0;
                const rsDisc = parseFloat(row.querySelector('.inp-rs-disc')?.value) || 0;

                let baseRate = parseFloat(row.querySelector('.inp-base-rate')?.value) || 0;
                let taxable = parseFloat(row.querySelector('.inp-taxable')?.value) || 0;
                let cgst = parseFloat(row.querySelector('.inp-cgst')?.value) || 0;
                let sgst = parseFloat(row.querySelector('.inp-sgst')?.value) || 0;
                let netAmt = parseFloat(row.querySelector('.inp-net')?.value) || 0;
                let cessAmt = 0;

                // 🚀 THE FIX: Dynamically read the active state of the Tax Toggle!
                const isInclusiveMode = document.getElementById('ai-tax-override-toggle')?.checked || false;

                const taxMultiplier = 1 + (gstPct / 100) + (cessPct / 100);

                // Mathematical Routing
                if (isQty || isRate || isDisc) {
                    if (isInclusiveMode) {
                        const rawLineTotal = (baseRate * calcQty) - schDisc - rsDisc;
                        netAmt = Math.max(0, rawLineTotal);
                        taxable = netAmt / taxMultiplier;
                    } else {
                        taxable = Math.max(0, (baseRate * calcQty) - (schDisc + rsDisc));
                        netAmt = taxable * taxMultiplier;
                    }
                    const totalGst = netAmt - taxable;
                    cgst = totalGst / 2; sgst = totalGst / 2;
                }
                else if (isTaxable) {
                    netAmt = taxable * taxMultiplier;
                    if (isInclusiveMode) baseRate = (netAmt + schDisc + rsDisc) / calcQty;
                    else baseRate = (taxable + schDisc + rsDisc) / calcQty;

                    const totalGst = netAmt - taxable;
                    cgst = totalGst / 2; sgst = totalGst / 2;
                }
                else if (isTaxPct) {
                    if (isInclusiveMode) {
                        const rawLineTotal = (baseRate * calcQty) - schDisc - rsDisc;
                        netAmt = Math.max(0, rawLineTotal);
                        taxable = netAmt / taxMultiplier;
                    } else {
                        taxable = Math.max(0, (baseRate * calcQty) - (schDisc + rsDisc));
                        netAmt = taxable * taxMultiplier;
                    }
                    const totalGst = netAmt - taxable;
                    cgst = totalGst / 2; sgst = totalGst / 2;
                }
                else if (isTaxAmt) {
                    cessAmt = (taxable * cessPct) / 100;
                    netAmt = taxable + cgst + sgst + cessAmt;
                }
                else if (isNet) {
                    taxable = netAmt / taxMultiplier;
                    if (isInclusiveMode) baseRate = (netAmt + schDisc + rsDisc) / calcQty;
                    else baseRate = (taxable + schDisc + rsDisc) / calcQty;

                    const totalGst = netAmt - taxable;
                    cgst = totalGst / 2; sgst = totalGst / 2;
                }

                // Safe DOM Writes (Prevents the cursor from jumping while you type!)
                const write = (cls, val) => {
                    const el = row.querySelector(cls);
                    if (el && el !== document.activeElement) el.value = val;
                };

                write('.inp-total-stock', totalStock);
                write('.inp-base-rate', baseRate.toFixed(2));
                write('.inp-taxable', taxable.toFixed(2));
                write('.inp-cgst', cgst.toFixed(2));
                write('.inp-sgst', sgst.toFixed(2));
                write('.inp-net', netAmt.toFixed(2));

                const unitCost = totalStock > 0 ? (netAmt / totalStock) : 0;
                write('.inp-unit-cost', unitCost.toFixed(2));

                recalculateTotal();
            }
        });
    }

    // ------------------------------------------------------------------------
    // 🚀 FINAL SAVE LOGIC
    // ------------------------------------------------------------------------

    const cancelBtn = document.getElementById('cancel-scan-btn');
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            if (confirm("Discard all extracted data?")) {
                const overlay = document.getElementById('scanner-review-overlay');
                if (overlay) overlay.remove();
            }
        };
    }

    const confirmBtn = document.getElementById('confirm-scan-btn');
    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            const rows = document.querySelectorAll('.item-row');
            let hasErrors = false;
            const finalPayload = [];

            rows.forEach(row => {
                const nameInput = row.querySelector('.inp-name');
                if (!nameInput) return;

                const name = nameInput.value.trim();
                const sellingPriceInput = row.querySelector('.inp-selling-price');
                const sellingPrice = parseFloat(sellingPriceInput ? sellingPriceInput.value : 0);

                if (name) {
                    if (isNaN(sellingPrice) || sellingPrice <= 0) {
                        if (sellingPriceInput) {
                            sellingPriceInput.classList.remove('border-SLATE-300', 'bg-SLATE-50');
                            sellingPriceInput.classList.add('border-red-500', 'bg-red-50', 'ring-2', 'ring-red-200');
                        }
                        hasErrors = true;
                    } else {
                        if (sellingPriceInput) {
                            sellingPriceInput.classList.remove('border-red-500', 'bg-red-50', 'ring-2', 'ring-red-200');
                        }

                        // Safe extraction for all fields
                        const extract = (cls, isFloat = false) => {
                            const el = row.querySelector(cls);
                            if (!el) return isFloat ? 0 : '';
                            return isFloat ? (parseFloat(el.value) || 0) : el.value.trim();
                        };

                        finalPayload.push({
                            name: name,
                            sku: extract('.inp-sku'),
                            barcode: extract('.inp-barcode'),
                            price: sellingPrice,
                            mrp: extract('.inp-mrp', true),
                            cost: extract('.inp-unit-cost', true),
                            stockLevel: extract('.inp-total-stock', true),
                            cases: parseInt(extract('.inp-cs')) || 0,
                            pieces: parseInt(extract('.inp-pcs')) || 0,
                            freeQty: parseInt(extract('.inp-free-qty')) || 0, // 🚀 EXTRACT IT HERE!
                            upc: parseInt(extract('.inp-upc')) || 1,
                            unit: extract('.inp-unit') || 'units',
                            baseRate: extract('.inp-base-rate', true),
                            schDisc: extract('.inp-sch-disc', true),
                            rsDisc: extract('.inp-rs-disc', true),
                            taxableAmt: extract('.inp-taxable', true),
                            gstSlab: extract('.inp-gst', true),
                            cess: extract('.inp-cess', true),
                            cgstAmt: extract('.inp-cgst', true),
                            sgstAmt: extract('.inp-sgst', true),
                            netAmt: extract('.inp-net', true),
                            hsn: extract('.inp-hsn'),
                            batch: extract('.inp-batch'),
                            expirationDate: extract('.inp-expiry') || null
                        });
                    }
                }
            });

            if (hasErrors) {
                alert("Please fill in the Selling Price for all highlighted items before saving.");
                return;
            }

            const getElVal = (id, isFloat = false) => {
                const el = document.getElementById(id);
                if (!el) return isFloat ? 0 : '';
                return isFloat ? (parseFloat(el.value) || 0) : el.value.trim();
            };

            const finalUserEditedTotal = getElVal('scan-invoice-total', true);
            const roundOffApplied = getElVal('scan-round-off', true);
            const paymentMode = getElVal('scan-payment-method') || 'CASH';

            const supplierData = {
                dealerName: getElVal('scan-supplier-name'),
                dealerPhone: getElVal('scan-supplier-phone'),
                gstin: getElVal('scan-supplier-gstin'),
                dealerPan: getElVal('scan-supplier-pan'),
                supplierInvoice: getElVal('scan-invoice-no'),
                purchaseDate: getElVal('scan-purchase-date'),
                invoiceTotalOverride: finalUserEditedTotal,
                roundOffApplied: roundOffApplied,
                paymentMethod: paymentMode,
                chequeDetails: paymentMode === 'CHEQUE' ? {
                    bank: getElVal('scan-cheque-bank'),
                    chequeNo: getElVal('scan-cheque-no'),
                    clearanceDate: getElVal('scan-cheque-date'),
                    status: 'PENDING'
                } : null
            };

            const completeInventoryData = finalPayload.map(item => ({
                ...item, ...supplierData, inPoCatalog: true, lowStockThreshold: 10, type: 'standard'
            }));

            const originalText = confirmBtn.innerHTML;
            confirmBtn.innerHTML = 'Saving to Database...';
            confirmBtn.disabled = true;

            try {
                if (typeof onSave === 'function') await onSave(completeInventoryData);
                const overlay = document.getElementById('scanner-review-overlay');
                if (overlay) overlay.remove();
            } catch (error) {
                console.error("Save failed:", error);
                alert("Failed to save: " + error.message);
                confirmBtn.innerHTML = originalText;
                confirmBtn.disabled = false;
            }
        };
    }
}
// --- HELPER FUNCTIONS ---
function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
}
