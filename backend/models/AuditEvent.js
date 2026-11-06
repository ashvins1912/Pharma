import mongoose from 'mongoose';

const auditEventSchema = new mongoose.Schema({
    eventId: { type: String, required: true, unique: true, index: true },
    eventType: { type: String, required: true, index: true },
    entityId: { type: String, required: true, index: true },
    tenantId: { type: String, required: true, index: true },
    branchId: { type: String, default: null, index: true },
    actor: {
        userId: { type: String, default: 'system' },
        role: { type: String, default: 'system' }
    },
    summary: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: { createdAt: true, updatedAt: false } });

auditEventSchema.index({ tenantId: 1, createdAt: -1 });
auditEventSchema.index({ tenantId: 1, branchId: 1, createdAt: -1 });

export default mongoose.models.AuditEvent || mongoose.model('AuditEvent', auditEventSchema);
