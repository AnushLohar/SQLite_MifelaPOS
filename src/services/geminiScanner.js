// src/services/geminiScanner.js

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// 🚀 UPGRADED: Exponential Backoff (Now extremely patient for the Free Tier)
async function fetchWithRetry(apiCall, maxRetries = 6, delayMs = 3000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await apiCall(); 
        } catch (error) {
            // 🚀 THE FIX: If the user clicked Cancel, STOP IMMEDIATELY and throw it up the chain!
            if (error.name === 'AbortError') {
                console.log("🛑 Scanner Audit Aborted by User.");
                throw error;
            }

            const is503 = error.message && error.message.includes('503');
            const is429 = error.message && error.message.includes('429');

            // If it's a server overload OR a rate limit, and we have retries left...
            if ((is503 || is429) && attempt < maxRetries) {
                const errCode = is429 ? '429 Rate Limit' : '503 Server Busy';
                console.warn(`🚦 ${errCode}. Retrying attempt ${attempt + 1} in ${delayMs/1000} seconds...`);
                
                await new Promise(resolve => setTimeout(resolve, delayMs));
                delayMs *= 1.5; // Wait slightly longer each time (3s, 4.5s, 6.7s, etc.)
            } else {
                throw error; // Out of retries or a different error, throw it to the UI
            }
        }
    }
}


export async function extractReceiptData(base64Image) {
    console.warn("AI Receipt Scanning is disabled in offline mode.");
    throw new Error("AI features require an active internet connection.");
}