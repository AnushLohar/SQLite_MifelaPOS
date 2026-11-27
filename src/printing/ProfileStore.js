// src/printing/ProfileStore.js
// Async adapter wrapping mifela_printer_profiles_v2 localStorage
// Enables future migration to Electron userData IPC with zero changes to UI or PrinterEngine

// Use the global test mock if available (Vitest jsdom environment), otherwise browser localStorage
const STORAGE_KEY = 'mifela_printer_profiles_v2';

export async function loadProfiles() {
  // Check if running in a test environment with global mock first
  if (typeof window !== 'undefined' && window._testLocalStorage) {
    const raw = window._testLocalStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  }

  // Fallback to browser localStorage
  if (typeof window !== 'undefined') {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  }

  // Fallback for Node/test environments without mock
  return {};
}

export async function saveProfiles(profiles) {
  // In test environments, store in global mock regardless of window presence
  if (typeof global !== 'undefined' && global._testLocalStorage && typeof global._testLocalStorage.setItem === 'function') {
    try {
      global._testLocalStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    } catch (e) {
      console.warn('Failed to save printer profiles to global mock:', e);
    }
    return;
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    } catch (e) {
      console.warn('Failed to save printer profiles:', e);
    }
  }
}