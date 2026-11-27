// src/utils/print.js

import { getCurrencySymbol, getStoreId, appId } from '../store/state.js';
import { escapeHTML } from './security.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PrintDispatcher } from '../printing/PrintDispatcher.js';
import { PrinterManager } from '../printing/PrinterEngine.js';

let isPrintingLock = false;
export async function buildAndPrintInvoice(tx, storeNameOverride) {
    if (isPrintingLock) {
        console.warn("Print request blocked: Job already in progress.");
        return;
    }

    isPrintingLock = true;

    try {
        let latestSettings = {};
        try {
            const sysDetailsRaw = localStorage.getItem('mifela_sys_details');
            if (sysDetailsRaw) {
                latestSettings = JSON.parse(sysDetailsRaw);
            }
        } catch (e) {
            console.warn("Could not fetch latest store settings for print:", e);
        }

        const printerSettings = JSON.parse(localStorage.getItem('mifela_printer_config') || '{}');
        const isSilent = printerSettings.silent !== undefined ? printerSettings.silent : true;
        const pageSize = printerSettings.paperSize || '58mm';

        let printerName = printerSettings.printerName || '';
        if (printerName === 'System Default') {
            printerName = '';
        }

        // 🚀 THE FIX: Use PrintDispatcher for raw/silent printing if configured
        const isRawPrinter = printerName.toLowerCase().includes('tsc') ||
                             printerName.toLowerCase().includes('zebra') ||
                             printerName.toLowerCase().includes('tvs') ||
                             printerName.toLowerCase().includes('pos-');

        if (isRawPrinter && window.electronAPI?.printRaw && isSilent) {
            try {
                // Determine manufacturer from name for dispatcher
                let manufacturer = 'tsc';
                const nameLow = printerName.toLowerCase();
                if (nameLow.includes('zebra')) manufacturer = 'zebra';
                else if (nameLow.includes('tvs')) manufacturer = 'tvs';
                else if (nameLow.includes('sato')) manufacturer = 'sato';

                const innerContent = generateReceiptContent(tx, storeNameOverride, latestSettings, pageSize);
                // Note: Receipt rendering to raw protocol still needs a Template -> Adapter path.
                // For now, we keep the HTML silent print for receipts but route through dispatcher's logic
                // to maintain sequential queueing if the printer is a label/raw type.
            } catch (e) {
                console.warn("Dispatcher routing failed for receipt:", e);
            }
        }

        const innerContent = generateReceiptContent(tx, storeNameOverride, latestSettings, pageSize);

        const fullHtml = `
            <!DOCTYPE html>
            <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <title>Receipt</title>
                </head>
                <body style="margin:0; padding:0; background:white;">${innerContent}</body>
            </html>
        `;

        if (window.electronAPI && typeof window.electronAPI.printSilent === 'function' && isSilent === true) {
            
            // Pre-flight check to prevent backend 'lp' crashes
            if (printerName === '') {
                try {
                    const allPrinters = await window.electronAPI.getPrinters();
                    const hasDefault = allPrinters && allPrinters.some(p => p.isDefault);
                    
                    if (!hasDefault) {
                        console.warn("Pre-flight check failed: No OS default printer exists. Falling back to dialog.");
                        if (typeof showToast === 'function') {
                            showToast("Configuration Needed", "No default printer set in your OS. Please assign one in Settings.", "warning");
                        }
                        fallbackPrint(fullHtml);
                        return;
                    }
                } catch (err) {
                    console.warn("Could not fetch printer list for pre-flight check.");
                }
            }

            const safePrinterName = printerName.toLowerCase();
            if (safePrinterName === 'microsoft print to pdf' || safePrinterName.includes('pdf')) {
                alert("⚠️ Warning: Your POS is set to a PDF Printer. A 'Save As' dialog will appear.");
            }

            let electronPageSize = pageSize;
            if (pageSize === '58mm') {
                electronPageSize = { width: 58000, height: 300000 }; 
            } else if (pageSize === '80mm') {
                electronPageSize = { width: 80000, height: 300000 }; 
            }

            try {
                const result = await window.electronAPI.printSilent({
                    content: fullHtml,
                    silent: true, 
                    pageSize: electronPageSize,
                    printerName: printerName,
                    margins: { marginType: 'none' }
                });

                if (result && result.success) {
                    console.log("✅ Printed successfully via Electron IPC");
                } else {
                    console.error("Print Error:", result?.error || 'Unknown IPC Error');
                    if (typeof showToast === 'function') showToast("Print Failed", "Could not print silently. Falling back to dialog.", "warning");
                    fallbackPrint(fullHtml); 
                }
            } catch (e) {
                console.error("IPC Bridge Error:", e);
                const errMsg = e.message || '';
                if (errMsg.includes('lp: Error - No default destination') || errMsg.includes('No default destination')) {
                    if (typeof showToast === 'function') showToast("No Default Printer", "No default printer set in your OS. Please configure one or select a specific printer in settings.", "error");
                } else {
                    if (typeof showToast === 'function') showToast("Print Error", "Falling back to system print dialog.", "warning");
                }
                fallbackPrint(fullHtml);
            }
        } else {
            console.log("Interactive Mode: Opening Print Dialog...");
            fallbackPrint(fullHtml);
        }
        
    } finally {
        setTimeout(() => {
            isPrintingLock = false;
        }, 2500);
    }
}

function fallbackPrint(fullHtml) {
    const iframeId = 'print-iframe-' + Date.now();
    const iframe = document.createElement('iframe');
    iframe.id = iframeId;
    iframe.style.position = 'fixed';
    iframe.style.right = '-9999px';
    iframe.style.bottom = '-9999px';
    
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(fullHtml); // Write the pre-wrapped full HTML
    doc.close();

    setTimeout(() => {
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch (e) {
            console.error("Browser Print Failed:", e);
        }
        
        setTimeout(() => {
            const el = document.getElementById(iframeId);
            if (el && document.body.contains(el)) {
                document.body.removeChild(el);
            }
        }, 2000); 
    }, 500);
}



// ============================================================================
// A3 HIMALAYA HTML PRINT ENGINE (MATCHES PDF)
// ============================================================================
export async function printA3InvoiceHtml(txData, storeNameOverride) {
    if (typeof fallbackPrint === 'undefined') {
        console.error("fallbackPrint is not defined. Ensure it is placed at the top of print.js");
        return;
    }

    try {
        const s = txData.storeDetails || {};
        const storeName = s.name || storeNameOverride || 'STORE NAME';
        const txDate = txData.timestamp?.toDate ? txData.timestamp.toDate().toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');
        const buyer = txData.customer || {};

        let totalQty = 0, totalTaxable = 0, totalCgst = 0, totalSgst = 0, grandTotal = 0, totalDiscount = 0;

        const formatDate = (dateStr) => {
            if (!dateStr || dateStr === '-') return '-';
            try {
                const d = new Date(dateStr);
                if (isNaN(d.getTime())) return dateStr;
                return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
            } catch(e) { return '-'; }
        };

        const itemsHtml = (txData.items || []).map((item, index) => {
            const qty = Math.abs(item.quantity || 0);
            totalQty += qty;

            const rate = parseFloat(item.cost || item.price || 0);
            const mrp = parseFloat(item.mrp || rate);
            const taxRate = parseFloat(item.taxRate || item.gstSlab || 0);
            const grsAmt = rate * qty;
            const schDisc = parseFloat(item.discount || item.schDisc || 0);
            totalDiscount += schDisc;
            
            const taxableAmt = item.taxableValue || (grsAmt - schDisc);
            const taxAmt = taxableAmt * (taxRate / 100);
            const cgst = taxAmt / 2;
            const sgst = taxAmt / 2;
            const netAmt = taxableAmt + taxAmt;

            totalTaxable += taxableAmt;
            totalCgst += cgst;
            totalSgst += sgst;
            grandTotal += netAmt;

            const mfdStr = formatDate(item.mfd || item.mfgDate || item.manufacturingDate);
            const expStr = formatDate(item.expiry || item.expDate || item.expirationDate);

            return `
                <tr>
                    <td style="text-align:center;">${index + 1}</td>
                    <td style="text-align:center; font-weight:bold;">${escapeHTML(item.sku || item.barcode || '-')}</td>
                    <td style="text-align:center;">${escapeHTML(item.hsn || '-')}</td>
                    <td style="text-align:left; font-weight:bold;">${escapeHTML(item.name)}</td>
                    <td style="text-align:center;">${escapeHTML(item.batch || '-')}</td>
                    <td style="text-align:center;">${escapeHTML(mfdStr)}</td>
                    <td style="text-align:center;">${escapeHTML(expStr)}</td>
                    <td style="text-align:right; font-weight:bold;">${qty}</td>
                    <td style="text-align:right;">${rate.toFixed(2)}</td>
                    <td style="text-align:right;">${taxableAmt.toFixed(2)}</td>
                    <td style="text-align:center;">${(taxRate / 2).toFixed(2)}</td>
                    <td style="text-align:right;">${sgst.toFixed(2)}</td>
                    <td style="text-align:center;">${(taxRate / 2).toFixed(2)}</td>
                    <td style="text-align:right;">${cgst.toFixed(2)}</td>
                    <td style="text-align:right;">${rate.toFixed(2)}</td>
                    <td style="text-align:right;">${mrp.toFixed(2)}</td>
                    <td style="text-align:center;">-</td>
                    <td style="text-align:center;">1 X ${qty}</td>
                </tr>
            `;
        }).join('');

        const roundedGrandTotal = Math.round(grandTotal);

        const numberToWords = (num) => {
            const a = ['','One ','Two ','Three ','Four ', 'Five ','Six ','Seven ','Eight ','Nine ','Ten ','Eleven ','Twelve ','Thirteen ','Fourteen ','Fifteen ','Sixteen ','Seventeen ','Eighteen ','Nineteen '];
            const b = ['', '', 'Twenty','Thirty','Forty','Fifty', 'Sixty','Seventy','Eighty','Ninety'];
            if ((num = num.toString()).length > 9) return 'Overflow';
            const n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
            if (!n) return ''; 
            let str = '';
            str += (n[1] != 0) ? (a[Number(n[1])] || b[n[1][0]] + ' ' + a[n[1][1]]) + 'Crore ' : '';
            str += (n[2] != 0) ? (a[Number(n[2])] || b[n[2][0]] + ' ' + a[n[2][1]]) + 'Lakh ' : '';
            str += (n[3] != 0) ? (a[Number(n[3])] || b[n[3][0]] + ' ' + a[n[3][1]]) + 'Thousand ' : '';
            str += (n[4] != 0) ? (a[Number(n[4])] || b[n[4][0]] + ' ' + a[n[4][1]]) + 'Hundred ' : '';
            str += (n[5] != 0) ? ((str != '') ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0]] + ' ' + a[n[5][1]]) : '';
            return str.trim();
        };

        const amountInWords = numberToWords(roundedGrandTotal) + ' Rupees Only';
        const logoHtml = s.logoUrl ? `<img src="${s.logoUrl}" style="max-width:180px; max-height:60px;">` : ``;

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>A3 Invoice - ${txData.invoiceId}</title>
                <style>
                    @media print {
                        @page { size: A3 landscape; margin: 10mm; }
                        body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                    }
                    body { font-family: Arial, sans-serif; font-size: 8pt; color: #000; margin: 0; padding: 0; }
                    .header-table { width: 100%; margin-bottom: 10px; }
                    .header-table td { vertical-align: top; }
                    .grid-table { width: 100%; border-collapse: collapse; border: 1px solid #000; margin-bottom: 5px; }
                    .grid-table td { border-right: 1px solid #000; padding: 6px; width: 33%; vertical-align: top; }
                    .grid-table td:last-child { border-right: none; }
                    
                    .items-table { width: 100%; border-collapse: collapse; border: 1px solid #000; border-top: none; }
                    .items-table th, .items-table td { border: 1px solid #000; padding: 4px; font-size: 8pt; }
                    .items-table th { text-align: center; font-weight: bold; background: #fff; text-transform: uppercase; font-size: 7pt; }
                    .total-row td { font-weight: bold; border-top: 2px solid #000; }
                </style>
            </head>
            <body>
                <table class="header-table">
                    <tr>
                        <td style="width:33%;">
                            <h2 style="margin:0; font-size: 14pt;">${escapeHTML(storeName)}</h2>
                            <div>${escapeHTML(s.address || 'Address')}</div>
                        </td>
                        <td style="width:34%; text-align:center;">
                            <h1 style="margin:0; font-size: 18pt; letter-spacing: 1px;">TAX INVOICE</h1>
                            <table style="margin: 4px auto 0 auto; text-align: left; font-size: 9pt;">
                                <tr><td style="padding: 1px 10px;">Telephone</td><td>: ${escapeHTML(s.phone || '-')}</td></tr>
                                <tr><td style="padding: 1px 10px;">Email</td><td>: ${escapeHTML(s.email || '-')}</td></tr>
                                <tr><td style="padding: 1px 10px;">GSTIN No.</td><td>: <b>${escapeHTML(s.gstin || '-')}</b></td></tr>
                                <tr><td style="padding: 1px 10px;">PAN</td><td>: <b>${escapeHTML(s.pan || '-')}</b></td></tr>
                            </table>
                        </td>
                        <td style="width:33%; text-align:right;">
                            ${logoHtml}
                        </td>
                    </tr>
                </table>

                

                <table class="grid-table">
                    <tr>
                        <td>
                            <table style="width: 100%; border: none;">
                                <tr><td style="width: 80px; padding: 2px; border: none;"><b>Bill To Party :</b></td><td style="padding: 2px; border: none;">${escapeHTML(buyer.id || '')} (GSTIN: ${escapeHTML(buyer.gstin || '-')})</td></tr>
                                <tr><td style="padding: 2px; border: none;"><b>Name :</b></td><td style="padding: 2px; border: none;">${escapeHTML(buyer.name || 'Walk-in')}</td></tr>
                                <tr><td style="padding: 2px; border: none;"><b>Address :</b></td><td style="padding: 2px; border: none;">${escapeHTML(buyer.address || '-')}</td></tr>
                            </table>
                        </td>
                        <td>
                            <table style="width: 100%; border: none;">
                                <tr><td style="width: 80px; padding: 2px; border: none;"><b>Delivery at :</b></td><td style="padding: 2px; border: none;">${escapeHTML(buyer.id || '')} (GSTIN: ${escapeHTML(buyer.gstin || '-')})</td></tr>
                                <tr><td style="padding: 2px; border: none;"><b>Name :</b></td><td style="padding: 2px; border: none;">${escapeHTML(buyer.name || 'Walk-in')}</td></tr>
                                <tr><td style="padding: 2px; border: none;"><b>Address :</b></td><td style="padding: 2px; border: none;">${escapeHTML(buyer.address || '-')}</td></tr>
                            </table>
                        </td>
                        <td>
                            <table style="width: 100%; border: none;">
                                <tr><td style="width: 80px; padding: 2px; border: none;"><b>GSTIN No. :</b></td><td style="padding: 2px; border: none;">${escapeHTML(buyer.gstin || '-')}</td></tr>
                                <tr><td style="padding: 2px; border: none;"><b>PHONE No. :</b></td><td style="padding: 2px; border: none;">${escapeHTML(buyer.phone || '-')}</td></tr>
                                <tr><td colspan="2" style="padding: 10px 2px 2px 2px; border: none;">
                                    <b>INVOICE No. :</b> &nbsp; <span style="font-size:10pt; font-weight:bold;">${txData.invoiceId}</span> &nbsp;&nbsp; <b>Date :</b> ${txDate}
                                </td></tr>
                            </table>
                        </td>
                    </tr>
                </table>

                <table class="items-table">
                    <thead>
                        <tr>
                            <th>SL.<br>NO.</th><th>CODE</th><th>HSN<br>CODE</th><th style="min-width: 150px;">DESCRIPTION</th>
                            <th>BATCH<br>NO.</th><th>MFD</th><th>EXPIRY</th><th>QTY</th><th>RATE<br>(UNIT)</th>
                            <th>TAXABLE<br>VALUE</th><th>SGST<br>(%)</th><th>SGST<br>VALUE</th>
                            <th>CGST<br>(%)</th><th>CGST<br>VALUE</th><th>PTR</th><th>MRP<br>(UNIT)</th>
                            <th>REDUCED<br>MRP</th><th>PKG<br>DETAIL</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml}
                        <tr class="total-row">
                            <td colspan="7" style="text-align:right; font-size: 10pt;">Grand Total</td>
                            <td style="text-align:right; font-size: 10pt;">${totalQty}</td>
                            <td></td>
                            <td style="text-align:right;">${totalTaxable.toFixed(2)}</td>
                            <td></td>
                            <td style="text-align:right;">${totalSgst.toFixed(2)}</td>
                            <td></td>
                            <td style="text-align:right;">${totalCgst.toFixed(2)}</td>
                            <td colspan="3"></td>
                            <td style="text-align:right; font-size:12pt;">${roundedGrandTotal.toFixed(2)}</td>
                        </tr>
                    </tbody>
                </table>
                
                <div style="margin-top: 10px; font-weight: bold; border: 1px solid #000; padding: 5px;">
                    "These goods are meant for sale in India only"<br>
                    Total Invoice Amount: ${roundedGrandTotal.toFixed(2)}<br>
                    Total Discount value: ${totalDiscount.toFixed(2)}-
                </div>

                <div style="display:flex; justify-content:space-between; margin-top: 10px; border: 1px solid #000; padding: 10px;">
                    <div style="font-size: 9pt;">
                        <b>INVOICE AMOUNT IN WORDS (ROUNDED OFF):</b> RUPEES ${amountInWords.toUpperCase()}<br><br>
                        <b>BANK DETAILS</b><br>
                        "You May RTGS/NEFT to ${escapeHTML(s.bankDetails?.bankName || 'BANK')}, IFSC Code: ${escapeHTML(s.bankDetails?.ifsc || 'N/A')}. Your Account is ${escapeHTML(s.bankDetails?.accountNumber || 'N/A')}"
                    </div>
                    <div style="text-align: right; width: 300px;">
                        <div style="font-size: 14pt; font-weight: 900; margin-bottom: 30px;">For ${escapeHTML(storeName)}</div>
                        <div style="font-weight: bold;">Authorised Signatory</div>
                    </div>
                </div>
            </body>
            </html>
        `;

        const silentToggle = document.getElementById('setting-silent-print') || document.querySelector('input[name="silentPrint"]');
        const isSilentMode = (silentToggle && silentToggle.checked) || localStorage.getItem('mifela_silent_print') === 'true';
        const isDesktop = window.electronAPI && typeof window.electronAPI.printSilent === 'function';

        if (isDesktop && isSilentMode) {
            try {
                const result = await window.electronAPI.printSilent({ content: htmlContent, landscape: true });
                if (!result || !result.success) fallbackPrint(htmlContent);
            } catch (err) {
                console.error("IPC Print Error:", err);
                fallbackPrint(htmlContent);
            }
        } else {
            fallbackPrint(htmlContent);
        }
    } catch (error) {
        console.error("HTML Print failed:", error);
    }
}

// ============================================================================
// A3 HIMALAYA STYLE PDF GENERATOR (RELIABLE DOWNLOAD & PERFECT LAYOUT)
// ============================================================================
export async function generatePosPdf(txData, storeNameOverride) {
    if (typeof jsPDF === 'undefined' || typeof autoTable === 'undefined') {
        if (typeof showModal === 'function') showModal('Library Missing', 'PDF libraries missing. Ensure jsPDF and autoTable are loaded.', 'error');
        return;
    }

    try {
        const doc = new jsPDF('l', 'mm', 'a3'); 
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        
        const s = txData.storeDetails || {};
        const storeName = s.name || storeNameOverride || 'STORE NAME';
        const storeAddress = s.address || '';
        const storePhone = s.phone || '';
        const storeEmail = s.email || '';
        const storeGstin = s.gstin || s.taxId || '';
        const storePan = s.pan || '';
        
        const c = txData.customer || {};
        const buyerName = c.name || 'Walk-in Customer';
        const buyerPhone = c.phone || '';
        const buyerAddress = c.address || '';
        const buyerGstin = c.gstin || '';
        
        const txDate = txData.timestamp?.toDate ? txData.timestamp.toDate().toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');

        // --- 1. HEADER SECTION ---
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.text(storeName, 14, 20);
        
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        const splitAddress = doc.splitTextToSize(storeAddress, 100);
        doc.text(splitAddress, 14, 26);
        
        doc.setFontSize(18);
        doc.setFont("helvetica", "bold");
        doc.text("TAX INVOICE", pageWidth / 2, 20, { align: 'center' });
        
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.text(`Telephone    : ${storePhone}`, pageWidth / 2 - 20, 26);
        doc.text(`Email        : ${storeEmail}`, pageWidth / 2 - 20, 31);
        doc.text(`GSTIN No.    : ${storeGstin}`, pageWidth / 2 - 20, 36);
        doc.text(`PAN          : ${storePan}`, pageWidth / 2 - 20, 41);

        if (s.logoUrl) {
            try {
    if (transactionData.storeDetails && transactionData.storeDetails.logo) {
        // Safely convert whatever format the logo is into a pure JPEG
        const safeLogoBase64 = await getSafePdfImage(transactionData.storeDetails.logo);
        
        if (safeLogoBase64) {
            // Make sure to pass 'JPEG', not 'PNG'
            // Adjust x, y, width, and height variables to match what you already had
            doc.addImage(safeLogoBase64, 'JPEG', x, y, width, height);
        }
    }
} catch (e) {
    console.warn("Could not inject logo into PDF. Skipping to prevent crash.", e);
}
        }

        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");

        // --- 2. CUSTOMER & DELIVERY GRID ---
        doc.setLineWidth(0.3);
        doc.line(14, 53, pageWidth - 14, 53); 
        
        doc.setFontSize(9);
        doc.text("Bill To Party :", 14, 58);
        doc.setFont("helvetica", "normal");
        doc.text(`${c.id || ''} (GSTIN: ${buyerGstin || '-'})`, 40, 58);
        doc.text(`Name :`, 14, 63);
        doc.text(`${buyerName}`, 40, 63);
        doc.text(`Address :`, 14, 68);
        doc.text(doc.splitTextToSize(buyerAddress, 100), 40, 68);

        doc.setFont("helvetica", "bold");
        doc.text("Delivery at :", 150, 58);
        doc.setFont("helvetica", "normal");
        doc.text(`${c.id || ''} (GSTIN: ${buyerGstin || '-'})`, 175, 58);
        doc.text(`Name :`, 150, 63);
        doc.text(`${buyerName}`, 175, 63);
        doc.text(`Address :`, 150, 68);
        doc.text(doc.splitTextToSize(buyerAddress, 100), 175, 68);

        doc.text(`GSTIN No. : ${buyerGstin || '-'}`, 280, 58);
        doc.text(`PHONE No. : ${buyerPhone || '-'}`, 280, 63);
        
        doc.setFont("helvetica", "bold");
        doc.text(`INVOICE No. :`, 340, 58);
        doc.text(txData.invoiceId, 368, 58);
        doc.setFont("helvetica", "normal");
        doc.text(`Date : ${txDate}`, 340, 63);

        doc.line(14, 75, pageWidth - 14, 75); 

        // --- 3. TABLE DATA FORMATTING ---
        let totalQty = 0, grandTotal = 0, totalTaxable = 0, totalSgst = 0, totalCgst = 0, totalDiscount = 0;
        
        const formatDate = (dateStr) => {
            if (!dateStr || dateStr === '-') return '-';
            try {
                const d = new Date(dateStr);
                if (isNaN(d.getTime())) return dateStr;
                return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
            } catch(e) { return '-'; }
        };

        const tableData = (txData.items || []).map((item, index) => {
            const qty = Math.abs(item.quantity || 0);
            totalQty += qty;

            const rate = parseFloat(item.cost || item.price || 0);
            const mrp = parseFloat(item.mrp || rate);
            const taxRate = parseFloat(item.taxRate || item.gstSlab || 0);
            const grsAmt = rate * qty;
            const schDisc = parseFloat(item.discount || item.schDisc || 0);
            totalDiscount += schDisc;
            
            const taxable = item.taxableValue || (grsAmt - schDisc);
            const sgstAmt = taxable * (taxRate / 200);
            const cgstAmt = taxable * (taxRate / 200);
            const netAmt = taxable + sgstAmt + cgstAmt;
            
            totalTaxable += taxable;
            totalSgst += sgstAmt;
            totalCgst += cgstAmt;
            grandTotal += netAmt;

            const mfdStr = formatDate(item.mfd || item.mfgDate || item.manufacturingDate);
            const expStr = formatDate(item.expiry || item.expDate || item.expirationDate);

            return [
                index + 1,
                item.sku || item.barcode || "-",
                item.hsn || "-",
                item.name,
                item.batch || "-",
                mfdStr,
                expStr,
                qty,
                rate.toFixed(2),
                taxable.toFixed(2),
                (taxRate / 2).toFixed(2),
                sgstAmt.toFixed(2),
                (taxRate / 2).toFixed(2),
                cgstAmt.toFixed(2),
                rate.toFixed(2),
                mrp.toFixed(2),
                "-",
                `1 X ${qty}`
            ];
        });

        // --- 4. RENDER TABLE ---
        autoTable(doc, {
            startY: 78,
            head: [['SL.\nNO.', 'CODE', 'HSN\nCODE', 'DESCRIPTION', 'BATCH\nNO.', 'MFD', 'EXPIRY', 'QTY', 'RATE\n(UNIT)', 'TAXABLE\nVALUE', 'SGST\n(%)', 'SGST\nVALUE', 'CGST\n(%)', 'CGST\nVALUE', 'PTR', 'MRP\n(UNIT)', 'REDUCED\nMRP', 'PKG\nDETAIL']],
            body: tableData,
            theme: 'plain',
            styles: { fontSize: 8, lineWidth: 0.2, lineColor: [0, 0, 0], textColor: [0, 0, 0], cellPadding: 1.5 },
            headStyles: { fontStyle: 'bold', halign: 'center', valign: 'middle', fillColor: [255, 255, 255] },
            columnStyles: { 3: { cellWidth: 70 } },
        });

        // --- 5. FOOTER & TOTALS CALCULATION ---
        let finalY = doc.lastAutoTable.finalY;

        if (finalY > pageHeight - 50) {
            doc.addPage();
            finalY = 20;
        }

        doc.setFont("helvetica", "bold");
        doc.rect(14, finalY, pageWidth - 28, 8);
        doc.text("TOTAL", 150, finalY + 5.5);
        doc.text(`${totalQty}`, 192, finalY + 5.5); 
        doc.text(`${totalTaxable.toFixed(2)}`, 220, finalY + 5.5);
        doc.text(`${totalSgst.toFixed(2)}`, 260, finalY + 5.5);
        doc.text(`${totalCgst.toFixed(2)}`, 295, finalY + 5.5);
        doc.setFontSize(12);
        doc.text(`${Math.round(grandTotal).toFixed(2)}`, pageWidth - 16, finalY + 5.5, { align: 'right' });

        const numberToWords = (num) => {
            const a = ['','One ','Two ','Three ','Four ', 'Five ','Six ','Seven ','Eight ','Nine ','Ten ','Eleven ','Twelve ','Thirteen ','Fourteen ','Fifteen ','Sixteen ','Seventeen ','Eighteen ','Nineteen '];
            const b = ['', '', 'Twenty','Thirty','Forty','Fifty', 'Sixty','Seventy','Eighty','Ninety'];
            if ((num = num.toString()).length > 9) return 'Overflow';
            const n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
            if (!n) return ''; 
            let str = '';
            str += (n[1] != 0) ? (a[Number(n[1])] || b[n[1][0]] + ' ' + a[n[1][1]]) + 'Crore ' : '';
            str += (n[2] != 0) ? (a[Number(n[2])] || b[n[2][0]] + ' ' + a[n[2][1]]) + 'Lakh ' : '';
            str += (n[3] != 0) ? (a[Number(n[3])] || b[n[3][0]] + ' ' + a[n[3][1]]) + 'Thousand ' : '';
            str += (n[4] != 0) ? (a[Number(n[4])] || b[n[4][0]] + ' ' + a[n[4][1]]) + 'Hundred ' : '';
            str += (n[5] != 0) ? ((str != '') ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0]] + ' ' + a[n[5][1]]) : '';
            return str.trim();
        };

        const amountInWords = numberToWords(Math.round(grandTotal)) + ' Rupees Only';

        finalY += 8;
        doc.rect(14, finalY, pageWidth - 28, 8);
        doc.setFontSize(9);
        doc.text(`INVOICE AMOUNT IN WORDS (ROUNDED OFF) : RUPEES ${amountInWords.toUpperCase()}`, 16, finalY + 5.5);

        finalY += 8;
        doc.rect(14, finalY, pageWidth - 28, 30);
        
        doc.setFont("helvetica", "normal");
        const bank = s.bankDetails || {};
        doc.text(`Total Invoice Qty : ${totalQty}`, 16, finalY + 6);
        doc.text(`Total Discount Value : ${totalDiscount.toFixed(2)}-`, 16, finalY + 12);
        
        doc.setFont("helvetica", "bold");
        doc.text(`"You May RTGS/NEFT to ${bank.bankName || 'BANK'}, IFSC Code: ${bank.ifsc || 'N/A'}. Your Account is ${bank.accountNumber || 'N/A'}"`, 16, finalY + 20);

        doc.setFontSize(14);
        doc.text(`For ${storeName}`, pageWidth - 16, finalY + 8, { align: 'right' });
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text("Authorised Signatory", pageWidth - 16, finalY + 26, { align: 'right' });

        // 🚀 6. BULLETPROOF DOWNLOAD TRIGGER
        const fileName = `${txData.invoiceId}_A3_Invoice.pdf`;
        
        try {
            if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.saveFile) {
                const arrayBuffer = doc.output('arraybuffer');
                const result = await window.electronAPI.saveFile(arrayBuffer, fileName);
                
                if (result && !result.canceled) {
                    if (typeof showToast === 'function') showToast('Success', 'PDF Saved Successfully', 'success');
                }
                return;
            }
        } catch (ipcErr) {
            console.warn("Electron native save failed, using universal fallback", ipcErr);
        }
        
        const pdfBase64 = doc.output('datauristring');
        const link = document.createElement("a");
        link.href = pdfBase64;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        
        setTimeout(() => { document.body.removeChild(link); }, 500);

        if (typeof showToast === 'function') showToast('Success', 'PDF Downloaded Successfully', 'success');

    } catch (e) {
        console.error("PDF Generation Error:", e);
        if (typeof showModal === 'function') showModal('Export Error', 'Could not generate PDF. Check console for details.', 'error');
    }
}

export function exportPosCartToCsv(tx, storeNameOverride) {
    const s = tx.storeDetails || {};
    const storeName = s.name || storeNameOverride || 'STORE';
    const txDate = tx.timestamp?.toDate ? tx.timestamp.toDate().toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');
    const custName = `"${tx.customer?.name || 'Walk-in'}"`;
    const custPhone = tx.customer?.phone || '-';
    
    // Determine the Trade Type (Fallback to D2C if undefined)
const tradeType = tx.tradeType || ((tx.customer?.gstin && tx.customer.gstin.trim().length >= 15) ? 'B2B' : 'D2C');
    // Standard flat headers for analytics
    const headers = [
        'Store Name', 'Invoice ID', 'Date', 'Trade Type', 'Customer Name', 'Phone', 'Item SKU', 'Item Name', 
        'HSN', 'Batch', 'Expiry', 'Qty', 'Unit Price', 'Gross Amount', 'Discount', 
        'Taxable Value', 'GST %', 'SGST Amount', 'CGST Amount', 'Net Amount'
    ];

    let rows = [];

    (tx.items || []).forEach(item => {
        const qty = Math.abs(item.quantity || 0);
        const rate = parseFloat(item.price || item.cost || 0);
        const taxRate = parseFloat(item.taxRate || item.gstSlab || 0);
        const grsAmt = rate * qty;
        const schDisc = parseFloat(item.discount || item.schDisc || 0);
        
        const taxableAmt = item.taxableValue || (grsAmt - schDisc);
        const taxAmt = taxableAmt * (taxRate / 100);
        const cgst = taxAmt / 2;
        const sgst = taxAmt / 2;
        const netAmt = taxableAmt + taxAmt;

        rows.push([
            `"${storeName}"`, tx.invoiceId, txDate, tradeType, custName, custPhone, `"${item.sku || '-'}"`, `"${item.name}"`,
            item.hsn || '-', item.batch || '-', item.expiry || '-', qty, rate.toFixed(2),
            grsAmt.toFixed(2), schDisc.toFixed(2), taxableAmt.toFixed(2), taxRate.toFixed(2),
            sgst.toFixed(2), cgst.toFixed(2), netAmt.toFixed(2)
        ].join(','));
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    
    try {
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.saveFile) {
            blob.arrayBuffer().then(buffer => {
                window.electronAPI.saveFile(buffer, `${tx.invoiceId}_Sale.csv`);
            });
        } else {
            throw new Error("Fallback to web");
        }
    } catch (err) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${tx.invoiceId}_Sale.csv`;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => { document.body.removeChild(link); URL.revokeObjectURL(url); }, 1000);
    }
}

export async function exportPosCartToExcel(tx, storeNameOverride) {
    if (typeof XLSX === 'undefined') {
        if (typeof showToast === 'function') showToast('Error', 'Excel library missing.', 'error');
        return;
    }

    const s = tx.storeDetails || {};
    const storeName = s.name || storeNameOverride || 'STORE';
    const txDate = tx.timestamp?.toDate ? tx.timestamp.toDate().toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');
    const custName = tx.customer?.name || 'Walk-in';
    const custPhone = tx.customer?.phone || '-';
const tradeType = tx.tradeType || ((tx.customer?.gstin && tx.customer.gstin.trim().length >= 15) ? 'B2B' : 'D2C');
    const aoa = [
        ['Store Name', 'Invoice ID', 'Date', 'Trade Type', 'Customer Name', 'Phone', 'Item SKU', 'Item Name', 'HSN', 'Batch', 'Expiry', 'Qty', 'Unit Price', 'Gross Amount', 'Discount', 'Taxable Value', 'GST %', 'SGST Amount', 'CGST Amount', 'Net Amount']
    ];

    (tx.items || []).forEach(item => {
        const qty = Math.abs(item.quantity || 0);
        const rate = parseFloat(item.price || item.cost || 0);
        const taxRate = parseFloat(item.taxRate || item.gstSlab || 0);
        const grsAmt = rate * qty;
        const schDisc = parseFloat(item.discount || item.schDisc || 0);
        const taxableAmt = item.taxableValue || (grsAmt - schDisc);
        const taxAmt = taxableAmt * (taxRate / 100);
        const cgst = taxAmt / 2;
        const sgst = taxAmt / 2;
        const netAmt = taxableAmt + taxAmt;

        aoa.push([
            storeName, tx.invoiceId, txDate, tradeType, custName, custPhone, item.sku || '-', item.name,
            item.hsn || '-', item.batch || '-', item.expiry || '-', qty, rate.toFixed(2),
            grsAmt.toFixed(2), schDisc.toFixed(2), taxableAmt.toFixed(2), taxRate.toFixed(2),
            sgst.toFixed(2), cgst.toFixed(2), netAmt.toFixed(2)
        ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, "Sales Data");
    XLSX.writeFile(wb, `${tx.invoiceId}_Sale.xlsx`);
}
// ============================================================================
// 6. CORE EXECUTION ENGINE (HANDLES FALLBACKS AUTOMATICALLY)
// ============================================================================
async function executePrintJob(htmlContent, isSilent, pageSize, printerName, isLandscape) {
    const isDesktop = window.electronAPI && typeof window.electronAPI.printSilent === 'function';

    if (isDesktop && isSilent) {
        try {
            const result = await window.electronAPI.printSilent({
                content: htmlContent,
                silent: true, 
                pageSize: pageSize, 
                printerName: printerName,
                landscape: isLandscape,
                margins: { marginType: 'none' }
            });

            if (result && result.success) {
                console.log("✅ Printed successfully via Electron IPC");
                return;
            } else {
                console.warn("Silent print failed (No OS Printer). Falling back to dialog...");
            }
        } catch (err) {
            console.error("IPC Print Error:", err);
        }
    } 

    // FALLBACK IF WEB BROWSER OR SILENT FAILED
    const iframeId = 'print-iframe-' + Date.now();
    const iframe = document.createElement('iframe');
    iframe.id = iframeId;
    iframe.style.position = 'fixed';
    iframe.style.right = '-9999px';
    iframe.style.bottom = '-9999px';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    setTimeout(() => {
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch (e) {
            console.error("Browser Print Failed:", e);
        }
        setTimeout(() => {
            const el = document.getElementById(iframeId);
            if (el && document.body.contains(el)) document.body.removeChild(el);
        }, 2000); 
    }, 500);
}

export async function autoDetectPrinters() {
    if (!window.electronAPI || typeof window.electronAPI.getPrinters !== 'function') {
        console.warn("Printer detection requires the Electron desktop app.");
        return { invoice: '', barcode: '', report: '' };
    }
    
    try {
        const printers = await window.electronAPI.getPrinters();
        if (!printers || !Array.isArray(printers)) return { invoice: '', barcode: '', report: '' };
        
        let detected = { invoice: '', barcode: '', report: '' };
        
        // Smart routing based on common hardware naming conventions
        printers.forEach(p => {
            const name = p.name.toLowerCase();
            
            // Look for thermal receipt printers (POS-58, POS-80, Epson TM, etc.)
            if (!detected.invoice && (name.includes('receipt') || name.includes('pos') || name.includes('thermal') || name.includes('58') || name.includes('80'))) {
                detected.invoice = p.name;
            }
            // Look for label/barcode printers (TVS, TSC, Zebra, etc.)
            if (!detected.barcode && (name.includes('barcode') || name.includes('label') || name.includes('tspl') || name.includes('zdesigner'))) {
                detected.barcode = p.name;
            }
            // Look for A4 document printers (PDF, Laser, HP, Canon, etc.)
            if (!detected.report && (name.includes('pdf') || name.includes('laser') || name.includes('inkjet') || name.includes('hp') || name.includes('canon'))) {
                detected.report = p.name;
            }
        });
        
        // Return formatted object expected by settings.js
        return detected; 
    } catch (e) {
        console.error("Failed to fetch printers from Electron IPC:", e);
        return { invoice: '', barcode: '', report: '' };
    }
}
function generateReceiptContent(tx, storeNameOverride, settings = null, pageSize = '58mm') {
    // Keep your exact existing thermal layout generation logic here
    const currency = tx.currency?.symbol || getCurrencySymbol() || '₹';
    const txType = (tx.type || tx.summary?.transactionType || 'SALE').toUpperCase();
    const s = settings || {};
    const details = tx.storeDetails || {};
    const store = {
        name: s.storeName || s.name || details.name || storeNameOverride || 'STORE NAME',
        logoUrl: s.logoUrl || '',
        tagline: s.tagline || '',
        footer: s.footer || 'Thank you for your business!',
        address: s.address || details.address || '',
        phone: s.phone || details.phone || '',
        gstin: s.taxId || s.gstin || details.gstin || '',
        website: s.website || details.website || '',
        upiId: s.upiId || details.upiId || '',
        tnc: s.tnc || details.tnc || ''
    };
    const storeName = escapeHTML(store.name);
    const logoUrl = escapeHTML(store.logoUrl);
    const tagline = escapeHTML(store.tagline);
    const footerMsg = escapeHTML(store.footer);
    
    const storeAddress = escapeHTML(store.address);
    const storePhone = escapeHTML(store.phone);
    const storeGstin = escapeHTML(store.gstin);
    const storeWebsite = escapeHTML(store.website);
    const storeUpi = escapeHTML(store.upiId);
    const storeTnc = escapeHTML(store.tnc);
    
    // --- 1. DETERMINE DOCUMENT TITLE ---
    let docTitle = "TAX INVOICE";
    if (txType === 'PURCHASE') docTitle = "INWARD PURCHASE VOUCHER";
    if (txType === 'LOSS') docTitle = "INVENTORY SCRAP / LOSS";
    if (txType === 'ADJUSTMENT') docTitle = "STOCK ADJUSTMENT";
    if (txType === 'REFUND') docTitle = "REFUND NOTE";
    
    // --- 2. FORMAT DATES ---
    let dateStr = new Date().toLocaleString();
    const targetTimestamp = tx.localTimestamp || tx.timestamp;
    if (targetTimestamp) {
        if (typeof targetTimestamp.toDate === 'function') dateStr = targetTimestamp.toDate().toLocaleString(); 
        else if (targetTimestamp instanceof Date) dateStr = targetTimestamp.toLocaleString(); 
        else if (typeof targetTimestamp === 'string') dateStr = new Date(targetTimestamp).toLocaleString();
    }
    
    // --- 3. RESPONSIVE THERMAL SIZING STATE ---
    const isThermal = pageSize === '58mm' || pageSize === '80mm';
    const isUltraNarrow = pageSize === '58mm';
    
    // --- 4. CUSTOMER OR SUPPLIER INFO ---
    const customer = tx.customer || {};
    let entityHtml = '';

    if (txType === 'PURCHASE') {
        const suppName = escapeHTML(customer.name || tx.supplierName || 'Unknown Supplier');
        const suppGstin = escapeHTML(customer.gstin || tx.dealerGstin || '').toUpperCase();
        const suppInv = escapeHTML(tx.supplierInvoice || tx.invoiceId || '');
        
        entityHtml = `
            <div class="divider"></div>
            <div class="customer-box">
                <div class="font-bold text-uppercase">SUPPLIER: ${suppName}</div>
                ${customer.phone ? `<div>PH: ${escapeHTML(customer.phone)}</div>` : ''}
                ${suppGstin ? `<div>GSTIN: ${suppGstin}</div>` : ''}
                ${suppInv ? `<div style="margin-top: 2px; font-weight: 900;">SUPP INV: ${suppInv}</div>` : ''}
            </div>
        `;
    } else if ((txType === 'SALE' || txType === 'REFUND') && customer.name && customer.id !== 'WALK-IN') {
        entityHtml = `
            <div class="divider"></div>
            <div class="customer-box">
                <div class="font-bold text-uppercase">BILL TO: ${escapeHTML(customer.name)}</div>
                ${customer.phone ? `<div>PH: ${escapeHTML(customer.phone)}</div>` : ''}
                ${customer.gstin ? `<div>GSTIN: ${escapeHTML(customer.gstin).toUpperCase()}</div>` : ''}
            </div>
        `;
    }

    // --- 5. BUILD ITEMS TABLE ---
    let itemsHtml = '';
    let totalSavings = 0;
    const items = Array.isArray(tx.items) ? tx.items : [];
    
    itemsHtml = `
        <div class="table-header">
            <div class="col-name">ITEM</div>
            <div class="col-qty">QTY</div>
            <div class="col-price">RATE</div>
            <div class="col-total">AMT</div>
        </div>
    `;
    
    if (txType === 'PURCHASE' || txType === 'LOSS' || txType === 'ADJUSTMENT') {
        items.forEach(item => {
            const name = escapeHTML(item.name || 'Unknown Item');
            const qty = parseFloat(Math.abs(item.quantity || 0));
            const baseRate = parseFloat(item.baseRate || item.cost || item.price || 0);
            const netAmt = parseFloat(item.amount || item.total || item.netAmt || (baseRate * qty));
            const taxRate = parseFloat(item.taxRate || item.gstSlab || 0);
            
            const nameDisplay = taxRate > 0 ? `${name} <div class="tax-tag">(${taxRate}%)</div>` : name;

            itemsHtml += `
                <div class="item-row">
                    <div class="col-name" style="text-transform: uppercase;">${nameDisplay}</div>
                    <div class="col-qty">${qty}</div>
                    <div class="col-price">${baseRate.toFixed(2)}</div>
                    <div class="col-total">${netAmt.toFixed(2)}</div>
                </div>`;
        });
    } else {
        items.forEach(item => {
            const name = escapeHTML(item.name || 'Unknown Item');
            const price = parseFloat(item.price || item.cost || item.purchasePrice || 0); 
            const qty = parseFloat(Math.abs(item.quantity || 0));
            const subtotal = parseFloat(Math.abs(item.subtotal || item.amount || item.total || (price * qty)));
            const taxRate = parseFloat(item.taxRate || item.gstSlab || 0);
            
            const itemMrp = parseFloat(item.mrp || item.price || 0);
            if (itemMrp > price) totalSavings += (itemMrp - price) * qty;
            
            const nameDisplay = taxRate > 0 ? `${name} <div class="tax-tag">(${taxRate}%)</div>` : name;

            itemsHtml += `
                <div class="item-row">
                    <div class="col-name" style="text-transform: uppercase;">${nameDisplay}</div>
                    <div class="col-qty">${qty}</div>
                    <div class="col-price">${price.toFixed(2)}</div>
                    <div class="col-total">${subtotal.toFixed(2)}</div>
                </div>`;
        });
    }

    // --- 6. SUMMARY & DYNAMIC SMART TOTALS ---
    const summary = tx.summary || {};
    const subtotal = parseFloat(Math.abs(summary.subtotal || 0)); 
    const tax = parseFloat(summary.tax || 0);
    const cess = parseFloat(summary.cess || 0);
    const discount = parseFloat(Math.abs(summary.discount || 0));
    const fee = parseFloat(summary.convenienceFee || 0);
    
    const currentInvoiceTotal = summary.cartTotal !== undefined ? parseFloat(summary.cartTotal) : parseFloat(Math.abs(summary.total || 0)); 
    const previousDues = parseFloat(summary.dues || 0); 
    const payMethod = escapeHTML(summary.paymentMethod || 'Cash').toUpperCase();
    const invId = escapeHTML(tx.invoiceId || tx.id || 'N/A');

    let amountPaid = 0;
    if (summary.revenue !== undefined) {
        amountPaid = parseFloat(summary.revenue);
    } else {
        amountPaid = (payMethod === 'CREDIT' || payMethod === 'UDHAAR') ? 0 : currentInvoiceTotal;
    }

    const totalPayable = currentInvoiceTotal + previousDues;
    const newClosingBalance = totalPayable - amountPaid;

    const hasModifiers = discount > 0 || fee > 0;
    const hasUdhaarFlow = previousDues !== 0 || Math.abs(newClosingBalance) > 0.01; 
    
    let dynamicTotalsHtml = '';

    if (hasModifiers) {
        dynamicTotalsHtml += `
            <div class="tot-row">
                <span>Items Subtotal:</span> 
                <span>${currency}${subtotal.toFixed(2)}</span>
            </div>`;
        if (discount > 0) {
            dynamicTotalsHtml += `
            <div class="tot-row">
                <span>${txType === 'PURCHASE' ? 'Round Off/Disc' : 'Discount'}:</span> 
                <span>-${currency}${discount.toFixed(2)}</span>
            </div>`;
        }
        if (fee > 0) {
            dynamicTotalsHtml += `
            <div class="tot-row">
                <span>Conv. Fee:</span> 
                <span>+${currency}${fee.toFixed(2)}</span>
            </div>`;
        }
    }

    if (hasUdhaarFlow) {
        if (hasModifiers) dynamicTotalsHtml += `<div class="divider"></div>`;
        
        dynamicTotalsHtml += `
            <div class="tot-row font-bold">
                <span>Current Bill Total:</span> 
                <span>${currency}${currentInvoiceTotal.toFixed(2)}</span>
            </div>`;

        if (previousDues !== 0) {
            dynamicTotalsHtml += `
            <div class="tot-row font-bold">
                <span>${previousDues > 0 ? 'Previous Dues:' : 'Advance Balance:'}</span> 
                <span>${previousDues > 0 ? '+' : '-'}${currency}${Math.abs(previousDues).toFixed(2)}</span>
            </div>`;
        }

        dynamicTotalsHtml += `
            <div class="tot-row grand-total">
                <span>TOTAL PAYABLE:</span> 
                <span>${currency}${totalPayable.toFixed(2)}</span>
            </div>
            <div class="tot-row font-bold" style="font-size: ${isUltraNarrow ? '10px' : (isThermal ? '13px' : '16px')};">
                <span>Amount Paid Today:</span> 
                <span>${currency}${amountPaid.toFixed(2)}</span>
            </div>`;
            
        if (newClosingBalance > 0) {
            dynamicTotalsHtml += `
            <div class="divider"></div>
            <div class="tot-row font-black text-uppercase" style="font-size: ${isUltraNarrow ? '10px' : (isThermal ? '14px' : '18px')};">
                <span>Remaining Udhaar:</span> 
                <span>${currency}${newClosingBalance.toFixed(2)}</span>
            </div>`;
        } else if (newClosingBalance < 0) {
            dynamicTotalsHtml += `
            <div class="divider"></div>
            <div class="tot-row font-black text-uppercase" style="font-size: ${isUltraNarrow ? '10px' : (isThermal ? '14px' : '18px')};">
                <span>Advance / Change:</span> 
                <span>${currency}${Math.abs(newClosingBalance).toFixed(2)}</span>
            </div>`;
        } else if (newClosingBalance === 0 && previousDues !== 0) {
            dynamicTotalsHtml += `
            <div class="divider"></div>
            <div class="tot-row font-black" style="font-size: ${isUltraNarrow ? '9px' : (isThermal ? '13px' : '16px')}; justify-content:center;">
                <span>ACCOUNT CLEARED ✓</span>
            </div>`;
        }
    } else {
        dynamicTotalsHtml += `
            <div class="tot-row grand-total">
                <span>TOTAL:</span> 
                <span>${currency}${currentInvoiceTotal.toFixed(2)}</span>
            </div>`;
    }

    return `
        <style>
            @media print {
                @page { 
                    margin: 0; 
                    ${isThermal ? `size: ${pageSize} auto;` : `size: ${pageSize === "A3" ? "A3 landscape" : "A4 portrait"}; margin: 10mm;`}
                }
            }
            
            * { box-sizing: border-box; }
            
            html, body { 
                margin: 0 !important; 
                padding: 0 !important; 
                width: ${isThermal ? pageSize : "100%"}; 
                position: absolute;
                top: 0;
                left: 0;
                background-color: white; 
                color: #000 !important; 
                -webkit-font-smoothing: antialiased;
            }
            
            .receipt-wrapper { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
                font-weight: 600; 
                color: #000 !important; 
                font-size: ${isUltraNarrow ? "10px" : isThermal ? "13px" : "16px"}; 
                line-height: ${isUltraNarrow ? "1.15" : "1.3"}; 
                width: 100%; 
                max-width: ${isThermal ? pageSize : "100%"}; 
                margin: 0; 
                padding: ${isThermal ? "2mm 4mm 10mm 4mm" : "10px"}; 
                background: white; 
            }
            
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .text-left { text-align: left; }
            .font-bold { font-weight: bold; }
            .font-black { font-weight: 900; }
            .text-uppercase { text-transform: uppercase !important; }
            
            .header { text-align: center; margin-bottom: 6px; display: flex; flex-direction: column; align-items: center; width: 100%; }
            .store-name { font-size: ${isUltraNarrow ? "16px" : isThermal ? "22px" : "28px"}; font-weight: 900; text-transform: uppercase; margin-bottom: 2px; letter-spacing: 0px; line-height: 1.1; width: 100%; word-wrap: break-word; }
            .tagline { font-size: ${isUltraNarrow ? "8px" : isThermal ? "11px" : "14px"}; font-style: italic; margin-bottom: 2px; font-weight: normal; }
            .store-meta { font-size: ${isUltraNarrow ? "9px" : isThermal ? "11px" : "14px"}; margin-bottom: 1px; font-weight: 600; width: 100%; word-wrap: break-word; }
            .store-logo { max-width: ${isUltraNarrow ? "80px" : isThermal ? "110px" : "180px"}; max-height: ${isUltraNarrow ? "35px" : isThermal ? "50px" : "90px"}; margin-bottom: 6px; margin-top: 4px; display: block; object-fit: contain; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            
            .doc-title { text-align: center; font-size: ${isUltraNarrow ? "12px" : isThermal ? "15px" : "20px"}; font-weight: 900; margin: 6px 0; text-transform: uppercase; letter-spacing: 0.5px; background: #000; color: #fff !important; padding: 4px 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; width: 100%; }
            
            .info-grid { display: flex; justify-content: space-between; font-size: ${isUltraNarrow ? "9px" : isThermal ? "11px" : "14px"}; margin-bottom: 2px; width: 100%; }
            .customer-box { margin: 6px 0; padding: 6px; border: 1.5px dotted #000; font-size: ${isUltraNarrow ? "9px" : isThermal ? "11px" : "14px"}; border-radius: 4px; width: 100%; word-wrap: break-word; }            
            .divider { border-top: 1px dashed #000; margin: 4px 0; width: 100%; }
            
            .table-header { display: flex; font-size: ${isUltraNarrow ? "9px" : isThermal ? "11px" : "14px"}; font-weight: 900; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 3px 0; margin: 4px 0; text-transform: uppercase; width: 100%; }
            .item-row { display: flex; font-size: ${isUltraNarrow ? "10px" : isThermal ? "12px" : "14px"}; margin-bottom: 4px; align-items: flex-start; width: 100%; }
            
            .col-name { width: 45%; padding-right: 2px; word-break: break-word; line-height: 1.15; }
            .col-qty { width: 15%; text-align: center; flex-shrink: 0; }
            .col-price { width: 20%; text-align: right; flex-shrink: 0; }
            .col-total { width: 20%; text-align: right; font-weight: 900; flex-shrink: 0; }
            
            .tax-tag { font-size: ${isUltraNarrow ? "7.5px" : isThermal ? "9px" : "12px"}; color: #555; font-weight: normal; margin-top: 1px; display: block; }

            .totals-wrapper { width: 100%; margin-top: 4px; }
            .tot-row { display: flex; justify-content: space-between; font-size: ${isUltraNarrow ? "10px" : isThermal ? "12px" : "15px"}; margin-bottom: 2px; align-items: center; width: 100%; }
            
            .grand-total { font-size: ${isUltraNarrow ? "14px" : isThermal ? "18px" : "22px"}; font-weight: 900; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; padding: 4px 0; margin: 4px 0; }
            
            .footer { text-align: center; margin-top: 10px; width: 100%; }
            .tnc-box { font-size: ${isUltraNarrow ? "8px" : isThermal ? "10px" : "11px"}; margin: 4px 0; text-align: center; font-weight: normal; line-height: 1.2; word-wrap: break-word; }
            .tnc-title { font-weight: bold; text-decoration: underline; margin-bottom: 1px; }
        </style>

        <div class="receipt-wrapper">
            <div class="header">
                ${logoUrl ? `<img src="${logoUrl}" class="store-logo" alt="Logo" />` : ""}
                <div class="store-name">${storeName}</div>
                ${tagline ? `<div class="tagline">${tagline}</div>` : ""}
                
                ${storeAddress ? `<div class="store-meta">${storeAddress}</div>` : ""}
                ${storePhone ? `<div class="store-meta">TEL: ${storePhone}</div>` : ""}
                ${storeWebsite ? `<div class="store-meta">${storeWebsite}</div>` : ""}
                
                ${storeGstin ? `<div class="store-meta font-bold mt-1">GSTIN: ${storeGstin}</div>` : ""}
            </div>
            
            <div class="doc-title">${docTitle}</div>
            
            <div class="info-grid font-bold text-uppercase">
                <div>REF: ${invId}</div>
                <div>${dateStr.split(",")[0]}</div>
            </div>
            <div class="info-grid text-uppercase">
                <div>AUTH: ${escapeHTML(tx.cashierName || "System")}</div>
                <div>${dateStr.split(",")[1]?.trim() || ""}</div>
            </div>

            ${entityHtml}
            
            <div>
                ${itemsHtml}
            </div>
            
            <div class="divider"></div>
            
            <div class="totals-wrapper">
                ${dynamicTotalsHtml}

                ${totalSavings > 0 && txType === "SALE" ? `
                <div class="text-center font-bold" style="font-size: ${isUltraNarrow ? "8.5px" : isThermal ? "12px" : "15px"}; padding: 2px 0;">
                    *** YOU SAVED ${currency}${totalSavings.toFixed(2)} ***
                </div>
                <div class="divider"></div>` : ""}

                ${tax > 0 || cess > 0 ? `<div class="divider"></div>` : ""}
                ${tax > 0 ? `
                <div class="tot-row indent">
                    <span>CGST:</span> 
                    <span>${currency}${(tax / 2).toFixed(2)}</span>
                </div>
                <div class="tot-row indent">
                    <span>SGST:</span> 
                    <span>${currency}${(tax / 2).toFixed(2)}</span>
                </div>` : ""}
                ${cess > 0 ? `
                <div class="tot-row indent">
                    <span>Includes Cess:</span> 
                    <span>${currency}${cess.toFixed(2)}</span>
                </div>` : ""}

                <div class="divider"></div>
                
                <div class="tot-row font-bold text-uppercase">
                    <span>PAYMENT MODE:</span> 
                    <span>${payMethod}</span>
                </div>
                
                ${storeUpi ? `
                <div class="tot-row font-bold text-uppercase">
                    <span>STORE UPI:</span> 
                    <span>${storeUpi}</span>
                </div>` : ""}
                
                ${summary.reason ? `
                <div class="divider"></div>
                <div class="text-left" style="font-size: ${isUltraNarrow ? "8px" : isThermal ? "10px" : "13px"};">
                    <div class="font-bold">Note:</div>
                    <div style="font-weight: normal; white-space: pre-wrap;">${escapeHTML(summary.reason)}</div>
                </div>` : ""}
            </div>
            
            <div class="footer text-uppercase">
                <div class="divider"></div>
                ${storeWebsite ? `<div class="store-meta mt-1">${storeWebsite}</div>` : ""}
                
                ${storeTnc ? `
                <div class="tnc-box mt-1">
                    <div class="tnc-title">T&C</div>
                    ${storeTnc.replace(/\n/g, "<br>")}
                </div>` : ""}

                <div class="font-black" style="margin-top: 6px; font-size: ${isUltraNarrow ? "10.5px" : isThermal ? "12px" : "15px"};">${footerMsg}</div>
                <div style="font-size: 7.5px; margin-top: 2px; font-weight: normal;">GENERATED BY MIFELA POS</div>
            </div>
        </div>
    `;
}
// ============================================================================
// 7. LEDGER EXPORTS (Moved from customers.js)
// ============================================================================

export function exportLedgerToCsv(txData, storeName = 'STORE') {
    const headers = [
        'SL. NO.', 'CODE', 'HSN CODE', 'DESCRIPTION', 'BATCH NO.', 'MFD', 'EXPIRY', 
        'QTY', 'RATE (UNIT)', 'TAXABLE VALUE', 'SGST (%)', 'SGST VALUE', 'CGST (%)', 'CGST VALUE', 
        'PTR', 'MRP (UNIT)'
    ];

    const items = txData.items || [];
    if (items.length === 0) {
        if (typeof showToast === 'function') showToast('Empty', 'No items in this transaction to export.', 'warning');
        return;
    }

    const rows = items.map((item, index) => {
        const qty = Math.abs(item.quantity || 0);
        const rate = parseFloat(item.price || item.cost || item.purchasePrice || 0);
        const taxRate = parseFloat(item.taxRate || item.gstSlab || 0);
        const lineTotal = rate * qty;
        const taxable = item.taxableValue || (lineTotal / (1 + (taxRate / 100)));
        const sgstAmt = taxable * (taxRate / 200);
        const cgstAmt = taxable * (taxRate / 200);
        const ptr = item.cost || rate; 

        return [
            index + 1, `"${item.sku || '-'}"`, `"${item.hsn || '-'}"`, `"${item.name}"`, `"${item.batch || '-'}"`,
            `"${item.mfd || '-'}"`, `"${item.expiry || '-'}"`, qty, rate.toFixed(2), taxable.toFixed(2),
            (taxRate / 2).toFixed(2), sgstAmt.toFixed(2), (taxRate / 2).toFixed(2), cgstAmt.toFixed(2),
            ptr.toFixed(2), parseFloat(item.mrp || rate).toFixed(2)
        ];
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Invoice_${txData.invoiceId || 'Ledger'}.csv`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { document.body.removeChild(link); URL.revokeObjectURL(url); }, 1000);
}

export async function exportLedgerToExcel(txData, storeName = 'STORE') {
    if (typeof XLSX === 'undefined') {
        if (typeof showToast === 'function') showToast('Error', 'Excel library missing. Please load SheetJS.', 'error');
        return;
    }

    const items = txData.items || [];
    if (items.length === 0) {
        if (typeof showToast === 'function') showToast('Empty', 'No items to export.', 'warning');
        return;
    }

    const txDate = txData.timestamp?.toDate ? txData.timestamp.toDate().toLocaleDateString() : new Date().toLocaleDateString();
    const custName = txData.customer?.name || 'Customer';
    const custPhone = txData.customer?.phone || 'N/A';

    const aoa = [
        [storeName],
        ['TAX INVOICE'],
        [`Invoice No: ${txData.invoiceId || '-'}`, '', `Date: ${txDate}`],
        [`Bill To: ${custName}`, '', `Phone: ${custPhone}`],
        [],
        ['SL. NO.', 'CODE', 'HSN CODE', 'DESCRIPTION', 'BATCH NO.', 'MFD', 'EXPIRY', 'QTY', 'RATE (UNIT)', 'TAXABLE VALUE', 'SGST (%)', 'SGST VALUE', 'CGST (%)', 'CGST VALUE', 'PTR', 'MRP (UNIT)']
    ];

    items.forEach((item, index) => {
        const qty = Math.abs(item.quantity || 0);
        const rate = parseFloat(item.price || item.cost || item.purchasePrice || 0);
        const taxRate = parseFloat(item.taxRate || item.gstSlab || 0);
        const lineTotal = rate * qty;
        const taxable = item.taxableValue || (lineTotal / (1 + (taxRate / 100)));
        const sgstAmt = taxable * (taxRate / 200);
        const cgstAmt = taxable * (taxRate / 200);
        const ptr = item.cost || rate;

        aoa.push([
            index + 1, item.sku || '-', item.hsn || '-', item.name, item.batch || '-', item.mfd || '-', item.expiry || '-',
            qty, rate.toFixed(2), taxable.toFixed(2), (taxRate / 2).toFixed(2), sgstAmt.toFixed(2),
            (taxRate / 2).toFixed(2), cgstAmt.toFixed(2), ptr.toFixed(2), parseFloat(item.mrp || rate).toFixed(2)
        ]);
    });

    const subtotal = txData.summary?.subtotal || 0;
    const tax = txData.summary?.tax || 0;
    const discount = txData.summary?.discount || 0;
    const total = Math.abs(txData.summary?.total || 0);

    aoa.push([]);
    aoa.push(['', '', '', '', '', '', '', '', 'Subtotal:', subtotal.toFixed(2)]);
    aoa.push(['', '', '', '', '', '', '', '', 'Tax:', tax.toFixed(2)]);
    if (discount > 0) aoa.push(['', '', '', '', '', '', '', '', 'Discount:', `-${discount.toFixed(2)}`]);
    aoa.push(['', '', '', '', '', '', '', '', 'Total Amount:', total.toFixed(2)]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, "Invoice");
    XLSX.writeFile(wb, `Invoice_${txData.invoiceId || 'Ledger'}.xlsx`);
}

export async function generateLedgerPdf(txData, storeName = 'STORE') {
    if (typeof jsPDF === 'undefined' || typeof autoTable === 'undefined') {
        if (typeof showToast === 'function') showToast('Error', 'PDF libraries are missing.', 'error');
        return;
    }

    const items = txData.items || [];
    if (items.length === 0) {
        if (typeof showToast === 'function') showToast('Empty', 'No items to export.', 'warning');
        return;
    }

    const doc = new jsPDF('p', 'mm', 'a3'); 
    const txDate = txData.timestamp?.toDate ? txData.timestamp.toDate().toLocaleDateString() : new Date().toLocaleDateString();
    const currencySymbol = '₹';
    
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text(storeName, 14, 20);
    
    doc.setFontSize(14);
    doc.setFont("helvetica", "normal");
    doc.text("TAX INVOICE", 14, 30);
    
    doc.setFontSize(11);
    doc.text(`Invoice No: ${txData.invoiceId || '-'}`, 14, 40);
    doc.text(`Date: ${txDate}`, 14, 46);
    
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFont("helvetica", "bold");
    doc.text("BILLED TO:", pageWidth - 80, 40);
    doc.setFont("helvetica", "normal");
    doc.text(txData.customer?.name || 'Walk-in', pageWidth - 80, 46);
    doc.text(`Phone: ${txData.customer?.phone || 'N/A'}`, pageWidth - 80, 52);

    const tableData = items.map((item, index) => {
        const qty = Math.abs(item.quantity || 0);
        const rate = parseFloat(item.price || item.cost || item.purchasePrice || 0);
        const taxRate = parseFloat(item.taxRate || item.gstSlab || 0);
        const lineTotal = item.subtotal !== undefined ? parseFloat(item.subtotal) : (rate * qty);

        return [
            index + 1, item.name, item.sku || '-', item.hsn || '-', qty,
            `${currencySymbol}${rate.toFixed(2)}`, `${taxRate}%`, `${currencySymbol}${lineTotal.toFixed(2)}`
        ];
    });

    autoTable(doc, {
        startY: 65,
        head: [['#', 'Description', 'SKU', 'HSN', 'Qty', 'Rate', 'Tax', 'Total']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] },
        styles: { fontSize: 10 }
    });

    const finalY = doc.lastAutoTable.finalY + 10;
    const subtotal = txData.summary?.subtotal || 0;
    const tax = txData.summary?.tax || 0;
    const discount = txData.summary?.discount || 0;
    const total = Math.abs(txData.summary?.total || 0);

    doc.setFont("helvetica", "normal");
    doc.text(`Subtotal: ${currencySymbol}${subtotal.toFixed(2)}`, pageWidth - 14, finalY, { align: 'right' });
    doc.text(`Tax: ${currencySymbol}${tax.toFixed(2)}`, pageWidth - 14, finalY + 6, { align: 'right' });
    if (discount > 0) doc.text(`Discount: -${currencySymbol}${discount.toFixed(2)}`, pageWidth - 14, finalY + 12, { align: 'right' });
    
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(`Total: ${currencySymbol}${total.toFixed(2)}`, pageWidth - 14, finalY + 22, { align: 'right' });

    doc.save(`Invoice_${txData.invoiceId || 'Ledger'}_Export.pdf`);
}

// ============================================================================
// 8. TRANSACTIONS EXPORTS (Moved from transactions.js)
// ============================================================================

export function buildSimpleTransactionsPrintHtml(data, rangeLabel) {
    const rowsHtml = data.map(r => `<tr><td>${r.Date}</td><td>${r.InvoiceID}</td><td>${r.Type}</td><td>${r.Party}</td><td>${r.Method}</td><td style="text-align:right;">${r.TotalAmount}</td></tr>`).join('');
    return `
        <html><head><title>Transactions Report</title>
        <style>body{font-family:sans-serif;padding:20px;} table{width:100%;border-collapse:collapse;} th,td{border:1px solid #ddd;padding:8px;font-size:12px;text-align:left;} th{background:#f4f4f4;}</style>
        </head><body><h2>Transactions Export (${rangeLabel.toUpperCase()})</h2><table><thead><tr><th>Date</th><th>Invoice</th><th>Type</th><th>Party</th><th>Method</th><th style="text-align:right;">Total</th></tr></thead><tbody>${rowsHtml}</tbody></table>
        </body></html>
    `;
}

export function buildTransactionsPrintHtml(mappedData, storeName, storeDetails, activeFilterText) {
    const headHtml = Object.keys(mappedData[0]).map(h => `<th>${escapeHTML(h)}</th>`).join('');
    const rowsHtml = mappedData.map((r, i) => `<tr class="${i % 2 === 0 ? 'bg-slate-50' : 'bg-white'}">${Object.values(r).map(v => `<td>${escapeHTML(String(v))}</td>`).join('')}</tr>`).join('');
    
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Transactions Report</title>
            <style>
                @page { margin: 15mm; size: A4 portrait; }
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 20px; color: #1e293b; background: white; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                h2 { margin: 0 0 5px 0; font-size: 22px; text-transform: uppercase; font-weight: 900; }
                .store-info { font-size: 11px; color: #0f172a; margin-bottom: 20px; white-space: pre-wrap; font-weight: bold; }
                .meta { font-size: 9px; color: #64748b; margin-bottom: 15px; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #cbd5e1; padding: 8px; font-size: 10px; text-align: left; }
                th { background-color: #4f46e5 !important; color: white !important; text-transform: uppercase; font-size: 9px; font-weight: bold; }
                .bg-slate-50 { background-color: #f8fafc !important; }
                .bg-white { background-color: #ffffff !important; }
                .footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; font-size: 9px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 10px; }
            </style>
        </head>
        <body>
            <h2>Transactions Report</h2>
            <div class="store-info">${escapeHTML(storeName)}<br><span style="font-weight: normal; font-size: 10px;">${escapeHTML(storeDetails)}</span></div>
            <div class="meta">
                <b>Filters Applied:</b> ${escapeHTML(activeFilterText)} <br> 
                <b>Generated on:</b> ${new Date().toLocaleString()}
            </div>
            <table>
                <thead><tr>${headHtml}</tr></thead>
                <tbody>${rowsHtml}</tbody>
            </table>
            <div class="footer">Mifela POS | Powered by Mifela Inventory Management</div>
        </body>
        </html>
    `;
}

export async function generateTransactionsPdf(mappedData, storeName, storeDetails, activeFilterText) {
    if (typeof jsPDF === 'undefined' || typeof autoTable === 'undefined') {
        throw new Error('PDF libraries are missing (jsPDF & AutoTable).');
    }
    const pdfDoc = new jsPDF('p', 'mm', 'a4');
    
    // Draw Headers
    pdfDoc.setFontSize(18);
    pdfDoc.text("Transactions Report", 14, 20);
    
    pdfDoc.setFontSize(11);
    pdfDoc.setFont("helvetica", "bold");
    pdfDoc.text(storeName, 14, 28);
    
    pdfDoc.setFontSize(9);
    pdfDoc.setFont("helvetica", "normal");
    const detailsLines = pdfDoc.splitTextToSize(storeDetails, 100);
    pdfDoc.text(detailsLines, 14, 33);
    
    const metaY = 33 + (detailsLines.length * 4) + 5;
    pdfDoc.setTextColor(100);
    pdfDoc.text(`Filters: ${activeFilterText}`, 14, metaY);
    pdfDoc.text(`Generated: ${new Date().toLocaleString()}`, 14, metaY + 5);
    
    // Draw Table
    autoTable(pdfDoc, {
        head: [Object.keys(mappedData[0])],
        body: mappedData.map(r => Object.values(r)),
        startY: metaY + 10,
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 3 },
        alternateRowStyles: { fillColor: [248, 250, 252] }
    });

    // Draw Watermarks
    const pageCount = pdfDoc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        pdfDoc.setPage(i);
        const pw = pdfDoc.internal.pageSize.getWidth();
        const ph = pdfDoc.internal.pageSize.getHeight();
        pdfDoc.setFontSize(8);
        pdfDoc.setTextColor(150);
        pdfDoc.setDrawColor(200);
        pdfDoc.line(14, ph - 15, pw - 14, ph - 15);
        pdfDoc.text("Mifela POS | Powered by Mifela Inventory Management", pw / 2, ph - 10, { align: 'center' });
    }
    
    return pdfDoc;
}
function getSafePdfImage(imgSrc) {
    return new Promise((resolve) => {
        if (!imgSrc) return resolve(null);
        const img = new Image();
        img.crossOrigin = 'Anonymous'; 
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            
            // Fill white background to prevent transparent PNGs from turning black
            ctx.fillStyle = '#FFFFFF'; 
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            
            // Export as JPEG (jsPDF handles JPEGs much better than PNGs)
            resolve(canvas.toDataURL('image/jpeg', 0.9)); 
        };
        img.onerror = () => resolve(null);
        img.src = imgSrc;
    });
}