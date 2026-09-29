import mongoose from 'mongoose';

const medicineSchema = new mongoose.Schema({
    sku: { type: String, unique: true, sparse: true, trim: true, uppercase: true },
    code: { type: String, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true, index: true },
    brand: { type: String, required: true },
    category: { type: String, default: "General Medicine" },
    description: { type: String, default: "" },
    composition: { type: String, default: "Active Compound" },
    price: { type: Number, required: true, min: 0 },
    stockQuantity: { type: Number, min: 0 },
    reservedQuantity: { type: Number, min: 0, default: 0 },
    quantity: { type: Number, min: 0, default: 0 },
    stock: { type: Number, min: 0 },
    batchNumber: { type: String, default: "BATCH-DEFAULT" },
    expiryDate: { type: Date, required: true },
    isPrescriptionRequired: { type: Boolean, default: undefined },
    requiresPrescription: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    imageUrl: { type: String, default: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80" },
    manufacturer: { type: String, default: "Pharma Labs" }
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

medicineSchema.virtual('availableQuantity').get(function () {
    const physicalStock = this.stockQuantity ?? this.stock ?? this.quantity ?? 0;
    return Math.max(0, physicalStock - (this.reservedQuantity || 0));
});

medicineSchema.virtual('stockAvailable').get(function () {
    return this.availableQuantity;
});

medicineSchema.pre('validate', function () {
    if (this.stockQuantity === undefined) {
        this.stockQuantity = this.stock ?? this.quantity ?? 0;
    }
    if (this.isPrescriptionRequired === undefined) {
        this.isPrescriptionRequired = Boolean(this.requiresPrescription);
    }
});

const Medicine = mongoose.models.Medicine || mongoose.model('Medicine', medicineSchema);
export default Medicine;
