import {
  normalizeMedicineKey as key,
  tokenSortRatio,
  charNgramDice,
  tfIdfNgramCosine,
  fieldSimilarity,
  normalizeStrength,
  normalizeDosageForm
} from '@pharma/algorithm-kernel';

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
