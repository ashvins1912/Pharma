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
    pincode: { type: String, default: '560001' },
    landmark: { type: String, default: '' },
    addressLine: { type: String, default: '' },
    coordinates: {
        lat: { type: Number, required: true, min: -90, max: 90 },
        lng: { type: Number, required: true, min: -180, max: 180 }
    },
    isDefault: { type: Boolean, default: false }
}, { timestamps: true });

const UserAddress = mongoose.models.UserAddress || mongoose.model('UserAddress', userAddressSchema);
export default UserAddress;
