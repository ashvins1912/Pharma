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
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const pick = (record, ...names) => {
  const normalized = Object.fromEntries(Object.entries(record || {}).map(([k, v]) => [key(k).replace(/ /g, ''), v]));
  for (const name of names) {
    const value = normalized[key(name).replace(/ /g, '')];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return undefined;
};
const bool = value => typeof value === 'boolean' ? value : ['true', 'yes', '1'].includes(text(value).toLowerCase());
const cleanRetailProductName = value => text(value).split(/\b(?:mrp|price|inclusive of all taxes|prescription required|prescription only)\b|₹|\bRs\.?\s*\d/i)[0].replace(/[|,;\-–]+\s*$/, '').trim();
const cleanDosageForm = value => {
  const source = key(value);
  const forms = ['tablet','capsule','syrup','suspension','injection','cream','ointment','gel','drops','spray','inhaler','powder','solution','lotion','suppository','sachet','granules','patch','vial','ampoule','lozenge','mouthwash'];
  return forms.filter(form => source.includes(form)).map(form => form.charAt(0).toUpperCase() + form.slice(1)).join(', ');
};
const splitList = value => text(value).split(/[,;|+]+/).map(text).filter(Boolean).filter((v, i, a) => a.findIndex(x => key(x) === key(v)) === i);

const medicineMasterSchema = new mongoose.Schema({
  medicineId: { type: String, required: true, unique: true, index: true },
  canonicalKey: { type: String, default: '', index: true },
  brandName: { type: String, required: true, trim: true },
  genericName: { type: String, default: '' },
  genericId: { type: String, default: '' },
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
  sourceLicenseStatus: { type: String, enum: ['UNVERIFIED', 'CLEARED', 'RESTRICTED'], default: 'UNVERIFIED' },
  dataQualityStatus: { type: String, enum: ['GOOD', 'PARTIAL', 'NEEDS_REVIEW'], default: 'PARTIAL' },
  sourcePriority: { type: Number, default: 99 },
  sourceDatasets: { type: [String], default: [] },
  sourceRecordIds: { type: [String], default: [] },
  legacyMedicineIds: { type: [String], default: [] },
  lastImportBatchId: { type: String, default: '' },
  lastVerifiedAt: { type: Date, default: null }
}, { timestamps: true });
medicineMasterSchema.index({ brandName: 'text', genericName: 'text', composition: 'text', manufacturer: 'text' });
const catalogueImportSchema = new mongoose.Schema({
  batchId: { type: String, required: true, unique: true },
  dataset: { type: String, enum: ['INDIAN_MEDICINE_DATA', 'INDIA_MEDICINES_INFO', 'MEDICINES_PART_1'], required: true },
  fileName: { type: String, required: true },
  fileSha256: { type: String, required: true },
  uploadedBy: { type: String, required: true },
  status: { type: String, enum: ['READY', 'PUBLISHING', 'PUBLISHED', 'PARTIALLY_PUBLISHED', 'FAILED'], default: 'READY', index: true },
  recordCount: { type: Number, default: 0 },
  chunkCount: { type: Number, default: 0 },
  records: { type: [mongoose.Schema.Types.Mixed], default: [] },
  report: { type: mongoose.Schema.Types.Mixed, default: {} },
  publishedCount: { type: Number, default: 0 },
  errorMessage: { type: String, default: '' }
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
      productId: text(pick(raw, 'productIdentifier')), productName: text(pick(raw, 'productName')),
      manufacturer: text(pick(raw, 'supplierName')), manufacturerId: text(pick(raw, 'supplierIdentifier')),
      ingredientIds: splitList(pick(raw, 'substanceIdentifier')), ingredients, composition, strength, dosageForm, medicineType: '',
      routes: splitList(pick(raw, 'routeOfAdministrationName')),
      alternatives: Array.isArray(raw.alternativeDrugs) ? raw.alternativeDrugs.slice(0, 20) : [],
      indications: splitList(pick(raw, 'indication')),
      contraindications: splitList(pick(raw, 'contraIndication')),
      drugInteractions: splitList(pick(raw, 'interactionWithDrugs')),
      sourceImageUrl: '', requiresPrescription: null, prescriptionVerification: 'UNVERIFIED',
      sourcePriority: 1, sourceDataset: dataset, sourceRecordId: medicineId,
      dataQualityStatus: composition && dosageForm && genericName ? 'GOOD' : 'PARTIAL'
    };
  }
  if (dataset === 'MEDICINES_PART_1') {
    const brandName = text(pick(raw, 'name'));
    const sourceRecordId = text(pick(raw, 'id'));
    if (!brandName || !sourceRecordId) return null;
    const strengthMatch = brandName.match(/\\b\\d+(?:\\.\\d+)?\\s?(?:mcg|mg|g|ml|iu|%)(?:\\b|\\/)/i);
    const strength = strengthMatch ? strengthMatch[0].replace(/\\s+/g, ' ').trim() : '';
    const dosageForm = cleanDosageForm(brandName);
    const collect = prefix => Array.from({ length: prefix === 'sideEffect' ? 42 : 5 }, (_, index) => text(raw[`${prefix}${index}`])).filter(Boolean).filter((value, index, all) => all.findIndex(item => key(item) === key(value)) === index);
    const identity = [key(brandName), key(strength), key(dosageForm)].join('|');
    return {
      medicineId: `MEDINFO-${sourceRecordId}`, canonicalKey: '', brandName, genericName: '', genericId: '',
      productId: '', productName: brandName, manufacturer: '', manufacturerId: '', ingredientIds: [], ingredients: [],
      composition: '', strength, packSize: '', dosageForm, medicineType: dosageForm, routes: [], alternatives: [],
      indications: [], contraindications: [], drugInteractions: [], sideEffects: collect('sideEffect'), uses: collect('use'),
      suggestedAlternatives: collect('substitute'), chemicalClass: text(pick(raw, 'Chemical Class')),
      habitForming: ['yes', 'no'].includes(text(pick(raw, 'Habit Forming')).toLowerCase()) ? text(pick(raw, 'Habit Forming')).toUpperCase() : 'UNKNOWN',
      therapeuticClass: text(pick(raw, 'Therapeutic Class')), actionClass: text(pick(raw, 'Action Class')),
      sourceImageUrl: '', requiresPrescription: null, prescriptionVerification: 'UNVERIFIED',
      sourcePriority: 3, sourceDataset: dataset, sourceRecordId, dataQualityStatus: 'PARTIAL',
      sourceFingerprint: hash(JSON.stringify([identity, collect('sideEffect'), collect('use'), collect('substitute'), pick(raw, 'Chemical Class'), pick(raw, 'Therapeutic Class'), pick(raw, 'Action Class')]))
    };
  }
  const brandName = text(pick(raw, 'Medicine Name')) || text(pick(raw, 'Product Name'));
  if (!brandName) return null;
  const productName = cleanRetailProductName(pick(raw, 'Product Name'));
  const composition = text(pick(raw, 'Composition'));
  const packMatch = productName.match(/\\b(?:pack of\\s*)?\\d+(?:\\.\\d+)?\\s?(?:tablets?|tabs?|capsules?|caps?|ml|g|gm|strips?|sachets?|vials?)\\b/i);
  const packSize = packMatch ? packMatch[0].replace(/\\s+/g, ' ').trim() : '';
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
    manufacturer: '', manufacturerId: '', ingredientIds: [], ingredients: splitList(composition), composition,
    strength, packSize, dosageForm, medicineType, routes: [], alternatives: [], indications: [], contraindications: [], drugInteractions: [],
    sourceImageUrl: /^https:\/\//i.test(image) ? image : '',
    requiresPrescription: pick(raw, 'Is Prescription Required?') === undefined ? null : bool(pick(raw, 'Is Prescription Required?')),
    prescriptionVerification: 'UNVERIFIED', sourcePriority: 2, sourceDataset: dataset,
    sourceRecordId, dataQualityStatus: composition ? 'PARTIAL' : 'NEEDS_REVIEW'
  };
}

function consolidate(records, dataset) {
  const unique = new Map();
  let rejected = 0;
  for (const raw of records) {
    const normalized = normalizeMedicineRecord(raw, raw.__dataset);
    if (!normalized) { rejected += 1; continue; }
    const identity = dataset === 'INDIAN_MEDICINE_DATA' ? normalized.medicineId : (normalized.canonicalKey || normalized.medicineId);
    const previous = unique.get(identity);
    if (!previous) unique.set(identity, normalized);
    else {
      for (const field of ['genericName','genericId','productId','productName','manufacturer','manufacturerId','composition','strength','packSize','dosageForm','medicineType']) {
        if (!previous[field] && normalized[field]) previous[field] = normalized[field];
      }
      for (const field of ['ingredientIds','ingredients','routes','indications','contraindications','drugInteractions']) {
        previous[field] = [...new Map([...previous[field], ...normalized[field]].map(v => [key(v), v])).values()];
      }
      previous.sourceRecordIds = [...new Set([...(previous.sourceRecordIds || [previous.sourceRecordId]), normalized.sourceRecordId])];
    }
  }
  return { records: [...unique.values()], rejected, duplicatesRemoved: records.length - rejected - unique.size };
}

router.use(requireServiceScope('inventory.catalogue.import'));
router.use((req, res, next) => req.service?.isPlatformUser === true
  ? next()
  : res.status(403).json({ code: 'PLATFORM_ADMIN_REQUIRED', message: 'Only a platform administrator can publish the shared medicine master catalogue.' }));

router.post('/imports/preview', upload.single('jsonFile'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Select a JSON file to upload.' });
  let payload;
  try { payload = JSON.parse(req.file.buffer.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { return res.status(400).json({ message: 'The uploaded file is not valid JSON.' }); }
  const dataset = req.body?.dataset || detectMedicineDataset(payload);
  const detected = detectMedicineDataset(payload);
  if (dataset !== detected) return res.status(400).json({ message: 'Selected dataset type does not match the uploaded JSON structure.' });
  const sourceRows = dataset === 'INDIAN_MEDICINE_DATA' ? payload.drugDetails : payload;
  if (!Array.isArray(sourceRows) || sourceRows.length < 1 || sourceRows.length > 60000) return res.status(413).json({ message: 'Dataset must contain between 1 and 60,000 records.' });
  const tagged = sourceRows.map(record => ({ ...record, __dataset: dataset }));
  const { records, rejected, duplicatesRemoved } = consolidate(tagged, dataset);
  const nameCounts = new Map();
  for (const item of records) { const nameKey = key(item.brandName); nameCounts.set(nameKey, (nameCounts.get(nameKey) || 0) + 1); }
  for (const item of records) item.safeNameMatch = dataset === 'MEDICINES_PART_1' && nameCounts.get(key(item.brandName)) === 1;
  const batchId = randomUUID();
  const fileSha256 = hash(req.file.buffer);
  const previousBatch = await CatalogueImport.findOne({ dataset, fileSha256 }).lean();
  if (previousBatch) {
    const firstChunk = await CatalogueImportChunk.findOne({ batchId: previousBatch.batchId, chunkIndex: 0 }).lean();
    return res.status(200).json({ batchId: previousBatch.batchId, dataset, status: previousBatch.status, report: previousBatch.report, sample: (firstChunk?.records || previousBatch.records || []).slice(0, 8), reused: true });
  }
  const ids = records.map(record => record.medicineId);
  const canonicalKeys = records.map(record => record.canonicalKey).filter(Boolean);
  const names = dataset === 'MEDICINES_PART_1' ? [...new Set(records.filter(item => item.safeNameMatch).map(item => item.brandName))] : [];
  const incomingKeyCounts = new Map();
  for (const item of records) if (item.canonicalKey) incomingKeyCounts.set(item.canonicalKey, (incomingKeyCounts.get(item.canonicalKey) || 0) + 1);
  const existing = await MedicineMaster.find({ $or: [{ medicineId: { $in: ids } }, { canonicalKey: { $in: canonicalKeys } }, ...(names.length ? [{ brandName: { $in: names } }] : [])] }, { medicineId: 1, canonicalKey: 1, brandName: 1 }).lean();
  const existingIds = new Set(existing.map(item => item.medicineId));
  const existingKeyCounts = new Map();
  for (const item of existing.filter(item => item.canonicalKey)) existingKeyCounts.set(item.canonicalKey, (existingKeyCounts.get(item.canonicalKey) || 0) + 1);
  const existingKeys = new Set([...existingKeyCounts.entries()].filter(([, count]) => count === 1).map(([canonicalKey]) => canonicalKey));
  const existingNameCounts = new Map();
  for (const item of existing) { const nameKey = key(item.brandName); existingNameCounts.set(nameKey, (existingNameCounts.get(nameKey) || 0) + 1); }
  const updates = records.filter(item => existingIds.has(item.medicineId) || (item.canonicalKey && incomingKeyCounts.get(item.canonicalKey) === 1 && existingKeys.has(item.canonicalKey)) || (item.safeNameMatch && existingNameCounts.get(key(item.brandName)) === 1)).length;
  const report = {
    sourceRecords: sourceRows.length, normalizedRecords: records.length, rejectedRecords: rejected,
    duplicatesRemoved, newRecords: records.length - updates, updateCandidates: updates,
    needsReview: records.filter(item => item.dataQualityStatus === 'NEEDS_REVIEW').length,
    withComposition: records.filter(item => item.composition).length,
    withStrength: records.filter(item => item.strength).length,
    withPackSize: records.filter(item => item.packSize).length,
    withManufacturer: records.filter(item => item.manufacturer).length,
    withDosageForm: records.filter(item => item.dosageForm).length,
    withAlternatives: records.filter(item => item.alternatives.length).length,
    withSideEffects: records.filter(item => item.sideEffects?.length).length,
    withUses: records.filter(item => item.uses?.length).length,
    withSuggestedAlternatives: records.filter(item => item.suggestedAlternatives?.length).length,
    withTherapeuticClass: records.filter(item => item.therapeuticClass).length,
    withChemicalClass: records.filter(item => item.chemicalClass && key(item.chemicalClass) !== 'na').length,
    withHabitFormingMetadata: records.filter(item => item.habitForming !== 'UNKNOWN').length,
    prescriptionFlagsUnverified: records.filter(item => item.requiresPrescription !== null).length
  };
  const chunks = [];
  for (let offset = 0; offset < records.length; offset += CATALOGUE_CHUNK_SIZE) chunks.push({ batchId, chunkIndex: chunks.length, records: records.slice(offset, offset + CATALOGUE_CHUNK_SIZE) });
  await CatalogueImport.create({
    batchId, dataset, fileName: String(req.file.originalname || 'medicine-catalogue.json').slice(0, 180),
    fileSha256, uploadedBy: req.service.userId || req.service.name,
    status: 'READY', recordCount: records.length, chunkCount: chunks.length, report
  });
  if (chunks.length) await CatalogueImportChunk.insertMany(chunks, { ordered: true });
  return res.status(201).json({ batchId, dataset, status: 'READY', report, sample: records.slice(0, 8) });
}));

router.get('/imports/:batchId', asyncHandler(async (req, res) => {
  const batch = await CatalogueImport.findOne({ batchId: req.params.batchId }).lean();
  if (!batch) return res.status(404).json({ message: 'Catalogue import batch was not found.' });
  return res.json({ batchId: batch.batchId, dataset: batch.dataset, fileName: batch.fileName, status: batch.status, report: batch.report, publishedCount: batch.publishedCount, errorMessage: batch.errorMessage });
}));

router.post('/imports/:batchId/publish', asyncHandler(async (req, res) => {
  const batch = await CatalogueImport.findOne({ batchId: req.params.batchId });
  if (!batch) return res.status(404).json({ message: 'Catalogue import batch was not found.' });
  if (batch.status === 'PUBLISHED') return res.json({ batchId: batch.batchId, status: batch.status, publishedCount: batch.publishedCount, report: batch.report });
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
      const ids = chunk.map(item => item.medicineId);
      const keys = chunk.map(item => item.canonicalKey).filter(Boolean);
      const names = batch.dataset === 'MEDICINES_PART_1' ? [...new Set(chunk.filter(item => item.safeNameMatch && incomingNameCounts.get(key(item.brandName)) === 1).map(item => item.brandName))] : [];
      const existing = await MedicineMaster.find({ $or: [{ medicineId: { $in: ids } }, { canonicalKey: { $in: keys } }, ...(names.length ? [{ brandName: { $in: names } }] : [])] }).lean();
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
        const current = byId.get(item.medicineId) || canonicalMatch || nameMatch || null;
        const targetId = ['INDIAN_MEDICINE_DATA', 'MEDICINES_PART_1'].includes(batch.dataset) ? (current?.medicineId || item.medicineId) : (current?.medicineId || item.medicineId);
        const fields = ['brandName','genericName','genericId','productId','productName','manufacturer','manufacturerId','composition','strength','packSize','dosageForm','medicineType','sourceImageUrl'];
        const set = {
          medicineId: targetId,
          canonicalKey: item.canonicalKey || current?.canonicalKey || '',
          lastImportBatchId: batch.batchId,
          sourcePriority: Math.min(Number(current?.sourcePriority ?? 99), item.sourcePriority)
        };
        for (const field of fields) {
          if (item[field] && (!current?.[field] || item.sourcePriority < Number(current.sourcePriority ?? 99))) set[field] = item[field];
        }
        for (const field of ['ingredientIds','ingredients','routes','indications','contraindications','drugInteractions','alternatives','sideEffects','uses','suggestedAlternatives']) {
          const incoming = item[field] || [];
          if (incoming.length) set[field] = [...new Map([...(current?.[field] || []), ...incoming].map(v => [key(typeof v === 'string' ? v : JSON.stringify(v)), v])).values()];
        }
        if (current?.requiresPrescription === null || current?.requiresPrescription === undefined) set.requiresPrescription = item.requiresPrescription;
        for (const field of ['chemicalClass','therapeuticClass','actionClass']) if (item[field] && (!current?.[field] || item.sourcePriority < Number(current.sourcePriority ?? 99))) set[field] = item[field];
        if (item.habitForming && item.habitForming !== 'UNKNOWN' && (!current?.habitForming || current.habitForming === 'UNKNOWN')) set.habitForming = item.habitForming;
        set.prescriptionVerification = 'UNVERIFIED';
        set.sourceLicenseStatus = current?.sourceLicenseStatus || 'UNVERIFIED';
        const qualityRank = { NEEDS_REVIEW: 1, PARTIAL: 2, GOOD: 3 };
        set.dataQualityStatus = (qualityRank[current?.dataQualityStatus] || 0) >= (qualityRank[item.dataQualityStatus] || 0)
          ? (current?.dataQualityStatus || item.dataQualityStatus) : item.dataQualityStatus;
        return {
          updateOne: {
            filter: current ? { _id: current._id } : { medicineId: targetId },
            update: {
              $set: set,
              $addToSet: { sourceDatasets: item.sourceDataset, sourceRecordIds: { $each: item.sourceRecordIds?.length ? item.sourceRecordIds : [item.sourceRecordId] }, ...(current && current.medicineId !== targetId ? { legacyMedicineIds: current.medicineId } : {}) }
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
