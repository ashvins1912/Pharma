import jwt from 'jsonwebtoken';
import { config } from './config.js';

const callerScopes = {
  'order-service': new Set(['inventory.read', 'inventory.reserve', 'inventory.release', 'inventory.deduct']),
  'medicine-request-service': new Set(['inventory.read']),
  'backend-platform': new Set(['inventory.read', 'inventory.adjust']),
  'api-gateway': new Set(['inventory.read', 'inventory.import', 'inventory.adjust'])
};

export function createServiceToken({ caller, scopes, expiresInSeconds = 60, userId }) {
  const allowedScopes = callerScopes[caller];
  if (!allowedScopes || !Array.isArray(scopes) || scopes.some(scope => !allowedScopes.has(scope))) {
    throw new Error('Caller is not permitted to request one or more Inventory scopes.');
  }
  return jwt.sign({ scope: scopes.join(' '), userId }, config.serviceAuthSecret, {
    algorithm: 'HS256',
    subject: caller,
    issuer: config.serviceJwtIssuer,
    audience: config.serviceJwtAudience,
    expiresIn: Math.min(Math.max(expiresInSeconds, 1), 300)
  });
}

export function requireServiceScope(scope) {
  return (req, res, next) => {
    const authorization = req.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Service authentication is required.' });
    }
    try {
      const payload = jwt.verify(authorization.slice(7), config.serviceAuthSecret, {
        algorithms: ['HS256'],
        issuer: config.serviceJwtIssuer,
        audience: config.serviceJwtAudience
      });
      const caller = payload.sub;
      const allowedScopes = callerScopes[caller];
      const grantedScopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
      if (!allowedScopes || !allowedScopes.has(scope) || !grantedScopes.includes(scope)) {
        return res.status(403).json({ message: 'Service identity is not authorized for this operation.' });
      }
      req.service = { name: caller, scopes: grantedScopes, userId: payload.userId };
      return next();
    } catch {
      return res.status(401).json({ message: 'Service credential is invalid or expired.' });
    }
  };
}
