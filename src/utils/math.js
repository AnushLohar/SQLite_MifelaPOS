/**
 * FINANCIAL MATH UTILITIES
 * Fixes JavaScript floating-point errors (e.g. 0.1 + 0.2 != 0.3)
 * by converting to integer cents for all intermediate calculations.
 */

// Helper: Standardize to 2 decimals
const roundToCents = (num) => Math.round(parseFloat(num || 0) * 100) / 100;

export const safeMath = {
    // Multiplies Price * Quantity (e.g. 19.99 * 3)
    // Usage: safeMath.multiply(19.99, 3) -> 59.97
    multiply: (amount, quantity) => {
        const a = Math.round(parseFloat(amount || 0) * 100);
        const q = parseFloat(quantity || 0); // Quantity can be float (e.g. 1.5kg)
        
        // If quantity is float, we multiply first then round the result
        return Math.round(a * q) / 100;
    },

    // Adds two currency amounts
    // Usage: safeMath.add(0.1, 0.2) -> 0.3
    add: (a, b) => {
        const v1 = Math.round(parseFloat(a || 0) * 100);
        const v2 = Math.round(parseFloat(b || 0) * 100);
        return Math.round(v1 + v2) / 100;
    },

    // Subtracts b from a
    // Usage: safeMath.subtract(10.00, 9.99) -> 0.01
    subtract: (a, b) => {
        const v1 = Math.round(parseFloat(a || 0) * 100);
        const v2 = Math.round(parseFloat(b || 0) * 100);
        return Math.round(v1 - v2) / 100;
    },

    // Divides a by b (Safe for currency)
    // Usage: safeMath.divide(10, 3) -> 3.33
    divide: (a, b) => {
         const v1 = Math.round(parseFloat(a || 0) * 100);
         const divisor = parseFloat(b || 1);
         if (divisor === 0) return 0;
         return Math.round(v1 / divisor) / 100;
    },

    // Calculate tax component from a generic total (Inclusive Tax)
    // Formula: Tax = Total - (Total / (1 + rate/100))
    // Example: Total 105, Tax 5% -> Base 100, Tax 5
    calculateTaxComponent: (total, taxRate) => {
        if (!taxRate || taxRate <= 0) return 0;
        const t = parseFloat(total || 0);
        const r = parseFloat(taxRate);
        
        // We use standard rounding for tax extraction
        const basePrice = t / (1 + (r / 100));
        return roundToCents(t - basePrice);
    },
    
    // Calculate tax on top of base (Exclusive Tax)
    // Example: Base 100, Tax 5% -> Tax 5
    calculateTaxAmount: (base, taxRate) => {
        const b = Math.round(parseFloat(base || 0) * 100);
        const r = parseFloat(taxRate || 0);
        const taxInCents = b * (r / 100);
        return Math.round(taxInCents) / 100;
    }
}