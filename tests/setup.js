// tests/setup.js
// Test setup file for vitest with jsdom environment

// Set up global mocks before any tests run
global.localStorage = {
  store: {},
  getItem(key) {
    if (global._testLocalStorage && global._testLocalStorage.store[key] !== undefined) {
      return global._testLocalStorage.store[key];
    }
    return this.store[key] || null;
  },
  setItem(key, value) {
    this.store[key] = value;
    if (global._testLocalStorage) {
      global._testLocalStorage.store[key] = value;
    }
  },
  removeItem(key) {
    delete this.store[key];
    if (global._testLocalStorage) {
      delete global._testLocalStorage.store[key];
    }
  },
  clear() { this.store = {}; if (global._testLocalStorage) global._testLocalStorage.store = {}; },
};

global.window = {
  electronAPI: {
    printRaw: async (options) => ({ success: true }),
  },
  localStorage: global.localStorage, // alias for code that accesses window.localStorage directly
};

global._testLocalStorage = {
  store: {},
  getItem(key) {
    if (global._testLocalStorage && global._testLocalStorage.store[key] !== undefined) {
      return global._testLocalStorage.store[key];
    }
    return null;
  },
  setItem(key, value) {
    global._testLocalStorage.store[key] = value;
  },
  removeItem(key) {
    delete global._testLocalStorage.store[key];
  },
};

// Clean up after each test
beforeEach(() => {
  global._testLocalStorage = { store: {} };
  localStorage.removeItem('mifela_printer_profiles_v2');
});

afterEach(() => {
  delete global._testLocalStorage;
});