import mongoose from 'mongoose';

const vendorSchema = new mongoose.Schema({
    _id: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    companyName: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    normalizedEmail: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    mobile: {
        type: String,
        default: '',
        trim: true
    },
    address: {
        street: { type: String, default: '', trim: true },
        city: { type: String, default: '', trim: true },
        state: { type: String, default: '', trim: true },
        pincode: { type: String, default: '', trim: true }
    },
    gstNumber: {
        type: String,
        default: '',
        trim: true,
        uppercase: true
    },
    drugLicenseNumber: {
        type: String,
        default: '',
        trim: true,
        uppercase: true
    },
    status: {
        type: String,
        enum: ['PENDING_ONBOARDING', 'ACTIVE', 'SUSPENDED'],
        default: 'PENDING_ONBOARDING',
        index: true
    },
    tenantId: {
        type: String,
        default: null
    },
    onboardingTokenHash: {
        type: String,
        default: null
    },
    onboardingTokenExpiresAt: {
        type: Date,
        default: null,
        index: true
    },
    onboardingStatus: {
        type: String,
        enum: ['PENDING', 'COMPLETED', 'EXPIRED'],
        default: 'PENDING',
        index: true
    },
    onboardingCompletedAt: {
        type: Date,
        default: null
    },
    invitedBy: {
        type: String,
        default: null
    }
}, {
    timestamps: true,
    _id: false
});

vendorSchema.index({ normalizedEmail: 1 });
vendorSchema.index({ onboardingTokenHash: 1 });
vendorSchema.index({ tenantId: 1 });

const Vendor = mongoose.models.Vendor || mongoose.model('Vendor', vendorSchema);
export default Vendor;
