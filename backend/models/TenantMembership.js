import mongoose from 'mongoose';

const tenantMembershipSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    tenantId: { type: String, required: true, index: true },
    branchId: { type: String, default: null },
    role: {
        type: String,
        enum: [
            'TENANT_ADMIN',
            'TENANT_OWNER',
            'PHARMACY_STAFF',
            'PHARMACIST',
            'ORDER_MANAGER',
            'INVENTORY_MANAGER',
            'DISPATCHER',
            'RIDER',
            'TENANT_RIDER'
        ],
        default: 'TENANT_ADMIN'
    },
    permissions: [{ type: String }],
    status: {
        type: String,
        enum: ['ACTIVE', 'INVITED', 'SUSPENDED', 'REVOKED'],
        default: 'ACTIVE',
        index: true
    },
    invitedBy: { type: String, default: null },
    invitationToken: { type: String, default: null }
}, {
    timestamps: true
});

tenantMembershipSchema.index({ userId: 1, tenantId: 1 }, { unique: true });

export default mongoose.models.TenantMembership || mongoose.model('TenantMembership', tenantMembershipSchema);
