import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    customerName: { type: String, default: "Valued Customer" },
    customerMobile: { type: String, default: "" },
    items: Array,
    subtotal: { type: Number, required: true },
    discountApplied: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    finalTotal: { type: Number, required: true },
    deliveryAddress: { type: String, required: true },
    addressDetails: { type: Object, default: {} },
    coordinates: {
        lat: { type: Number, default: 12.9716 },
        lng: { type: Number, default: 77.5946 }
    },
    paymentMethod: { type: String, default: "Cash on Delivery (COD)" },
    orderStatus: {
        type: String,
        enum: ['Processing Order', 'Ready to Dispatch', 'Dispatched', 'Delivered', 'Cancelled'],
        default: 'Processing Order'
    },
    rider: {
        riderId: String,
        riderName: String,
        riderMobile: String,
        assignedAt: Date
    },
    deliveryPersonMobile: { type: String, default: null },
    statusHistory: [
        {
            previousStatus: String,
            newStatus: String,
            changedBy: String,
            timestamp: { type: Date, default: Date.now },
            notes: String
        }
    ]
}, { timestamps: true });

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
export default Order;
