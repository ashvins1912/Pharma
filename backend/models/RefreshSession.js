import mongoose from 'mongoose';

const refreshSessionSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    jtiHash: { type: String, required: true, unique: true },
    aal: { type: String, default: 'aal1' },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null, index: true },
    replacedByJtiHash: { type: String, default: null }
}, { timestamps: true });

refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshSessionSchema.index({ userId: 1, revokedAt: 1 });

const RefreshSession = mongoose.models.RefreshSession
    || mongoose.model('RefreshSession', refreshSessionSchema);

export default RefreshSession;
