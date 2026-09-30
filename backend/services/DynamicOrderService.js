import Medicine from '../models/Medicine.js';
import Order from '../models/Order.js';
import CustomerPointsLedger from '../models/CustomerPointsLedger.js';
import ProfitMarginRewardEngine from '../strategies/ProfitMarginRewardEngine.js';

export class DynamicOrderService {
    constructor({
        orderModel = Order,
        medicineModel = Medicine,
        pointsLedgerModel = CustomerPointsLedger,
        rewardEngine = new ProfitMarginRewardEngine(),
        couponValidator = async () => ({ valid: true, discountPercentage: 0 })
    } = {}) {
        this.orderModel = orderModel;
        this.medicineModel = medicineModel;
        this.pointsLedgerModel = pointsLedgerModel;
        this.rewardEngine = rewardEngine;
        this.couponValidator = couponValidator;
    }

    async generateDynamicRestockBasket(customerId) {
        if (typeof customerId !== 'string' || !customerId.trim()) {
            throw new TypeError('Authenticated customer ID is required.');
        }
        return this.orderModel.aggregate([
            {
                $match: {
                    $or: [{ customerId }, { userId: customerId }],
                    orderStatus: 'Delivered'
                }
            },
            { $unwind: '$medicineItems' },
            {
                $group: {
                    _id: '$medicineItems.medicineId',
                    skuId: { $first: '$medicineItems.sku' },
                    name: { $first: '$medicineItems.name' },
                    orderCount: { $sum: 1 },
                    totalQuantity: { $sum: '$medicineItems.quantity' },
                    lastOrderedAt: { $max: '$createdAt' }
                }
            },
            { $match: { orderCount: { $gt: 2 } } },
            { $sort: { orderCount: -1, lastOrderedAt: -1, _id: 1 } },
            { $limit: 8 },
            {
                $lookup: {
                    from: this.medicineModel.collection.name,
                    localField: '_id',
                    foreignField: '_id',
                    as: 'medicine'
                }
            },
            { $unwind: { path: '$medicine', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 1,
                    skuId: { $ifNull: ['$medicine.sku', '$skuId'] },
                    name: { $ifNull: ['$medicine.name', '$name'] },
                    imageUrl: '$medicine.imageUrl',
                    price: '$medicine.price',
                    stock: { $ifNull: ['$medicine.stockQuantity', { $ifNull: ['$medicine.stock', '$medicine.quantity'] }] },
                    isPrescriptionRequired: '$medicine.isPrescriptionRequired',
                    orderCount: 1,
                    totalQuantity: 1,
                    lastOrderedAt: 1
                }
            }
        ]).exec();
    }

    async evaluateCheckout(cartItems, customerId, requestedPoints = 0, { session, couponCode } = {}) {
        if (typeof customerId !== 'string' || !customerId.trim()) {
            throw new TypeError('Authenticated customer ID is required.');
        }
        if (!Array.isArray(cartItems) || cartItems.length === 0) {
            throw new TypeError('Basket must contain at least one item.');
        }
        const normalized = new Map();
        for (const item of cartItems) {
            const medicineId = String(item.medicineId || item._id || item.id || '');
            const quantity = Number(item.quantity);
            if (!medicineId || !Number.isInteger(quantity) || quantity < 1) {
                throw new TypeError('Each cart item needs a medicine ID and positive whole-number quantity.');
            }
            normalized.set(medicineId, (normalized.get(medicineId) || 0) + quantity);
        }

        const medicineIds = [...normalized.keys()];
        const query = this.medicineModel.find({ _id: { $in: medicineIds }, isActive: { $ne: false } })
            .select('name sku price baseCostPrice marginTier discountPercentage');
        if (session) query.session(session);
        const medicines = await query.lean().exec();
        if (medicines.length !== medicineIds.length) {
            throw new Error('One or more medicines are no longer available.');
        }

        const pricedItems = medicineIds.map(id => {
            const medicine = medicines.find(item => String(item._id) === id);
            return {
                medicineId: medicine._id,
                skuId: medicine.sku,
                name: medicine.name,
                quantity: normalized.get(id),
                currentPrice: Number(medicine.price),
                baseCostPrice: Number(medicine.baseCostPrice ?? medicine.price),
                marginTier: ['LOW', 'MID', 'HIGH'].includes(medicine.marginTier) ? medicine.marginTier : 'LOW',
                isDiscounted: Number(medicine.discountPercentage || 0) > 0
            };
        });

        const subtotal = pricedItems.reduce((total, item) => total + item.currentPrice * item.quantity, 0);
        const coupon = couponCode
            ? await this.couponValidator(couponCode, subtotal)
            : { valid: true, discountPercentage: 0 };
        if (!coupon.valid) throw new Error(coupon.message || 'Coupon is invalid.');
        const couponRate = Number(coupon.discountPercentage || 0) / 100;
        const rewardItems = pricedItems.map(item => ({
            ...item,
            currentPrice: item.currentPrice * (1 - couponRate),
            isDiscounted: item.isDiscounted || couponRate > 0
        }));

        let ledgerQuery = this.pointsLedgerModel.find({ customerId, accountType: 'CUSTOMER' });
        if (session) ledgerQuery = ledgerQuery.session(session);
        const [ledger] = await ledgerQuery
            .select('availablePointsBalance')
            .limit(1)
            .lean()
            .exec();
        const availablePoints = Number(ledger?.availablePointsBalance || 0);
        const earning = this.rewardEngine.calculateEarnedPoints(rewardItems);
        const redemption = this.rewardEngine.validateRedemptionEligibility(
            rewardItems,
            requestedPoints,
            availablePoints
        );
        return {
            items: pricedItems,
            availablePoints,
            earnedPoints: earning.pointsToAssign,
            revenue: earning.totalRevenue,
            cost: earning.totalCostPrice,
            netProfit: earning.netProfit,
            netMarginPercentage: earning.netMarginPercentage,
            couponDiscount: subtotal - earning.totalRevenue,
            redemptionEligible: redemption.eligible && availablePoints > 0,
            redemptionBlockedReason: redemption.eligible ? null : redemption.reason,
            requestedPoints,
            allowedPoints: redemption.eligible ? redemption.allowedPoints : 0,
            pointsAdjusted: redemption.eligible && redemption.partiallyEligible,
            cashDiscount: redemption.eligible ? redemption.allowedDiscountAmount : 0,
            finalTotal: Math.max(0, earning.totalRevenue - (redemption.eligible ? redemption.allowedDiscountAmount : 0)),
            warning: redemption.reason
        };
    }
}

export default DynamicOrderService;
