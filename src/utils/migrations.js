
import { appId, getStoreId, getUserSettingsRef } from '../store/state.js';

/**
 * MIGRATION 1: BACKFILL LOCATION ID
 */
export async function runDataMigration() {
    const storeId = getStoreId();
    
    if (!storeId) {
        console.error("❌ Migration Failed: You must be logged in first.");
        alert("Please log in to the app, then run this command again.");
        return;
    }

    const collections = ['transactions', 'products', 'customers', 'logs'];
    console.log(`🚀 Starting Migration for Store: ${storeId}...`);
    // alert("Migration Started. Check Console (F12) for progress.");

    let totalUpdated = 0;

    for (const colName of collections) {
        console.log(`\n📂 Checking collection: ${colName}...`);
        const colRef = collection(db, `artifacts/${appId}/stores/${storeId}/${colName}`);
        
        try {
            const snapshot = await getDocs(colRef);
            let batch = writeBatch(db);
            let operationCount = 0;
            let colUpdated = 0;

            for (const docSnap of snapshot.docs) {
                const data = docSnap.data();
                
                if (!data.locationId) {
                    batch.update(docSnap.ref, { locationId: 'main' });
                    operationCount++;
                    colUpdated++;
                    totalUpdated++;
                }

                if (operationCount >= 400) {
                    await batch.commit();
                    batch = writeBatch(db);
                    operationCount = 0;
                    console.log(`   ... committed batch of updates.`);
                }
            }

            if (operationCount > 0) {
                await batch.commit();
            }

            console.log(`✅ Finished ${colName}: Updated ${colUpdated} documents.`);

        } catch (error) {
            console.error(`❌ Error migrating ${colName}:`, error);
        }
    }

    console.log(`\n🎉 MIGRATION COMPLETE! Total Docs Updated: ${totalUpdated}`);
    if (totalUpdated > 0) {
        alert(`Migration Complete! ${totalUpdated} documents were updated. Reload the app.`);
    } else {
        console.log("No documents needed migration.");
    }
}

/**
 * MIGRATION 2: SYNC MERCHANT DIRECTORY (Fixes Auto-fill)
 * Reads private store settings and updates the public directory_merchants collection.
 * Ensures Store Name, ID, Phone, and GSTIN are globally fetchable.
 */
export async function syncMerchantDirectory() {
    const userSettingsRef = getUserSettingsRef();
    const currentStoreId = getStoreId();
    
    if (!userSettingsRef) {
        console.error("Sync Failed: Settings reference is missing. Are you logged in?");
        alert("Please log in first.");
        return;
    }

    console.log("🔄 Syncing Directory Data...");
    
    try {
        // 1. Get Private Settings
        const snap = await getDoc(userSettingsRef);
        if (!snap.exists()) {
            console.error("No settings found in:", userSettingsRef.path);
            return;
        }

        const settings = snap.data();
        const merchantId = settings.merchantId;

        if (!merchantId) {
            console.error("No Merchant ID found in settings. Cannot sync.");
            alert("Error: Your store has no Merchant ID. Contact support.");
            return;
        }

        // 2. Prepare Public Data (Comprehensive)
        // These fields match what inventory.js looks for in the global lookup
        const publicData = {
            merchantId: merchantId,       // ID used for lookup
            storeId: currentStoreId,      // ID used for networking
            storeName: settings.storeName || "Unknown Store", // Auto-fills 'Dealer Name'
            phone: settings.storePhone || "",                 // Auto-fills 'Dealer Phone'
            email: settings.storeEmail || "",
            gstin: settings.storeTaxId || "",                 // Auto-fills 'Dealer GSTIN' (Mapped from Tax ID)
            updatedAt: new Date().toISOString()
        };

        // 3. Update Public Directory
        const dirRef = doc(db, `artifacts/${appId}/directory_merchants/${merchantId}`);
        await setDoc(dirRef, publicData, { merge: true });

        console.log("✅ Directory Synced:", publicData);
        alert("Success! Your Store Name, GSTIN, and Phone are now visible to other dealers.");

    } catch (error) {
        console.error("Sync Failed:", error);
        alert("Sync Failed: " + error.message);
    }
}

// Expose to window immediately upon module load
try {
    window.runMigration = runDataMigration;
    window.syncDirectory = syncMerchantDirectory;
    console.log("🛠️ Migration Tools Loaded: window.runMigration(), window.syncDirectory()");
} catch (e) {
    console.warn("Could not expose migration tools to window.");
}