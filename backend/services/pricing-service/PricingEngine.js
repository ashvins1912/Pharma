/**
 * Authoritative Server-Side Pricing Engine with Stacking Rule Validation
 */
import { catalogService } from '../catalog-service/CatalogService.js';
import { tenantService } from '../tenant-service/TenantService.js';
import { identityService } from '../identity-service/IdentityService.js';
import {
    InvalidCouponError,
    StackingRuleViolationError
} from '../../shared/errors/DomainErrors.js';

export class PricingEngine {
    constructor() {
        this.coupons = new Map(); // code -> Coupon
        this.offers = new Map(); // offerId -> Offer
        this._seedCoupons();
    }

    _seedCoupons() {
        // Global / Tenant-wide coupon
        this.coupons.set('HEALTH20', {
            id: 'coup-health20',
            tenantId: 'tenant-ashvin-main',
            branchId: null,
            code: 'HEALTH20',
            discountType: 'PERCENTAGE',
            discountValue: 20, // 20%
            customerId: null,
            minimumOrderValue: 299,
            maximumDiscount: 150,
            validUntil: '2028-12-31',
            status: 'ACTIVE'
        });

        // Fixed discount coupon
        this.coupons.set('FLAT50', {
            id: 'coup-flat50',
            tenantId: 'tenant-ashvin-main',
            branchId: null,
            code: 'FLAT50',
            discountType: 'FIXED',
            discountValue: 50,
            customerId: null,
            minimumOrderValue: 249,
            maximumDiscount: 50,
            validUntil: '2028-12-31',
            status: 'ACTIVE'
        });

        // Customer-specific coupon (Exclusive for Demo Customer)
        this.coupons.set('VIP100', {
            id: 'coup-vip100',
            tenantId: 'tenant-ashvin-main',
            branchId: null,
            code: 'VIP100',
            discountType: 'FIXED',
            discountValue: 100,
            customerId: 'cust-demo-ashvin',
            minimumOrderValue: 400,
            maximumDiscount: 100,
            validUntil: '2028-12-31',
            status: 'ACTIVE'
        });

        // Tenant 2 (MedPlus) coupon with stacking restrictions
        this.coupons.set('MEDPLUS10', {
            id: 'coup-medplus10',
            tenantId: 'tenant-medplus-partner',
            branchId: null,
            code: 'MEDPLUS10',
            discountType: 'PERCENTAGE',
            discountValue: 10,
            customerId: null,
            minimumOrderValue: 100,
            maximumDiscount: 100,
            validUntil: '2028-12-31',
            status: 'ACTIVE'
        });
    }

    async calculateOrderPricing({
        tenantId,
        branchId,
        customerId = null,
        items = [],
        couponCode = null,
        redeemPoints = 0,
        deliveryFee = 0
    }) {
        const tenant = await tenantService.getTenantById(tenantId);
        const branch = await tenantService.getBranchById(branchId);
        const stackingSettings = tenant?.settings || {
            allowOfferWithCoupon: false,
            allowCouponWithRewards: true,
            allowOfferWithRewards: false
        };

        let subtotal = 0;
        let totalMrp = 0;
        const itemSnapshots = [];

        // 1. Calculate base prices from Branch Listings
        for (const item of items) {
            const listKey = `${tenantId}:${branchId}:${item.productId}`;
            const listing = catalogService.listings.get(listKey);
            const product = await catalogService.getProductById(item.productId);

            const mrp = Number(listing?.mrp || product?.price || 50);
            const sellingPrice = Number(listing?.sellingPrice || mrp);
            const quantity = Math.max(1, Number(item.quantity) || 1);
            const lineSubtotal = Math.round(sellingPrice * quantity * 100) / 100;
            const lineMrp = Math.round(mrp * quantity * 100) / 100;

            subtotal += lineSubtotal;
            totalMrp += lineMrp;

            itemSnapshots.push({
                productId: item.productId,
                listingId: listing?.id || `list-${item.productId}`,
                name: product?.name || 'Pharmaceutical Item',
                quantity,
                mrpSnapshot: mrp,
                sourceSellingPriceSnapshot: sellingPrice,
                customerPriceSnapshot: sellingPrice,
                discountSnapshot: Math.max(0, mrp - sellingPrice),
                finalUnitPrice: sellingPrice,
                subtotal: lineSubtotal
            });
        }

        subtotal = Math.round(subtotal * 100) / 100;

        // 2. Compute branch automatic offers (e.g. 5% automatic cart discount above 500)
        let offerDiscount = 0;
        let activeOffer = null;
        if (subtotal >= 500) {
            offerDiscount = Math.round(subtotal * 0.05 * 100) / 100; // 5% discount
            activeOffer = { name: 'Super Saver 5% Discount', discountAmount: offerDiscount };
        }

        // 3. Validate & Compute Coupon Discount
        let couponDiscount = 0;
        let activeCoupon = null;

        if (couponCode) {
            const code = String(couponCode).toUpperCase().trim();
            const coupon = this.coupons.get(code);

            if (!coupon || coupon.status !== 'ACTIVE') {
                throw new InvalidCouponError(`Coupon "${code}" is invalid or expired.`);
            }

            if (coupon.tenantId && coupon.tenantId !== tenantId) {
                throw new InvalidCouponError(`Coupon "${code}" is not valid at this pharmacy.`);
            }

            if (coupon.branchId && coupon.branchId !== branchId) {
                throw new InvalidCouponError(`Coupon "${code}" is not valid at this branch.`);
            }

            if (coupon.customerId && coupon.customerId !== customerId) {
                throw new InvalidCouponError(`Coupon "${code}" is an exclusive offer for another customer.`);
            }

            if (subtotal < coupon.minimumOrderValue) {
                throw new InvalidCouponError(
                    `Coupon "${code}" requires a minimum order value of ₹${coupon.minimumOrderValue}. (Current: ₹${subtotal})`
                );
            }

            if (coupon.discountType === 'PERCENTAGE') {
                couponDiscount = Math.round((subtotal * (coupon.discountValue / 100)) * 100) / 100;
                if (coupon.maximumDiscount) {
                    couponDiscount = Math.min(couponDiscount, coupon.maximumDiscount);
                }
            } else {
                couponDiscount = Math.min(coupon.discountValue, subtotal);
            }

            activeCoupon = {
                code: coupon.code,
                discountAmount: couponDiscount
            };
        }

        // 4. Validate & Compute Loyalty Points Redemption
        let rewardsDiscount = 0;
        const pointsRequested = Math.max(0, Math.floor(Number(redeemPoints) || 0));

        if (pointsRequested > 0) {
            if (!customerId) {
                throw new StackingRuleViolationError('Login required to redeem loyalty points.');
            }
            const tenantProfile = await identityService.getTenantProfile(customerId, tenantId);
            const availablePoints = tenantProfile?.loyaltyPointsBalance || 0;

            if (pointsRequested > availablePoints) {
                throw new StackingRuleViolationError(
                    `Insufficient points balance. Requested: ${pointsRequested}, Available: ${availablePoints}.`
                );
            }

            // Conversion rate: 10 points = ₹1
            rewardsDiscount = Math.min(Math.floor(pointsRequested / 10), subtotal);
        }

        // 5. Stacking Rules Enforcement
        if (offerDiscount > 0 && couponDiscount > 0 && !stackingSettings.allowOfferWithCoupon) {
            // Priority: allow coupon if user explicitly applied one, disable automatic offer
            offerDiscount = 0;
            activeOffer = null;
        }

        if (offerDiscount > 0 && rewardsDiscount > 0 && !stackingSettings.allowOfferWithRewards) {
            offerDiscount = 0;
            activeOffer = null;
        }

        if (couponDiscount > 0 && rewardsDiscount > 0 && !stackingSettings.allowCouponWithRewards) {
            throw new StackingRuleViolationError(
                'This pharmacy does not allow combining coupon discounts with reward points on the same order.'
            );
        }

        // Delivery fee calculation based on branch threshold
        let effectiveDeliveryFee = deliveryFee;
        if (branch) {
            if (subtotal >= (branch.freeDeliveryAbove || 499)) {
                effectiveDeliveryFee = 0;
            } else {
                effectiveDeliveryFee = branch.deliveryFee || 30;
            }
        }

        const totalDiscounts = Math.round((offerDiscount + couponDiscount + rewardsDiscount) * 100) / 100;
        const taxableAmount = Math.max(0, subtotal - totalDiscounts);
        const tax = 0; // Medicine pricing in India is MRP-inclusive of GST
        const finalTotal = Math.max(0, Math.round((taxableAmount + effectiveDeliveryFee) * 100) / 100);

        return {
            subtotal,
            totalMrp,
            totalSavings: Math.max(0, totalMrp - finalTotal),
            offerDiscount,
            activeOffer,
            couponDiscount,
            activeCoupon,
            rewardsDiscount,
            pointsRedeemed: rewardsDiscount * 10,
            deliveryFee: effectiveDeliveryFee,
            tax,
            finalTotal,
            itemSnapshots
        };
    }
}

export const pricingEngine = new PricingEngine();
export default pricingEngine;
