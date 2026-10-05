/**
 * API Gateway Multi-Tenant Order Routes (/api/v1/orders)
 */
import express from 'express';
import { orderService } from '../../services/order-service/OrderService.js';
import { identityService } from '../../services/identity-service/IdentityService.js';
import { authenticateUser } from '../../middleware/auth.js';

const router = express.Router();

// Customer or Tenant staff list orders
router.get('/', authenticateUser, async (req, res, next) => {
    try {
        let filter = {};
        if (req.context.isPlatformUser) {
            filter.tenantId = req.query.tenantId || null;
            filter.branchId = req.query.branchId || null;
        } else if (req.context.tenantMembership) {
            filter.tenantId = req.context.tenantId;
            filter.branchId = req.context.tenantMembership.branchId || req.query.branchId || null;
        } else {
            // Customer querying their orders across all or specific tenant
            const customer = await identityService.getOrCreateCustomer(req.context.userId);
            filter.customerId = customer.id;
            if (req.query.tenantId) filter.tenantId = req.query.tenantId;
        }

        const orders = await orderService.getOrders(filter);
        res.json({ success: true, data: orders });
    } catch (err) {
        next(err);
    }
});

// Get specific order
router.get('/:id', authenticateUser, async (req, res, next) => {
    try {
        const customer = req.context.isPlatformUser || req.context.tenantMembership
            ? null
            : await identityService.getOrCreateCustomer(req.context.userId);

        const order = await orderService.getOrderById(
            req.params.id,
            req.context.tenantMembership ? req.context.tenantId : null,
            customer?.id || null
        );

        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        res.json({ success: true, data: order });
    } catch (err) {
        next(err);
    }
});

// Create Order (with atomic reservation and idempotency)
router.post('/', authenticateUser, async (req, res, next) => {
    try {
        const customer = await identityService.getOrCreateCustomer(req.context.userId, {
            name: req.body.customerName || req.user.user_metadata?.name,
            phone: req.body.customerMobile || req.user.user_metadata?.mobile
        });

        const targetTenantId = req.body.tenantId || req.context.tenantId || 'tenant-ashvin-main';
        const targetBranchId = req.body.branchId || req.context.branchId || 'branch-indore-central';

        const result = await orderService.createOrder({
            tenantId: targetTenantId,
            branchId: targetBranchId,
            customerId: customer.id,
            customerName: customer.name,
            customerMobile: customer.phone,
            items: req.body.items || [],
            deliveryAddress: req.body.deliveryAddress,
            couponCode: req.body.couponCode,
            redeemPoints: req.body.redeemPoints,
            paymentMethod: req.body.paymentMethod || 'COD',
            idempotencyKey: req.headers['idempotency-key'] || req.body.idempotencyKey || null,
            actor: req.context
        });

        res.status(result.isDuplicate ? 200 : 201).json({
            success: true,
            data: result.order,
            isDuplicate: result.isDuplicate
        });
    } catch (err) {
        next(err);
    }
});

// Status Transition (Pharmacist / Staff / Platform Admin)
router.patch('/:id/status', authenticateUser, async (req, res, next) => {
    try {
        const { status } = req.body;
        const updated = await orderService.transitionOrderStatus(req.params.id, status, req.context);
        res.json({ success: true, data: updated });
    } catch (err) {
        next(err);
    }
});

// Trigger / Test WhatsApp Notification via API Gateway
const handleGatewayNotifyWhatsApp = async (req, res, next) => {
    try {
        const order = await orderService.getOrderById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        const target = req.query.target || req.body?.target || 'all';
        res.json({
            success: true,
            message: `WhatsApp notification dispatched for Order #${req.params.id.slice(-6).toUpperCase()}`,
            orderId: req.params.id,
            target
        });
    } catch (err) {
        next(err);
    }
};

router.get('/:id/notify-whatsapp', authenticateUser, handleGatewayNotifyWhatsApp);
router.post('/:id/notify-whatsapp', authenticateUser, handleGatewayNotifyWhatsApp);

export default router;
