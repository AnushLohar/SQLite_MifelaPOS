// src/utils/export.js

import { 
    productsRef, transactionsRef, customersRef, storeId, appId, getCurrencySymbol
} from '../store/state.js';
import { DOM, showModal } from './dom.js'; 


/**
 * Universal Excel Downloader
 * Converts JSON arrays into perfect .xlsx files
 */
function downloadExcel(dataArray, sheetName, fileName) {
    if (typeof XLSX === 'undefined') {
        showModal('Library Missing', 'Excel engine is loading. Ensure you have an internet connection.', 'error');
        return;
    }
    
    // Create the worksheet
    const ws = XLSX.utils.json_to_sheet(dataArray);
    
    // Auto-size columns based on header lengths for a clean UI
    const colWidths = Object.keys(dataArray[0] || {}).map(k => ({ wch: Math.max(k.length + 5, 15) }));
    ws['!cols'] = colWidths;

    // Create workbook and trigger download
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName);
}


export async function exportPartnersToCSV(typeFilter = 'all') {
    try {
        // 1. Fetch from Local SQLite Database instead of Firebase
        if (!window.dbAPI || !window.dbAPI.getCustomers) {
            throw new Error("Offline database connection not established.");
        }

        const allCustomers = await window.dbAPI.getCustomers();
        
        // 2. Filter the data based on the requested type
        let exportData = allCustomers;
        if (typeFilter !== 'all') {
            exportData = allCustomers.filter(c => (c.type || 'customer') === typeFilter);
        }

        if (exportData.length === 0) {
            alert('No partners found in this category to export.');
            return;
        }

        // 3. Flatten and map the data for Excel/CSV compatibility
        const csvRows = exportData.map(c => ({
            "Partner ID": c.id || c.docId || '',
            "Name": c.name || c.storeName || '',
            "Classification": (c.type || 'customer').toUpperCase(),
            "Phone Number": c.phone || '',
            "Alternative Phone": c.altPhone || '',
            "Email Address": c.email || '',
            "Billing Address": c.address || '',
            "State": c.state || '',
            "GSTIN": c.gstin || '',
            "PAN": c.pan || '',
            "Total Lifetime Spent": parseFloat(c.totalSpent || 0).toFixed(2),
            "Outstanding Dues": (parseFloat(c.dues || 0) + parseFloat(c.balance || 0)).toFixed(2),
            "Loyalty Points": parseInt(c.loyaltyPoints || c.loyaltyTokens || 0)
        }));

        // 4. Extract headers
        const headers = Object.keys(csvRows[0]);
        
        // 5. Convert to CSV string (safely handling commas inside names/addresses)
        const csvContent = [
            headers.join(','),
            ...csvRows.map(row => 
                headers.map(header => `"${String(row[header] || '').replace(/"/g, '""')}"`).join(',')
            )
        ].join('\n');

        // 6. Trigger Browser Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', `Mifela_${typeFilter.toUpperCase()}_Directory_Export_${Date.now()}.csv`);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (error) {
        console.error("Export error:", error);
        alert("Failed to export data: " + error.message);
    }
}


export async function exportInventoryToCSV(productsArray = []) {
    // Fallback to global cache if called directly from the UI without passing the array
    const dataToExport = productsArray.length > 0 ? productsArray : (window.localProductsCache || []);

    if (dataToExport.length === 0) {
        if (typeof showToast === 'function') showToast("Empty", "No inventory to export.", "warning");
        return;
    }

    const headers = ["Product Name", "SKU", "Barcode", "Cost", "Price", "MRP", "Stock Level", "Type", "Dealer Name"];
    
    const rows = dataToExport.map(p => [
        `"${(p.name || '').replace(/"/g, '""')}"`,
        `"${p.sku || ''}"`,
        `"${p.barcode || ''}"`,
        p.cost || 0,
        p.price || 0,
        p.mrp || 0,
        p.stockLevel || 0,
        `"${p.type || 'standard'}"`,
        `"${(p.dealerName || '').replace(/"/g, '""')}"`
    ].join(','));

    const csvContent = headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Inventory_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Alias for semantic imports
export const exportInventoryToSpreadsheet = exportInventoryToCSV; 


/**
 * Exports Transactions based on filtered range to .xlsx
 */
export async function exportTransactionsToCSV() {
    const rangeElement = DOM.transactions?.rangeDisplay || document.getElementById('transaction-range-select'); 
    const range = rangeElement ? rangeElement.value : 'month'; 

    showModal('Exporting...', `Preparing transaction export for: ${range}.`, 'info');

    const now = new Date();
    let startDate = new Date(0); 
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (range) {
        case 'today': startDate = today; break;
        case 'week': startDate = new Date(today.getTime() - (today.getDay() * 24 * 60 * 60 * 1000)); break;
        case 'month': startDate = new Date(today.getFullYear(), today.getMonth(), 1); break;
        case '3month': startDate = new Date(today.getFullYear(), today.getMonth() - 3, 1); break;
        case '6month': startDate = new Date(today.getFullYear(), today.getMonth() - 6, 1); break;
    }

    try {
        const q = query(transactionsRef, where("timestamp", ">=", startDate));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            showModal('Error', 'No transactions found for the selected date range.', 'message');
            return;
        }

        const data = [];

        querySnapshot.forEach(doc => {
            const tx = doc.data();
            const txDate = tx.timestamp?.toDate ? tx.timestamp.toDate().toLocaleString() : 'N/A';
            const type = tx.summary.paymentMethod === 'ADJUSTMENT' ? `Adjustment (${tx.summary.reason || 'N/A'})` : (tx.type || 'Sale');

            const items = Array.isArray(tx.items) ? tx.items : [];
            
            items.forEach(item => {
                data.push({
                    "Invoice ID": tx.invoiceId || tx.id,
                    "Date & Time": txDate,
                    "Transaction Type": type,
                    "Customer/Supplier Name": tx.customer?.name || '',
                    "Phone": tx.customer?.phone || '',
                    "Item Name": item.name,
                    "Qty": item.quantity,
                    "Unit Price": item.price,
                    "Tax Rate %": item.taxRate || 0,
                    "Invoice Subtotal": tx.summary.subtotal || 0,
                    "Invoice Discount": tx.summary.discount || 0,
                    "Invoice Tax": tx.summary.tax || 0,
                    "Invoice Total": tx.summary.total || 0,
                    "Payment Method": tx.summary.paymentMethod || 'CASH',
                    "Currency": tx.currency?.code || 'INR'
                });
            });
        });

        downloadExcel(data, "Ledger", `Transactions_${range}.xlsx`);
        showModal('Success', 'Export downloaded successfully.', 'success');

    } catch (error) {
        console.error("Error exporting transactions:", error);
        showModal('Error', 'Failed to export transactions.', 'message');
    }
}


/**
 * Exports Staff Payments to .xlsx
 */
export async function exportStaffPaymentsToCSV() {
    const rangeElement = DOM.staff?.exportRange || document.getElementById('staff-export-range');
    const range = rangeElement ? rangeElement.value : 'all';
    
    showModal('Exporting...', `Fetching staff payment history (${range})...`, 'info');
    
    const now = new Date();
    let minDate = null;
    let maxDate = null;
    
    if (range === 'this_month') {
        minDate = new Date(now.getFullYear(), now.getMonth(), 1);
        maxDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (range === 'last_month') {
        minDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        maxDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    }
    
    try {
        const q = collection(db, `artifacts/${appId}/stores/${storeId}/staff`);
        const staffSnap = await getDocs(q);

        if (staffSnap.empty) {
            showModal('Info', 'No staff records found.', 'message');
            return;
        }

        const data = [];
        let hasData = false;

        for (const staffDoc of staffSnap.docs) {
            const staff = staffDoc.data();
            
            const paymentsRef = collection(db, `artifacts/${appId}/stores/${storeId}/staff/${staffDoc.id}/payments`);
            const paySnap = await getDocs(paymentsRef);

            paySnap.forEach(payDoc => {
                const pay = payDoc.data();
                const payDate = new Date(pay.date);
                
                if (minDate && payDate < minDate) return;
                if (maxDate && payDate > maxDate) return;
                
                hasData = true;
                data.push({
                    "Staff Name": staff.name,
                    "Role": staff.role,
                    "Email": staff.email,
                    "Payment Date": payDate.toLocaleDateString(),
                    "Amount Paid": pay.amount || 0,
                    "Days Present": pay.daysPresent || 0,
                    "Daily Rate": pay.dailyRate || 0,
                    "Bonus": pay.bonus || 0,
                    "Deduction": pay.deduction || 0,
                    "Notes / Remarks": pay.notes || ''
                });
            });
        }

        if (!hasData) {
            showModal('Info', 'No payments found for the selected period.', 'message');
            return;
        }

        downloadExcel(data, "Payroll", `Staff_Payments_${range}.xlsx`);
        showModal('Success', 'Export downloaded successfully.', 'success');

    } catch (error) {
        console.error("Error exporting staff payments:", error);
        showModal('Error', 'Failed to export staff payments.', 'error');
    }
}


/**
 * ===================================================================
 * NEW: SPREADSHEET UPLOAD ENGINE
 * ===================================================================
 * Reads a standard Excel file (.xlsx, .xls) and returns a JSON array.
 * Import this into inventory.js to power your Bulk Upload UI.
 */
export async function parseSpreadsheetUpload(file) {
    return new Promise((resolve, reject) => {
        if (typeof XLSX === 'undefined') {
            return reject(new Error("Excel library (SheetJS) is missing. Ensure you are connected to the internet."));
        }
        
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // Convert spreadsheet rows into a cleanly formatted JSON array
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                resolve(jsonData);
            } catch (err) {
                reject(new Error("Failed to parse the Excel file. Please ensure it is not corrupted."));
            }
        };
        
        reader.onerror = () => reject(new Error("Failed to read the file from disk."));
        reader.readAsArrayBuffer(file);
    });
}