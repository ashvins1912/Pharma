import mongoose from 'mongoose';

const auditEventSchema = new mongoose.Schema({
  eventType: { type: String, required: true, index: true },
  entityId: { type: String, required: true, index: true },
  tenantId: { type: String, default: null, index: true },
  branchId: { type: String, default: null, index: true },
  actorId: { type: String, default: 'system', index: true },
  actorRole: { type: String, default: 'system' },
  summary: { type: String, required: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  occurredAt: { type: Date, required: true, index: true }
}, { timestamps: true });

auditEventSchema.index({ tenantId: 1, occurredAt: -1 });
auditEventSchema.index({ tenantId: 1, branchId: 1, occurredAt: -1 });

export default mongoose.models.AuditEvent || mongoose.model('AuditEvent', auditEventSchema);
