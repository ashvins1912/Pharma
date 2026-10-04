import mongoose from 'mongoose';

const tenantSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    legalName: { type: String, trim: true },
    code: { type: String, trim: true, uppercase: true },
    status: {
        type: String,
        enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED'],
        default: 'ACTIVE',
        index: true
    },
    contactEmail: { type: String, trim: true, lowercase: true },
    contactPhone: { type: String, trim: true },
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'INR' },
    settings: {
        allowOfferWithCoupon: { type: Boolean, default: false },
        allowCouponWithRewards: { type: Boolean, default: true },
        allowOfferWithRewards: { type: Boolean, default: false }
    }
}, {
    timestamps: true,
    _id: false
});

export default mongoose.models.Tenant || mongoose.model('Tenant', tenantSchema);
