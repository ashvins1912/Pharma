import assert from 'node:assert/strict';
import test from 'node:test';
import { mapMedicineMatchBatch, medicineMatchIdentity, MedicineMatchReference } from './medicine-match-reference.js';

test('normalizes equivalent product identities to the same stable reference key', () => {
  const first = medicineMatchIdentity({ name: 'Dolo 650', genericName: 'Paracetamol', strength: '650 mg', form: 'Tablet', manufacturer: 'Micro Labs' });
  const second = medicineMatchIdentity({ name: 'dolo-650', genericName: 'paracetamol', strength: '650mg', dosageForm: 'tablet', manufacturer: 'micro labs' });
  assert.equal(first.identityHash, second.identityHash);
});

test('keeps different strengths and dosage forms in separate match references', () => {
  const base = medicineMatchIdentity({ name: 'Dolo', genericName: 'Paracetamol', strength: '650 mg', form: 'Tablet' });
  const strength = medicineMatchIdentity({ name: 'Dolo', genericName: 'Paracetamol', strength: '500 mg', form: 'Tablet' });
  const form = medicineMatchIdentity({ name: 'Dolo', genericName: 'Paracetamol', strength: '650 mg', form: 'Syrup' });
  assert.notEqual(base.identityHash, strength.identityHash);
  assert.notEqual(base.identityHash, form.identityHash);
});

test('does not create a match identity for an empty product', () => {
  const result = medicineMatchIdentity({});
  assert.equal(result.normalizedIdentity, '||||||');
});

test('manufacturer is excluded from the persistent match-reference identity', () => {
  const first = medicineMatchIdentity({ name: 'Aceflam S', brand: 'Aceflam', manufacturer: 'Manufacturer A' });
  const second = medicineMatchIdentity({ name: 'Aceflam S', brand: 'Aceflam', manufacturer: 'Manufacturer B' });
  assert.equal(first.identityHash, second.identityHash);
  assert.equal(first.normalizedIdentity, second.normalizedIdentity);
});


test('processes match rows concurrently within the configured bound and preserves result order', async () => {
  let active = 0;
  let peak = 0;
  const results = await mapMedicineMatchBatch([0, 1, 2, 3, 4, 5], 2, async value => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(results, [0, 2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
});

test('handles empty match batches without invoking the mapper', async () => {
  let called = false;
  const results = await mapMedicineMatchBatch([], 8, async () => { called = true; });
  assert.deepEqual(results, []);
  assert.equal(called, false);
});


test('stores admin-approved target and field-level mapping provenance', () => {
  assert.equal(MedicineMatchReference.schema.path('mappingStatus').defaultValue, 'PENDING');
  assert.ok(MedicineMatchReference.schema.path('mappedMedicineId'));
  assert.ok(MedicineMatchReference.schema.path('mappedFields'));
  assert.ok(MedicineMatchReference.schema.path('mappedBy'));
  assert.ok(MedicineMatchReference.schema.path('mappedAt'));
  assert.ok(MedicineMatchReference.schema.path('mappingHistory'));
});
