const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
    label: { type: String, default: 'Home' },
    addressLine: { type: String, required: true },
    coordinates: { lat: Number, lng: Number },
    isDefault: { type: Boolean, default: false }
});

const userProfileSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    mobile: { type: String, required: true },
    addresses: [addressSchema]
});

module.exports = mongoose.model('UserProfile', userProfileSchema);
