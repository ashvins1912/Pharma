import mongoose from 'mongoose';

/**
 * Single-use, cryptographically secure verification token model.
 * Note: Raw token is NEVER persisted in the database; only the SHA-256 tokenHash is stored.
 */
const emailVerificationTokenSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
        unique: true
    },
    userId: {
        type: String,
        required: true,
        index: true
    },
    tokenHash: {
        type: String,
        required: true,
        index: true
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

emailVerificationTokenSchema.index({ tokenHash: 1 });
emailVerificationTokenSchema.index({ userId: 1, purpose: 1 });

const EmailVerificationToken = mongoose.models.EmailVerificationToken || mongoose.model('EmailVerificationToken', emailVerificationTokenSchema);
export default EmailVerificationToken;
