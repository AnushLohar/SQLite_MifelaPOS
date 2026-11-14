// Hardware Fingerprint Lookup - Background Process
// This script gets the hardware fingerprint and queries Firestore for associated user details
// Designed to run in the Electron app browser context
// Follows the same patterns as src/app.js for Firestore initialization

/**
 * Gets the hardware fingerprint from the Electron runtime
 * @returns {Promise<string>} The hardware fingerprint or 'UNKNOWN_NODE'
 */
async function getHardwareFingerprint() {
    try {
        if (window.electronAPI && typeof window.electronAPI.getMachineId === 'function') {
            const fingerprint = await window.electronAPI.getMachineId();
            return fingerprint || 'UNKNOWN_NODE';
        }
        console.warn("⚠️ Electron API not available, using fallback fingerprint");
        return 'LOCAL_FALLBACK_' + Date.now();
    } catch (error) {
        console.error("❌ Failed to get hardware fingerprint:", error);
        return 'UNKNOWN_NODE';
    }
}

/**
 * Queries Firestore for user details associated with the hardware fingerprint
 * Uses the same initialization pattern as src/app.js
 * @param {string} fingerprint - The hardware fingerprint to look up
 * @returns {Promise<Object|null>} The user details document or null if not found
 */
async function fetchUserDetailsFromFirestore(fingerprint) {
    try {
        const { getFirestore, doc, getDoc } = await import("firebase/firestore");

        let fbDb;
        let fbApp;

        // Try to use the pre-initialized Firebase app from window context (set by app.js)
        if (typeof window !== 'undefined' && window.fbApp) {
            fbApp = window.fbApp;
            console.log("📦 Using pre-initialized Firebase app from window context");
        }

        // If we have an app but not the db, initialize Firestore
        if (fbApp && typeof getFirestore === 'function') {
            // Check if db is already globally available (from app.js module scope made global)
            if (typeof db !== 'undefined' && db && typeof db !== 'function') {
                fbDb = db;
                console.log("📦 Using pre-initialized Firestore db from window context");
            } else {
                fbDb = getFirestore(fbApp, {
                    experimentalForceLongPolling: true,
                    useFetchStreams: false
                });
                console.log("📦 Initialized Firestore with Long-Polling mode");
            }
        } else {
            // Initialize with the app's firebaseConfig (same as app.js)
            const { initializeApp } = await import("firebase/app");
            const firebaseConfig = {
                apiKey: "AIzaSyB2n1fa2T7gYwWRmoqr674YW1rXlujCOXM",
                authDomain: "mifela-pos-sqlite.firebaseapp.com",
                projectId: "mifela-pos-sqlite",
                storageBucket: "mifela-pos-sqlite.firebasestorage.app",
                messagingSenderId: "19471193085",
                appId: "1:19471193085:web:2da2bd605292e4aad5bf94"
            };
            fbApp = initializeApp(firebaseConfig);
            // Make globally available for app context consistency
            window.fbApp = fbApp;

            fbDb = getFirestore(fbApp, {
                experimentalForceLongPolling: true,
                useFetchStreams: false
            });
        }

        // Query the provisioned_nodes collection by fingerprint document ID
        // This matches the exact pattern from app.js lines 2237-2266
        const nodeDocRef = doc(fbDb, "provisioned_nodes", fingerprint);
        const nodeSnap = await getDoc(nodeDocRef);

        if (!nodeSnap.exists()) {
            console.log("ℹ️ No provisioned node found for fingerprint:", fingerprint);
            return null;
        }

        const nodeData = nodeSnap.data();

        // Extract relevant user details (matches the field extraction from app.js)
        const userDetails = {
            fingerprint: fingerprint,
            storeName: nodeData.storeName || 'N/A',
            ownerName: nodeData.ownerName || 'N/A',
            email: nodeData.email || 'N/A',
            contact: nodeData.contact || nodeData.phone || 'N/A',
            address: nodeData.address || 'N/A',
            state: nodeData.state || 'N/A',
            gstin: nodeData.gstin || nodeData.taxId || 'N/A',
            currency: nodeData.currency || 'INR',
            taxRate: nodeData.taxRate !== undefined ? nodeData.taxRate : 0,
            status: nodeData.status || 'UNKNOWN',
            publicKey: nodeData.publicKey || 'N/A',
            verificationTokenProvided: nodeData.verificationToken ? 'YES' : 'NO',
            createdAt: nodeData.createdAt ? new Date(nodeData.createdAt).toDateString() : 'N/A',
            lastUpdated: nodeData.lastUpdated ? new Date(nodeData.lastUpdated).toDateString() : 'N/A'
        };

        console.log("✅ User details fetched from Firestore for fingerprint:", fingerprint);
        return userDetails;

    } catch (error) {
        console.error("❌ Failed to fetch user details from Firestore:", error);
        return null;
    }
}

/**
 * Main function: Gets hardware fingerprint and fetches user details from Firestore
 * @returns {Promise<Object>} Result object with fingerprint and user details
 */
async function lookupHardwareFingerprint() {
    console.log("🔍 Starting hardware fingerprint lookup...");
    console.log("=".repeat(60));

    const fingerprint = await getHardwareFingerprint();
    console.log("📱 Hardware fingerprint:", fingerprint);

    const userDetails = await fetchUserDetailsFromFirestore(fingerprint);

    const result = {
        success: userDetails !== null,
        fingerprint: fingerprint,
        userDetails: userDetails,
        message: userDetails
            ? `✅ Found user details for fingerprint ${fingerprint}`
            : `ℹ️ No user found for fingerprint ${fingerprint}. The terminal may not be provisioned.`
    };

    console.log("=".repeat(60));
    return result;
}

// Execute the lookup automatically when the script loads
// This runs in background without user interaction
// Follows the pattern: run after DOMContentLoaded or immediately if electronAPI available
if (typeof window !== 'undefined') {
    // Wait a brief moment to ensure Electron APIs are ready, then run
    if (window.electronAPI) {
        (async () => {
            try {
                const result = await lookupHardwareFingerprint();

                // Output summary to console (visible in Electron DevTools console)
                if (result.userDetails) {
                    console.log("\n--- PROVISIONED TERMINAL DETAILS ---");
                    console.log(`Store:    ${result.userDetails.storeName}`);
                    console.log(`Owner:    ${result.userDetails.ownerName}`);
                    console.log(`Email:    ${result.userDetails.email}`);
                    console.log(`Contact:  ${result.userDetails.contact}`);
                    console.log(`Address:  ${result.userDetails.address}`);
                    console.log(`State:    ${result.userDetails.state}`);
                    console.log(`GSTIN:    ${result.userDetails.gstin}`);
                    console.log(`Status:   ${result.userDetails.status}`);
                    console.log("----------------------------------------\n");
                } else {
                    console.log("\n--- TERMINAL NOT PROVISIONED ---");
                    console.log("This terminal has not been licensed yet.");
                    console.log("Run the activation flow to provision this device.");
                    console.log("----------------------------------------\n");
                }
            } catch (error) {
                console.error("❌ Hardware fingerprint lookup failed:", error);
            }
        })();
    } else {
        // Poll until electronAPI is available (for cases where it loads async)
        let attempts = 0;
        const maxAttempts = 50; // ~5 seconds at 100ms intervals

        const checkAndRun = () => {
            if (window.electronAPI && attempts < maxAttempts) {
                attempts++;
                (async () => {
                    try {
                        const result = await lookupHardwareFingerprint();
                        if (result.userDetails) {
                            console.log("\n--- PROVISIONED TERMINAL DETAILS ---");
                            console.log(`Store:    ${result.userDetails.storeName}`);
                            console.log(`Owner:    ${result.userDetails.ownerName}`);
                            console.log(`Email:    ${result.userDetails.email}`);
                            console.log(`Contact:  ${result.userDetails.contact}`);
                            console.log(`Address:  ${result.userDetails.address}`);
                            console.log(`State:    ${result.userDetails.state}`);
                            console.log(`GSTIN:    ${result.userDetails.gstin}`);
                            console.log(`Status:   ${result.userDetails.status}`);
                            console.log("----------------------------------------\n");
                        } else {
                            console.log("\n--- TERMINAL NOT PROVISIONED ---");
                            console.log("This terminal has not been licensed yet.");
                            console.log("Run the activation flow to provision this device.");
                            console.log("----------------------------------------\n");
                        }
                    } catch (error) {
                        console.error("❌ Hardware fingerprint lookup failed:", error);
                    }
                })();
            } else if (attempts >= maxAttempts) {
                console.warn("⚠️ electronAPI not available after max attempts - running with fallback fingerprint");
                (async () => {
                    try {
                        // Use fallback fingerprint
                        const fallbackFp = 'LOCAL_FALLBACK_' + Date.now();
                        const userDetails = await fetchUserDetailsFromFirestore(fallbackFp);
                        if (userDetails) {
                            console.log("\n--- PROVISIONED TERMINAL DETAILS (Fallback) ---");
                            console.log(`Store:    ${userDetails.storeName}`);
                            console.log(`Owner:    ${userDetails.ownerName}`);
                            console.log("----------------------------------------\n");
                        } else {
                            console.log("\n--- NO PROVISIONED NODE FOUND (Fallback) ---");
                            console.log("No user found even with fallback fingerprint.");
                            console.log("The terminal needs to be licensed first.");
                            console.log("----------------------------------------\n");
                        }
                    } catch (error) {
                        console.error("❌ Fallback lookup failed:", error);
                    }
                })();
            }
        };

        const intervalId = setInterval(() => {
            checkAndRun();
            if (window.electronAPI) {
                clearInterval(intervalId);
            }
        }, 100);
    }
}

// Also export for programmatic use (e.g., if loaded as a module in a test environment)
module.exports = { getHardwareFingerprint, fetchUserDetailsFromFirestore, lookupHardwareFingerprint };