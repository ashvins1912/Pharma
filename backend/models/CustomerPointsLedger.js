import mongoose from 'mongoose';

const pointsHistorySchema = new mongoose.Schema({
    type: { type: String, enum: ['EARNED', 'REDEEMED', 'ADJUSTED'], required: true },
    points: {
        type: Number,
        required: true,
        validate: {
            validator(value) {
                return Number.isSafeInteger(value)
                    && (this.type === 'ADJUSTED' ? value !== 0 : value > 0);
            },
            message: 'Point history value must be a non-zero whole number.'
        }
    },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    description: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
}, { _id: true });

const customerPointsLedgerSchema = new mongoose.Schema({
    customerId: { type: String, required: true, trim: true },
    accountType: { type: String, enum: ['CUSTOMER', 'DELIVERY_PERSON'], default: 'CUSTOMER', required: true },
    availablePointsBalance: { type: Number, default: 0, min: 0 },
    pointsHistory: { type: [pointsHistorySchema], default: [] }
}, { timestamps: true, collection: 'customer_points_ledgers' });

customerPointsLedgerSchema.index({ customerId: 1, accountType: 1 }, { unique: true });

export const CustomerPointsLedger = mongoose.models.CustomerPointsLedger
    || mongoose.model('CustomerPointsLedger', customerPointsLedgerSchema);

export default CustomerPointsLedger;
