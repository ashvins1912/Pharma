import { normalizeSimilarityText } from './similarity.js';

function nameGrams(value) {
  const tokens = normalizeSimilarityText(value).split(' ').filter(Boolean);
  const grams = new Set();
  for (const token of tokens) {
    const size = token.length >= 3 ? 3 : token.length === 2 ? 2 : 0;
    if (!size) continue;
    for (let index = 0; index <= token.length - size; index += 1) {
      grams.add(token.slice(index, index + size));
    }
  }
  return grams;
}

/**
 * Build an in-memory inverted index for typo-tolerant catalogue candidate retrieval.
 * This only discovers/ranks candidates; callers must apply domain-specific validation.
 */
export class CharacterNgramCandidateIndex {
  constructor(records = [], { getName = record => record?.brandName } = {}) {
    this.records = [];
    this.postings = new Map();
    for (const record of records) this.add(record, getName(record));
  }

  add(record, name) {
    const index = this.records.length;
    this.records.push(record);
    for (const gram of nameGrams(name)) {
      if (!this.postings.has(gram)) this.postings.set(gram, new Set());
      this.postings.get(gram).add(index);
    }
    return this;
  }

  search(query, { limit = 1000 } = {}) {
    const grams = nameGrams(query);
    if (!grams.size) return { candidates: [], total: 0, truncated: false, matchedGrams: 0 };
    const overlaps = new Map();
    for (const gram of grams) {
      for (const index of this.postings.get(gram) || []) {
        overlaps.set(index, (overlaps.get(index) || 0) + 1);
      }
    }
    const ranked = [...overlaps].map(([index, overlap]) => ({
      record: this.records[index],
      overlap,
      coverage: overlap / grams.size
    })).sort((left, right) =>
      right.overlap - left.overlap ||
      right.coverage - left.coverage ||
      String(left.record?.medicineId || left.record?._id || '').localeCompare(String(right.record?.medicineId || right.record?._id || ''))
    );
    const safeLimit = Math.max(1, Math.floor(Number(limit) || 1));
    return {
      candidates: ranked.slice(0, safeLimit),
      total: ranked.length,
      truncated: ranked.length > safeLimit,
      matchedGrams: grams.size
    };
  }

  static searchTerms(query, { limit = 24 } = {}) {
    const terms = [...nameGrams(query)];
    const safeLimit = Math.max(1, Math.floor(Number(limit) || 1));
    if (terms.length <= safeLimit) return terms;
    // Sample across the complete name instead of retaining only alphabetically early grams.
    return Array.from({ length: safeLimit }, (_, index) =>
      terms[Math.floor(index * terms.length / safeLimit)]);
  }
}
