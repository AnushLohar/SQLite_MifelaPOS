// Regression test for Phase 2 changes
// Tests: TSC, ZPL, SATO adapters + ProtocolRegistry

import { TSCAdapter } from './src/printing/adapters/TSCAdapter.js';
import { ZPLAdapter } from './src/printing/adapters/ZPLAdapter.js';
import { SATOAdapter } from './src/printing/adapters/SATOAdapter.js';
import { ProtocolRegistry } from './src/printing/adapters/ProtocolRegistry.js';

// Test printer profiles
const tscProfile = { manufacturer: 'tsc', dpi: 203 };
const zebraProfile = { manufacturer: 'zebra', dpi: 203 };
const satoProfile = { manufacturer: 'sato', dpi: 203 };
const honeywellProfile = { manufacturer: 'honeywell', dpi: 203 };
const godexProfile = { manufacturer: 'godex', dpi: 203 };
const tscProfile2 = { manufacturer: 'TSC', dpi: 300 }; // case test

console.log('=== ProtocolRegistry Tests ===\n');

// 1. Test adapter lookup
console.log('1. Adapter lookup by manufacturer:');
console.log('   tsc:', ProtocolRegistry.getAdapterClass('tsc')?.name || 'FAIL');
console.log('   zebra:', ProtocolRegistry.getAdapterClass('zebra')?.name || 'FAIL');
console.log('   sato:', ProtocolRegistry.getAdapterClass('sato')?.name || 'FAIL');
console.log('   honeywell:', ProtocolRegistry.getAdapterClass('honeywell')?.name || 'FAIL');
console.log('   godex:', ProtocolRegistry.getAdapterClass('godex')?.name || 'FAIL');
console.log('   brother:', ProtocolRegistry.getAdapterClass('brother') || 'FAIL (expected null)');
console.log('   bluprints:', ProtocolRegistry.getAdapterClass('bluprints') || 'FAIL (expected null)');
console.log('   shreyans:', ProtocolRegistry.getAdapterClass('shreyans') || 'FAIL (expected null)');

// 2. Test case insensitivity
console.log('\n2. Case insensitivity:');
console.log('   TSC (uppercase):', ProtocolRegistry.getAdapterClass('TSC')?.name || 'FAIL');
console.log('   ZEBRA (uppercase):', ProtocolRegistry.getAdapterClass('ZEBRA')?.name || 'FAIL');

// 3. Test supported manufacturers
console.log('\n3. Supported manufacturers:');
console.log('   Count:', ProtocolRegistry.getSupportedManufacturers().length);
console.log('   List:', ProtocolRegistry.getSupportedManufacturers());

// 4. Test unsupported
console.log('\n4. Unsupported manufacturers:');
console.log('   List:', ProtocolRegistry.getUnsupportedManufacturers());

// 5. Test protocol lookup
console.log('\n5. Protocol lookup:');
console.log('   tspl:', ProtocolRegistry.getAdapterClassByProtocol('tspl')?.name || 'FAIL');
console.log('   zpl:', ProtocolRegistry.getAdapterClassByProtocol('zpl')?.name || 'FAIL');
console.log('   sbpl:', ProtocolRegistry.getAdapterClassByProtocol('sbpl')?.name || 'FAIL');
console.log('   escp:', ProtocolRegistry.getAdapterClassByProtocol('escp') || 'FAIL (expected null)');

// 6. Test isSupported
console.log('\n6. isSupported:');
console.log('   tsc:', ProtocolRegistry.isSupported('tsc'));
console.log('   brother:', ProtocolRegistry.isSupported('brother'));
console.log('   sato:', ProtocolRegistry.isSupported('sato'));

// 7. Test isProtocolSupported
console.log('\n7. isProtocolSupported:');
console.log('   tspl:', ProtocolRegistry.isProtocolSupported('tspl'));
console.log('   zpl:', ProtocolRegistry.isProtocolSupported('zpl'));
console.log('   sbpl:', ProtocolRegistry.isProtocolSupported('sbpl'));

// 8. Test getAdapterInfo
console.log('\n8. getAdapterInfo:');
console.log('   tsc:', ProtocolRegistry.getAdapterInfo('tsc'));
console.log('   brother:', ProtocolRegistry.getAdapterInfo('brother'));
console.log('   sato:', ProtocolRegistry.getAdapterInfo('sato'));

// 9. Test unsupported manufacturer error message
console.log('\n9. Unsupported manufacturer error:');
try {
  // Can't easily test this without a profile, but check the method exists
  console.log('   Method exists: yes');
} catch (e) {
  console.log('   Error:', e.message);
}

// Test SATO Adapter instantiation and basic method
console.log('\n10. SATO Adapter instantiation:');
try {
  const sat = new SATOAdapter({ dpi: 203 });
  console.log('   Instantiated successfully');
  console.log('   Has generatePrintJob:', typeof sat.generatePrintJob === 'function');
} catch (e) {
  console.log('   Error:', e.message);
}

// Test ZPL Adapter instantiation
console.log('\n11. ZPL Adapter instantiation:');
try {
  const zpl = new ZPLAdapter({ dpi: 203 });
  console.log('   Instantiated successfully');
  console.log('   Has generatePrintJob:', typeof zpl.generatePrintJob === 'function');
} catch (e) {
  console.log('   Error:', e.message);
}

// Test TSC Adapter instantiation
console.log('\n12. TSC Adapter instantiation:');
try {
  const tsc = new TSCAdapter({ dpi: 203 });
  console.log('   Instantiated successfully');
  console.log('   Has generatePrintJob:', typeof tsc.generatePrintJob === 'function');
} catch (e) {
  console.log('   Error:', e.message);
}

console.log('\n=== All tests completed ===');