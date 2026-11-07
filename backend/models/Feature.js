import mongoose from 'mongoose';

const featureSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE', index: true }
}, { timestamps: true });

export default mongoose.models.Feature || mongoose.model('Feature', featureSchema);
