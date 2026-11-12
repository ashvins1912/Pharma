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
  return candidateStrengths.length > 0 && !extracted.strengths.every(item => candidateStrengths.includes(String(item.value) + item.unit));
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
    const names = [item.name, item.brandName, item.productName].filter(Boolean);
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
    const formConflict = Boolean(extracted.dosageForm && candidateForm
      && !candidateForm.includes(extracted.dosageForm) && !extracted.dosageForm.includes(candidateForm));
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
