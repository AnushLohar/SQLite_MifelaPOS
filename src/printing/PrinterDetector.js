// src/printing/PrinterDetector.js
import { ProtocolRegistry } from './adapters/ProtocolRegistry.js';

/**
 * Intelligent printer detector for MifelaPOS.
 *
 * Uses Electron's printer discovery to identify installed label printers,
 * determine manufacturer/model, select the appropriate protocol adapter,
 * and assign a confidence level. Provides a safe fallback when automatic
 * detection is inconclusive.
 *
 * Key design principles:
 * - Never silently select an incompatible protocol.
 * - Existing explicitly configured printers retain priority.
 * - Detection is heuristic + evidence-based, not definitive.
 * - Manual configuration is always available as fallback.
 * - Provisional protocol mappings (Honeywell, GoDEX) remain marked accordingly.
 */

const fs = typeof window !== 'undefined' && window.fs ? window.fs : null;

/**
 * Model entries for supported printers.
 * Each entry has: model name (lowercase), manufacturer, aliases, protocol.
 * Maintained carefully to avoid similar-name confusion.
 */
const MODEL_REGISTRY = [
  // --- TSC models ---
  {
    manufacturer: 'tsc',
    models: [
      { name: 'te244',              aliases: ['te244', 'TE244'] },
      { name: 'ttp-244 pro',        aliases: ['ttp-244 pro', 'TTP-244 Pro'] },
      { name: 'te200',              aliases: ['te200', 'TE200'] },
      { name: 'ta210',              aliases: ['ta210', 'TA210'] },
      { name: 'ta220',              aliases: ['ta220', 'TA220'] },
      { name: 'mh241',              aliases: ['mh241', 'MH241'] },
    ],
    protocol: 'tspl',
  },

  // --- TVS models ---
  {
    manufacturer: 'tvs',
    models: [
      { name: 'lp 46 neo',          aliases: ['lp 46 neo', 'LP 46 Neo'] },
      { name: 'lp 46 plus',         aliases: ['lp 46 plus', 'LP 46 Plus'] },
      { name: 'lp 46 lite',         aliases: ['lp 46 lite', 'LP 46 Lite'] },
      { name: 'lp 46 dlite',        aliases: ['lp 46 dlite', 'LP 46 Dlite'] },
      { name: 'ilp 5210',           aliases: ['ilp 5210', 'ILP 5210'] },
    ],
    protocol: 'tspl',
  },

  // --- Zebra models ---
  {
    manufacturer: 'zebra',
    models: [
      { name: 'zd220',              aliases: ['zd220', 'ZD220'] },
      { name: 'zd230t',             aliases: ['zd230t', 'ZD230t'] },
      { name: 'zd420',              aliases: ['zd420', 'ZD420'] },
      { name: 'zd421',              aliases: ['zd421', 'ZD421'] },
      { name: 'gc420t',             aliases: ['gc420t', 'GC420t'] },
      { name: 'gt800',              aliases: ['gt800', 'GT800'] },
      { name: 'zt231',              aliases: ['zt231', 'ZT231'] },
      { name: 'zt411',              aliases: ['zt411', 'ZT411'] },
    ],
    protocol: 'zpl',
  },

  // --- Honeywell models (provisional) ---
  {
    manufacturer: 'honeywell',
    models: [
      { name: 'pc42t',              aliases: ['pc42t', 'PC42t'] },
      { name: 'pc42e',              aliases: ['pc42e', 'PC42E'] },
      { name: 'pc43t',              aliases: ['pc43t', 'PC43t'] },
    ],
    protocol: 'zpl',   // Provisional — marked assumed in ProtocolRegistry
    provisional: true,
  },

  // --- GoDEX models (provisional) ---
  {
    manufacturer: 'godex',
    models: [
      { name: 'g500',               aliases: ['g500', 'G500'] },
      { name: 'g500u',              aliases: ['g500u', 'G500U'] },
      { name: 'g500 ues',           aliases: ['g500 ues', 'G500 UES'] },
      { name: 'ez120',              aliases: ['ez120', 'EZ120'] },
    ],
    protocol: 'zpl',   // GZPL / ZPL-compatible — provisional
    provisional: true,
  },

  // --- SATO models ---
  {
    manufacturer: 'sato',
    models: [
      { name: 'ws4',                aliases: ['ws4', 'WS4'] },
    ],
    protocol: 'sbl',   // SBPL — hardware-validation pending
  },

  // --- Brother models ---
  {
    manufacturer: 'brother',
    models: [
      { name: 'ql-800',             aliases: ['ql-800', 'QL-800'] },
    ],
    protocol: 'driver-mediated',  // No raw adapter; use OS driver
  },

  // --- BluPrints models (manual config only) ---
  {
    manufacturer: 'bluprints',
    models: [
      { name: 'unnati tt',          aliases: ['unnati tt', 'Unnati TT'] },
      { name: 'unnati premium',     aliases: ['unnati premium', 'Unnati Premium'] },
    ],
    protocol: 'manual',  // Manual configuration required
  },

  // --- Shreyans models (manual config only) ---
  {
    manufacturer: 'shreyans',
    models: [
      { name: 'srs423',             aliases: ['srs423', 'SRS423'] },
      { name: 'srs cd410',          aliases: ['srs cd410', 'SRS CD410'] },
    ],
    protocol: 'manual',  // Manual configuration required
  },
];

/**
 * Normalize a string for matching: lowercase, trim, collapse whitespace.
 */
function normalize(str) {
  if (typeof str !== 'string') return '';
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Check if a normalized string matches any model entry.
 * Returns the matching model entry or null.
 */
function findModel(normalizedName) {
  for (const category of MODEL_REGISTRY) {
    for (const model of category.models) {
      // Check exact name match
      if (model.name === normalizedName) return { category, model };

      // Check aliases
      if (model.aliases && model.aliases.some(alias => normalize(alias) === normalizedName)) {
        return { category, model };
      }
    }
  }
  return null;
}

/**
 * Identify manufacturer from a normalized printer name.
 * Returns { manufacturer, category } or null.
 */
function identifyManufacturer(normalizedName) {
  for (const category of MODEL_REGISTRY) {
    // If the normalized name matches any model in this category
    if (findModel(normalizedName)?.category === category) {
      return { manufacturer: category.manufacturer, category };
    }
  }
  return null;
}

/**
 * Get the protocol for a manufacturer from ProtocolRegistry,
 * with awareness of provisional status.
 */
function getProtocolForManufacturer(manufacturer) {
  const adapterClass = ProtocolRegistry.getAdapterClass(manufacturer);
  if (!adapterClass) return null;

  // Check if the adapter class has a provisional marker
  // (We infer this from the fact that the registry marks some as unsupported
  //  or we check the adapter's own properties)
  if (typeof adapterClass.prototype !== 'undefined' && adapterClass.prototype.provisional) {
    return { protocol: adapterClass.name.toLowerCase(), provisional: true };
  }

  // Check protocols map
  const protocolEntry = ProtocolRegistry.protocols[adapterClass.name.toLowerCase()];
  if (protocolEntry && protocolEntry.provisional) {
    return { protocol: adapterClass.name.toLowerCase(), provisional: true };
  }

  return { protocol: adapterClass.name.toLowerCase(), provisional: false };
}

/**
 * Compute confidence level for a detection result.
 */
function computeConfidence(detection) {
  if (!detection.evidence || detection.evidence.length === 0) return 'none';

  const highEvidence = ['exact-model', 'driver-match'].length;
  const mediumEvidence = ['manufacturer-match', 'model-alias'].length;

  if (detection.confidence !== undefined) return detection.confidence;

  if (detection.evidence.includes('exact-model')) return 'high';
  if (detection.evidence.includes('manufacturer-match') || detection.evidence.includes('model-alias')) return 'medium';
  return 'low';
}

/**
 * PrinterDetector — Main entry point.
 * Discovers printers via Electron and returns detection results.
 */
export class PrinterDetector {
  /**
   * Discover and detect printers from the OS.
   * @param {Object} options - Optional configuration
   * @returns {Promise<Array<Object>>} Array of detection results
   */
  static async detect() {
    const results = [];

    if (typeof window === 'undefined' || !window.electronAPI || !window.electronAPI.getPrinters) {
      console.warn('Printer detection requires the Electron desktop app with getPrinters API.');
      return results;
    }

    try {
      const printers = await window.electronAPI.getPrinters();
      if (!printers || !Array.isArray(printers)) return results;

      // Track already-detected printer names to avoid duplicates
      const detectedNames = new Set();

      for (const printer of printers) {
        const normalizedName = normalize(printer.name);

        // Skip duplicates (same printer name)
        if (detectedNames.has(normalizedName)) continue;
        detectedNames.add(normalizedName);

        // 1. Identify manufacturer
        const mfrResult = identifyManufacturer(normalizedName);

        // 2. Try model identification
        let modelInfo = null;
        let detectedModel = null;
        let detectedProtocol = null;
        let provisional = false;
        let adapterName = null;
        let confidence = 'none';
        const evidence = [];

        if (mfrResult) {
          evidence.push('manufacturer-match');
          const { manufacturer, category } = mfrResult;

          // Try to find exact model
          modelInfo = findModel(normalizedName);
          if (modelInfo) {
            evidence.push('exact-model');
            detectedModel = modelInfo.model.name;
            detectedProtocol = modelInfo.category.protocol;
            adapterName = ProtocolRegistry.getAdapterClass(manufacturer)?.name || null;
          } else {
            // Manufacturer identified but model not conclusive
            evidence.push('manufacturer-only');
            detectedModel = 'unknown';
          }

          // Check provisional status
          if (category.provisional) {
            provisional = true;
            evidence.push('provisional-mapping');
          }

          // Get protocol info
          const protocolInfo = getProtocolForManufacturer(manufacturer);
          if (protocolInfo) {
            detectedProtocol = protocolInfo.protocol;
            if (protocolInfo.provisional) {
              evidence.push('provisional-protocol');
            }
          }

          confidence = computeConfidence({ evidence, detectedModel, provisional });
        }

        // 3. If no manufacturer match, check for known driver names
        if (!mfrResult) {
          // Check driver name for known manufacturers
          const driverMatch = printer.description ? normalize(printer.description) : '';
          const driverMfr = identifyManufacturerFromDriver(driverMatch);
          if (driverMfr) {
            evidence.push('driver-name-match');
            const { manufacturer } = driverMfr;
            modelInfo = findModel(normalizedName);
            if (modelInfo) {
              evidence.push('exact-model');
              detectedModel = modelInfo.model.name;
            }
            detectedProtocol = ProtocolRegistry.getAdapterClass(manufacturer)?.name || null;
            confidence = 'medium';
          } else {
            evidence.push('unknown-printer');
            confidence = 'low';
          }
        }

        // 4. Build result
        const result = {
          printerName: printer.name,
          manufacturer: detectedModel ? (modelInfo?.category?.manufacturer || mfrResult?.manufacturer || 'unknown') : 'unknown',
          model: detectedModel || 'unknown',
          protocol: detectedProtocol || 'unknown',
          adapter: adapterName || null,
          confidence,
          detectionMethod: mfrResult ? 'model-registry' : driverMfr ? 'driver-name' : 'unknown',
          evidence: evidence,
          requiresManualConfirmation: confidence === 'low' || provisional,
          warnings: [],

          // Derived: is this printer supported for automatic printing?
          supported: confidence !== 'low' && !provisional && adapterName !== null,
        };

        // Add warnings for known limitations
        if (result.requiresManualConfirmation) {
          result.warnings.push('Automatic detection inconclusive — manual printer configuration recommended.');
        }
        if (result.provisional && result.confidence === 'medium') {
          result.warnings.push(` ${result.manufacturer} protocol mapping is provisional — verify with physical hardware.`);
        }
        if (!result.supported && result.evidence.length === 0) {
          result.warnings.push('No supported protocol detected — OS driver-mediated printing recommended.');
        }

        results.push(result);
      }

      return results;

    } catch (error) {
      console.error('Printer detection failed:', error);
      return [{ printerName: 'unknown', manufacturer: 'unknown', model: 'unknown', protocol: 'unknown', adapter: null, confidence: 'none', detectionMethod: 'error', evidence: ['detection-failed'], requiresManualConfirmation: true, warnings: [error.message || 'Printer detection failed'], supported: false }];
    }
  }

  /**
   * Identify manufacturer from driver name patterns.
   * Used as fallback when printer name doesn't match model registry.
   */
  static identifyManufacturerFromDriver(driverName) {
    const normalized = normalize(driverName);
    return identifyManufacturer(normalized);
  }

  /**
   * Get recommended printer configuration for a detected result.
   * Returns an object the caller can use with PrinterManager.printLabel().
   */
  getRecommendedConfiguration(result) {
    if (!result.supported || result.confidence === 'none') {
      return {
        manual: true,
        warnings: result.warnings || ['No supported protocol — use OS driver or manual configuration.'],
      };
    }

    const manufacturer = result.manufacturer;
    const adapterClass = ProtocolRegistry.getAdapterClass(manufacturer);

    if (!adapterClass) {
      return {
        manual: true,
        warnings: [`No adapter registered for ${manufacturer}.`],
      };
    }

    // Build a printer profile suitable for PrinterManager.printLabel()
    return {
      manual: false,
      manufacturer,
      model: result.model,
      protocol: result.protocol,
      adapter: adapterClass.name,
      dpi: 203,  // Default — can be overridden by user
      connection: { type: 'os', address: result.printerName },
      supported: true,
      warnings: result.warnings || [],
    };
  }
}

/**
 * Identify manufacturer from driver name as a fallback.
 * Checks driver description for known manufacturer keywords.
 */
function identifyManufacturerFromDriver(normalizedName) {
  // Map of driver name keywords to manufacturers
  const driverMap = {
    'sato': 'sato',
    'brother': 'brother',
    'honeywell': 'honeywell',
    'godex': 'godex',
    'tsc': 'tsc',
    'zebra': 'zebra',
    'tvs': 'tvs',
  };

  for (const [keyword, mfr] of Object.entries(driverMap)) {
    if (normalizedName.includes(keyword)) {
      return { manufacturer: mfr };
    }
  }
  return null;
}

// Export the registry for external use (tests, UI)
export { MODEL_REGISTRY, normalize, findModel, identifyManufacturer };