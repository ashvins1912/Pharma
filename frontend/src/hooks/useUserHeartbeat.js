import { useEffect } from 'react';
import useGlobalStore from '../store/useGlobalStore';
import api from '../services/api';

export function useUserHeartbeat() {
  const { isAuthenticated, logout } = useGlobalStore();

  useEffect(() => {
    if (!isAuthenticated) return;

    const interval = setInterval(async () => {
      try {
        await api.get('/api/health');
      } catch (err) {
        console.warn('[Heartbeat] Server ping failed:', err);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isAuthenticated, logout]);
}

export default useUserHeartbeat;
