import assert from 'node:assert/strict';
import test from 'node:test';
import { rankMedicineMasterMatches } from './medicine-master-matcher.js';

const master = overrides => ({
  medicineId: 'master-001',
  brandName: 'Dolo 650',
  productName: 'Dolo 650 Tablet',
  genericName: 'Paracetamol',
  composition: 'Paracetamol',
  strength: '650 mg',
  dosageForm: 'Tablet',
  manufacturer: 'Micro Labs',
  indications: ['Fever'],
  uses: ['Pain relief'],
  clinicalDataVerification: 'VERIFIED',
  dataQualityStatus: 'GOOD',
  ...overrides
});

const storeProduct = overrides => ({
  name: 'Dolo 650',
  brand: 'Dolo',
  genericName: 'Paracetamol',
  composition: 'Paracetamol',
  strength: '650 mg',
  dosageForm: 'Tablet',
  manufacturer: 'Micro Labs',
  ...overrides
});

test('returns an exact match when brand, generic, strength, form and composition agree', () => {
  const result = rankMedicineMasterMatches(storeProduct(), [master()]);
  assert.equal(result.status, 'EXACT');
  assert.equal(result.medicine.medicineId, 'master-001');
  assert.equal(result.medicine.clinicalDataVerification, 'VERIFIED');
});

test('never links a different strength even when the brand name is exact', () => {
  const result = rankMedicineMasterMatches(storeProduct(), [master({ strength: '500 mg', medicineId: 'wrong-strength' })]);
  assert.equal(result.status, 'NO_MATCH');
  assert.equal(result.medicine, null);
});

test('returns ambiguous when the store item omits strength and the brand has multiple strengths', () => {
  const result = rankMedicineMasterMatches(storeProduct({ strength: '', dosageForm: '' }), [
    master({ medicineId: '650', strength: '650 mg' }),
    master({ medicineId: '500', strength: '500 mg' })
  ]);
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.medicine, null);
});

test('does not return a catalogue record for conflicting active ingredients', () => {
  const result = rankMedicineMasterMatches(storeProduct(), [master({ composition: 'Ibuprofen', genericName: 'Ibuprofen' })]);
  assert.equal(result.status, 'NO_MATCH');
  assert.equal(result.medicine, null);
});

test('returns no match for an empty store identity', () => {
  const result = rankMedicineMasterMatches({ name: '', genericName: '' }, [master()]);
  assert.equal(result.status, 'NO_MATCH');
  assert.equal(result.candidatesChecked, 0);
});
