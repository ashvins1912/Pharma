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
    brandName: String(product?.name || product?.brand || '').trim(),
    genericName: String(product?.genericName || '').trim(),
    composition: String(product?.composition || '').trim(),
    strength: String(product?.strength || '').trim(),
    dosageForm: String(product?.dosageForm || product?.form || '').trim(),
    manufacturer: String(product?.manufacturer || '').trim()
  };

  if (!incoming.brandName && !incoming.genericName && !incoming.composition) {
    return { status: 'NO_MATCH', confidence: 0, medicine: null, candidatesChecked: 0 };
  }

  const ranked = (Array.isArray(candidates) ? candidates : []).map(candidate => {
    const evidence = scoreMedicineMatch(incoming, candidate);
    const exactBrand = normalizeIdentity(incoming.brandName) !== ''
      && normalizeIdentity(incoming.brandName) === normalizeIdentity(candidate.brandName || candidate.productName);
    const exactGeneric = normalizeIdentity(incoming.genericName) !== ''
      && normalizeIdentity(incoming.genericName) === normalizeIdentity(candidate.genericName);
    const conflicts = (evidence.warnings || []).filter(warning => CONFLICT_WARNINGS.has(warning));
    const strengthComparable = Boolean(incoming.strength && candidate.strength);
    const formComparable = Boolean(incoming.dosageForm && candidate.dosageForm);
    const strengthExact = !strengthComparable || evidence.warnings.includes('STRENGTH_CONFLICT') === false;
    const formExact = !formComparable || evidence.warnings.includes('DOSAGE_FORM_CONFLICT') === false;
    const score = Math.round(
      evidence.score * 0.72
      + (exactBrand ? 18 : exactGeneric ? 10 : 0)
      + (incoming.manufacturer && candidate.manufacturer
        && normalizeIdentity(incoming.manufacturer) === normalizeIdentity(candidate.manufacturer) ? 4 : 0)
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
  const margin = runnerUp ? best.score - runnerUp.score : 100;
  const exactIdentity = best.exactBrand || best.exactGeneric;
  const completeClinicalIdentity = Boolean(incoming.strength && incoming.dosageForm);
  const safeExact = exactIdentity
    && (!completeClinicalIdentity || (best.strengthExact && best.formExact))
    && (!runnerUp || margin >= 8);
  const safeStrong = best.score >= 92
    && best.nameScore >= 90
    && margin >= 8
    && (best.exactGeneric || best.exactBrand);

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
