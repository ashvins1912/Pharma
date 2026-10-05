import { createRequire } from 'node:module';

let mongoose;
try {
  mongoose = (await import('mongoose')).default;
} catch {
  try {
    const req = createRequire(import.meta.url);
    mongoose = req('mongoose');
  } catch {
    const rootReq = createRequire(new URL('../../../package.json', import.meta.url));
    mongoose = rootReq('mongoose');
  }
}

const productSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, default: 'tenant-ashvin-main', index: true },
  sku: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  genericName: { type: String, default: '' },
  strength: { type: String, default: '' },
  form: { type: String, default: '' },
  manufacturer: { type: String, default: '' },
  category: { type: String, default: 'General Medicine' },
  description: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  requiresPrescription: { type: Boolean, default: false },
  version: { type: Number, default: 1 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

productSchema.index({ tenantId: 1, sku: 1 }, { unique: true });

const inventorySchema = new mongoose.Schema({
  tenantId: { type: String, required: true, default: 'tenant-ashvin-main', index: true },
  branchId: { type: String, required: true, default: 'branch-indore-central', index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryProduct', required: true },
  sku: { type: String, required: true, trim: true, uppercase: true },
  stockQuantity: { type: Number, required: true, min: 0, default: 0 },
  reservedQuantity: { type: Number, required: true, min: 0, default: 0 },
  price: { type: Number, required: true, min: 0 },
  batchNumber: { type: String, default: '' },
  expiryDate: { type: Date, default: null },
  warehouse: { type: String, default: 'default' }
}, { timestamps: true });

inventorySchema.index({ tenantId: 1, branchId: 1, productId: 1, batchNumber: 1 }, { unique: true });
inventorySchema.index({ tenantId: 1, branchId: 1, sku: 1 });

inventorySchema.virtual('availableQuantity').get(function () {
  return Math.max(0, this.stockQuantity - this.reservedQuantity);
});

const reservationSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, default: 'tenant-ashvin-main', index: true },
  branchId: { type: String, required: true, default: 'branch-indore-central', index: true },
  reservationId: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },
  parentJobId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  orderId: { type: String, required: true, index: true },
  status: { type: String, enum: ['RESERVED', 'RELEASED', 'DEDUCTED'], default: 'RESERVED' },
  items: [{
    productId: { type: mongoose.Schema.Types.ObjectId, required: true },
    sku: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 }
  }]
}, { timestamps: true });

const importJobSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, default: 'tenant-ashvin-main', index: true },
  branchId: { type: String, required: true, default: 'branch-indore-central', index: true },
  fileName: { type: String, required: true },
  filePath: { type: String, required: true },
  uploadedBy: { type: String, required: true },
  idempotencyKey: { type: String, required: true },
  parentJobId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  status: {
    type: String,
    enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'],
    default: 'QUEUED',
    index: true
  },
  totalRecords: { type: Number, default: 0 },
  processedRecords: { type: Number, default: 0 },
  successfulRecords: { type: Number, default: 0 },
  insertedRecords: { type: Number, default: 0 },
  updatedRecords: { type: Number, default: 0 },
  failedRecords: { type: Number, default: 0 },
  retryCount: { type: Number, default: 0 },
  retryKeys: { type: [String], default: [] },
  startedAt: Date,
  completedAt: Date,
  errorMessage: String
}, { timestamps: true });

importJobSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
importJobSchema.index({ tenantId: 1, branchId: 1, createdAt: -1 });

const importFailureSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, default: 'tenant-ashvin-main', index: true },
  branchId: { type: String, required: true, default: 'branch-indore-central', index: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  batchId: { type: String, required: true },
  rowNumber: { type: Number, required: true },
  sku: String,
  productName: String,
  originalRecord: { type: mongoose.Schema.Types.Mixed, required: true },
  reason: { type: String, required: true },
  errorType: {
    type: String,
    enum: ['VALIDATION_ERROR', 'DUPLICATE_ERROR', 'DATABASE_ERROR', 'NETWORK_ERROR', 'TIMEOUT', 'BUSINESS_RULE_ERROR', 'UNKNOWN_ERROR'],
    required: true
  },
  technicalCode: { type: String, default: '' },
  retryable: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

importFailureSchema.index({ tenantId: 1, branchId: 1, jobId: 1, rowNumber: 1 });

const auditSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, default: 'tenant-ashvin-main', index: true },
  branchId: { type: String, required: true, default: 'branch-indore-central', index: true },
  actor: { type: String, required: true },
  operation: { type: String, required: true },
  operationKey: { type: String, unique: true, sparse: true },
  requestId: String,
  correlationId: String,
  productId: mongoose.Schema.Types.ObjectId,
  sku: String,
  details: mongoose.Schema.Types.Mixed
}, { timestamps: true });

export const Product = mongoose.models.InventoryProduct || mongoose.model('InventoryProduct', productSchema);
export const Inventory = mongoose.models.Inventory || mongoose.model('Inventory', inventorySchema);
export const Reservation = mongoose.models.InventoryReservation || mongoose.model('InventoryReservation', reservationSchema);
export const ImportJob = mongoose.models.InventoryImportJob || mongoose.model('InventoryImportJob', importJobSchema);
export const ImportFailure = mongoose.models.InventoryImportFailure || mongoose.model('InventoryImportFailure', importFailureSchema);
export const Audit = mongoose.models.InventoryAudit || mongoose.model('InventoryAudit', auditSchema);
