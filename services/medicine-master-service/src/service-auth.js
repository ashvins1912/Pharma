import jwt from 'jsonwebtoken';
import { config } from './config.js';

const callerScopes = {
  'api-gateway': new Set(['inventory.catalogue.read', 'inventory.catalogue.import'])
};

export function requireServiceScope(scope) {
  return (req, res, next) => {
    const authorization = req.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) return res.status(401).json({ message: 'Service authentication is required.' });
    try {
      const payload = jwt.verify(authorization.slice(7), config.serviceAuthSecret, {
        algorithms: ['HS256'], issuer: config.serviceJwtIssuer, audience: config.serviceJwtAudience
      });
      const caller = payload.sub;
      const grantedScopes = typeof payload.scope === 'string' ? [...new Set(payload.scope.split(/\\s+/).filter(Boolean))] : [];
      const hasUserContext = typeof payload.userId === 'string' && payload.userId.trim().length > 0
        && typeof payload.userRole === 'string' && payload.userRole.trim().length > 0;
      if (!callerScopes[caller]?.has(scope) || !grantedScopes.includes(scope) || !hasUserContext) {
        return res.status(403).json({ message: 'Service identity is not authorized for this operation.' });
      }
      req.service = {
        name: caller, scopes: grantedScopes, userId: payload.userId,
        userRole: payload.userRole || 'customer', roles: payload.roles || [],
        tenantId: typeof payload.tenantId === 'string' ? payload.tenantId.trim() : null,
        branchId: typeof payload.branchId === 'string' ? payload.branchId.trim() : null,
        isPlatformUser: payload.isPlatformUser === true
      };
      return next();
    } catch {
      return res.status(401).json({ message: 'Service credential is invalid or expired.' });
    }
  };
}
