const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    items: Array,
    subtotal: Number,
    discountApplied: { type: Number, default: 0 },
    finalTotal: Number,
    deliveryAddress: { type: String, required: true },
    coordinates: {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true }
    },
    orderStatus: { type: String, default: 'Processing Order' },
    deliveryPersonMobile: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);
