/**
 * API Gateway Tenant & Branch Routes (/api/v1/tenants & /api/v1/branches)
 * Integrated with CacheService for high-performance puts/gets, TTL, and auto-reload.
 */
import express from 'express';
import { tenantService } from '../../services/tenant-service/TenantService.js';
import { authenticateUser } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/context.js';
import { PlatformRoles, TenantRoles } from '../../shared/contracts/index.js';
import { cacheService } from '../../services/cache/CacheService.js';

const router = express.Router();
const CACHE_KEY_ALL_BRANCHES = 'cache:tenants:branches:all';
const CACHE_KEY_TENANTS_ACTIVE = 'cache:tenants:active';
const TTL_SECONDS = 900; // 15 minutes TTL

// List all active tenants with Cache put/get
router.get('/', async (req, res, next) => {
    try {
        let tenants = await cacheService.get(CACHE_KEY_TENANTS_ACTIVE);
        if (!tenants) {
            tenants = await tenantService.getTenants({ status: 'ACTIVE' });
            await cacheService.set(CACHE_KEY_TENANTS_ACTIVE, tenants, TTL_SECONDS);
        }
        res.json({ success: true, data: tenants });
    } catch (err) {
        next(err);
    }
});

// List all active branches across tenants with Cache put/get & dynamic proximity/search support
router.get('/branches/all', authenticateUser, requireRoles(PlatformRoles.PLATFORM_SUPER_ADMIN), async (req, res, next) => {
    try {
        let branches = await cacheService.get(CACHE_KEY_ALL_BRANCHES);
        if (!branches) {
            branches = await tenantService.getAllActiveBranches();
            await cacheService.set(CACHE_KEY_ALL_BRANCHES, branches, TTL_SECONDS);
        }
        res.json({ success: true, data: branches });
    } catch (err) {
        next(err);
    }
});

// Get specific tenant
router.get('/:tenantId', async (req, res, next) => {
    try {
        const cacheKey = `cache:tenant:${req.params.tenantId}`;
        let tenant = await cacheService.get(cacheKey);
        if (!tenant) {
            tenant = await tenantService.getTenantById(req.params.tenantId);
            if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
            await cacheService.set(cacheKey, tenant, TTL_SECONDS);
        }
        res.json({ success: true, data: tenant });
    } catch (err) {
        next(err);
    }
});

// Create tenant (Platform Super Admin only) - Invalidates cache
router.post('/', authenticateUser, requireRoles(PlatformRoles.PLATFORM_SUPER_ADMIN), async (req, res, next) => {
    try {
        const created = await tenantService.createTenant(req.body, req.context);
        await cacheService.del(CACHE_KEY_TENANTS_ACTIVE);
        res.status(201).json({ success: true, data: created });
    } catch (err) {
        next(err);
    }
});

// Get branches for a tenant
router.get('/:tenantId/branches', async (req, res, next) => {
    try {
        const cacheKey = `cache:tenant:${req.params.tenantId}:branches:v2`;
        let branches = await cacheService.get(cacheKey);
        if (!branches) {
            branches = await tenantService.getBranches(req.params.tenantId, { status: 'ACTIVE' });
            await cacheService.set(cacheKey, branches, TTL_SECONDS);
        }
        res.json({ success: true, data: branches });
    } catch (err) {
        next(err);
    }
});

// Create a branch under a tenant - Invalids cache
router.post('/:tenantId/branches', authenticateUser, requireRoles(PlatformRoles.PLATFORM_SUPER_ADMIN, TenantRoles.TENANT_OWNER, TenantRoles.TENANT_ADMIN), async (req, res, next) => {
    try {
        if (!req.context?.isPlatformUser && (!req.context?.authorizedTenantId || String(req.context.authorizedTenantId) !== String(req.params.tenantId))) {\n            return res.status(403).json({ success: false, code: 'CROSS_TENANT_BRANCH_ACCESS', message: 'You can only create branches for your authenticated pharmacy.' });\n        }\n        const branch = await tenantService.createBranch(req.params.tenantId, req.body, req.context);
        await cacheService.del(CACHE_KEY_ALL_BRANCHES);
        await cacheService.del(`cache:tenant:${req.params.tenantId}:branches:v2`);
        res.status(201).json({ success: true, data: branch });
    } catch (err) {
        next(err);
    }
});

// Update branch settings - Invalidates cache
router.put('/branches/:branchId', authenticateUser, requireRoles(PlatformRoles.PLATFORM_SUPER_ADMIN, TenantRoles.TENANT_OWNER, TenantRoles.TENANT_ADMIN), async (req, res, next) => {
    try {
        const current = await tenantService.getBranchById(req.params.branchId);
        if (!current) return res.status(404).json({ success: false, code: 'BRANCH_NOT_FOUND', message: 'Branch not found.' });
        if (!req.context?.isPlatformUser && String(req.context?.authorizedTenantId || '') !== String(current.tenantId)) {
            return res.status(403).json({ success: false, code: 'CROSS_TENANT_BRANCH_ACCESS', message: 'You cannot modify a branch outside your pharmacy.' });
        }
        const updated = await tenantService.updateBranch(req.params.branchId, req.body, req.context);
        await cacheService.del(CACHE_KEY_ALL_BRANCHES);
        await cacheService.del(`cache:tenant:${updated.tenantId}:branches:v2`);
        res.json({ success: true, data: updated });
    } catch (err) {
        next(err);
    }
});

router.post('/branches/:branchId/activate', authenticateUser, requireRoles(PlatformRoles.PLATFORM_SUPER_ADMIN, TenantRoles.TENANT_OWNER, TenantRoles.TENANT_ADMIN), async (req, res, next) => {
    try {
        const current = await tenantService.getBranchById(req.params.branchId);
        if (!current) return res.status(404).json({ success: false, code: 'BRANCH_NOT_FOUND', message: 'Branch not found.' });
        const isPlatformUser = Boolean(req.context?.isPlatformUser);
        const authorizedTenantId = String(req.context?.authorizedTenantId || '');
        if (!isPlatformUser && authorizedTenantId !== String(current.tenantId)) {
            return res.status(403).json({ success: false, code: 'CROSS_TENANT_BRANCH_ACCESS', message: 'You cannot activate a branch outside your pharmacy.' });
        }
        const activated = await tenantService.activateBranch(req.params.branchId, current.tenantId, req.context);
        await cacheService.del(CACHE_KEY_ALL_BRANCHES);
        await cacheService.del(`cache:tenant:${current.tenantId}:branches:v2`);
        res.json({ success: true, data: activated });
    } catch (err) {
        next(err);
    }
});

export default router;
