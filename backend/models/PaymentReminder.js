import mongoose from 'mongoose';

const paymentReminderSchema = new mongoose.Schema({
    idempotencyKey: { type: String, required: true, unique: true },
    customerId: { type: String, required: true, index: true },
    orderIds: { type: [String], required: true },
    channel: { type: String, enum: ['WHATSAPP'], required: true },
    reminderType: { type: String, default: 'PAYMENT_OUTSTANDING' },
    amount: { type: Number, required: true, min: 0 },
    providerMessageId: { type: String, default: null },
    status: { type: String, enum: ['SENDING', 'SENT', 'QUEUED_OFFLINE', 'FAILED'], default: 'SENDING', index: true },
    failureReason: { type: String, default: null },
    sentAt: { type: Date, default: null },
    requestedBy: { type: String, required: true }
}, { timestamps: true });

paymentReminderSchema.index({ customerId: 1, reminderType: 1, createdAt: -1 });

const PaymentReminder = mongoose.models.PaymentReminder
    || mongoose.model('PaymentReminder', paymentReminderSchema);

export default PaymentReminder;
