import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const medicineItemSchema = new mongoose.Schema({
    medicineId: { type: mongoose.Schema.Types.Mixed, required: false },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    baseCostPrice: { type: Number, min: 0, default: 0 },
    discountPercentage: { type: Number, min: 0, max: 100, default: 0 },
    marginTier: { type: String, enum: ['LOW', 'MID', 'HIGH'], default: 'LOW' },
    name: { type: String, default: '' },
    sku: { type: String, default: '' }
}, { _id: false });

const orderItemSchema = new mongoose.Schema({
    productId: { type: String, trim: true },
    medicineId: { type: mongoose.Schema.Types.Mixed },
    name: { type: String, trim: true },
    productName: { type: String, trim: true },
    sku: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, min: 0 },
    unitPrice: { type: Number, min: 0 },
    totalPrice: { type: Number, min: 0 }
}, { _id: false, strict: false });

const orderSchema = new mongoose.Schema({
    orderNumber: { type: String, unique: true, sparse: true, default: () => `ORD-${randomUUID()}` },
    customerId: { type: String, index: true },
    riderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Rider', default: null, index: true },
    userId: { type: String, required: true, index: true },
    customerName: { type: String, default: "Valued Customer" },
    customerMobile: { type: String, default: "", index: true },
    customerMobileNormalized: { type: String, default: '', index: true },
    medicineItems: { type: [medicineItemSchema], default: [] },
    items: { type: [orderItemSchema], default: [] },
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
    netProfit: { type: Number, default: 0 },
    netMarginPercentage: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    deliveryCost: { type: Number, default: 0 },
    paymentProcessingFee: { type: Number, default: 0 },
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
    inventoryDeductedAt: { type: Date, default: null },
    deliveryMinutes: { type: Number, default: null },
    systemRating: { type: Number, min: 1, max: 5, default: null },
    postTime: { type: Number, default: 0 },
    ratingPromptPending: { type: Boolean, default: false },
    customerRating: { type: Number, min: 1, max: 5 },
    customerComment: { type: String, maxlength: 1000, default: '' },
    paymentMethod: { type: String, default: "Cash on Delivery (COD)" },
    cashCollectionStatus: {
        type: String,
        enum: ['CASH_RECEIVED', 'CASH_NOT_RECEIVED', 'NOT_APPLICABLE'],
        default: 'NOT_APPLICABLE',
        index: true
    },
    // Only explicit PENDING_DIGITAL records are eligible for customer payment reminders.
    // No default is applied so existing payment behavior and historic orders remain unchanged.
    paymentStatus: {
        type: String,
        enum: ['PENDING', 'PENDING_DIGITAL', 'PAID', 'PARTIALLY_PAID', 'REFUNDED', 'DISPUTED'],
        default: undefined,
        index: true
    },
    amountPaid: { type: Number, min: 0, default: 0 },
    deliveryAttempts: { type: Number, min: 0, default: 0 },
    orderStatus: {
        type: String,
        enum: ['Pending_Review', 'Approved', 'Rejected', 'Processing Order', 'Ready to Dispatch', 'Dispatched', 'Delivered', 'Cancelled', 'pending', 'accepted', 'out_for_delivery', 'delivered', 'cancelled'],
        default: 'Pending_Review',
        index: true
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'out_for_delivery', 'delivered', 'cancelled'],
        default: 'pending',
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
    source: {
        type: String,
        enum: ['WEB', 'MOBILE', 'ADMIN', 'POS', 'ERP', 'PARTNER', 'API', 'MEDICINE_REQUEST', 'DIRECT'],
        default: 'DIRECT'
    },
    medicineRequestId: { type: String, default: null },
    addressId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAddress', default: null },
    deliverySlot: { type: Object, default: null },
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

const normalizedOrderStatus = {
    Pending_Review: 'pending',
    Approved: 'accepted',
    Rejected: 'cancelled',
    'Processing Order': 'accepted',
    'Ready to Dispatch': 'accepted',
    Dispatched: 'out_for_delivery',
    Delivered: 'delivered',
    Cancelled: 'cancelled'
};
orderSchema.pre('validate', function syncOrderStatuses() {
    this.customerMobileNormalized = String(this.customerMobile || '').replace(/\D/g, '');
    if (!this.riderId && mongoose.isValidObjectId(this.rider?.riderId)) {
        this.riderId = this.rider.riderId;
    }
    if (normalizedOrderStatus[this.orderStatus]) {
        this.status = normalizedOrderStatus[this.orderStatus];
    } else if (this.status) {
        this.orderStatus = {
            pending: 'Pending_Review',
            accepted: 'Approved',
            out_for_delivery: 'Dispatched',
            delivered: 'Delivered',
            cancelled: 'Cancelled'
        }[this.status] || this.orderStatus;
    }
});
orderSchema.pre('findOneAndUpdate', function syncUpdatedOrderStatus() {
    const update = this.getUpdate() || {};
    const fields = update.$set || update;
    if (normalizedOrderStatus[fields.orderStatus]) {
        fields.status = normalizedOrderStatus[fields.orderStatus];
    }
    if (fields.customerMobile !== undefined) {
        fields.customerMobileNormalized = String(fields.customerMobile || '').replace(/\D/g, '');
    }
    if (mongoose.isValidObjectId(fields.rider?.riderId)) {
        fields.riderId = fields.rider.riderId;
    }
});

orderSchema.index({ orderStatus: 1, createdAt: -1, _id: -1 });

orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index(
    { medicineRequestId: 1 },
    { unique: true, partialFilterExpression: { medicineRequestId: { $type: 'string' } } }
);

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
export default Order;
