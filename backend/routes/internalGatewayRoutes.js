import express from 'express';
import jwt from 'jsonwebtoken';
import { authenticateUser } from '../middleware/auth.js';
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
        const user = req.user;
        if (typeof user?.sub !== 'string' || !user.sub) {
            return res.status(401).json({ message: 'Authenticated user identity is invalid.' });
        }
        return res.json({
            user: {
                sub: user.sub,
                email: user.email || '',
                name: user.name || '',
                firstName: user.firstName || '',
                lastName: user.lastName || '',
                role: user.role || user.app_metadata?.role || 'customer',
                roles: user.roles || [user.role || user.app_metadata?.role || 'customer'],
                permissions: user.permissions || user.app_metadata?.permissions || [],
                permissionVersion: user.permissionVersion || 1,
                tenantId: user.tenantId || user.app_metadata?.tenantId || null,
                branchId: user.branchId || null,
                scope: user.scope || 'CUSTOMER',
                app_metadata: user.app_metadata || {},
                user_metadata: user.user_metadata || {},
                aal: user.aal || 'aal1'
            }
        });
    }, { allowDirect: true })).catch(next);
});

export default router;
