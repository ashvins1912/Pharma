import mongoose from 'mongoose';

const pricingSchema = new mongoose.Schema({
    basePrice: { type: Number, required: true, min: 0 },
    currentPrice: { type: Number, required: true, min: 0 },
    baseCostPrice: { type: Number, required: true, min: 0 },
    discountPercentage: { type: Number, default: 0, min: 0, max: 100 },
    marginTier: { type: String, enum: ['LOW', 'MID', 'HIGH'], default: 'LOW' },
    priceTier: { type: String, enum: ['LOW', 'MID', 'HIGH'], default: 'MID' },
    isPriceSensitive: { type: Boolean, default: false }
}, { _id: false });

const analyticsSchema = new mongoose.Schema({
    ordersLast7Days: { type: Number, default: 0, min: 0 },
    ordersLast30Days: { type: Number, default: 0, min: 0 },
    searchImpressionsLast7Days: { type: Number, default: 0, min: 0 },
    searchImpressionsCount: { type: Number, default: 0, min: 0 },
    searchMomentum: { type: Number, default: 0, min: 0, max: 1 },
    velocityScore: { type: Number, default: 0, min: 0, max: 1 }
}, { _id: false });

const medicineDataMartSchema = new mongoose.Schema({
    skuId: { type: String, required: true, trim: true, uppercase: true, unique: true },
    sourceMedicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine' },
    name: { type: String, required: true, trim: true },
    manufacturer: { type: String, required: true, trim: true },
    composition: { type: [String], default: [] },
    imageUrl: { type: String, required: true },

    therapeuticCategory: { type: String, required: true, index: true },
    subCategory: { type: String, default: 'Unclassified', index: true },
    isRxRequired: { type: Boolean, default: false, index: true },

    pricing: { type: pricingSchema, required: true },
    analytics: { type: analyticsSchema, default: () => ({}) },

    frequentPurchasePairs: { type: [String], default: [] },
    popularitySegment: {
        type: String,
        enum: ['HYPER_VELOCITY', 'STEADY_DEMAND', 'LOW_VELOCITY'],
        default: 'LOW_VELOCITY',
        index: true
    },
    availableQuantity: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
    refreshId: { type: String, required: true },
    metricsComputedAt: { type: Date, required: true }
}, { timestamps: true, collection: 'medicine_data_mart' });

medicineDataMartSchema.index({ isActive: 1, therapeuticCategory: 1, 'analytics.velocityScore': -1 });
medicineDataMartSchema.index({ isActive: 1, therapeuticCategory: 1, 'pricing.priceTier': 1 });
medicineDataMartSchema.index({ isActive: 1, therapeuticCategory: 1, subCategory: 1 });
medicineDataMartSchema.index({ frequentPurchasePairs: 1, isActive: 1 });
medicineDataMartSchema.index(
    { name: 'text', manufacturer: 'text', composition: 'text' },
    { weights: { name: 10, composition: 5, manufacturer: 2 }, name: 'medicine_discovery_text' }
);

export const MedicineDataMart = mongoose.models.MedicineDataMart
    || mongoose.model('MedicineDataMart', medicineDataMartSchema);

export default MedicineDataMart;
