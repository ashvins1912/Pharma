import { scoreMedicineMatch } from './medicine-catalogue-import-routes.js';

const normalizeIdentity = value => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const CONFLICT_WARNINGS = new Set([
  'STRENGTH_CONFLICT',
  'DOSAGE_FORM_CONFLICT',
  'COMPOSITION_CONFLICT',
  'GENERIC_INGREDIENT_CONFLICT'
]);

/**
 * Match a tenant's sellable inventory product to the shared Medicine Master.
 * This is a read-only linkage decision; it never changes inventory or catalogue data.
 */
export function rankMedicineMasterMatches(product, candidates) {
  const incoming = {
    brandName: String(product?.brand || product?.name || '').trim(),
    genericName: String(product?.genericName || '').trim(),
    composition: String(product?.composition || '').trim(),
    strength: String(product?.strength || '').trim(),
    dosageForm: String(product?.dosageForm || product?.form || '').trim()
  };

  if (!incoming.brandName && !incoming.genericName && !incoming.composition) {
    return { status: 'NO_MATCH', confidence: 0, medicine: null, candidatesChecked: 0 };
  }

  const ranked = (Array.isArray(candidates) ? candidates : []).map(candidate => {
    const evidence = scoreMedicineMatch(incoming, candidate);
    const incomingNameKeys = [incoming.brandName, product?.name]
      .map(normalizeIdentity).filter(Boolean);
    const candidateNameKeys = [candidate.brandName, candidate.productName]
      .map(normalizeIdentity).filter(Boolean);
    const exactBrand = incomingNameKeys.some(name => candidateNameKeys.includes(name));
    const exactGeneric = normalizeIdentity(incoming.genericName) !== ''
      && normalizeIdentity(incoming.genericName) === normalizeIdentity(candidate.genericName);
    const packSizeConflict = Boolean(product?.packSize && candidate.packSize
      && normalizeIdentity(product.packSize) !== normalizeIdentity(candidate.packSize));
    const conflicts = [
      ...(evidence.warnings || []).filter(warning => CONFLICT_WARNINGS.has(warning)),
      ...(packSizeConflict ? ['PACK_SIZE_CONFLICT'] : [])
    ];
    const strengthComparable = Boolean(incoming.strength && candidate.strength);
    const formComparable = Boolean(incoming.dosageForm && candidate.dosageForm);
    const strengthExact = !strengthComparable || evidence.warnings.includes('STRENGTH_CONFLICT') === false;
    const formExact = !formComparable || evidence.warnings.includes('DOSAGE_FORM_CONFLICT') === false;
    const score = Math.round(
      evidence.score * 0.72
      + (exactBrand ? 18 : exactGeneric ? 10 : 0)
    );
    return {
      candidate,
      score: Math.min(100, score),
      nameScore: evidence.nameScore,
      exactBrand,
      exactGeneric,
      conflicts,
      strengthExact,
      formExact,
      evidence
    };
  }).sort((a, b) => b.score - a.score || String(a.candidate.medicineId).localeCompare(String(b.candidate.medicineId)));

  if (!ranked.length) return { status: 'NO_MATCH', confidence: 0, medicine: null, candidatesChecked: 0 };

  const eligible = ranked.filter(item => item.conflicts.length === 0 && item.strengthExact && item.formExact);
  if (!eligible.length) return { status: 'NO_MATCH', confidence: 0, medicine: null, candidatesChecked: ranked.length };

  const best = eligible[0];
  const runnerUp = eligible[1];
  const hasUnresolvedStrengthVariants = !incoming.strength
    && new Set(eligible.map(item => normalizeIdentity(item.candidate.strength)).filter(Boolean)).size > 1;
  const hasUnresolvedFormVariants = !incoming.dosageForm
    && new Set(eligible.map(item => normalizeIdentity(item.candidate.dosageForm)).filter(Boolean)).size > 1;
  const unresolvedVariant = hasUnresolvedStrengthVariants || hasUnresolvedFormVariants;
  const margin = runnerUp ? best.score - runnerUp.score : 100;
  const exactIdentity = best.exactBrand;
  const completeClinicalIdentity = Boolean(incoming.strength && incoming.dosageForm);
  const safeExact = exactIdentity
    && !unresolvedVariant
    && (!completeClinicalIdentity || (best.strengthExact && best.formExact))
    && (!runnerUp || margin >= 8);
  const safeStrong = !unresolvedVariant
    && best.score >= 92
    && best.nameScore >= 90
    && margin >= 8
    && best.exactBrand;

  if (!safeExact && !safeStrong) {
    return {
      status: eligible.length > 1 ? 'AMBIGUOUS' : 'NO_CONFIDENT_MATCH',
      confidence: best.score,
      medicine: null,
      candidatesChecked: ranked.length,
      alternatives: eligible.slice(0, 3).map(item => ({
        brandName: item.candidate.brandName,
        genericName: item.candidate.genericName,
        strength: item.candidate.strength,
        dosageForm: item.candidate.dosageForm,
        score: item.score
      }))
    };
  }

  const match = best.candidate;
  return {
    status: safeExact ? 'EXACT' : 'STRONG',
    confidence: best.score,
    candidatesChecked: ranked.length,
    medicine: {
      medicineId: match.medicineId,
      brandName: match.brandName,
      productName: match.productName,
      genericName: match.genericName,
      composition: match.composition,
      strength: match.strength,
      packSize: match.packSize,
      dosageForm: match.dosageForm,
      medicineType: match.medicineType,
      manufacturer: match.manufacturer,
      therapeuticClass: match.therapeuticClass,
      chemicalClass: match.chemicalClass,
      actionClass: match.actionClass,
      routes: match.routes,
      indications: match.indications,
      uses: match.uses,
      contraindications: match.contraindications,
      sideEffects: match.sideEffects,
      drugInteractions: match.drugInteractions,
      habitForming: match.habitForming,
      requiresPrescription: match.requiresPrescription,
      prescriptionVerification: match.prescriptionVerification,
      clinicalDataVerification: match.clinicalDataVerification,
      dataQualityStatus: match.dataQualityStatus
    }
  };
}
