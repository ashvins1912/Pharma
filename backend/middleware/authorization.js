import { authorizationService } from '../authorization/AuthorizationService.js';

export function authorize(permission) {
  return async (req, res, next) => {
    try {
      const context = req.authz || await authorizationService.resolve(req.user);
      req.authz = context;
      if (!authorizationService.isAllowed(context, permission)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: `Permission required: ${permission}` },
          requestId: req.requestId || req.context?.requestId
        });
      }
      return next();
    } catch (error) {
      return res.status(error.status || 403).json({
        success: false,
        error: { code: error.code || 'AUTHORIZATION_FAILED', message: error.message || 'Access denied.' },
        requestId: req.requestId || req.context?.requestId
      });
    }
  };
}

export async function resolveAuthorization(req, res, next) {
  try {
    req.authz = await authorizationService.resolve(req.user);
    return next();
  } catch (error) {
    return res.status(error.status || 403).json({
      success: false,
      error: { code: error.code || 'AUTHORIZATION_FAILED', message: error.message || 'Access denied.' },
      requestId: req.requestId || req.context?.requestId
    });
  }
}
