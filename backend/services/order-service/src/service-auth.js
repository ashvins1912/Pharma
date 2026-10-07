import jwt from 'jsonwebtoken';
import { config } from './config.js';

const callerScopes = {
  'api-gateway': new Set(['orders.read', 'orders.create', 'orders.manage'])
};

export function createInventoryToken(scopes, userId) {
  const allowedScopes = new Set(['inventory.read', 'inventory.reserve', 'inventory.release', 'inventory.deduct']);
  if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some(scope => !allowedScopes.has(scope))) {
    throw new Error('Order Service requested an unsupported Inventory scope.');
  }
  return jwt.sign({ scope: scopes.join(' '), userId }, config.serviceAuthSecret, {
    algorithm: 'HS256',
    subject: 'order-service',
    issuer: config.serviceJwtIssuer,
    audience: config.inventoryJwtAudience,
    expiresIn: 60
  });
}

export function requireOrderScope(scope) {
  return (req, res, next) => {
    const authorization = req.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Service authentication is required.' });
    }
    let payload;
    try {
      payload = jwt.verify(authorization.slice(7), config.serviceAuthSecret, {
        algorithms: ['HS256'],
        issuer: config.serviceJwtIssuer,
        audience: config.serviceJwtAudience
      });
    } catch {
      return res.status(401).json({ message: 'Service credential is invalid or expired.' });
    }
    const caller = payload.sub;
    const allowedScopes = callerScopes[caller];
    const grantedScopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
    if (!allowedScopes || !allowedScopes.has(scope) || !grantedScopes.includes(scope)) {
      return res.status(403).json({ message: 'Service identity is not authorized for this operation.' });
    }
    req.service = {
      name: caller,
      scopes: grantedScopes,
      userId: typeof payload.userId === 'string' ? payload.userId : '',
      userRole: typeof payload.userRole === 'string' ? payload.userRole : 'customer',
      email: typeof payload.email === 'string' ? payload.email : '',
      customerName: typeof payload.customerName === 'string' ? payload.customerName : '',
      customerMobile: typeof payload.customerMobile === 'string' ? payload.customerMobile : '',
      tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : null,
      branchId: typeof payload.branchId === 'string' ? payload.branchId : null,
      authorizedTenantId: typeof payload.authorizedTenantId === 'string' ? payload.authorizedTenantId : null,
      isPlatformUser: Boolean(payload.isPlatformUser)
    };
    if (!req.service.userId) return res.status(401).json({ message: 'A trusted user identity is required.' });
    return next();
  };
}
