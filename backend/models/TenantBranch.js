import mongoose from 'mongoose';

const tenantBranchSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    tenantId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: mongoose.Schema.Types.Mixed, default: {} },
    serviceRadiusKm: { type: Number, min: 0, default: 10 },
    deliveryMode: { type: String, default: 'OWN_RIDER' },
    minimumOrderValue: { type: Number, min: 0, default: 149 },
    freeDeliveryAbove: { type: Number, min: 0, default: 499 },
    deliveryFee: { type: Number, min: 0, default: 30 },
    operatingHours: { type: mongoose.Schema.Types.Mixed, default: { open: '08:00', close: '22:00' } },
    status: { type: String, enum: ['PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED'], default: 'PENDING', index: true },
    activatedAt: { type: Date, default: null }
}, { timestamps: true });

tenantBranchSchema.index({ tenantId: 1, code: 1 }, { unique: true });
tenantBranchSchema.index({ tenantId: 1, status: 1 });

export default mongoose.models.TenantBranch || mongoose.model('TenantBranch', tenantBranchSchema);
