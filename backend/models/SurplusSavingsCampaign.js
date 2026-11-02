import mongoose from 'mongoose';

const surplusSavingsCampaignSchema = new mongoose.Schema({
    tenantId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 500 },
    status: { type: String, enum: ['DRAFT', 'ACTIVE', 'PAUSED'], default: 'DRAFT', index: true },
    medicineIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true }],
    discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    maxDiscountAmount: { type: Number, min: 0, default: null },
    minOrderAmount: { type: Number, min: 0, default: 0 },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true, index: true },
    usageLimit: { type: Number, min: 1, default: null },
    usageCount: { type: Number, min: 0, default: 0 },
    perCustomerLimit: { type: Number, min: 1, default: 1 },
    createdBy: { type: String, required: true }
}, { timestamps: true });

surplusSavingsCampaignSchema.index({ tenantId: 1, status: 1, startsAt: 1, endsAt: 1 });
surplusSavingsCampaignSchema.index({ tenantId: 1, medicineIds: 1 });

export default mongoose.models.SurplusSavingsCampaign
    || mongoose.model('SurplusSavingsCampaign', surplusSavingsCampaignSchema);
