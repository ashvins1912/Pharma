import express from 'express';
import { authenticateUser } from '../../../middleware/auth.js';
import {
    autoAssignOrder,
    manualAssignOrder,
    getEngineStatus
} from '../controllers/orderAssignmentController.js';

const router = express.Router();

const TENANT_DISPATCH_ROLES = new Set(['TENANT_OWNER', 'TENANT_ADMIN', 'PHARMACIST', 'PHARMACY_STAFF', 'ORDER_MANAGER', 'DISPATCHER', 'BRANCH_ADMIN']);
router.use(authenticateUser, (req, res, next) => {
    const role = String(req.user?.role || req.user?.app_metadata?.role || '').toUpperCase();
    const tenantId = req.user?.tenantId || req.user?.app_metadata?.tenantId;
    if (['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role)) return next();
    if (TENANT_DISPATCH_ROLES.has(role) && tenantId) return next();
    return res.status(403).json({ code: 'DISPATCH_FORBIDDEN', message: 'An authorized pharmacy tenant context is required.' });
});

// GET /api/admin/assignment/engine-status - Get active strategies & recent execution logs
router.get('/engine-status', getEngineStatus);

// POST /api/admin/assignment/orders/:orderId/auto-assign - Execute expandable assignment engine
router.post('/orders/:orderId/auto-assign', autoAssignOrder);

// POST /api/admin/assignment/orders/:orderId/manual-assign - Manual override assignment
router.post('/orders/:orderId/manual-assign', manualAssignOrder);

export default router;
