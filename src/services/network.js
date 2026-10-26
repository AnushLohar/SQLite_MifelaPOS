// src/services/network.js

import { showToast } from '../utils/dom.js';

// --- State ---
let isOffline = !navigator.onLine;

// --- Constants ---
const BANNER_ID = 'mifela-offline-banner';

/**
 * Initializes the network monitoring service.
 * Call this once at app startup.
 */
export function initNetworkMonitoring() {
    console.log("📡 Initializing Network Monitor...");
    
   
}

/**
 * Returns current network state
 */
export function getNetworkStatus() {
    return navigator.onLine ? 'online' : 'offline';
}

