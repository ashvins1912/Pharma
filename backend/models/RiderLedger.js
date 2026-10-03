import mongoose from 'mongoose';

const riderLedgerSchema = new mongoose.Schema({
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    riderId: { type: String, required: true, index: true },
    eventId: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    type: { type: String, enum: ['CASH_COLLECTED'], required: true },
    occurredAt: { type: Date, required: true }
}, { timestamps: true });

riderLedgerSchema.index({ orderId: 1, type: 1 }, { unique: true });
riderLedgerSchema.index({ riderId: 1, occurredAt: -1 });

const RiderLedger = mongoose.models.RiderLedger
    || mongoose.model('RiderLedger', riderLedgerSchema);

export default RiderLedger;
