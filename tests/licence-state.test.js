import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

// Mock electron so knex.js can load in plain Node
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() }
}));

// Mock signature verification so state transitions can be tested without a key
vi.mock('../electron/security/licenseVerifier.js', () => ({
  LicenseManager: {
    verifySignature: () => true
  }
}));

import { initKnex, getKnex } from '../electron/database/knex.js';
import LicenceStateManager from '../electron/services/LicenceStateManager.js';

const dbFile = path.join(os.tmpdir(), `mifela-test-${Date.now()}.db`);

describe('LicenceStateManager (real SQLite)', () => {
  beforeEach(async () => {
    await initKnex(dbFile);
    const knex = getKnex();
    if (!(await knex.schema.hasTable('licence_data'))) {
      await knex.schema.createTable('licence_data', (table) => {
        table.string('id').primary();
        table.text('licence_payload').notNullable();
        table.text('signature').notNullable();
        table.timestamp('last_verified_at');
        table.timestamp('next_verification_due');
        table.string('status').defaultTo('UNACTIVATED');
      });
    }
  });

  afterEach(async () => {
    try { await getKnex()('licence_data').del(); } catch (e) { }
  });

  async function insertLicence(row) {
    const knex = getKnex();
    const nextDue = row.next_verification_due || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    await knex('licence_data').insert({
      id: row.id || 'lic-1',
      licence_payload: JSON.stringify({
        status: row.status || 'ACTIVE',
        nextVerificationDue: nextDue,
        subscriptionExpiryDate: row.subscriptionExpiryDate || null
      }),
      signature: row.signature || 'sig',
      last_verified_at: row.last_verified_at || new Date().toISOString(),
      next_verification_due: nextDue,
      status: row.status || 'ACTIVE'
    });
  }

  it('returns ACTIVE for a valid licence within the verification window', async () => {
    await insertLicence({ status: 'ACTIVE' });
    const state = await LicenceStateManager.evaluateCurrentState();
    expect(state).toBe('ACTIVE');
  });

  it('returns REVOKED when status is REVOKED', async () => {
    await insertLicence({ status: 'REVOKED' });
    const state = await LicenceStateManager.evaluateCurrentState();
    expect(state).toBe('REVOKED');
  });

  it('returns VERIFICATION_PENDING when the deadline has passed', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await insertLicence({ next_verification_due: past });
    const state = await LicenceStateManager.evaluateCurrentState();
    expect(state).toBe('VERIFICATION_PENDING');
  });

  it('returns VERIFICATION_DUE when the deadline is within 7 days', async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    await insertLicence({ next_verification_due: soon });
    const state = await LicenceStateManager.evaluateCurrentState();
    expect(state).toBe('VERIFICATION_DUE');
  });

  it('returns UNACTIVATED when there is no licence record', async () => {
    const state = await LicenceStateManager.evaluateCurrentState();
    expect(state).toBe('UNACTIVATED');
  });
});