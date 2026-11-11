import { useAuth } from '../context/AuthContext';
import { resolveApiCapability } from '../api/apiCapabilities';

/**
 * React capability hook for UI gating and API preflight visibility.
 * apiClient enforces the same capability check before a network request.
 */
export function useApiCapability() {
  const { hasPermission } = useAuth();

  const can = (permission) => hasPermission(permission);

  const canCall = (method, url) => {
    const capability = resolveApiCapability(method, url);
    return !capability || hasPermission(capability.permission);
  };

  return { can, canCall };
}

export default useApiCapability;
