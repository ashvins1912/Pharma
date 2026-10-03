/**
 * API Gateway Tenant & Branch Routes (/api/v1/tenants & /api/v1/branches)
 */
import express from 'express';
import { tenantService } from '../../services/tenant-service/TenantService.js';
import { authenticateUser } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/context.js';
import { PlatformRoles, TenantRoles } from '../../shared/contracts/index.js';

const router = express.Router();

// List all active tenants
router.get('/', async (req, res, next) => {
    try {
        const tenants = await tenantService.getTenants({ status: 'ACTIVE' });
        res.json({ success: true, data: tenants });
    } catch (err) {
        next(err);
    }
});

// List all active branches across tenants (for storefront customer selection)
router.get('/branches/all', async (req, res, next) => {
    try {
        const branches = await tenantService.getAllActiveBranches();
        res.json({ success: true, data: branches });
    } catch (err) {
        next(err);
    }
});

// Get specific tenant
router.get('/:tenantId', async (req, res, next) => {
    try {
        const tenant = await tenantService.getTenantById(req.params.tenantId);
        if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
        res.json({ success: true, data: tenant });
    } catch (err) {
        next(err);
    }
});

// Create tenant (Platform Super Admin only)
router.post('/', authenticateUser, requireRoles(PlatformRoles.PLATFORM_SUPER_ADMIN), async (req, res, next) => {
    try {
        const created = await tenantService.createTenant(req.body, req.context);
        res.status(201).json({ success: true, data: created });
    } catch (err) {
        next(err);
    }
});

// Get branches for a tenant
router.get('/:tenantId/branches', async (req, res, next) => {
    try {
        const branches = await tenantService.getBranches(req.params.tenantId, { status: 'ACTIVE' });
        res.json({ success: true, data: branches });
    } catch (err) {
        next(err);
    }
});

// Create a branch under a tenant (Tenant Owner or Platform Admin)
router.post('/:tenantId/branches', authenticateUser, requireRoles(PlatformRoles.PLATFORM_SUPER_ADMIN, TenantRoles.TENANT_OWNER, TenantRoles.TENANT_ADMIN), async (req, res, next) => {
    try {
        const branch = await tenantService.createBranch(req.params.tenantId, req.body, req.context);
        res.status(201).json({ success: true, data: branch });
    } catch (err) {
        next(err);
    }
});

// Update branch settings (delivery radius, fees, etc.)
router.put('/branches/:branchId', authenticateUser, requireRoles(PlatformRoles.PLATFORM_SUPER_ADMIN, TenantRoles.TENANT_OWNER, TenantRoles.TENANT_ADMIN), async (req, res, next) => {
    try {
        const updated = await tenantService.updateBranch(req.params.branchId, req.body, req.context);
        res.json({ success: true, data: updated });
    } catch (err) {
        next(err);
    }
});

export default router;
