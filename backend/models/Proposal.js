import mongoose from 'mongoose';

const proposalSchema = new mongoose.Schema({
    requestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MedicineRequest',
        required: true,
        unique: true,
        index: true
    },
    customerId: { type: String, required: true, index: true, trim: true },
    requestNumber: { type: String, required: true, trim: true },
    proposalDetails: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
        type: String,
        enum: ['reviewed', 'accepted', 'rejected', 'expired'],
        default: 'reviewed',
        index: true
    },
    reviewedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null, index: true }
}, { timestamps: true });

proposalSchema.index({ customerId: 1, status: 1, createdAt: -1 });

const Proposal = mongoose.models.Proposal || mongoose.model('Proposal', proposalSchema);
export default Proposal;
