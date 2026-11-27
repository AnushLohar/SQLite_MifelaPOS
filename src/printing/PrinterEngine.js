//src/printing/PrinterEngine.js
import { ProtocolRegistry } from './adapters/ProtocolRegistry.js';

export const MediaProfiles = {
    'label_50x25': { totalWidth: 50, height: 25, gap: 3, columns: 1, colWidth: 50, colSpacing: 0, templateId: 'tpl_50x25' },
    'label_38x25': { totalWidth: 38, height: 25, gap: 3, columns: 1, colWidth: 38, colSpacing: 0, templateId: 'tpl_38x25' },
    // 🚀 NEW: 3-Across Label Roll (104mm total width across printhead)
    'label_34x22_3up': { totalWidth: 104, height: 22, gap: 3, columns: 3, colWidth: 34, colSpacing: 1, templateId: 'tpl_34x22' }
};

export const LabelTemplates = {
    'tpl_50x25': {
        dimensions: { width: 50, height: 25 },
        elements: [
            { type: 'text', field: 'storeName', x: 25, y: 3, align: 'center', fontSize: 10 },
            { type: 'text', field: 'name', x: 25, y: 8, align: 'center', fontSize: 8 },
            { type: 'barcode', field: 'sku', x: 25, y: 13, align: 'center', height: 7, symbology: '128' },
            { type: 'text', field: 'mfgDate', prefix: 'MFG:', x: 2, y: 22, align: 'left', fontSize: 7 },
            { type: 'text', field: 'price', prefix: '₹', x: 48, y: 22, align: 'right', fontSize: 10 }
        ]
    },
    'tpl_34x22': {
        dimensions: { width: 34, height: 22 },
        elements: [
            { type: 'text', field: 'storeName', x: 17, y: 3, align: 'center', fontSize: 8 },
            { type: 'text', field: 'name', x: 17, y: 7, align: 'center', fontSize: 8 },
            { type: 'barcode', field: 'sku', x: 17, y: 11, align: 'center', height: 4, symbology: '128' }, // Height reduced to 4mm
            { type: 'text', field: 'mfgDate', prefix: 'MFG:', x: 2, y: 18, align: 'left', fontSize: 7 },
            { type: 'text', field: 'price', prefix: '₹', x: 32, y: 18, align: 'right', fontSize: 9 }
        ]
    }
};

/**
 * 2. LABEL LAYOUT ENGINE
 * Purely mathematical layer. Converts mm to exact hardware dots and maps alignments.
 * Outputs a finalized, absolute-coordinate Render Tree.
 */
export class LabelLayoutEngine {
    constructor(printerProfile) {
        this.dpi = printerProfile.dpi || 203;
        this.dotsPerMm = this.dpi / 25.4;
        this.offsetX = printerProfile.offsetX ? Math.round(printerProfile.offsetX * this.dotsPerMm) : 0;
        this.offsetY = printerProfile.offsetY ? Math.round(printerProfile.offsetY * this.dotsPerMm) : 0;
    }

    mmToDots(mm) {
        return Math.round(mm * this.dotsPerMm);
    }

    extractValue(element, data) {
        if (element.content) return element.content; // Direct content for test labels
        let val = data[element.field] || '';
        if (element.prefix && val) val = `${element.prefix}${val}`;
        return val;
    }

    generateRenderTree(template, data) {
        const renderElements = template.elements.map(el => {
            const content = this.extractValue(el, data);
            if (!content) return null;

            // Apply offsets
            const xDots = this.mmToDots(el.x) + this.offsetX;
            const yDots = this.mmToDots(el.y) + this.offsetY;

            if (el.type === 'text') {
                let alignInt = 0; // 0=left, 1=center, 2=right
                if (el.align === 'center') alignInt = 1;
                if (el.align === 'right') alignInt = 2;

                // Hardware-agnostic font sizing
                let fontIndex = "1"; // Smallest default
                if (el.fontSize > 9) fontIndex = "3";
                else if (el.fontSize >= 8) fontIndex = "2";

                return { type: 'text', content, xDots, yDots, alignInt, fontIndex };
            } 
            else if (el.type === 'barcode') {
                const hDots = this.mmToDots(el.height || 6);
                
                // Mathematically center the barcode to prevent overflow
                // Assuming barcode narrow width = 1 dot, approx 1.5mm per char
                const estimatedWidthDots = content.length * this.mmToDots(1.5);
                let startX = xDots;
                if (el.align === 'center') startX = xDots - (estimatedWidthDots / 2);
                else if (el.align === 'right') startX = xDots - estimatedWidthDots;

                return { 
                    type: 'barcode', 
                    content, 
                    xDots: Math.max(0, startX), 
                    yDots, 
                    hDots, 
                    symbology: el.symbology || '128' 
                };
            }
            return null;
        }).filter(Boolean);

        return { elements: renderElements };
    }
}

/**
 * 3. PRINTER ADAPTER INTERFACE
 */
export class PrinterAdapter {
    constructor(printerProfile) {
        this.printerProfile = printerProfile;
    }
    generatePrintJob(renderTree, quantity, mediaProfile) {
        throw new Error("generatePrintJob must be implemented.");
    }
}

export class TSCAdapter extends PrinterAdapter {
    generatePrintJob(renderTree, quantity, mediaProfile) {
        const { totalWidth, height, gap, columns, colWidth, colSpacing } = mediaProfile;
        
        // 🚀 THE FIX: Enforce strict GAP boundaries and TEAR offsets so the printer halts at the gap
        let tspl = `SIZE ${totalWidth} mm, ${height} mm\n`;
        tspl += `GAP ${gap} mm, 0 mm\n`;
        tspl += `REFERENCE 0,0\n`;
        tspl += `OFFSET 0 mm\n`;
        tspl += `SET TEAR ON\n`;
        tspl += `DIRECTION 0\n`; // 0 is usually safer for upright alignment than 1
        tspl += `CLS\n`;

        const fullRows = Math.floor(quantity / columns);
        const remainder = quantity % columns;
        const dpiMultiplier = (this.printerProfile.dpi || 203) / 25.4;

        let output = tspl;

        const generateRow = (filledCols) => {
            let rowTspl = `CLS\n`;
            for (let col = 0; col < filledCols; col++) {
                const offsetXDots = Math.round((col * (colWidth + colSpacing)) * dpiMultiplier);
                
                renderTree.elements.forEach(el => {
                    const finalX = el.xDots + offsetXDots;
                    if (el.type === 'text') {
                        rowTspl += `TEXT ${finalX},${el.yDots},"${el.fontIndex}",0,1,1,${el.alignInt},"${el.content}"\n`;
                    } else if (el.type === 'barcode') {
                        rowTspl += `BARCODE ${finalX},${el.yDots},"${el.symbology}",${el.hDots},1,0,1,2,"${el.content}"\n`;
                    }
                });
            }
            return rowTspl;
        };

        if (fullRows > 0) {
            output += generateRow(columns);
            output += `PRINT ${fullRows},1\n`;
        }
        if (remainder > 0) {
            output += generateRow(remainder);
            output += `PRINT 1,1\n`;
        }

        return { type: 'RAW', payload: output };
    }
}

/**
 * 5. ORCHESTRATOR
 */
export class PrinterManager {
    /**
     * Print a label using the standard template system.
     * @param {Object} printerProfile - Printer configuration
     * @param {string} mediaId - Media profile ID (e.g., 'label_50x25')
     * @param {Object} data - Label data
     * @param {number} quantity - Number of labels
     */
    /**
     * Generate raw printer commands without dispatching.
     * @param {Object} printerProfile - Printer configuration
     * @param {string} mediaId - Media profile ID (e.g., 'label_50x25')
     * @param {Object} data - Label data
     * @param {number} quantity - Number of labels
     * @returns {Object} { type: 'RAW', payload: string }
     */
    static generateRawPayload(printerProfile, mediaId, data, quantity) {
        const mediaProfile = MediaProfiles[mediaId] || MediaProfiles['label_50x25'];
        const template = LabelTemplates[mediaProfile.templateId];

        const layoutEngine = new LabelLayoutEngine(printerProfile);
        const renderTree = layoutEngine.generateRenderTree(template, data);

        const manufacturer = (printerProfile.manufacturer || '').toLowerCase();
        const AdapterClass = ProtocolRegistry.getAdapterClass(manufacturer);

        if (!AdapterClass) {
            throw new Error(`Unsupported manufacturer: ${manufacturer}.`);
        }
        const adapter = new AdapterClass(printerProfile);
        return adapter.generatePrintJob(renderTree, quantity, mediaProfile);
    }

    /**
     * Generate raw printer commands for a custom template without dispatching.
     */
    static generateCustomRawPayload(printerProfile, customTemplate, data, quantity, mediaProfileOverride = null) {
        const mediaProfile = mediaProfileOverride || {
            totalWidth: customTemplate.dimensions?.width || 50,
            height: customTemplate.dimensions?.height || 25,
            gap: 3,
            columns: 1,
            colWidth: customTemplate.dimensions?.width || 50,
            colSpacing: 0,
        };

        const layoutEngine = new LabelLayoutEngine(printerProfile);
        const renderTree = layoutEngine.generateRenderTree(customTemplate, data);

        const manufacturer = (printerProfile.manufacturer || '').toLowerCase();
        const AdapterClass = ProtocolRegistry.getAdapterClass(manufacturer);

        if (!AdapterClass) {
            throw new Error(`Unsupported manufacturer: ${manufacturer}.`);
        }
        const adapter = new AdapterClass(printerProfile);
        return adapter.generatePrintJob(renderTree, quantity, mediaProfile);
    }

    static async printLabel(printerProfile, mediaId, data, quantity) {
        if (!printerProfile.name) throw new Error("No printer selected.");

        const job = this.generateRawPayload(printerProfile, mediaId, data, quantity);

        if (job.type === 'RAW' && window.electronAPI?.printRaw) {
            return await window.electronAPI.printRaw({
                printerName: printerProfile.name,
                data: job.payload
            });
        }
        throw new Error("Raw Print API is unavailable in this environment.");
    }

    static async printCustomLabel(printerProfile, customTemplate, data, quantity, mediaProfileOverride = null) {
        if (!printerProfile.name) throw new Error("No printer selected.");

        const job = this.generateCustomRawPayload(printerProfile, customTemplate, data, quantity, mediaProfileOverride);

        if (job.type === 'RAW' && window.electronAPI?.printRaw) {
            return await window.electronAPI.printRaw({
                printerName: printerProfile.name,
                data: job.payload
            });
        }
        throw new Error("Raw Print API is unavailable in this environment.");
    }
}