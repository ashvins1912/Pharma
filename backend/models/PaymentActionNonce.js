import mongoose from 'mongoose';

const paymentActionNonceSchema = new mongoose.Schema({
    nonce: { type: String, required: true, unique: true },
    customerId: { type: String, required: true, index: true },
    action: { type: String, enum: ['PAYMENT_SNOOZE'], required: true },
    status: { type: String, enum: ['PROCESSING', 'COMPLETED', 'FAILED_RETRYABLE'], required: true },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });

paymentActionNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const PaymentActionNonce = mongoose.models.PaymentActionNonce
    || mongoose.model('PaymentActionNonce', paymentActionNonceSchema);

export default PaymentActionNonce;
