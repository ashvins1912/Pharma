import mongoose from 'mongoose';

/**
 * Authentication Identity Model
 * Supports multi-provider authentication (LOCAL, GOOGLE, etc.) linked to a canonical User
 */
const userIdentitySchema = new mongoose.Schema({
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
    provider: {
        type: String,
        enum: ['LOCAL', 'GOOGLE'],
        required: true
    },
    providerUserId: {
        type: String,
        required: true
    },
    providerEmail: {
        type: String,
        lowercase: true,
        trim: true
    },
    providerEmailVerified: {
        type: Boolean,
        default: false
    },
    passwordHash: {
        type: String,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastLoginAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

userIdentitySchema.index({ provider: 1, providerUserId: 1 }, { unique: true });

const UserIdentity = mongoose.models.UserIdentity || mongoose.model('UserIdentity', userIdentitySchema);
export default UserIdentity;
