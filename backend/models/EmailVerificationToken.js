import mongoose from 'mongoose';

/**
 * Single-use, cryptographically secure verification token model.
 * Note: Raw token is NEVER persisted in the database; only the SHA-256 tokenHash is stored.
 */
const emailVerificationTokenSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
    },
    userId: {
        type: String,
        required: true,
        unique: true // Keeps userId unique; dropped inline "index: true" since unique creates an index
    },
    tokenHash: {
        type: String,
        required: true // ❌ REMOVED index: true from here (handled at the bottom)
    },
    purpose: {
        type: String,
        enum: ['ACCOUNT_ACTIVATION', 'EMAIL_VERIFICATION', 'PASSWORD_RESET'],
        default: 'ACCOUNT_ACTIVATION'
    },
    expiresAt: {
        type: Date,
        required: true,
        index: true
    },
    usedAt: {
        type: Date,
        default: null
    },
    attempts: {
        type: Number,
        default: 0
    },
    requestIp: {
        type: String,
        default: null
    },
    revokedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Single-field index for cryptographic lookups
emailVerificationTokenSchema.index({ tokenHash: 1 });

// Compound index for querying user tokens by specific flows
emailVerificationTokenSchema.index({ userId: 1, purpose: 1 });

const EmailVerificationToken = mongoose.models.EmailVerificationToken || mongoose.model('EmailVerificationToken', emailVerificationTokenSchema);
export default EmailVerificationToken;
