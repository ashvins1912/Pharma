/**
 * API Gateway Auth Identity Route (/api/v1/auth)
 */
import express from 'express';
import { authenticateUser } from '../../middleware/auth.js';
import { tenantService } from '../../services/tenant-service/TenantService.js';
import { isPlatformSuperAdmin } from '../../shared/contracts/index.js';

const router = express.Router();

/**
 * GET /api/v1/auth/me
 * Returns authoritative user identity, resolved platform/tenant role, tenantId, and permissions.
 */
router.get('/me', authenticateUser, async (req, res, next) => {
    try {
        const user = req.user;
        const context = req.context || {};

        const rawRole = user.app_metadata?.role || user.role || 'customer';
        const role = isPlatformSuperAdmin(rawRole) ? 'SUPER_ADMIN' : rawRole;
        const isPlatform = role === 'SUPER_ADMIN';

        let tenantId = isPlatform ? null : (user.app_metadata?.tenantId || context.authorizedTenantId || context.tenantId || null);
        let scope = isPlatform ? 'PLATFORM' : (tenantId ? 'TENANT' : (role === 'CUSTOMER' || role === 'customer' ? 'CUSTOMER' : 'TENANT'));

        // If tenantId exists, fetch tenant summary if possible
        let tenantInfo = null;
        if (tenantId) {
            const tenant = await tenantService.getTenantById(tenantId);
            if (tenant) {
                tenantInfo = {
                    id: tenant.id,
                    name: tenant.name,
                    slug: tenant.slug,
                    status: tenant.status
                };
            }
        }

        // Fetch user memberships across tenants
        const memberships = await tenantService.getMembershipsForUser(user.id || user.sub);

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id || user.sub,
                    email: user.email || '',
                    name: user.user_metadata?.name || user.name || '',
                    role,
                    tenantId,
                    scope,
                    permissions: context.permissions || [],
                    tenant: tenantInfo,
                    memberships: memberships.map(m => ({
                        tenantId: m.tenantId,
                        role: m.role,
                        branchId: m.branchId,
                        status: m.status
                    }))
                }
            }
        });
    } catch (err) {
        next(err);
    }
});

export default router;
