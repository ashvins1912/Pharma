import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import apiClient, { getRuntimeAccessToken } from '../api/apiClient';
import { io } from 'socket.io-client';
import { getCachedPublicCatalog } from '../api/publicCatalogCache.js';
import { normalizeOrdersResponse } from '../api/orderService';
import { applyCouponCode } from '../api/couponService';
import { getCustomerMedicineRequestsPage } from '../api/medicineRequestService';
import { useAuth } from './AuthContext';
import usePersistentState from '../hooks/usePersistentState';
import { useToast } from './ToastContext';
import { useActionLoading, LOADING_ACTIONS } from './LoadingContext';

const AppContext = createContext(null);

const CUSTOMER_CACHE_PREFIX = 'pharma_customer_cache_v1:';
const CACHE_TTL = 5 * 60 * 1000;

export function AppProvider({ children }) {
  const { user, isSuperAdmin, isPharmacyOrAdmin, hasPermission, loading: authLoading, isFullyAuthenticated } = useAuth();
  const { addToast } = useToast();
  const { runAction } = useActionLoading();

  // Catalog State
  const [medicines, setMedicines] = useState([]);
  const [medicinesError, setMedicinesError] = useState('');
  const [loadingMedicines, setLoadingMedicines] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [hideRx, setHideRx] = useState(false);
  const [sortOption, setSortOption] = useState('default'); // 'default', 'price-asc', 'price-desc', 'name-asc'
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(16);
  const [totalPages, setTotalPages] = useState(1);
  const [totalMedicines, setTotalMedicines] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  // Cart & Checkout State
  const [cart, setCart] = useState([]);
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponError, setCouponError] = useState('');
  const [deliveryFee, setDeliveryFee] = useState(0);

  // Address Directory State
  const addressCacheKey = user?.id ? CUSTOMER_CACHE_PREFIX + user.id + ':addresses' : null;
  const [addresses, setAddresses] = usePersistentState(
    addressCacheKey,
    [],
    { storage: 'local', ttl: CACHE_TTL, enabled: Boolean(isFullyAuthenticated && addressCacheKey) }
  );
  const [addressesError, setAddressesError] = useState('');
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const addressLoadSequence = useRef(0);

  // Orders & Tracking State
  const [orders, setOrders] = useState([]);
  const [ordersError, setOrdersError] = useState('');
  const [activeTrackingOrder, setActiveTrackingOrder] = useState(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const orderLoadSequence = useRef(0);

  // Medicine Requests & Proposals State
  const [medicineRequests, setMedicineRequests] = useState([]);
  const [medicineRequestsError, setMedicineRequestsError] = useState('');
  const [loadingMedicineRequests, setLoadingMedicineRequests] = useState(false);
  const [medicineRequestsPagination, setMedicineRequestsPagination] = useState({
    page: 1, pageSize: 10, limit: 10, total: 0, totalPages: 0, hasNextPage: false
  });
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestPrefillData, setRequestPrefillData] = useState(null);
  const [requestAuthPending, setRequestAuthPending] = useState(false);
  const [activeProposalRequest, setActiveProposalRequest] = useState(null);
  const previousUserId = useRef(null);
  const medicineRequestLoadSequence = useRef(0);
  const medicineRequestPage = useRef({ page: 1, statusGroup: 'ALL' });

  // Customer Notifications State
  const [realtimeTokenVersion, setRealtimeTokenVersion] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [deliveryEvents, setDeliveryEvents] = useState([]);
  const [realtimeConnectionStatus, setRealtimeConnectionStatus] = useState('offline');
  const notificationLoadSequence = useRef(0);
  const deliveryEventsLoadSequence = useRef(0);

  // Admin Alerts State
  const [inventoryAlerts, setInventoryAlerts] = useState({
    expiredCount: 0,
    expiringSoonCount: 0,
    lowStockCount: 0,
    totalAlerts: 0,
    expired: [],
    expiringSoon: [],
    lowStock: []
  });

  // WhatsApp Gateway State
  const [whatsappStatus, setWhatsappStatus] = useState({
    isConnected: false,
    phone: null,
    deviceName: null,
    qrCode: null,
    expiresAt: null
  });
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);
  const [whatsappWarningActive, setWhatsappWarningActive] = useState(false);
  const whatsappPromiseRef = useRef(null);
  const whatsappLastFetchedRef = useRef(0);
  const whatsappStatusRef = useRef(whatsappStatus);
  whatsappStatusRef.current = whatsappStatus;

  useEffect(() => {
    if (user && hasPermission('whatsapp.read')) return;
    setWhatsappModalOpen(false);
    setWhatsappWarningActive(false);
    setNotifications(prev => prev.filter(notification => !notification.id.startsWith('notif-wa')));
    setWhatsappStatus({
      isConnected: false,
      phone: null,
      deviceName: null,
      qrCode: null,
      expiresAt: null
    });
  }, [user?.id, hasPermission]);

  // Load WhatsApp status with deduplication, throttling, and preference checks
  const loadWhatsAppStatus = useCallback(async ({ force = false } = {}) => {
    if (!isFullyAuthenticated || !hasPermission('whatsapp.read')) return null;

    // Respect user/admin preference unless explicitly forced
    if (!force && typeof window !== 'undefined') {
      const pref = localStorage.getItem('whatsapp_status_preference');
      if (pref === 'not_required') {
        return whatsappStatusRef.current;
      }
      if (pref === 'later') {
        const timeStr = localStorage.getItem('whatsapp_status_preference_time');
        const time = Number(timeStr || 0);
        // Suppress calls for 24 hours when 'later' is selected
        if (Date.now() - time < 24 * 60 * 60 * 1000) {
          return whatsappStatusRef.current;
        }
      }
    }

    // Throttle calls: if already fetched recently (within 45s) and not forced, return cached status
    const now = Date.now();
    if (!force && now - whatsappLastFetchedRef.current < 45000 && whatsappStatusRef.current.phone !== undefined) {
      return whatsappStatusRef.current;
    }

    // Reuse existing in-flight promise to avoid duplicate concurrent calls
    if (whatsappPromiseRef.current) {
      return whatsappPromiseRef.current;
    }

    whatsappPromiseRef.current = (async () => {
      try {
        const res = await apiClient.get('/api/admin/whatsapp/status', { timeout: 30000 });
        if (res.data) {
          setWhatsappStatus(res.data);
          whatsappLastFetchedRef.current = Date.now();
          if (res.data.isConnected) {
            setWhatsappWarningActive(false);
            setNotifications(prev => prev.filter(n => !n.id.startsWith('notif-wa')));
            if (typeof window !== 'undefined') {
              localStorage.setItem('whatsapp_status_preference', 'connected');
            }
          }
          return res.data;
        }
      } catch (err) {
        console.warn("WhatsApp status fetch skipped:", err?.message);
      } finally {
        whatsappPromiseRef.current = null;
      }
      return null;
    })();

    return whatsappPromiseRef.current;
  }, [isFullyAuthenticated, hasPermission]);

  const dismissWhatsAppPrompt = useCallback((mode = 'later') => {
    if (typeof window !== 'undefined') {
      if (mode === 'not_required') {
        localStorage.setItem('whatsapp_status_preference', 'not_required');
      } else {
        localStorage.setItem('whatsapp_status_preference', 'later');
        localStorage.setItem('whatsapp_status_preference_time', String(Date.now()));
      }
    }
    setWhatsappModalOpen(false);
    setWhatsappWarningActive(false);
  }, []);

  const checkWhatsAppBeforeNotification = useCallback(async () => {
    return await loadWhatsAppStatus({ force: true });
  }, [loadWhatsAppStatus]);

  const generateWhatsAppQR = async () => {
    if (!hasPermission('whatsapp.manage')) return null;
    try {
      const res = await apiClient.post('/api/admin/whatsapp/generate-qr', null, { timeout: 45000 });
      if (res.data) {
        setWhatsappStatus(res.data);
        return res.data;
      }
    } catch (err) {
      console.error("WhatsApp generate QR failed:", err);
      throw err;
    }
  };

  const disconnectWhatsApp = async () => {
    if (!hasPermission('whatsapp.manage')) return null;
    try {
      const res = await apiClient.post('/api/admin/whatsapp/disconnect');
      if (res.data?.status) {
        setWhatsappStatus(res.data.status);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('whatsapp_status_preference');
        }
        return res.data.status;
      }
    } catch (err) {
      console.error("WhatsApp disconnect failed:", err);
      throw err;
    }
  };

  const triggerWhatsAppWarningNotification = () => {
    if (!user || !hasPermission('whatsapp.manage')) return;
    setWhatsappWarningActive(true);
    addToast('⚠️ You may miss delivery updates on mobile! WhatsApp is not connected.', 'warning');
  };

  // Reset page to 1 on filter or search changes
  useEffect(() => {
    setPage(1);
  }, [searchQuery, hideRx, selectedCategory, sortOption]);

  // Fetch medicines catalog with pagination
  const fetchMedicines = useCallback(async () => {
    try {
      setLoadingMedicines(true);
      const params = {
        page,
        limit
      };
      if (searchQuery) params.search = searchQuery;
      if (hideRx) params.hideRx = 'true';
      if (selectedCategory && selectedCategory !== 'All') params.category = selectedCategory;
      if (sortOption !== 'default') params.sort = sortOption;

      // Do not automatically replay catalog requests. A 502/503 is an
      // infrastructure signal and a 401/403/404 is an authorization/routing
      // signal; replaying either obscures the real failure and creates duplicate
      // browser traffic. Gateway readiness now protects normal production flow.
      // The storefront catalog is deliberately public and must work before
      // sign-in. Route this read-only request to the public API Gateway origin
      // instead of relying on the static-site /api rewrite (which can return a
      // frontend-host 404). Protected APIs continue using the same-origin client
      // so HttpOnly session cookies remain first-party.
      const publicGatewayBaseUrl = String(
        import.meta.env.VITE_API_GATEWAY_URL
          || (import.meta.env.PROD ? 'https://pharma-api-gateway.onrender.com' : '')
      ).replace(/\/+$/, '');
      const catalogUrl = publicGatewayBaseUrl
        ? `${publicGatewayBaseUrl}/api/medicines`
        : '/api/medicines';
      const res = await getCachedPublicCatalog(apiClient, catalogUrl, params);

      if (res.data && res.data.medicines) {
        setMedicines(res.data.medicines || []);
        setMedicinesError('');
        setTotalMedicines(res.data.total || 0);
        setTotalPages(res.data.totalPages || 1);
        setIsSearching(Boolean(res.data.isSearching));
      } else if (Array.isArray(res.data)) {
        setMedicines(res.data);
        setMedicinesError('');
        setTotalMedicines(res.data.length);
        setTotalPages(1);
        setIsSearching(Boolean(searchQuery));
      }
    } catch (err) {
      console.error("Failed to load catalog:", err);
      setMedicines([]);
      setTotalMedicines(0);
      setTotalPages(1);
      setMedicinesError(err.message || 'The medicine catalog is temporarily unavailable. Please try again.');
    } finally {
      setLoadingMedicines(false);
    }
  }, [searchQuery, hideRx, selectedCategory, sortOption, page, limit]);

  useEffect(() => {
    fetchMedicines();
  }, [fetchMedicines]);

  // Fetch User Addresses
  const loadAddresses = useCallback(async ({ force = false } = {}) => {
    const requestSequence = ++addressLoadSequence.current;
    if (!isFullyAuthenticated) return null;
    if (!force && addressCacheKey) {
      const cached = addresses;
      if (Array.isArray(cached) && cached.length > 0) {
        setAddresses(cached);
        setAddressesError('');
        setSelectedAddressId(currentId => currentId && cached.some(a => a._id === currentId) ? currentId : ((cached.find(a => a.isDefault) || cached[0])?._id || ''));
        return cached;
      }
    }
    try {
      setLoadingAddresses(true);
      setAddressesError('');
      const res = await apiClient.get('/api/user/addresses');
      if (requestSequence === addressLoadSequence.current && Array.isArray(res.data)) {
        const addrs = res.data;
        setAddresses(addrs);
        if (addrs.length > 0) {
          setSelectedAddressId(currentId => {
            if (currentId && addrs.some(address => address._id === currentId)) {
              return currentId;
            }
            const defaultAddr = addrs.find(a => a.isDefault) || addrs[0];
            return defaultAddr?._id || '';
          });
        } else {
          setSelectedAddressId('');
        }
        return addrs;
      }
      throw new Error('Address response was invalid.');
    } catch (err) {
      if (requestSequence !== addressLoadSequence.current) return;
      console.warn("Address directory notice:", err?.message || err);
      setAddressesError('Unable to load your saved addresses right now. Please try again.');
      return null;
    } finally {
      if (requestSequence === addressLoadSequence.current) setLoadingAddresses(false);
    }
  }, [addressCacheKey, isFullyAuthenticated]);

  useEffect(() => {
    if (authLoading) return;

    const currentUserId = user?.id || null;
    if (previousUserId.current !== currentUserId) {
      if (previousUserId.current) {
        addressLoadSequence.current += 1;
        orderLoadSequence.current += 1;
        medicineRequestLoadSequence.current += 1;
        setAddresses([]);
        setAddressesError('');
        setSelectedAddressId('');
        setLoadingAddresses(false);
        setOrders([]);
        setOrdersError('');
        setLoadingOrders(false);
        setNotifications([]);
        setDeliveryEvents([]);
        setRealtimeConnectionStatus('offline');
        notificationLoadSequence.current += 1;
        deliveryEventsLoadSequence.current += 1;
        setMedicineRequests([]);
        setMedicineRequestsError('');
        setMedicineRequestsPagination({ page: 1, pageSize: 10, limit: 10, total: 0, totalPages: 0, hasNextPage: false });
        setLoadingMedicineRequests(false);
        setCart([]);
        setAppliedCoupon(null);
        setCouponCode('');
        setCouponError('');
        setSearchQuery('');
        setSelectedCategory('All');
        setHideRx(false);
        setSortOption('default');
        setPage(1);
        setActiveTrackingOrder(null);
        setActiveProposalRequest(null);
        setRequestModalOpen(false);
        setRequestPrefillData(null);
        setRequestAuthPending(false);
        setNotifications(previous => previous.filter(notification => !notification.id.startsWith('notif-prop-')));
      }
      previousUserId.current = currentUserId;
    }
  }, [user?.id]);

  useEffect(() => {
    if (isFullyAuthenticated && !isSuperAdmin) {
      loadAddresses();
    } else {
      setAddresses([]);
      setAddressesError('');
      setSelectedAddressId('');
    }
  }, [isFullyAuthenticated, isSuperAdmin, loadAddresses]);

  // Fetch Orders
  const loadUserOrders = useCallback(async ({ silent = false } = {}) => {
    const requestSequence = ++orderLoadSequence.current;
    if (!isFullyAuthenticated) {
      setOrders([]);
      setLoadingOrders(false);
      return;
    }
    try {
      if (!silent) setLoadingOrders(true);
      const res = await apiClient.get('/api/orders/mine', { showLoader: !silent });
      if (requestSequence === orderLoadSequence.current) {
        setOrders(normalizeOrdersResponse(res.data));
        setOrdersError('');
      }
    } catch (error) {
      console.error('Failed to load customer orders:', error);
      if (requestSequence === orderLoadSequence.current) setOrdersError('Unable to load your orders right now. Please try again in a moment.');
    } finally {
      if (requestSequence === orderLoadSequence.current) {
        setLoadingOrders(false);
      }
    }
  }, [isFullyAuthenticated]);

  // Order data is loaded by OrderHistoryView when the customer opens the Orders tab.
  // Keep it out of global auth hydration so sign-in does not fetch order history.

  // Load User Medicine Requests
  const loadUserMedicineRequests = useCallback(async ({ silent = false, page, statusGroup, append = false } = {}) => {
    const requestSequence = ++medicineRequestLoadSequence.current;
    if (!isFullyAuthenticated || (isPharmacyOrAdmin && !isSuperAdmin)) {
      setMedicineRequests([]);
      setMedicineRequestsError('');
      setMedicineRequestsPagination({ page: 1, pageSize: 10, limit: 10, total: 0, totalPages: 0, hasNextPage: false });
      setLoadingMedicineRequests(false);
      return;
    }
    if (page != null) medicineRequestPage.current.page = page;
    if (statusGroup != null) {
      medicineRequestPage.current.statusGroup = statusGroup;
      medicineRequestPage.current.page = page ?? 1;
    }
    try {
      if (!silent) setLoadingMedicineRequests(true);
      if (!append) setMedicineRequestsError('');
      const result = await getCustomerMedicineRequestsPage({
        page: medicineRequestPage.current.page,
        pageSize: 10,
        statusGroup: medicineRequestPage.current.statusGroup
      });
      if (requestSequence !== medicineRequestLoadSequence.current) return;
      const list = result?.requests || result?.items;
      if (!Array.isArray(list)) throw new Error('Medicine requests response was invalid.');
      setMedicineRequests(previous => {
        if (!append && silent) {
          const byId = new Map([...list, ...previous].map(item => [String(item._id), item]));
          return [...byId.values()];
        }
        if (!append) return list;
        const byId = new Map(previous.map(item => [String(item._id), item]));
        list.forEach(item => byId.set(String(item._id), item));
        return [...byId.values()];
      });
      setMedicineRequestsPagination(result.pagination || {
        page: medicineRequestPage.current.page, pageSize: 10, limit: 10, total: list.length, totalPages: list.length ? 1 : 0, hasNextPage: false
      });

      // Check if any proposals are ready to notify customer in notification bell
      const proposalsWaiting = (list || []).filter(r => r.status === 'PROPOSAL_SENT');
      if (proposalsWaiting.length > 0) {
        proposalsWaiting.forEach(p => {
          const notifId = `notif-prop-${p._id}`;
          setNotifications(prev => {
            if (prev.some(n => n.id === notifId)) return prev;
            return [
              {
                id: notifId,
                title: `💊 Proposal Ready for #${p.requestNumber}`,
                message: `Price: ₹${p.pharmacyProposal?.totalPrice || p.pharmacyProposal?.approximatePrice}. Tap to review and confirm.`,
                time: 'Just now',
                read: false,
                type: 'info',
                requestId: p._id,
                actionType: 'VIEW_PROPOSAL'
              },
              ...prev
            ];
          });
        });
      }
    } catch (error) {
      console.error('Failed to load customer medicine requests:', error);
      setMedicineRequestsError(error.message || 'Medicine requests are temporarily unavailable. Please try again in a moment.');
    } finally {
      if (!silent && requestSequence === medicineRequestLoadSequence.current) setLoadingMedicineRequests(false);
    }
  }, [isFullyAuthenticated, isPharmacyOrAdmin, isSuperAdmin]);

  // The authenticated notification API provides the initial snapshot and reconnect recovery.
  // The browser never calls the cache service directly; cache events arrive via the authenticated
  // Socket.IO service and this API fills gaps after reconnects.
  const loadNotifications = useCallback(async () => {
    const sequence = ++notificationLoadSequence.current;
    if (!isFullyAuthenticated) {
      setNotifications([]);
      return [];
    }
    try {
      const response = await apiClient.get('/api/v1/notifications');
      const rows = Array.isArray(response.data?.data) ? response.data.data : [];
      if (sequence !== notificationLoadSequence.current) return [];
      const mapped = rows.map(item => ({
        id: String(item.id || item.notificationId || ''),
        title: item.title || 'Pharmacy Update',
        message: item.body || item.message || 'There is an update to your pharmacy activity.',
        time: item.createdAt ? new Date(item.createdAt).toLocaleTimeString() : 'Recent',
        createdAt: item.createdAt || null,
        read: Boolean(item.read),
        type: item.status === 'FAILED' || item.status === 'ERROR' ? 'warning' : 'info',
        eventType: item.eventType || 'NOTIFICATION_CREATED',
        orderId: item.orderId || null,
        requestId: item.medicineRequestId || null,
        actionType: item.medicineRequestId ? 'VIEW_PROPOSAL' : undefined,
        channels: Array.isArray(item.channels) ? item.channels : [],
        whatsappDeliveryState: item.deliveryState || null
      })).filter(item => item.id);
      setNotifications(previous => {
        const serverIds = new Set(mapped.map(item => item.id));
        // Preserve socket events received while this snapshot request was in flight.
        const localItems = previous.filter(item =>
          (item.sourceChannel === 'realtime' || String(item.id).startsWith('notif-prop-') || String(item.id).startsWith('notif-wa'))
          && !serverIds.has(String(item.id))
        );
        return [...mapped, ...localItems].slice(0, 50);
      });
      return mapped;
    } catch (error) {
      console.warn('[Notifications] Initial/recovery fetch failed:', error?.message || error);
      return [];
    }
  }, [isFullyAuthenticated]);

  const loadDeliveryEvents = useCallback(async () => {
    const sequence = ++deliveryEventsLoadSequence.current;
    if (!isFullyAuthenticated) {
      setDeliveryEvents([]);
      return [];
    }
    try {
      const response = await apiClient.get('/api/v1/notifications/delivery-history');
      const rows = Array.isArray(response.data?.data) ? response.data.data : [];
      if (sequence !== deliveryEventsLoadSequence.current) return [];
      setDeliveryEvents(previous => {
        const byId = new Map();
        [...rows, ...previous].forEach((item, index) => {
          const id = String(item.id || item.eventId || [item.orderId || item.aggregateId || 'delivery', item.eventType || item.type || item.status || 'update', item.timestamp || item.createdAt || index].join(':'));
          if (!byId.has(id)) byId.set(id, { ...item, id });
        });
        return [...byId.values()].slice(0, 50);
      });
      return rows;
    } catch (error) {
      console.warn('[Fulfillment] Delivery history fetch failed:', error?.message || error);
      return [];
    }
  }, [isFullyAuthenticated]);

  useEffect(() => {
    if (!authLoading && isFullyAuthenticated) {
      void loadNotifications();
      void loadDeliveryEvents();
    } else if (!authLoading) {
      notificationLoadSequence.current += 1;
      deliveryEventsLoadSequence.current += 1;
      setNotifications([]);
      setDeliveryEvents([]);
      setRealtimeConnectionStatus('offline');
    }
  }, [authLoading, isFullyAuthenticated, loadNotifications, loadDeliveryEvents]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleTokenChange = () => setRealtimeTokenVersion(version => version + 1);
    window.addEventListener('pharma:access-token-changed', handleTokenChange);
    return () => window.removeEventListener('pharma:access-token-changed', handleTokenChange);
  }, []);

  // Authenticated realtime updates. The server derives identity from the signed token;
  // browser-supplied user/tenant IDs only request rooms and are verified server-side.
  useEffect(() => {
    if (!isFullyAuthenticated || !user?.id || typeof window === 'undefined') return undefined;
    const token = getRuntimeAccessToken();
    const wsUrl = String(import.meta.env.VITE_WS_URL || '').trim();
    if (!token || !wsUrl) return undefined;

    const tenantId = user.tenantId
      || user.app_metadata?.tenantId
      || user.user_metadata?.tenantId
      || user.tenantMembership?.tenantId
      || null;
    const socket = io(wsUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000
    });

    const upsertNotification = (payload, sourceChannel = 'notification') => {
      if (!payload || typeof payload !== 'object') return;
      const id = String(payload.id || payload.notificationId || '');
      if (!id) return;
      const notification = {
        id,
        title: payload.title || 'Pharmacy Update',
        message: payload.body || payload.message || 'There is an update to your pharmacy activity.',
        time: 'Just now',
        read: false,
        type: 'info',
        eventType: payload.eventType || sourceChannel,
        orderId: payload.orderId || null,
        requestId: payload.medicineRequestId || null,
        actionType: payload.medicineRequestId ? 'VIEW_PROPOSAL' : undefined,
        channels: Array.isArray(payload.channels) ? payload.channels : [],
        whatsappDeliveryState: payload.deliveryState || null,
        sourceChannel: 'realtime',
        createdAt: payload.createdAt || payload.timestamp || new Date().toISOString()
      };
      setNotifications(previous => {
        const existingIndex = previous.findIndex(item => String(item.id) === id
          || (item.eventType === 'WHATSAPP_DELIVERY_STATUS'
            && ((payload.orderId && String(item.orderId) === String(payload.orderId))
              || (payload.medicineRequestId && String(item.requestId) === String(payload.medicineRequestId))))
          || (sourceChannel === 'whatsapp_notification' && payload.eventType === 'WHATSAPP_DELIVERY_STATUS'
            && ((payload.orderId && String(item.orderId) === String(payload.orderId))
              || (payload.medicineRequestId && String(item.requestId) === String(payload.medicineRequestId)))));
        if (existingIndex >= 0) {
          return previous.map((item, index) => {
            if (index !== existingIndex) return item;
            if (payload.eventType === 'WHATSAPP_DELIVERY_STATUS') return { ...item, whatsappDeliveryState: payload.deliveryState || item.whatsappDeliveryState };
            return { ...item, ...notification, read: item.read, whatsappDeliveryState: payload.deliveryState || item.whatsappDeliveryState };
          });
        }
        return [notification, ...previous].slice(0, 50);
      });
    };

    const onNotification = payload => upsertNotification(payload, 'notification');
    const onWhatsAppNotification = payload => upsertNotification(payload, 'whatsapp_notification');
    const onMedicineRequestUpdated = payload => {
      window.dispatchEvent(new CustomEvent('pharma:medicine-request-updated', { detail: payload }));
      void loadUserMedicineRequests({ silent: true });
    };
    const onOrderStatusChanged = payload => {
      const event = {
        ...(payload || {}),
        id: String(payload?.id || payload?.eventId || [payload?.orderId || 'order', payload?.eventType || payload?.type || payload?.status || 'update', payload?.timestamp || payload?.createdAt || Date.now()].join(':'))
      };
      setDeliveryEvents(previous => {
        const exists = previous.some(item => String(item.id) === event.id);
        return exists ? previous.map(item => String(item.id) === event.id ? { ...item, ...event } : item) : [event, ...previous].slice(0, 50);
      });
      window.dispatchEvent(new CustomEvent('pharma:order-status-changed', { detail: payload }));
      void loadDeliveryEvents();
      void loadUserOrders({ silent: true });
    };

    const onSocketConnect = () => {
      setRealtimeConnectionStatus('connected');
      socket.emit('join_bell_room', { userId: user.id, ...(tenantId ? { tenantId } : {}) });
      // The cache consumer persists/acks its own Redis Stream cursor. Reload the
      // authenticated snapshots on connect/reconnect to fill gaps while this browser
      // was offline, then let future Socket.IO events update the UI immediately.
      void loadNotifications();
      void loadDeliveryEvents();
      window.dispatchEvent(new CustomEvent('pharma:order-status-changed', { detail: { source: 'realtime-recovery' } }));
      window.dispatchEvent(new CustomEvent('pharma:medicine-request-updated', { detail: { source: 'realtime-recovery' } }));
    };
    const onSocketDisconnect = () => setRealtimeConnectionStatus('reconnecting');
    const onSocketConnectError = error => {
      setRealtimeConnectionStatus('offline');
      console.warn('[Realtime] Socket connection was rejected or unavailable:', error?.message || 'connection error');
    };
    socket.on('connect', onSocketConnect);
    socket.on('disconnect', onSocketDisconnect);
    socket.on('connect_error', onSocketConnectError);
    socket.on('notification', onNotification);
    socket.on('whatsapp_notification', onWhatsAppNotification);
    socket.on('medicine_request_updated', onMedicineRequestUpdated);
    socket.on('order_status_changed', onOrderStatusChanged);
    return () => {
      socket.off('notification', onNotification);
      socket.off('whatsapp_notification', onWhatsAppNotification);
      socket.off('medicine_request_updated', onMedicineRequestUpdated);
      socket.off('order_status_changed', onOrderStatusChanged);
      socket.off('connect', onSocketConnect);
      socket.off('disconnect', onSocketDisconnect);
      socket.off('connect_error', onSocketConnectError);
      socket.disconnect();
    };
  }, [isFullyAuthenticated, user?.id, user?.tenantId, user?.app_metadata?.tenantId, user?.user_metadata?.tenantId, realtimeTokenVersion, loadUserOrders, loadUserMedicineRequests, loadNotifications, loadDeliveryEvents]);

  // Customer medicine requests are loaded by CustomerRequestsView when that tab opens.
  // Do not fetch or poll this customer-only list as part of global login hydration.

  const openRequestModal = (prefill = null) => {
    if (isPharmacyOrAdmin) {
      addToast('Medicine requests can only be submitted by customer accounts.', 'warning');
      return;
    }
    setRequestPrefillData(prefill);
    if (user) {
      setRequestAuthPending(false);
      setRequestModalOpen(true);
    } else {
      setRequestModalOpen(false);
      setRequestAuthPending(true);
    }
  };

  const closeRequestModal = () => {
    setRequestModalOpen(false);
    setRequestPrefillData(null);
    setRequestAuthPending(false);
  };

  const cancelRequestAuthentication = () => {
    setRequestPrefillData(null);
    setRequestAuthPending(false);
  };

  const resumeRequestAfterAuthentication = () => {
    if (!user) return;
    setRequestAuthPending(false);
    setRequestModalOpen(true);
  };

  const openProposalModal = (request) => {
    setActiveProposalRequest(request);
  };

  // Fetch Admin Inventory Alerts
  const loadInventoryAlerts = useCallback(async () => {
    if (authLoading || !isFullyAuthenticated || !hasPermission('inventory.read')) return;
    try {
      const res = await apiClient.get('/api/medicines/alerts');
      setInventoryAlerts(res.data || {});
    } catch {
      // ignore
    }
  }, [authLoading, isFullyAuthenticated, hasPermission]);

  useEffect(() => {
    if (!authLoading && isFullyAuthenticated && hasPermission('inventory.read')) {
      loadInventoryAlerts();
    }
  }, [authLoading, isFullyAuthenticated, hasPermission, loadInventoryAlerts]);

  // Cart operations
  const addToCart = (med) => {
    const stock = med.stock !== undefined ? med.stock : (med.quantity || 0);
    if (stock <= 0) {
      addToast(`Sorry, ${med.name} is currently out of stock.`, 'warning');
      return;
    }

    const existing = cart.find(item => item._id === med._id);
    if (existing) {
      if (existing.quantity >= stock) {
        addToast(`Maximum available stock reached for ${med.name} (${stock} units).`, 'warning');
        return;
      }
      const quantity = existing.quantity + 1;
      setCart(cart.map(item =>
        item._id === med._id ? { ...item, quantity } : item
      ));
      addToast(`Increased ${med.name} quantity to ${quantity}`, 'success');
      return;
    }

    setCart([...cart, { ...med, quantity: 1, stock }]);
    addToast(`Added ${med.name} to cart`, 'success');
  };

  const updateQuantity = (id, delta) => {
    const item = cart.find(cartItem => cartItem._id === id);
    if (!item) return;

    const nextQty = item.quantity + delta;
    if (nextQty <= 0) {
      setCart(cart.filter(cartItem => cartItem._id !== id));
      addToast(`Removed ${item.name} from cart`, 'info');
      return;
    }
    if (nextQty > item.stock) {
      addToast(`Only ${item.stock} units available in pharmacy stock.`, 'warning');
      return;
    }
    setCart(cart.map(cartItem => cartItem._id === id ? { ...cartItem, quantity: nextQty } : cartItem));
  };

  const removeFromCart = (id) => {
    const item = cart.find(cartItem => cartItem._id === id);
    if (!item) return;
    setCart(cart.filter(cartItem => cartItem._id !== id));
    addToast('Item removed from cart', 'info');
  };

  const clearCart = () => {
    setCart([]);
    setAppliedCoupon(null);
  };

  // Calculations
  const subtotal = cart.reduce((acc, item) => acc + (Number(item.price) || 0) * item.quantity, 0);
  const discountAmount = appliedCoupon
    ? appliedCoupon.discountType === 'fixed'
      ? Math.min(appliedCoupon.discountValue, subtotal)
      : (subtotal * appliedCoupon.discountPercentage) / 100
    : 0;
  const finalTotal = Math.max(0, subtotal - discountAmount + deliveryFee);
  const appliedCouponRef = useRef(appliedCoupon);
  useEffect(() => { appliedCouponRef.current = appliedCoupon; }, [appliedCoupon]);

  // Tenant-assigned customer promotions are selected by the backend and
  // automatically applied before checkout. Explicit public coupons can still
  // be entered by the customer afterwards.
  useEffect(() => {
    if (!isFullyAuthenticated || !user?.id || subtotal <= 0 || appliedCouponRef.current) return;
    let active = true;
    apiClient.get('/api/coupons/my-offer', { params: { orderTotal: subtotal } })
      .then(({ data }) => {
        if (!active || !data?.promotion) return;
        const promotion = data.promotion;
        setAppliedCoupon({
          code: promotion.code,
          discountType: promotion.discountType,
          discountValue: Number(promotion.discountValue || 0),
          discountPercentage: Number(promotion.discountPercentage || 0),
          promotionLabel: promotion.promotionLabel || 'Pharma discount for you',
          isCustomerPromotion: true
        });
        setCouponCode('');
      })
      .catch(() => {});
    return () => { active = false; };
  }, [isFullyAuthenticated, user?.id, subtotal]);

  // Coupon logic
  const applyCoupon = async (codeToApply) => {
    const code = (codeToApply || couponCode).trim();
    if (!code) return;
    try {
      setCouponError('');
      const result = await applyCouponCode(code, subtotal);
      setAppliedCoupon({
        code: result.coupon.code,
        promotionLabel: result.coupon.promotionLabel || 'Coupon discount',
        isCustomerPromotion: false,
        discountType: result.coupon.discountType,
        discountValue: result.coupon.discountValue,
        discountPercentage: result.coupon.discountType === 'percentage' ? result.coupon.discountValue : 0
      });
      addToast(`Coupon applied! ₹${result.discountAmount.toFixed(2)} saved.`, 'success');
    } catch (err) {
      const message = err?.message || 'Invalid coupon code';
      setCouponError(message);
      addToast(message, 'error');
    }
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
    setCouponCode('');
    setCouponError('');
    addToast('Coupon removed', 'info');
  };

  const customerProfileKey = user?.id ? CUSTOMER_CACHE_PREFIX + user.id + ':profile' : null;
  const [customerProfileCache, setCustomerProfileCache] = usePersistentState(
    customerProfileKey,
    null,
    { storage: 'local', ttl: CACHE_TTL, enabled: Boolean(isFullyAuthenticated && customerProfileKey) }
  );

  // Synchronize canonical customer/PUID data. This is idempotent.
  const ensureCustomerProfile = useCallback(async (profile = {}) => {
    if (!isFullyAuthenticated || isSuperAdmin || !user?.id) return null;
    if (!profile.name && !profile.email && !profile.phone) {
      if (customerProfileCache) return customerProfileCache;
    }
    try {
      const res = await apiClient.post('/api/v1/customers/ensure', {
        name: profile.name || user?.user_metadata?.name || user?.name || '',
        email: profile.email || user?.email || '',
        phone: profile.phone || user?.user_metadata?.mobile || user?.mobile || ''
      });
      const customer = res.data?.data || res.data || null;
      if (customer) setCustomerProfileCache(customer);
      return customer;
    } catch (error) {
      console.warn('Customer/PUID synchronization skipped:', error?.message || error);
      return null;
    }
  }, [isFullyAuthenticated, user?.id, user?.email, user?.user_metadata?.name, user?.user_metadata?.mobile, user?.name, user?.mobile]);

  useEffect(() => {
    if (!isFullyAuthenticated || isSuperAdmin) return;
    void ensureCustomerProfile();
  }, [isFullyAuthenticated, isSuperAdmin, ensureCustomerProfile]);

  // Save address helper
  const saveAddress = async (addressData) => runAction(LOADING_ACTIONS.SAVE_ADDRESS, async () => {
    try {
      await ensureCustomerProfile({ name: addressData.fullName, phone: addressData.mobile });
      const res = await apiClient.post('/api/user/addresses', addressData);
      const savedAddress = res.data;
      setAddresses(prev => {
        const next = [
          ...(savedAddress.isDefault ? prev.map(address => ({ ...address, isDefault: false })) : prev),
          savedAddress
        ];
        return next;
      });
      setSelectedAddressId(savedAddress._id);
      addToast('Delivery address saved to directory!', 'success');
      return savedAddress;
    } catch (err) {
      addToast('Unable to save this address right now. Please try again later.', 'error');
      return false;
    }
  });

  const updateAddress = async (addressId, addressData) => runAction(LOADING_ACTIONS.EDIT_ADDRESS, async () => {
    try {
      await ensureCustomerProfile({ name: addressData.fullName, phone: addressData.mobile });
      const res = await apiClient.patch(`/api/user/addresses/${encodeURIComponent(addressId)}`, addressData);
      const updatedAddress = res.data;
      setAddresses(prev => {
        const next = prev.map(address => {
          if (address._id === updatedAddress._id) return updatedAddress;
          return updatedAddress.isDefault ? { ...address, isDefault: false } : address;
        });
        if (addressCacheKey) writeLocalCache(addressCacheKey, next);
        return next;
      });
      addToast('Saved address updated. Existing orders keep their original delivery address.', 'success');
      return updatedAddress;
    } catch (err) {
      addToast('Unable to update this address right now. Please try again later.', 'error');
      return false;
    }
  });

  const deleteAddress = async (addressId) => runAction(LOADING_ACTIONS.REMOVE_ADDRESS, async () => {
    try {
      await apiClient.delete(`/api/user/addresses/${encodeURIComponent(addressId)}`);
      const remaining = addresses.filter(address => address._id !== addressId);
      const nextAddresses = remaining.some(address => address.isDefault)
        ? remaining
        : remaining.map((address, index) => ({ ...address, isDefault: index === 0 }));
      setAddresses(nextAddresses);
      if (selectedAddressId === addressId) {
        setSelectedAddressId(nextAddresses.find(address => address.isDefault)?._id || nextAddresses[0]?._id || '');
      }
      addToast('Saved address deleted. Existing orders keep their original delivery address.', 'success');
      return true;
    } catch (err) {
      if (err.status === 404) {
        const refreshedAddresses = await loadAddresses();
        if (Array.isArray(refreshedAddresses) && !refreshedAddresses.some(address => String(address._id) === String(addressId))) {
          addToast('This address was already removed. Your address list has been refreshed.', 'info');
          return true;
        }
      }
      addToast('Unable to delete this address right now. Please try again later.', 'error');
      return false;
    }
  });

  return (
    <AppContext.Provider
      value={{
        // Catalog
        medicines,
        medicinesError,
        loadingMedicines,
        searchQuery,
        setSearchQuery,
        selectedCategory,
        setSelectedCategory,
        hideRx,
        setHideRx,
        sortOption,
        setSortOption,
        fetchMedicines,
        page,
        setPage,
        totalPages,
        totalMedicines,
        limit,
        isSearching,

        // Cart
        cart,
        addToCart,
        updateQuantity,
        removeFromCart,
        clearCart,
        subtotal,
        discountAmount,
        deliveryFee,
        finalTotal,
        appliedCoupon,
        couponCode,
        setCouponCode,
        couponError,
        applyCoupon,
        removeCoupon,

        // Addresses
        addresses,
        addressesError,
        selectedAddressId,
        setSelectedAddressId,
        loadingAddresses,
        loadAddresses,
        saveAddress,
        updateAddress,
        deleteAddress,
        ensureCustomerProfile,

        // Orders
        orders,
        ordersError,
        loadUserOrders,
        loadingOrders,
        activeTrackingOrder,
        setActiveTrackingOrder,

        // Medicine Requests & Proposals
        medicineRequests,
        medicineRequestsError,
        medicineRequestsPagination,
        loadingMedicineRequests,
        loadUserMedicineRequests,
        requestModalOpen,
        closeRequestModal,
        requestPrefillData,
        requestAuthPending,
        setRequestAuthPending,
        cancelRequestAuthentication,
        resumeRequestAfterAuthentication,
        openRequestModal,
        activeProposalRequest,
        setActiveProposalRequest,
        openProposalModal,

        // Notifications
        notifications,
        unreadNotificationsCount: notifications.filter(n => !n.read).length,
        markNotificationRead: async (id) => {
          const target = notifications.find(item => String(item.id) === String(id));
          if (!target || target.read) return;
          setNotifications(prev => prev.map(item => String(item.id) === String(id) ? { ...item, read: true } : item));
          // Proposal/WhatsApp prompts synthesized locally do not have a persisted
          // NotificationService record and must not be sent to the read API.
          if (String(id).startsWith('notif-prop-') || String(id).startsWith('notif-wa')) return;
          try {
            await apiClient.patch(`/api/v1/notifications/${encodeURIComponent(id)}/read`);
          } catch (error) {
            setNotifications(prev => prev.map(item => String(item.id) === String(id) ? { ...item, read: false } : item));
            console.warn('[Notifications] Could not persist read state:', error?.message || error);
          }
        },
        loadNotifications,
        deliveryEvents,
        loadDeliveryEvents,
        realtimeConnectionStatus,

        // Admin alerts
        inventoryAlerts,
        loadInventoryAlerts,

        // WhatsApp Gateway
        whatsappStatus,
        whatsappModalOpen,
        setWhatsappModalOpen,
        whatsappWarningActive,
        loadWhatsAppStatus,
        generateWhatsAppQR,
        disconnectWhatsApp,
        triggerWhatsAppWarningNotification,
        dismissWhatsAppPrompt,
        checkWhatsAppBeforeNotification
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => {
  const context = useContext(AppContext);
  if (context === null) {
    throw new Error('useApp must be used within an AppProvider.');
  }
  return context;
};
