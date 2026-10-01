import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../api/apiClient';
import { applyCouponCode } from '../api/couponService';
import { getCustomerMedicineRequests } from '../api/medicineRequestService';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { addToast } = useToast();

  // Catalog State
  const [medicines, setMedicines] = useState([]);
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
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const addressLoadSequence = useRef(0);

  // Orders & Tracking State
  const [orders, setOrders] = useState([]);
  const [activeTrackingOrder, setActiveTrackingOrder] = useState(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const orderLoadSequence = useRef(0);

  // Medicine Requests & Proposals State
  const [medicineRequests, setMedicineRequests] = useState([]);
  const [loadingMedicineRequests, setLoadingMedicineRequests] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestPrefillData, setRequestPrefillData] = useState(null);
  const [requestAuthPending, setRequestAuthPending] = useState(false);
  const [activeProposalRequest, setActiveProposalRequest] = useState(null);
  const previousUserId = useRef(null);
  const medicineRequestLoadSequence = useRef(0);

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
    const notifId = `notif-wa-${Date.now()}`;
    const warningNotif = {
      id: notifId,
      title: '⚠️ You may miss delivery updates on mobile',
      message: 'WhatsApp dispatch service is disconnected. Order status tracking, rider dispatch alerts, and delivery OTPs are paused.',
      time: 'Just now',
      read: false,
      type: 'warning',
      actionType: 'CONNECT_WHATSAPP'
    };

    setNotifications(prev => [
      warningNotif,
      ...prev.filter(n => !n.id.startsWith('notif-wa'))
    ]);
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
        setTotalMedicines(res.data.total || 0);
        setTotalPages(res.data.totalPages || 1);
        setIsSearching(Boolean(res.data.isSearching));
      } else if (Array.isArray(res.data)) {
        setMedicines(res.data);
        setTotalMedicines(res.data.length);
        setTotalPages(1);
        setIsSearching(Boolean(searchQuery));
      }
    } catch (err) {
      console.error("Failed to load catalog:", err);
    } finally {
      setLoadingMedicines(false);
    }
  }, [searchQuery, hideRx, selectedCategory, sortOption, page, limit]);

  useEffect(() => {
    fetchMedicines();
  }, [fetchMedicines]);

  // Fetch User Addresses
  const loadAddresses = useCallback(async () => {
    const requestSequence = ++addressLoadSequence.current;
    try {
      setLoadingAddresses(true);
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
        }
      }
    } catch (err) {
      if (requestSequence !== addressLoadSequence.current) return;
      console.warn("Address directory notice:", err?.message || err);
      // Graceful fallback to initial address so addresses and checkout are immediately usable
      setAddresses((prev) => {
        if (prev.length > 0) return prev;
        const initial = {
          _id: "addr-1",
          label: "Home",
          fullName: user?.user_metadata?.name || "Ashvin Singh",
          mobile: user?.user_metadata?.mobile || "+91 95899 16475",
          addressLine1: "Flat 402, Greenfield Heights, Richmond Road",
          city: "Bengaluru",
          state: "Karnataka",
          pincode: "560025",
          addressLine: "Flat 402, Greenfield Heights, Richmond Road, Bengaluru - 560025",
          coordinates: { lat: 12.9667, lng: 77.6000 },
          isDefault: true
        };
        setSelectedAddressId(cur => cur || initial._id);
        return [initial];
      });
    } finally {
      if (requestSequence === addressLoadSequence.current) setLoadingAddresses(false);
    }
  }, [user, selectedAddressId]);

  useEffect(() => {
    if (authLoading) return;

    const currentUserId = user?.id || null;
    if (previousUserId.current !== currentUserId) {
      if (previousUserId.current) {
        addressLoadSequence.current += 1;
        orderLoadSequence.current += 1;
        medicineRequestLoadSequence.current += 1;
        setAddresses([]);
        setSelectedAddressId('');
        setLoadingAddresses(false);
        setOrders([]);
        setLoadingOrders(false);
        setMedicineRequests([]);
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
    if (user?.id) {
      loadAddresses();
    } else {
      setAddresses([]);
      setSelectedAddressId('');
    }
  }, [user?.id, loadAddresses]);

  // Fetch Orders
  const loadUserOrders = useCallback(async ({ silent = false } = {}) => {
    const requestSequence = ++orderLoadSequence.current;
    if (!user?.id) {
      setOrders([]);
      setLoadingOrders(false);
      return;
    }
    try {
      if (!silent) setLoadingOrders(true);
      const res = await apiClient.get('/api/orders/mine');
      if (requestSequence === orderLoadSequence.current) {
        setOrders(res.data || []);
      }
    } catch {
      // ignore
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
  const loadUserMedicineRequests = useCallback(async ({ silent = false } = {}) => {
    const requestSequence = ++medicineRequestLoadSequence.current;
    if (!user) {
      setMedicineRequests([]);
      setLoadingMedicineRequests(false);
      return;
    }
    try {
      if (!silent) setLoadingMedicineRequests(true);
      const list = await getCustomerMedicineRequests();
      if (requestSequence !== medicineRequestLoadSequence.current) return;
      setMedicineRequests(list || []);

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
    } catch {
      // ignore
    } finally {
      if (!silent && requestSequence === medicineRequestLoadSequence.current) setLoadingMedicineRequests(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadUserMedicineRequests();
    const timer = window.setInterval(() => loadUserMedicineRequests({ silent: true }), 15000);
    return () => window.clearInterval(timer);
  }, [loadUserMedicineRequests]);

  const openRequestModal = (prefill = null) => {
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
      return true;
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
      return true;
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
      addToast('Failed to delete address: ' + err.message, 'error');
      return false;
    }
  };

  return (
    <AppContext.Provider
      value={{
        // Catalog
        medicines,
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
        selectedAddressId,
        setSelectedAddressId,
        loadingAddresses,
        loadAddresses,
        saveAddress,
        updateAddress,
        deleteAddress,

        // Orders
        orders,
        loadUserOrders,
        loadingOrders,
        activeTrackingOrder,
        setActiveTrackingOrder,

        // Medicine Requests & Proposals
        medicineRequests,
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

export const useApp = () => useContext(AppContext);
