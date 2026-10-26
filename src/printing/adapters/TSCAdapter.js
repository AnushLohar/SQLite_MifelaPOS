import { PrinterAdapter } from './PrinterAdapter.js';

export class TSCAdapter extends PrinterAdapter {
    generatePrintJob(renderTree, quantity, mediaProfile) {
        // Physical Roll Dimensions
        // A 3-up 34x22mm roll is typically 104mm wide across the printhead (34*3 + ~2mm gaps)
        const totalWebWidth = mediaProfile.totalWidth || 104; 
        const labelHeight = mediaProfile.height || 22;
        const gapHeight = mediaProfile.gap || 3;
        
        const columns = mediaProfile.columns || 3;
        const colWidth = mediaProfile.colWidth || 34;
        const colSpacing = mediaProfile.colSpacing || 1; // 1mm gap between labels
        
        const dpiMultiplier = (this.printerProfile.dpi || 203) / 25.4;

        // TSPL Setup Commands
        // DIRECTION 0 ensures text prints perpendicular to the feed direction (fixing the 90-degree rotation)
        let output = `SIZE ${totalWebWidth} mm, ${labelHeight} mm\n`;
        output += `GAP ${gapHeight} mm, 0 mm\n`;
        output += `DIRECTION 0\n`; 
        output += `REFERENCE 0,0\n`;
        output += `OFFSET 0 mm\n`;
        output += `SET TEAR ON\n`;
        
        const fullRows = Math.floor(quantity / columns);
        const remainder = quantity % columns;

        const generatePhysicalRow = (filledColsCount) => {
            let rowTspl = `CLS\n`; // Clear Image Buffer
            
            for (let col = 0; col < filledColsCount; col++) {
                // Calculate starting X coordinate for this specific column in dots
                const offsetXDots = Math.round((col * (colWidth + colSpacing)) * dpiMultiplier);
                
                renderTree.elements.forEach(el => {
                    const absoluteX = el.xDots + offsetXDots;
                    
                    if (el.type === 'text') {
                        // TEXT x,y,"font",rotation,x-multiplier,y-multiplier,alignment,"content"
                        rowTspl += `TEXT ${absoluteX},${el.yDots},"${el.fontIndex}",0,1,1,${el.alignInt},"${el.content}"\n`;
                    } else if (el.type === 'barcode') {
                        // Narrow bar: 1, Wide bar: 2. Rotation: 0 (upright)
                        rowTspl += `BARCODE ${absoluteX},${el.yDots},"${el.symbology}",${el.hDots},1,0,1,2,"${el.content}"\n`;
                    }
                });
            }
            return rowTspl;
        };

        if (fullRows > 0) {
            output += generatePhysicalRow(columns);
            output += `PRINT ${fullRows},1\n`; // Tell printer to print this full row buffer X times
        }
        
        if (remainder > 0) {
            output += generatePhysicalRow(remainder);
            output += `PRINT 1,1\n`; // Print the partial row once
        }

        return { type: 'RAW', payload: output };
    }
}