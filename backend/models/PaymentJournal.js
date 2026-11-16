import mongoose from 'mongoose';

const journalEntrySchema = new mongoose.Schema({
  accountCode: { type: String, required: true },
  side: { type: String, enum: ['DEBIT', 'CREDIT'], required: true },
  amountMinor: { type: Number, required: true, min: 1 },
  partyId: { type: String, default: null }
}, { _id: false });

const paymentJournalSchema = new mongoose.Schema({
  journalId: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },
  provider: { type: String, required: true },
  providerEventId: { type: String, required: true },
  orderNumber: { type: String, required: true, index: true },
  tenantId: { type: String, required: true, index: true },
  currency: { type: String, required: true, uppercase: true },
  totalMinor: { type: Number, required: true, min: 1 },
  entries: { type: [journalEntrySchema], required: true },
  postedAt: { type: Date, required: true }
}, { timestamps: true });

paymentJournalSchema.index({ tenantId: 1, postedAt: -1 });
paymentJournalSchema.index({ provider: 1, providerEventId: 1 }, { unique: true });

export default mongoose.models.PaymentJournal
  || mongoose.model('PaymentJournal', paymentJournalSchema);
