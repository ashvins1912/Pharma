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
    address: {
        street: { type: String, trim: true, default: '' },
        city: { type: String, trim: true, default: '' },
        state: { type: String, trim: true, default: '' },
        pincode: { type: String, trim: true, default: '' }
    },
    gstNumber: { type: String, trim: true, uppercase: true, default: '' },
    drugLicenseNumber: { type: String, trim: true, uppercase: true, default: '' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'INR' },
    profileAudit: [{
        action: { type: String, required: true },
        changedFields: { type: [String], default: [] },
        actorId: { type: String, default: '' },
        actorRole: { type: String, default: '' },
        at: { type: Date, default: Date.now }
    }],
    settings: {
        allowOfferWithCoupon: { type: Boolean, default: false },
        allowCouponWithRewards: { type: Boolean, default: true },
        allowOfferWithRewards: { type: Boolean, default: false },
        // Only platform Super Admin can change this tenant-level edit permission.
        pharmacyProfileEditingEnabled: { type: Boolean, default: false },
        profileEditingPolicyUpdatedAt: { type: Date, default: null },
        profileEditingPolicyUpdatedBy: { type: String, default: null },
        smtp: {
            host: { type: String, trim: true },
            port: { type: Number },
            secure: { type: Boolean },
            user: { type: String, trim: true },
            pass: { type: String, trim: true },
            from: { type: String, trim: true },
            enabled: { type: Boolean }
        }
    }
}, {
    timestamps: true,
    _id: false
});

export default mongoose.models.Tenant || mongoose.model('Tenant', tenantSchema);
