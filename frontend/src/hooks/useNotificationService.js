import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import useGlobalStore from '../store/useGlobalStore';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { useToast } from '../context/ToastContext';

export function useNotificationService() {
  const { user, isFullyAuthenticated } = useAuth();
  const { tenantId } = useTenant();
  const { addToast } = useToast();
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

    // Listen for incoming order alerts and notifications tied specifically to the currently selected tenantId
    const handleIncomingOrderAlert = (payload) => {
      console.info('[NotificationService] Received real-time order alert payload:', payload);
      const orderTenantId = payload?.tenantId || payload?.order?.tenantId;

      // Strict Tenant-Level Data Control & Cross-Tenant Privacy:
      // Ignore incoming orders tied to other tenants if tenantId is active.
      if (tenantId && orderTenantId && String(orderTenantId) !== String(tenantId)) {
        return;
      }

      const orderId = payload?.orderId || payload?.order?._id || 'New';
      const title = payload?.title || `New Order #${orderId} Received!`;
      const body = payload?.body || payload?.message || `A new order has been placed and assigned to your pharmacy dispensary.`;

      addNotification({
        id: payload?.id || `ws-order-${Date.now()}`,
        title,
        body,
        type: 'success',
        ...payload
      });

      addToast(`📦 ${title}: ${body}`, 'success');
    };

    socket.on('new_order_alert', handleIncomingOrderAlert);
    socket.on('order_created', handleIncomingOrderAlert);
    socket.on('notification', handleIncomingOrderAlert);
    socket.on('message_alert', handleIncomingOrderAlert);
    socket.on('order_update', handleIncomingOrderAlert);
    socket.on('delivery_status_changed', handleIncomingOrderAlert);

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [isFullyAuthenticated, user, tenantId, addNotification, addToast]);

  return {
    socket: socketRef.current
  };
}

export default useNotificationService;
