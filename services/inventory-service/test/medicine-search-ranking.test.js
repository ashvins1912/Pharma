import test from 'node:test';
import assert from 'node:assert/strict';
import { rankInventorySearchCandidates } from '../src/medicine-search-ranking.js';

const products = [
  { _id: 'dolo650', name: 'Dolo 650 Tablet', genericName: 'Paracetamol', strength: '650 mg' },
  { _id: 'dolo500', name: 'Dolo 500 Tablet', genericName: 'Paracetamol', strength: '500 mg' },
  { _id: 'para500', name: 'Paracetamol 500 Tablet', genericName: 'Paracetamol', strength: '500 mg' }
];

test('fuzzy fallback finds a real product for a likely speech transcription typo', () => {
  const matches = rankInventorySearchCandidates('doloo 650', products);
  assert.equal(matches[0]?.product._id, 'dolo650');
  assert.ok(matches[0]?.score >= 70);
});

test('spoken Indian dosage phrase is normalized before matching', () => {
  const matches = rankInventorySearchCandidates('Dolo six fifty', products);
  assert.equal(matches[0]?.product._id, 'dolo650');
});

test('a conflicting strength is never returned as a fuzzy result', () => {
  const matches = rankInventorySearchCandidates('Dolo 650', [products[1]]);
  assert.deepEqual(matches, []);
});

test('a brand-only search can return real strength variants without choosing one', () => {
  const matches = rankInventorySearchCandidates('Dolo', products);
  assert.deepEqual(matches.map(match => match.product._id), ['dolo500', 'dolo650']);
});

test('unknown medicine names do not produce invented results', () => {
  const matches = rankInventorySearchCandidates('NotARealMedicine 999', products);
  assert.deepEqual(matches, []);
});
