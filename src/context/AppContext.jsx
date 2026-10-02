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
      console.warn("Catalog fetch notice:", err?.message || err);
      setMedicines(prev => {
        if (prev.length > 0) return prev;
        return [
          {
            _id: "med-fallback-1",
            sku: "MED-PNF-PARA-0001",
            name: "Paracetamol 650mg (Strip of 15 Tablets)",
            brand: "Calpol / Dolo",
            category: "Pain & Fever",
            description: "Fast-acting relief for headache, body aches, and fever.",
            composition: "Paracetamol IP 650mg",
            price: 32,
            stock: 48,
            requiresPrescription: false,
            imageUrl: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80",
            manufacturer: "Micro Labs",
            availableQuantity: 48,
            isPrescriptionRequired: false
          },
          {
            _id: "med-fallback-2",
            sku: "MED-ANT-AZI-0002",
            name: "Azithromycin 500mg (Strip of 5 Tablets)",
            brand: "Azee 500",
            category: "Antibiotics",
            description: "Broad-spectrum macrolide antibiotic for respiratory and throat infections.",
            composition: "Azithromycin 500mg",
            price: 119,
            stock: 35,
            requiresPrescription: true,
            imageUrl: "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=500&q=80",
            manufacturer: "Cipla",
            availableQuantity: 35,
            isPrescriptionRequired: true
          },
          {
            _id: "med-fallback-3",
            sku: "MED-VIT-VITC-0003",
            name: "Vitamin C + Zinc Chewable Tablets (Strip of 15)",
            brand: "Limcee",
            category: "Vitamins & Supplements",
            description: "Daily immunity enhancer with citrus bioflavonoids and essential Zinc.",
            composition: "Ascorbic Acid 500mg + Zinc 5mg",
            price: 45,
            stock: 60,
            requiresPrescription: false,
            imageUrl: "https://images.unsplash.com/photo-1576075796033-848c2a5f3696?w=500&q=80",
            manufacturer: "Abbott",
            availableQuantity: 60,
            isPrescriptionRequired: false
          }
        ];
      });
      setTotalMedicines(prev => prev || 3);
      setTotalPages(1);
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
      const res = await apiClient.get('/api/user/addresses');
      if (Array.isArray(res.data)) {
        const addrs = res.data;
        setAddresses(addrs);
        if (addrs.length > 0) {
          setSelectedAddressId((currentSelected) => {
            if (currentSelected && addrs.some(address => address._id === currentSelected)) {
              return currentSelected;
            }
            const defaultAddr = addrs.find(a => a.isDefault) || addrs[0];
            return defaultAddr?._id || '';
          });
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
        setSelectedAddressId((prevId) => prevId || initial._id);
        return [initial];
      });
    } finally {
      setLoadingAddresses(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadAddresses();
    }
  }, [user, loadAddresses]);

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
      const res = await apiClient.get('/api/orders/history');
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
    if (!user) {
      setMedicineRequests([]);
      setLoadingMedicineRequests(false);
      return;
    }
    try {
      if (!silent) setLoadingMedicineRequests(true);
      const list = await getCustomerMedicineRequests();
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
      if (!silent) setLoadingMedicineRequests(false);
    }
  }, [user]);

  useEffect(() => {
    loadUserMedicineRequests();
    const timer = window.setInterval(() => loadUserMedicineRequests({ silent: true }), 15000);
    return () => window.clearInterval(timer);
  }, [loadUserMedicineRequests]);

  const openRequestModal = (prefill = null) => {
    setRequestPrefillData(prefill);
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
        setRequestModalOpen,
        requestPrefillData,
        openRequestModal,
        activeProposalRequest,
        setActiveProposalRequest,
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
