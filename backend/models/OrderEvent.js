import mongoose from 'mongoose';

const orderEventSchema = new mongoose.Schema({
    eventId: { type: String, required: true, unique: true, index: true },
    eventKey: { type: String, required: true, unique: true },
    event: {
        type: String,
        required: true,
        enum: [
            'OrderCreated',
            'OrderUpdated',
            'OrderCancelled',
            'OrderRejected',
            'OrderApproved',
            'OrderProcessing',
            'OrderReadyForDispatch',
            'OrderAssigned',
            'OrderReassigned',
            'OrderDispatched',
            'OrderDelivered',
            'OrderDeliveryFailed',
            'OrderInventoryReserved',
            'OrderInventoryReleased',
            'OrderInventoryDeducted',
            'InventoryReservationFailed',
            'InventoryServiceUnavailable',
            'RiderAssignmentFailed',
            'NotificationFailed',
            'ExternalIntegrationFailed',
            'OrderProcessingFailed'
        ],
        index: true
    },
    orderId: { type: String, required: true, index: true },
    source: { type: String, default: 'DIRECT', index: true },
    externalReference: { type: String, default: null, index: true },
    occurredAt: { type: Date, required: true, default: Date.now },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['QUEUED', 'PROCESSING', 'PROCESSED', 'FAILED'], default: 'QUEUED', index: true },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lastError: { type: String, default: null },
    processedAt: { type: Date, default: null }
}, { timestamps: true });

orderEventSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

const OrderEvent = mongoose.models.OrderEvent || mongoose.model('OrderEvent', orderEventSchema);
export default OrderEvent;
