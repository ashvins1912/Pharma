import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMedicineLabelDetails, isValidGtin, rankScannedMedicineCandidates } from '../src/utils/medicineScanMatching.js';

const catalogue = [
  { _id: '1', name: 'Dolo 650', genericName: 'Paracetamol', strength: '650 mg', dosageForm: 'Tablet', manufacturer: 'Micro Labs' },
  { _id: '2', name: 'Dolo 500', genericName: 'Paracetamol', strength: '500 mg', dosageForm: 'Tablet', manufacturer: 'Micro Labs' },
  { _id: '3', name: 'Dolo 650 Syrup', genericName: 'Paracetamol', strength: '650 mg', dosageForm: 'Syrup', manufacturer: 'Micro Labs' }
];

test('validates GTIN check digits and rejects malformed values', () => {
  assert.equal(isValidGtin('8901080000018'), true);
  assert.equal(isValidGtin('8901080000019'), false);
  assert.equal(isValidGtin('12345'), false);
});

test('extracts medicine name, strength, form, pack and batch details', () => {
  const result = extractMedicineLabelDetails('Dolo 650\n650 mg Tablet\nPack of 15 tablets\nBatch: AB123\nExp: 08/2027\nMfg by Micro Labs');
  assert.match(result.name, /dolo 650/i);
  assert.equal(result.strengths[0].value, 650);
  assert.equal(result.dosageForm, 'tablet');
  assert.equal(result.packSize, 15);
  assert.equal(result.batchNumber, 'AB123');
  assert.equal(result.expiry, '08/2027');
  assert.equal(result.manufacturer, 'Micro Labs');
});

test('rejects a strength-conflicting candidate and chooses the exact strength/form', () => {
  const extracted = extractMedicineLabelDetails('Dolo 650\n650 mg Tablet');
  const result = rankScannedMedicineCandidates(extracted, catalogue);
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.best._id, '1');
});

test('ambiguous matches require review instead of arbitrary selection', () => {
  const extracted = extractMedicineLabelDetails('Paracetamol\n650 mg Tablet');
  const result = rankScannedMedicineCandidates(extracted, [
    { _id: 'a', name: 'Paracetamol 650', strength: '650 mg', dosageForm: 'Tablet' },
    { _id: 'b', name: 'Paracetamol 650', strength: '650 mg', dosageForm: 'Tablet' }
  ]);
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.best, null);
});

test('does not auto-match when strength or dosage form is missing', () => {
  const extracted = extractMedicineLabelDetails('Dolo 650');
  const result = rankScannedMedicineCandidates(extracted, catalogue);
  assert.notEqual(result.status, 'MATCHED');
});
