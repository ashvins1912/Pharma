import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  tenantId: { type: 'string', required: true, index: true },
  sku: { type: 'string', required: true, trim: true, uppercase: true },
  name: { type: 'string', required: true, trim: true },
  genericName: { type: 'string', default: '' },
  strength: { type: 'string', default: '' },
  form: { type: 'string', default: '' },
  manufacturer: { type: 'string', default: '' },
  category: { type: 'string', default: 'General Medicine' },
  description: { type: 'string', default: '' },
  imageUrl: { type: 'string', default: '' },
  baseCostPrice: { type: 'number', min: 0 },
  marginTier: { type: 'string', enum: ['LOW', 'MID', 'HIGH'], default: 'LOW' },
  requiresPrescription: { type: 'boolean', default: false },
  version: { type: 'number', default: 1 },
  active: { type: 'boolean', default: true }
}, { timestamps: true });

productSchema.index({ tenantId: 1, sku: 1 }, { unique: true });

const inventorySchema = new mongoose.Schema({
  tenantId: { type: 'string', required: true, index: true },
  branchId: { type: 'string', required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryProduct', required: true },
  sku: { type: 'string', required: true, trim: true, uppercase: true },
  stockQuantity: { type: 'number', required: true, min: 0, default: 0 },
  reservedQuantity: { type: 'number', required: true, min: 0, default: 0 },
  price: { type: 'number', required: true, min: 0 },
  batchNumber: { type: 'string', default: '' },
  expiryDate: { type: 'date', default: null },
  warehouse: { type: 'string', default: 'default' }
}, { timestamps: true });

inventorySchema.index({ tenantId: 1, branchId: 1, productId: 1, batchNumber: 1 }, { unique: true });
inventorySchema.index({ tenantId: 1, branchId: 1, sku: 1 });

inventorySchema.virtual('availableQuantity').get(function () {
  return Math.max(0, this.stockQuantity - this.reservedQuantity);
});

const reservationSchema = new mongoose.Schema({
  tenantId: { type: 'string', required: true, index: true },
  branchId: { type: 'string', required: true, index: true },
  reservationId: { type: 'string', required: true, unique: true },
  idempotencyKey: { type: 'string', required: true, unique: true },
  parentJobId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  orderId: { type: 'string', required: true, index: true },
  status: { type: 'string', enum: ['RESERVED', 'RELEASED', 'DEDUCTED'], default: 'RESERVED' },
  expiresAt: { type: Date, default: null, index: true },
  items: [{
    productId: { type: mongoose.Schema.Types.ObjectId, required: true },
    sku: { type: 'string', required: true },
    quantity: { type: 'number', required: true, min: 1 }
  }]
}, { timestamps: true });

reservationSchema.index({ status: 1, expiresAt: 1 });

const importJobSchema = new mongoose.Schema({
  tenantId: { type: 'string', required: true, index: true },
  branchId: { type: 'string', required: true, index: true },
  batchId: { type: 'string', required: true, index: true },
  previewFingerprint: { type: 'string', required: true },
  previewInventorySnapshot: { type: [mongoose.Schema.Types.Mixed], default: [] },
  previewProductSnapshot: { type: [mongoose.Schema.Types.Mixed], default: [] },
  stockMode: { type: 'string', enum: ['REPLACE'], default: 'REPLACE' },
  fileName: { type: 'string', required: true },
  filePath: { type: 'string', required: true },
  uploadedBy: { type: 'string', required: true },
  idempotencyKey: { type: 'string', required: true },
  parentJobId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  status: {
    type: 'string',
    enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'],
    default: 'QUEUED',
    index: true
  },
  totalRecords: { type: 'number', default: 0 },
  processedRecords: { type: 'number', default: 0 },
  successfulRecords: { type: 'number', default: 0 },
  insertedRecords: { type: 'number', default: 0 },
  updatedRecords: { type: 'number', default: 0 },
  failedRecords: { type: 'number', default: 0 },
  retryCount: { type: 'number', default: 0 },
  retryKeys: { type: ['string'], default: [] },
  startedAt: 'date',
  completedAt: 'date',
  errorMessage: 'string'
}, { timestamps: true });

importJobSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
importJobSchema.index({ tenantId: 1, branchId: 1, batchId: 1 });
importJobSchema.index({ tenantId: 1, branchId: 1, createdAt: -1 });


const importBatchSchema = new mongoose.Schema({
  batchId: { type: 'string', required: true, unique: true, index: true },
  tenantId: { type: 'string', required: true, index: true },
  branchId: { type: 'string', required: true, index: true },
  uploadedBy: { type: 'string', required: true },
  status: { type: 'string', enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'REVERTED'], default: 'QUEUED', index: true },
  totalRecords: { type: 'number', default: 0 },
  appliedRecords: { type: 'number', default: 0 },
  revertedAt: 'date',
  revertedBy: 'string',
  rollbackReason: 'string'
}, { timestamps: true });
importBatchSchema.index({ tenantId: 1, branchId: 1, createdAt: -1 });

const importBatchSnapshotSchema = new mongoose.Schema({
  batchId: { type: 'string', required: true, index: true },
  tenantId: { type: 'string', required: true, index: true },
  branchId: { type: 'string', required: true, index: true },
  entityType: { type: 'string', enum: ['PRODUCT', 'INVENTORY'], required: true },
  entityKey: { type: 'string', required: true },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, required: true },
  created: { type: 'boolean', required: true, default: false },
  revertedAt: 'date'
}, { timestamps: true });
importBatchSnapshotSchema.index({ tenantId: 1, branchId: 1, batchId: 1, entityType: 1, entityKey: 1 }, { unique: true });

const importFailureSchema = new mongoose.Schema({
  tenantId: { type: 'string', required: true, index: true },
  branchId: { type: 'string', required: true, index: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  batchId: { type: 'string', required: true },
  rowNumber: { type: 'number', required: true },
  sku: 'string',
  productName: 'string',
  originalRecord: { type: mongoose.Schema.Types.Mixed, required: true },
  reason: { type: 'string', required: true },
  errorType: {
    type: 'string',
    enum: ['VALIDATION_ERROR', 'DUPLICATE_ERROR', 'DATABASE_ERROR', 'NETWORK_ERROR', 'TIMEOUT', 'BUSINESS_RULE_ERROR', 'UNKNOWN_ERROR'],
    required: true
  },
  technicalCode: { type: 'string', default: '' },
  retryable: { type: 'boolean', default: false },
  timestamp: { type: 'date', default: Date.now }
}, { timestamps: true });

importFailureSchema.index({ tenantId: 1, branchId: 1, jobId: 1, rowNumber: 1 });
importFailureSchema.index({ tenantId: 1, branchId: 1, batchId: 1, rowNumber: 1 }, { unique: true });

const auditSchema = new mongoose.Schema({
  tenantId: { type: 'string', required: true, index: true },
  branchId: { type: 'string', required: true, index: true },
  actor: { type: 'string', required: true },
  operation: { type: 'string', required: true },
  operationKey: { type: 'string', unique: true, sparse: true },
  requestId: 'string',
  correlationId: 'string',
  productId: mongoose.Schema.Types.ObjectId,
  sku: 'string',
  details: mongoose.Schema.Types.Mixed
}, { timestamps: true });

export const Product = mongoose.models.InventoryProduct || mongoose.model('InventoryProduct', productSchema);
export const Inventory = mongoose.models.Inventory || mongoose.model('Inventory', inventorySchema);
export const Reservation = mongoose.models.InventoryReservation || mongoose.model('InventoryReservation', reservationSchema);
export const ImportJob = mongoose.models.InventoryImportJob || mongoose.model('InventoryImportJob', importJobSchema);
export const ImportBatch = mongoose.models.InventoryImportBatch || mongoose.model('InventoryImportBatch', importBatchSchema);
export const ImportBatchSnapshot = mongoose.models.InventoryImportBatchSnapshot || mongoose.model('InventoryImportBatchSnapshot', importBatchSnapshotSchema);
export const ImportFailure = mongoose.models.InventoryImportFailure || mongoose.model('InventoryImportFailure', importFailureSchema);
export const Audit = mongoose.models.InventoryAudit || mongoose.model('InventoryAudit', auditSchema);
