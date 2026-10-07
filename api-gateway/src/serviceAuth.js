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
    userRole: role,
    tenantId: typeof user?.tenantId === 'string' ? user.tenantId : null,
    branchId: typeof user?.branchId === 'string' ? user.branchId : null,
    authorizedTenantId: typeof user?.authorizedTenantId === 'string' ? user.authorizedTenantId : null,
    isPlatformUser: Boolean(user?.isPlatformUser)
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
