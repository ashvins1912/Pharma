import jwt from 'jsonwebtoken';
import { config } from './config.js';

export function createServiceToken(
  { audience, scope, user, includeCustomerProfile = false },
  gatewayConfig = config
) {
  const userId = typeof user?.sub === 'string' ? user.sub : '';
  if (!userId) throw new Error('Authenticated user identity is required.');
  if (!gatewayConfig.serviceAuthSecret || gatewayConfig.serviceAuthSecret.length < 32) {
    throw new Error('SERVICE_AUTH_SECRET is not configured.');
  }
  const role = user.app_metadata?.role || user.role || 'customer';
  const claims = {
    scope,
    userId,
    userRole: role
  };
  if (includeCustomerProfile) {
    claims.email = typeof user.email === 'string' ? user.email : '';
    claims.customerName = typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : '';
    claims.customerMobile = typeof user.user_metadata?.mobile === 'string' ? user.user_metadata.mobile : '';
  }
  return jwt.sign(claims, gatewayConfig.serviceAuthSecret, {
    algorithm: 'HS256',
    subject: 'api-gateway',
    issuer: gatewayConfig.serviceJwtIssuer,
    audience,
    expiresIn: 60
  });
}

export function createBackendAuthToken(gatewayConfig = config) {
  if (!gatewayConfig.gatewayAuthSecret || gatewayConfig.gatewayAuthSecret.length < 32) {
    throw new Error('GATEWAY_AUTH_SECRET is not configured.');
  }
  return jwt.sign({ scope: 'identity:verify'   }, gatewayConfig.gatewayAuthSecret, {
    algorithm: 'HS256',
    subject: 'api-gateway',
    issuer: gatewayConfig.serviceJwtIssuer,
    audience: 'pharma-backend-auth',
    expiresIn: 30
  });
}


export function createTrustedBackendRequestToken(
    { user, method, path, permission = null, requestId },
    gatewayConfig = config
) {
  if (!gatewayConfig.gatewayAuthSecret ||
      gatewayConfig.gatewayAuthSecret.length < 32) {
    throw new Error('GATEWAY_AUTH_SECRET is not configured.');
  }

  const userId = String(user?.sub || '');
  if (!userId) {
    throw new Error('Authenticated user identity is required.');
  }

  const role = user?.app_metadata?.role || user?.role || 'customer';

  return jwt.sign({
    trust: 'gateway-authenticated-request',
    userId, // User identity is separate from JWT subject
    email: user.email || '',
    name: user.name || '',
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    role,
    roles: user.roles || [role],
    permissions: user.permissions || user.app_metadata?.permissions || [],
    revokedPermissions: user.revokedPermissions || user.app_metadata?.revokedPermissions || [],
    permissionVersion: user.permissionVersion || 1,
    tenantId: user.tenantId || user.app_metadata?.tenantId || null,
    branchId: user.branchId || null,
    scope: user.scope || 'CUSTOMER',
    aal: user.aal || 'aal1',
    permission,
    requestMethod: String(method || 'GET').toUpperCase(),
    requestPath: String(path || '').split('?')[0],
    requestId
  }, gatewayConfig.gatewayAuthSecret, {
    algorithm: 'HS256',
    subject: 'api-gateway',
    issuer: gatewayConfig.serviceJwtIssuer,
    audience: 'pharma-backend-trusted',
    expiresIn: 30
  });
}