import test from 'node:test';
import assert from 'node:assert/strict';
import { rankVoiceMedicineMatches } from '../src/utils/similarity.js';

const catalogue = [
  { medicineId: 'dolo-650', brandName: 'Dolo', name: 'Dolo 650 Tablet', strength: '650 mg', dosageForm: 'Tablet' },
  { medicineId: 'dolo-500', brandName: 'Dolo', name: 'Dolo 500 Tablet', strength: '500 mg', dosageForm: 'Tablet' },
  { medicineId: 'para-500', brandName: 'Paracetamol', name: 'Paracetamol 500 Tablet', strength: '500 mg', dosageForm: 'Tablet' }
];

test('normalizes common Indian spoken strength phrases and selects a matching catalogue item', () => {
  const result = rankVoiceMedicineMatches('Dolo six fifty', catalogue);
  assert.equal(result.isConfident, true);
  assert.equal(result.best.item.medicineId, 'dolo-650');
});

test('uses phonetic evidence for a clear transcription typo without crossing strengths', () => {
  const result = rankVoiceMedicineMatches('doloo 650', catalogue);
  assert.equal(result.isConfident, true);
  assert.equal(result.best.item.medicineId, 'dolo-650');
});

test('does not guess a strength when the customer omits it', () => {
  const result = rankVoiceMedicineMatches('Dolo', catalogue);
  assert.equal(result.isConfident, false);
  assert.equal(result.reason, 'STRENGTH_REQUIRED');
});

test('rejects a conflicting strength instead of suggesting the wrong variant', () => {
  const result = rankVoiceMedicineMatches('Dolo 650', [catalogue[1]]);
  assert.equal(result.isConfident, false);
  assert.equal(result.best, null);
});

test('does not invent a medicine that is absent from the selected pharmacy catalogue', () => {
  const result = rankVoiceMedicineMatches('Augmentin 625', catalogue);
  assert.equal(result.isConfident, false);
  assert.equal(result.best, null);
});

test('does not refine to a medicine with a conflicting dosage form', () => {
  const tabletOnly = [{ medicineId: 'dolo-tablet', name: 'Dolo 650 Tablet', strength: '650 mg', dosageForm: 'Tablet' }];
  const result = rankVoiceMedicineMatches('Dolo 650 capsule', tabletOnly);
  assert.equal(result.isConfident, false);
  assert.equal(result.best, null);
});

test('ambiguous spoken medicine names are offered for confirmation before product search', () => {
  const result = rankVoiceMedicineMatches('Dolo', catalogue);
  assert.equal(result.isConfident, false);
  assert.ok(result.alternatives.length > 0);
  assert.equal(result.alternatives.some(item => item.name === 'Dolo 650 Tablet'), true);
});

test('an explicitly selected catalogue suggestion can be searched without retaining the voice dialog', () => {
  const result = rankVoiceMedicineMatches('Dolo 650 Tablet', catalogue);
  assert.equal(result.isConfident, true);
  assert.equal(result.best.name, 'Dolo 650 Tablet');
});
