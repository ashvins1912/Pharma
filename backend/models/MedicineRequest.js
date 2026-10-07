import mongoose from 'mongoose';

const requestedItemSchema = new mongoose.Schema({
    requestedName: { type: String, required: true, trim: true },
    medicineId: { type: mongoose.Schema.Types.Mixed, default: null },
    productId: { type: String, default: null },
    strength: { type: String, default: '', trim: true },
    dosageForm: { type: String, default: '', trim: true },
    manufacturer: { type: String, default: '', trim: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    originalAvailabilityStatus: {
        type: String,
        enum: ['NOT_IN_CATALOG', 'OUT_OF_STOCK'],
        default: 'NOT_IN_CATALOG'
    }
}, { _id: false });

const deliverySlotSchema = new mongoose.Schema({
    date: { type: String, default: '' },
    slotType: {
        type: String,
        enum: ['MORNING', 'EVENING', 'NEXT_DAY', 'FLEXIBLE', 'CUSTOM'],
        default: 'FLEXIBLE'
    },
    startTime: { type: String, default: '' },
    endTime: { type: String, default: '' },
    label: { type: String, default: '' }
}, { _id: false });

const pharmacyProposalSchema = new mongoose.Schema({
    productId: { type: String, default: null },
    medicineName: { type: String, default: '', trim: true },
    manufacturer: { type: String, default: '', trim: true },
    strength: { type: String, default: '', trim: true },
    dosageForm: { type: String, default: '', trim: true },
    quantity: { type: Number, default: 1, min: 1 },
    unitPrice: { type: Number, default: 0, min: 0 },
    approximatePrice: { type: Number, default: 0, min: 0 },
    finalPrice: { type: Number, default: null },
    totalPrice: { type: Number, default: 0, min: 0 },
    priceType: {
        type: String,
        enum: ['APPROXIMATE', 'FINAL'],
        default: 'APPROXIMATE'
    },
    pharmacyNote: { type: String, default: '', trim: true },
    deliverySlot: { type: deliverySlotSchema, default: () => ({}) },
    prescriptionStatus: {
        type: String,
        enum: ['Pending Verification', 'Verified', 'Rejected', 'Not Required'],
        default: 'Pending Verification'
    },
    alternativeProduct: { type: String, default: '', trim: true }
}, { _id: false });

const auditTrailSchema = new mongoose.Schema({
    action: { type: String, required: true },
    actorId: { type: String, default: 'System' },
    role: { type: String, default: 'Customer' },
    timestamp: { type: Date, default: Date.now },
    notes: { type: String, default: '' },
    details: { type: Object, default: {} }
}, { _id: false });

const medicineRequestSchema = new mongoose.Schema({
    requestNumber: { type: String, required: true, unique: true, index: true },
    customerId: { type: String, required: true, index: true },
    addressId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAddress', required: true, index: true },
    customerName: { type: String, default: 'Valued Customer' },
    customerPhone: { type: String, default: '' },
    customerEmail: { type: String, default: '' },

    requestedItems: { type: [requestedItemSchema], default: [] },

    prescriptionUrl: { type: String, default: null },
    productImageUrl: { type: String, default: null },

    customerNote: { type: String, default: '', maxlength: 2000 },
    deliveryAddress: { type: String, default: 'Pending address confirmation' },
    addressDetails: { type: Object, default: {} },
    coordinates: {
        lat: Number,
        lng: Number
    },
    preferredDeliveryPreference: {
        type: String,
        enum: ['Morning', 'Evening', 'Next Day', 'Flexible'],
        default: 'Flexible'
    },

    status: {
        type: String,
        enum: [
            'REQUESTED',
            'UNDER_REVIEW',
            'PROPOSAL_SENT',
            'CUSTOMER_APPROVED',
            'CUSTOMER_REJECTED',
            'PHARMACY_REJECTED',
            'EXPIRED',
            'CONVERTED_TO_ORDER',
            'CANCELLED'
        ],
        default: 'REQUESTED',
        index: true
    },

    pharmacyProposal: { type: pharmacyProposalSchema, default: null },

    customerResponse: {
        respondedAt: { type: Date, default: null },
        responseNote: { type: String, default: '' }
    },

    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },

    proposalSentAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: String, default: null },
    rejectedBy: { type: String, default: null },
    rejectedAt: { type: Date, default: null },

    convertedOrderId: { type: mongoose.Schema.Types.Mixed, default: null, index: true },

    expiresAt: { type: Date, default: null, index: true },

    auditTrail: { type: [auditTrailSchema], default: [] }
}, { timestamps: true });

medicineRequestSchema.index({ status: 1, createdAt: -1 });

const MedicineRequest = mongoose.models.MedicineRequest || mongoose.model('MedicineRequest', medicineRequestSchema);
export default MedicineRequest;
