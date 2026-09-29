const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
    code: { type: String, unique: true, uppercase: true, required: true },
    discountPercentage: { type: Number, required: true },
    isActive: { type: Boolean, default: true }
});

module.exports = mongoose.model('Coupon', couponSchema);
