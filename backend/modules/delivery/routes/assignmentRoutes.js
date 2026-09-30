import express from 'express';
import { authenticateUser, isAdmin } from '../../../middleware/auth.js';
import {
    autoAssignOrder,
    manualAssignOrder,
    getEngineStatus
} from '../controllers/orderAssignmentController.js';

const router = express.Router();

router.use(authenticateUser, isAdmin);

// GET /api/admin/assignment/engine-status - Get active strategies & recent execution logs
router.get('/engine-status', getEngineStatus);

// POST /api/admin/assignment/orders/:orderId/auto-assign - Execute expandable assignment engine
router.post('/orders/:orderId/auto-assign', autoAssignOrder);

// POST /api/admin/assignment/orders/:orderId/manual-assign - Manual override assignment
router.post('/orders/:orderId/manual-assign', manualAssignOrder);

export default router;
