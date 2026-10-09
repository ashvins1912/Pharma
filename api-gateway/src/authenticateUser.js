import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { resolveGatewayCapability, isGatewayPermissionAllowed } from './apiCapabilityRegistry.js';

function getUserToken(req) {
  const authorization = req.get('authorization') || '';
  if (/^Bearer\s+\S+$/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '');
  const accessCookie = (req.get('cookie') || '').split(';').map(value => value.trim())
    .find(value => value.startsWith('access_token='));
  if (!accessCookie) return '';
  try { return decodeURIComponent(accessCookie.slice('access_token='.length)); } catch { return ''; }
}

function normalizeUser(payload) {
  const rawRole = payload.role
    || (Array.isArray(payload.roles) ? payload.roles.find(value => ['SUPER_ADMIN','PLATFORM_SUPER_ADMIN','admin','TENANT_ADMIN','TENANT_OWNER','pharmacy','PHARMACIST','PHARMACY_STAFF','ORDER_MANAGER'].includes(value)) : null)
    || 'customer';
  const role = ['SUPER_ADMIN','PLATFORM_SUPER_ADMIN','admin'].includes(rawRole) ? 'SUPER_ADMIN' : rawRole;
  const roles = Array.isArray(payload.roles) && payload.roles.length
    ? payload.roles.map(value => ['SUPER_ADMIN','PLATFORM_SUPER_ADMIN','admin'].includes(value) ? 'SUPER_ADMIN' : value)
    : [role];
  const permissions = ['SUPER_ADMIN','PLATFORM_SUPER_ADMIN','admin'].includes(rawRole)
    ? ['*']
    : (Array.isArray(payload.permissions) ? payload.permissions : []);
  return {
    sub: payload.sub,
    id: payload.sub,
    email: payload.email || '',
    name: payload.name || '',
    firstName: payload.firstName || '',
    lastName: payload.lastName || '',
    role,
    roles,
    permissions,
    revokedPermissions: Array.isArray(payload.revokedPermissions) ? payload.revokedPermissions : [],
    permissionVersion: Number(payload.permissionVersion || 1),
    tenantId: payload.tenantId || null,
    branchId: payload.branchId || null,
    scope: payload.scope || 'CUSTOMER',
    app_metadata: {
      role,
      tenantId: payload.tenantId || null,
      permissions,
      revokedPermissions: Array.isArray(payload.revokedPermissions) ? payload.revokedPermissions : []
    },
    user_metadata: {
      name: payload.name || '',
      mobile: payload.mobile || '',
      dateOfBirth: payload.dateOfBirth || null,
      gender: payload.gender || null
    },
    aal: payload.aal || 'aal1',
    sessionId: payload.sessionId || null,
    tokenType: payload.token_type,
    accountStatus: payload.accountStatus || 'ACTIVE'
  };
}

export async function authenticateUser(req, res, next, gatewayConfig = config) {
  const userToken = getUserToken(req);
  const hasRefreshCookie = /(?:^|;\s*)refresh_token=/.test(req.get('cookie') || '');
  if (!userToken || userToken === 'undefined' || userToken === 'null') {
    if (hasRefreshCookie) res.set('X-Session-Refreshable', 'true');
    return res.status(401).json({ success: false, error: { code: 'SESSION_REQUIRED', message: 'Authentication session required.' }, requestId: req.requestId });
  }

  try {
    if (!gatewayConfig.pharmaJwtPublicKey) throw Object.assign(new Error('PHARMA_JWT_PUBLIC_KEY is not configured.'), { code: 'GATEWAY_JWT_KEY_MISSING' });
    const payload = jwt.verify(userToken, gatewayConfig.pharmaJwtPublicKey, {
      algorithms: ['RS256'],
      issuer: gatewayConfig.pharmaJwtIssuer,
      audience: gatewayConfig.pharmaJwtAudience
    });

    if (!['pharma_access', 'pharma_onboarding', 'pharma_mfa_challenge'].includes(payload.token_type)
      || typeof payload.sub !== 'string' || !payload.sub) {
      throw Object.assign(new Error('Invalid Pharma token claims.'), { code: 'INVALID_PHARMA_TOKEN' });
    }
    const url = req.originalUrl || req.url || '';
    if (payload.token_type === 'pharma_onboarding'
      && !url.includes('/api/v1/auth/complete-profile')
      && !url.includes('/api/v1/auth/onboarding')
      && !url.includes('/api/v1/auth/logout')) {
      return res.status(403).json({ success: false, error: { code: 'ONBOARDING_SESSION_RESTRICTED', message: 'Onboarding session is restricted to profile completion.' }, requestId: req.requestId });
    }
    if (payload.token_type === 'pharma_mfa_challenge' && !url.includes('/api/v1/auth/mfa/verify')) {
      return res.status(403).json({ success: false, error: { code: 'MFA_SESSION_RESTRICTED', message: 'MFA challenge session is restricted to MFA verification.' }, requestId: req.requestId });
    }
    if (payload.token_type === 'pharma_access' && (payload.accountStatus || 'ACTIVE') !== 'ACTIVE') {
      throw Object.assign(new Error('Inactive account session.'), { code: 'INACTIVE_ACCOUNT' });
    }

    req.user = normalizeUser(payload);
    req.gatewayAuthenticated = true;
    req.gatewayAuthRequestId = req.requestId;
    return next();
  } catch (error) {
    const status = error.code === 'GATEWAY_JWT_KEY_MISSING' ? 503 : 401;
    console.warn(JSON.stringify({
      serviceName: 'api-gateway',
      event: 'authentication_failed',
      requestId: req.requestId,
      correlationId: req.correlationId,
      code: error.code || error.name
    }));
    if (hasRefreshCookie && status === 401) res.set('X-Session-Refreshable', 'true');
    return res.status(status).json({
      success: false,
      error: {
        code: status === 503 ? 'AUTHENTICATION_UNAVAILABLE' : 'INVALID_AUTHENTICATION',
        message: status === 503 ? 'Gateway authentication is not configured.' : 'Authentication token is invalid or expired.'
      },
      requestId: req.requestId
    });
  }
}

export function requireSuperAdmin(req, res, next) {
  const role = req.user?.app_metadata?.role || req.user?.role;
  if (role !== 'SUPER_ADMIN' && role !== 'PLATFORM_SUPER_ADMIN' && role !== 'admin') {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Platform Super Administrator access is required.' }, requestId: req.requestId });
  }
  return next();
}

export function requireAdmin(req, res, next) {
  // This compatibility middleware now honors the route's registered RBAC
  // capability first. Explicit revocations override broad role grants.
  const capability = resolveGatewayCapability(req.method, req.originalUrl || req.url || '');
  if (capability) {
    if (isGatewayPermissionAllowed(req.user, capability)) return next();
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Required API permission is missing.', permission: capability },
      requestId: req.requestId
    });
  }

  const role = req.user?.app_metadata?.role || req.user?.role;
  const allowed = ['admin', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'TENANT_ADMIN', 'TENANT_OWNER'];
  if (!allowed.includes(role)) {
    return res.status(403).json({ success: false, error: { code: 'ADMIN_REQUIRED', message: 'Administrator access is required.' }, requestId: req.requestId });
  }
  return next();
}

export function requireInventoryImportPermission(req, res, next) {
  if (isGatewayPermissionAllowed(req.user, 'inventory.import')) return next();
  return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Inventory import permission required.', permission: 'inventory.import' }, requestId: req.requestId });
}
