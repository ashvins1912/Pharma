import mongoose from 'mongoose';

const permissionSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true },
  featureCode: { type: String, required: true, index: true },
  action: { type: String, required: true, trim: true },
  status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE', index: true }
}, { timestamps: true });

export default mongoose.models.Permission || mongoose.model('Permission', permissionSchema);
