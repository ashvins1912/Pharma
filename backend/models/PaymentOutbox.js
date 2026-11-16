import mongoose from 'mongoose';

const paymentOutboxSchema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true },
  eventType: { type: String, required: true },
  aggregateId: { type: String, required: true, index: true },
  tenantId: { type: String, required: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED'], default: 'PENDING', index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lastError: { type: String, default: null },
  publishedAt: { type: Date, default: null }
}, { timestamps: true });

paymentOutboxSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

export default mongoose.models.PaymentOutbox
  || mongoose.model('PaymentOutbox', paymentOutboxSchema);
