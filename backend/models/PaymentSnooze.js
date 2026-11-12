import mongoose from 'mongoose';

const paymentSnoozeSchema = new mongoose.Schema({
    customerId: { type: String, required: true, unique: true, index: true },
    snoozedUntil: { type: Date, required: true },
    lastActionNonce: { type: String, default: null, select: false },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const PaymentSnooze = mongoose.models.PaymentSnooze
    || mongoose.model('PaymentSnooze', paymentSnoozeSchema);

export default PaymentSnooze;
