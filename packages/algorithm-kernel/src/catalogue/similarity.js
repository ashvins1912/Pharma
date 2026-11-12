/**
 * Shared deterministic catalogue similarity primitives.
 * Scores are percentages [0, 100]. Clinical decisions remain in domain services.
 */
export const normalizeMedicineKey = value => String(value ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/[\\u0000-\\u001f]/g, ' ')
  .replace(/\\s+/g, ' ').trim()
  .normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const normalizeSimilarityText = value => normalizeMedicineKey(value)
  .replace(/\\b(\\d+(?:\\.\\d+)?)\\s*(mcg|mg|gm|g|ml|iu|%)\\b/g, '$1 $2')
  .replace(/\\b(tablets|tabs|capsules|caps|sachets|vials)\\b/g,
    match => ({ tablets: 'tablet', tabs: 'tab', capsules: 'capsule', caps: 'cap', sachets: 'sachet', vials: 'vial' })[match]);

export function levenshteinRatio(left, right) {
  const a = normalizeMedicineKey(left), b = normalizeMedicineKey(right);
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return Math.round((1 - previous[b.length] / Math.max(a.length, b.length)) * 100);
}

export const tokenSortRatio = (left, right) => levenshteinRatio(
  normalizeSimilarityText(left).split(' ').filter(Boolean).sort().join(' '),
  normalizeSimilarityText(right).split(' ').filter(Boolean).sort().join(' ')
);

export function characterNgrams(value) {
  const normalized = normalizeSimilarityText(value).replace(/\\s+/g, ' ').trim();
  const padded = '  ' + normalized + '  ';
  const grams = [];
  for (let i = 0; i <= padded.length - 3; i += 1) grams.push(padded.slice(i, i + 3));
  return grams;
}

export function buildNameNgramIdf(candidates = []) {
  const documentFrequency = new Map();
  let documents = 0;
  for (const candidate of candidates) {
    if (!candidate?.brandName) continue;
    documents += 1;
    for (const gram of new Set(characterNgrams(candidate.brandName))) {
      documentFrequency.set(gram, (documentFrequency.get(gram) || 0) + 1);
    }
  }
  return new Map([...documentFrequency].map(([gram, frequency]) =>
    [gram, Math.log((documents + 1) / (frequency + 1)) + 1]));
}

export function tfIdfNgramCosine(left, right, idf = null) {
  const vector = value => {
    const counts = new Map();
    for (const gram of characterNgrams(value)) counts.set(gram, (counts.get(gram) || 0) + 1);
    const weighted = new Map();
    for (const [gram, count] of counts) weighted.set(gram, count * (idf?.get(gram) || 1));
    return weighted;
  };
  const a = vector(left), b = vector(right);
  let dot = 0, normA = 0, normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  for (const [gram, value] of a) dot += value * (b.get(gram) || 0);
  if (!normA || !normB) return 0;
  return Math.round((dot / Math.sqrt(normA * normB)) * 100);
}

export function charNgramDice(left, right) {
  const a = normalizeSimilarityText(left).replace(/\\s+/g, ' ');
  const b = normalizeSimilarityText(right).replace(/\\s+/g, ' ');
  if (!a || !b) return a === b ? 100 : 0;
  if (a === b) return 100;
  const n = Math.min(3, Math.max(2, Math.min(a.length, b.length)));
  const grams = value => {
    const result = new Map();
    for (let i = 0; i <= value.length - n; i += 1) {
      const gram = value.slice(i, i + n);
      result.set(gram, (result.get(gram) || 0) + 1);
    }
    return result;
  };
  const leftGrams = grams(a), rightGrams = grams(b);
  let overlap = 0, leftTotal = 0, rightTotal = 0;
  for (const count of leftGrams.values()) leftTotal += count;
  for (const count of rightGrams.values()) rightTotal += count;
  for (const [gram, count] of leftGrams) overlap += Math.min(count, rightGrams.get(gram) || 0);
  return Math.round((2 * overlap / Math.max(1, leftTotal + rightTotal)) * 100);
}

export const fieldSimilarity = (left, right) =>
  Math.round(tokenSortRatio(left, right) * 0.65 + charNgramDice(left, right) * 0.35);

export const normalizeStrength = value => normalizeMedicineKey(value)
  .replace(/(\\d+(?:\\.\\d+)?)\\s*(mcg|mg|gm|g|ml|iu|%)\\b/g, (_, amount, unit) => {
    const numeric = Number(amount);
    if (unit === 'mcg') return String(Number((numeric / 1000).toFixed(6))) + 'mg';
    if (unit === 'g' || unit === 'gm') return String(Number((numeric * 1000).toFixed(6))) + 'mg';
    return String(numeric) + unit;
  });

export const normalizeDosageForm = value => normalizeMedicineKey(value)
  .replace(/\\btablets\\b/g, 'tablet').replace(/\\bcapsules\\b/g, 'capsule')
  .replace(/\\bcaplets\\b/g, 'caplet').replace(/\\bvials\\b/g, 'vial')
  .replace(/\\bampoules\\b/g, 'ampoule').replace(/\\bsachets\\b/g, 'sachet')
  .replace(/\\bdrops\\b/g, 'drop').replace(/\\bpatches\\b/g, 'patch');
