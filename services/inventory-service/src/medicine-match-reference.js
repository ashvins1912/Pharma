import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { rankMedicineMasterMatches } from './medicine-master-matcher.js';

const referenceSchema = new mongoose.Schema({
  identityHash: { type: String, required: true, unique: true },
  normalizedIdentity: { type: String, required: true },
  input: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['PENDING', 'EXACT', 'STRONG', 'AMBIGUOUS', 'NO_CONFIDENT_MATCH', 'NO_MATCH', 'STALE'], default: 'PENDING', index: true },
  medicineId: { type: String, default: '' },
  confidence: { type: Number, default: 0 },
  medicineMasterUpdatedAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
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
    manufacturer: String(product.manufacturer || '').trim().slice(0, 120),
    packSize: String(product.packSize || '').trim().slice(0, 80)
  };
  const normalizedIdentity = [normalize(input.brand), normalize(input.genericName), normalize(input.composition), normalizeStrength(input.strength), normalize(input.dosageForm), normalize(input.manufacturer), normalize(input.packSize)].join('|');
  return { input, normalizedIdentity, identityHash: crypto.createHash('sha256').update(normalizedIdentity).digest('hex') };
}

function medicineModel() { return mongoose.models.MedicineMaster; }
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
  const candidates = await medicineModel().find({ isArchived: { $ne: true }, $or: clauses }, {
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
  const masterVersion = await medicineModel().findOne({ isArchived: { $ne: true } }, { updatedAt: 1 }).sort({ updatedAt: -1 }).lean();
  let reference = await MedicineMatchReference.findOne({ identityHash: identity.identityHash }).lean();
  if (reference && reference.status !== 'PENDING' && reference.medicineMasterUpdatedAt
    && masterVersion && reference.medicineMasterUpdatedAt >= masterVersion.updatedAt) {
    if (reference.medicineId) {
      const medicine = await medicineModel().findOne({ medicineId: reference.medicineId, isArchived: { $ne: true } }, {
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
  const latestMaster = await medicineModel().findOne({ isArchived: { $ne: true } }, { updatedAt: 1 }).sort({ updatedAt: -1 }).lean();
  await MedicineMatchReference.updateOne({ identityHash: identity.identityHash }, { $set: {
    status: result.status,
    medicineId: result.medicine?.medicineId || '',
    confidence: result.confidence || 0,
    medicineMasterUpdatedAt: latestMaster?.updatedAt || new Date(0),
    resolvedAt: new Date(),
    lastError: ''
  }, $inc: { attempts: 1 } });
  return { ...result, cached: false };
}

export async function processMedicineMatchBatch({ limit = 50 } = {}) {
  const batchSize = Math.max(1, Math.min(100, Number(limit) || 50));
  const rows = await MedicineMatchReference.find({ status: 'PENDING' }).sort({ updatedAt: 1 }).limit(batchSize).lean();
  if (!rows.length) return { processed: 0, remaining: await MedicineMatchReference.countDocuments({ status: 'PENDING' }) };
  const latestMaster = await medicineModel().findOne({ isArchived: { $ne: true } }, { updatedAt: 1 }).sort({ updatedAt: -1 }).lean();
  const operations = [];
  for (const row of rows) {
    try {
      const result = await resolveReference(row);
      operations.push({ updateOne: { filter: { _id: row._id, status: 'PENDING' }, update: { $set: {
        status: result.status, medicineId: result.medicine?.medicineId || '', confidence: result.confidence || 0,
        medicineMasterUpdatedAt: latestMaster?.updatedAt || new Date(0), resolvedAt: new Date(), lastError: ''
      }, $inc: { attempts: 1 } } } });
    } catch (error) {
      operations.push({ updateOne: { filter: { _id: row._id }, update: { $set: { lastError: String(error.message || 'Match failed').slice(0, 300) }, $inc: { attempts: 1 } } } });
    }
  }
  if (operations.length) await MedicineMatchReference.bulkWrite(operations, { ordered: false });
  return { processed: operations.length, remaining: await MedicineMatchReference.countDocuments({ status: 'PENDING' }) };
}
