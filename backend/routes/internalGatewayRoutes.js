import express from 'express';
import jwt from 'jsonwebtoken';
import { authenticateUser } from '../middleware/auth.js';
import { env } from '../config/env.js';
import Tenant from '../models/Tenant.js';
import { getIsConnected } from '../config/db.js';
import tenantService from '../services/tenant-service/TenantService.js';

const router = express.Router();
const secret = env.GATEWAY_AUTH_SECRET || '';
const issuer = process.env.SERVICE_JWT_ISSUER || 'ashvin-pharmacy';


router.post('/validate-tenant-branch', async (req, res) => {
    if (secret.length < 32) return res.status(503).json({ message: 'Gateway authentication is not configured.' });
    const authorization = req.get('x-gateway-authorization') || '';
    if (!authorization.startsWith('Bearer ')) return res.status(401).json({ message: 'Gateway authentication is required.' });

    let payload;
    try {
        payload = jwt.verify(authorization.slice(7), secret, {
            algorithms: ['HS256'],
            issuer,
            audience: 'pharma-backend-auth',
            subject: 'api-gateway'
        });
    } catch {
        return res.status(401).json({ message: 'Gateway credential is invalid or expired.' });
    }
    if (payload.scope !== 'tenant:branch:verify') return res.status(403).json({ message: 'Gateway identity is not authorized for tenant/branch validation.' });

    const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId.trim() : '';
    const branchId = typeof payload.branchId === 'string' ? payload.branchId.trim() : '';
    const userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';
    const role = String(payload.role || '').toUpperCase();
    if (!tenantId || !branchId || !userId || !role) return res.status(400).json({ message: 'User, tenant and branch identity are required.' });

    try {
        let tenant;
        if (getIsConnected()) {
            tenant = await Tenant.findOne({ _id: tenantId, status: 'ACTIVE' }).lean();
        } else if (process.env.NODE_ENV !== 'production') {
            tenant = await tenantService.getTenantById(tenantId);
        } else {
            return res.status(503).json({ message: 'Tenant registry is unavailable; inventory scope cannot be verified.' });
        }
        const branch = await tenantService.getBranchById(branchId);
        if (!tenant || tenant.status !== 'ACTIVE' || !branch || branch.status !== 'ACTIVE' || String(branch.tenantId) !== tenantId) {
            return res.status(404).json({ message: 'Active tenant/branch combination was not found.' });
        }

        const isPlatformUser = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
        if (!isPlatformUser) {
            if (!getIsConnected() && process.env.NODE_ENV === 'production') {
                return res.status(503).json({ message: 'Tenant membership registry is unavailable.' });
            }
            const memberships = await tenantService.getMembershipsForUser(userId);
            const allowed = memberships.some(membership =>
                String(membership.tenantId) === tenantId
                && membership.status === 'ACTIVE'
                && (!membership.branchId || String(membership.branchId) === branchId)
            );
            if (!allowed) return res.status(403).json({ message: 'Active membership for this tenant/branch is required.' });
        }

        return res.json({ valid: true, tenantId, branchId });
    } catch (error) {
        console.error('Internal tenant/branch validation failed:', error.message);
        return res.status(503).json({ message: 'Tenant/branch identity could not be verified.' });
    }
});

router.post('/authenticate', (req, res, next) => {
    if (secret.length < 32) {
        return res.status(503).json({ message: 'Gateway authentication is not configured.' });
    }

    const authorization = req.get('x-gateway-authorization') || '';
    if (!authorization.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Gateway authentication is required.' });
    }

    try {
        const payload = jwt.verify(authorization.slice(7), secret, {
            algorithms: ['HS256'],
            issuer,
            audience: 'pharma-backend-auth',
            subject: 'api-gateway'
        });
        if (payload.scope !== 'identity:verify') {
            return res.status(403).json({ message: 'Gateway identity is not authorized.' });
        }
    } catch {
        return res.status(401).json({ message: 'Gateway credential is invalid or expired.' });
    }

    return Promise.resolve(authenticateUser(req, res, () => {
        const user = req.user;
        if (typeof user?.sub !== 'string' || !user.sub) {
            return res.status(401).json({ message: 'Authenticated user identity is invalid.' });
        }
        return res.json({
            user: {
                sub: user.sub,
                email: user.email || '',
                app_metadata: user.app_metadata || {},
                user_metadata: user.user_metadata || {},
                aal: user.aal || 'aal1'
            }
        });
    }, { allowDirect: true })).catch(next);
});

export default router;
