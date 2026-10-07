import mongoose from 'mongoose';

const rolePermissionSchema = new mongoose.Schema({
  roleCode: { type: String, required: true, index: true },
  permissionCode: { type: String, required: true, index: true },
  status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE', index: true }
}, { timestamps: true });

rolePermissionSchema.index({ roleCode: 1, permissionCode: 1 }, { unique: true });

export default mongoose.models.RolePermission || mongoose.model('RolePermission', rolePermissionSchema);
