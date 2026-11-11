import mongoose from 'mongoose';

const inventoryImportRowSchema = new mongoose.Schema({
    jobId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    rowNumber: { type: Number, required: true },
    original: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
        type: String,
        enum: ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED'],
        default: 'PENDING',
        index: true
    },
    errorReason: { type: String, default: '' },
    errorCategory: { type: String, default: '' },
    technicalCode: { type: String, default: '' }
}, { timestamps: true });

inventoryImportRowSchema.index({ jobId:  1, rowNumber: 1 }, { unique: true });
inventoryImportRowSchema.index({ jobId: 1, status: 1, rowNumber: 1 });

const InventoryImportRow = mongoose.models.InventoryImportRow
    || mongoose.model('InventoryImportRow', inventoryImportRowSchema);

export default InventoryImportRow;
