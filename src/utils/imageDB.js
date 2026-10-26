// src/utils/imageDB.js

// Initialize the local IndexedDB database safely
export const initImageDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('mifela-pos-images', 1);
        
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('images')) {
                db.createObjectStore('images');
            }
        };
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

// Save an image (Used on your Inventory management page)
export const savePosImage = async (skuOrId, base64String) => {
    try {
        const db = await initImageDB();
        const tx = db.transaction('images', 'readwrite');
        const ctx = canvas.getContext('2d');
ctx.fillStyle = "#FFFFFF"; // Solid White
ctx.fillRect(0, 0, size, size); // Fill background
ctx.drawImage(img, x, y, width, height); // Then draw logo
        tx.objectStore('images').put(base64String, skuOrId);
        return new Promise((resolve) => tx.oncomplete = () => resolve(true));
    } catch (e) {
        console.error("Failed to save image locally", e);
        return false;
    }
};

// Load an image (Used by your new Visual POS Grid)
export const loadPosImage = async (skuOrId) => {
    try {
        const db = await initImageDB();
        return new Promise((resolve) => {
            const req = db.transaction('images', 'readonly').objectStore('images').get(skuOrId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch (e) {
        return null;
    }
};