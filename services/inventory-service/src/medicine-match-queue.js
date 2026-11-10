import crypto from 'node:crypto';
import mongoose from 'mongoose';

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

export async function initializeMedicineMatchReferenceModel() {
  await MedicineMatchReference.init();
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
