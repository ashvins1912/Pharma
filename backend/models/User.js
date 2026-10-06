import mongoose from 'mongoose';

/**
 * Calculates current age from date of birth (DOB).
 * Never store age as source of truth; store dateOfBirth and calculate dynamically.
 * @param {string|Date} dob
 * @returns {number|null}
 */
export function calculateAge(dob) {
    if (!dob) return null;
    const birthDate = new Date(dob);
    if (Number.isNaN(birthDate.getTime())) return null;

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age -= 1;
    }
    return age >= 0 ? age : null;
}

const userSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true, // Keep this unique inline
    },
    // Backward-compatibility alias for legacy references
    supabase_user_id: {
        type: String,
        index: true
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
        trim: true,
        unique: true // Changed from "index: true" to ensure it stays unique cleanly
    },
    emailVerified: {
        type: Boolean,
        default: false,
        index: true
    },
    emailVerifiedAt: {
        type: Date,
        default: null
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
        default: 'PENDING_EMAIL_VERIFICATION',
        index: true
    },
    // Backward-compatibility status mirror
    status: {
        type: String,
        default: 'PENDING_VERIFICATION'
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
    name: {
        type: String,
        trim: true,
        default: ''
    },
    // Canonical date of birth: YYYY-MM-DD
    dateOfBirth: {
        type: String,
        default: null
    },
    mobileNumber: {
        type: String,
        trim: true,
        default: ''
    },
    // Mirror field for legacy mobile callers
    mobile: {
        type: String,
        trim: true,
        default: ''
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
        default: false,
        index: true
    },
    primaryAuthProvider: {
        type: String,
        enum: ['LOCAL', 'GOOGLE'],
        default: 'LOCAL'
    },
    role: {
        type: String,
        default: 'customer'
    },
    roles: [{
        type: String,
        default: ['customer']
    }],
    tenantId: {
        type: String,
        default: null,
        index: true
    },
    branchId: {
        type: String,
        default: null
    },
    lastLoginAt: {
        type: Date,
        default: null
    },
    activatedAt: {
        type: Date,
        default: null
    },
    version: {
        type: Number,
        default: 1
    },
    // Password hash stored for legacy compatibility if needed
    passwordHash: {
        type: String,
        default: null
    },
    // MFA metadata
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
    }
}, {
    timestamps: true
});

// ❌ REMOVED BOTH userSchema.index() LINES FROM HERE TO AVOID CODE DUPLICATION

// Virtual getter for dynamically calculated age
userSchema.virtual('age').get(function () {
    return calculateAge(this.dateOfBirth);
});

userSchema.methods.toSafeObject = function () {
    const obj = this.toObject({ virtuals: true });
    delete obj.passwordHash;
    delete obj.mfaSecretEncrypted;
    delete obj.__v;
    obj.age = calculateAge(obj.dateOfBirth);
    return obj;
};

const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;
