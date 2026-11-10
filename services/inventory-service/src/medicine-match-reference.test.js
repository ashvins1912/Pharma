import assert from 'node:assert/strict';
import test from 'node:test';
import { medicineMatchIdentity } from './medicine-match-reference.js';

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
