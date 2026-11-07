import mongoose from 'mongoose';

const surplusSavingsRedemptionSchema = new mongoose.Schema({
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurplusSavingsCampaign', required: true },
    tenantId: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    discountAmount: { type: Number, required: true, min: 0 }
}, { timestamps: true });

surplusSavingsRedemptionSchema.index(
    { campaignId: 1, customerId: 1 },
    { unique: true }
);
surplusSavingsRedemptionSchema.index({ tenantId: 1, campaignId: 1, customerId: 1 });

export default mongoose.models.SurplusSavingsRedemption
    || mongoose.model('SurplusSavingsRedemption', surplusSavingsRedemptionSchema);
