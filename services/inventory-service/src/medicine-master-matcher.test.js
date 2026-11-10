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

test('manufacturer differences do not affect product matching or confidence', () => {
  const incoming = storeProduct({ manufacturer: 'Different Manufacturer' });
  const candidate = master({ manufacturer: 'Original Manufacturer' });
  const result = rankMedicineMasterMatches(incoming, [candidate]);
  const sameManufacturerResult = rankMedicineMasterMatches(
    storeProduct({ manufacturer: 'Original Manufacturer' }),
    [candidate]
  );
  assert.equal(result.status, 'EXACT');
  assert.equal(result.medicine.medicineId, 'master-001');
  assert.equal(result.confidence, sameManufacturerResult.confidence);
});

test('missing manufacturer does not prevent an otherwise safe product match', () => {
  const result = rankMedicineMasterMatches(storeProduct({ manufacturer: '' }), [master()]);
  assert.equal(result.status, 'EXACT');
  assert.equal(result.medicine.medicineId, 'master-001');
});

test('surfaces a shared brand stem as a review candidate without auto-linking suffix variants', () => {
  const result = rankMedicineMasterMatches(
    storeProduct({
      name: 'Aceflam S',
      brand: 'Aceflam',
      genericName: '',
      composition: '',
      strength: '',
      dosageForm: ''
    }),
    [master({
      medicineId: 'aceflam-p',
      brandName: "ACEFLAM P TABLET 10'S",
      productName: "ACEFLAM P TABLET 10'S",
      genericName: '',
      composition: '',
      strength: '',
      dosageForm: ''
    })]
  );

  assert.equal(result.status, 'NO_CONFIDENT_MATCH');
  assert.equal(result.medicine, null);
  assert.equal(result.alternatives[0].brandName, "ACEFLAM P TABLET 10'S");
  assert.equal(result.alternatives[0].matchReason, 'SHARED_BRAND_STEM_REVIEW_REQUIRED');
});
