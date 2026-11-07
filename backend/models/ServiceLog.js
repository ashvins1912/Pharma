import mongoose from 'mongoose';
const serviceLogSchema = new mongoose.Schema({
  service: { type: String, required: true, index: true, default: 'backend-api' },
  level: { type: String, enum: ['WARN', 'ERROR'], required: true, index: true },
  message: { type: String, required: true, maxlength: 2000 },
  code: { type: String, default: null, maxlength: 120 },
  statusCode: { type: Number, required: true, index: true },
  method: { type: String, required: true, maxlength: 12 },
  path: { type: String, required: true, maxlength: 500 },
  requestId: { type: String, default: null, index: true }
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });
serviceLogSchema.index({ service: 1, createdAt: -1 });
serviceLogSchema.index({ createdAt: -1, level: 1 });
serviceLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });
export default mongoose.models.ServiceLog || mongoose.model('ServiceLog', serviceLogSchema);