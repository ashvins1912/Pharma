import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { requireServiceScope } from './service-auth.js';

const router = express.Router();
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MAX_CATALOGUE_UPLOAD_BYTES = 110 * 1024 * 1024;
const CATALOGUE_CHUNK_SIZE = 500;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_CATALOGUE_UPLOAD_BYTES, files: 1 } });
const text = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
const key = value => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hash = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
const PICK_CACHE = new WeakMap();
const pick = (record, ...names) => {
  if (!record || typeof record !== 'object') return undefined;
  let normalized = PICK_CACHE.get(record);
  if (!normalized) {
    normalized = new Map();
    for (const [field, value] of Object.entries(record)) normalized.set(key(field).replace(/ /g, ''), value);
    PICK_CACHE.set(record, normalized);
  }
  for (const name of names) {
    const value = normalized.get(key(name).replace(/ /g, ''));
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return undefined;
};
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
  .replace(/\\b(\\d+(?:\\.\\d+)?)\\s*(mcg|mg|gm|g|ml|iu|%)\\b/g, '$1 $2')
  .replace(/\\b(tablets|tabs|capsules|caps|sachets|vials)\\b/g, match => ({ tablets: 'tablet', tabs: 'tab', capsules: 'capsule', caps: 'cap', sachets: 'sachet', vials: 'vial' })[match]);
const tokenSortRatio = (left, right) => levenshteinRatio(similarityText(left).split(' ').filter(Boolean).sort().join(' '), similarityText(right).split(' ').filter(Boolean).sort().join(' '));
const normalizeStrength = value => key(value).replace(/(\\d)\\s+(mcg|mg|gm|g|ml|iu)\\b/g, '$1$2');
export function scoreMedicineMatch(incoming, candidate) {
  const nameScore = tokenSortRatio(incoming.brandName, candidate.brandName);
  const aComposition = key(incoming.composition || (incoming.ingredients || []).join(' '));
  const bComposition = key(candidate.composition || (candidate.ingredients || []).join(' '));
  const compositionScore = aComposition && bComposition ? tokenSortRatio(aComposition, bComposition) : null;
  const aStrength = normalizeStrength(incoming.strength), bStrength = normalizeStrength(candidate.strength);
  const aForm = key(incoming.dosageForm), bForm = key(candidate.dosageForm);
  const strengthConflict = Boolean(aStrength && bStrength && aStrength !== bStrength);
  const formConflict = Boolean(aForm && bForm && aForm !== bForm);
  const compositionConflict = compositionScore !== null && compositionScore < 90;
  const blocked = strengthConflict || formConflict || compositionConflict;
  const genericScore = incoming.genericName && candidate.genericName ? tokenSortRatio(incoming.genericName, candidate.genericName) : null;
  const score = Math.round(nameScore * 0.65 + (compositionScore === null ? 0 : compositionScore * 0.20) +
    (aStrength && bStrength && !strengthConflict ? 10 : 0) + (aForm && bForm && !formConflict ? 5 : 0));
  const autoMerge = !blocked && compositionScore !== null && compositionScore >= 94 && nameScore >= 92 && score >= 96 && (genericScore === null || genericScore >= 80);
  const review = !blocked && nameScore >= 82 && score >= 82;
  return {
    score: Math.min(100, score), nameScore, compositionScore, genericScore,
    decision: blocked ? 'BLOCKED_CONFLICT' : autoMerge ? 'AUTO_MERGE' : review ? 'MANUAL_REVIEW' : 'NO_MATCH',
    warnings: [
      ...(strengthConflict ? ['STRENGTH_CONFLICT'] : []),
      ...(formConflict ? ['DOSAGE_FORM_CONFLICT'] : []),
      ...(compositionConflict ? ['COMPOSITION_CONFLICT'] : []),
      ...(compositionScore === null ? ['COMPOSITION_MISSING_REVIEW_REQUIRED'] : []),
      ...(!incoming.manufacturer || !candidate.manufacturer ? ['MANUFACTURER_NOT_COMPARABLE'] : [])
    ]
  };
}
const fuzzyCandidatePrefixes = records => [...new Set(records.map(item => key(item.brandName).slice(0, 2)).filter(value => value.length === 2))].slice(0, 120);
const bool = value => typeof value === 'boolean' ? value : ['true', 'yes', '1'].includes(text(value).toLowerCase());
const cleanRetailProductName = value => text(value).split(/\b(?:mrp|price|inclusive of all taxes|prescription required|prescription only)\b|₹|\bRs\.?\s*\d/i)[0].replace(/[|,;\-–]+\s*$/, '').trim();
const cleanDosageForm = value => {
  const source = key(value);
  const forms = ['softgel capsule','softgel','oral suspension','dry syrup','tablet','capsule','syrup','suspension','injection','cream','ointment','gel','drops','spray','inhaler','powder','solution','lotion','suppository','sachet','granules','patch','vial','ampoule','lozenge','mouthwash'];
  const matches = forms.filter(form => source.includes(form));
  const normalized = matches.filter(form => !(form === 'gel' && source.includes('softgel')));
  return normalized.map(form => form.split(' ').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')).join(', ');
};
const isPlaceholder = value => ['na', 'n a', 'n/a', 'not available', 'none', 'null', '-'].includes(key(value));
const cleanSourceValue = value => isPlaceholder(value) ? '' : text(value);
const splitList = value => {
  const seen = new Set(); const result = [];
  for (const item of (Array.isArray(value) ? value : [value])) {
    if (typeof item !== 'string') continue;
    for (const part of item.split(/[;|]+/)) {
      const cleaned = cleanSourceValue(part); const identity = key(cleaned);
      if (cleaned && !seen.has(identity)) { seen.add(identity); result.push(cleaned); }
    }
  }
  return result;
};
const alignedValues = value => (Array.isArray(value) ? value : [value]).map(cleanSourceValue);
const normalizeAlternatives = value => {
  const seenIds = new Set(); const seenNames = new Set(); const result = [];
  for (const raw of (Array.isArray(value) ? value : [])) {
    const item = typeof raw === 'string'
      ? { brandName: text(raw), medicineId: '', source: 'SUGGESTED_NAME', verification: 'UNVERIFIED' }
      : { medicineId: text(raw?.brandIdentifier), brandName: text(raw?.brandName), source: 'SOURCE_LINK', verification: 'UNVERIFIED' };
    const nameKey = key(item.brandName);
    if (!item.brandName || (item.medicineId && seenIds.has(item.medicineId)) || seenNames.has(nameKey)) continue;
    if (item.medicineId) seenIds.add(item.medicineId); seenNames.add(nameKey); result.push(item);
  }
  return result;
};

const medicineMasterSchema = new mongoose.Schema({
  medicineId: { type: String, required: true, unique: true, index: true },
  canonicalKey: { type: String, default: '', index: true },
  brandName: { type: String, required: true, trim: true },
  genericName: { type: String, default: '' },
  genericId: { type: String, default: '' },
  sourceLicenseStatusValue: { type: String, default: '' }, drugFormId: { type: String, default: '' }, routeIds: { type: [String], default: [] },
  casNumbers: { type: [String], default: [] }, uniiCodes: { type: [String], default: [] }, substanceDescriptions: { type: [String], default: [] },
  molecularFormulas: { type: [String], default: [] }, inchiValues: { type: [String], default: [] }, iupacNames: { type: [String], default: [] },
  molecularWeights: { type: [String], default: [] }, smiles: { type: [String], default: [] }, toxicology: { type: [String], default: [] },
  ingredientDetails: { type: [mongoose.Schema.Types.Mixed], default: [] },
  productId: { type: String, default: '' },
  productName: { type: String, default: '' },
  manufacturer: { type: String, default: '' },
  manufacturerId: { type: String, default: '' },
  ingredientIds: { type: [String], default: [] },
  ingredients: { type: [String], default: [] },
  composition: { type: String, default: '' },
  strength: { type: String, default: '' },
  packSize: { type: String, default: '' },
  dosageForm: { type: String, default: '' },
  medicineType: { type: String, default: '' },
  routes: { type: [String], default: [] },
  alternatives: { type: [mongoose.Schema.Types.Mixed], default: [] },
  indications: { type: [String], default: [] },
  contraindications: { type: [String], default: [] },
  drugInteractions: { type: [String], default: [] },
  sideEffects: { type: [String], default: [] },
  uses: { type: [String], default: [] },
  suggestedAlternatives: { type: [String], default: [] },
  chemicalClass: { type: String, default: '' },
  habitForming: { type: String, enum: ['YES', 'NO', 'UNKNOWN'], default: 'UNKNOWN' },
  therapeuticClass: { type: String, default: '' },
  actionClass: { type: String, default: '' },
  sourceImageUrl: { type: String, default: '' },
  requiresPrescription: { type: Boolean, default: null },
  prescriptionVerification: { type: String, enum: ['UNVERIFIED', 'VERIFIED'], default: 'UNVERIFIED' },
  clinicalDataVerification: { type: String, enum: ['UNVERIFIED', 'VERIFIED'], default: 'UNVERIFIED' },
  sourceLicenseStatus: { type: String, enum: ['UNVERIFIED', 'CLEARED', 'RESTRICTED'], default: 'UNVERIFIED' },
  dataQualityStatus: { type: String, enum: ['GOOD', 'PARTIAL', 'NEEDS_REVIEW'], default: 'PARTIAL' },
  qualityScore: { type: Number, min: 0, max: 100, default: 0 },
  qualityGrade: { type: String, enum: ['EXCELLENT', 'GOOD', 'PARTIAL', 'NEEDS_REVIEW'], default: 'NEEDS_REVIEW' },
  qualityIssues: { type: [String], default: [] },
  sourcePriority: { type: Number, default: 99 },
  sourceDatasets: { type: [String], default: [] },
  sourceRecordIds: { type: [String], default: [] },
  legacyMedicineIds: { type: [String], default: [] },
  lastImportBatchId: { type: String, default: '' },
  lastVerifiedAt: { type: Date, default: null },
  lastManuallyUpdatedBy: { type: String, default: '' },
  lastManuallyUpdatedAt: { type: Date, default: null }
}, { timestamps: true });
medicineMasterSchema.index({ brandName: 'text', genericName: 'text', composition: 'text', manufacturer: 'text', uses: 'text', sideEffects: 'text', therapeuticClass: 'text', chemicalClass: 'text', actionClass: 'text' });
medicineMasterSchema.index({ brandName: 1 }, { collation: { locale: 'en', strength: 2 } });
const catalogueImportSchema = new mongoose.Schema({
  batchId: { type: String, required: true, unique: true },
  dataset: { type: String, enum: ['INDIAN_MEDICINE_DATA', 'INDIA_MEDICINES_INFO', 'MEDICINES_PART_1', 'MULTI_SOURCE'], required: true },
  fileName: { type: String, required: true },
  fileSha256: { type: String, required: true },
  uploadedBy: { type: String, required: true },
  status: { type: String, enum: ['STAGING', 'READY', 'PUBLISHING', 'PUBLISHED', 'PARTIALLY_PUBLISHED', 'FAILED', 'SUPERSEDED'], default: 'READY', index: true },
  recordCount: { type: Number, default: 0 },
  chunkCount: { type: Number, default: 0 },
  records: { type: [mongoose.Schema.Types.Mixed], default: [] },
  report: { type: mongoose.Schema.Types.Mixed, default: {} },
  publishedCount: { type: Number, default: 0 },
  errorMessage: { type: String, default: '' },
  reportFingerprint: { type: String, default: '' },
  sourceBatchIds: { type: [String], default: [] },
  supersededByBatchId: { type: String, default: '' },
  approvedBy: { type: String, default: '' },
  approvedAt: { type: Date, default: null }
}, { timestamps: true });
catalogueImportSchema.index({ dataset: 1, fileSha256: 1 }, { unique: true });
const MedicineMaster = mongoose.models.MedicineMaster || mongoose.model('MedicineMaster', medicineMasterSchema);
const CatalogueImport = mongoose.models.MedicineCatalogueImport || mongoose.model('MedicineCatalogueImport', catalogueImportSchema);
const catalogueImportChunkSchema = new mongoose.Schema({
  batchId: { type: String, required: true, index: true },
  chunkIndex: { type: Number, required: true },
  records: { type: [mongoose.Schema.Types.Mixed], required: true }
}, { timestamps: true });
catalogueImportChunkSchema.index({ batchId: 1, chunkIndex: 1 }, { unique: true });
const CatalogueImportChunk = mongoose.models.MedicineCatalogueImportChunk || mongoose.model('MedicineCatalogueImportChunk', catalogueImportChunkSchema);

export function* parseJsonArrayRecords(buffer) {
  let index = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
  const whitespace = byte => byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
  while (index < buffer.length && whitespace(buffer[index])) index += 1;
  if (buffer[index++] !== 0x5b) throw Object.assign(new Error('The uploaded JSON array is malformed.'), { statusCode: 400 });
  while (index < buffer.length) {
    while (index < buffer.length && whitespace(buffer[index])) index += 1;
    if (buffer[index] === 0x5d) {
      index += 1;
      while (index < buffer.length && whitespace(buffer[index])) index += 1;
      if (index !== buffer.length) throw Object.assign(new Error('Unexpected content after the JSON array.'), { statusCode: 400 });
      return;
    }
    if (buffer[index] !== 0x7b) throw Object.assign(new Error('The medicine JSON must be an array of objects.'), { statusCode: 400 });
    const start = index;
    let depth = 0, inString = false, escaped = false, complete = false;
    for (; index < buffer.length; index += 1) {
      const byte = buffer[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (byte === 0x5c) escaped = true;
        else if (byte === 0x22) inString = false;
        continue;
      }
      if (byte === 0x22) inString = true;
      else if (byte === 0x7b || byte === 0x5b) depth += 1;
      else if (byte === 0x7d || byte === 0x5d) {
        depth -= 1;
        if (depth === 0) { index += 1; complete = true; break; }
      }
    }
    if (!complete || inString || depth !== 0) throw Object.assign(new Error('The uploaded JSON contains an incomplete record.'), { statusCode: 400 });
    let record;
    try { record = JSON.parse(buffer.toString('utf8', start, index)); }
    catch { throw Object.assign(new Error('The uploaded JSON contains an invalid record.'), { statusCode: 400 }); }
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw Object.assign(new Error('The medicine JSON must be an array of objects.'), { statusCode: 400 });
    yield record;
    while (index < buffer.length && whitespace(buffer[index])) index += 1;
    if (buffer[index] === 0x2c) index += 1;
    else if (buffer[index] !== 0x5d) throw Object.assign(new Error('The uploaded JSON array has an invalid separator.'), { statusCode: 400 });
  }
  throw Object.assign(new Error('The uploaded JSON array is incomplete.'), { statusCode: 400 });
}

export function detectMedicineDataset(payload) {
  if (payload && !Array.isArray(payload) && Array.isArray(payload.drugDetails)) return 'INDIAN_MEDICINE_DATA';
  if (Array.isArray(payload) && payload.length && ('id' in (payload[0] || {}) && 'name' in (payload[0] || {}) && ('sideEffect0' in (payload[0] || {}) || 'use0' in (payload[0] || {})))) return 'MEDICINES_PART_1';
  if (Array.isArray(payload) && payload.length && ('Medicine Name' in (payload[0] || {}) || 'Product Name' in (payload[0] || {}))) return 'INDIA_MEDICINES_INFO';
  throw Object.assign(new Error('Unsupported JSON. Upload the drugDetails object or the India Medicines and Drug Info array.'), { statusCode: 400 });
}

export function normalizeMedicineRecord(raw, dataset) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (dataset === 'INDIAN_MEDICINE_DATA') {
    const brandName = text(pick(raw, 'brandName'));
    if (!brandName) return null;
    const ingredients = splitList(pick(raw, 'substanceName'));
    const composition = ingredients.join(', ');
    const strength = text(pick(raw, 'strength', 'compositionStrength'));
    const dosageForm = text(pick(raw, 'doseForm'));
    const genericName = text(pick(raw, 'genericName'));
    const medicineId = text(pick(raw, 'brandIdentifier'));
    if (!medicineId) return null;
    const identity = [key(brandName), key(composition), key(strength), key(dosageForm)].join('|');
    return {
      medicineId, canonicalKey: composition ? identity : '',
      brandName, genericName, genericId: text(pick(raw, 'genericIdentifier')),
      sourceLicenseStatusValue: text(pick(raw, 'licenseStatus')), drugFormId: text(pick(raw, 'drugFormIdentifier')),
      routeIds: splitList(pick(raw, 'routeOfAdministrationIdentifier')), casNumbers: alignedValues(pick(raw, 'casNumber')), uniiCodes: alignedValues(pick(raw, 'unii')),
      substanceDescriptions: alignedValues(pick(raw, 'substanceDescription')), molecularFormulas: alignedValues(pick(raw, 'molecularFormula')),
      inchiValues: alignedValues(pick(raw, 'inChl')), iupacNames: alignedValues(pick(raw, 'iupacName')), molecularWeights: alignedValues(pick(raw, 'molecularWeight')),
      smiles: alignedValues(pick(raw, 'smile')), toxicology: alignedValues(pick(raw, 'toxity', 'toxicity')),
      ingredientDetails: ingredients.map((name, index) => ({ ingredientId: splitList(pick(raw, 'substanceIdentifier'))[index] || '', name, casNumber: alignedValues(pick(raw, 'casNumber'))[index] || '', unii: alignedValues(pick(raw, 'unii'))[index] || '', description: alignedValues(pick(raw, 'substanceDescription'))[index] || '', molecularFormula: alignedValues(pick(raw, 'molecularFormula'))[index] || '', inchi: alignedValues(pick(raw, 'inChl'))[index] || '', iupacName: alignedValues(pick(raw, 'iupacName'))[index] || '', molecularWeight: alignedValues(pick(raw, 'molecularWeight'))[index] || '', smiles: alignedValues(pick(raw, 'smile'))[index] || '' })),
      productId: text(pick(raw, 'productIdentifier')), productName: text(pick(raw, 'productName')),
      manufacturer: text(pick(raw, 'supplierName')), manufacturerId: text(pick(raw, 'supplierIdentifier')),
      ingredientIds: splitList(pick(raw, 'substanceIdentifier')), ingredients, composition, strength, dosageForm, medicineType: '',
      routes: splitList(pick(raw, 'routeOfAdministrationName')),
      alternatives: normalizeAlternatives(raw.alternativeDrugs).filter(item => item.medicineId !== medicineId && key(item.brandName) !== key(brandName)),
      indications: [cleanSourceValue(pick(raw, 'indication'))].filter(Boolean),
      contraindications: [cleanSourceValue(pick(raw, 'contraIndication'))].filter(Boolean),
      drugInteractions: [cleanSourceValue(pick(raw, 'interactionWithDrugs'))].filter(Boolean),
      sourceImageUrl: '', requiresPrescription: null, prescriptionVerification: 'UNVERIFIED',
      sourcePriority: 1, sourceDataset: dataset, sourceRecordId: medicineId,
      dataQualityStatus: composition && dosageForm && genericName ? 'GOOD' : 'PARTIAL'
    };
  }
  if (dataset === 'MEDICINES_PART_1') {
    const brandName = text(pick(raw, 'name'));
    const sourceRecordId = text(pick(raw, 'id'));
    if (!brandName || !sourceRecordId) return null;
    const strengthMatch = brandName.match(/\b\d+(?:\.\d+)?\s?(?:mcg|mg|g|ml|iu|%)(?:\b|\/)/i);
    const strength = strengthMatch ? strengthMatch[0].replace(/\s+/g, ' ').trim() : '';
    const dosageForm = cleanDosageForm(brandName);
    const collected = new Map();
    const collect = prefix => {
      if (collected.has(prefix)) return collected.get(prefix);
      const seen = new Set(); const values = [];
      for (let index = 0, limit = prefix === 'sideEffect' ? 42 : 5; index < limit; index += 1) {
        const value = cleanSourceValue(raw[`${prefix}${index}`]); const identity = key(value);
        if (value && !seen.has(identity)) { seen.add(identity); values.push(value); }
      }
      collected.set(prefix, values); return values;
    };
    const identity = [key(brandName), key(strength), key(dosageForm)].join('|');
    return {
      medicineId: `MEDINFO-${sourceRecordId}`, canonicalKey: '', brandName, genericName: '', genericId: '',
      productId: '', productName: brandName, manufacturer: '', manufacturerId: '', sourceLicenseStatusValue: '', drugFormId: '', routeIds: [], casNumbers: [], uniiCodes: [], substanceDescriptions: [], molecularFormulas: [], inchiValues: [], iupacNames: [], molecularWeights: [], smiles: [], toxicology: [], ingredientDetails: [], ingredientIds: [], ingredients: [],
      composition: '', strength, packSize: '', dosageForm, medicineType: dosageForm, routes: [], alternatives: [],
      indications: [], contraindications: [], drugInteractions: [], sideEffects: collect('sideEffect'), uses: collect('use'),
      suggestedAlternatives: collect('substitute'), alternatives: normalizeAlternatives(collect('substitute')), chemicalClass: cleanSourceValue(pick(raw, 'Chemical Class')),
      habitForming: ['yes', 'no'].includes(text(pick(raw, 'Habit Forming')).toLowerCase()) ? text(pick(raw, 'Habit Forming')).toUpperCase() : 'UNKNOWN',
      therapeuticClass: cleanSourceValue(pick(raw, 'Therapeutic Class')), actionClass: cleanSourceValue(pick(raw, 'Action Class')),
      sourceImageUrl: '', requiresPrescription: null, prescriptionVerification: 'UNVERIFIED',
      sourcePriority: 3, sourceDataset: dataset, sourceRecordId, dataQualityStatus: 'PARTIAL',
      sourceFingerprint: hash(JSON.stringify([identity, collect('sideEffect'), collect('use'), collect('substitute'), pick(raw, 'Chemical Class'), pick(raw, 'Habit Forming'), pick(raw, 'Therapeutic Class'), pick(raw, 'Action Class')]))
    };
  }
  const brandName = text(pick(raw, 'Medicine Name')) || text(pick(raw, 'Product Name'));
  if (!brandName) return null;
  const productName = cleanRetailProductName(pick(raw, 'Product Name'));
  const composition = text(pick(raw, 'Composition'));
  const packMatch = productName.match(/\b(?:pack of\s*)?\d+(?:\.\d+)?\s?(?:tablets?|tabs?|capsules?|caps?|ml|g|gm|strips?|sachets?|vials?)\b/i);
  const packSize = packMatch ? packMatch[0].replace(/\s+/g, ' ').trim() : '';
  const medicineType = text(pick(raw, 'Type of Medicine'));
  const dosageForm = cleanDosageForm(medicineType);
  const strengthMatch = (brandName + ' ' + productName + ' ' + composition).match(/\b\d+(?:\.\d+)?\s?(?:mcg|mg|g|ml|iu|%)(?:\b|\/)/i);
  const strength = strengthMatch ? strengthMatch[0].replace(/\s+/g, ' ').trim() : '';
  const identity = [key(brandName), key(composition), key(strength), key(dosageForm), key(packSize)].join('|');
  const stableIdentity = composition ? identity : [key(brandName), key(productName), key(dosageForm), key(packSize)].join('|');
  const sourceRecordId = hash(stableIdentity).slice(0, 24);
  const image = text(pick(raw, 'Image URL'));
  return {
    medicineId: 'MED-' + sourceRecordId.toUpperCase(),
    canonicalKey: composition ? identity : '',
    brandName, genericName: '', genericId: '', productId: '', productName,
    manufacturer: '', manufacturerId: '', sourceLicenseStatusValue: '', drugFormId: '', routeIds: [], casNumbers: [], uniiCodes: [], substanceDescriptions: [], molecularFormulas: [], inchiValues: [], iupacNames: [], molecularWeights: [], smiles: [], toxicology: [], ingredientDetails: [], ingredientIds: [], ingredients: splitList(composition), composition,
    strength, packSize, dosageForm, medicineType, routes: [], alternatives: [], indications: [], contraindications: [], drugInteractions: [],
    sourceImageUrl: /^https:\/\//i.test(image) ? image : '',
    requiresPrescription: pick(raw, 'Is Prescription Required?') === undefined ? null : bool(pick(raw, 'Is Prescription Required?')),
    prescriptionVerification: 'UNVERIFIED', sourcePriority: 2, sourceDataset: dataset,
    sourceRecordId, dataQualityStatus: composition ? 'PARTIAL' : 'NEEDS_REVIEW'
  };
}

export function assessMedicineQuality(record) {
  const has = value => Array.isArray(value) ? value.some(item => Boolean(text(typeof item === 'object' ? item?.name || item?.brandName : item))) : Boolean(text(value));
  const checks = [
    ['brandName', has(record.brandName), 18],
    ['medicineId', has(record.medicineId), 12],
    ['composition', has(record.composition) || has(record.ingredients), 18],
    ['strength', has(record.strength), 8],
    ['dosageForm', has(record.dosageForm), 8],
    ['genericName', has(record.genericName), 8],
    ['manufacturer', has(record.manufacturer), 5],
    ['ingredientIdentifiers', has(record.ingredientIds), 5],
    ['routes', has(record.routes), 4],
    ['clinicalDetails', has(record.indications) || has(record.uses) || has(record.sideEffects) || has(record.contraindications) || has(record.drugInteractions), 6],
    ['chemicalIdentifiers', has(record.casNumbers) || has(record.uniiCodes), 4],
    ['sourceProvenance', has(record.sourceDataset) && has(record.sourceRecordId), 4]
  ];
  const qualityIssues = checks.filter(([, present]) => !present).map(([field]) => `MISSING_${field.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}`);
  if (!has(record.brandName) || !has(record.medicineId)) qualityIssues.push('INVALID_CORE_IDENTITY');
  if (record.requiresPrescription !== null && record.requiresPrescription !== undefined) qualityIssues.push('PRESCRIPTION_FLAG_UNVERIFIED');
  if (record.sourceLicenseStatusValue) qualityIssues.push('SOURCE_LICENCE_STATUS_UNVERIFIED');
  const qualityScore = Math.min(100, checks.reduce((sum, [, present, weight]) => sum + (present ? weight : 0), 0));
  const qualityGrade = qualityScore >= 90 ? 'EXCELLENT' : qualityScore >= 75 ? 'GOOD' : qualityScore >= 50 ? 'PARTIAL' : 'NEEDS_REVIEW';
  return { qualityScore, qualityGrade, qualityIssues: [...new Set(qualityIssues)] };
}

export function consolidate(records, dataset) {
  const unique = new Map();
  let rejected = 0;
  let sourceRecords = 0;
  for (const raw of records) {
    sourceRecords += 1;
    if (sourceRecords > 60000) throw Object.assign(new Error('Dataset exceeds the 60,000-record import limit.'), { statusCode: 413 });
    const normalized = normalizeMedicineRecord(raw, dataset || raw.__dataset);
    if (!normalized) { rejected += 1; continue; }
    Object.assign(normalized, assessMedicineQuality(normalized));
    normalized.dataQualityStatus = normalized.qualityGrade === 'EXCELLENT' || normalized.qualityGrade === 'GOOD' ? 'GOOD' : normalized.qualityGrade === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'PARTIAL';
    const identity = dataset === 'INDIAN_MEDICINE_DATA' ? normalized.medicineId : dataset === 'MEDICINES_PART_1' ? normalized.sourceFingerprint : (normalized.canonicalKey || normalized.medicineId);
    const previous = unique.get(identity);
    if (!previous) unique.set(identity, normalized);
    else {
      for (const field of ['genericName','genericId','productId','productName','manufacturer','manufacturerId','composition','strength','packSize','dosageForm','medicineType']) {
        if (!previous[field] && normalized[field]) previous[field] = normalized[field];
      }
      for (const field of ['ingredientIds','ingredients','ingredientDetails','routeIds','routes','casNumbers','uniiCodes','substanceDescriptions','molecularFormulas','inchiValues','iupacNames','molecularWeights','smiles','toxicology','indications','contraindications','drugInteractions']) {
        const identityOf = value => typeof value === 'object' && value !== null
          ? (value.ingredientId || key(value.name) || JSON.stringify(value))
          : key(value);
        previous[field] = [...new Map([...previous[field], ...normalized[field]].map(value => [identityOf(value), value])).values()];
      }
      previous.qualityIssues = [...new Set([...(previous.qualityIssues || []), ...(normalized.qualityIssues || [])])];
      previous.sourceRecordIds = [...new Set([...(previous.sourceRecordIds || [previous.sourceRecordId]), normalized.sourceRecordId])];
    }
  }
  const consolidatedRecords = [...unique.values()];
  for (const record of consolidatedRecords) {
    Object.assign(record, assessMedicineQuality(record));
    record.dataQualityStatus = record.qualityGrade === 'EXCELLENT' || record.qualityGrade === 'GOOD' ? 'GOOD' : record.qualityGrade === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'PARTIAL';
  }
  return { records: consolidatedRecords, rejected, sourceRecords, duplicatesRemoved: sourceRecords - rejected - unique.size };
}

router.use(requireServiceScope('inventory.catalogue.import'));
router.use((req, res, next) => req.service?.isPlatformUser === true
  ? next()
  : res.status(403).json({ code: 'PLATFORM_ADMIN_REQUIRED', message: 'Only a platform administrator can publish the shared medicine master catalogue.' }));

router.post('/imports/preview', upload.single('jsonFile'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Select a JSON file to upload.' });
  let payload;
  let dataset;
  let sourceRows;
  const buffer = req.file.buffer;
  let firstNonWhitespace = 0;
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) firstNonWhitespace = 3;
  while (firstNonWhitespace < buffer.length && [0x20, 0x09, 0x0a, 0x0d].includes(buffer[firstNonWhitespace])) firstNonWhitespace += 1;
  if (buffer[firstNonWhitespace] === 0x5b) {
    const iterator = parseJsonArrayRecords(buffer);
    const first = iterator.next();
    if (first.done) return res.status(400).json({ message: 'The uploaded JSON array is empty.' });
    try { dataset = detectMedicineDataset([first.value]); }
    catch (error) { return res.status(error.statusCode || 400).json({ message: error.message }); }
    sourceRows = (function* () { yield first.value; yield* iterator; })();
  } else {
    try { payload = JSON.parse(buffer.toString('utf8').replace(/^\\uFEFF/, '')); }
    catch { return res.status(400).json({ message: 'The uploaded file is not valid JSON.' }); }
    try { dataset = detectMedicineDataset(payload); }
    catch (error) { return res.status(error.statusCode || 400).json({ message: error.message }); }
    sourceRows = dataset === 'INDIAN_MEDICINE_DATA' ? payload.drugDetails : payload;
  }
  if (req.body?.dataset && req.body.dataset !== dataset) return res.status(400).json({ message: 'Selected dataset type does not match the uploaded JSON structure.' });
  if (!Array.isArray(sourceRows) && typeof sourceRows?.[Symbol.iterator] !== 'function') return res.status(400).json({ message: 'The uploaded medicine dataset has an invalid record collection.' });
  let normalized;
  try {
    normalized = consolidate(sourceRows, dataset);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ message: error.message });
  }
  const { records, rejected, sourceRecords, duplicatesRemoved } = normalized;
  if (!sourceRecords) return res.status(400).json({ message: 'The uploaded medicine dataset contains no records.' });
  const nameCounts = new Map();
  for (const item of records) { const nameKey = key(item.brandName); nameCounts.set(nameKey, (nameCounts.get(nameKey) || 0) + 1); }
  for (const item of records) item.safeNameMatch = dataset === 'MEDICINES_PART_1' && nameCounts.get(key(item.brandName)) === 1;
  const batchId = randomUUID();
  const fileSha256 = hash(req.file.buffer);
  const previousBatch = await CatalogueImport.findOne({ dataset, fileSha256 }).lean();
  if (previousBatch) {
    if (previousBatch.status === 'STAGING') return res.status(409).json({ message: 'This identical dataset is still being staged. Retry shortly.' });
    const firstChunk = await CatalogueImportChunk.findOne({ batchId: previousBatch.batchId, chunkIndex: 0 }).lean();
    const reportFingerprint = previousBatch.reportFingerprint || hash(JSON.stringify(previousBatch.report || {}));
    if (!previousBatch.reportFingerprint) await CatalogueImport.updateOne({ _id: previousBatch._id }, { $set: { reportFingerprint } });
    return res.status(200).json({ batchId: previousBatch.batchId, dataset, status: previousBatch.status, report: previousBatch.report, reportFingerprint, sample: (firstChunk?.records || previousBatch.records || []).slice(0, 8), reused: true });
  }
  const ids = records.map(record => record.medicineId);
  const canonicalKeys = records.map(record => record.canonicalKey).filter(Boolean);
  const names = dataset === 'MEDICINES_PART_1' ? [...new Set(records.filter(item => item.safeNameMatch).map(item => item.brandName))] : [];
  const incomingKeyCounts = new Map();
  for (const item of records) if (item.canonicalKey) incomingKeyCounts.set(item.canonicalKey, (incomingKeyCounts.get(item.canonicalKey) || 0) + 1);
  const candidateProjection = { medicineId: 1, canonicalKey: 1, brandName: 1 };
  const exactCandidates = await MedicineMaster.find({ $or: [{ medicineId: { $in: ids } }, { canonicalKey: { $in: canonicalKeys } }] }, candidateProjection).lean();
  const nameCandidates = names.length
    ? await MedicineMaster.find({ brandName: { $in: names } }, candidateProjection).collation({ locale: 'en', strength: 2 }).lean()
    : [];
  const fuzzyPrefixes = fuzzyCandidatePrefixes(records);
  const fuzzyCandidates = fuzzyPrefixes.length
    ? await MedicineMaster.find({ $or: fuzzyPrefixes.map(prefix => ({ brandName: { $regex: '^' + prefix, $options: 'i' } })) },
      { medicineId: 1, canonicalKey: 1, brandName: 1, genericName: 1, composition: 1, ingredients: 1, strength: 1, dosageForm: 1, manufacturer: 1 })
      .limit(5000).lean()
    : [];
  const existingByMongoId = new Map();
  for (const candidate of [...exactCandidates, ...nameCandidates, ...fuzzyCandidates]) existingByMongoId.set(String(candidate._id), candidate);
  const existing = [...existingByMongoId.values()];
  const existingIds = new Set(existing.map(item => item.medicineId));
  const existingById = new Map(existing.map(item => [item.medicineId, item]));
  const existingKeyGroups = new Map();
  const existingNameGroups = new Map();
  const existingByNamePrefix = new Map();
  for (const candidate of existing) {
    if (candidate.canonicalKey) existingKeyGroups.set(candidate.canonicalKey, [...(existingKeyGroups.get(candidate.canonicalKey) || []), candidate]);
    const nameKey = key(candidate.brandName);
    existingNameGroups.set(nameKey, [...(existingNameGroups.get(nameKey) || []), candidate]);
    const prefix = nameKey.split(' ')[0];
    if (prefix) existingByNamePrefix.set(prefix, [...(existingByNamePrefix.get(prefix) || []), candidate]);
  }
  const existingKeys = new Set([...existingKeyGroups.entries()].filter(([, group]) => group.length === 1).map(([canonicalKey]) => canonicalKey));
  const existingNameCounts = new Map([...existingNameGroups.entries()].map(([nameKey, group]) => [nameKey, group.length]));
  const updates = records.filter(item => existingIds.has(item.medicineId) ||
    (item.canonicalKey && incomingKeyCounts.get(item.canonicalKey) === 1 && existingKeys.has(item.canonicalKey)) ||
    (item.safeNameMatch && existingNameCounts.get(key(item.brandName)) === 1)).length;
  for (const item of records) {
    const exact = existingById.get(item.medicineId) ||
      (item.canonicalKey && incomingKeyCounts.get(item.canonicalKey) === 1 && existingKeyGroups.get(item.canonicalKey)?.length === 1 ? existingKeyGroups.get(item.canonicalKey)[0] : null) ||
      (item.safeNameMatch && existingNameCounts.get(key(item.brandName)) === 1 ? existingNameGroups.get(key(item.brandName))?.[0] : null);
    if (exact) { item.reconciliationMatch = { targetMedicineId: exact.medicineId, method: 'EXACT_OR_CANONICAL', score: 100, decision: 'AUTO_MERGE', warnings: [] }; continue; }
    let best = null;
    const prefix = key(item.brandName).slice(0, 2);
    const candidates = existingByNamePrefix.get(prefix) || [];
    for (const candidate of candidates) {
      const scored = scoreMedicineMatch(item, candidate);
      if (!best || scored.score > best.score) best = { candidate, ...scored };
    }
    if (best && ['AUTO_MERGE', 'MANUAL_REVIEW'].includes(best.decision)) {
      item.reconciliationMatch = { targetMedicineId: best.candidate.medicineId, method: 'FUZZY_TOKEN_SORT', score: best.score, nameScore: best.nameScore, compositionScore: best.compositionScore, decision: best.decision, warnings: best.warnings };
    }
  }
  const fuzzyAutoMerge = records.filter(item => item.reconciliationMatch?.method === 'FUZZY_TOKEN_SORT' && item.reconciliationMatch.decision === 'AUTO_MERGE').length;
  const fuzzyManualReview = records.filter(item => item.reconciliationMatch?.decision === 'MANUAL_REVIEW').length;
  const report = {
    sourceRecords, normalizedRecords: records.length, rejectedRecords: rejected,
    duplicatesRemoved, newRecords: Math.max(0, records.length - updates - fuzzyAutoMerge), updateCandidates: updates + fuzzyAutoMerge,
    fuzzyAutoMerge, fuzzyManualReview, unmatchedRecords: records.length - updates - fuzzyAutoMerge - fuzzyManualReview,
    needsReview: records.filter(item => item.dataQualityStatus === 'NEEDS_REVIEW').length,
    partialRecords: records.filter(item => item.dataQualityStatus === 'PARTIAL').length,
    missingComposition: records.filter(item => !item.composition).length,
    missingManufacturer: records.filter(item => !item.manufacturer).length,
    withComposition: records.filter(item => item.composition).length,
    withIngredientDetails: records.filter(item => item.ingredientDetails?.some(x => Object.values(x).some(Boolean))).length,
    withChemicalIdentifiers: records.filter(item => item.casNumbers.length || item.uniiCodes.length).length,
    withToxicology: records.filter(item => item.toxicology.length).length,
    withRoutes: records.filter(item => item.routes.length).length,
    withStrength: records.filter(item => item.strength).length,
    withPackSize: records.filter(item => item.packSize).length,
    withManufacturer: records.filter(item => item.manufacturer).length,
    withDosageForm: records.filter(item => item.dosageForm).length,
    withAlternatives: records.filter(item => item.alternatives.length).length,
    withLinkedAlternativeIds: records.filter(item => item.alternatives.some(alt => alt.medicineId)).length,
    totalAlternativeLinks: records.reduce((sum, item) => sum + item.alternatives.length, 0),
    withSideEffects: records.filter(item => item.sideEffects?.length).length,
    withUses: records.filter(item => item.uses?.length).length,
    withSuggestedAlternatives: records.filter(item => item.suggestedAlternatives?.length).length,
    withTherapeuticClass: records.filter(item => item.therapeuticClass).length,
    withChemicalClass: records.filter(item => item.chemicalClass && key(item.chemicalClass) !== 'na').length,
    withHabitFormingMetadata: records.filter(item => item.habitForming !== 'UNKNOWN').length,
    prescriptionFlagsUnverified: records.filter(item => item.requiresPrescription !== null).length,
    excellentQualityRecords: records.filter(item => item.qualityGrade === 'EXCELLENT').length,
    goodQualityRecords: records.filter(item => item.qualityGrade === 'GOOD').length,
    partialQualityRecords: records.filter(item => item.qualityGrade === 'PARTIAL').length,
    needsReviewQualityRecords: records.filter(item => item.qualityGrade === 'NEEDS_REVIEW').length,
    averageQualityScore: records.length ? Math.round(records.reduce((sum, item) => sum + item.qualityScore, 0) / records.length) : 0,
    qualityIssueCounts: records.reduce((counts, item) => { for (const issue of item.qualityIssues) counts[issue] = (counts[issue] || 0) + 1; return counts; }, {}),
    fuzzyMatchExamples: records.filter(item => item.reconciliationMatch?.method === 'FUZZY_TOKEN_SORT').slice(0, 25).map(item => ({
      incomingMedicine: item.brandName, matchedMedicineId: item.reconciliationMatch.targetMedicineId,
      score: item.reconciliationMatch.score, decision: item.reconciliationMatch.decision, warnings: item.reconciliationMatch.warnings
    })),
    fuzzyCandidateScanTruncated: fuzzyPrefixes.length >= 120 || fuzzyCandidates.length >= 5000
  };
  const reportFingerprint = hash(JSON.stringify(report));
  const chunks = [];
  for (let offset = 0; offset < records.length; offset += CATALOGUE_CHUNK_SIZE) chunks.push({ batchId, chunkIndex: chunks.length, records: records.slice(offset, offset + CATALOGUE_CHUNK_SIZE) });
  await CatalogueImport.create({
    batchId, dataset, fileName: String(req.file.originalname || 'medicine-catalogue.json').slice(0, 180),
    fileSha256, uploadedBy: req.service.userId || req.service.name,
    status: 'STAGING', recordCount: records.length, chunkCount: chunks.length, report, reportFingerprint
  });
  try {
    if (chunks.length) await CatalogueImportChunk.insertMany(chunks, { ordered: true });
    await CatalogueImport.updateOne({ batchId }, { $set: { status: 'READY' } });
  } catch (error) {
    await CatalogueImportChunk.deleteMany({ batchId });
    await CatalogueImport.deleteOne({ batchId });
    throw error;
  }
  return res.status(201).json({ batchId, dataset, status: 'READY', report, reportFingerprint, sample: records.slice(0, 8) });
}));

const MERGE_ARRAY_FIELDS = ['ingredientIds','ingredients','ingredientDetails','routes','indications','contraindications','drugInteractions','alternatives','sideEffects','uses','suggestedAlternatives','routeIds','casNumbers','uniiCodes','substanceDescriptions','molecularFormulas','inchiValues','iupacNames','molecularWeights','smiles','toxicology'];
const MERGE_TEXT_FIELDS = ['brandName','genericName','genericId','productId','productName','manufacturer','manufacturerId','composition','strength','packSize','dosageForm','medicineType','chemicalClass','therapeuticClass','actionClass'];
const mergeStagedMedicine = (left, right) => {
  const primary = Number(left.sourcePriority ?? 99) <= Number(right.sourcePriority ?? 99) ? left : right;
  const secondary = primary === left ? right : left;
  const merged = { ...secondary, ...primary };
  for (const field of MERGE_TEXT_FIELDS) merged[field] = primary[field] || secondary[field] || '';
  for (const field of MERGE_ARRAY_FIELDS) {
    const values = [...(left[field] || []), ...(right[field] || [])];
    const identity = value => value && typeof value === 'object'
      ? (value.ingredientId || key(value.name || value.brandName) || JSON.stringify(value))
      : key(value);
    merged[field] = [...new Map(values.map(value => [identity(value), value])).values()];
  }
  merged.sourceDatasets = [...new Set([...(left.sourceDatasets || []), ...(right.sourceDatasets || []), left.sourceDataset, right.sourceDataset].filter(Boolean))];
  merged.sourceRecordIds = [...new Set([...(left.sourceRecordIds || [left.sourceRecordId]), ...(right.sourceRecordIds || [right.sourceRecordId])].filter(Boolean))];
  merged.legacyMedicineIds = [...new Set([...(left.legacyMedicineIds || []), ...(right.legacyMedicineIds || []), ...(left.medicineId !== merged.medicineId ? [left.medicineId] : []), ...(right.medicineId !== merged.medicineId ? [right.medicineId] : [])].filter(Boolean))];
  merged.sourcePriority = Math.min(Number(left.sourcePriority ?? 99), Number(right.sourcePriority ?? 99));
  if (!merged.canonicalKey) merged.canonicalKey = left.canonicalKey || right.canonicalKey || '';
  if (merged.requiresPrescription === null || merged.requiresPrescription === undefined) merged.requiresPrescription = secondary.requiresPrescription ?? null;
  if (!merged.habitForming || merged.habitForming === 'UNKNOWN') merged.habitForming = secondary.habitForming || 'UNKNOWN';
  const quality = assessMedicineQuality({ ...merged, sourceDataset: merged.sourceDataset || primary.sourceDataset, sourceRecordId: merged.sourceRecordId || primary.sourceRecordId });
  Object.assign(merged, quality);
  merged.dataQualityStatus = quality.qualityGrade === 'EXCELLENT' || quality.qualityGrade === 'GOOD' ? 'GOOD' : quality.qualityGrade === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'PARTIAL';
  return merged;
};

router.post('/imports/merge', asyncHandler(async (req, res) => {
  const batchIds = [...new Set((Array.isArray(req.body?.batchIds) ? req.body.batchIds : []).map(value => text(value)).filter(Boolean))];
  if (batchIds.length < 2 || batchIds.length > 10) return res.status(400).json({ message: 'Select between 2 and 10 staged batches to merge.' });
  const batches = await CatalogueImport.find({ batchId: { $in: batchIds } }).lean();
  if (batches.length !== batchIds.length || batches.some(batch => batch.status !== 'READY' || batch.approvedAt)) {
    return res.status(409).json({ message: 'All selected batches must exist, remain staged and ready, and not already be approved.' });
  }
  const sourceBatchIds = batches.map(batch => batch.batchId).sort();
  const fileSha256 = hash(sourceBatchIds.join('|'));
  const previous = await CatalogueImport.findOne({ dataset: 'MULTI_SOURCE', fileSha256 }).lean();
  if (previous && previous.status !== 'SUPERSEDED') return res.json({ batchId: previous.batchId, dataset: previous.dataset, status: previous.status, report: previous.report, reportFingerprint: previous.reportFingerprint, reused: true });
  const allChunks = await CatalogueImportChunk.find({ batchId: { $in: sourceBatchIds } }).sort({ batchId: 1, chunkIndex: 1 }).lean();
  const rawRecords = allChunks.flatMap(chunk => chunk.records || []);
  if (!rawRecords.length) return res.status(409).json({ message: 'Selected batches contain no staged medicine records.' });
  const mergedByIdentity = new Map();
  const pending = [];
  let exactMerged = 0, fuzzyMerged = 0;
  const reviewCandidates = [];
  for (const record of rawRecords) {
    const identity = record.canonicalKey ? 'KEY:' + record.canonicalKey : 'ID:' + record.medicineId;
    const existing = mergedByIdentity.get(identity);
    if (existing) { mergedByIdentity.set(identity, mergeStagedMedicine(existing, record)); exactMerged += 1; continue; }
    const prefix = key(record.brandName).slice(0, 2);
    let best = null;
    if (prefix.length === 2) {
      for (const candidate of pending) {
        if (key(candidate.brandName).slice(0, 2) !== prefix) continue;
        const score = scoreMedicineMatch(record, candidate);
        if (!best || score.score > best.score) best = { candidate, ...score };
      }
    }
    if (best?.decision === 'AUTO_MERGE') {
      const previousIdentity = best.candidate.canonicalKey ? 'KEY:' + best.candidate.canonicalKey : 'ID:' + best.candidate.medicineId;
      const combined = mergeStagedMedicine(best.candidate, record);
      const index = pending.indexOf(best.candidate);
      pending[index] = combined;
      mergedByIdentity.set(previousIdentity, combined);
      if (combined.canonicalKey) mergedByIdentity.set('KEY:' + combined.canonicalKey, combined);
      fuzzyMerged += 1;
    } else {
      if (best?.decision === 'MANUAL_REVIEW') reviewCandidates.push({ incomingMedicine: record.brandName, candidateMedicine: best.candidate.brandName, candidateMedicineId: best.candidate.medicineId, score: best.score, warnings: best.warnings });
      pending.push(record);
      mergedByIdentity.set(identity, record);
    }
  }
  const records = pending;
  const batchId = randomUUID();
  const report = {
    sourceRecords: rawRecords.length, normalizedRecords: records.length, rejectedRecords: 0,
    duplicatesRemoved: exactMerged + fuzzyMerged, newRecords: records.length,
    updateCandidates: records.filter(item => item.reconciliationMatch?.decision === 'AUTO_MERGE').length,
    exactBatchMerges: exactMerged, fuzzyBatchMerges: fuzzyMerged, fuzzyManualReview: reviewCandidates.length,
    unmatchedRecords: Math.max(0, records.length - reviewCandidates.length),
    sourceBatchCount: batches.length, sourceBatchIds,
    fuzzyMatchExamples: reviewCandidates.slice(0, 25).map(item => ({ incomingMedicine: item.incomingMedicine, matchedMedicineId: item.candidateMedicineId, score: item.score, decision: 'MANUAL_REVIEW', warnings: item.warnings })),
    averageQualityScore: records.length ? Math.round(records.reduce((sum, item) => sum + Number(item.qualityScore || 0), 0) / records.length) : 0
  };
  const reportFingerprint = hash(JSON.stringify(report));
  const chunks = [];
  for (let offset = 0; offset < records.length; offset += CATALOGUE_CHUNK_SIZE) chunks.push({ batchId, chunkIndex: chunks.length, records: records.slice(offset, offset + CATALOGUE_CHUNK_SIZE) });
  await CatalogueImport.create({
    batchId, dataset: 'MULTI_SOURCE', fileName: 'Merged ' + batches.length + ' medicine batches',
    fileSha256, uploadedBy: req.service.userId || req.service.name,
    status: 'STAGING', recordCount: records.length, chunkCount: chunks.length, report, reportFingerprint, sourceBatchIds
  });
  try {
    if (chunks.length) await CatalogueImportChunk.insertMany(chunks, { ordered: true });
    const superseded = await CatalogueImport.updateMany(
      { batchId: { $in: sourceBatchIds }, status: 'READY', approvedAt: null },
      { $set: { status: 'SUPERSEDED', supersededByBatchId: batchId } }
    );
    if ((superseded.modifiedCount ?? superseded.nModified ?? 0) !== sourceBatchIds.length) throw Object.assign(new Error('One or more source batches changed state during merge. Refresh history and retry.'), { statusCode: 409 });
    await CatalogueImport.updateOne({ batchId }, { $set: { status: 'READY' } });
  } catch (error) {
    await CatalogueImportChunk.deleteMany({ batchId });
    await CatalogueImport.deleteOne({ batchId });
    await CatalogueImport.updateMany({ batchId: { $in: sourceBatchIds }, status: 'SUPERSEDED', supersededByBatchId: batchId }, { $set: { status: 'READY', supersededByBatchId: '' } });
    throw error;
  }
  return res.status(201).json({ batchId, dataset: 'MULTI_SOURCE', status: 'READY', report, reportFingerprint, sourceBatchIds });
}));

router.get('/imports', asyncHandler(async (req, res) => {
  const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page || '1', 10) || 1));
  const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit || '10', 10) || 10));
  const [items, total] = await Promise.all([
    CatalogueImport.find({}, { batchId: 1, dataset: 1, fileName: 1, status: 1, recordCount: 1, report: 1, publishedCount: 1, approvedAt: 1, approvedBy: 1, errorMessage: 1, sourceBatchIds: 1, supersededByBatchId: 1, createdAt: 1 }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    CatalogueImport.countDocuments({})
  ]);
  return res.json({ items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.get('/imports/:batchId', asyncHandler(async (req, res) => {
  const batch = await CatalogueImport.findOne({ batchId: req.params.batchId }).lean();
  if (!batch) return res.status(404).json({ message: 'Catalogue import batch was not found.' });
  return res.json({ batchId: batch.batchId, dataset: batch.dataset, fileName: batch.fileName, status: batch.status, report: batch.report, reportFingerprint: batch.reportFingerprint, approvedBy: batch.approvedBy, approvedAt: batch.approvedAt, publishedCount: batch.publishedCount, errorMessage: batch.errorMessage });
}));

router.post('/imports/:batchId/approve', asyncHandler(async (req, res) => {
  const batch = await CatalogueImport.findOne({ batchId: req.params.batchId });
  if (!batch) return res.status(404).json({ message: 'Catalogue import batch was not found.' });
  if (batch.status !== 'READY') return res.status(409).json({ message: 'Only a ready batch can be approved.' });
  if (req.body?.confirmReconciliation !== true || req.body?.reportFingerprint !== batch.reportFingerprint) return res.status(400).json({ message: 'Review confirmation does not match this reconciliation report. Refresh the batch and confirm the current report.' });
  batch.approvedBy = req.service.userId || req.service.name;
  batch.approvedAt = new Date();
  await batch.save();
  return res.json({ batchId: batch.batchId, status: batch.status, approvedBy: batch.approvedBy, approvedAt: batch.approvedAt, reportFingerprint: batch.reportFingerprint });
}));

router.post('/imports/:batchId/publish', asyncHandler(async (req, res) => {
  const batch = await CatalogueImport.findOne({ batchId: req.params.batchId });
  if (!batch) return res.status(404).json({ message: 'Catalogue import batch was not found.' });
  if (batch.status === 'SUPERSEDED') return res.status(409).json({ message: 'This batch was superseded by a combined batch. Publish the merged batch instead.', supersededByBatchId: batch.supersededByBatchId });
  if (batch.status === 'PUBLISHED') return res.json({ batchId: batch.batchId, status: batch.status, publishedCount: batch.publishedCount, report: batch.report });
  if (!batch.approvedAt || !batch.reportFingerprint) return res.status(409).json({ message: 'This reconciliation report has not been approved. Review and approve the report before publishing.' });
  if (!['READY', 'PARTIALLY_PUBLISHED', 'FAILED'].includes(batch.status)) return res.status(409).json({ message: 'This catalogue batch is already being published.' });
  batch.status = 'PUBLISHING';
  batch.errorMessage = '';
  await batch.save();
  let publishedCount = 0;
  try {
    const stagedChunks = await CatalogueImportChunk.find({ batchId: batch.batchId }).sort({ chunkIndex: 1 }).lean();
    const recordChunks = stagedChunks.length ? stagedChunks.map(item => item.records) : (batch.records?.length ? [batch.records] : []);
    const records = recordChunks.flat();
    const incomingKeyCounts = new Map();
    const incomingNameCounts = new Map();
    for (const item of records) {
      if (item.canonicalKey) incomingKeyCounts.set(item.canonicalKey, (incomingKeyCounts.get(item.canonicalKey) || 0) + 1);
      const nameKey = key(item.brandName); incomingNameCounts.set(nameKey, (incomingNameCounts.get(nameKey) || 0) + 1);
    }
    for (const recordChunk of recordChunks) for (let offset = 0; offset < recordChunk.length; offset += 250) {
      const chunk = recordChunk.slice(offset, offset + 250);
      const ids = [...new Set(chunk.flatMap(item => [item.medicineId, item.reconciliationMatch?.targetMedicineId].filter(Boolean)))];
      const keys = chunk.map(item => item.canonicalKey).filter(Boolean);
      const names = batch.dataset === 'MEDICINES_PART_1' ? [...new Set(chunk.filter(item => item.safeNameMatch && incomingNameCounts.get(key(item.brandName)) === 1).map(item => item.brandName))] : [];
      const existing = await MedicineMaster.find({ $or: [{ medicineId: { $in: ids } }, { canonicalKey: { $in: keys } }, ...(names.length ? [{ $expr: { $in: [{ $toLower: '$brandName' }, names.map(name => name.toLowerCase())] } }] : [])] }).lean();
      const byId = new Map(existing.map(item => [item.medicineId, item]));
      const keyGroups = new Map();
      for (const item of existing.filter(item => item.canonicalKey)) keyGroups.set(item.canonicalKey, [...(keyGroups.get(item.canonicalKey) || []), item]);
      const byKey = new Map([...keyGroups.entries()].filter(([, matches]) => matches.length === 1).map(([canonicalKey, matches]) => [canonicalKey, matches[0]]));
      const nameGroups = new Map();
      for (const item of existing) { const nameKey = key(item.brandName); nameGroups.set(nameKey, [...(nameGroups.get(nameKey) || []), item]); }
      const byName = new Map([...nameGroups.entries()].filter(([, matches]) => matches.length === 1).map(([nameKey, matches]) => [nameKey, matches[0]]));
      const operations = chunk.map(item => {
        const canonicalMatch = item.canonicalKey && incomingKeyCounts.get(item.canonicalKey) === 1 ? byKey.get(item.canonicalKey) : null;
        const nameMatch = item.safeNameMatch && incomingNameCounts.get(key(item.brandName)) === 1 ? byName.get(key(item.brandName)) : null;
        const fuzzyTarget = item.reconciliationMatch?.method === 'FUZZY_TOKEN_SORT' && item.reconciliationMatch.decision === 'AUTO_MERGE'
          ? byId.get(item.reconciliationMatch.targetMedicineId) : null;
        const current = byId.get(item.medicineId) || fuzzyTarget || canonicalMatch || nameMatch || null;
        const targetId = current?.medicineId || item.medicineId;
        const fields = ['brandName','genericName','genericId','sourceLicenseStatusValue','drugFormId','productId','productName','manufacturer','manufacturerId','composition','strength','packSize','dosageForm','medicineType','sourceImageUrl'];
        const set = {
          medicineId: targetId,
          canonicalKey: item.canonicalKey || current?.canonicalKey || '',
          lastImportBatchId: batch.batchId,
          sourcePriority: Math.min(Number(current?.sourcePriority ?? 99), item.sourcePriority)
        };
        for (const field of fields) {
          if (item[field] && (!current?.[field] || item.sourcePriority < Number(current.sourcePriority ?? 99))) set[field] = item[field];
        }
        for (const field of ['ingredientIds','ingredients','routes','indications','contraindications','drugInteractions','alternatives','sideEffects','uses','suggestedAlternatives','routeIds','casNumbers','uniiCodes','substanceDescriptions','molecularFormulas','inchiValues','iupacNames','molecularWeights','smiles','toxicology']) {
          const incoming = item[field] || [];
          if (incoming.length) set[field] = [...new Map([...(current?.[field] || []), ...incoming].map(v => [key(typeof v === 'string' ? v : JSON.stringify(v)), v])).values()];
        }
        if (item.ingredientDetails?.length) {
          const ingredientMap = new Map([...(current?.ingredientDetails || []), ...item.ingredientDetails].map(detail => [detail.ingredientId || key(detail.name), detail]));
          set.ingredientDetails = [...ingredientMap.values()];
        }
        if (current?.requiresPrescription === null || current?.requiresPrescription === undefined) set.requiresPrescription = item.requiresPrescription;
        for (const field of ['chemicalClass','therapeuticClass','actionClass']) if (item[field] && (!current?.[field] || item.sourcePriority < Number(current.sourcePriority ?? 99))) set[field] = item[field];
        if (item.habitForming && item.habitForming !== 'UNKNOWN' && (!current?.habitForming || current.habitForming === 'UNKNOWN')) set.habitForming = item.habitForming;
        set.prescriptionVerification = current?.prescriptionVerification || 'UNVERIFIED';
        set.clinicalDataVerification = current?.clinicalDataVerification || 'UNVERIFIED';
        set.sourceLicenseStatus = current?.sourceLicenseStatus || 'UNVERIFIED';
        const qualityRank = { NEEDS_REVIEW: 1, PARTIAL: 2, GOOD: 3 };
        set.dataQualityStatus = (qualityRank[current?.dataQualityStatus] || 0) >= (qualityRank[item.dataQualityStatus] || 0)
          ? (current?.dataQualityStatus || item.dataQualityStatus) : item.dataQualityStatus;
        const mergedQuality = assessMedicineQuality({ ...current, ...set, sourceDataset: item.sourceDataset, sourceRecordId: item.sourceRecordId });
        Object.assign(set, mergedQuality);
        set.dataQualityStatus = mergedQuality.qualityGrade === 'EXCELLENT' || mergedQuality.qualityGrade === 'GOOD' ? 'GOOD' : mergedQuality.qualityGrade === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'PARTIAL';
        return {
          updateOne: {
            filter: current ? { _id: current._id } : { medicineId: targetId },
            update: {
              $set: set,
              $addToSet: { sourceDatasets: item.sourceDataset, sourceRecordIds: { $each: item.sourceRecordIds?.length ? item.sourceRecordIds : [item.sourceRecordId] }, ...(current && current.medicineId !== item.medicineId ? { legacyMedicineIds: item.medicineId } : {}) }
            },
            upsert: true
          }
        };
      });
      await MedicineMaster.bulkWrite(operations, { ordered: false });
      publishedCount += chunk.length;
      await CatalogueImport.updateOne({ _id: batch._id }, { $set: { publishedCount } });
    }
    batch.status = 'PUBLISHED';
    batch.publishedCount = publishedCount;
    await batch.save();
    return res.json({ batchId: batch.batchId, status: batch.status, publishedCount, report: batch.report });
  } catch (error) {
    batch.status = publishedCount ? 'PARTIALLY_PUBLISHED' : 'FAILED';
    batch.publishedCount = publishedCount;
    batch.errorMessage = error.message;
    await batch.save();
    throw error;
  }
}));

export async function initializeMedicineCatalogueModels() {
  await Promise.all([MedicineMaster.init(), CatalogueImport.init(), CatalogueImportChunk.init()]);
}
export default router;
