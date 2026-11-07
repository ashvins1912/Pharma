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
      notifications: [],
      unreadNotificationsCount: 0,
      
      setAuth: (user, token) => set({ user, token, isAuthenticated: !!token }),
      logout: () => set({ user: null, token: null, isAuthenticated: false, notifications: [], unreadNotificationsCount: 0 }),
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
      clearPerformanceMetrics: () => set({ performanceMetrics: [] }),

      addNotification: (notification) => set((state) => {
        const newNotif = {
          id: notification.id || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: notification.title || 'Alert',
          message: notification.body || notification.message || '',
          type: notification.type || 'info',
          time: 'Just now',
          read: false,
          createdAt: new Date().toISOString(),
          ...notification
        };
        const updated = [newNotif, ...state.notifications.slice(0, 199)];
        const unreadCount = updated.filter(n => !n.read).length;
        return { notifications: updated, unreadNotificationsCount: unreadCount };
      }),

      markNotificationRead: (id) => set((state) => {
        const updated = state.notifications.map(n => n.id === id ? { ...n, read: true } : n);
        const unreadCount = updated.filter(n => !n.read).length;
        return { notifications: updated, unreadNotificationsCount: unreadCount };
      }),

      clearNotifications: () => set({ notifications: [], unreadNotificationsCount: 0 })
    }),
    {
      name: 'mfe-global-store',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

export default useGlobalStore;
