import mongoose from 'mongoose';
import { inventoryClient } from './inventory-client/InventoryClient.js';
import Order from '../models/Order.js';
import CustomerPointsLedger from '../models/CustomerPointsLedger.js';
import ProfitMarginRewardEngine from '../strategies/ProfitMarginRewardEngine.js';
import Tenant from '../models/Tenant.js';
import SurplusSavingsCampaign from '../models/SurplusSavingsCampaign.js';
import SurplusSavingsRedemption from '../models/SurplusSavingsRedemption.js';
import { calculateSurplusUnitDiscount, roundCurrency } from './surplusSavingsPricing.js';

export class DynamicOrderService {
    constructor({
        orderModel = Order,
        inventory = inventoryClient,
        pointsLedgerModel = CustomerPointsLedger,
        rewardEngine = new ProfitMarginRewardEngine(),
        couponValidator = async () => ({ valid: true, discountPercentage: 0 })
    } = {}) {
        this.orderModel = orderModel;
        this.inventoryClient = inventory;
        this.pointsLedgerModel = pointsLedgerModel;
        this.rewardEngine = rewardEngine;
        this.couponValidator = couponValidator;
    }

    async generateDynamicRestockBasket(customerId, { tenantId, branchId } = {}) {
        if (typeof customerId !== 'string' || !customerId.trim()) {
            throw new TypeError('Authenticated customer ID is required.');
        }
        if (!tenantId || !branchId) throw new Error('Select a pharmacy branch to view restock suggestions.');
        const items = await this.orderModel.aggregate([
            {
                $match: {
                    $or: [{ customerId }, { userId: customerId }],
                    orderStatus: 'Delivered',
                    tenantId: String(tenantId),
                    branchId: String(branchId)
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
                $project: {
                    _id: 1,
                    skuId: 1,
                    name: 1,
                    orderCount: 1,
                    totalQuantity: 1,
                    lastOrderedAt: 1
                }
            }
        ]).exec();
        const productIds = items.map(item => String(item._id)).filter(id => mongoose.isValidObjectId(id));
        if (!productIds.length) return [];
        const catalog = await this.inventoryClient.lookup({ productIds, tenantId, branchId, userId: customerId });
        const products = new Map((catalog.items || []).map(product => [String(product.productId), product]));
        return items.map(item => {
            const product = products.get(String(item._id));
            if (!product || Number(product.availableQuantity || 0) <= 0) return null;
            return {
                _id: String(product.productId),
                skuId: product.sku || item.skuId,
                name: product.name || item.name,
                imageUrl: product.imageUrl || '',
                price: product.price,
                stock: product.availableQuantity,
                availableQuantity: product.availableQuantity,
                isPrescriptionRequired: product.requiresPrescription,
                orderCount: item.orderCount,
                totalQuantity: item.totalQuantity,
                lastOrderedAt: item.lastOrderedAt
            };
        }).filter(Boolean);

    }

    async evaluateCheckout(cartItems, customerId, requestedPoints = 0, { session, couponCode, tenantId, branchId } = {}) {
        if (typeof customerId !== 'string' || !customerId.trim()) {
            throw new TypeError('Authenticated customer ID is required.');
        }
        if (!tenantId || !branchId) throw new TypeError('Selected pharmacy tenant and branch are required for checkout pricing.');
        const activeTenant = await Tenant.findOne({ _id: String(tenantId), status: 'ACTIVE' }).select('_id settings.allowOfferWithCoupon settings.allowOfferWithRewards').lean();
        if (!activeTenant) throw new Error('The selected pharmacy is not active.');
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
        const catalog = await this.inventoryClient.lookup({
            productIds: medicineIds, tenantId: String(tenantId), branchId: String(branchId), userId: customerId
        });
        const medicines = catalog.items || [];
        if (medicines.length !== medicineIds.length) {
            throw new Error('One or more medicines are no longer available in the selected pharmacy branch.');
        }

        const pricedItems = medicineIds.map(id => {
            const medicine = medicines.find(item => String(item.productId) === id);
            return {
                medicineId: medicine.productId,
                skuId: medicine.sku,
                name: medicine.name,
                quantity: normalized.get(id),
                currentPrice: Math.round(Number(medicine.price) * (1 - Math.min(100, Math.max(0, Number(medicine.discountPercentage || 0))) / 100) * 100) / 100,
                basePrice: Number(medicine.price),
                discountPercentage: Number(medicine.discountPercentage || 0),
                baseCostPrice: Number(medicine.baseCostPrice > 0 ? medicine.baseCostPrice : medicine.price),
                marginTier: ['LOW', 'MID', 'HIGH'].includes(medicine.marginTier) ? medicine.marginTier : 'LOW',
                isDiscounted: Number(medicine.discountPercentage || 0) > 0,
                availableQuantity: Number(medicine.availableQuantity || 0)
            };
        });

        const insufficient = pricedItems.find(item => item.availableQuantity < item.quantity);
        if (insufficient) throw new Error(`Insufficient available stock for ${insufficient.name}.`);
        const subtotal = pricedItems.reduce((total, item) => total + item.currentPrice * item.quantity, 0);
        let surplusSavingsDiscount = 0;
        const surplusSavings = [];
        const campaignUsage = new Map();
        if (tenantId) {
            const now = new Date();
            const campaigns = await SurplusSavingsCampaign.find({
                tenantId: String(tenantId), status: 'ACTIVE',
                startsAt: { $lte: now }, endsAt: { $gt: now },
                medicineIds: { $in: medicineIds }
            }).lean();
            const redemptions = campaigns.length ? await SurplusSavingsRedemption.find({
                tenantId: String(tenantId), campaignId: { $in: campaigns.map(campaign => campaign._id) }, customerId: String(customerId)
            }).select('campaignId').lean() : [];
            const redeemed = new Set(redemptions.map(item => String(item.campaignId)));
            for (const item of pricedItems) {
                const candidates = campaigns.filter(campaign =>
                    campaign.medicineIds.some(id => String(id) === String(item.medicineId))
                    && subtotal >= Number(campaign.minOrderAmount || 0)
                    && (campaign.usageLimit == null || Number(campaign.usageCount || 0) < Number(campaign.usageLimit))
                    && !redeemed.has(String(campaign._id))
                ).map(campaign => {
                    const discount = calculateSurplusUnitDiscount(item.currentPrice, campaign, campaignUsage.get(String(campaign._id)) || 0, item.quantity);
                    return { campaign, discount };
                }).filter(candidate => candidate.discount > 0).sort((a, b) => b.discount - a.discount);
                if (!candidates.length) continue;
                const { campaign, discount } = candidates[0];
                const applied = roundCurrency(discount * item.quantity);
                item.currentPrice = Math.max(0, Math.round((item.currentPrice - discount) * 100) / 100);
                item.isDiscounted = true;
                surplusSavingsDiscount += applied;
                campaignUsage.set(String(campaign._id), (campaignUsage.get(String(campaign._id)) || 0) + applied);
                surplusSavings.push({ campaignId: String(campaign._id), name: campaign.name, medicineId: String(item.medicineId), discountAmount: applied });
            }
        }
        const couponBaseTotal = Math.max(0, subtotal - surplusSavingsDiscount);
        const coupon = await this.couponValidator(couponCode || '', couponBaseTotal, { customerId, tenantId });
        if (!coupon.valid) throw new Error(coupon.message || 'Coupon is invalid.');
        const tenantSettings = activeTenant;
        if (surplusSavingsDiscount > 0 && coupon.code && tenantSettings?.settings?.allowOfferWithCoupon !== true) {
            throw new Error('This pharmacy does not allow surplus savings to be combined with coupons.');
        }
        if (surplusSavingsDiscount > 0 && Number(requestedPoints) > 0 && tenantSettings?.settings?.allowOfferWithRewards !== true) {
            throw new Error('This pharmacy does not allow Surplus Savings to be combined with reward points.');
        }
        const couponDiscount = Number(coupon.discountAmount ?? (couponBaseTotal * Number(coupon.discountPercentage || 0) / 100));
        const couponRate = couponBaseTotal > 0 ? couponDiscount / couponBaseTotal : 0;
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
            subtotal,
            availablePoints,
            earnedPoints: earning.pointsToAssign,
            revenue: earning.totalRevenue,
            cost: earning.totalCostPrice,
            netProfit: earning.netProfit,
            netMarginPercentage: earning.netMarginPercentage,
            couponCode: coupon.code || couponCode || null,
            couponLabel: coupon.promotionLabel || null,
            couponDiscount,
            surplusSavingsDiscount,
            surplusSavings,
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
