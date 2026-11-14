const text = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
const key = value => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const levenshteinRatio = (left, right) => {
  const a = key(left), b = key(right);
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return Math.round((1 - previous[b.length] / Math.max(a.length, b.length)) * 100);
};
const similarityText = value => key(value)
  .replace(/\b(\d+(?:\.\d+)?)\s*(mcg|mg|gm|g|ml|iu|%)\b/g, '$1 $2')
  .replace(/\b(tablets|tabs|capsules|caps|sachets|vials)\b/g, match => ({ tablets: 'tablet', tabs: 'tab', capsules: 'capsule', caps: 'cap', sachets: 'sachet', vials: 'vial' })[match]);
const tokenSortRatio = (left, right) => levenshteinRatio(similarityText(left).split(' ').filter(Boolean).sort().join(' '), similarityText(right).split(' ').filter(Boolean).sort().join(' '));
const characterNgrams = value => {
  const normalized = similarityText(value).replace(/\s+/g, ' ').trim();
  const padded = '  ' + normalized + '  ';
  const grams = [];
  for (let i = 0; i <= padded.length - 3; i += 1) grams.push(padded.slice(i, i + 3));
  return grams;
};
const tfIdfNgramCosine = (left, right, idf = null) => {
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
};
const charNgramDice = (left, right) => {
  const a = similarityText(left).replace(/\s+/g, ' ');
  const b = similarityText(right).replace(/\s+/g, ' ');
  if (!a || !b) return a === b ? 100 : 0;
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
};
const fieldSimilarity = (left, right) => Math.round(tokenSortRatio(left, right) * 0.65 + charNgramDice(left, right) * 0.35);
const normalizeStrength = value => key(value).replace(/(\d+(?:\.\d+)?)\s*(mcg|mg|gm|g|ml|iu|%)\b/g, (_, amount, unit) => {
  const numeric = Number(amount);
  if (unit === 'mcg') return String(Number((numeric / 1000).toFixed(6))) + 'mg';
  if (unit === 'g' || unit === 'gm') return String(Number((numeric * 1000).toFixed(6))) + 'mg';
  return String(numeric) + unit;
});
const normalizeDosageForm = value => key(value)
  .replace(/\btablets\b/g, 'tablet').replace(/\bcapsules\b/g, 'capsule')
  .replace(/\bcaplets\b/g, 'caplet').replace(/\bvials\b/g, 'vial')
  .replace(/\bampoules\b/g, 'ampoule').replace(/\bsachets\b/g, 'sachet')
  .replace(/\bdrops\b/g, 'drop').replace(/\bpatches\b/g, 'patch');
export function scoreMedicineMatch(incoming, candidate, options = {}) {
  const tokenNameScore = tokenSortRatio(incoming.brandName, candidate.brandName);
  const ngramNameScore = charNgramDice(incoming.brandName, candidate.brandName);
  const tfIdfNameScore = tfIdfNgramCosine(incoming.brandName, candidate.brandName, options.nameNgramIdf);
  const nameScore = Math.round(tokenNameScore * 0.55 + tfIdfNameScore * 0.45);
  const aComposition = key(incoming.composition || (incoming.ingredients || []).join(' '));
  const bComposition = key(candidate.composition || (candidate.ingredients || []).join(' '));
  const compositionScore = aComposition && bComposition ? fieldSimilarity(aComposition, bComposition) : null;
  const aStrength = normalizeStrength(incoming.strength), bStrength = normalizeStrength(candidate.strength);
  const aForm = normalizeDosageForm(incoming.dosageForm), bForm = normalizeDosageForm(candidate.dosageForm);
  const strengthConflict = Boolean(aStrength && bStrength && aStrength !== bStrength);
  const formConflict = Boolean(aForm && bForm && aForm !== bForm);
  const compositionConflict = compositionScore !== null && compositionScore < 90;
  const genericScore = incoming.genericName && candidate.genericName ? fieldSimilarity(incoming.genericName, candidate.genericName) : null;
  const genericConflict = genericScore !== null && genericScore < 80;
  const blocked = strengthConflict || formConflict || compositionConflict;
  // Fellegi-Sunter-inspired evidence weighting. These are conservative initial weights,
  // not trained m/u probabilities; calibrate them against adjudicated medicine pairs.
  const evidence = [
    { field: 'brandName', score: nameScore, weight: 0.35, available: Boolean(incoming.brandName && candidate.brandName) },
    { field: 'composition', score: compositionScore, weight: 0.40, available: compositionScore !== null },
    { field: 'genericName', score: genericScore, weight: 0.15, available: genericScore !== null },
    { field: 'strength', score: aStrength && bStrength ? (strengthConflict ? 0 : 100) : null, weight: 0.07, available: Boolean(aStrength && bStrength) },
    { field: 'dosageForm', score: aForm && bForm ? (formConflict ? 0 : 100) : null, weight: 0.03, available: Boolean(aForm && bForm) }
  ];
  const evidenceWeight = evidence.filter(item => item.available).reduce((sum, item) => sum + item.weight, 0);
  const score = evidenceWeight ? Math.round(evidence.reduce((sum, item) => sum + (item.available ? item.score * item.weight : 0), 0) / evidenceWeight) : 0;
  const autoMerge = !blocked && !genericConflict && compositionScore !== null && compositionScore >= 96 && nameScore >= 94 &&
    score >= 97 && Boolean(aStrength && bStrength && aForm && bForm);
  const review = !blocked && (genericConflict || (nameScore >= 78 && (score >= 78 || compositionScore === null)));
  return {
    score, nameScore, tokenNameScore, ngramNameScore, tfIdfNameScore, compositionScore, genericScore,
    evidence: evidence.filter(item => item.available).map(({ field, score: fieldScore, weight }) => ({ field, score: fieldScore, weight })),
    decision: blocked ? 'BLOCKED_CONFLICT' : autoMerge ? 'AUTO_MERGE' : review ? 'MANUAL_REVIEW' : 'NO_MATCH',
    warnings: [
      ...(strengthConflict ? ['STRENGTH_CONFLICT'] : []),
      ...(formConflict ? ['DOSAGE_FORM_CONFLICT'] : []),
      ...(compositionConflict ? ['COMPOSITION_CONFLICT'] : []),
      ...(genericConflict ? ['GENERIC_INGREDIENT_CONFLICT'] : []),
      ...(compositionScore === null ? ['COMPOSITION_MISSING_REVIEW_REQUIRED'] : []),
      ...(!incoming.manufacturer || !candidate.manufacturer ? ['MANUFACTURER_NOT_COMPARABLE'] : [])
    ]
  };
}
