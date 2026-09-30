import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
    code: { type: String, unique: true, uppercase: true, trim: true, required: true },
    discountType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
    discountValue: { type: Number, min: 0 },
    minOrderAmount: { type: Number, min: 0, default: 0 },
    expiryDate: { type: Date, default: null },
    usageLimit: { type: Number, min: 0, default: null },
    usageCount: { type: Number, min: 0, default: 0 },
    discountPercentage: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
    minOrderValue: { type: Number, default: 0 }
}, { timestamps: true });

const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);
export default Coupon;
