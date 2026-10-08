import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
    code: { type: String, unique: true, uppercase: true, trim: true, required: true },
    discountType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
    discountValue: { type: Number, min: 0 },
    minOrderAmount: { type: Number, min: 0, default: 0 },
    expiryDate: { type: Date, default: null },
    usageLimit: { type: Number, min: 0, default: null },
    usageCount: { type: Number, min: 0, default: 0 },
    discountPercentage: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, default: true },
    minOrderValue: { type: Number, default: 0 },

    // Tenant/customer-scoped promotions. A null tenantId is a platform coupon.
    tenantId: { type: String, default: null, index: true },
    customerId: { type: String, default: null, index: true },
    autoApply: { type: Boolean, default: false, index: true },
    promotionLabel: { type: String, default: 'Pharma discount for you', trim: true, maxlength: 120 },
    promotionType: { type: String, enum: ['PUBLIC', 'CUSTOMER_DISCOUNT', 'CUSTOMER_COUPON'], default: 'PUBLIC' }
}, { timestamps: true });

couponSchema.index({ tenantId: 1, customerId: 1, isActive: 1, autoApply: 1 });
couponSchema.index({ tenantId: 1, createdAt: -1 });

const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);
export default Coupon;
