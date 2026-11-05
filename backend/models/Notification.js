import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  dedupeKey: { type: String, default: null },
  tenantId: { type: String, default: null, index: true },
  branchId: { type: String, default: null, index: true },
  recipientUserId: { type: String, default: null, index: true },
  title: { type: String, required: true, maxlength: 240 },
  body: { type: String, required: true, maxlength: 4000 },
  channels: { type: [String], default: ['IN_APP'] },
  eventType: { type: String, default: 'NOTIFICATION_CREATED', index: true },
  orderId: { type: String, default: null, index: true },
  riderId: { type: String, default: null },
  medicineRequestId: { type: String, default: null, index: true },
  fulfillmentCaseId: { type: String, default: null, index: true },
  promotionId: { type: String, default: null },
  pharmacyName: { type: String, default: null },
  actionUrl: { type: String, default: null },
  status: { type: String, default: null },
  read: { type: Boolean, default: false, index: true },
  readAt: { type: Date, default: null }
}, { timestamps: { createdAt: true, updatedAt: false } });

notificationSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
notificationSchema.index({ recipientUserId: 1, createdAt: -1 });
notificationSchema.index({ tenantId: 1, branchId: 1, createdAt: -1 });

const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
export default Notification;
