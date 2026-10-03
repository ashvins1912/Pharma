import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../api/apiClient';
import { normalizeOrdersResponse } from '../api/orderService';
import { applyCouponCode } from '../api/couponService';
import { getCustomerMedicineRequestsPage } from '../api/medicineRequestService';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { addToast } = useToast();

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
  const [addresses, setAddresses] = useState([]);
  const [addressesError, setAddressesError] = useState('');
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [loadingAddresses, setLoadingAddresses] = useState(false);

  // Orders & Tracking State
  const [orders, setOrders] = useState([]);
  const [ordersError, setOrdersError] = useState('');
  const [activeTrackingOrder, setActiveTrackingOrder] = useState(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const orderLoadSequence = useRef(0);
  const previousCustomerId = useRef(null);

  // Medicine Requests & Proposals State
  const [medicineRequests, setMedicineRequests] = useState([]);
  const [medicineRequestsError, setMedicineRequestsError] = useState('');
  const [medicineRequestsPagination, setMedicineRequestsPagination] = useState({
    page: 1, pageSize: 3, limit: 3, total: 0, totalPages: 0, hasNextPage: false
  });
  const [loadingMedicineRequests, setLoadingMedicineRequests] = useState(false);
  const medicineRequestQuery = useRef({ statusGroup: 'ALL' });
  const medicineRequestSequence = useRef(0);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestPrefillData, setRequestPrefillData] = useState(null);
  const [activeProposalRequest, setActiveProposalRequest] = useState(null);

  // Multi-Tenant & Branch Context State
  const [tenants, setTenants] = useState([
    { id: 'tenant-ashvin-main', name: 'Ashvin Central Pharmacy', code: 'ASHVIN-HQ' },
    { id: 'tenant-medplus-partner', name: 'MedPlus Express Partner', code: 'MEDPLUS-MP' }
  ]);
  const [branches, setBranches] = useState([
    {
      id: 'branch-indore-central',
      tenantId: 'tenant-ashvin-main',
      name: 'Indore Central (Old Palasia)',
      code: 'IND-01',
      serviceRadiusKm: 12.0,
      deliveryFee: 30,
      freeDeliveryAbove: 499
    },
    {
      id: 'branch-indore-vijaynagar',
      tenantId: 'tenant-ashvin-main',
      name: 'Vijay Nagar Express Dispensary',
      code: 'IND-02',
      serviceRadiusKm: 8.0,
      deliveryFee: 35,
      freeDeliveryAbove: 599
    },
    {
      id: 'branch-bhopal-mpnagar',
      tenantId: 'tenant-medplus-partner',
      name: 'Bhopal MP Nagar Branch',
      code: 'BPL-01',
      serviceRadiusKm: 10.0,
      deliveryFee: 40,
      freeDeliveryAbove: 499
    }
  ]);
  const [activeTenantId, setActiveTenantIdState] = useState(() => localStorage.getItem('selected_tenant_id') || 'tenant-ashvin-main');
  const [activeBranchId, setActiveBranchIdState] = useState(() => localStorage.getItem('selected_branch_id') || 'branch-indore-central');

  const switchBranch = useCallback((branchId, tenantId = null) => {
    if (branchId) {
      setActiveBranchIdState(branchId);
      localStorage.setItem('selected_branch_id', branchId);
    }
    if (tenantId) {
      setActiveTenantIdState(tenantId);
      localStorage.setItem('selected_tenant_id', tenantId);
    } else {
      // Find branch's tenant
      const found = branches.find(b => b.id === branchId);
      if (found?.tenantId) {
        setActiveTenantIdState(found.tenantId);
        localStorage.setItem('selected_tenant_id', found.tenantId);
      }
    }
  }, [branches]);

  useEffect(() => {
    async function loadTenantHierarchy() {
      try {
        const [tRes, bRes] = await Promise.allSettled([
          apiClient.get('/api/v1/tenants'),
          apiClient.get('/api/v1/branches/all')
        ]);
        if (tRes.status === 'fulfilled' && tRes.value.data?.data) {
          setTenants(tRes.value.data.data);
        }
        if (bRes.status === 'fulfilled' && bRes.value.data?.data) {
          setBranches(bRes.value.data.data);
        }
      } catch (err) {
        console.warn('Tenant hierarchy load fallback:', err.message);
      }
    }
    loadTenantHierarchy();
  }, []);

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
  }, []);

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

      const res = await apiClient.get('/api/medicines', { params });
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
      console.warn('Catalog fetch notice:', err?.message || err);
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
  const loadAddresses = useCallback(async () => {
    try {
      setLoadingAddresses(true);
      setAddressesError('');
      const res = await apiClient.get('/api/user/addresses');
      if (Array.isArray(res.data)) {
        const addrs = res.data;
        setAddresses(addrs);
        if (addrs.length === 0) setSelectedAddressId('');
        if (addrs.length > 0) {
          setSelectedAddressId((currentSelected) => {
            if (currentSelected && addrs.some(address => address._id === currentSelected)) {
              return currentSelected;
            }
            const defaultAddr = addrs.find(a => a.isDefault) || addrs[0];
            return defaultAddr?._id || '';
          });
        }
        return addrs;
      }
      throw new Error('Address response was invalid.');
    } catch (err) {
      console.warn("Address directory notice:", err?.message || err);
      setAddressesError('Unable to load your saved addresses right now. Please try again.');
      return null;
    } finally {
      setLoadingAddresses(false);
    }
  }, [user, addToast]);

  useEffect(() => {
    const currentCustomerId = user?.id || null;
    if (previousCustomerId.current !== currentCustomerId) {
      previousCustomerId.current = currentCustomerId;
      setAddresses([]);
      setAddressesError('');
      setSelectedAddressId('');
      setCart([]);
      setOrders([]);
      setOrdersError('');
      setMedicineRequests([]);
      setMedicineRequestsError('');
      setMedicineRequestsPagination({ page: 1, pageSize: 3, limit: 3, total: 0, totalPages: 0, hasNextPage: false });
      setNotifications([]);
      setActiveProposalRequest(null);
      setRequestModalOpen(false);
      setRequestPrefillData(null);
    }
    if (user) {
      loadAddresses();
    } else {
      setAddresses([]);
      setAddressesError('');
      setSelectedAddressId('');
      setCart([]);
      setOrders([]);
      setOrdersError('');
      setMedicineRequests([]);
      setMedicineRequestsError('');
      setMedicineRequestsPagination({ page: 1, pageSize: 3, limit: 3, total: 0, totalPages: 0, hasNextPage: false });
    }
  }, [user, loadAddresses]);

  // Fetch Orders
  const loadUserOrders = useCallback(async ({ silent = false } = {}) => {
    const requestSequence = ++orderLoadSequence.current;
    if (!user?.id) {
      setOrders([]);
      setOrdersError('');
      setLoadingOrders(false);
      return;
    }
    try {
      if (!silent) setLoadingOrders(true);
      const res = await apiClient.get('/api/orders/mine');
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
  }, [user?.id]);

  useEffect(() => {
    loadUserOrders();
    const refreshTimer = window.setInterval(() => loadUserOrders({ silent: true }), 15000);
    return () => window.clearInterval(refreshTimer);
  }, [loadUserOrders]);

  // Load User Medicine Requests
  const loadUserMedicineRequests = useCallback(async ({ silent = false, page = 1, statusGroup, append = false } = {}) => {
    const sequence = ++medicineRequestSequence.current;
    if (statusGroup) medicineRequestQuery.current = { statusGroup };
    const query = medicineRequestQuery.current;
    if (!user) {
      setMedicineRequests([]);
      setMedicineRequestsError('');
      setMedicineRequestsPagination({ page: 1, pageSize: 3, limit: 3, total: 0, totalPages: 0, hasNextPage: false });
      setLoadingMedicineRequests(false);
      return;
    }
    try {
      if (!silent) setLoadingMedicineRequests(true);
      if (!append) setMedicineRequestsError('');
      const data = await getCustomerMedicineRequestsPage({ page, pageSize: 3, ...query });
      if (sequence !== medicineRequestSequence.current) return;
      const list = data.requests || data.items;
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
      setMedicineRequestsPagination({
        page: Number(data.pagination?.page) || page,
        pageSize: Number(data.pagination?.pageSize || data.pagination?.limit) || 3,
        limit: Number(data.pagination?.pageSize || data.pagination?.limit) || 3,
        total: Number(data.pagination?.total) || 0,
        totalPages: Number(data.pagination?.totalPages) || 0,
        hasNextPage: Boolean(data.pagination?.hasNextPage ?? ((Number(data.pagination?.page) || page) < Number(data.pagination?.totalPages || 0)))
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
      if (sequence !== medicineRequestSequence.current) return;
      console.error('Failed to load customer medicine requests:', error);
      setMedicineRequestsError(error.message || 'Medicine requests are temporarily unavailable. Please try again in a moment.');
    } finally {
      if (sequence === medicineRequestSequence.current && !silent) setLoadingMedicineRequests(false);
    }
  }, [user]);

  useEffect(() => {
    loadUserMedicineRequests();
    const timer = window.setInterval(() => loadUserMedicineRequests({ silent: true, page: 1 }), 15000);
    return () => window.clearInterval(timer);
  }, [loadUserMedicineRequests]);

  const openRequestModal = (prefill = null) => {
    setRequestPrefillData(prefill);
    setRequestModalOpen(true);
  };

  const closeRequestModal = () => {
    setRequestModalOpen(false);
    setRequestPrefillData(null);
  };

  const openProposalModal = (request) => {
    setActiveProposalRequest(request);
  };

  // Fetch Admin Inventory Alerts
  const loadInventoryAlerts = useCallback(async () => {
    if (authLoading || !isAdmin) return;
    try {
      const res = await apiClient.get('/api/medicines/alerts');
      setInventoryAlerts(res.data || {});
    } catch {
      // ignore
    }
  }, [authLoading, isAdmin]);

  useEffect(() => {
    if (!authLoading && isAdmin) {
      loadInventoryAlerts();
    }
  }, [authLoading, isAdmin, loadInventoryAlerts]);

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
    setCart(cart.map(cartItem =>
      cartItem._id === id ? { ...cartItem, quantity: nextQty } : cartItem
    ));
  };

  const removeFromCart = (id) => {
    setCart(prev => prev.filter(i => i._id !== id));
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

  // Save address helper
  const saveAddress = async (addressData) => {
    try {
      const res = await apiClient.post('/api/user/addresses', addressData);
      const savedAddress = res.data;
      setAddresses(prev => [
        ...(savedAddress.isDefault ? prev.map(address => ({ ...address, isDefault: false })) : prev),
        savedAddress
      ]);
      setSelectedAddressId(savedAddress._id);
      addToast('Delivery address saved to directory!', 'success');
      return savedAddress;
    } catch (err) {
      addToast('Failed to save address: ' + err.message, 'error');
      return false;
    }
  };

  const updateAddress = async (addressId, addressData) => {
    try {
      const res = await apiClient.patch(`/api/user/addresses/${encodeURIComponent(addressId)}`, addressData);
      const updatedAddress = res.data;
      setAddresses(prev => prev.map(address => {
        if (address._id === updatedAddress._id) return updatedAddress;
        return updatedAddress.isDefault ? { ...address, isDefault: false } : address;
      }));
      addToast('Saved address updated. Existing orders keep their original delivery address.', 'success');
      return updatedAddress;
    } catch (err) {
      addToast('Failed to update address: ' + err.message, 'error');
      return false;
    }
  };

  const deleteAddress = async (addressId) => {
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
      addToast(err.message || 'Unable to delete this address right now. Please try again.', 'error');
      return false;
    }
  };

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
        setRequestModalOpen,
        requestPrefillData,
        openRequestModal,
        activeProposalRequest,
        setActiveProposalRequest,
        closeRequestModal,
        openProposalModal,

        // Multi-Tenant & Branch Context
        tenants,
        branches,
        activeTenantId,
        activeBranchId,
        activeBranch: branches.find(b => b.id === activeBranchId) || branches[0],
        activeTenant: tenants.find(t => t.id === activeTenantId) || tenants[0],
        switchBranch,

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

export const useApp = () => useContext(AppContext);
