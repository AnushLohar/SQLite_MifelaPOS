// src/services/usage.js

export async function checkScannerLimit() {
    const today = new Date().toISOString().split('T')[0]; 
    const localUsageKey = `mifela_ai_scans_${today}`;
    
    // Check Daily Limit (e.g., 50 Scans) via Local Storage
    let scansToday = parseInt(localStorage.getItem(localUsageKey)) || 0;

    if (scansToday >= 50) {
        return { allowed: false, reason: "Daily AI scanning limit reached. Please try again tomorrow.", currentScans: scansToday, limit: 50 };
    }

    return { allowed: true, currentScans: scansToday, limit: 50, usageRef: localUsageKey };
}

export async function incrementScannerUsage(usageKey) {
    if (!usageKey) return;
    let scansToday = parseInt(localStorage.getItem(usageKey)) || 0;
    localStorage.setItem(usageKey, scansToday + 1);
}