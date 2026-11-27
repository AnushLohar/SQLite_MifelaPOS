// src/printing/adapters/SATOAdapter.js
import { PrinterAdapter } from './PrinterAdapter.js';

/**
 * SATO SBPL (Sato Brand Language) adapter.
 *
 * Minimal implementation for Sato printers with native SBPL support.
 * Known limitation: SBPL syntax varies by firmware. Not all features supported.
 * Verify with physical hardware before relying on production printing.
 *
 * For uncertain models, prefer driver-mediated printing via
 * UniversalPrintEngine rather than raw SBPL commands.
 */
export class SATOAdapter extends PrinterAdapter {
  generatePrintJob(renderTree, quantity, mediaProfile) {
    const { totalWidth, height, gap, columns, colWidth, colSpacing } = mediaProfile;
    const dpi = this.printerProfile.dpi || 203;
    const dpiMultiplier = dpi / 25.4;

    // SBPL (Sato Brand Language) minimal setup
    let sbpl = '';

    // Initialize label size and media
    sbpl += `SIZE ${totalWidth} mm, ${height} mm\n`;
    sbpl += `GAP ${gap} mm, 0 mm\n`;
    sbpl += `SPEED 2\n`;
    sbpl += `DENSITY 15\n`;
    sbpl += `REFERENCE 0,0\n`;
    sbpl += `CLEARALL\n`; // Clear all buffers

    // Print orientation (0 = normal/portrait)
    sbpl += `DIRECTION 0\n`;

    const fullRows = Math.floor(quantity / columns);
    const remainder = quantity % columns;

    const generateRow = (filledCols) => {
      let rowSbpl = '';

      for (let col = 0; col < filledCols; col++) {
        const offsetX = Math.round((col * (colWidth + colSpacing)) * dpiMultiplier);

        renderTree.elements.forEach(el => {
          const finalX = el.xDots + offsetX;

          if (el.type === 'text') {
            // SBPL TEXT: x,y,font,density,x-mult,y-mult,align,content
            const fontIdx = el.fontIndex || 1;
            rowSbpl += `TEXT ${finalX},${el.yDots},${fontIdx},1,1,1,${el.alignInt},"${el.content}"\n`;
          } else if (el.type === 'barcode') {
            // SBPL BARCODE: x,y,height,symbology,narrow,wide,rotate,print-int,content
            rowSbpl += `BARCODE ${finalX},${el.yDots},${el.hDots},"${el.symbology}",1,2,0,1,"${el.content}"\n`;
          }
        });
      }
      return rowSbpl;
    };

    if (fullRows > 0) {
      sbpl += generateRow(columns);
      sbpl += `PRINT ${fullRows},1\n`;
    }

    if (remainder > 0) {
      sbpl += generateRow(remainder);
      sbpl += `PRINT 1,1\n`;
    }

    // Cut if supported (some Sato models may not have cutter)
    sbpl += `CUT\n`;

    return { type: 'RAW', payload: sbpl };
  }
}