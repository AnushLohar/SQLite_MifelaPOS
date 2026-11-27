// src/printing/adapters/ZPLAdapter.js
import { PrinterAdapter } from './PrinterAdapter.js';

export class ZPLAdapter extends PrinterAdapter {
  generatePrintJob(renderTree, quantity, mediaProfile) {
    const { totalWidth, height, gap, columns, colWidth, colSpacing } = mediaProfile;
    const dpi = this.printerProfile.dpi || 203;
    const dotsPerMm = dpi / 25.4;

    // ZPL uses dots; convert mm to dots
    const labelWidthDots = Math.round(totalWidth * dotsPerMm);
    const labelHeightDots = Math.round(height * dotsPerMm);
    const gapDots = Math.round(gap * dotsPerMm);
    const colWidthDots = Math.round(colWidth * dotsPerMm);
    const colSpacingDots = Math.round(colSpacing * dotsPerMm);

    let zpl = '';

    // Print orientation: N = normal (portrait)
    zpl += `^XA\n`;
    zpl += `^PW${labelWidthDots}\n`;      // Print width
    zpl += `^LL${labelHeightDots}\n`;     // Label length
    zpl += `^LS0\n`;                      // Label shift
    zpl += `^CF0,30\n`;                   // Default font
    zpl += `^MMT\n`;                      // Media type: thermal transfer (use ^MND for direct thermal)
    zpl += `^MD0\n`;                      // Darkness adjustment (0 = default)
    zpl += `^PR4\n`;                      // Print speed (4 = default)

    const fullRows = Math.floor(quantity / columns);
    const remainder = quantity % columns;

    const generateRow = (filledCols) => {
      let rowZpl = '';
      for (let col = 0; col < filledCols; col++) {
        const offsetXDots = col * (colWidthDots + colSpacingDots);

        renderTree.elements.forEach(el => {
          const finalX = el.xDots + offsetXDots;
          const finalY = el.yDots;

          if (el.type === 'text') {
            // ^FO x,y ^A font,size ^FD content ^FS
            const fontSize = el.fontIndex === '3' ? '40' : el.fontIndex === '2' ? '30' : '20';
            let alignment = '^FN'; // default left
            if (el.alignInt === 1) alignment = '^FC'; // center (requires ^FB block)
            if (el.alignInt === 2) alignment = '^FR'; // right (use ^FO with calculated position)

            // Simpler: use ^FO with calculated position for all alignments
            rowZpl += `^FO${finalX},${finalY}^A0N,${fontSize},${fontSize}^FD${el.content}^FS\n`;
          } else if (el.type === 'barcode') {
            // ^BY narrow,wide,height ^BC symbology,height,print-interp,orientation
            // Code 128 = ^BC
            const narrow = 2;
            const wide = 6;
            const heightDots = el.hDots;
            rowZpl += `^FO${finalX},${finalY}^BY${narrow},${wide},${heightDots}^BCN,${heightDots},Y,N,N^FD${el.content}^FS\n`;
          }
        });
      }
      return rowZpl;
    };

    if (fullRows > 0) {
      zpl += generateRow(columns);
      zpl += `^PQ${fullRows},0,1,Y\n`; // Quantity, pause, reprint, cut
      zpl += `^XZ\n`;
    }

    if (remainder > 0) {
      zpl += generateRow(remainder);
      zpl += `^PQ1,0,1,Y\n`;
      zpl += `^XZ\n`;
    }

    return { type: 'RAW', payload: zpl };
  }
}