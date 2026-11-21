// electron/services/BackgroundVerificationScheduler.js
import { getKnex } from '../database/knex.js';
import { getHardwareFingerprint } from '../security/fingerprint.js';
import electronLog from 'electron-log';

export default class BackgroundVerificationScheduler {
    constructor(connectivityMonitor, mainWindow) {
        this.monitor = connectivityMonitor;
        this.mainWindow = mainWindow;
        this.isSyncing = false;

        // Listen for internet returning
        this.monitor.on('online', () => {
            // Debounce for 3 seconds to ensure connection stability
            setTimeout(() => this.runSilentVerification(), 3000);
        });

        // Run once on boot if online
        if (this.monitor.isOnline) {
            setTimeout(() => this.runSilentVerification(), 5000);
        }

        // Polling fallback every 6 hours while app is open
        setInterval(() => this.runSilentVerification(), 6 * 60 * 60 * 1000);
    }

    async runSilentVerification() {
        if (this.isSyncing || !this.monitor.isOnline) return;

        try {
            this.isSyncing = true;
            electronLog.info("📡 Starting silent background license verification...");

            const fingerprint = await getHardwareFingerprint();

            // Invoke the Firebase Callable Function directly via REST to avoid 
            // loading the massive Firebase SDK into the main Electron process
            const response = await fetch('https://asia-south1-mifela-pos-sqlite.cloudfunctions.net/verifyNodeLicense', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: { fingerprint } }) // Firebase Callable format
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || "Verification rejected by server.");
            }

            const body = await response.json();

            // Firebase Callables return HTTP 200 with { error: { message } } on failure
            if (body.error) {
                throw new Error(body.error.message || "Verification rejected by server.");
            }

            const { result } = body;

            if (result.success && result.payload && result.signature) {
                // Securely overwrite the SQLite license data using getKnex()
                const knex = getKnex();

                // Clear old and insert new verified payload
                await knex('licence_data').del();
                await knex('licence_data').insert({
                    id: result.payload.licenceId,
                    licence_payload: JSON.stringify(result.payload),
                    signature: result.signature,
                    last_verified_at: new Date().toISOString(),
                    next_verification_due: result.payload.nextVerificationDue,
                    status: 'ACTIVE'
                });

                electronLog.info("✅ Background verification successful. Next due: " + result.payload.nextVerificationDue);

                // If the app was locked in the UI, tell it to unlock
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('security:license-restored');
                }
            }

        } catch (error) {
            electronLog.error("🚨 Background verification failed:", error.message);
            // If the server explicitly rejected the license (e.g. revoked/refunded)
            // we update the local SQLite database to reflect the revoked status
            if (error.message.includes('revoked') || error.message.includes('expired')) {
                const knex = getKnex();
                await knex('licence_data').update({ status: 'REVOKED' });
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('security:license-revoked', error.message);
                }
            }
        } finally {
            this.isSyncing = false;
        }
    }
}