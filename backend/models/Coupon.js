import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
    code: { type: String, unique: true, uppercase: true, required: true },
    discountPercentage: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
    minOrderValue: { type: Number, default: 0 }
}, { timestamps: true });

const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);
export default Coupon;
