import test from 'node:test';
import assert from 'node:assert/strict';
import { compareItem, extractPrescribedQuantity } from './PrescriptionVerificationService.js';

test('matches exact medicine name and strength', () => {
  const result = compareItem(
    { productId: 'p1', name: 'Amoxicillin 500mg Tablet', strength: '500mg', quantity: 10 },
    {
      rawName: 'Amoxicillin 500mg',
      normalizedName: 'Amoxicillin 500mg',
      strength: { value: 500, unit: 'mg' },
      course: { calculatedQuantity: 15 }
    }
  );
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.quantityMatch, true);
});

test('rejects quantity above prescribed course', () => {
  const result = compareItem(
    { productId: 'p1', name: 'Paracetamol 650mg', strength: '650mg', quantity: 20 },
    {
      rawName: 'Paracetamol 650mg',
      normalizedName: 'Paracetamol 650mg',
      strength: { value: 650, unit: 'mg' },
      course: { calculatedQuantity: 10 }
    }
  );
  assert.equal(result.status, 'MISMATCH');
  assert.equal(result.quantityMatch, false);
});

test('extracts explicit prescribed quantity before falling back to calculated quantity', () => {
  assert.equal(extractPrescribedQuantity({ course: { value: 12, calculatedQuantity: 20 } }), 12);
  assert.equal(extractPrescribedQuantity({ course: { calculatedQuantity: 20 } }), 20);
});
