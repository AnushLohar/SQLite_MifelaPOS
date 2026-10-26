
import { getCustomersRef, getProductsRef, getTransactionsRef, appId, getStoreId } from '../store/state.js';


// 1. Exact same hashing algorithm to ensure perfect matching
const generateSafeId = (str) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return `MERCH-${hash.toString(36).toUpperCase().padStart(6, '0')}`;
};

// 2. The Phone Normalizer (Strips spaces, dashes, handles 0 or +91 prefixes)
const normalizePhoneTo10Digits = (rawPhone) => {
    if (!rawPhone) return null;
    let digits = String(rawPhone).replace(/\D/g, ''); // Strip everything but numbers
    if (digits.length < 10) return null;
    return digits.slice(-10); // Always grab exactly the last 10 digits
};

export async function runDirectoryCleanup(onProgress) {
    if (onProgress) onProgress("Starting Directory Analysis...");

    try {
        const customersRef = getCustomersRef();
        const productsRef = getProductsRef();
        const transactionsRef = getTransactionsRef();
        const currentAppId = typeof window !== 'undefined' && window.__app_id ? window.__app_id : appId;
        const globalDirRef = collection(db, `artifacts/${currentAppId}/directory_merchants`);

        // 1. Fetch all local customers/dealers
        if (onProgress) onProgress("Fetching all dealers...");
        const snap = await getDocs(customersRef);
        const allDealers = snap.docs.map(d => ({ docId: d.id, ...d.data() }));

        // 2. Group by Normalized Phone Number
        const groups = {};
        const noPhoneDealers = [];

        allDealers.forEach(dealer => {
            const rawPhone = dealer.phone || dealer.dealerPhone || '';
            const norm10 = normalizePhoneTo10Digits(rawPhone);

            if (norm10) {
                if (!groups[norm10]) groups[norm10] = [];
                groups[norm10].push(dealer);
            } else {
                noPhoneDealers.push(dealer);
            }
        });

        // 3. Process Groups and Merge
        const batch = writeBatch(db);
        let operationsCount = 0;
        let mergedCount = 0;

        // Helper to commit batches safely (Firestore limit is 500 per batch)
        const commitBatchIfFull = async () => {
            if (operationsCount >= 450) {
                if (onProgress) onProgress("Committing batch chunk to database...");
                await batch.commit();
                operationsCount = 0;
            }
        };

        for (const [norm10, duplicates] of Object.entries(groups)) {
            // Only process if they don't have the exact right ID, or if there are duplicates
            const correctHashId = generateSafeId(`91${norm10}`);
            const needsFixing = duplicates.length > 1 || duplicates[0].id !== correctHashId;

            if (needsFixing) {
                mergedCount++;
                
                // A. Merge data (Take the longest/most complete strings from the duplicates)
                let masterName = '';
                let masterGstin = '';
                let masterPan = '';
                const oldIdsToReplace = [];

                duplicates.forEach(d => {
                    oldIdsToReplace.push(d.docId);
                    if ((d.name || '').length > masterName.length) masterName = d.name;
                    if ((d.gstin || '').length > masterGstin.length) masterGstin = d.gstin;
                    if ((d.pan || '').length > masterPan.length) masterPan = d.pan;
                });

                const officialPhoneWith91 = `+91${norm10}`;

                // B. Write the Perfect Master Record to Local Ledger
                const masterLocalRef = doc(customersRef, correctHashId);
                batch.set(masterLocalRef, {
                    id: correctHashId,
                    name: masterName || 'Unknown Dealer',
                    type: 'dealer',
                    phone: officialPhoneWith91,
                    gstin: masterGstin,
                    pan: masterPan,
                    updatedAt: new Date()
                }, { merge: true });
                operationsCount++;

                // C. Write to Global Directory
                const masterGlobalRef = doc(globalDirRef, correctHashId);
                batch.set(masterGlobalRef, {
                    merchantId: correctHashId,
                    name: masterName || 'Unknown Dealer',
                    storeName: masterName || 'Unknown Dealer',
                    type: 'dealer',
                    phone: officialPhoneWith91,
                    gstin: masterGstin,
                    pan: masterPan,
                    updatedAt: new Date()
                }, { merge: true });
                operationsCount++;

                // D. Update all Products that used the old IDs
                for (const oldId of oldIdsToReplace) {
                    if (oldId === correctHashId) continue; // Don't delete the master if it already existed

                    if (onProgress) onProgress(`Relinking products for ${masterName}...`);
                    const pQuery = query(productsRef, where("dealerId", "==", oldId));
                    const pSnap = await getDocs(pQuery);
                    
                    pSnap.forEach(pDoc => {
                        batch.update(doc(productsRef, pDoc.id), {
                            dealerId: correctHashId,
                            dealerPhone: officialPhoneWith91
                        });
                        operationsCount++;
                    });

                    // E. Update all Transactions that used the old IDs
                    const tQuery = query(transactionsRef, where("customer.id", "==", oldId));
                    const tSnap = await getDocs(tQuery);
                    
                    tSnap.forEach(tDoc => {
                        batch.update(doc(transactionsRef, tDoc.id), {
                            "customer.id": correctHashId,
                            "customer.phone": officialPhoneWith91
                        });
                        operationsCount++;
                    });

                    // F. Delete the Old Duplicate Record
                    batch.delete(doc(customersRef, oldId));
                    operationsCount++;
                    
                    await commitBatchIfFull();
                }
            }
        }

        // Final Commit
        if (operationsCount > 0) {
            if (onProgress) onProgress("Committing final changes...");
            await batch.commit();
        }

        if (onProgress) onProgress(`✅ Cleanup Complete! Merged & fixed ${mergedCount} dealer groups.`);
        return { success: true, mergedCount };

    } catch (error) {
        console.error("Cleanup failed:", error);
        if (onProgress) onProgress(`❌ Error: ${error.message}`);
        return { success: false, error };
    }
}