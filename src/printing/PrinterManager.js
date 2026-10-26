import { MediaProfiles, LabelTemplates, LabelLayoutEngine } from './PrinterEngine.js';
import { TSCAdapter } from './adapters/TSCAdapter.js';

export class PrinterManager {
    static async printLabel(printerProfile, mediaId, labelData, quantity) {
        try {
            if (!printerProfile.name && printerProfile.connection?.type !== 'network') {
                throw new Error("No printer selected.");
            }

            const mediaProfile = MediaProfiles[mediaId] || MediaProfiles['label_50x25'];
            const template = LabelTemplates[mediaProfile.templateId];

            // 1. Process Layout Math (Convert mm to absolute dots)
            const layoutEngine = new LabelLayoutEngine(printerProfile);
            const renderTree = layoutEngine.generateRenderTree(template, labelData);

            // 2. Translate to TSPL (TSC/Generic Thermal Commands)
            const adapter = new TSCAdapter(printerProfile);
            const job = adapter.generatePrintJob(renderTree, quantity, mediaProfile);
            console.log("TSPL PAYLOAD:\n", job.payload);
            // 3. Spool to Hardware
            if (job.type === 'RAW' && window.electronAPI && typeof window.electronAPI.printRaw === 'function') {
                const result = await window.electronAPI.printRaw({
                    connection: printerProfile.connection || { type: 'os', address: printerProfile.name },
                    data: job.payload
                });

                if (!result.success) throw new Error(result.error);
                return true;
            } else {
                throw new Error("Electron raw print API is not available.");
            }
        } catch (error) {
            console.error("Spooling Error:", error);
            throw error;
        }
    }
}