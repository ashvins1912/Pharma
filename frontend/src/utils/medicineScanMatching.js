import {
  calculateDamerauLevenshteinSimilarity,
  calculateEnsembleSimilarity,
  calculateJaroWinklerSimilarity,
  normalizeText
} from './similarity.js';

const FORM_ALIASES = {
  tab: 'tablet', tabs: 'tablet', tablets: 'tablet', tbl: 'tablet',
  cap: 'capsule', caps: 'capsule', capsules: 'capsule',
  syp: 'syrup', syr: 'syrup', susp: 'suspension',
  inj: 'injection', drops: 'drop', oint: 'ointment'
};
const FORM_TERMS = ['tablet', 'capsule', 'syrup', 'suspension', 'injection', 'cream', 'ointment', 'drop', 'gel', 'powder', 'solution'];

const clean = value => normalizeText(String(value || '')
  .replace(/[®™©]/g, '')
  .replace(/\b(?:mrp|price|inclusive of all taxes|prescription required|prescription only)\b.*$/i, '')
  .replace(/₹\s*[\d,.]+|\b(?:rs\.?|inr)\s*[\d,.]+/gi, ' ')
  .replace(/\s+/g, ' '));

export function isValidGtin(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  let weight = 3;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

export function extractMedicineLabelDetails(rawText = '') {
  const text = String(rawText || '').replace(/\r/g, '\n');
  const normalized = clean(text);
  const barcodeCandidates = [...new Set((text.match(/(?:\d[\s-]*){8,14}/g) || [])
    .map(value => value.replace(/\D/g, '')).filter(isValidGtin))];
  const strengthMatches = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|µg|g|gm|ml|iu|%)\b/gi)]
    .map(match => ({ value: Number(match[1]), unit: match[2].toLowerCase().replace('µg', 'mcg').replace('gm', 'g'), raw: match[0] }));
  const form = FORM_TERMS.find(term => new RegExp('\\b' + term + '\\b', 'i').test(text))
    || Object.entries(FORM_ALIASES).find(([alias]) => new RegExp('\\b' + alias + '\\b', 'i').test(text))?.[1]
    || null;
  const packMatch = text.match(/\b(?:pack\s*of\s*)?(\d{1,4})\s*(?:tabs?|tablets?|caps?|capsules?|vials?|sachets?)\b/i)
    || text.match(/\b(\d{1,3})\s*[x×]\s*(\d{1,4})\b/i);
  const packSize = packMatch ? Number(packMatch[2] || packMatch[1]) * Number(packMatch[2] ? packMatch[1] : 1) : null;
  const batch = text.match(/\b(?:batch|b\.?no\.?|lot)\s*[:#-]?\s*([A-Z0-9/-]{2,24})\b/i)?.[1] || null;
  const expiry = text.match(/\b(?:exp(?:iry|iration)?\.?)\s*[:#-]?\s*((?:0?[1-9]|1[0-2])[/-]\d{2,4}|\d{2}[/-](?:0?[1-9]|1[0-2]))\b/i)?.[1] || null;
  const manufacturer = text.match(/\b(?:mfg\.?\s*by|manufactured\s*by|marketed\s*by)\s*[:\-]?\s*([^\n,;]{3,100})/i)?.[1]?.trim() || null;
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const likelyNameLine = lines.find(line => /[a-z]{3,}/i.test(line)
    && !/\b(?:mg|mcg|ml|iu|batch|b\.?no|exp|mfg|manufactured|marketed|mrp|price)\b/i.test(line)
    && !/^\d[\d\s/-]*$/.test(line)) || '';
  const name = clean(likelyNameLine).slice(0, 120);
  return {
    rawText: text.slice(0, 5000), normalizedText: normalized.slice(0, 5000), name,
    strengths: strengthMatches.slice(0, 8), dosageForm: form, packSize,
    barcode: barcodeCandidates.length === 1 ? barcodeCandidates[0] : null,
    barcodeCandidates, batchNumber: batch, expiry, manufacturer,
    needsReview: barcodeCandidates.length > 1 || !name || !strengthMatches.length || !form
  };
}

function tokens(value) {
  return new Set(clean(value).split(/\s+/).filter(token => token.length > 1));
}
function tokenCoverage(left, right) {
  const source = [...tokens(left)];
  const target = tokens(right);
  if (!source.length || !target.size) return 0;
  return source.filter(token => target.has(token)).length / source.length;
}
function hasStrengthConflict(extracted, candidate) {
  if (!extracted.strengths.length) return false;
  const candidateText = [candidate.strength, candidate.composition, candidate.name, candidate.brandName, candidate.genericName].filter(Boolean).join(' ');
  const candidateStrengths = [...candidateText.matchAll(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|µg|g|gm|ml|iu|%)\b/gi)]
    .map(match => String(Number(match[1])) + match[2].toLowerCase().replace('µg', 'mcg').replace('gm', 'g'));
  return candidateStrengths.length === 0 || !extracted.strengths.every(item => candidateStrengths.includes(String(item.value) + item.unit));
}

export function rankScannedMedicineCandidates(extracted, catalogue = [], { minimumScore = 0.86, minimumMargin = 0.10 } = {}) {
  if (!extracted || !Array.isArray(catalogue) || !catalogue.length) {
    return { status: 'NO_MATCH', best: null, alternatives: [], confidence: 0, reason: 'EMPTY_CATALOGUE_OR_SCAN' };
  }
  const valid = catalogue.filter(item => item && typeof item === 'object');
  if (extracted.barcode) {
    const barcodeMatches = valid.filter(item =>
      [item.barcode, item.gtin, item.ean, item.upc].some(value => isValidGtin(value) && String(value).replace(/\D/g, '') === extracted.barcode));
    if (barcodeMatches.length === 1 && !hasStrengthConflict(extracted, barcodeMatches[0])) {
      return { status: 'MATCHED', best: barcodeMatches[0], alternatives: [], confidence: 1, reason: 'EXACT_GTIN' };
    }
    if (barcodeMatches.length > 1) {
      return { status: 'REVIEW_REQUIRED', best: null, alternatives: barcodeMatches.slice(0, 5), confidence: 1, reason: 'DUPLICATE_GTIN' };
    }
  }
  const ranked = valid.map(item => {
    const names = [item.name, item.brandName, item.brand, item.productName].filter(Boolean);
    const generics = [item.genericName, item.composition].filter(Boolean);
    const nameScore = Math.max(0, ...names.map(value => Math.max(
      calculateEnsembleSimilarity(extracted.name, value),
      calculateJaroWinklerSimilarity(extracted.name, value),
      calculateDamerauLevenshteinSimilarity(extracted.name, value),
      tokenCoverage(extracted.name, value))));
    const genericScore = generics.length
      ? Math.max(0, ...generics.map(value => {
        const overlap = tokenCoverage(extracted.normalizedText, value);
        // Packaging OCR often omits the generic line. Treat absent generic
        // evidence as neutral instead of penalizing an otherwise strong brand
        // match; when generic tokens are present, use the full ensemble score.
        if (overlap === 0) return 0.5;
        return Math.max(
          calculateEnsembleSimilarity(extracted.normalizedText, value),
          calculateJaroWinklerSimilarity(extracted.normalizedText, value),
          overlap
        );
      }))
      : 0.5;
    const strengthConflict = hasStrengthConflict(extracted, item);
    const candidateForm = clean(item.dosageForm || item.form);
    const formConflict = Boolean(extracted.dosageForm && (!candidateForm
      || (!candidateForm.includes(extracted.dosageForm) && !extracted.dosageForm.includes(candidateForm))));
    const strengthEvidence = extracted.strengths.length ? (strengthConflict ? 0 : 1) : 0.5;
    const formEvidence = extracted.dosageForm ? (formConflict ? 0 : 1) : 0.5;
    const candidateManufacturer = item.manufacturer || item.brand || item.brandName;
    const manufacturerEvidence = extracted.manufacturer && candidateManufacturer
      ? (clean(extracted.manufacturer).includes(clean(candidateManufacturer)) || clean(candidateManufacturer).includes(clean(extracted.manufacturer)) ? 1 : 0)
      : 0.5;
    const score = (nameScore * 0.65) + (genericScore * 0.15) + (strengthEvidence * 0.10)
      + (formEvidence * 0.05) + (manufacturerEvidence * 0.05);
    return { item, score, strengthConflict, formConflict };
  }).filter(match => !match.strengthConflict && !match.formConflict)
    .sort((a, b) => b.score - a.score || String(a.item.name || '').localeCompare(String(b.item.name || '')));
  const best = ranked[0] || null;
  const runnerUp = ranked[1] || null;
  const margin = best ? best.score - (runnerUp?.score || 0) : 0;
  const confident = Boolean(best && best.score >= minimumScore && margin >= minimumMargin
    && extracted.name && extracted.strengths.length && extracted.dosageForm);
  return {
    status: confident ? 'MATCHED' : best ? 'REVIEW_REQUIRED' : 'NO_MATCH',
    best: confident ? best.item : null,
    alternatives: ranked.slice(0, 5).map(match => ({
      product: match.item, score: Math.round(match.score * 100),
      strengthConflict: match.strengthConflict, formConflict: match.formConflict
    })),
    confidence: Math.round((best?.score || 0) * 100) / 100,
    reason: !best ? 'NO_COMPATIBLE_CATALOGUE_PRODUCT'
      : !extracted.strengths.length ? 'STRENGTH_NOT_READ'
      : !extracted.dosageForm ? 'DOSAGE_FORM_NOT_READ'
      : margin < minimumMargin ? 'AMBIGUOUS_CANDIDATES'
      : best.score < minimumScore ? 'LOW_MATCH_SCORE' : 'MATCHED'
  };
}


/**
 * General catalogue suggestion matcher for typed search, prescription OCR and
 * product discovery. Uses an ensemble of phonetic, edit-distance, Jaro-Winkler,
 * token overlap and prefix/substring evidence. It only ranks real catalogue
 * rows; it never substitutes a strength or silently selects a candidate.
 */
export function rankMedicineTextMatches(query, catalogue = [], { limit = 5, minimumScore = 0.48 } = {}) {
  const rawQuery = String(query || '').trim();
  const normalizedQuery = clean(rawQuery);
  if (normalizedQuery.length < 2 || !Array.isArray(catalogue) || !catalogue.length) {
    return { alternatives: [], confidence: 0, reason: 'INSUFFICIENT_QUERY_OR_CATALOGUE' };
  }

  const queryStrengths = [...normalizedQuery.matchAll(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|%)\b/gi)]
    .map(match => String(Number(match[1])) + match[2].toLowerCase());
  const queryForms = FORM_TERMS.filter(form => new RegExp('\\b' + form + '\\b', 'i').test(normalizedQuery));
  const queryTokens = normalizedQuery.split(/\s+/).filter(token => token.length > 1);
  const unique = new Set();

  const ranked = catalogue.filter(item => item && typeof item === 'object').map(product => {
    const identity = String(product.productId || product._id || product.medicineId || product.sku || [
      product.name, product.strength, product.dosageForm || product.form
    ].join('|'));
    if (unique.has(identity)) return null;
    unique.add(identity);

    const nameFields = [product.name, product.productName, product.brandName, product.brand]
      .filter(value => typeof value === 'string' && value.trim());
    const genericFields = [product.genericName, product.composition]
      .filter(value => typeof value === 'string' && value.trim());
    const candidateName = nameFields[0] || genericFields[0] || '';
    const identityFields = [...nameFields, ...genericFields];
    const candidateIdentity = clean(identityFields.join(' '));
    const candidateText = clean([
      ...identityFields, product.strength, product.dosageForm, product.form,
      product.manufacturer, product.packSize, product.pack
    ].filter(Boolean).join(' '));

    const nameScore = Math.max(0, ...identityFields.map(field => {
      const target = clean(field);
      const exact = target === normalizedQuery ? 1 : 0;
      const contains = target.includes(normalizedQuery) || normalizedQuery.includes(target) ? 0.94 : 0;
      const tokenSet = new Set(target.split(/\s+/).filter(Boolean));
      const overlap = queryTokens.length
        ? queryTokens.filter(token => tokenSet.has(token)).length / queryTokens.length
        : 0;
      return Math.max(exact, contains, overlap,
        calculateEnsembleSimilarity(normalizedQuery, target),
        calculateJaroWinklerSimilarity(normalizedQuery, target),
        calculateDamerauLevenshteinSimilarity(normalizedQuery, target));
    }));

    const candidateStrengths = [...candidateText.matchAll(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|%)\b/gi)]
      .map(match => String(Number(match[1])) + match[2].toLowerCase());
    const strengthConflict = queryStrengths.length > 0 && candidateStrengths.length > 0
      && !queryStrengths.every(value => candidateStrengths.includes(value));
    const strengthUnknown = queryStrengths.length > 0 && candidateStrengths.length === 0;
    const candidateForm = clean(product.dosageForm || product.form);
    const formConflict = queryForms.length > 0 && candidateForm
      && !queryForms.some(form => candidateForm.includes(form) || form.includes(candidateForm));
    const formUnknown = queryForms.length > 0 && !candidateForm;

    const queryKey = normalizeText(normalizedQuery);
    const candidateKey = normalizeText(candidateIdentity);
    const phonetic = queryKey.length >= 4 && getPhoneticKey(queryKey) === getPhoneticKey(candidateKey) ? 1 : 0;
    const genericEvidence = genericFields.length
      ? Math.max(0, ...genericFields.map(value => calculateEnsembleSimilarity(normalizedQuery, value)))
      : 0;
    let score = (nameScore * 0.72) + (genericEvidence * 0.18) + (phonetic * 0.10);
    if (strengthConflict || formConflict) score = 0;
    else {
      if (strengthUnknown) score *= 0.88;
      if (formUnknown) score *= 0.92;
    }
    const reasons = [];
    if (strengthConflict) reasons.push('Strength conflict');
    else if (strengthUnknown) reasons.push('Strength not listed');
    if (formConflict) reasons.push('Dosage-form conflict');
    else if (formUnknown) reasons.push('Dosage form not listed');
    if (genericEvidence > 0.7) reasons.push('Generic/composition similarity');
    if (phonetic) reasons.push('Phonetic similarity');
    return {
      product, name: candidateName, score: Math.round(Math.min(1, score) * 100),
      rawScore: score, reasons, strengthConflict, formConflict,
      reviewRequired: strengthUnknown || formUnknown || score < 0.86
    };
  }).filter(Boolean)
    .filter(match => match.rawScore >= minimumScore && !match.strengthConflict && !match.formConflict)
    .sort((a, b) => b.rawScore - a.rawScore || String(a.name).localeCompare(String(b.name)));

  return {
    alternatives: ranked.slice(0, Math.max(1, limit)),
    confidence: ranked[0]?.score || 0,
    reason: !ranked.length ? 'NO_COMPATIBLE_CATALOGUE_MATCH' : 'SUGGESTIONS_REQUIRE_USER_REVIEW'
  };
}
