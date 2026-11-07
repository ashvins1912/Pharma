/**
 * API Gateway Branch POS & C-Square Integration Routes (/api/v1/integrations)
 */
import express from 'express';
import { pharmacyIntegrationService } from '../../services/pharmacy-integration-service/PharmacyIntegrationService.js';
import { authenticateUser, requirePermission } from '../../middleware/auth.js';
import { requireTenantScope, requireTenantStaff } from '../../middleware/context.js';

const router = express.Router();

// Get branch integration configuration & status
router.get('/', authenticateUser, requirePermission('csquare.read'), requireTenantScope, requireTenantStaff, async (req, res, next) => {
    try {
        const branchId = req.query.branchId || req.context.branchId || 'branch-indore-central';
        const integration = await pharmacyIntegrationService.getBranchIntegration(
            req.context.tenantId,
            branchId
        );
        res.json({ success: true, data: integration });
    } catch (err) {
        next(err);
    }
});

// Update branch integration settings & credentials
router.put('/', authenticateUser, requirePermission('csquare.manage'), requireTenantScope, requireTenantStaff, async (req, res, next) => {
    try {
        const branchId = req.body.branchId || req.context.branchId || 'branch-indore-central';
        const updated = await pharmacyIntegrationService.updateBranchIntegration(
            req.context.tenantId,
            branchId,
            req.body,
            req.context
        );
        res.json({ success: true, data: updated });
    } catch (err) {
        next(err);
    }
});

// Test connection to external POS / C-Square
router.post('/test-connection', authenticateUser, requirePermission('csquare.manage'), requireTenantScope, requireTenantStaff, async (req, res, next) => {
    try {
        const branchId = req.body.branchId || req.context.branchId || 'branch-indore-central';
        const result = await pharmacyIntegrationService.testConnection(
            req.context.tenantId,
            branchId
        );
        res.json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
});

// Trigger manual sync
router.post('/sync', authenticateUser, requirePermission('csquare.sync'), requireTenantScope, requireTenantStaff, async (req, res, next) => {
    try {
        const branchId = req.body.branchId || req.context.branchId || 'branch-indore-central';
        const result = await pharmacyIntegrationService.triggerSync(
            req.context.tenantId,
            branchId,
            req.body.syncType || 'STOCK',
            req.context
        );
        res.json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
});

export default router;
