import mongoose from 'mongoose';

const userProfileSchema = new mongoose.Schema({
    supabaseId: {
        type: String,
        trim: true,
        default: undefined
    },
    // Isolated identity reference
    supabase_user_id: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userId: {
        type: String,
        index: true
    },
    name: {
        type: String,
        default: '',
        trim: true
    },
    firstName: {
        type: String,
        trim: true,
        default: ''
    },
    lastName: {
        type: String,
        trim: true,
        default: ''
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    normalizedEmail: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    passwordHash: {
        type: String,
        default: null
    },
    emailVerified: {
        type: Boolean,
        default: false,
        index: true
    },
    verificationTokenHash: {
        type: String,
        default: null
    },
    verificationTokenExpiresAt: {
        type: Date,
        default: null,
        index: true
    },
    resetPasswordTokenHash: {
        type: String,
        default: null,
        index: true
    },
    resetPasswordExpiresAt: {
        type: Date,
        default: null
    },
    status: {
        type: String,
        default: 'ACTIVE',
        index: true
    },
    accountStatus: {
        type: String,
        enum: [
            'PENDING_EMAIL_VERIFICATION',
            'PENDING_ACCOUNT_ACTIVATION',
            'PROFILE_INCOMPLETE',
            'ACTIVE',
            'SUSPENDED',
            'DISABLED',
            'DELETED'
        ],
        default: 'ACTIVE',
        index: true
    },
    dateOfBirth: {
        type: String,
        default: null
    },
    gender: {
        type: String,
        enum: ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'],
        default: null
    },
    mobileNumber: {
        type: String,
        default: '',
        trim: true
    },
    mobileVerified: {
        type: Boolean,
        default: false
    },
    mobileVerifiedAt: {
        type: Date,
        default: null
    },
    profileCompleted: {
        type: Boolean,
        default: true,
        index: true
    },
    primaryAuthProvider: {
        type: String,
        enum: ['LOCAL', 'GOOGLE'],
        default: 'LOCAL'
    },
    activatedAt: {
        type: Date,
        default: null
    },
    version: {
        type: Number,
        default: 1
    },
    // Application-level AES-256-GCM encrypted sensitive PII
    encryptedPii: {
        type: String,
        default: null
    },
    mobile: {
        type: String,
        default: '',
        trim: true
    },
    roles: [{
        type: String,
        default: ['customer']
    }],
    permissions: [{
        type: String,
        default: []
    }],
    role: {
        type: String,
        default: 'customer'
    },
    tenantId: {
        type: String,
        default: null,
        index: true
    },
    branchId: {
        type: String,
        default: null
    },
    // Zero-Cost TOTP Multi-Factor Authentication (MFA) metadata
    mfaEnabled: {
        type: Boolean,
        default: false
    },
    mfaSecretEncrypted: {
        type: String,
        default: null
    },
    mfaEnrolledAt: {
        type: Date,
        default: null
    },
    lastLoginAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

userProfileSchema.index({ normalizedEmail: 1 }, { unique: true });
userProfileSchema.index({ supabaseId: 1 }, { unique: true, sparse: true });
userProfileSchema.index({ verificationTokenHash: 1 });
userProfileSchema.index({ tenantId: 1, role: 1 });

/**
 * Returns a sanitized DTO without sensitive fields (passwordHash, tokens, MFA secrets, etc.)
 */
userProfileSchema.methods.toSafeObject = function () {
    const obj = this.toObject();
    delete obj.passwordHash;
    delete obj.verificationTokenHash;
    delete obj.verificationTokenExpiresAt;
    delete obj.resetPasswordTokenHash;
    delete obj.resetPasswordExpiresAt;
    delete obj.mfaSecretEncrypted;
    delete obj.salt;
    delete obj.__v;
    return obj;
};

const UserProfile = mongoose.models.UserProfile || mongoose.model('UserProfile', userProfileSchema);
export default UserProfile;
