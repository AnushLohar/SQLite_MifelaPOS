/**
 * Generates a short, unique ID for invoices.
 * Format: INV-YYYYMMDD-XXXX (e.g., INV-20231025-A1B2)
 */
export function generateInvoiceId() {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, ''); // 20231025
    
    // Generate 4 random characters (A-Z, 0-9)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let randomPart = '';
    for (let i = 0; i < 4; i++) {
        randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return `INV-${dateStr}-${randomPart}`;
}

export function generateCustomerId() {
    // Fallback for local customers without phone numbers
    // (Verified customers use CUST-{Phone})
    return `LOCAL-CUST-${Date.now().toString().slice(-6)}`;
}

export function generateMerchantId(phone = '') {
    // 1. Clean the phone number
    const rawPhone = String(phone).replace(/\D/g, '');
    
    // 2. If a valid phone exists, ALWAYS generate the deterministic Hash ID!
    if (rawPhone.length >= 10) {
        let normalizedPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
        let hash = 0x811c9dc5;
        for (let i = 0; i < normalizedPhone.length; i++) {
            hash ^= normalizedPhone.charCodeAt(i);
            hash = (hash * 0x01000193) >>> 0;
        }
        return `MERCH-${hash.toString(36).toUpperCase().padStart(6, '0')}`;
    }
    
    // 3. Fallback ONLY if absolutely no phone number was provided
    return `DUMMY-MERCH-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random()*1000)}`;
}

/**
 * Tiny ID generator (URL-safe, 6-char default)
 * Used for internal PO references
 */
export function nanoid(size = 6) {
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let id = '';
    for (let i = 0; i < size; i++) {
        id += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return id;
}