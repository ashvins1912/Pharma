import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import useGlobalStore from '../store/useGlobalStore';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';

export function useNotificationService() {
  const { user, isFullyAuthenticated } = useAuth();
  const { tenantId } = useTenant();
  const addNotification = useGlobalStore((state) => state.addNotification);
  const socketRef = useRef(null);

  useEffect(() => {
    const userId = user?.id || user?.sub || user?.supabaseId;
    if (!isFullyAuthenticated || !userId) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    const wsUrl = import.meta.env.VITE_WS_URL || window.location.origin;
    const socket = io(wsUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.info('[NotificationService] Connected to WebSocket real-time engine.');
      // Auto-subscribe to user specific bell room & tenant room
      socket.emit('join_bell_room', { userId, tenantId });
      socket.emit('join_rider_room', userId);
    });

    // Listen for incoming alert payloads
    const handleIncomingAlert = (payload) => {
      console.info('[NotificationService] Received real-time alert payload:', payload);
      addNotification({
        id: payload?.id || `ws-${Date.now()}`,
        title: payload?.title || 'New Live Alert',
        body: payload?.body || payload?.message || 'You have a new real-time system notification.',
        type: payload?.type || 'info',
        ...payload
      });
    };

    socket.on('notification', handleIncomingAlert);
    socket.on('message_alert', handleIncomingAlert);
    socket.on('new_order_alert', handleIncomingAlert);
    socket.on('order_update', handleIncomingAlert);
    socket.on('delivery_status_changed', handleIncomingAlert);

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [isFullyAuthenticated, user, tenantId, addNotification]);

  return {
    socket: socketRef.current
  };
}

export default useNotificationService;
