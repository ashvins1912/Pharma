import express from 'express';
import jwt from 'jsonwebtoken';
import { authenticateUser } from '../middleware/auth.js';
import { resolveUserContext } from '../middleware/context.js';
import { env } from '../config/env.js';

const router = express.Router();
const secret = env.GATEWAY_AUTH_SECRET || '';
const issuer = process.env.SERVICE_JWT_ISSUER || 'ashvin-pharmacy';

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
        if (typeof req.user?.sub !== 'string' || !req.user.sub) {
            return res.status(401).json({ message: 'Authenticated user identity is invalid.' });
        }

        resolveUserContext(req);
        const requestedTenantId = req.get('x-tenant-id') || null;
        const requestedBranchId = req.get('x-branch-id') || null;
        const context = req.context || {};

        if (
            context.tenantMismatch
            || (
                context.authorizedTenantId
                && context.tenantId
                && context.authorizedTenantId !== context.tenantId
                && !context.isPlatformUser
            )
        ) {
            return res.status(403).json({ message: 'Cross-tenant access forbidden.' });
        }

        if (
            requestedBranchId
            && context.tenantMembership?.branchId
            && requestedBranchId !== context.tenantMembership.branchId
            && !context.isPlatformUser
        ) {
            return res.status(403).json({ message: 'Branch access forbidden.' });
        }

        return res.json({
            user: {
                sub: req.user.sub,
                email: req.user.email || '',
                app_metadata: req.user.app_metadata || {},
                user_metadata: req.user.user_metadata || {},
                aal: req.user.aal || 'aal1',
                tenantId: context.tenantId || requestedTenantId || null,
                branchId: context.branchId || requestedBranchId || null,
                authorizedTenantId: context.authorizedTenantId || null,
                isPlatformUser: Boolean(context.isPlatformUser)
            }
        });
    })).catch(next);
});

export default router;
