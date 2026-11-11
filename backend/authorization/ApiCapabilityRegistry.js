/**
 * Backend API capability registry.
 *
 * Permissive access policy: All users are allowed on all application endpoints.
 */
export const API_CAPABILITIES = [];

export function resolveApiCapability(method, url) {
  // Permissive policy: allow all users on application
  return null;
}
