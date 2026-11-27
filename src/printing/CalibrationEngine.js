// src/printing/CalibrationEngine.js
import { LabelLayoutEngine, PrinterManager } from './PrinterEngine.js';
import { loadProfiles, saveProfiles } from './ProfileStore.js';
import { PrintDispatcher } from './PrintDispatcher.js';

/**
 * Universal Printer Calibration & Test-Label Engine.
 */
export class CalibrationEngine {
  /**
   * Generates a standardized calibration test label based on printer profile.
   * Helps identify dimension errors, clipping, and offset drift.
   */
  static generateTestLabel(printerProfile, mediaProfile) {
    const colWidth = mediaProfile.colWidth || printerProfile.labelWidth || 50;
    const height = mediaProfile.height || printerProfile.labelHeight || 25;

    // 1. Construct a virtual template for the test label
    const testTemplate = {
      dimensions: { width: colWidth, height: height },
      elements: [
        // Boundary Guides (corners)
        { type: 'text', content: '┌', x: 0.5, y: 0.5, align: 'left', fontSize: 8 },
        { type: 'text', content: '┐', x: colWidth - 2, y: 0.5, align: 'right', fontSize: 8 },
        { type: 'text', content: '└', x: 0.5, y: height - 2, align: 'left', fontSize: 8 },
        { type: 'text', content: '┘', x: colWidth - 2, y: height - 2, align: 'right', fontSize: 8 },

        // Alignment Guides
        { type: 'text', content: 'CENTER', x: colWidth / 2, y: height / 2 - 2, align: 'center', fontSize: 10 },
        { type: 'text', content: '+', x: colWidth / 2, y: height / 2, align: 'center', fontSize: 12 },

        // Dimension Markers
        { type: 'text', content: `${colWidth}mm x ${height}mm`, x: colWidth / 2, y: 3, align: 'center', fontSize: 8 },
        { type: 'text', content: `DPI: ${printerProfile.dpi || 203}`, x: 2, y: height - 4, align: 'left', fontSize: 7 },

        // Printer Identity
        { type: 'text', content: `MFR: ${printerProfile.manufacturer || '?' }`, x: colWidth - 2, y: height - 4, align: 'right', fontSize: 7 },

        // Sample Barcode
        { type: 'barcode', field: 'test_barcode', x: colWidth / 2, y: height - 10, align: 'center', height: 4, symbology: '128' }
      ]
    };

    const testData = {
      test_barcode: 'CALIBRATE'
    };

    return { template: testTemplate, data: testData };
  }

  /**
   * Triggers a physical test print using a custom calibration template via PrintDispatcher.
   */
  static async printTestLabel(printerProfile, mediaProfileOverride = null) {
    const { template, data } = this.generateTestLabel(printerProfile, mediaProfileOverride || {});

    // Generate payload
    const result = PrinterManager.generateCustomRawPayload(printerProfile, template, data, 1, mediaProfileOverride);

    // Dispatch via queue (no idempotency key for tests)
    return await PrintDispatcher.enqueueJob({
      jobId: `test-label-${Date.now()}`,
      printerId: printerProfile.name,
      printerName: printerProfile.name,
      manufacturer: printerProfile.manufacturer,
      protocol: printerProfile.protocol || 'tspl',
      payload: result.payload,
      quantity: 1
    });
  }

  /**
   * Calculates dot-based offsets from mm adjustments.
   */
  static mmToDots(mm, dpi = 203) {
    return Math.round(mm * (dpi / 25.4));
  }
}

/**
 * Manages persistent printer-specific profiles using ProfileStore.
 */
export class PrinterProfileManager {
  static async getProfiles() {
    return await loadProfiles();
  }

  static async getProfile(printerName) {
    const profiles = await this.getProfiles();
    return profiles[printerName] || this.getDefaultProfile(printerName);
  }

  static async saveProfile(printerName, profile) {
    const profiles = await this.getProfiles();
    profiles[printerName] = {
      ...profile,
      updatedAt: new Date().toISOString()
    };
    await saveProfiles(profiles);
  }

  static getDefaultProfile(printerName) {
    return {
      name: printerName,
      manufacturer: 'tsc',
      protocol: 'tspl',
      dpi: 203,
      mediaType: 'gap', // gap, black_mark, continuous
      offsetX: 0, // mm
      offsetY: 0, // mm
      darkness: 10, // 0-15 typical
      speed: 2, // inches per sec
      orientation: 0, // 0 or 1
      labelWidth: 50,
      labelHeight: 25,
      gapHeight: 3
    };
  }

  static async resetProfile(printerName) {
    const profiles = await this.getProfiles();
    delete profiles[printerName];
    await saveProfiles(profiles);
  }
}
