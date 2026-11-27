// shim for better-sqlite3 to reroute to native module
// This allows knex.js to resolve the encrypted driver in test environments

// Export a default knex-compatible module
export default function() {
  // In a real environment, this would be the native better-sqlite3
  // For testing purposes, we just export a minimal interface
  return {
    // Minimal knex backend interface
    // better-sqlite3 exposes this via its create method
  };
}