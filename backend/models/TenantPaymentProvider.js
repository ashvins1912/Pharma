import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  provider: { type: String, required: true, lowercase: true, trim: true },
  enabled: { type: Boolean, default: false },
  isDefault: { type: Boolean, default: false },
  environment: { type: String, enum: ['sandbox', 'production'], default: 'sandbox' },
  credentialCiphertext: { type: String, required: true, select: false },
  credentialIv: { type: String, required: true, select: false },
  credentialTag: { type: String, required: true, select: false },
  credentialKeyVersion: { type: String, required: true, select: false },
  credentialUpdatedAt: { type: Date, required: true, default: Date.now },
  createdBy: { type: String, default: null },
  updatedBy: { type: String, default: null }
}, { timestamps: true, strict: true });
schema.index({ tenantId: 1, provider: 1, environment: 1 }, { unique: true });
schema.index({ tenantId: 1, environment: 1, isDefault: 1 }, {
  unique: true, partialFilterExpression: { isDefault: true }
});
export default mongoose.models.TenantPaymentProvider || mongoose.model('TenantPaymentProvider', schema);
