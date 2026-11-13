import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { invalidateMedicineMasterVersionCache, MedicineMatchReference, mapMedicineMatchBatch, queueMedicineMatch } from './medicine-match-reference.js';
import { requireServiceScope } from './service-auth.js';
import { config } from './config.js';
import { scoreMedicineMatch } from './medicine-match-scoring.js';
import { buildNameNgramIdf } from '@pharma/algorithm-kernel';
export { scoreMedicineMatch };

const router = express.Router();
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MAX_CATALOGUE_UPLOAD_BYTES = config.maxUploadBytes;
const CATALOGUE_CHUNK_SIZE = 500;
const LARGE_IMPORT_THRESHOLD_BYTES = 10 * 1024 * 1024;
const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));
const catalogueGridFsStorage = {
  _handleFile(_req, file, callback) {
    const stream = getCatalogueImportBucket().openUploadStream(String(file.originalname || 'catalogue.json').slice(0, 180));
    let size = 0;
    file.stream.on('data', chunk => { size += chunk.length; });
    file.stream.pipe(stream);
    stream.once('error', callback);
    stream.once('finish', () => callback(null, { id: stream.id, size, filename: stream.filename }));
  },
  _removeFile(_req, file, callback) {
    if (!file.id) return callback(null);
    getCatalogueImportBucket().delete(file.id).then(() => callback(null), callback);
  }
};
const upload = multer({ storage: catalogueGridFsStorage, limits: { fileSize: MAX_CATALOGUE_UPLOAD_BYTES, files: 1 } });
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

// Read every matching master row in stable _id order. Bounded pages avoid
// Mongo result limits without silently treating a partial scan as complete.
export async function collectCatalogueCandidates(fetchPage, batchSize = 1000) {
  if (typeof fetchPage !== 'function' || !Number.isInteger(batchSize) || batchSize < 1) {
    throw new TypeError('A page loader and positive integer batch size are required.');
  }
  const results = [];
  let after = null;
  while (true) {
    const page = await fetchPage({ after, limit: batchSize });
    if (!Array.isArray(page)) throw new TypeError('Catalogue candidate page must be an array.');
    results.push(...page);
    if (page.length < batchSize) break;
    const next = page[page.length - 1]?._id;
    if (next == null || next === after) {
      throw new Error('Catalogue candidate pagination did not advance; refusing an incomplete reconciliation scan.');
    }
    after = next;
  }
  return results;
}

async function loadCatalogueCandidates(filter, projection) {
  return collectCatalogueCandidates(({ after, limit }) => {
    const pageFilter = after ? { $and: [filter, { _id: { $gt: after } }] } : filter;
    return MedicineMaster.find(pageFilter, projection).sort({ _id: 1 }).limit(limit).lean();
  });
}

async function reconcileCatalogueRecordsAgainstMaster(records) {
  const ids = [...new Set(records.flatMap(item => [item.medicineId, item.reconciliationMatch?.targetMedicineId].filter(Boolean)))];
  const canonicalKeys = [...new Set(records.map(item => item.canonicalKey).filter(Boolean))];
  const names = [...new Set(records.filter(item => item.safeNameMatch).map(item => item.brandName).filter(Boolean))];
  const prefixes = [...new Set(records.map(item => key(item.brandName).slice(0, 2)).filter(value => value.length === 2))];
  const scannedPrefixes = new Set(prefixes);
  const clauses = [
    ...(ids.length ? [{ medicineId: { $in: ids } }] : []),
    ...(canonicalKeys.length ? [{ canonicalKey: { $in: canonicalKeys } }] : []),
    ...(names.length ? [{ brandName: { $in: names } }] : []),
    ...prefixes.map(prefix => ({ brandName: { $regex: '^' + prefix, $options: 'i' } }))
  ];
  const [candidates, archivedIdentityRows] = await Promise.all([
    clauses.length ? loadCatalogueCandidates({ $or: clauses, isArchived: { $ne: true } }, {
      _id: 1, medicineId: 1, canonicalKey: 1, brandName: 1, genericName: 1, composition: 1,
      ingredients: 1, strength: 1, dosageForm: 1, manufacturer: 1
    }) : [],
    ids.length ? MedicineMaster.find({ medicineId: { $in: ids }, isArchived: true }, { medicineId: 1 }).lean() : []
  ]);
  const scanTruncated = false;
  const activeCandidates = candidates;
  const byId = new Map(activeCandidates.map(item => [item.medicineId, item]));
  const keyGroups = new Map(), nameGroups = new Map(), prefixGroups = new Map();
  for (const candidate of activeCandidates) {
    if (candidate.canonicalKey) keyGroups.set(candidate.canonicalKey, [...(keyGroups.get(candidate.canonicalKey) || []), candidate]);
    const nameKey = key(candidate.brandName);
    nameGroups.set(nameKey, [...(nameGroups.get(nameKey) || []), candidate]);
    const prefix = nameKey.slice(0, 2);
    if (prefix.length === 2) prefixGroups.set(prefix, [...(prefixGroups.get(prefix) || []), candidate]);
  }
  const unique = groups => new Map([...groups.entries()].filter(([, group]) => group.length === 1).map(([identity, group]) => [identity, group[0]]));
  const byKey = unique(keyGroups), byName = unique(nameGroups);
  const nameNgramIdf = buildNameNgramIdf(activeCandidates);
  const plans = [];
  const blockers = [];
  for (const item of records) {
    const old = item.reconciliationMatch || null;
    if (archivedIds.has(item.medicineId)) {
      blockers.push({ medicineId: item.medicineId, brandName: item.brandName, reason: 'ARCHIVED_MEDICINE_ID_COLLISION' });
      plans.push({ decision: 'BLOCKED_CONFLICT', targetMedicineId: '', method: 'ARCHIVED_MEDICINE_ID_COLLISION', warnings: ['MEDICINE_ID_EXISTS_ON_ARCHIVED_MASTER_RECORD'] });
      continue;
    }
    if (['MANUAL_REVIEW', 'BLOCKED_CONFLICT'].includes(old?.decision)) {
      blockers.push({ medicineId: item.medicineId, brandName: item.brandName, reason: old.decision, warnings: old.warnings || [] });
      plans.push({ decision: old.decision, targetMedicineId: old.targetMedicineId || '' });
      continue;
    }
    const ambiguousCanonical = item.canonicalKey && (keyGroups.get(item.canonicalKey) || []).length > 1;
    const ambiguousName = item.safeNameMatch && (nameGroups.get(key(item.brandName)) || []).length > 1;
    const exact = byId.get(item.medicineId) ||
      (item.canonicalKey ? byKey.get(item.canonicalKey) : null) ||
      (item.safeNameMatch ? byName.get(key(item.brandName)) : null);
    let plan;
    if (ambiguousCanonical || ambiguousName) {
      plan = { decision: 'MANUAL_REVIEW', targetMedicineId: '', method: 'AMBIGUOUS_MASTER_IDENTITY', score: 0, warnings: [ ...(ambiguousCanonical ? ['DUPLICATE_CANONICAL_KEY_IN_MASTER'] : []), ...(ambiguousName ? ['DUPLICATE_NORMALIZED_BRAND_NAME_IN_MASTER'] : []) ] };
    } else if (exact) {
      const evidence = scoreMedicineMatch(item, exact, { nameNgramIdf });
      if (evidence.decision === 'BLOCKED_CONFLICT' || evidence.warnings.includes('GENERIC_INGREDIENT_CONFLICT')) {
        const decision = evidence.decision === 'BLOCKED_CONFLICT' ? 'BLOCKED_CONFLICT' : 'MANUAL_REVIEW';
        plan = { decision, targetMedicineId: exact.medicineId, method: 'EXACT_IDENTITY_WITH_CLINICAL_CONFLICT', score: evidence.score, warnings: evidence.warnings };
      } else {
        plan = { decision: 'AUTO_MERGE', targetMedicineId: exact.medicineId, method: 'FRESH_EXACT_OR_CANONICAL', score: 100, warnings: [] };
      }
    } else {
      let best = null;
      let tiedBest = false;
      const prefix = key(item.brandName).slice(0, 2);
      if (!scannedPrefixes.has(prefix)) {
        plan = { decision: 'MANUAL_REVIEW', targetMedicineId: '', method: 'FUZZY_CANDIDATE_PREFIX_NOT_SCANNED', score: 0, warnings: ['CANDIDATE_SCAN_PREFIX_LIMIT_REACHED'] };
      } else {
        for (const candidate of prefixGroups.get(prefix) || []) {
          const scored = scoreMedicineMatch(item, candidate, { nameNgramIdf });
          if (!best || scored.score > best.score) { best = { candidate, ...scored }; tiedBest = false; }
          else if (scored.score === best.score) tiedBest = true;
        }
      }
      if (plan) {
        // Candidate prefix was not scanned; keep this row out of automatic insert/update.
      } else if (best && tiedBest) {
        plan = { decision: 'MANUAL_REVIEW', targetMedicineId: '', method: 'AMBIGUOUS_TOP_MATCHES', score: best.score, warnings: ['MULTIPLE_CANDIDATES_SHARE_TOP_SCORE'] };
      } else if (best && best.decision === 'AUTO_MERGE') {
        plan = { decision: 'AUTO_MERGE', targetMedicineId: best.candidate.medicineId, method: 'FRESH_HYBRID_TFIDF_NGRAM_LINKAGE', score: best.score, warnings: best.warnings };
      } else if (best && ['MANUAL_REVIEW', 'BLOCKED_CONFLICT'].includes(best.decision)) {
        plan = { decision: best.decision, targetMedicineId: best.candidate.medicineId, method: 'FRESH_HYBRID_TFIDF_NGRAM_LINKAGE', score: best.score, warnings: best.warnings };
      } else {
        plan = { decision: 'NO_MATCH', targetMedicineId: '', method: 'FRESH_NO_MATCH', score: 0, warnings: [] };
      }
    }
    const oldTarget = old?.decision === 'AUTO_MERGE' ? old.targetMedicineId : '';
    const newTarget = plan.decision === 'AUTO_MERGE' ? plan.targetMedicineId : '';
    const idempotentPreviouslyInsertedRecord = !oldTarget && newTarget === item.medicineId;
    if (oldTarget !== newTarget && !idempotentPreviouslyInsertedRecord) {
      blockers.push({ medicineId: item.medicineId, brandName: item.brandName, reason: 'STALE_RECONCILIATION', previousTargetMedicineId: oldTarget, currentTargetMedicineId: newTarget, currentDecision: plan.decision });
    }
    if (['MANUAL_REVIEW', 'BLOCKED_CONFLICT'].includes(plan.decision)) {
      blockers.push({ medicineId: item.medicineId, brandName: item.brandName, reason: plan.decision, targetMedicineId: plan.targetMedicineId, score: plan.score, warnings: plan.warnings });
    }
    plans.push(plan);
  }
  const targetCounts = new Map();
  for (const plan of plans) if (plan.decision === 'AUTO_MERGE' && plan.targetMedicineId) targetCounts.set(plan.targetMedicineId, (targetCounts.get(plan.targetMedicineId) || 0) + 1);
  for (const [targetMedicineId, count] of targetCounts) if (count > 1) blockers.push({ reason: 'MULTIPLE_INCOMING_RECORDS_TARGET_SAME_MEDICINE', targetMedicineId, count });
  if (scanTruncated && plans.some(plan => plan.decision === 'NO_MATCH')) blockers.push({ reason: 'FUZZY_CANDIDATE_SCAN_TRUNCATED', message: 'The live candidate scan exceeded its safety limit; unmatched records cannot safely be inserted.' });
  return {
    plans, blockers, scanTruncated,
    summary: {
      checkedRecords: records.length,
      matchedUpdates: plans.filter(plan => plan.decision === 'AUTO_MERGE').length,
      newInserts: plans.filter(plan => plan.decision === 'NO_MATCH').length,
      manualReview: plans.filter(plan => plan.decision === 'MANUAL_REVIEW').length,
      clinicalConflicts: plans.filter(plan => plan.decision === 'BLOCKED_CONFLICT').length,
      staleDecisions: blockers.filter(item => item.reason === 'STALE_RECONCILIATION').length,
      blockerCount: blockers.length,
      candidateScanTruncated: scanTruncated,
      blockerExamples: blockers.slice(0, 50)
    }
  };
}

export const fuzzyCandidatePrefixes = records => [...new Set(records.map(item => key(item.brandName).slice(0, 2)).filter(value => value.length === 2))];
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
  lastManuallyUpdatedAt: { type: Date, default: null },
  isArchived: { type: Boolean, default: false, index: true },
  archivedAt: { type: Date, default: null },
  archivedBy: { type: String, default: '' }
}, { timestamps: true });
medicineMasterSchema.index({ brandName: 'text', genericName: 'text', composition: 'text', manufacturer: 'text', uses: 'text', sideEffects: 'text', therapeuticClass: 'text', chemicalClass: 'text', actionClass: 'text' });
medicineMasterSchema.index({ brandName: 1 }, { collation: { locale: 'en', strength: 2 } });
const catalogueImportSchema = new mongoose.Schema({
  batchId: { type: String, required: true, unique: true },
  dataset: { type: String, enum: ['INDIAN_MEDICINE_DATA', 'INDIA_MEDICINES_INFO', 'MEDICINES_PART_1', 'MULTI_SOURCE'], required: true },
  fileName: { type: String, required: true },
  fileSha256: { type: String, required: true },
  processingJobId: { type: String, default: '' },
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
  isHidden: { type: Boolean, default: false, index: true },
  hiddenAt: { type: Date, default: null },
  hiddenBy: { type: String, default: '' },
  approvedBy: { type: String, default: '' },
  approvedAt: { type: Date, default: null }
}, { timestamps: true });
catalogueImportSchema.index({ dataset: 1, fileSha256: 1 }, { unique: true });
const catalogueImportJobSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true, index: true },
  fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  fileName: { type: String, required: true }, fileSize: { type: Number, default: 0 },
  uploadedBy: { type: String, required: true }, serviceName: { type: String, default: '' },
  dataset: { type: String, default: '' }, status: { type: String, enum: ['QUEUED','PROCESSING','READY','FAILED'], default: 'QUEUED', index: true },
  stage: { type: String, default: 'QUEUED' }, progressPercent: { type: Number, default: 0 },
  processedRecords: { type: Number, default: 0 }, totalRecords: { type: Number, default: 0 },
  attempts: { type: Number, default: 0 }, leaseExpiresAt: { type: Date, default: null },
  batchId: { type: String, default: '' }, report: { type: mongoose.Schema.Types.Mixed, default: null },
  reportFingerprint: { type: String, default: '' }, sample: { type: [mongoose.Schema.Types.Mixed], default: [] },
  errorMessage: { type: String, default: '' }, startedAt: { type: Date, default: null }, completedAt: { type: Date, default: null }
}, { timestamps: true });
catalogueImportJobSchema.index({ status: 1, leaseExpiresAt: 1, createdAt: 1 });
const CatalogueImportJob = mongoose.models.MedicineCatalogueImportJob || mongoose.model('MedicineCatalogueImportJob', catalogueImportJobSchema);
let catalogueImportBucket;
let catalogueImportWorkerTimer;
let catalogueImportWorkerBusy = false;
const getCatalogueImportBucket = () => catalogueImportBucket || (catalogueImportBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'medicineCatalogueUploads' }));
const updateCatalogueImportJob = (jobId, values) => CatalogueImportJob.updateOne({ jobId }, { $set: values });
const streamToBuffer = async stream => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};
async function processNextCatalogueImportJob() {
  if (catalogueImportWorkerBusy || mongoose.connection.readyState !== 1) return;
  catalogueImportWorkerBusy = true;
  let job;
  let heartbeat;
  try {
    job = await CatalogueImportJob.findOneAndUpdate({
      $or: [{ status: 'QUEUED' }, { status: 'PROCESSING', leaseExpiresAt: { $lt: new Date() } }]
    }, { $set: { status: 'PROCESSING', stage: 'ANALYZING', leaseExpiresAt: new Date(Date.now() + 15 * 60 * 1000), startedAt: new Date(), errorMessage: '' }, $inc: { attempts: 1 } }, { sort: { createdAt: 1 }, new: true });
    if (!job) return;
    heartbeat = setInterval(() => { void CatalogueImportJob.updateOne({ jobId: job.jobId, status: 'PROCESSING' }, { $set: { leaseExpiresAt: new Date(Date.now() + 15 * 60 * 1000) } }).catch(() => {}); }, 60000);
    heartbeat.unref?.();
    const buffer = await streamToBuffer(getCatalogueImportBucket().openDownloadStream(job.fileId));
    const fakeResponse = {
      statusCode: 200, payload: null,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.payload = value; return this; }
    };
    await processCatalogueImportPreview({
      file: { buffer, size: job.fileSize, originalname: job.fileName },
      body: { dataset: job.dataset }, service: { userId: job.uploadedBy, name: job.serviceName, isPlatformUser: true },
      importJob: job.jobId
    }, fakeResponse);
    if (fakeResponse.statusCode >= 400 || !fakeResponse.payload?.batchId) throw new Error(fakeResponse.payload?.message || 'Catalogue import processing failed.');
    await CatalogueImportJob.updateOne({ jobId: job.jobId }, { $set: {
      status: 'READY', stage: 'READY', progressPercent: 100, batchId: fakeResponse.payload.batchId,
      dataset: fakeResponse.payload.dataset || job.dataset, report: fakeResponse.payload.report || {},
      reportFingerprint: fakeResponse.payload.reportFingerprint || '', sample: fakeResponse.payload.sample || [],
      processedRecords: fakeResponse.payload.report?.sourceRecords || 0, totalRecords: fakeResponse.payload.report?.sourceRecords || 0,
      leaseExpiresAt: null, completedAt: new Date()
    } });
  } catch (error) {
    if (job) await CatalogueImportJob.updateOne({ jobId: job.jobId }, { $set: {
      status: 'FAILED', stage: 'FAILED', leaseExpiresAt: null, errorMessage: String(error.message || 'Import processing failed.').slice(0, 1000), completedAt: new Date()
    } });
  } finally { if (heartbeat) clearInterval(heartbeat); catalogueImportWorkerBusy = false; }
}
export function startMedicineCatalogueImportWorker() {
  if (catalogueImportWorkerTimer) return;
  catalogueImportWorkerTimer = setInterval(() => { void processNextCatalogueImportJob(); }, 1500);
  catalogueImportWorkerTimer.unref?.();
}
export function stopMedicineCatalogueImportWorker() {
  if (catalogueImportWorkerTimer) clearInterval(catalogueImportWorkerTimer);
  catalogueImportWorkerTimer = null;
}

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

export async function consolidateInBatches(records, dataset, onProgress = null) {
  const unique = new Map(); let rejected = 0; let sourceRecords = 0;
  for (const raw of records) {
    sourceRecords += 1;
    if (sourceRecords > 60000) throw Object.assign(new Error('Dataset exceeds the 60,000-record import limit.'), { statusCode: 413 });
    const normalized = normalizeMedicineRecord(raw, dataset || raw.__dataset);
    if (!normalized) rejected += 1;
    else {
      Object.assign(normalized, assessMedicineQuality(normalized));
      normalized.dataQualityStatus = normalized.qualityGrade === 'EXCELLENT' || normalized.qualityGrade === 'GOOD' ? 'GOOD' : normalized.qualityGrade === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'PARTIAL';
      const identity = dataset === 'INDIAN_MEDICINE_DATA' ? normalized.medicineId : dataset === 'MEDICINES_PART_1' ? normalized.sourceFingerprint : (normalized.canonicalKey || normalized.medicineId);
      const previous = unique.get(identity);
      if (!previous) unique.set(identity, normalized);
      else {
        for (const field of ['genericName','genericId','productId','productName','manufacturer','manufacturerId','composition','strength','packSize','dosageForm','medicineType']) if (!previous[field] && normalized[field]) previous[field] = normalized[field];
        for (const field of ['ingredientIds','ingredients','ingredientDetails','routeIds','routes','casNumbers','uniiCodes','substanceDescriptions','molecularFormulas','inchiValues','iupacNames','molecularWeights','smiles','toxicology','indications','contraindications','drugInteractions']) {
          const identityOf = value => typeof value === 'object' && value !== null ? (value.ingredientId || key(value.name) || JSON.stringify(value)) : key(value);
          previous[field] = [...new Map([...previous[field], ...normalized[field]].map(value => [identityOf(value), value])).values()];
        }
        previous.qualityIssues = [...new Set([...(previous.qualityIssues || []), ...(normalized.qualityIssues || [])])];
        previous.sourceRecordIds = [...new Set([...(previous.sourceRecordIds || [previous.sourceRecordId]), normalized.sourceRecordId])];
      }
    }
    if (sourceRecords % CATALOGUE_CHUNK_SIZE === 0) {
      if (onProgress) await onProgress(sourceRecords);
      await yieldToEventLoop();
    }
  }
  const consolidatedRecords = [...unique.values()];
  for (let offset = 0; offset < consolidatedRecords.length; offset += CATALOGUE_CHUNK_SIZE) {
    for (const record of consolidatedRecords.slice(offset, offset + CATALOGUE_CHUNK_SIZE)) {
      Object.assign(record, assessMedicineQuality(record));
      record.dataQualityStatus = record.qualityGrade === 'EXCELLENT' || record.qualityGrade === 'GOOD' ? 'GOOD' : record.qualityGrade === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'PARTIAL';
    }
    await yieldToEventLoop();
  }
  return { records: consolidatedRecords, rejected, sourceRecords, duplicatesRemoved: sourceRecords - rejected - unique.size };
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

async function processCatalogueImportPreview(req, res) {
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
    normalized = req.file.size > LARGE_IMPORT_THRESHOLD_BYTES
      ? await consolidateInBatches(sourceRows, dataset, req.importJob ? count => updateCatalogueImportJob(req.importJob, { stage: 'NORMALIZING', progressPercent: Math.min(30, 5 + Math.round(count / 60000 * 25)), processedRecords: count }) : null)
      : consolidate(sourceRows, dataset);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ message: error.message });
  }
  let { records, rejected, sourceRecords, duplicatesRemoved } = normalized;
  if (req.importJob) await updateCatalogueImportJob(req.importJob, { stage: 'RECONCILING', progressPercent: 35, processedRecords: sourceRecords, totalRecords: sourceRecords });
  if (!sourceRecords) return res.status(400).json({ message: 'The uploaded medicine dataset contains no records.' });
  const nameCounts = new Map();
  for (let offset = 0; offset < records.length; offset += CATALOGUE_CHUNK_SIZE) { for (const item of records.slice(offset, offset + CATALOGUE_CHUNK_SIZE)) { const nameKey = key(item.brandName); nameCounts.set(nameKey, (nameCounts.get(nameKey) || 0) + 1); } if (req.file.size > LARGE_IMPORT_THRESHOLD_BYTES) await yieldToEventLoop(); }
  for (const item of records) item.safeNameMatch = dataset === 'MEDICINES_PART_1' && nameCounts.get(key(item.brandName)) === 1;
  const batchId = randomUUID();
  const fileSha256 = hash(req.file.buffer);
  const previousBatch = await CatalogueImport.findOne({ dataset, fileSha256, isHidden: { $ne: true } }).lean();
  if (previousBatch) {
    if (previousBatch.status === 'STAGING') {
      const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
      const ownerJob = previousBatch.processingJobId && previousBatch.processingJobId !== req.importJob
        ? await CatalogueImportJob.findOne({ jobId: previousBatch.processingJobId }, { status: 1, leaseExpiresAt: 1 }).lean()
        : null;
      const ownerStillActive = ownerJob?.status === 'PROCESSING' && ownerJob.leaseExpiresAt > new Date();
      const abandoned = previousBatch.processingJobId === req.importJob || (!ownerStillActive && (!previousBatch.updatedAt || previousBatch.updatedAt < staleBefore));
      if (abandoned) {
        await CatalogueImportChunk.deleteMany({ batchId: previousBatch.batchId });
        await CatalogueImport.deleteOne({ _id: previousBatch._id, status: 'STAGING' });
      } else {
        return res.status(409).json({ message: 'This identical dataset is still being staged. Retry shortly.' });
      }
    } else {
    const firstChunk = await CatalogueImportChunk.findOne({ batchId: previousBatch.batchId, chunkIndex: 0 }).lean();
    const reportFingerprint = previousBatch.reportFingerprint || hash(JSON.stringify(previousBatch.report || {}));
    if (!previousBatch.reportFingerprint) await CatalogueImport.updateOne({ _id: previousBatch._id }, { $set: { reportFingerprint } });
    return res.status(200).json({ batchId: previousBatch.batchId, dataset, status: previousBatch.status, report: previousBatch.report, reportFingerprint, sample: (firstChunk?.records || previousBatch.records || []).slice(0, 8), reused: true });
    }
  }
  const ids = records.map(record => record.medicineId);
  const canonicalKeys = records.map(record => record.canonicalKey).filter(Boolean);
  const names = dataset === 'MEDICINES_PART_1' ? [...new Set(records.filter(item => item.safeNameMatch).map(item => item.brandName))] : [];
  const incomingKeyCounts = new Map();
  for (let offset = 0; offset < records.length; offset += CATALOGUE_CHUNK_SIZE) { for (const item of records.slice(offset, offset + CATALOGUE_CHUNK_SIZE)) if (item.canonicalKey) incomingKeyCounts.set(item.canonicalKey, (incomingKeyCounts.get(item.canonicalKey) || 0) + 1); if (req.file.size > LARGE_IMPORT_THRESHOLD_BYTES) await yieldToEventLoop(); }
  const candidateProjection = { medicineId: 1, canonicalKey: 1, brandName: 1 };
  const exactCandidates = await MedicineMaster.find({ $or: [{ medicineId: { $in: ids } }, { canonicalKey: { $in: canonicalKeys } }] }, candidateProjection).lean();
  const nameCandidates = names.length
    ? await MedicineMaster.find({ brandName: { $in: names } }, candidateProjection).collation({ locale: 'en', strength: 2 }).lean()
    : [];
  const fuzzyPrefixes = fuzzyCandidatePrefixes(records);
  const fuzzyCandidates = fuzzyPrefixes.length
    ? await loadCatalogueCandidates(
      { $or: fuzzyPrefixes.map(prefix => ({ brandName: { $regex: '^' + prefix, $options: 'i' } })) },
      { _id: 1, medicineId: 1, canonicalKey: 1, brandName: 1, genericName: 1, composition: 1, ingredients: 1, strength: 1, dosageForm: 1, manufacturer: 1 }
    )
    : [];
  const existingByMongoId = new Map();
  for (const candidate of [...exactCandidates, ...nameCandidates, ...fuzzyCandidates]) existingByMongoId.set(String(candidate._id), candidate);
  const existing = [...existingByMongoId.values()];
  const existingById = new Map(existing.map(item => [item.medicineId, item]));
  const existingKeyGroups = new Map();
  const existingNameGroups = new Map();
  const existingByNamePrefix = new Map();
  for (const candidate of existing) {
    if (candidate.canonicalKey) existingKeyGroups.set(candidate.canonicalKey, [...(existingKeyGroups.get(candidate.canonicalKey) || []), candidate]);
    const nameKey = key(candidate.brandName);
    existingNameGroups.set(nameKey, [...(existingNameGroups.get(nameKey) || []), candidate]);
    const prefix = nameKey.slice(0, 2);
    if (prefix.length === 2) existingByNamePrefix.set(prefix, [...(existingByNamePrefix.get(prefix) || []), candidate]);
  }
  const existingNameCounts = new Map([...existingNameGroups.entries()].map(([nameKey, group]) => [nameKey, group.length]));
  const nameNgramIdf = buildNameNgramIdf(existing);
  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    if (req.file.size > LARGE_IMPORT_THRESHOLD_BYTES && recordIndex > 0 && recordIndex % 100 === 0) await yieldToEventLoop();
    const item = records[recordIndex];
    const exact = existingById.get(item.medicineId) ||
      (item.canonicalKey && incomingKeyCounts.get(item.canonicalKey) === 1 && existingKeyGroups.get(item.canonicalKey)?.length === 1 ? existingKeyGroups.get(item.canonicalKey)[0] : null) ||
      (item.safeNameMatch && existingNameCounts.get(key(item.brandName)) === 1 ? existingNameGroups.get(key(item.brandName))?.[0] : null);
    if (exact) { item.reconciliationMatch = { targetMedicineId: exact.medicineId, method: 'EXACT_OR_CANONICAL', score: 100, decision: 'AUTO_MERGE', warnings: [] }; continue; }
    let best = null;
    const prefix = key(item.brandName).slice(0, 2);
    const candidates = existingByNamePrefix.get(prefix) || [];
    for (const candidate of candidates) {
      const scored = scoreMedicineMatch(item, candidate, { nameNgramIdf });
      if (!best || scored.score > best.score) best = { candidate, ...scored };
    }
    if (best && ['AUTO_MERGE', 'MANUAL_REVIEW'].includes(best.decision)) {
      item.reconciliationMatch = { targetMedicineId: best.candidate.medicineId, method: 'HYBRID_TFIDF_NGRAM_LINKAGE', score: best.score, nameScore: best.nameScore, compositionScore: best.compositionScore, decision: best.decision, warnings: best.warnings };
    }
  }
  const recordsByMasterTarget = new Map();
  const deduplicatedRecords = [];
  let fuzzyTargetDuplicatesMerged = 0;
  for (let index = 0; index < records.length; index += 1) {
    if (req.file.size > LARGE_IMPORT_THRESHOLD_BYTES && index > 0 && index % CATALOGUE_CHUNK_SIZE === 0) await yieldToEventLoop();
    const item = records[index];
    const targetId = item.reconciliationMatch?.decision === 'AUTO_MERGE' ? item.reconciliationMatch.targetMedicineId : '';
    if (targetId && recordsByMasterTarget.has(targetId)) {
      const index = recordsByMasterTarget.get(targetId);
      deduplicatedRecords[index] = mergeStagedMedicine(deduplicatedRecords[index], item);
      fuzzyTargetDuplicatesMerged += 1;
    } else {
      if (targetId) recordsByMasterTarget.set(targetId, deduplicatedRecords.length);
      deduplicatedRecords.push(item);
    }
  }
  records = deduplicatedRecords;
  duplicatesRemoved += fuzzyTargetDuplicatesMerged;
  const fuzzyAutoMerge = records.filter(item => item.reconciliationMatch?.method === 'HYBRID_TFIDF_NGRAM_LINKAGE' && item.reconciliationMatch.decision === 'AUTO_MERGE').length;
  const fuzzyManualReview = records.filter(item => item.reconciliationMatch?.decision === 'MANUAL_REVIEW').length;
  const updateCandidates = records.filter(item => item.reconciliationMatch?.decision === 'AUTO_MERGE').length;
  if (req.importJob) await updateCatalogueImportJob(req.importJob, { stage: 'STAGING', progressPercent: 75, processedRecords: sourceRecords, totalRecords: sourceRecords });
  const report = {
    sourceRecords, normalizedRecords: records.length, rejectedRecords: rejected,
    duplicatesRemoved, newRecords: Math.max(0, records.length - updateCandidates), updateCandidates, fuzzyTargetDuplicatesMerged,
    fuzzyAutoMerge, fuzzyManualReview, unmatchedRecords: Math.max(0, records.length - updateCandidates - fuzzyManualReview),
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
    fuzzyMatchExamples: records.filter(item => item.reconciliationMatch?.method === 'HYBRID_TFIDF_NGRAM_LINKAGE').slice(0, 25).map(item => ({
      incomingMedicine: item.brandName, matchedMedicineId: item.reconciliationMatch.targetMedicineId,
      score: item.reconciliationMatch.score, nameScore: item.reconciliationMatch.nameScore, tokenNameScore: item.reconciliationMatch.tokenNameScore, ngramNameScore: item.reconciliationMatch.ngramNameScore, tfIdfNameScore: item.reconciliationMatch.tfIdfNameScore, compositionScore: item.reconciliationMatch.compositionScore, evidence: item.reconciliationMatch.evidence, decision: item.reconciliationMatch.decision, warnings: item.reconciliationMatch.warnings
    })),
    fuzzyCandidateStrategy: 'NORMALIZED_TWO_CHARACTER_PREFIX',
    fuzzyCandidateScanTruncated: fuzzyPrefixes.length >= 120 || fuzzyCandidates.length >= 5000
  };
  const reportFingerprint = hash(JSON.stringify(report));
  const chunks = [];
  for (let offset = 0; offset < records.length; offset += CATALOGUE_CHUNK_SIZE) chunks.push({ batchId, chunkIndex: chunks.length, records: records.slice(offset, offset + CATALOGUE_CHUNK_SIZE) });
  await CatalogueImport.create({
    batchId, dataset, fileName: String(req.file.originalname || 'medicine-catalogue.json').slice(0, 180),
    fileSha256, processingJobId: req.importJob || '', uploadedBy: req.service.userId || req.service.name,
    status: 'STAGING', recordCount: records.length, chunkCount: chunks.length, report, reportFingerprint
  });
  try {
    for (const stagedChunk of chunks) { await CatalogueImportChunk.insertMany([stagedChunk], { ordered: true }); if (req.file.size > LARGE_IMPORT_THRESHOLD_BYTES) await yieldToEventLoop(); }
    await CatalogueImport.updateOne({ batchId }, { $set: { status: 'READY' } });
  } catch (error) {
    await CatalogueImportChunk.deleteMany({ batchId });
    await CatalogueImport.deleteOne({ batchId });
    throw error;
  }

}
router.post('/imports/preview', upload.single('jsonFile'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Select a JSON file to upload.' });
  const jobId = randomUUID();
  await CatalogueImportJob.create({
    jobId, fileId: req.file.id, fileName: String(req.file.originalname || 'medicine-catalogue.json').slice(0, 180),
    fileSize: req.file.size, uploadedBy: req.service.userId || req.service.name,
    serviceName: req.service.name || '', dataset: req.body?.dataset || '',
    status: 'QUEUED', stage: 'QUEUED', progressPercent: 0, attempts: 0
  });
  return res.status(202).json({ jobId, status: 'QUEUED', progressPercent: 0, message: 'Upload stored. Catalogue processing has been queued.' });
}));

const MERGE_ARRAY_FIELDS = ['ingredientIds','ingredients','ingredientDetails','routes','indications','contraindications','drugInteractions','alternatives','sideEffects','uses','suggestedAlternatives','routeIds','casNumbers','uniiCodes','substanceDescriptions','molecularFormulas','inchiValues','iupacNames','molecularWeights','smiles','toxicology'];
const MERGE_TEXT_FIELDS = ['brandName','genericName','genericId','productId','productName','manufacturer','manufacturerId','composition','strength','packSize','dosageForm','medicineType','chemicalClass','therapeuticClass','actionClass','sourceLicenseStatusValue','drugFormId','sourceImageUrl'];
export const mergeStagedMedicine = (left, right) => {
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
  const matchCandidates = [left.reconciliationMatch, right.reconciliationMatch].filter(Boolean);
  const autoTargets = [...new Set(matchCandidates.filter(match => match.decision === 'AUTO_MERGE' && match.targetMedicineId).map(match => match.targetMedicineId))];
  if (autoTargets.length > 1) {
    merged.reconciliationMatch = { decision: 'MANUAL_REVIEW', method: 'CONFLICTING_MASTER_TARGETS', score: Math.max(...matchCandidates.map(match => Number(match.score || 0))), warnings: ['CONFLICTING_EXISTING_MASTER_MATCHES'] };
  } else if (autoTargets.length === 1) {
    merged.reconciliationMatch = matchCandidates.find(match => match.decision === 'AUTO_MERGE' && match.targetMedicineId === autoTargets[0]);
  } else if (matchCandidates.length) {
    merged.reconciliationMatch = matchCandidates.sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  }
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
  const batches = await CatalogueImport.find({ batchId: { $in: batchIds }, isHidden: { $ne: true } }).lean();
  if (batches.length !== batchIds.length || batches.some(batch => batch.status !== 'READY' || batch.approvedAt)) {
    return res.status(409).json({ message: 'All selected batches must exist, remain staged and ready, and not already be approved.' });
  }
  const sourceBatchIds = batches.map(batch => batch.batchId).sort();
  const fileSha256 = hash(sourceBatchIds.join('|'));
  const previous = await CatalogueImport.findOne({ dataset: 'MULTI_SOURCE', fileSha256, isHidden: { $ne: true } }).lean();
  if (previous) return res.json({ batchId: previous.batchId, dataset: previous.dataset, status: previous.status, report: previous.report, reportFingerprint: previous.reportFingerprint, reused: true });
  const allChunks = await CatalogueImportChunk.find({ batchId: { $in: sourceBatchIds } }).sort({ batchId: 1, chunkIndex: 1 }).lean();
  const rawRecords = allChunks.flatMap(chunk => chunk.records || []);
  if (!rawRecords.length) return res.status(409).json({ message: 'Selected batches contain no staged medicine records.' });
  if (rawRecords.length > 60000) return res.status(413).json({ message: 'The selected batches contain more than 60,000 records combined. Merge fewer batches at a time.' });
  const identifierGroups = new Map();
  for (const record of rawRecords) identifierGroups.set(record.medicineId, [...(identifierGroups.get(record.medicineId) || []), record]);
  const identifierConflicts = [...identifierGroups.entries()].filter(([, group]) => group.length > 1 && group.some((record, index) => group.slice(index + 1).some(other => {
    const score = scoreMedicineMatch(record, other);
    return score.decision === 'BLOCKED_CONFLICT';
  })));
  const blockingConflicts = identifierConflicts.length;
  const exactGroups = new Map();
  let exactMerged = 0, fuzzyMerged = 0;
  const reviewCandidates = [];
  for (const record of rawRecords) {
    const identity = record.canonicalKey ? 'KEY:' + record.canonicalKey : 'ID:' + record.medicineId;
    const existing = exactGroups.get(identity);
    if (existing) { exactGroups.set(identity, mergeStagedMedicine(existing, record)); exactMerged += 1; }
    else exactGroups.set(identity, record);
  }
  const pending = [];
  const pendingIndexByRecord = new Map();
  const pendingByPrefix = new Map();
  let fuzzyScanTruncated = false;
  for (const record of exactGroups.values()) {
    const prefix = key(record.brandName).slice(0, 2);
    let best = null;
    if (prefix.length === 2) {
      const candidates = pendingByPrefix.get(prefix) || [];
      if (candidates.length > 200) fuzzyScanTruncated = true;
      for (const candidate of candidates.slice(0, 200)) {
        const score = scoreMedicineMatch(record, candidate);
        if (!best || score.score > best.score) best = { candidate, ...score };
      }
    }
    if (best?.decision === 'AUTO_MERGE') {
      const index = pendingIndexByRecord.get(best.candidate);
      const combined = mergeStagedMedicine(best.candidate, record);
      if (index !== undefined) { pending[index] = combined; pendingIndexByRecord.delete(best.candidate); pendingIndexByRecord.set(combined, index); }
      const candidates = pendingByPrefix.get(prefix) || [];
      const candidateIndex = candidates.indexOf(best.candidate);
      if (candidateIndex >= 0) candidates[candidateIndex] = combined;
      fuzzyMerged += 1;
    } else {
      if (best?.decision === 'MANUAL_REVIEW') reviewCandidates.push({ incomingMedicine: record.brandName, candidateMedicine: best.candidate.brandName, candidateMedicineId: best.candidate.medicineId, score: best.score, nameScore: best.nameScore, tokenNameScore: best.tokenNameScore, ngramNameScore: best.ngramNameScore, tfIdfNameScore: best.tfIdfNameScore, compositionScore: best.compositionScore, evidence: best.evidence, warnings: best.warnings });
      pendingIndexByRecord.set(record, pending.length);
      pending.push(record);
      if (prefix.length === 2) pendingByPrefix.set(prefix, [...(pendingByPrefix.get(prefix) || []), record]);
    }
  }
  const records = pending;
  const batchId = randomUUID();
  const report = {
    sourceRecords: rawRecords.length, normalizedRecords: records.length, rejectedRecords: 0,
    duplicatesRemoved: exactMerged + fuzzyMerged, newRecords: Math.max(0, records.length - records.filter(item => item.reconciliationMatch?.decision === 'AUTO_MERGE').length),
    updateCandidates: records.filter(item => item.reconciliationMatch?.decision === 'AUTO_MERGE').length,
    exactBatchMerges: exactMerged, fuzzyBatchMerges: fuzzyMerged, fuzzyManualReview: reviewCandidates.length + records.filter(item => item.reconciliationMatch?.decision === 'MANUAL_REVIEW').length,
    unmatchedRecords: Math.max(0, records.length - records.filter(item => ['AUTO_MERGE','MANUAL_REVIEW'].includes(item.reconciliationMatch?.decision)).length - reviewCandidates.length),
    blockingConflicts,
    sourceBatchCount: batches.length, sourceBatchIds,
    fuzzyMatchExamples: reviewCandidates.slice(0, 25).map(item => ({ incomingMedicine: item.incomingMedicine, candidateMedicine: item.candidateMedicine, matchedMedicineId: item.candidateMedicineId, score: item.score, nameScore: item.nameScore, tokenNameScore: item.tokenNameScore, ngramNameScore: item.ngramNameScore, tfIdfNameScore: item.tfIdfNameScore, compositionScore: item.compositionScore, evidence: item.evidence, decision: 'MANUAL_REVIEW', warnings: item.warnings })),
    fuzzyCandidateScanTruncated: fuzzyScanTruncated,
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
    if (blockingConflicts === 0) {
      const superseded = await CatalogueImport.updateMany(
        { batchId: { $in: sourceBatchIds }, status: 'READY', approvedAt: null },
        { $set: { status: 'SUPERSEDED', supersededByBatchId: batchId } }
      );
      if ((superseded.modifiedCount ?? superseded.nModified ?? 0) !== sourceBatchIds.length) throw Object.assign(new Error('One or more source batches changed state during merge. Refresh history and retry.'), { statusCode: 409 });
    }
    await CatalogueImport.updateOne({ batchId }, { $set: { status: 'READY' } });
  } catch (error) {
    await CatalogueImportChunk.deleteMany({ batchId });
    await CatalogueImport.deleteOne({ batchId });
    await CatalogueImport.updateMany({ batchId: { $in: sourceBatchIds }, status: 'SUPERSEDED', supersededByBatchId: batchId }, { $set: { status: 'READY', supersededByBatchId: '' } });
    throw error;
  }
  return res.status(201).json({ batchId, dataset: 'MULTI_SOURCE', status: 'READY', report, reportFingerprint, sourceBatchIds });
}));

router.post('/imports/jobs/:jobId/retry', asyncHandler(async (req, res) => {
  const job = await CatalogueImportJob.findOneAndUpdate(
    { jobId: req.params.jobId, status: 'FAILED' },
    { $set: { status: 'QUEUED', stage: 'QUEUED', progressPercent: 0, processedRecords: 0, totalRecords: 0, errorMessage: '', leaseExpiresAt: null, completedAt: null } },
    { new: true }
  ).lean();
  if (!job) return res.status(409).json({ message: 'Only a failed import job can be retried. Refresh the job status and try again.' });
  return res.status(202).json({ jobId: job.jobId, status: job.status, message: 'Import job queued for retry.' });
}));
router.post('/imports/jobs/:jobId/restart', asyncHandler(async (req, res) => {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 15 * 60 * 1000);
  const job = await CatalogueImportJob.findOneAndUpdate(
    { jobId: req.params.jobId, status: 'PROCESSING', $or: [{ leaseExpiresAt: { $lte: now } }, { leaseExpiresAt: null, updatedAt: { $lte: staleBefore } }] },
    { $set: { status: 'QUEUED', stage: 'QUEUED', progressPercent: 0, processedRecords: 0, totalRecords: 0, errorMessage: '', leaseExpiresAt: null, completedAt: null, batchId: '', report: null, reportFingerprint: '', sample: [] } },
    { new: true }
  ).lean();
  if (!job) return res.status(409).json({ message: 'This import is not stuck: only PROCESSING jobs with an expired worker lease can be restarted. Refresh history and try again.' });
  return res.status(202).json({ jobId: job.jobId, status: job.status, message: 'Stale import re-queued from its retained source upload.' });
}));
router.get('/imports/jobs/:jobId', asyncHandler(async (req, res) => {
  const job = await CatalogueImportJob.findOne({ jobId: req.params.jobId }).lean();
  if (!job) return res.status(404).json({ message: 'Catalogue import job was not found.' });
  return res.json({
    jobId: job.jobId, status: job.status, stage: job.stage, progressPercent: job.progressPercent,
    processedRecords: job.processedRecords, totalRecords: job.totalRecords, attempts: job.attempts,
    fileName: job.fileName, fileSize: job.fileSize, batchId: job.batchId, dataset: job.dataset,
    report: job.report, reportFingerprint: job.reportFingerprint, sample: job.sample,
    errorMessage: job.errorMessage, leaseExpiresAt: job.leaseExpiresAt, createdAt: job.createdAt, updatedAt: job.updatedAt, completedAt: job.completedAt
  });
}));
router.post('/imports/remove-selected', asyncHandler(async (req, res) => {
  const batchIds = [...new Set((Array.isArray(req.body?.batchIds) ? req.body.batchIds : []).map(value => text(value).slice(0, 120)).filter(Boolean))];
  if (!batchIds.length) return res.status(400).json({ message: 'Select at least one enrichment batch to permanently delete.' });
  if (batchIds.length > 10) return res.status(400).json({ message: 'You can permanently delete up to 10 enrichment batches at a time.' });
  const batches = await CatalogueImport.find({ batchId: { $in: batchIds } });
  if (batches.length !== batchIds.length) return res.status(404).json({ message: 'One or more selected batches were not found or have already been deleted. Refresh the batch history and try again.' });
  const protectedBatch = batches.find(batch => batch.status !== 'READY' || batch.approvedAt || (batch.sourceBatchIds || []).length > 0 || batch.supersededByBatchId);
  if (protectedBatch) return res.status(409).json({
    message: 'Only standalone, unapproved READY enrichment batches can be permanently deleted. Approved, merged, superseded, publishing or published batches are protected.',
    batchId: protectedBatch.batchId,
    status: protectedBatch.status
  });

  // Atomically claim each READY batch for deletion. A concurrent approval, merge or
  // publish changes the status first and therefore prevents destructive cleanup.
  const claimed = [];
  for (const batchId of batchIds) {
    const batch = await CatalogueImport.findOneAndDelete({
      batchId, status: 'READY', approvedAt: null,
      $or: [{ sourceBatchIds: { $exists: false } }, { sourceBatchIds: { $size: 0 } }],
      supersededByBatchId: { $in: ['', null] }
    });
    if (!batch) {
      // Restore batches already claimed in this request if the full selection could
      // not be claimed; no child data has been deleted at this point.
      for (const claimedBatch of claimed) await CatalogueImport.create(claimedBatch.toObject());
      return res.status(409).json({ message: 'A selected batch changed while deletion was in progress. No selected batch data was deleted; refresh and retry.' });
    }
    claimed.push(batch);
  }

  let deletedUploads = 0;
  for (const batch of claimed) {
    await CatalogueImportChunk.deleteMany({ batchId: batch.batchId });
    const jobs = await CatalogueImportJob.find({ batchId: batch.batchId }, { fileId: 1, jobId: 1 }).lean();
    for (const job of jobs) {
      if (job.fileId) {
        try { await getCatalogueImportBucket().delete(job.fileId); deletedUploads += 1; }
        catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'FileNotFound') throw error;
        }
      }
      await CatalogueImportJob.deleteOne({ jobId: job.jobId, batchId: batch.batchId });
    }
  }
  return res.json({
    removedCount: claimed.length, batchIds, deletedUploads,
    permanent: true,
    message: 'Selected enrichment batches, staged record chunks, import-job metadata and retained source uploads were permanently deleted.'
  });
}));

const MAPPED_MEDICINE_FIELDS = new Set(['brandName','productName','genericName','genericId','manufacturer','manufacturerId','productId','composition','ingredients','ingredientIds','ingredientDetails','strength','packSize','dosageForm','drugFormId','medicineType','therapeuticClass','chemicalClass','actionClass','routes','routeIds','indications','uses','contraindications','sideEffects','drugInteractions','alternatives','suggestedAlternatives','habitForming','requiresPrescription','prescriptionVerification','clinicalDataVerification','sourceLicenseStatus','sourceLicenseStatusValue','casNumbers','uniiCodes','substanceDescriptions','molecularFormulas','inchiValues','iupacNames','molecularWeights','smiles','toxicology','sourceImageUrl','dataQualityStatus','qualityScore','qualityGrade','qualityIssues','sourcePriority','sourceDatasets','sourceRecordIds','legacyMedicineIds','lastVerifiedAt']);
router.get('/matches/review', async (req, res, next) => {
  try {
    if (req.service?.isPlatformUser !== true) return res.status(403).json({ message: 'Only a platform super administrator can review medicine mappings.' });
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit || '100', 10) || 100));
    const status = String(req.query.status || 'PENDING').toUpperCase();
    const parsedMinConfidence = Number.parseInt(req.query.minConfidence ?? '80', 10);
    const minConfidence = Number.isFinite(parsedMinConfidence) ? Math.max(0, Math.min(100, parsedMinConfidence)) : 80;
    const filter = {
      confidence: { $gte: minConfidence },
      ...(status === 'ALL'
        ? { mappingStatus: { $ne: 'APPROVED' } }
        : status === 'PENDING'
          ? { $or: [{ mappingStatus: 'PENDING' }, { mappingStatus: { $exists: false } }] }
          : { mappingStatus: status })
    };
    const [rows, total] = await Promise.all([
      MedicineMatchReference.find(filter).sort({ updatedAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      MedicineMatchReference.countDocuments(filter)
    ]);
    const ids = [...new Set(rows.map(row => row.mappedMedicineId || row.medicineId).filter(Boolean))];
    const candidateProjection = Object.fromEntries([...MAPPED_MEDICINE_FIELDS].map(field => [field, 1]));
    candidateProjection._id = 0; candidateProjection.medicineId = 1;
    const candidates = ids.length ? await MedicineMaster.find({ medicineId: { $in: ids }, isArchived: { $ne: true } }, candidateProjection).lean() : [];
    const byId = new Map(candidates.map(item => [item.medicineId, item]));
    return res.json({ items: rows.map(row => ({ ...row, candidates: (row.candidates || []).filter(candidate => Number(candidate.score ?? row.confidence ?? 0) >= minConfidence), candidate: byId.get(row.mappedMedicineId || row.medicineId) || null })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { return next(error); }
});
router.post('/matches/discover', async (req, res, next) => {
  try {
    if (req.service?.isPlatformUser !== true) return res.status(403).json({ message: 'Only a platform super administrator can discover existing Store products for shared catalogue mapping.' });
    const limit = Math.max(1, Math.min(500, Number.parseInt(req.body?.limit || '500', 10) || 500));
    const afterId = String(req.body?.afterId || '').trim();
    if (afterId && !mongoose.isValidObjectId(afterId)) return res.status(400).json({ message: 'The discovery cursor is invalid. Restart discovery without a cursor.' });
    const filter = { active: { $ne: false }, ...(afterId ? { _id: { $gt: new mongoose.Types.ObjectId(afterId) } } : {}) };
    // InventoryProduct is owned by Inventory Service. Read its existing shared
    // Mongo collection without coupling this service to the inventory model.
    const products = await mongoose.connection.collection('inventoryproducts')
      .find(filter, { projection: { _id: 1, name: 1, genericName: 1, strength: 1, form: 1 } })
      .sort({ _id: 1 }).limit(limit).toArray();
    const queued = await mapMedicineMatchBatch(products, 8, product => queueMedicineMatch({
      name: product.name,
      brand: product.name,
      genericName: product.genericName,
      strength: product.strength,
      form: product.form
    }));
    const lastId = products.length ? String(products[products.length - 1]._id) : afterId;
    return res.json({
      scanned: products.length,
      queued: queued.filter(Boolean).length,
      skipped: queued.filter(item => !item).length,
      nextCursor: lastId,
      hasMore: products.length === limit,
      message: products.length ? 'Existing Store products were added to the idempotent mapping review queue.' : 'No more existing Store products were found.'
    });
  } catch (error) { return next(error); }
});
router.post('/matches/:identityHash/map', async (req, res, next) => {
  try {
    if (req.service?.isPlatformUser !== true) return res.status(403).json({ message: 'Only a platform super administrator can approve medicine mappings.' });
    const medicineId = String(req.body?.medicineId || '').trim();
    const fields = [...new Set((Array.isArray(req.body?.fields) ? req.body.fields : []).map(String))];
    if (!medicineId) return res.status(400).json({ message: 'Select a Medicine Master record before approving this mapping.' });
    if (!fields.length || fields.length > MAPPED_MEDICINE_FIELDS.size || fields.some(field => !MAPPED_MEDICINE_FIELDS.has(field))) return res.status(400).json({ message: 'Select at least one supported catalogue field to map.' });
    const target = await MedicineMaster.findOne({ medicineId, isArchived: { $ne: true } }, { _id: 0, medicineId: 1 }).lean();
    if (!target) return res.status(404).json({ message: 'The selected active Medicine Master record was not found.' });
    const row = await MedicineMatchReference.findOneAndUpdate({ identityHash: req.params.identityHash }, {
      $set: { mappingStatus: 'APPROVED', mappedMedicineId: medicineId, mappedFields: fields, mappedBy: String(req.service?.userId || req.service?.name || ''), mappedAt: new Date() },
      $push: { mappingHistory: { $each: [{ medicineId, fields, actorId: String(req.service?.userId || req.service?.name || ''), approvedAt: new Date() }], $slice: -50 } }
    }, { new: true, runValidators: true }).lean();
    if (!row) return res.status(404).json({ message: 'Medicine match review item was not found.' });
    return res.json({ success: true, identityHash: row.identityHash, mappingStatus: row.mappingStatus, mappedMedicineId: row.mappedMedicineId, mappedFields: row.mappedFields, mappedAt: row.mappedAt });
  } catch (error) { return next(error); }
});
router.get('/imports', asyncHandler(async (req, res) => {
  const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page || '1', 10) || 1));
  const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit || '10', 10) || 10));
  const [items, total, jobs] = await Promise.all([
    CatalogueImport.find({ isHidden: { $ne: true } }, { batchId: 1, dataset: 1, fileName: 1, status: 1, recordCount: 1, report: 1, publishedCount: 1, approvedAt: 1, approvedBy: 1, errorMessage: 1, sourceBatchIds: 1, supersededByBatchId: 1, createdAt: 1 }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    CatalogueImport.countDocuments({ isHidden: { $ne: true } }),
    CatalogueImportJob.find({ status: { $in: ['QUEUED', 'PROCESSING', 'FAILED'] } }, { jobId: 1, batchId: 1, dataset: 1, fileName: 1, status: 1, stage: 1, progressPercent: 1, processedRecords: 1, totalRecords: 1, attempts: 1, errorMessage: 1, leaseExpiresAt: 1, createdAt: 1, updatedAt: 1 }).sort({ createdAt: -1 }).limit(8).lean()
  ]);
  return res.json({ items, jobs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.get('/imports/:batchId/records', asyncHandler(async (req, res) => {
  const batchId = String(req.params.batchId || '').trim();
  const batch = await CatalogueImport.findOne({ batchId, isHidden: { $ne: true } }, { batchId: 1, status: 1, recordCount: 1 }).lean();
  if (!batch) return res.status(404).json({ message: 'Catalogue import batch was not found.' });
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page || '1', 10) || 1));
  const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit || '20', 10) || 20));
  const search = text(req.query.search).slice(0, 100);
  const escapedSearch = search.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
  const skip = (page - 1) * limit;
  const searchMatch = search ? {
    $or: ['brandName', 'genericName', 'composition', 'manufacturer', 'medicineId', 'strength', 'dosageForm']
      .map(field => ({ ['record.' + field]: { $regex: escapedSearch, $options: 'i' } }))
  } : null;
  const recordProjection = {
    _id: 0,
    medicineId: '$record.medicineId',
    brandName: '$record.brandName',
    genericName: '$record.genericName',
    composition: '$record.composition',
    strength: '$record.strength',
    dosageForm: '$record.dosageForm',
    manufacturer: '$record.manufacturer',
    qualityScore: '$record.qualityScore',
    qualityGrade: '$record.qualityGrade',
    sourceDataset: '$record.sourceDataset',
    sourceRecordId: '$record.sourceRecordId',
    sourceDatasets: '$record.sourceDatasets',
    sourceRecordIds: '$record.sourceRecordIds',
    reconciliationMatch: '$record.reconciliationMatch',
    qualityIssues: '$record.qualityIssues'
  };
  const paginateRecords = async (Model, match, legacy = false) => {
    const pipeline = [
      { $match: match },
      { $unwind: { path: '$records', includeArrayIndex: 'recordIndex' } },
      { $set: { record: '$records', chunkIndex: legacy ? 0 : '$chunkIndex' } },
      ...(searchMatch ? [{ $match: searchMatch }] : []),
      { $sort: { chunkIndex: 1, recordIndex: 1 } },
      { $facet: {
        items: [{ $skip: skip }, { $limit: limit }, { $project: recordProjection }],
        count: [{ $count: 'total' }]
      } },
      { $project: { items: 1, total: { $ifNull: [{ $arrayElemAt: ['$count.total', 0] }, 0] } } }
    ];
    const [result] = await Model.aggregate(pipeline).allowDiskUse(true);
    const total = result?.total || 0;
    return { items: result?.items || [], pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  };
  const chunkCount = await CatalogueImportChunk.countDocuments({ batchId });
  const result = chunkCount
    ? await paginateRecords(CatalogueImportChunk, { batchId })
    : await paginateRecords(CatalogueImport, { batchId, isHidden: { $ne: true }, records: { $exists: true, $ne: [] } }, true);
  return res.json(result);
}));

router.get('/imports/:batchId', asyncHandler(async (req, res) => {
  const batch = await CatalogueImport.findOne({ batchId: req.params.batchId, isHidden: { $ne: true } }).lean();
  if (!batch) return res.status(404).json({ message: 'Catalogue import batch was not found.' });
  return res.json({ batchId: batch.batchId, dataset: batch.dataset, fileName: batch.fileName, status: batch.status, report: batch.report, reportFingerprint: batch.reportFingerprint, approvedBy: batch.approvedBy, approvedAt: batch.approvedAt, publishedCount: batch.publishedCount, errorMessage: batch.errorMessage });
}));

router.post('/imports/:batchId/approve', asyncHandler(async (req, res) => {
  const batch = await CatalogueImport.findOne({ batchId: req.params.batchId, isHidden: { $ne: true } });
  if (!batch) return res.status(404).json({ message: 'Catalogue import batch was not found.' });
  if (!['READY', 'PARTIALLY_PUBLISHED'].includes(batch.status)) return res.status(409).json({ message: 'Only a ready or partially published batch can be approved.' });
  if (Number(batch.report?.blockingConflicts || 0) > 0) return res.status(409).json({ message: 'This combined batch contains conflicting source identifiers with different strength, form or composition. Separate the conflicting source batches before approval.' });
  if (req.body?.confirmReconciliation !== true || req.body?.reportFingerprint !== batch.reportFingerprint) return res.status(400).json({ message: 'Review confirmation does not match this reconciliation report. Refresh the batch and confirm the current report.' });
  batch.approvedBy = req.service.userId || req.service.name;
  batch.approvedAt = new Date();
  await batch.save();
  return res.json({ batchId: batch.batchId, status: batch.status, approvedBy: batch.approvedBy, approvedAt: batch.approvedAt, reportFingerprint: batch.reportFingerprint });
}));

router.post('/imports/:batchId/publish', asyncHandler(async (req, res) => {
  const batch = await CatalogueImport.findOne({ batchId: req.params.batchId, isHidden: { $ne: true } });
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
    const freshReconciliation = await reconcileCatalogueRecordsAgainstMaster(records);
    const blockedMedicineIds = new Set(freshReconciliation.blockers.map(item => item.medicineId).filter(Boolean));
    const blockedTargets = new Set(freshReconciliation.blockers
      .filter(item => item.reason === 'MULTIPLE_INCOMING_RECORDS_TARGET_SAME_MEDICINE')
      .map(item => item.targetMedicineId).filter(Boolean));
    const hasUnscopedBlocker = freshReconciliation.blockers.some(item =>
      !item.medicineId && item.reason !== 'MULTIPLE_INCOMING_RECORDS_TARGET_SAME_MEDICINE'
    );
    const publishEntries = records.map((record, index) => ({ record, plan: freshReconciliation.plans[index] }))
      .filter(({ record, plan }) => {
        if (!['AUTO_MERGE', 'NO_MATCH'].includes(plan.decision)) return false;
        if (blockedMedicineIds.has(record.medicineId)) return false;
        if (plan.decision === 'AUTO_MERGE' && blockedTargets.has(plan.targetMedicineId)) return false;
        if (plan.decision === 'NO_MATCH' && (freshReconciliation.scanTruncated || hasUnscopedBlocker)) return false;
        return true;
      });
    const skippedCount = records.length - publishEntries.length;
    const publishSummary = {
      ...freshReconciliation.summary,
      publishableRecords: publishEntries.length,
      skippedRecords: skippedCount,
      publishedRecords: 0
    };
    if (!publishEntries.length) {
      const refreshedReport = {
        ...(batch.report || {}),
        publishReconciliation: publishSummary,
        publishBlockedAt: new Date().toISOString()
      };
      batch.report = refreshedReport;
      batch.reportFingerprint = hash(JSON.stringify(refreshedReport));
      batch.approvedAt = null;
      batch.approvedBy = '';
      batch.status = 'READY';
      batch.errorMessage = 'Publishing blocked: no records passed live reconciliation. Resolve the conflicts and approve the updated report.';
      await batch.save();
      return res.status(409).json({
        message: batch.errorMessage,
        batchId: batch.batchId,
        status: batch.status,
        report: refreshedReport,
        reportFingerprint: batch.reportFingerprint,
        reconciliation: publishSummary
      });
    }
    const planByIndex = publishEntries;
    for (let offset = 0; offset < planByIndex.length; offset += 250) {
      const entries = planByIndex.slice(offset, offset + 250);
      const chunk = entries.map(entry => entry.record);
      const chunkPlans = entries.map(entry => entry.plan);
      const ids = [...new Set(chunkPlans.map(plan => plan.targetMedicineId).filter(Boolean))];
      const existing = ids.length ? await MedicineMaster.find({ medicineId: { $in: ids }, isArchived: { $ne: true } }).lean() : [];
      const byId = new Map(existing.map(item => [item.medicineId, item]));
      const operations = chunk.map((item, itemIndex) => {
        const plan = chunkPlans[itemIndex];
        const current = plan.decision === 'AUTO_MERGE' ? byId.get(plan.targetMedicineId) : null;
        if (plan.decision === 'AUTO_MERGE' && !current) throw Object.assign(new Error('A reconciled target disappeared before its write. Re-run review and approval.'), { statusCode: 409 });
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
              $addToSet: { sourceDatasets: { $each: item.sourceDatasets?.length ? item.sourceDatasets : [item.sourceDataset].filter(Boolean) }, sourceRecordIds: { $each: item.sourceRecordIds?.length ? item.sourceRecordIds : [item.sourceRecordId].filter(Boolean) }, legacyMedicineIds: { $each: [...(item.legacyMedicineIds || []), ...(current && current.medicineId !== item.medicineId ? [item.medicineId] : [])] } }
            },
            upsert: true
          }
        };
      });
      await MedicineMaster.bulkWrite(operations, { ordered: false });
      // A master write invalidates every cached link immediately, including partial publishes.
      invalidateMedicineMasterVersionCache();
      publishedCount += chunk.length;
      await CatalogueImport.updateOne({ _id: batch._id }, { $set: { publishedCount } });
    }
    const totalPublishedForBatch = await MedicineMaster.countDocuments({ lastImportBatchId: batch.batchId });
    batch.publishedCount = Math.max(publishedCount, totalPublishedForBatch);
    if (skippedCount > 0) {
      const refreshedReport = {
        ...(batch.report || {}),
        publishReconciliation: { ...publishSummary, publishedRecords: batch.publishedCount },
        publishBlockedAt: new Date().toISOString()
      };
      batch.report = refreshedReport;
      batch.reportFingerprint = hash(JSON.stringify(refreshedReport));
      batch.approvedAt = null;
      batch.approvedBy = '';
      batch.status = 'PARTIALLY_PUBLISHED';
      batch.errorMessage = `Published ${batch.publishedCount} conflict-free records; ${skippedCount} records remain blocked for manual review or reconciliation.`;
      await batch.save();
      return res.json({
        batchId: batch.batchId,
        status: batch.status,
        publishedCount: batch.publishedCount,
        skippedCount,
        message: batch.errorMessage,
        report: batch.report,
        reportFingerprint: batch.reportFingerprint
      });
    }
    batch.status = 'PUBLISHED';
    batch.errorMessage = '';
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
  await Promise.all([MedicineMaster.init(), CatalogueImport.init(), CatalogueImportChunk.init(), CatalogueImportJob.init()]);
  startMedicineCatalogueImportWorker();
}
export default router;
