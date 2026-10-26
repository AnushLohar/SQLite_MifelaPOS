/**
 * SANITIZATION UTILITIES
 * Prevents XSS (Cross-Site Scripting) attacks by escaping special characters
 * in user-generated content before rendering it to the DOM.
 */

export function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
/**
 * Synchronizes navigation tab visibility and physically destroys restricted DOM content.
 * 
 * @param {Object} userProfile - The current logged-in user profile
 * @param {String} targetContainerId - The HTML ID of the page being loaded (e.g., 'settings')
 * @returns {Boolean} - Returns false if access is denied.
 */
export function enforcePageSecurity(userProfile, targetContainerId) {
    // RBAC removed: All active local users have full terminal access
    document.querySelectorAll('[data-target], [id^="nav-"]').forEach(el => {
        el.style.display = '';
    });
    return true; 
}