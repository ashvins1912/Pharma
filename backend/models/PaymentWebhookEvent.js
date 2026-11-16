import mongoose from 'mongoose';

const paymentWebhookEventSchema = new mongoose.Schema({
  provider: { type: String, required: true, trim: true, lowercase: true },
  eventId: { type: String, required: true, trim: true },
  eventType: { type: String, required: true },
  payloadHash: { type: String, required: true },
  orderNumber: { type: String, required: true, index: true },
  tenantId: { type: String, required: true, index: true },
  amountMinor: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true },
  status: { type: String, enum: ['PROCESSED', 'IGNORED_DUPLICATE_CAPTURE'], required: true },
  result: { type: mongoose.Schema.Types.Mixed, default: {} },
  processedAt: { type: Date, required: true }
}, { timestamps: true });

paymentWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true, name: 'provider_event_unique' });
paymentWebhookEventSchema.index({ tenantId: 1, orderNumber: 1, createdAt: -1 });

export default mongoose.models.PaymentWebhookEvent
  || mongoose.model('PaymentWebhookEvent', paymentWebhookEventSchema);
