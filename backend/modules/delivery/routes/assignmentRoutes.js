import express from 'express';
import { authenticateUser, requirePermission } from '../../../middleware/auth.js';
import { requireTenantScope } from '../../../middleware/authorization.js';
import {
    autoAssignOrder,
    manualAssignOrder,
    getEngineStatus
} from '../controllers/orderAssignmentController.js';

const router = express.Router();

// Tenant/platform scope is resolved centrally; endpoint permissions remain explicit.
router.use(authenticateUser, requireTenantScope());

// GET /api/admin/assignment/engine-status - Get active strategies & recent execution logs
router.get('/engine-status', requirePermission('delivery.read'), getEngineStatus);

// POST /api/admin/assignment/orders/:orderId/auto-assign - Execute expandable assignment engine
router.post('/orders/:orderId/auto-assign', requirePermission('delivery.manage'), autoAssignOrder);

// POST /api/admin/assignment/orders/:orderId/manual-assign - Manual override assignment
router.post('/orders/:orderId/manual-assign', requirePermission('delivery.manage'), manualAssignOrder);

export default router;
