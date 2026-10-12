import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const orderItemSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  productVersion: { type: Number, min: 1 },
  sku: { type: String, required: true },
  name: { type: String, required: true },
  genericName: { type: String, default: '' },
  strength: { type: String, default: '' },
  form: { type: String, default: '' },
  manufacturer: { type: String, default: '' },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  tax: { type: Number, default: 0, min: 0 },
  discount: { type: Number, default: 0, min: 0 },
  totalPrice: { type: Number, required: true, min: 0 },
  snapshotAt: { type: Date, required: true }
}, { _id: false });

const statusHistorySchema = new mongoose.Schema({
  previousStatus: String,
  newStatus: { type: String, required: true },
  changedBy: { type: String, required: true },
  timestamp: { type: Date, required: true },
  notes: String
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, default: () => `ORD-${randomUUID()}` },
  userId: { type: String, required: true, index: true },
  customerName: { type: String, default: 'Valued Customer' },
  customerMobile: { type: String, default: '' },
  source: {
    type: String,
    enum: ['WEB', 'MOBILE', 'ADMIN', 'POS', 'ERP', 'PARTNER', 'API', 'MEDICINE_REQUEST', 'DIRECT'],
    required: true,
    index: true
  },
  externalReference: { type: String, default: null },
  idempotencyKey: { type: String, default: null },
  requestFingerprint: { type: String, required: true },
  items: { type: [orderItemSchema], required: true },
  subtotal: { type: Number, required: true, min: 0 },
  discountApplied: { type: Number, default: 0, min: 0 },
  totalAmount: { type: Number, required: true, min: 0 },
  finalTotal: { type: Number, required: true, min: 0 },
  paymentMethod: { type: String, required: true },
  cashCollectionStatus: {
    type: String,
    enum: ['CASH_RECEIVED', 'CASH_NOT_RECEIVED', 'NOT_APPLICABLE'],
    default: 'NOT_APPLICABLE',
    index: true
  },
  paymentStatus: {
    type: String,
    enum: ['PENDING', 'PAID', 'FAILED'],
    default: 'PENDING'
  },
  amountPaid: { type: Number, min: 0, default: 0 },
  deliveryAddress: { type: String, required: true },
  addressDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
  coordinates: {
    lat: Number,
    lng: Number
  },
  prescriptionUrl: { type: String, default: null },
  prescriptionId: { type: String, default: null, index: true },
  patientPuid: { type: String, default: null, index: true },
  prescriptionVerification: {
    status: {
      type: String,
      enum: ['NOT_REQUIRED', 'PROCESSING', 'MATCHED', 'PARTIAL_MATCH', 'MISMATCH', 'REVIEW_REQUIRED', 'REJECTED', 'INACTIVE'],
      default: 'NOT_REQUIRED'
    },
    prescriptionId: { type: String, default: null },
    patientPuid: { type: String, default: null },
    overallConfidence: { type: Number, default: 0, min: 0, max: 1 },
    lastCheckedAt: { type: Date, default: null },
    medicines: { type: [mongoose.Schema.Types.Mixed], default: [] },
    issues: { type: [String], default: [] }
  },
  tenantId: { type: String, default: null, index: true },
  branchId: { type: String, default: null, index: true },
  version: { type: Number, default: 1 },
  reservationExpiresAt: { type: Date, default: null },
  prescriptionReconciliationLeaseUntil: { type: Date, default: null, index: true },
  prescriptionReconciliationWorkerId: { type: String, default: null },
  fulfillmentGate: {
    payment: {
      type: String,
      enum: ['PASSED', 'PENDING', 'FAILED'],
      default: 'PASSED'
    },
    inventory: {
      type: String,
      enum: ['RESERVED', 'RELEASED', 'DEDUCTED', 'EXPIRED', 'PENDING'],
      default: 'PENDING'
    },
    prescription: {
      type: String,
      enum: ['NOT_REQUIRED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'INACTIVE'],
      default: 'NOT_REQUIRED'
    },
    customer: {
      type: String,
      enum: ['READY', 'PENDING'],
      default: 'READY'
    },
    delivery: {
      type: String,
      enum: ['NOT_STARTED', 'ASSIGNED', 'COMPLETED'],
      default: 'NOT_STARTED'
    }
  },
  orderStatus: {
    type: String,
    enum: ['Pending_Review', 'Approved', 'Rejected', 'Processing Order', 'Ready to Dispatch', 'Dispatched', 'Delivered', 'Cancelled'],
    default: 'Approved',
    index: true
  },
  reservationId: { type: String, required: true },
  rider: {
    riderId: String,
    riderName: String,
    riderMobile: String,
    assignedAt: Date
  },
  statusHistory: { type: [statusHistorySchema], default: [] }
}, { timestamps: true });

orderSchema.index({ 'fulfillmentGate.prescription': 1, orderStatus: 1 });
orderSchema.index({ tenantId: 1, branchId: 1, createdAt: -1 });

orderSchema.index({ orderNumber: 1 }, { unique: true });
orderSchema.index({ source: 1, externalReference: 1 }, {
  unique: true,
  partialFilterExpression: { externalReference: { $type: 'string' } }
});
orderSchema.index({ source: 1, idempotencyKey: 1 }, {
  unique: true,
  partialFilterExpression: { idempotencyKey: { $type: 'string' } }
});
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });

const eventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  eventKey: { type: String, required: true },
  event: { type: String, required: true },
  orderId: { type: String, required: true, index: true },
  occurredAt: { type: Date, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['QUEUED', 'PROCESSING', 'PROCESSED', 'FAILED'], default: 'QUEUED', index: true },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: null }
}, { timestamps: true });
eventSchema.index({ eventKey: 1 }, { unique: true });

export const Order = mongoose.models.ServiceOrder || mongoose.model('ServiceOrder', orderSchema);
export const OrderEvent = mongoose.models.ServiceOrderEvent || mongoose.model('ServiceOrderEvent', eventSchema);
