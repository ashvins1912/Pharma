import mongoose from 'mongoose';

const inventoryImportJobSchema = new mongoose.Schema({
    adminId: { type: String, required: true, index: true },
    fileName: { type: String, required: true },
    inputFileId: { type: mongoose.Schema.Types.ObjectId, default: null },
    status: {
        type: String,
        enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'],
        default: 'QUEUED',
        index: true
    },
    totalRecords: { type: Number, default: 0 },
    processedRecords: { type: Number, default: 0 },
    successfulRecords: { type: Number, default: 0 },
    failedRecords: { type: Number, default: 0 },
    importedCount: { type: Number, default: 0 },
    updatedCount: { type: Number, default: 0 },
    currentBatch: { type: Number, default: 0 },
    errorMessage: { type: String, default: '' },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
}, { timestamps: true });

const InventoryImportJob = mongoose.models.InventoryImportJob
    || mongoose.model('InventoryImportJob', inventoryImportJobSchema);

export default InventoryImportJob;
