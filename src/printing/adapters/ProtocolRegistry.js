// src/printing/adapters/ProtocolRegistry.js
import { TSCAdapter } from './TSCAdapter.js';
import { ZPLAdapter } from './ZPLAdapter.js';
import { SATOAdapter } from './SATOAdapter.js';

export const ProtocolRegistry = {
  // Manufacturer -> Adapter class
  adapters: {
    tsc: TSCAdapter,
    zebra: ZPLAdapter,
    // TVS uses TSPL (same as TSC)
    tvs: TSCAdapter,
    // Honeywell supports ZPL
    honeywell: ZPLAdapter,
    // GoDEX uses GZPL (ZPL-compatible)
    godex: ZPLAdapter,
    // Sato uses SBPL - confirmed native protocol
    sato: SATOAdapter,
    // Brother uses ESC/P (raster) - driver-mediated only, no raw adapter
    brother: null,
    // BluPrints and Shreyans: protocol unknown, manual configuration required
    bluprints: null,
    shreyans: null,
  },

  // Protocol aliases for manual selection
  protocols: {
    tspl: TSCAdapter,
    zpl: ZPLAdapter,
    epl: null,      // Not implemented
    escp: null,     // Not implemented (Brother driver-mediated only)
    sbpl: SATOAdapter, // Sato SBPL
  },

  getAdapterClass(manufacturer) {
    const key = (manufacturer || '').toLowerCase();
    return this.adapters[key] || null;
  },

  getAdapterClassByProtocol(protocol) {
    const key = (protocol || '').toLowerCase();
    return this.protocols[key] || null;
  },

  isSupported(manufacturer) {
    const adapter = this.getAdapterClass(manufacturer);
    return adapter !== null;
  },

  isProtocolSupported(protocol) {
    const adapter = this.getAdapterClassByProtocol(protocol);
    return adapter !== null;
  },

  getSupportedManufacturers() {
    return Object.entries(this.adapters)
      .filter(([_, adapter]) => adapter !== null)
      .map(([mfr]) => mfr);
  },

  getUnsupportedManufacturers() {
    return Object.entries(this.adapters)
      .filter(([_, adapter]) => adapter === null)
      .map(([mfr]) => mfr);
  },

  getAdapterInfo(manufacturer) {
    const adapter = this.getAdapterClass(manufacturer);
    if (!adapter) {
      return {
        supported: false,
        protocol: null,
        description: `No adapter registered for ${manufacturer}. Manual configuration required.`,
      };
    }
    return {
      supported: true,
      protocol: adapter.prototype.constructor.name.toLowerCase() || 'unknown',
      description: this._getAdapterDescription(adapter),
    };
  },

  _getAdapterDescription(AdapterClass) {
    // Return a brief description based on class name
    const names = {
      TSCAdapter: 'TSPL/TSPL2 native protocol',
      ZPLAdapter: 'ZPL II native protocol',
      SATOAdapter: 'SBPL native protocol',
    };
    return names[AdapterClass.name] || 'Adapter registered';
  },
};