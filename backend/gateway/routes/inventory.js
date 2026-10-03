/**
 * API Gateway Inventory & Bulk Import Routes (/api/v1/inventory)
 */
import express from 'express';
import { catalogService } from '../../services/catalog-service/CatalogService.js';
import { authenticateUser } from '../../middleware/auth.js';
import { requireTenantScope, requireTenantStaff } from '../../middleware/context.js';

const router = express.Router();

// Get branch inventory
router.get('/', authenticateUser, requireTenantScope, async (req, res, next) => {
    try {
        const branchId = req.query.branchId || req.context.branchId;
        if (!branchId) {
            return res.status(400).json({ success: false, message: 'branchId is required' });
        }
        const inventory = await catalogService.getBranchInventory(req.context.tenantId, branchId);
        res.json({ success: true, data: inventory });
    } catch (err) {
        next(err);
    }
});

// Adjust stock count
router.post('/adjust', authenticateUser, requireTenantScope, requireTenantStaff, async (req, res, next) => {
    try {
        const { branchId, productId, newAvailableQty } = req.body;
        const inv = await catalogService.adjustInventory(
            req.context.tenantId,
            branchId || req.context.branchId,
            productId,
            newAvailableQty,
            req.context
        );
        res.json({ success: true, data: inv });
    } catch (err) {
        next(err);
    }
});

// High-Capacity Bulk Import (>5,000 items)
router.post('/bulk-import', authenticateUser, requireTenantScope, requireTenantStaff, async (req, res, next) => {
    try {
        const { branchId, records } = req.body;
        if (!Array.isArray(records) || !records.length) {
            return res.status(400).json({ success: false, message: 'records array is required' });
        }
        const job = await catalogService.startBulkImport(
            req.context.tenantId,
            branchId || req.context.branchId,
            records,
            req.context
        );
        res.status(202).json({ success: true, data: job });
    } catch (err) {
        next(err);
    }
});

router.get('/bulk-import/:jobId', authenticateUser, requireTenantScope, async (req, res, next) => {
    try {
        const job = await catalogService.getBulkImportJob(req.params.jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Import job not found' });
        res.json({ success: true, data: job });
    } catch (err) {
        next(err);
    }
});

export default router;
