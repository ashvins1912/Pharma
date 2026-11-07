/**
 * withTenantSecurity API Middleware
 * Enforces tenantId filtering and validation on database queries and requests
 * to ensure strict data isolation and cross-tenant privacy.
 */
export function withTenantSecurity(req, res, next) {
  try {
    const headerTenantId = req.headers['x-tenant-id'];
    const userTenantId = req.user?.tenantId || req.user?.app_metadata?.tenantId;
    const role = req.user?.app_metadata?.role || req.user?.role;
    const isPlatformAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'PLATFORM_ADMIN';

    // If tenant user attempts to access or modify data outside their assigned tenant, block with 403
    if (!isPlatformAdmin && userTenantId && headerTenantId && String(headerTenantId) !== String(userTenantId)) {
      return res.status(403).json({
        success: false,
        error: 'Cross-tenant access violation: Tenant ID mismatch.'
      });
    }

    const resolvedTenantId = headerTenantId || userTenantId || null;

    // Attach tenant security context and query enforcer helper
    req.tenantSecurity = {
      tenantId: resolvedTenantId,
      isPlatformAdmin,
      enforceTenantFilter: (query = {}) => {
        if (resolvedTenantId && !isPlatformAdmin) {
          return { ...query, tenantId: resolvedTenantId };
        }
        return query;
      }
    };

    return next();
  } catch (err) {
    console.error('Tenant security middleware error:', err);
    return res.status(500).json({ success: false, error: 'Tenant security middleware error: ' + err.message });
  }
}

export default withTenantSecurity;
