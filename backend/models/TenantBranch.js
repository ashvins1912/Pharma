import mongoose from 'mongoose';

const tenantBranchSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    tenantId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: mongoose.Schema.Types.Mixed, default: {} },
    isTenantLocation: { type: Boolean, default: false, index: true },
    geolocation: {
        latitude: { type: Number, min: -90, max: 90, default: null },
        longitude: { type: Number, min: -180, max: 180, default: null }
    },
    serviceRadiusKm: { type: Number, min: 0, default: 10 },
    deliveryMode: { type: String, default: 'OWN_RIDER' },
    minimumOrderValue: { type: Number, min: 0, default: 149 },
    freeDeliveryAbove: { type: Number, min: 0, default: 499 },
    deliveryFee: { type: Number, min: 0, default: 30 },
    operatingHours: { type: mongoose.Schema.Types.Mixed, default: { open: '08:00', close: '22:00' } },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'], default: 'ACTIVE', index: true },
    isDefault: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: String, default: null }
}, { timestamps: true });

tenantBranchSchema.index({ tenantId: 1, code: 1 }, { unique: true });
tenantBranchSchema.index({ tenantId: 1, status: 1 });

export default mongoose.models.TenantBranch || mongoose.model('TenantBranch', tenantBranchSchema);
