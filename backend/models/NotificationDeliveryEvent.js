import mongoose from 'mongoose';

const notificationDeliveryEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, index: true },
  tenantId: { type: String, default: null, index: true },
  branchId: { type: String, default: null, index: true },
  orderId: { type: String, default: null, index: true },
  riderId: { type: String, default: null, index: true },
  jobId: { type: String, default: null },
  eventType: { type: String, default: 'DELIVERY_STATUS_CHANGED', index: true },
  status: { type: String, default: null, index: true },
  riderName: { type: String, default: null },
  riderMobile: { type: String, default: null },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  timestamp: { type: Date, default: Date.now },
  occurredAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

notificationDeliveryEventSchema.index({ tenantId: 1, branchId: 1, occurredAt: -1 });

const NotificationDeliveryEvent = mongoose.models.NotificationDeliveryEvent
  || mongoose.model('NotificationDeliveryEvent', notificationDeliveryEventSchema);
export default NotificationDeliveryEvent;
