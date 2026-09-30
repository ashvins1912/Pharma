import mongoose from 'mongoose';

const userAddressSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    label: { type: String, default: 'Home' },
    fullName: { type: String, default: '' },
    mobile: { type: String, default: '' },
    addressLine1: { type: String, required: true },
    addressLine2: { type: String, default: '' },
    city: { type: String, default: 'Bengaluru' },
    state: { type: String, default: 'Karnataka' },
    postalCode: { type: String, default: '' },
    country: { type: String, default: 'India' },
    pincode: { type: String, default: '' },
    landmark: { type: String, default: '' },
    addressLine: { type: String, default: '' },
    coordinates: {
        lat: { type: Number, min: -90, max: 90, default: 12.9716 },
        lng: { type: Number, min: -180, max: 180, default: 77.5946 }
    },
    isDefault: { type: Boolean, default: false }
}, { timestamps: true });

userAddressSchema.index({ userId: 1, isDefault: -1, createdAt: 1 });
const UserAddress = mongoose.models.UserAddress || mongoose.model('UserAddress', userAddressSchema);
export default UserAddress;
