import mongoose from 'mongoose';

const userProfileSchema = new mongoose.Schema({
    supabaseId: {
        type: String,
        trim: true,
        default: undefined
    },
    // Strictly isolate identity reference to Supabase User ID
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
        default: ''
    },
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    email: {
        type: String,
        default: '',
        lowercase: true,
        trim: true
    },
    // Application-level AES-256-GCM encrypted sensitive PII (addresses, phone numbers, notes)
    encryptedPii: {
        type: String,
        default: null
    },
    mobile: {
        type: String,
        default: ''
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
    role: {
        type: String,
        enum: ['customer', 'admin', 'rider'],
        default: 'customer'
    },
    lastLoginAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

userProfileSchema.index({ supabaseId: 1 }, { unique: true, sparse: true });

const UserProfile = mongoose.models.UserProfile || mongoose.model('UserProfile', userProfileSchema);
export default UserProfile;
