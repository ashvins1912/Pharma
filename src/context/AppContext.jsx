import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import apiClient from '../api/apiClient';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const { user, isAdmin } = useAuth();
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

  // Orders & Tracking State
  const [orders, setOrders] = useState([]);
  const [activeTrackingOrder, setActiveTrackingOrder] = useState(null);
  const [loadingOrders, setLoadingOrders] = useState(false);

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
      const res = await apiClient.get('/api/admin/whatsapp/status');
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
      const res = await apiClient.post('/api/admin/whatsapp/generate-qr');
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

      const res = await apiClient.get('/api/medicines', { params });
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
    try {
      setLoadingAddresses(true);
      const res = await apiClient.get('/api/user/profile');
      if (res.data) {
        const addrs = res.data.addresses || [];
        setAddresses(addrs);
        if (addrs.length > 0 && !selectedAddressId) {
          const defaultAddr = addrs.find(a => a.isDefault) || addrs[0];
          setSelectedAddressId(defaultAddr._id);
        }
      }
    } catch (err) {
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
        setSelectedAddressId(initial._id);
        return [initial];
      });
    } finally {
      setLoadingAddresses(false);
    }
  }, [user, selectedAddressId]);

  useEffect(() => {
    if (user) {
      loadAddresses();
      loadUserOrders();
    }
  }, [user, loadAddresses]);

  // Fetch Orders
  const loadUserOrders = async () => {
    if (!user) return;
    try {
      setLoadingOrders(true);
      const res = await apiClient.get('/api/orders/history');
      setOrders(res.data || []);
    } catch {
      // ignore
    } finally {
      setLoadingOrders(false);
    }
  };

  // Fetch Admin Inventory Alerts
  const loadInventoryAlerts = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await apiClient.get('/api/medicines/alerts');
      setInventoryAlerts(res.data || {});
    } catch {
      // ignore
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      loadInventoryAlerts();
    }
  }, [isAdmin, loadInventoryAlerts]);

  // Cart operations
  const addToCart = (med) => {
    const stock = med.stock !== undefined ? med.stock : (med.quantity || 0);
    if (stock <= 0) {
      addToast(`Sorry, ${med.name} is currently out of stock.`, 'warning');
      return;
    }

    setCart((prev) => {
      const existing = prev.find(item => item._id === med._id);
      if (existing) {
        if (existing.quantity >= stock) {
          addToast(`Maximum available stock reached for ${med.name} (${stock} units).`, 'warning');
          return prev;
        }
        addToast(`Increased ${med.name} quantity to ${existing.quantity + 1}`, 'success');
        return prev.map(item =>
          item._id === med._id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      addToast(`Added ${med.name} to cart`, 'success');
      return [...prev, { ...med, quantity: 1, stock }];
    });
  };

  const updateQuantity = (id, delta) => {
    setCart((prev) => {
      const item = prev.find(i => i._id === id);
      if (!item) return prev;
      const nextQty = item.quantity + delta;
      if (nextQty <= 0) {
        addToast(`Removed ${item.name} from cart`, 'info');
        return prev.filter(i => i._id !== id);
      }
      if (nextQty > item.stock) {
        addToast(`Only ${item.stock} units available in pharmacy stock.`, 'warning');
        return prev;
      }
      return prev.map(i => i._id === id ? { ...i, quantity: nextQty } : i);
    });
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
  const discountAmount = appliedCoupon ? (subtotal * appliedCoupon.discountPercentage) / 100 : 0;
  const finalTotal = Math.max(0, subtotal - discountAmount + deliveryFee);

  // Coupon logic
  const applyCoupon = async (codeToApply) => {
    const code = (codeToApply || couponCode).trim();
    if (!code) return;
    try {
      setCouponError('');
      const res = await apiClient.get(`/api/coupons/validate/${code}`, {
        params: { orderTotal: subtotal }
      });
      if (res.data.valid) {
        setAppliedCoupon({
          code: res.data.code || code.toUpperCase(),
          discountPercentage: res.data.discountPercentage
        });
        addToast(`Coupon applied! ${res.data.discountPercentage}% discount saved.`, 'success');
      } else {
        setCouponError(res.data.message || 'Invalid coupon code');
        addToast(res.data.message || 'Invalid coupon code', 'error');
      }
    } catch (err) {
      setCouponError('Invalid coupon code');
      addToast('Invalid coupon code', 'error');
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
      const updatedList = [...addresses, { ...addressData, _id: `addr-${Date.now()}` }];
      const res = await apiClient.post('/api/user/profile', {
        name: user?.user_metadata?.name || user?.email || '',
        mobile: addressData.mobile || user?.user_metadata?.mobile || '',
        addresses: updatedList
      });
      setAddresses(res.data.addresses || updatedList);
      setSelectedAddressId(updatedList[updatedList.length - 1]._id);
      addToast('Delivery address saved to directory!', 'success');
      return true;
    } catch (err) {
      addToast('Failed to save address: ' + err.message, 'error');
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

        // Orders
        orders,
        loadUserOrders,
        loadingOrders,
        activeTrackingOrder,
        setActiveTrackingOrder,

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
