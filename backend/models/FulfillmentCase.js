import mongoose from 'mongoose';

const fulfillmentLineSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  name: { type: String, default: '' },
  requestedQuantity: { type: Number, required: true, min: 1 },
  allocatedQuantity: { type: Number, default: 0, min: 0 },
  waitingQuantity: { type: Number, default: 0, min: 0 },
  acceptedAlternativeProductId: { type: String, default: null },
  notifiedAvailableQuantity: { type: Number, default: 0, min: 0 },
  customerDecision: { type: String, enum: ['PENDING', 'ACCEPTED_ORIGINAL', 'ACCEPTED_ALTERNATIVE', 'REMOVED', 'CANCELLED'], default: 'PENDING' },
  unitPrice: { type: Number, min: 0, default: 0 },
  quotedUnitPrice: { type: Number, min: 0, default: 0 },
  prescriptionRequired: { type: Boolean, default: false }
}, { _id: false });

const fulfillmentCaseSchema = new mongoose.Schema({
  caseNumber: { type: String, required: true, unique: true, index: true },
  customerId: { type: String, required: true, index: true },
  tenantId: { type: String, required: true, index: true },
  branchId: { type: String, default: null, index: true },
  sourceType: { type: String, enum: ['CHECKOUT', 'MEDICINE_REQUEST', 'ORDER'], required: true, index: true },
  sourceId: { type: String, default: null, index: true },
  parentOrderId: { type: String, default: null, index: true },
  addressId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAddress', default: null },
  deliveryAddress: { type: String, default: '' },
  addressDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
  coordinates: { lat: Number, lng: Number },
  paymentMethod: { type: String, default: 'Cash on Delivery (COD)' },
  prescriptionUrl: { type: String, default: null },
  prescriptionId: { type: String, default: null },
  patientPuid: { type: String, default: null },
  status: { type: String, enum: ['AWAITING_CUSTOMER_DECISION', 'WAITING_FOR_STOCK', 'READY_FOR_CONFIRMATION', 'PARTIALLY_FULFILLED', 'FULFILLED', 'EXPIRED', 'CANCELLED'], default: 'AWAITING_CUSTOMER_DECISION', index: true },
  lines: { type: [fulfillmentLineSchema], default: [] },
  waitDays: { type: Number, min: 1, max: 5, default: null },
  waitUntil: { type: Date, default: null, index: true },
  lastAvailabilityCheckAt: { type: Date, default: null },
  notificationState: { type: String, enum: ['NOT_SENT', 'SENT', 'FAILED'], default: 'NOT_SENT' },
  idempotencyKey: { type: String, required: true },
  auditTrail: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, { timestamps: true });

fulfillmentCaseSchema.index({ customerId: 1, tenantId: 1, idempotencyKey: 1 }, { unique: true });
fulfillmentCaseSchema.index({ status: 1, waitUntil: 1, tenantId: 1 });
fulfillmentCaseSchema.index({ customerId: 1, createdAt: -1 });

const FulfillmentCase = mongoose.models.FulfillmentCase || mongoose.model('FulfillmentCase', fulfillmentCaseSchema);
export default FulfillmentCase;
