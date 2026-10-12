import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const useGlobalStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      theme: 'dark',
      circuitBreakerStatus: 'CLOSED', // CLOSED, HALF_OPEN, OPEN
      requestCount: 0,
      errorLogs: [],
      performanceMetrics: [],
      
      setAuth: (user, token) => set({ user, token, isAuthenticated: !!token }),
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
      setTheme: (theme) => set({ theme }),
      setCircuitBreakerStatus: (status) => set({ circuitBreakerStatus: status }),
      incrementRequestCount: () => set((state) => ({ requestCount: state.requestCount + 1 })),
      logError: (error) => set((state) => ({ 
        errorLogs: [{ id: Date.now(), timestamp: new Date().toISOString(), message: error.message || String(error) }, ...state.errorLogs.slice(0, 49)] 
      })),
      clearErrors: () => set({ errorLogs: [] }),
      recordPerformanceMetric: (metric) => set((state) => ({
        performanceMetrics: [{ id: Date.now(), ...metric, timestamp: new Date().toISOString() }, ...state.performanceMetrics.slice(0, 99)]
      })),
      clearPerformanceMetrics: () => set({ performanceMetrics: [] })
    }),
    {
      name: 'mfe-global-store',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

export default useGlobalStore;
