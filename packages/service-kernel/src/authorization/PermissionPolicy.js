/**
 * Framework-neutral RBAC policy evaluator shared by the API gateway and services.
 * Deny rules are evaluated before platform roles, direct grants or wildcards.
 */
export function isPermissionGranted({
  subject,
  permission,
  aliases = {},
  platformRoles = ['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'ADMIN', 'admin'],
  customerDefaultPermissions = [],
  roleOverrides = {}
} = {}) {
  if (!permission) return false;
  const role = String(subject?.app_metadata?.role || subject?.role || '').toUpperCase();
  const permissions = Array.isArray(subject?.permissions)
    ? subject.permissions
    : (Array.isArray(subject?.app_metadata?.permissions) ? subject.app_metadata.permissions : []);
  const revoked = Array.isArray(subject?.revokedPermissions)
    ? subject.revokedPermissions
    : (Array.isArray(subject?.app_metadata?.revokedPermissions) ? subject.app_metadata.revokedPermissions : []);
  const names = [permission, ...(aliases[permission] || [])];

  if (revoked.some(item => names.some(name =>
    item === name || (item.endsWith('.*') && name.startsWith(item.slice(0, -1)))
  ))) return false;

  if (platformRoles.some(value => String(value).toUpperCase() === role)) return true;
  if ((roleOverrides[role] || []).includes(permission)) return true;
  if (role === 'CUSTOMER' && customerDefaultPermissions.includes(permission)) return true;
  if (permissions.includes('*') || names.some(name => permissions.includes(name))) return true;
  return permissions.some(grant => typeof grant === 'string' && grant.endsWith('.*')
    && names.some(name => name.startsWith(grant.slice(0, -1))));
}
