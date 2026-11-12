/**
 * API Gateway Delivery & Serviceability Routes (/api/v1/delivery)
 */
import express from 'express';
import { deliveryService } from '../../services/delivery-service/DeliveryService.js';
import { authenticateUser } from '../../middleware/auth.js';
import { requireTenantScope, requireTenantStaff } from '../../middleware/context.js';

const router = express.Router();

// Serviceability check
router.post('/check-serviceability', async (req, res, next) => {
    try {
        const { branchId, coordinates } = req.body;
        const targetBranchId = branchId || req.context?.branchId || 'branch-indore-central';
        const result = await deliveryService.checkServiceability(targetBranchId, coordinates);
        res.json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
});

// List riders for branch
router.get('/riders', authenticateUser, requireTenantScope, async (req, res, next) => {
    try {
        const branchId = req.query.branchId || req.context.branchId;
        const riders = await deliveryService.getBranchRiders(req.context.tenantId, branchId);
        res.json({ success: true, data: riders });
    } catch (err) {
        next(err);
    }
});

// Assign rider to order
router.post('/assign', authenticateUser, requireTenantScope, requireTenantStaff, async (req, res, next) => {
    try {
        const { orderId, riderId, branchId } = req.body;
        const targetBranchId = branchId || req.context.branchId;
        const job = await deliveryService.assignRiderToOrder(
            req.context.tenantId,
            targetBranchId,
            orderId,
            riderId,
            req.context
        );
        res.json({ success: true, data: job });
    } catch (err) {
        next(err);
    }
});

export default router;
