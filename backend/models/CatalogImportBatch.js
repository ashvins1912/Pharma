import mongoose from 'mongoose';

const importErrorSchema = new mongoose.Schema({
    rowNumber: { type: Number, required: true },
    sku: { type: String, default: '' },
    productName: { type: String, default: '' },
    field: { type: String, required: true },
    message: { type: String, required: true },
    rawData: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const catalogImportBatchSchema = new mongoose.Schema({
    tenantId: { type: String, required: true, index: true },
    batchId: { type: String, required: true, unique: true, index: true },
    fileName: { type: String, required: true, trim: true },

    totalRows: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },

    status: { type: String, enum: ['processing', 'completed', 'failed', 'completed_with_errors'], default: 'processing', index: true },
    errors: [importErrorSchema],

    executedBy: { type: String, default: 'Tenant Admin' }
}, {
    timestamps: true
});

catalogImportBatchSchema.index({ tenantId: 1, createdAt: -1 });

const CatalogImportBatch = mongoose.models.CatalogImportBatch || mongoose.model('CatalogImportBatch', catalogImportBatchSchema);
export default CatalogImportBatch;
