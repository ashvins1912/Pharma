import { useEffect } from 'react';
import useGlobalStore from '../store/useGlobalStore';
import apiClient from '../api/apiClient';

export function useUserHeartbeat() {
  const isAuthenticated = useGlobalStore((state) => state.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    const interval = window.setInterval(async () => {
      try {
        // Use the canonical client so heartbeat requests follow the same
        // same-origin /api routing, credentials, tracing, and error handling
        // as the rest of the frontend.
        await apiClient.get('/api/health');
      } catch (err) {
        console.warn('[Heartbeat] Server ping failed:', err);
      }
    }, 30000);

    return () => window.clearInterval(interval);
  }, [isAuthenticated]);
}

export default useUserHeartbeat;
