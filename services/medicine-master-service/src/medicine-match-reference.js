import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { rankMedicineMasterMatches } from './medicine-master-matcher.js';

const referenceSchema = new mongoose.Schema({
  identityHash: { type: String, required: true, unique: true },
  normalizedIdentity: { type: String, required: true },
  input: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['PENDING', 'PROCESSING', 'EXACT', 'STRONG', 'AMBIGUOUS', 'NO_CONFIDENT_MATCH', 'NO_MATCH', 'STALE'], default: 'PENDING', index: true },
  medicineId: { type: String, default: '' },
  confidence: { type: Number, default: 0 },
  medicineMasterUpdatedAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  leaseExpiresAt: { type: Date, default: null, index: true },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: '' }
}, { timestamps: true });
referenceSchema.index({ status: 1, updatedAt: 1 });
const MedicineMatchReference = mongoose.models.MedicineMatchReference
  || mongoose.model('MedicineMatchReference', referenceSchema);

const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const normalizeStrength = value => normalize(value).replace(/(\d)\s+(mg|mcg|g|kg|ml|l|iu|units?)\b/g, '$1$2');
export function medicineMatchIdentity(product = {}) {
  const input = {
    name: String(product.name || '').trim().slice(0, 120),
    brand: String(product.brand || product.name || '').trim().slice(0, 120),
    genericName: String(product.genericName || '').trim().slice(0, 120),
    composition: String(product.composition || '').trim().slice(0, 240),
    strength: String(product.strength || '').trim().slice(0, 80),
    dosageForm: String(product.dosageForm || product.form || '').trim().slice(0, 80),
    packSize: String(product.packSize || '').trim().slice(0, 80)
  };
  const normalizedIdentity = [normalize(input.name), normalize(input.brand), normalize(input.genericName), normalize(input.composition), normalizeStrength(input.strength), normalize(input.dosageForm), normalize(input.packSize)].join('|');
  return { input, normalizedIdentity, identityHash: crypto.createHash('sha256').update(normalizedIdentity).digest('hex') };
}

function medicineModel() { return mongoose.models.MedicineMaster; }

// Bound concurrent candidate scans so one large queue does not flood MongoDB.
export async function mapMedicineMatchBatch(items, concurrency, mapper) {
  const values = Array.isArray(items) ? items : [];
  const workerCount = Math.max(1, Math.min(values.length || 1, Number(concurrency) || 1));
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  }));
  return results;
}

let masterVersionCache = { checkedAt: 0, updatedAt: null };
export function invalidateMedicineMasterVersionCache() {
  masterVersionCache = { checkedAt: 0, updatedAt: null };
}

async function getMedicineMasterVersion() {
  if (Date.now() - masterVersionCache.checkedAt < 30_000) return masterVersionCache.updatedAt;
  const latest = await medicineModel().findOne({ isArchived: { $ne: true }, storeApproved: true }, { updatedAt: 1 }).sort({ updatedAt: -1 }).lean();
  masterVersionCache = { checkedAt: Date.now(), updatedAt: latest?.updatedAt || null };
  return masterVersionCache.updatedAt;
}

export async function initializeMedicineMatchReferenceModel() {
  await MedicineMatchReference.init();
}
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function resolveReference(reference) {
  const { input } = reference;
  const terms = [...new Set([input.name, input.brand, input.genericName, input.composition].filter(Boolean))];
  if (!terms.length) return { status: 'NO_MATCH', confidence: 0, medicine: null };
  const clauses = terms.flatMap(term => {
    const firstToken = term.split(/\s+/).filter(Boolean)[0] || term;
    const prefix = '^' + escapeRegex(firstToken);
    return ['brandName', 'productName', 'genericName', 'composition'].map(field => ({ [field]: { $regex: prefix, $options: 'i' } }));
  });
  const candidates = await medicineModel().find({ isArchived: { $ne: true }, storeApproved: true, $or: clauses }, {
    _id: 0, medicineId: 1, brandName: 1, productName: 1, genericName: 1, composition: 1,
    strength: 1, packSize: 1, dosageForm: 1, medicineType: 1, manufacturer: 1,
    therapeuticClass: 1, chemicalClass: 1, actionClass: 1, routes: 1, indications: 1,
    uses: 1, contraindications: 1, sideEffects: 1, drugInteractions: 1, habitForming: 1,
    requiresPrescription: 1, prescriptionVerification: 1, clinicalDataVerification: 1, dataQualityStatus: 1
  }).limit(101).lean();
  if (candidates.length > 100) return { status: 'AMBIGUOUS', confidence: 0, medicine: null };
  return rankMedicineMasterMatches(input, candidates);
}

export async function queueMedicineMatch(product) {
  const identity = medicineMatchIdentity(product);
  if (!identity.input.name && !identity.input.genericName && !identity.input.composition) return null;
  return MedicineMatchReference.findOneAndUpdate(
    { identityHash: identity.identityHash },
    { $setOnInsert: { normalizedIdentity: identity.normalizedIdentity, input: identity.input, status: 'PENDING', medicineId: '', confidence: 0, attempts: 0, lastError: '' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

export async function getOrResolveMedicineMatch(product) {
  const identity = medicineMatchIdentity(product);
  if (!identity.input.name && !identity.input.genericName && !identity.input.composition) return { status: 'NO_MATCH', confidence: 0, medicine: null };
  const masterVersion = await getMedicineMasterVersion();
  let reference = await MedicineMatchReference.findOne({ identityHash: identity.identityHash }).lean();
  if (reference && reference.status !== 'PENDING' && reference.medicineMasterUpdatedAt
    && (!masterVersion || reference.medicineMasterUpdatedAt >= masterVersion)) {
    if (reference.medicineId) {
      const medicine = await medicineModel().findOne({ medicineId: reference.medicineId, isArchived: { $ne: true }, storeApproved: true }, {
        _id: 0, medicineId: 1, brandName: 1, productName: 1, genericName: 1, composition: 1,
        strength: 1, packSize: 1, dosageForm: 1, medicineType: 1, manufacturer: 1,
        therapeuticClass: 1, chemicalClass: 1, actionClass: 1, routes: 1, indications: 1,
        uses: 1, contraindications: 1, sideEffects: 1, drugInteractions: 1, habitForming: 1,
        requiresPrescription: 1, prescriptionVerification: 1, clinicalDataVerification: 1, dataQualityStatus: 1
      }).lean();
      if (medicine) return { status: reference.status, confidence: reference.confidence, medicine, cached: true };
    } else return { status: reference.status, confidence: reference.confidence, medicine: null, cached: true };
  }
  if (!reference) reference = await queueMedicineMatch(product);
  const result = await resolveReference(reference);
  const latestMaster = await getMedicineMasterVersion();
  await MedicineMatchReference.updateOne({ identityHash: identity.identityHash }, { $set: {
    status: result.status,
    medicineId: result.medicine?.medicineId || '',
    confidence: result.confidence || 0,
    medicineMasterUpdatedAt: latestMaster || new Date(0),
    resolvedAt: new Date(),
    lastError: ''
  }, $inc: { attempts: 1 } });
  return { ...result, cached: false };
}

export async function processMedicineMatchBatch({ limit = 50 } = {}) {
  const batchSize = Math.max(1, Math.min(100, Number(limit) || 50));
  const claimed = [];
  const now = new Date();
  for (let index = 0; index < batchSize; index += 1) {
    const row = await MedicineMatchReference.findOneAndUpdate(
      { $or: [{ status: 'PENDING' }, { status: 'PROCESSING', leaseExpiresAt: { $lte: now } }] },
      { $set: { status: 'PROCESSING', leaseExpiresAt: new Date(now.getTime() + 2 * 60 * 1000) } },
      { sort: { updatedAt: 1 }, new: true }
    ).lean();
    if (!row) break;
    claimed.push(row);
  }
  if (!claimed.length) return { processed: 0, remaining: await MedicineMatchReference.countDocuments({ status: 'PENDING' }) };
  const latestMaster = await medicineModel().findOne({ isArchived: { $ne: true }, storeApproved: true }, { updatedAt: 1 }).sort({ updatedAt: -1 }).lean();
  const operations = await mapMedicineMatchBatch(claimed, 8, async row => {
    try {
      const result = await resolveReference(row);
      return { updateOne: { filter: { _id: row._id, status: 'PROCESSING' }, update: { $set: {
        status: result.status, medicineId: result.medicine?.medicineId || '', confidence: result.confidence || 0,
        medicineMasterUpdatedAt: latestMaster?.updatedAt || new Date(0), resolvedAt: new Date(),
        leaseExpiresAt: null, lastError: ''
      }, $inc: { attempts: 1 } } } };
    } catch (error) {
      return { updateOne: { filter: { _id: row._id, status: 'PROCESSING' }, update: { $set: {
        status: 'PENDING', leaseExpiresAt: null, lastError: String(error.message || 'Match failed').slice(0, 300)
      }, $inc: { attempts: 1 } } } };
    }
  });
  if (operations.length) await MedicineMatchReference.bulkWrite(operations, { ordered: false });
  return { processed: operations.length, remaining: await MedicineMatchReference.countDocuments({ status: 'PENDING' }) };
}

let matchWorkerTimer = null;
let matchWorkerBusy = false;
export function startMedicineMatchWorker() {
  if (matchWorkerTimer) return;
  matchWorkerTimer = setInterval(async () => {
    if (matchWorkerBusy || mongoose.connection.readyState !== 1) return;
    matchWorkerBusy = true;
    try { await processMedicineMatchBatch({ limit: 50 }); }
    catch (error) { console.error('Medicine match batch worker failed:', error.message); }
    finally { matchWorkerBusy = false; }
  }, 2000);
  matchWorkerTimer.unref?.();
}
export function stopMedicineMatchWorker() {
  if (matchWorkerTimer) clearInterval(matchWorkerTimer);
  matchWorkerTimer = null;
}
