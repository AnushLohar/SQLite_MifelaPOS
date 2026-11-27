import { describe, it, expect, vi } from 'vitest';
import { extractPanFromGstin, extractStateCodeFromGstin, validateGstinFormat, fillFormFromEntity } from '../src/utils/gstinAutoFill.js';

describe('GSTIN Auto-Fill Utility', () => {

    it('extracts PAN correctly from GSTIN', () => {
        expect(extractPanFromGstin('27ABCDE1234F1Z5')).toBe('ABCDE1234F');
    });

    it('extracts state code correctly from GSTIN', () => {
        expect(extractStateCodeFromGstin('27ABCDE1234F1Z5')).toBe('27');
    });

    it('validates GSTIN format correctly', () => {
        expect(validateGstinFormat('27ABCDE1234F1Z5')).toBe(true);
        expect(validateGstinFormat('12345')).toBe(false); // Too short
        expect(validateGstinFormat('27ABCDE1234F1Z')).toBe(false); // Invalid format
    });

    it('populates fields correctly without overwriting user data', () => {
        // Setup DOM mock
        document.body.innerHTML = `
            <input id="name" value="Existing Name">
            <input id="phone" value="">
            <select id="state"></select>
        `;

        const entity = {
            name: 'New Entity Name',
            phone: '9876543210',
            state: '06-Haryana'
        };

        const fieldMap = {
            targetFields: {
                name: 'name',
                phone: 'phone',
                state: 'state'
            }
        };

        fillFormFromEntity(entity, fieldMap);

        // Should not overwrite 'Existing Name'
        expect(document.getElementById('name').value).toBe('Existing Name');
        // Should populate 'phone'
        expect(document.getElementById('phone').value).toBe('+919876543210');
    });
});