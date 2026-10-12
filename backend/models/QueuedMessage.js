import mongoose from 'mongoose';

const queuedMessageSchema = new mongoose.Schema({
    userId: { type: String, index: true, default: null },
    tenantId: { type: String, index: true, default: null },
    channel: { type: String, required: true, index: true },
    payload: { type: Object, required: true },
    status: { type: String, enum: ['PENDING', 'CONSUMED'], default: 'PENDING', index: true },
    publishedAt: { type: Date, default: Date.now }
}, { timestamps: true, collection: 'queued_messages' });

queuedMessageSchema.index({ userId: 1, status: 1 });
queuedMessageSchema.index({ tenantId: 1, status: 1 });

const QueuedMessage = mongoose.models.QueuedMessage || mongoose.model('QueuedMessage', queuedMessageSchema);
export default QueuedMessage;
