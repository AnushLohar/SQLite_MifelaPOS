# Proposed Phase 2 Plan: Database Security & Enterprise Reliability

## Goal
Elevate `SQLite_MifelaPOS` to enterprise-grade data security and operational resilience by implementing SQLite encryption at rest, robust schema migration versioning, and high-risk POS flow test coverage.

---

## Track 1: SQLite Database Encryption at Rest
- **Objective:** Encrypt local SQLite databases to protect merchant inventory, sales transactions, and customer data against physical theft or unauthorized disk access.
- **Implementation Strategy:**
  1. **Dependency & ABI Rebuild:** Integrate `better-sqlite3-multiple-ciphers` (or equivalent SQLCipher-backed SQLite wrapper compatible with Electron's ABI).
  2. **Key Generation & OS Keychain Storage:** Generate a cryptographically secure 256-bit encryption key on first launch. Store and retrieve the key securely using Electron's built-in `safeStorage` API (leveraging macOS Keychain / Windows DPAPI / Linux Secret Service). Never hardcode or store plaintext keys on disk.
  3. **Migration of Existing Databases:** Implement an automatic migration routine on startup:
     - Check if existing unencrypted `.sqlite` file exists.
     - If yes, take a mandatory pre-migration backup (`database.sqlite.bak`).
     - Open unencrypted database, attach new encrypted database, execute `sqlcipher_export('main')`, and swap files atomically.

---

## Track 2: Versioned Schema Migrations & Rollback Safety
- **Objective:** Replace ad-hoc database initialization with predictable, versioned schema management.
- **Implementation Strategy:**
  1. **Version Tracking:** Utilize SQLite's built-in `PRAGMA user_version` alongside a dedicated `schema_migrations` ledger table.
  2. **Transactional Migration Runner:** Write sequential migration scripts (`001_initial.sql`, `002_indexes.sql`, etc.) executed within database transactions.
  3. **Rollback & Backup Safety:** Before executing any migration step, automatically create a timestamped snapshot backup in `.planning/backups/` or user data directory. If any migration fails, roll back the transaction and restore from snapshot.

---

## Track 3: High-Risk POS Test Suite Expansion
- **Objective:** Ensure zero regression in core financial, transactional, and migration pathways.
- **Implementation Strategy:**
  1. **Billing & GST Calculations:** Add unit tests verifying tax splits, item discounts, rounding rules, and invoice ID generation.
  2. **Stock Deduction & Ledger Concurrency:** Test concurrent sale processing and insufficient stock rollback guarantees in `db:processSale`.
  3. **Migration Upgrades:** Test smooth upgrades from legacy unencrypted/unversioned SQLite structures to encrypted versioned schemas.
  4. **IPC / Preload Contract Smoke Tests:** Verify IPC channel request/response contracts (`{ success, data, error }`) across preload bridges.

---
*Ready for user review before plan approval and task execution.*
