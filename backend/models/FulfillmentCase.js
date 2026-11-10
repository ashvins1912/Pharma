import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const fulfillmentLineSchema = new mongoose.Schema({
  productId: { type: String, default: null },
  name: { type: String, default: '' },
  requestedName: { type: String, default: '' },
  composition: { type: String, default: '' },
  strength: { type: String, default: '' },
  dosageForm: { type: String, default: '' },
  manufacturer: { type: String, default: '' },
  requestedQuantity: { type: Number, required: true, min: 1 },
  allocatedQuantity: { type: Number, default: 0, min: 0 },
  waitingQuantity: { type: Number, default: 0, min: 0 },
  acceptedAlternativeProductId: { type: String, default: null },
  notifiedAvailableQuantity: { type: Number, default: 0, min: 0 },
  customerDecision: { type: String, enum: ['PENDING', 'ACCEPTED_ORIGINAL', 'ACCEPTED_ALTERNATIVE', 'REMOVED', 'CANCELLED'], default: 'PENDING' },
  unitPrice: { type: Number, min: 0, default: 0 },
  listPrice: { type: Number, min: 0, default: 0 },
  discountPercentage: { type: Number, min: 0, max: 100, default: 0 },
  quotedUnitPrice: { type: Number, min: 0, default: 0 },
  prescriptionRequired: { type: Boolean, default: false }
}, { _id: false });

const fulfillmentCaseSchema = new mongoose.Schema({
  caseNumber: { type: String, required: true, unique: true, index: true },
  stockWatchId: { type: String, unique: true, sparse: true, default: () => 'SW-' + randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase() },
  customerId: { type: String, required: true, index: true },
  tenantId: { type: String, required: true, index: true },
  branchId: { type: String, default: null, index: true },
  sourceType: { type: String, enum: ['CHECKOUT', 'MEDICINE_REQUEST', 'ORDER'], required: true, index: true },
  sourceId: { type: String, default: null, index: true },
  parentOrderId: { type: String, default: null, index: true },
  childOrderIds: { type: [String], default: [] },
  addressId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAddress', default: null },
  deliveryAddress: { type: String, default: '' },
  addressDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
  coordinates: { lat: Number, lng: Number },
  customerMobile: { type: String, default: '' },
  orderedForName: { type: String, default: '' },
  paymentMethod: { type: String, default: 'Cash on Delivery (COD)' },
  patientPuid: { type: String, default: null },
  prescriptionRequired: { type: Boolean, default: false },
  prescriptionUrl: { type: String, default: null },
  prescriptionId: { type: String, default: null },
  status: { type: String, enum: ['AWAITING_CUSTOMER_DECISION', 'WAITING_FOR_STOCK', 'READY_FOR_CONFIRMATION', 'CONFIRMING', 'PARTIALLY_FULFILLED', 'FULFILLED', 'EXPIRED', 'CANCELLED'], default: 'AWAITING_CUSTOMER_DECISION', index: true },
  lines: { type: [fulfillmentLineSchema], default: [] },
  waitDays: { type: Number, min: 1, max: 5, default: null },
  waitUntil: { type: Date, default: null, index: true },
  lastAvailabilityCheckAt: { type: Date, default: null },
  confirmationId: { type: String, default: null, index: true },
  lastConfirmedOrderId: { type: String, default: null, index: true },
  lastConfirmedAt: { type: Date, default: null },
  confirmingAt: { type: Date, default: null },
  confirmationPreviousStatus: { type: String, default: null },
  confirmationLines: { type: [mongoose.Schema.Types.Mixed], default: [] },
  notificationState: { type: String, enum: ['NOT_SENT', 'SENT', 'FAILED'], default: 'NOT_SENT' },
  idempotencyKey: { type: String, required: true },
  requestFingerprint: { type: String, required: true },
  auditTrail: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, { timestamps: true });

fulfillmentCaseSchema.index({ customerId: 1, tenantId: 1, idempotencyKey: 1 }, { unique: true });
fulfillmentCaseSchema.index({ status: 1, waitUntil: 1, tenantId: 1 });
fulfillmentCaseSchema.index({ customerId: 1, createdAt: -1 });

const FulfillmentCase = mongoose.models.FulfillmentCase || mongoose.model('FulfillmentCase', fulfillmentCaseSchema);
export default FulfillmentCase;
