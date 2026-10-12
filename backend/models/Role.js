import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  scope: { type: String, enum: ['PLATFORM', 'TENANT', 'CUSTOMER'], default: 'CUSTOMER' },
  status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE', index: true }
}, { timestamps: true });

export default mongoose.models.Role || mongoose.model('Role', roleSchema);
