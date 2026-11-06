import mongoose from 'mongoose';

const activityAuditSchema = new mongoose.Schema({
  tenantId: { type: String, default: null, index: true },
  branchId: { type: String, default: null, index: true },
  actorId: { type: String, default: 'unknown', index: true },
  actorName: { type: String, default: 'Unknown user' },
  actorRole: { type: String, default: 'unknown' },
  action: { type: String, required: true, index: true },
  entityType: { type: String, required: true, index: true },
  entityId: { type: String, default: null },
  method: { type: String, required: true },
  path: { type: String, required: true },
  statusCode: { type: Number, required: true },
  changedFields: { type: [String], default: [] },
  requestId: { type: String, default: null }
}, { timestamps: true, versionKey: false });

activityAuditSchema.index({ tenantId: 1, branchId: 1, createdAt: -1 });
activityAuditSchema.index({ actorId: 1, createdAt: -1 });

export default mongoose.models.ActivityAudit || mongoose.model('ActivityAudit', activityAuditSchema);
