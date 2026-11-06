import { authorizationService } from '../authorization/AuthorizationService.js';

function sendAuthorizationError(req, res, error) {
  return res.status(error.status || 403).json({
    success: false,
    error: { code: error.code || 'AUTHORIZATION_FAILED', message: error.message || 'Access denied.' },
    requestId: req.requestId || req.context?.requestId
  });
}

export function authorize(permission) {
  return async (req, res, next) => {
    try {
      const context = req.authz || await authorizationService.resolve(req.user);
      req.authz = context;
      if (!authorizationService.isAllowed(context, permission)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.', permission },
          requestId: req.requestId || req.context?.requestId
        });
      }
      return next();
    } catch (error) {
      return sendAuthorizationError(req, res, error);
    }
  };
}

/**
 * Scope policy for tenant-owned APIs. Platform operators may act across tenants;
 * every other actor must have a resolved active tenant membership.
 */
export function requireTenantScope() {
  return async (req, res, next) => {
    try {
      const context = req.authz || await authorizationService.resolve(req.user);
      req.authz = context;
      if (authorizationService.isPlatformContext(context) || context.tenantId) return next();
      return res.status(403).json({
        success: false,
        error: { code: 'TENANT_CONTEXT_REQUIRED', message: 'An active pharmacy tenant context is required.' },
        requestId: req.requestId || req.context?.requestId
      });
    } catch (error) {
      return sendAuthorizationError(req, res, error);
    }
  };
}

export async function resolveAuthorization(req, res, next) {
  try {
    req.authz = await authorizationService.resolve(req.user);
    return next();
  } catch (error) {
    return sendAuthorizationError(req, res, error);
  }
}
