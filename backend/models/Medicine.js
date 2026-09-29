const mongoose = require('mongoose');

const medicineSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    brand: { type: String, required: true },
    composition: { type: String, default: "Active Compound" },
    price: { type: Number, required: true },
    quantity: { type: Number, default: 0 },
    expiryDate: { type: Date, required: true },
    requiresPrescription: { type: Boolean, default: false },
    imageUrl: { type: String, default: "https://placehold.co" }
});

module.exports = mongoose.model('Medicine', medicineSchema);
