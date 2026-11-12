import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMedicineKey,
  normalizeSimilarityText,
  levenshteinRatio,
  tokenSortRatio,
  characterNgrams,
  buildNameNgramIdf,
  tfIdfNgramCosine,
  charNgramDice,
  fieldSimilarity,
  normalizeStrength,
  normalizeDosageForm,
  CharacterNgramCandidateIndex
} from '../src/index.js';

test('medicine key normalization handles accents, punctuation and empty values', () => {
  assert.equal(normalizeMedicineKey('  Café-Paracetamol 500mg '), 'cafe paracetamol 500mg');
  assert.equal(normalizeMedicineKey(null), '');
});

test('similarity text normalizes strengths and dosage-form synonyms', () => {
  assert.equal(normalizeSimilarityText('Paracetamol 500mg Tablets'), 'paracetamol 500 mg tablet');
  assert.equal(normalizeSimilarityText('Dolo 650 MG'), 'dolo 650 mg');
});

test('edit and token-sort similarity are deterministic and bounded', () => {
  assert.equal(levenshteinRatio('', ''), 100);
  assert.equal(levenshteinRatio('a', ''), 0);
  assert.equal(tokenSortRatio('500mg Dolo', 'Dolo 500mg'), 100);
  assert.ok(levenshteinRatio('paracetamol', 'parasetamol') > 80);
});

test('character n-grams and Dice similarity handle short and empty inputs', () => {
  assert.deepEqual(characterNgrams(''), ['   ', '   ']);
  assert.equal(charNgramDice('', ''), 100);
  assert.equal(charNgramDice('a', 'a'), 100);
  assert.equal(charNgramDice('a', 'b'), 0);
  assert.ok(charNgramDice('paracetamol', 'parasetamol') > 70);
});

test('TF-IDF cosine and IDF construction handle empty catalogues', () => {
  assert.equal(tfIdfNgramCosine('', '', new Map()), 0);
  const idf = buildNameNgramIdf([{ brandName: 'Dolo 650' }, { brandName: 'Dolo 500' }]);
  assert.ok(idf instanceof Map);
  assert.ok(tfIdfNgramCosine('Dolo 650', 'Dolo 650', idf) >= 99);
});

test('strength and dosage form normalization preserve clinical units', () => {
  assert.equal(normalizeStrength('500 mcg'), '0.5mg');
  assert.equal(normalizeStrength('1 g'), '1000mg');
  assert.equal(normalizeStrength('10 mg'), '10mg');
  assert.equal(normalizeDosageForm('Tablets'), 'tablet');
  assert.equal(normalizeDosageForm('oral drops'), 'oral drop');
  assert.equal(fieldSimilarity('Paracetamol', 'Paracetamol'), 100);
});

test('inverted n-gram candidate retrieval finds first-character typos and ranks overlap', () => {
  const records = [
    { medicineId: '1', brandName: 'Paracetamol 500 Tablet' },
    { medicineId: '2', brandName: 'Pantoprazole 40 Tablet' },
    { medicineId: '3', brandName: 'Azithromycin 500 Tablet' }
  ];
  const index = new CharacterNgramCandidateIndex(records);
  const result = index.search('Xaracetamol 500 Tablet');
  assert.ok(result.candidates.some(item => item.record.medicineId === '1'));
  assert.equal(result.candidates[0].record.medicineId, '1');
  assert.equal(result.truncated, false);
});

test('candidate retrieval reports truncation instead of hiding omitted candidates', () => {
  const records = Array.from({ length: 4 }, (_, index) => ({
    medicineId: String(index), brandName: 'Paracetamol 500 Tablet'
  }));
  const result = new CharacterNgramCandidateIndex(records).search('Paracetamol 500 Tablet', { limit: 2 });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.total, 4);
  assert.equal(result.truncated, true);
});

test('candidate retrieval marks one-character names as insufficient evidence', () => {
  const result = new CharacterNgramCandidateIndex([{ brandName: 'A' }]).search('A');
  assert.equal(result.matchedGrams, 0);
  assert.deepEqual(result.candidates, []);
});

test('candidate query terms sample across long names', () => {
  const terms = CharacterNgramCandidateIndex.searchTerms('alpha bravo charlie delta echo foxtrot golf hotel', { limit: 4 });
  assert.equal(terms.length, 4);
  assert.ok(new Set(terms).size === 4);
});
