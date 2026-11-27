import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LabelLayoutEngine } from '../src/printing/PrinterEngine.js';
import { CalibrationEngine, PrinterProfileManager } from '../src/printing/CalibrationEngine.js';

describe('Phase 4: Calibration Engine', () => {
  describe('mmToDots (DPI conversion)', () => {
    it('converts mm to dots at 203 DPI', () => {
      const engine = new LabelLayoutEngine({ dpi: 203 });
      expect(engine.mmToDots(50)).toBe(400); // 50 * 203 / 25.4 ≈ 399.6 → 400
      expect(engine.mmToDots(1)).toBe(8);    // 1 * 203 / 25.4 ≈ 7.99 → 8
    });

    it('converts mm to dots at 300 DPI', () => {
      const engine = new LabelLayoutEngine({ dpi: 300 });
      expect(engine.mmToDots(50)).toBe(591); // 50 * 300 / 25.4 ≈ 590.6 → 591
      expect(engine.mmToDots(1)).toBe(12);   // 1 * 300 / 25.4 ≈ 11.8 → 12
    });

    it('converts mm to dots at 600 DPI', () => {
      const engine = new LabelLayoutEngine({ dpi: 600 });
      expect(engine.mmToDots(50)).toBe(1181); // 50 * 600 / 25.4 ≈ 1181.1 → 1181
      expect(engine.mmToDots(1)).toBe(24);    // 1 * 600 / 25.4 ≈ 23.6 → 24
    });

    it('uses CalibrationEngine.mmToDots static method', () => {
      expect(CalibrationEngine.mmToDots(10, 203)).toBe(80);
      expect(CalibrationEngine.mmToDots(10, 300)).toBe(118);
      expect(CalibrationEngine.mmToDots(10, 600)).toBe(236);
    });
  });

  describe('Offset application (single application check)', () => {
    it('applies offsetX only in LabelLayoutEngine', () => {
      const profile = { dpi: 203, offsetX: 2, offsetY: 1 };
      const engine = new LabelLayoutEngine(profile);

      // offsetX/y stored as dots
      expect(engine.offsetX).toBe(16); // 2 * 203/25.4 ≈ 15.98 → 16
      expect(engine.offsetY).toBe(8);  // 1 * 203/25.4 ≈ 7.99 → 8

      // An element at x=10mm, y=10mm should get offset added once
      const resultX = engine.mmToDots(10) + engine.offsetX;
      const resultY = engine.mmToDots(10) + engine.offsetY;
      expect(resultX).toBe(96);  // 80 + 16
      expect(resultY).toBe(88);  // 80 + 8
    });

    it('generates correct dot positions with offsets', () => {
      const profile = { dpi: 203, offsetX: 2, offsetY: 1 };
      const engine = new LabelLayoutEngine(profile);

      const template = {
        dimensions: { width: 50, height: 25 },
        elements: [
          { type: 'text', content: 'test', x: 1, y: 1, align: 'left', fontSize: 8 }
        ]
      };

      const data = { test_barcode: 'CALIBRATE' };
      const tree = engine.generateRenderTree(template, data);
      expect(tree.elements[0].xDots).toBe(8 + 16);  // 1mm dot + offsetX
      expect(tree.elements[0].yDots).toBe(8 + 8);   // 1mm dot + offsetY
    });
  });

  describe('Test label generation', () => {
    const printerProfile = {
      name: 'TSC TE244',
      manufacturer: 'tsc',
      dpi: 203,
      offsetX: 0,
      offsetY: 0,
    };

    const mediaProfile = {
      totalWidth: 50,
      height: 25,
      gap: 3,
      columns: 1,
      colWidth: 50,
      colSpacing: 0,
    };

    it('generates a calibration template with expected elements', () => {
      const { template, data } = CalibrationEngine.generateTestLabel(printerProfile, mediaProfile);

      expect(template.dimensions.width).toBe(50);
      expect(template.dimensions.height).toBe(25);
      expect(template.elements.length).toBeGreaterThan(0);
      expect(data.test_barcode).toBe('CALIBRATE');
    });

    it('contains alignment guides', () => {
      const { template } = CalibrationEngine.generateTestLabel(printerProfile, mediaProfile);
      const contents = template.elements.map(el => el.content);

      expect(contents).toContain('CENTER');
      expect(contents).toContain('+');
      expect(contents).toContain('50mm x 25mm');
      expect(contents).toContain('DPI: 203');
    });

    it('fits within configured media dimensions', () => {
      const { template } = CalibrationEngine.generateTestLabel(printerProfile, mediaProfile);

      // All elements should be within label bounds
      template.elements.forEach(el => {
        expect(el.x).toBeGreaterThanOrEqual(0);
        expect(el.x).toBeLessThanOrEqual(template.dimensions.width);
        expect(el.y).toBeGreaterThanOrEqual(0);
        expect(el.y).toBeLessThanOrEqual(template.dimensions.height);
      });
    });
  });

  describe('Test label element types', () => {
    const printerProfile = {
      name: 'TSC TE244',
      manufacturer: 'tsc',
      dpi: 203,
      offsetX: 0,
      offsetY: 0,
    };

    const mediaProfile = {
      totalWidth: 50,
      height: 25,
      gap: 3,
      columns: 1,
      colWidth: 50,
      colSpacing: 0,
    };

    it('includes barcode element', () => {
      const { template } = CalibrationEngine.generateTestLabel(printerProfile, mediaProfile);
      const barcodes = template.elements.filter(el => el.type === 'barcode');
      expect(barcodes).toHaveLength(1);
      expect(barcodes[0].field).toBe('test_barcode');
    });

    it('does not include QR code (unsupported)', () => {
      const { template } = CalibrationEngine.generateTestLabel(printerProfile, mediaProfile);
      const qrs = template.elements.filter(el => el.type === 'qr');
      expect(qrs).toHaveLength(0);
    });

    it('does not include line/box elements (protocol-specific)', () => {
      const { template } = CalibrationEngine.generateTestLabel(printerProfile, mediaProfile);
      const lines = template.elements.filter(el => el.type === 'line' || el.type === 'box');
      expect(lines).toHaveLength(0);
    });
  });

  describe('PrinterProfileManager persistence', () => {
    it('saves and loads a profile', async () => {
      await PrinterProfileManager.saveProfile('TSC TE244', {
        manufacturer: 'tsc',
        dpi: 203,
        mediaType: 'gap',
        offsetX: 1,
        offsetY: 0,
        darkness: 10,
        speed: 2,
        orientation: 0,
        labelWidth: 50,
        labelHeight: 25,
        gapHeight: 3,
      });

      const loaded = await PrinterProfileManager.getProfile('TSC TE244');
      expect(loaded).toBeDefined();
      expect(loaded.manufacturer).toBe('tsc');
      expect(loaded.dpi).toBe(203);
      expect(loaded.offsetX).toBe(1);
      expect(loaded.updatedAt).toBeDefined();
    });

    it('returns default profile for unknown printer', async () => {
      const defaultProfile = await PrinterProfileManager.getDefaultProfile('Unknown Printer');
      expect(defaultProfile.name).toBe('Unknown Printer');
      expect(defaultProfile.manufacturer).toBe('tsc');
      expect(defaultProfile.dpi).toBe(203);
      expect(defaultProfile.offsetX).toBe(0);
      expect(defaultProfile.offsetY).toBe(0);
    });

    it('reset removes a saved profile', async () => {
      await PrinterProfileManager.saveProfile('Printer To Delete', {
        manufacturer: 'zebra',
        dpi: 203,
        offsetX: 0,
        offsetY: 0,
      });

      expect(await PrinterProfileManager.getProfile('Printer To Delete')).toBeDefined();

      await PrinterProfileManager.resetProfile('Printer To Delete');
      const defaultProfile = await PrinterProfileManager.getProfile('Printer To Delete');
      expect(defaultProfile.manufacturer).toBe('tsc'); // default
    });

    it('survives multiple save cycles', async () => {
      await PrinterProfileManager.saveProfile('Multi Cycle', { manufacturer: 'tsc', dpi: 203, offsetX: 0, offsetY: 0 });
      await PrinterProfileManager.saveProfile('Multi Cycle', { manufacturer: 'zebra', dpi: 300, offsetX: 0, offsetY: 0 });

      const final = await PrinterProfileManager.getProfile('Multi Cycle');
      expect(final.manufacturer).toBe('zebra');
      expect(final.dpi).toBe(300);
    });
  });
});