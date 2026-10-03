/**
 * API Gateway Authoritative Pricing & Coupon Routes (/api/v1/pricing)
 */
import express from 'express';
import { pricingEngine } from '../../services/pricing-service/PricingEngine.js';

const router = express.Router();

// Authoritative pricing calculation for cart items
router.post('/calculate', async (req, res, next) => {
    try {
        const { tenantId, branchId, customerId, items, couponCode, redeemPoints } = req.body;
        const targetTenantId = tenantId || req.context?.tenantId || 'tenant-ashvin-main';
        const targetBranchId = branchId || req.context?.branchId || 'branch-indore-central';

        const calculation = await pricingEngine.calculateOrderPricing({
            tenantId: targetTenantId,
            branchId: targetBranchId,
            customerId: req.context?.customerId || customerId || null,
            items: items || [],
            couponCode,
            redeemPoints
        });

        res.json({ success: true, data: calculation });
    } catch (err) {
        next(err);
    }
});

// List applicable coupons
router.get('/coupons', async (req, res, next) => {
    try {
        const tenantId = req.query.tenantId || req.context?.tenantId || 'tenant-ashvin-main';
        const list = Array.from(pricingEngine.coupons.values()).filter(c => {
            if (c.status !== 'ACTIVE') return false;
            if (c.tenantId && c.tenantId !== tenantId) return false;
            return true;
        });
        res.json({ success: true, data: list });
    } catch (err) {
        next(err);
    }
});

export default router;
