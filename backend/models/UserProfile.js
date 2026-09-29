import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema({
    label: { type: String, default: 'Home' }, // Home, Office, Hospital, Other
    fullName: { type: String, default: '' },
    mobile: { type: String, default: '' },
    addressLine1: { type: String, required: true },
    addressLine2: { type: String, default: '' },
    city: { type: String, default: 'Bengaluru' },
    state: { type: String, default: 'Karnataka' },
    pincode: { type: String, default: '560001' },
    landmark: { type: String, default: '' },
    coordinates: {
        lat: { type: Number, default: 12.9716 },
        lng: { type: Number, default: 77.5946 }
    },
    isDefault: { type: Boolean, default: false }
}, { timestamps: true });

const userProfileSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    mobile: { type: String, default: '' },
    addresses: [addressSchema]
}, { timestamps: true });

const UserProfile = mongoose.models.UserProfile || mongoose.model('UserProfile', userProfileSchema);
export default UserProfile;
