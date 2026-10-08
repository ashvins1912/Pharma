import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../api/apiClient';
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
  const { user, isAdmin, isSuperAdmin, isPharmacyOrAdmin, loading: authLoading, isFullyAuthenticated } = useAuth();
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
  const [notifications, setNotifications] = useState([
    {
      id: 'notif-1',
      title: 'Welcome to Ashvin Pharmacy',
      message: 'Browse prescription and OTC medicines with doorstep delivery in 30 mins.',
      time: 'Just now',
      read: false,
      type: 'info'
    }
  ]);

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

  useEffect(() => {
    if (user && isAdmin) return;
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
  }, [user?.id, isAdmin]);

  // Load WhatsApp status
  const loadWhatsAppStatus = useCallback(async () => {
    if (!isFullyAuthenticated || !isAdmin) return null;
    try {
      const res = await apiClient.get('/api/admin/whatsapp/status', { timeout: 45000 });
      if (res.data) {
        setWhatsappStatus(res.data);
        if (res.data.isConnected) {
          setWhatsappWarningActive(false);
          setNotifications(prev => prev.filter(n => !n.id.startsWith('notif-wa')));
        }
        return res.data;
      }
    } catch (err) {
      console.warn("WhatsApp status fetch skipped:", err?.message);
    }
    return null;
  }, [isFullyAuthenticated, isAdmin]);

  const generateWhatsAppQR = async () => {
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
    try {
      const res = await apiClient.post('/api/admin/whatsapp/disconnect');
      if (res.data?.status) {
        setWhatsappStatus(res.data.status);
        return res.data.status;
      }
    } catch (err) {
      console.error("WhatsApp disconnect failed:", err);
      throw err;
    }
  };

  const triggerWhatsAppWarningNotification = () => {
    if (!user || !isAdmin) return;
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

      let res;
      try {
        res = await apiClient.get('/api/medicines', { params });
      } catch (firstErr) {
        // If initial attempt fails due to temporary connection or startup hiccup, retry once after 800ms
        await new Promise(resolve => setTimeout(resolve, 800));
        res = await apiClient.get('/api/medicines', { params });
      }

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

  useEffect(() => {
    if (!isFullyAuthenticated) return;
    loadUserOrders();
    const refreshTimer = window.setInterval(() => loadUserOrders({ silent: true }), 15000);
    return () => window.clearInterval(refreshTimer);
  }, [loadUserOrders, isFullyAuthenticated]);

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

  useEffect(() => {
    if (!isFullyAuthenticated) return;
    loadUserMedicineRequests();
    const timer = window.setInterval(() => loadUserMedicineRequests({ silent: true }), 15000);
    return () => window.clearInterval(timer);
  }, [loadUserMedicineRequests, isFullyAuthenticated]);

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
    if (authLoading || !isFullyAuthenticated || !isAdmin) return;
    try {
      const res = await apiClient.get('/api/medicines/alerts');
      setInventoryAlerts(res.data || {});
    } catch {
      // ignore
    }
  }, [authLoading, isFullyAuthenticated, isAdmin]);

  useEffect(() => {
    if (!authLoading && isFullyAuthenticated && isAdmin) {
      loadInventoryAlerts();
    }
  }, [authLoading, isFullyAuthenticated, isAdmin, loadInventoryAlerts]);

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

  // Coupon logic
  const applyCoupon = async (codeToApply) => {
    const code = (codeToApply || couponCode).trim();
    if (!code) return;
    try {
      setCouponError('');
      const result = await applyCouponCode(code, subtotal);
      setAppliedCoupon({
        code: result.coupon.code,
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
        markNotificationRead: (id) =>
          setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n)),

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
        triggerWhatsAppWarningNotification
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
