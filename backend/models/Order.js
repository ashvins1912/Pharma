import mongoose from 'mongoose';

const medicineItemSchema = new mongoose.Schema({
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    baseCostPrice: { type: Number, min: 0, default: 0 },
    discountPercentage: { type: Number, min: 0, max: 100, default: 0 },
    marginTier: { type: String, enum: ['LOW', 'MID', 'HIGH'], default: 'LOW' },
    name: { type: String, default: '' },
    sku: { type: String, default: '' }
}, { _id: false });

const orderSchema = new mongoose.Schema({
    customerId: { type: String, index: true },
    userId: { type: String, required: true, index: true },
    customerName: { type: String, default: "Valued Customer" },
    customerMobile: { type: String, default: "" },
    medicineItems: { type: [medicineItemSchema], default: [] },
    items: { type: Array, default: [] },
    prescriptionUrl: { type: String, default: null },
    prescriptionRequired: { type: Boolean, default: false },
    couponCode: { type: String, default: null },
    subtotal: { type: Number, min: 0 },
    discountApplied: { type: Number, default: 0 },
    pointsRedeemed: { type: Number, default: 0, min: 0 },
    rewardPointsEarned: { type: Number, default: 0, min: 0 },
    pointsDiscountApplied: { type: Number, default: 0, min: 0 },
    rewardMetrics: {
        totalRevenue: { type: Number, default: 0 },
        totalCostPrice: { type: Number, default: 0 },
        netProfit: { type: Number, default: 0 },
        netMarginPercentage: { type: Number, default: 0 }
    },
    deliveryFee: { type: Number, default: 0 },
    totalAmount: { type: Number, min: 0 },
    finalTotal: { type: Number, min: 0 },
    deliveryAddress: { type: String, required: true },
    addressDetails: { type: Object, default: {} },
    coordinates: {
        lat: Number,
        lng: Number
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [lng, lat]
            default: [77.5946, 12.9716]
        }
    },
    expectedOutForDeliveryAt: { type: Date, default: null },
    outForDeliveryAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    paymentMethod: { type: String, default: "Cash on Delivery (COD)" },
    orderStatus: {
        type: String,
        enum: ['Pending_Review', 'Approved', 'Rejected', 'Processing Order', 'Ready to Dispatch', 'Dispatched', 'Delivered', 'Cancelled'],
        default: 'Pending_Review',
        index: true
    },
    assignmentType: {
        type: String,
        enum: ['Manual', 'Auto', 'Unassigned'],
        default: 'Unassigned',
        index: true
    },
    assignmentDetails: {
        strategyUsed: { type: String, default: null },
        note: { type: String, default: null },
        assignedAt: { type: Date, default: null },
        distanceInKm: { type: Number, default: null }
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

orderSchema.index({ orderStatus: 1, createdAt: -1 });

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
export default Order;
