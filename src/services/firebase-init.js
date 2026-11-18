// src/services/firebase-init.js
// Lazy Firebase initialization — called once, cached forever.
// Config is public (as per Firebase docs: web API keys are safe to embed).
// Firestore Security Rules are the actual access-control layer.

let _app = null;
let _db = null;
let _initPromise = null;

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", // ← REPLACE with your real key
    authDomain: "mifela-pos-sqlite.firebaseapp.com",
    projectId: "mifela-pos-sqlite",
    storageBucket: "mifela-pos-sqlite.firebasestorage.app",
    messagingSenderId: "19471193085",
    appId: "1:19471193085:web:2da2bd605292e4aad5bf94"
};

/**
 * Initialize Firebase lazily. Returns { app, db }.
 * Safe to call multiple times — only initializes once.
 */
export async function ensureFirebase() {
    if (_app && _db) return { app: _app, db: _db };

    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
        try {
            const { initializeApp, getApps, getApp } = await import("firebase/app");
            const { getFirestore } = await import("firebase/firestore");

            // Re-use existing app if already initialized by another module
            _app = getApps().length > 0 ? getApp() : initializeApp(FIREBASE_CONFIG);
            _db = getFirestore(_app);

            // Expose globally for legacy code that uses window.db
            window.fbApp = _app;
            window.db = _db;

            console.log("✅ Firebase initialized successfully.");
            return { app: _app, db: _db };
        } catch (err) {
            console.error("❌ Firebase initialization failed:", err);
            _initPromise = null; // Allow retry
            throw err;
        }
    })();

    return _initPromise;
}

/**
 * Returns true if Firebase is currently initialized.
 */
export function isFirebaseReady() {
    return !!_app && !!_db;
}
