import mongoose from 'mongoose';

const stagedImportBatchSchema = new mongoose.Schema({
  batchId: { type: String, required: true, unique: true, index: true },
  tenantId: { type: String, required: true, index: true },
  branchId: { type: String, required: true, index: true },
  uploadedBy: { type: String, required: true },
  fileName: { type: String, required: true },
  fileSha256: { type: String, required: true },
  previewInventorySnapshot: { type: [mongoose.Schema.Types.Mixed], default: [] },
  previewProductSnapshot: { type: [mongoose.Schema.Types.Mixed], default: [] },
  idempotencyKey: { type: String, required: true },
  status: { type: String, enum: ['STAGING', 'READY', 'PARTIALLY_PUBLISHED', 'PUBLISHED', 'REVERTED', 'FAILED'], default: 'STAGING', index: true },
  totalRows: { type: Number, default: 0 },
  validRows: { type: Number, default: 0 },
  invalidRows: { type: Number, default: 0 },
  publishedRows: { type: Number, default: 0 },
  unpublishedRows: { type: Number, default: 0 },
  nextPublicationSequence: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  completedAt: Date
}, { timestamps: true });
stagedImportBatchSchema.index({ tenantId: 1, branchId: 1, idempotencyKey: 1 }, { unique: true });
stagedImportBatchSchema.index({ tenantId: 1, branchId: 1, createdAt: -1 });

const stagedImportRowSchema = new mongoose.Schema({
  batchId: { type: String, required: true, index: true },
  tenantId: { type: String, required: true, index: true },
  branchId: { type: String, required: true, index: true },
  rowId: { type: String, required: true },
  rowNumber: { type: Number, required: true },
  originalRecord: { type: mongoose.Schema.Types.Mixed, required: true },
  normalized: { type: mongoose.Schema.Types.Mixed, default: null },
  validationErrors: { type: [String], default: [] },
  status: { type: String, enum: ['INVALID', 'READY', 'PUBLISHED', 'UNPUBLISHED', 'REVERTED'], default: 'READY', index: true },
  version: { type: Number, default: 1 },
  publishedAt: Date,
  publishedBy: String,
  publication: { type: mongoose.Schema.Types.Mixed, default: null },
  history: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, { timestamps: true });
stagedImportRowSchema.index({ batchId: 1, rowId: 1 }, { unique: true });
stagedImportRowSchema.index({ tenantId: 1, branchId: 1, batchId: 1, status: 1, rowNumber: 1 });

export const StagedImportBatch = mongoose.models.StagedImportBatch
  || mongoose.model('StagedImportBatch', stagedImportBatchSchema);
export const StagedImportRow = mongoose.models.StagedImportRow
  || mongoose.model('StagedImportRow', stagedImportRowSchema);
