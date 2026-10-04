/**
 * Platform Super Admin Tenant Management Routes (/api/v1/admin/tenants)
 * Strictly restricted to platform Super Administrators.
 */
import express from 'express';
import { authenticateUser, requireSuperAdmin } from '../../middleware/auth.js';
import { tenantService } from '../../services/tenant-service/TenantService.js';
import { supabase } from '../../config/supabase.js';

const router = express.Router();

// Enforce authentication & Platform Super Admin role across all endpoints in this router
router.use(authenticateUser, requireSuperAdmin);

/**
 * GET /api/v1/admin/tenants
 * List all tenants on the platform with optional status filter
 */
router.get('/', async (req, res, next) => {
    try {
        const filter = {};
        if (req.query.status) {
            filter.status = req.query.status.toUpperCase();
        }
        const tenants = await tenantService.getTenants(filter);
        res.json({
            success: true,
            data: tenants,
            count: tenants.length
        });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/v1/admin/tenants
 * Onboard a new pharmacy tenant
 */
router.post('/', async (req, res, next) => {
    try {
        const { name, slug, legalName, contactEmail, contactPhone, timezone, currency, settings } = req.body;
        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_INPUT', message: 'Tenant name is required.' }
            });
        }

        const newTenant = await tenantService.createTenant({
            name,
            slug,
            legalName,
            contactEmail,
            contactPhone,
            timezone,
            currency,
            settings
        }, req.context);

        res.status(201).json({
            success: true,
            data: newTenant,
            message: `Tenant "${newTenant.name}" onboarded successfully.`
        });
    } catch (err) {
        if (err.message?.includes('already in use')) {
            return res.status(409).json({
                success: false,
                error: { code: 'SLUG_CONFLICT', message: err.message }
            });
        }
        next(err);
    }
});

/**
 * GET /api/v1/admin/tenants/:tenantId
 * Retrieve detailed tenant information and branch listings
 */
router.get('/:tenantId', async (req, res, next) => {
    try {
        const tenant = await tenantService.getTenantById(req.params.tenantId);
        if (!tenant) {
            return res.status(404).json({
                success: false,
                error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' }
            });
        }

        const branches = await tenantService.getBranches(tenant.id);
        const memberships = await tenantService.getMembershipsForTenant(tenant.id);

        res.json({
            success: true,
            data: {
                ...tenant,
                branches,
                memberships
            }
        });
    } catch (err) {
        next(err);
    }
});

/**
 * PATCH /api/v1/admin/tenants/:tenantId
 * Update tenant profile or settings
 */
router.patch('/:tenantId', async (req, res, next) => {
    try {
        const updated = await tenantService.updateTenant(req.params.tenantId, req.body, req.context);
        res.json({
            success: true,
            data: updated,
            message: 'Tenant updated successfully.'
        });
    } catch (err) {
        if (err.message === 'Tenant not found') {
            return res.status(404).json({
                success: false,
                error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' }
            });
        }
        if (err.message?.includes('already in use')) {
            return res.status(409).json({
                success: false,
                error: { code: 'SLUG_CONFLICT', message: err.message }
            });
        }
        next(err);
    }
});

/**
 * POST /api/v1/admin/tenants/:tenantId/suspend
 * Suspend tenant access across all services
 */
router.post('/:tenantId/suspend', async (req, res, next) => {
    try {
        const suspended = await tenantService.suspendTenant(req.params.tenantId, req.context);
        res.json({
            success: true,
            data: suspended,
            message: `Tenant "${suspended.name}" has been suspended.`
        });
    } catch (err) {
        if (err.message === 'Tenant not found') {
            return res.status(404).json({
                success: false,
                error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' }
            });
        }
        next(err);
    }
});

/**
 * POST /api/v1/admin/tenants/:tenantId/activate
 * Re-activate a previously suspended tenant
 */
router.post('/:tenantId/activate', async (req, res, next) => {
    try {
        const activated = await tenantService.activateTenant(req.params.tenantId, req.context);
        res.json({
            success: true,
            data: activated,
            message: `Tenant "${activated.name}" is now active.`
        });
    } catch (err) {
        if (err.message === 'Tenant not found') {
            return res.status(404).json({
                success: false,
                error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' }
            });
        }
        next(err);
    }
});

/**
 * POST /api/v1/admin/tenants/:tenantId/invite-admin
 * Invite or onboard a tenant administrator
 */
router.post('/:tenantId/invite-admin', async (req, res, next) => {
    try {
        const { email, name, branchId, permissions } = req.body;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_EMAIL', message: 'A valid administrator email is required.' }
            });
        }

        const invite = await tenantService.inviteTenantAdmin(req.params.tenantId, {
            email: email.trim().toLowerCase(),
            name,
            branchId,
            permissions
        }, req.context);

        // If Supabase service role is present, update user's app_metadata if user already exists
        if (supabase?.auth?.admin) {
            try {
                const { data: usersData } = await supabase.auth.admin.listUsers();
                const existingUser = usersData?.users?.find(u => u.email?.toLowerCase() === email.trim().toLowerCase());
                if (existingUser) {
                    await supabase.auth.admin.updateUserById(existingUser.id, {
                        app_metadata: {
                            ...existingUser.app_metadata,
                            role: 'TENANT_ADMIN',
                            tenantId: req.params.tenantId
                        }
                    });
                }
            } catch (supaErr) {
                console.warn('Could not auto-sync Supabase user metadata during tenant admin invite:', supaErr.message);
            }
        }

        res.status(201).json({
            success: true,
            data: invite,
            message: `Tenant admin invitation issued to ${email.trim()}.`
        });
    } catch (err) {
        if (err.message === 'Tenant not found') {
            return res.status(404).json({
                success: false,
                error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' }
            });
        }
        next(err);
    }
});

export default router;
