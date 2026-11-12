import mongoose from 'mongoose';

const deliveryActionSchema = new mongoose.Schema({
    eventId: { type: String, required: true },
    action: { type: String, enum: ['cash_received', 'payment_pending', 'not_reachable'], required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    riderId: { type: String, required: true },
    requestId: { type: String, default: null },
    status: { type: String, enum: ['COMPLETED'], required: true },
    result: { type: mongoose.Schema.Types.Mixed, default: {} },
    processedAt: { type: Date, required: true }
}, { timestamps: true });

deliveryActionSchema.index({ eventId: 1, action: 1 }, { unique: true });

const DeliveryAction = mongoose.models.DeliveryAction
    || mongoose.model('DeliveryAction', deliveryActionSchema);

export default DeliveryAction;
