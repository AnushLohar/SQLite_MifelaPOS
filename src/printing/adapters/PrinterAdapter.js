//src/printing/adapters/PrinterAdapter.js
export class PrinterAdapter {
    constructor(printerProfile) {
        this.printerProfile = printerProfile;
    }

    /**
     * Converts a finalized Render Tree into printer-specific commands.
     * @param {Object} renderTree - Hardware-agnostic layout tree with absolute coordinates
     * @param {Number} quantity - Number of labels to print
     * @returns {Object} { type: 'RAW' | 'RASTER', payload: String }
     */
    generatePrintJob(renderTree, quantity) {
        throw new Error("generatePrintJob must be implemented by the adapter subclass.");
    }
}