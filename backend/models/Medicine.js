import mongoose from 'mongoose';

const medicineSchema = new mongoose.Schema({
    sku: { type: String, unique: true, sparse: true },
    name: { type: String, required: true },
    brand: { type: String, required: true },
    category: { type: String, default: "General Medicine" },
    description: { type: String, default: "" },
    composition: { type: String, default: "Active Compound" },
    price: { type: Number, required: true },
    quantity: { type: Number, default: 0 },
    batchNumber: { type: String, default: "BATCH-DEFAULT" },
    expiryDate: { type: Date, required: true },
    requiresPrescription: { type: Boolean, default: false },
    imageUrl: { type: String, default: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80" },
    manufacturer: { type: String, default: "Pharma Labs" }
}, { timestamps: true });

const Medicine = mongoose.models.Medicine || mongoose.model('Medicine', medicineSchema);
export default Medicine;
