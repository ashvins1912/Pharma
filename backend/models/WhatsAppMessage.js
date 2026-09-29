import mongoose from 'mongoose';

const whatsappMessageSchema = new mongoose.Schema({
    orderId: { type: String, required: true, index: true },
    eventType: { type: String, required: true },
    recipient: { type: String, required: true },
    dedupeKey: { type: String, required: true, unique: true },
    messageBody: { type: String, required: true },
    status: { type: String, required: true },
    error: { type: String, default: null },
    channel: { type: String, default: 'WHATSAPP' },
    sentAt: { type: Date, default: null },
    attempts: { type: Number, default: 1 },
    messageId: { type: String, required: true },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });

whatsappMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const WhatsAppMessage = mongoose.models.WhatsAppMessage
    || mongoose.model('WhatsAppMessage', whatsappMessageSchema);

export default WhatsAppMessage;
