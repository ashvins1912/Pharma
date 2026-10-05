import React, { useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';

const getDistanceToPickup = (rider, order) => {
  const riderCoordinates = rider.currentLocation?.coordinates;
  const pickupCoordinates = order.location?.coordinates
    || (order.coordinates?.lng != null && order.coordinates?.lat != null
      ? [order.coordinates.lng, order.coordinates.lat]
      : null);

  if (!riderCoordinates || riderCoordinates.length !== 2 || !pickupCoordinates || pickupCoordinates.length !== 2) {
    return null;
  }

  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const [riderLng, riderLat] = riderCoordinates.map(Number);
  const [pickupLng, pickupLat] = pickupCoordinates.map(Number);
  if (![riderLng, riderLat, pickupLng, pickupLat].every(Number.isFinite)) return null;

  const latitudeDelta = toRadians(pickupLat - riderLat);
  const longitudeDelta = toRadians(pickupLng - riderLng);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(riderLat)) * Math.cos(toRadians(pickupLat))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const formatDistance = (distanceInKm) => {
  if (distanceInKm == null) return 'Distance unavailable';
  if (distanceInKm < 1) return `${Math.round(distanceInKm * 1000)} m to pickup`;
  return `${distanceInKm.toFixed(1)} km to pickup`;
};

const getCompactPageWindow = (currentPage, totalPages) => {
  if (totalPages <= 4) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (currentPage <= 2) {
    return [1, 2, 3, '...', totalPages];
  }
  if (currentPage >= totalPages - 1) {
    return [1, '...', totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, '...', currentPage, '...', totalPages];
};

const cleanPhoneForWhatsApp = (phone) => {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

const buildOrderWhatsAppText = (order, targetRole = 'rider') => {
  const shortId = (order._id || '').slice(-6).toUpperCase();
  const customerName = order.customerName || order.addressDetails?.fullName || 'Customer';
  const customerMobile = order.customerMobile || order.addressDetails?.mobile || 'Not provided';
  const address = order.deliveryAddress || 'Address on file';
  const total = order.finalTotal || 0;
  const items = (order.items || []).map(i => `• ${i.name || 'Medicine'} (x${i.quantity || 1})`).join('\n');
  const riderName = order.rider?.riderName || 'Assigned Rider';
  const riderMobile = order.rider?.riderMobile || '';

  if (targetRole === 'rider') {
    return [
      `🛵 ASHVIN PHARMACY DISPATCH — Order #${shortId}`,
      `Status: Assigned for Delivery`,
      `Customer: ${customerName}`,
      `Phone: ${customerMobile}`,
      `Delivery Address: ${address}`,
      `COD Amount to Collect: ₹${total}`,
      items ? `Order Items:\n${items}` : ''
    ].filter(Boolean).join('\n\n');
  }

  return [
    `🚚 ASHVIN PHARMACY — Order #${shortId} Ready for Delivery`,
    `Hello ${customerName}, your medicines are packed and ready for delivery!`,
    riderName ? `Assigned Rider: ${riderName} (${riderMobile})` : '',
    `Delivery Destination: ${address}`,
    `Payable Total (COD): ₹${total}`,
    'Thank you for trusting Ashvin Pharmacy for your healthcare needs.'
  ].filter(Boolean).join('\n\n');
};

const COLUMNS = [
  { id: 'Pending_Review', title: 'Pending Review', color: 'border-amber-500 text-amber-800 bg-amber-50' },
  { id: 'Approved', title: 'Approved', color: 'border-teal-500 text-teal-800 bg-teal-50' },
  { id: 'Rejected', title: 'Rejected', color: 'border-rose-500 text-rose-800 bg-rose-50' },
  { id: 'Processing Order', title: 'Processing Order', color: 'border-amber-500 text-amber-800 bg-amber-50' },
  { id: 'Ready to Dispatch', title: 'Ready to Dispatch', color: 'border-indigo-500 text-indigo-800 bg-indigo-50' },
  { id: 'Dispatched', title: 'Out for Delivery', color: 'border-blue-500 text-blue-800 bg-blue-50' },
  { id: 'Delivered', title: 'Delivered', color: 'border-emerald-500 text-emerald-800 bg-emerald-50' }
];

export default function AdminFulfillmentKanban({ orders, onRefresh }) {
  const { addToast } = useToast();
  const [updatingId, setUpdatingId] = useState(null);
  const [assignRiderModal, setAssignRiderModal] = useState(null);
  const [availableRiders, setAvailableRiders] = useState([]);
  const [loadingAvailableRiders, setLoadingAvailableRiders] = useState(false);
  const [availableRidersError, setAvailableRidersError] = useState(null);
  const [selectedRiderId, setSelectedRiderId] = useState('');
  const [riderSearch, setRiderSearch] = useState('');
  const [verifiedOrderIds, setVerifiedOrderIds] = useState([]);
  const [prescriptionPreview, setPrescriptionPreview] = useState(null);
  const [viewingPrescriptionOrderId, setViewingPrescriptionOrderId] = useState(null);
  const [deliveredPage, setDeliveredPage] = useState(1);
  const [deliveredOrders, setDeliveredOrders] = useState([]);
  const [deliveredPagination, setDeliveredPagination] = useState({ page: 1, limit: 5, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
  const [deliveredLoading, setDeliveredLoading] = useState(true);
  const [deliveredError, setDeliveredError] = useState('');
  const [deliveredRetryKey, setDeliveredRetryKey] = useState(0);
  const [expandedDeliveredOrderId, setExpandedDeliveredOrderId] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [searchOrders, setSearchOrders] = useState([]);
  const [searchPagination, setSearchPagination] = useState({ page: 1, limit: 5, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchRetryKey, setSearchRetryKey] = useState(0);

  // WhatsApp Menu Dropdown and Server Notify States
  const [openWhatsAppMenuOrderId, setOpenWhatsAppMenuOrderId] = useState(null);
  const [notifyingOrderId, setNotifyingOrderId] = useState(null);

  const handleNotifyServer = async (orderId, target = 'all') => {
    try {
      setNotifyingOrderId(String(orderId));
      const res = await apiClient.get(`/api/orders/${orderId}/notify-whatsapp?target=${target}`);
      addToast(res.data?.message || 'Server WhatsApp notification triggered successfully!', 'success');
      setOpenWhatsAppMenuOrderId(null);
    } catch (err) {
      addToast(err.response?.data?.message || err.message || 'Failed to trigger server notification.', 'error');
    } finally {
      setNotifyingOrderId(null);
    }
  };

  const handleCopyWhatsAppText = async (order, targetRole) => {
    try {
      const text = buildOrderWhatsAppText(order, targetRole);
      await navigator.clipboard.writeText(text);
      addToast(`WhatsApp message for ${targetRole} copied to clipboard!`, 'success');
      setOpenWhatsAppMenuOrderId(null);
    } catch {
      addToast('Could not copy to clipboard', 'info');
    }
  };

  useEffect(() => {
    let isCurrentRequest = true;
    setDeliveredLoading(true);
    setDeliveredError('');
    apiClient.get('/api/orders/admin/all', {
      params: { status: 'Delivered', page: deliveredPage, limit: 5 }
    }).then(response => {
      if (!isCurrentRequest) return;
      const data = response.data || {};
      setDeliveredOrders(Array.isArray(data.items) ? data.items : []);
      setDeliveredPagination(data.pagination || { page: deliveredPage, limit: 5, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
    }).catch(error => {
      if (isCurrentRequest) setDeliveredError(error.message || 'Unable to load delivered orders. Please try again.');
    }).finally(() => {
      if (isCurrentRequest) setDeliveredLoading(false);
    });
    return () => { isCurrentRequest = false; };
  }, [deliveredPage, deliveredRetryKey]);

  useEffect(() => {
    if (!appliedSearch) return undefined;
    let isCurrentRequest = true;
    setSearchLoading(true);
    setSearchError('');
    apiClient.get('/api/orders/admin/all', {
      params: { search: appliedSearch, page: searchPagination.page, limit: 5 }
    }).then(response => {
      if (!isCurrentRequest) return;
      const data = response.data || {};
      setSearchOrders(Array.isArray(data.items) ? data.items : []);
      setSearchPagination(data.pagination || { page: 1, limit: 5, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
    }).catch(error => {
      if (isCurrentRequest) {
        setSearchOrders([]);
        setSearchError(error.message || 'Unable to search orders. Please try again.');
      }
    }).finally(() => {
      if (isCurrentRequest) setSearchLoading(false);
    });
    return () => { isCurrentRequest = false; };
  }, [appliedSearch, searchPagination.page, searchRetryKey]);

  const refreshBoard = () => {
    onRefresh?.();
    setDeliveredRetryKey(value => value + 1);
  };

  const changeDeliveredPage = (page) => {
    if (page < 1 || page > deliveredPagination.totalPages || page === deliveredPage) return;
    setDeliveredLoading(true);
    setDeliveredPage(page);
  };

  const submitSearch = (event) => {
    event.preventDefault();
    if (searchLoading) return;
    const query = searchInput.trim();
    if (!query) {
      setSearchError('Please enter an Order ID, mobile number, or email address.');
      return;
    }
    setSearchOrders([]);
    setSearchPagination({ page: 1, limit: 5, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
    setSearchError('');
    setSearchLoading(true);
    setSearchPagination(current => ({ ...current, page: 1 }));
    setAppliedSearch(query);
    setSearchRetryKey(value => value + 1);
  };

  const clearSearch = () => {
    setSearchInput('');
    setAppliedSearch('');
    setSearchOrders([]);
    setSearchError('');
    setSearchPagination({ page: 1, limit: 5, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
  };

  const changeSearchPage = (page) => {
    if (page < 1 || page > searchPagination.totalPages || page === searchPagination.page) return;
    setSearchOrders([]);
    setSearchLoading(true);
    setSearchPagination(current => ({ ...current, page }));
  };

  const retrySearch = () => {
    setSearchLoading(true);
    setSearchRetryKey(value => value + 1);
  };

  useEffect(() => {
    if (!assignRiderModal) return undefined;

    let isCurrentRequest = true;
    setAvailableRiders([]);
    setSelectedRiderId('');
    setRiderSearch('');
    setLoadingAvailableRiders(true);
    setAvailableRidersError(null);

    apiClient.get('/api/admin/riders', { params: { status: 'Available' } })
      .then((res) => {
        if (isCurrentRequest) setAvailableRiders(res.data || []);
      })
      .catch((err) => {
        if (isCurrentRequest) {
          setAvailableRidersError(err.response?.data?.message || err.message || 'Could not load available riders.');
        }
      })
      .finally(() => {
        if (isCurrentRequest) setLoadingAvailableRiders(false);
      });

    return () => {
      isCurrentRequest = false;
    };
  }, [assignRiderModal]);

  const filteredAvailableRiders = useMemo(() => {
    const search = riderSearch.trim().toLowerCase();
    if (!search) return availableRiders;
    return availableRiders.filter((rider) =>
      rider.name.toLowerCase().includes(search) ||
      rider.mobile.toLowerCase().includes(search)
    );
  }, [availableRiders, riderSearch]);

  const handleTransition = async (orderId, newStatus, riderInfo = null) => {
    try {
      setUpdatingId(orderId);
      const res = await apiClient.post('/api/orders/admin/transition', {
        orderId,
        newStatus,
        riderInfo
      });
      addToast(res.data.message || `Order shifted to ${newStatus}`, 'success');
      refreshBoard();
    } catch (err) {
      addToast(err.message || 'State transition failed', 'error');
    } finally {
      setUpdatingId(null);
      setAssignRiderModal(null);
    }
  };

  const reviewOrder = async (order, status) => {
    const orderId = String(order._id);
    if (status === 'Approved' && order.prescriptionRequired && !order.prescriptionUrl) {
      addToast('This order requires a prescription, but no prescription file is attached.', 'warning');
      return;
    }
    if (status === 'Approved' && order.prescriptionUrl && !verifiedOrderIds.includes(orderId)) {
      addToast('Open the attached prescription before approving this order.', 'warning');
      return;
    }
    try {
      setUpdatingId(order._id);
      const res = await apiClient.put(`/api/orders/${encodeURIComponent(order._id)}/review`, {
        status,
        prescriptionVerified: status === 'Approved'
      });
      addToast(res.data.message || `Order ${status.toLowerCase()}.`, 'success');
      setVerifiedOrderIds(prev => prev.filter(id => id !== orderId));
      refreshBoard();
    } catch (err) {
      addToast(err.message || 'Order review failed.', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const dispatchApprovedOrder = async (orderId, riderInfo) => {
    try {
      setUpdatingId(orderId);
      const res = await apiClient.put(`/api/orders/${encodeURIComponent(orderId)}/dispatch`, { riderInfo });
      addToast(res.data.message || 'Order dispatched.', 'success');
      refreshBoard();
    } catch (err) {
      addToast(err.message || 'Order dispatch failed.', 'error');
    } finally {
      setUpdatingId(null);
      setAssignRiderModal(null);
    }
  };

  const viewPrescription = async (order) => {
    if (!order?.prescriptionUrl || viewingPrescriptionOrderId) return;
    try {
      setViewingPrescriptionOrderId(String(order._id));
      const res = await apiClient.get(order.prescriptionUrl, { responseType: 'blob' });
      const contentType = String(res.headers?.['content-type'] || res.data?.type || '').toLowerCase();
      if (!res.data?.size || !/(application\/pdf|image\/)/.test(contentType)) {
        throw new Error('Prescription file could not be previewed.');
      }
      const url = URL.createObjectURL(res.data);
      if (prescriptionPreview) URL.revokeObjectURL(prescriptionPreview);
      setPrescriptionPreview(url);
      const orderId = String(order._id);
      setVerifiedOrderIds(prev => prev.includes(orderId) ? prev : [...prev, orderId]);
    } catch {
      addToast('Could not open the prescription file. Please try again.', 'error');
    } finally {
      setViewingPrescriptionOrderId(null);
    }
  };

  const closePrescriptionPreview = () => {
    if (prescriptionPreview) URL.revokeObjectURL(prescriptionPreview);
    setPrescriptionPreview(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-black text-slate-900">📦 Order Fulfillment Pipeline</h3>
          <p className="text-xs text-slate-500">Live order state machine & dispatch lifecycle</p>
        </div>
        <button
          onClick={refreshBoard}
          className="min-h-11 px-3 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer transition"
        >
          🔄 Refresh Board
        </button>
      </div>

      <form onSubmit={submitSearch} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" role="search">
        <label htmlFor="fulfillment-order-search" className="mb-2 block text-xs font-black text-slate-800">Search orders</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="fulfillment-order-search"
            type="search"
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
            placeholder="Order ID / customer mobile / email"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <button type="submit" disabled={searchLoading} className="min-h-11 rounded-xl bg-blue-600 px-5 text-xs font-black text-white disabled:opacity-50">{searchLoading ? 'Searching…' : 'Search'}</button>
          {appliedSearch && <button type="button" onClick={clearSearch} className="min-h-11 rounded-xl border border-slate-300 px-4 text-xs font-bold text-slate-700">Clear Search</button>}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Searches all fulfillment statuses: Order ID, mobile number, or email.</p>
        {appliedSearch && !searchLoading && !searchError && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
            <span>{searchPagination.total === 0 ? 'No orders found.' : `${searchPagination.total} orders found for “${appliedSearch}”.`}</span>
            {searchPagination.totalPages > 1 && <nav aria-label="Order search pages" className="flex items-center gap-2">
              <button type="button" onClick={() => changeSearchPage(searchPagination.page - 1)} disabled={!searchPagination.hasPreviousPage} className="min-h-9 rounded-lg border px-3 font-bold disabled:opacity-40">Previous</button>
              <span aria-current="page">Page {searchPagination.page} of {searchPagination.totalPages}</span>
              <button type="button" onClick={() => changeSearchPage(searchPagination.page + 1)} disabled={!searchPagination.hasNextPage} className="min-h-9 rounded-lg border px-3 font-bold disabled:opacity-40">Next</button>
            </nav>}
          </div>
        )}
        {searchLoading && <p className="mt-3 text-xs text-slate-500" role="status">Searching orders…</p>}
        {searchError && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-rose-700" role="alert"><span>{searchError}</span><button type="button" onClick={retrySearch} disabled={searchLoading} className="font-bold underline">Try again</button></div>}
      </form>

      {/* 4-Column Kanban Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const searchMode = Boolean(appliedSearch);
          if (searchMode && (searchLoading || searchError || searchPagination.total === 0)) return null;
          const colOrders = searchMode
            ? searchOrders.filter(order => order.orderStatus === col.id)
            : col.id === 'Delivered'
              ? deliveredOrders
            : orders.filter(o => o.orderStatus === col.id);

          return (
            <div key={col.id} className="min-w-0 bg-slate-100/70 border border-slate-200 rounded-3xl p-3 sm:p-4 flex flex-col min-h-[500px]">
              
              {/* Column Header */}
              <div className="flex justify-between items-center pb-3 border-b border-slate-200 mb-3">
                <span className={`min-w-0 text-xs font-black px-2.5 py-1 rounded-xl uppercase tracking-wider break-words ${col.color}`}>
                  {col.title}
                </span>
                <span className="text-xs font-black text-slate-500 bg-white border border-slate-200 min-w-6 h-6 px-1 rounded-full flex items-center justify-center">
                  {col.id === 'Delivered' ? deliveredPagination.total : colOrders.length}
                </span>
              </div>

              {/* Cards Container */}
              <div className="min-w-0 space-y-3 flex-1">
                {searchMode && searchLoading ? (
                  <div className="h-40 flex items-center justify-center text-slate-500 text-xs" role="status">Searching orders...</div>
                ) : searchMode && searchError ? (
                  <div className="h-40 flex items-center justify-center text-slate-400 text-xs">Search results unavailable</div>
                ) : col.id === 'Delivered' && deliveredLoading && !searchMode ? (
                  <div className="h-40 flex items-center justify-center text-slate-500 text-xs" role="status">Loading delivered orders...</div>
                ) : col.id === 'Delivered' && deliveredError && !searchMode ? (
                  <div className="min-h-40 flex flex-col items-center justify-center gap-2 text-center text-xs text-rose-700" role="alert">
                    <p>{deliveredError}</p>
                    <button type="button" onClick={() => setDeliveredRetryKey(value => value + 1)} className="font-bold underline">Try again</button>
                  </div>
                ) : searchMode && !searchLoading && !searchError && searchPagination.total === 0 ? (
                  <div className="h-40 flex items-center justify-center text-slate-400 text-xs italic">No orders found.</div>
                ) : col.id === 'Delivered' && deliveredPagination.total === 0 && !searchMode ? (
                  <div className="h-40 flex items-center justify-center text-slate-400 text-xs italic">No delivered orders found.</div>
                ) : colOrders.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-slate-400 text-xs italic">
                    No orders in this stage
                  </div>
                ) : (
                  colOrders.map((order) => {
                    const orderId = (order._id || '').slice(-6).toUpperCase();
                    const isProcessing = updatingId === order._id;

                    if (col.id === 'Delivered') {
                      const isExpanded = String(expandedDeliveredOrderId) === String(order._id);
                      const customerName = order.customerName || order.addressDetails?.fullName || 'Customer';
                      return (
                        <section key={order._id} className="min-w-0 overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-controls={`delivered-order-${order._id}`}
                            onClick={() => setExpandedDeliveredOrderId(current => current === String(order._id) ? null : String(order._id))}
                            className="flex min-h-14 w-full min-w-0 items-center justify-between gap-2 p-3 text-left hover:bg-emerald-50/60"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="font-black text-xs text-slate-900">#{orderId}</span>
                                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-800">Delivered</span>
                              </span>
                              <span className="mt-1 block truncate text-xs font-semibold text-slate-600">{customerName}</span>
                            </span>
                            <span aria-hidden="true" className="shrink-0 text-slate-500">{isExpanded ? '−' : '+'}</span>
                          </button>
                          {isExpanded && (
                            <div id={`delivered-order-${order._id}`} className="space-y-2 border-t border-slate-100 p-3 text-xs text-slate-600">
                              <p><span className="font-bold">Order ID:</span> {order._id}</p>
                              <p><span className="font-bold">Customer:</span> {customerName}</p>
                              <p><span className="font-bold">Mobile:</span> {order.customerMobile || 'No phone'}</p>
                              {order.deliveryAddress && <p><span className="font-bold">Address:</span> {order.deliveryAddress}</p>}
                              <p><span className="font-bold">Total:</span> ₹{order.finalTotal} COD</p>
                              {order.outForDeliveryAt && <p><span className="font-bold">Out for delivery:</span> {new Date(order.outForDeliveryAt).toLocaleString()}</p>}
                              {order.deliveredAt && <p><span className="font-bold">Delivered:</span> {new Date(order.deliveredAt).toLocaleString()}</p>}
                              {order.rider && <p><span className="font-bold">Rider:</span> {order.rider.riderName || 'Assigned rider'}{order.rider.riderMobile ? ` · ${order.rider.riderMobile}` : ''}</p>}
                              <div className="border-t border-slate-100 pt-2">
                                <p className="mb-1 font-bold">Items</p>
                                {(order.items || []).map((item, index) => (
                                  <p key={`${item.name || 'item'}-${index}`}>{item.name || 'Item'} × {item.quantity || 1}</p>
                                ))}
                              </div>
                            </div>
                          )}
                        </section>
                      );
                    }

                    return (
                      <div
                        key={order._id}
                        className="min-w-0 bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 shadow-sm hover:shadow-md transition space-y-3"
                      >
                        <div className="flex min-w-0 justify-between items-start gap-2">
                          <div className="min-w-0">
                            <span className="font-black text-slate-900 text-xs">#{orderId}</span>
                            <span className="text-xs text-slate-500 block">
                              {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <span className="shrink-0 font-black text-emerald-700 text-xs bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100">
                            ₹{order.finalTotal} COD
                          </span>
                        </div>

                        {/* Customer & Address */}
                        <div className="min-w-0 text-xs text-slate-600 space-y-0.5 border-t border-slate-100 pt-2">
                          <p className="font-bold text-slate-800 break-words">{order.customerName || 'Customer'}</p>
                          <p className="text-slate-500 break-words">{order.customerMobile || 'No phone'}</p>
                          <p className="text-slate-600 mt-1 break-words">📍 {order.deliveryAddress}</p>
                        </div>

                        {/* Items list preview */}
                        <div className="min-w-0 bg-slate-50 p-2 rounded-xl text-xs text-slate-600 space-y-1">
                          {(order.items || []).map((i, idx) => (
                            <div key={idx} className="flex items-start justify-between gap-2">
                              <span className="min-w-0 flex-1 whitespace-normal break-words" title={i.name || 'Medicine name unavailable'}>• {i.name}</span>
                              <span className="shrink-0 font-bold text-slate-700">x{i.quantity}</span>
                            </div>
                          ))}
                        </div>

                        {/* Rider details if assigned */}
                        {order.rider && (
                          <div className="bg-blue-50 p-2 rounded-xl text-xs text-blue-900">
                            <span className="font-bold break-words">🛵 Rider: {order.rider.riderName}</span>
                            <p className="text-blue-700 break-words">{order.rider.riderMobile}</p>
                          </div>
                        )}

                        {/* WhatsApp Menu List with options: Notify Server (GET API) / Open in Chrome */}
                        {(order.rider || col.id === 'Ready to Dispatch' || col.id === 'Dispatched' || col.id === 'Approved') && (() => {
                          const cleanRiderPhone = cleanPhoneForWhatsApp(order.rider?.riderMobile);
                          const cleanCustomerPhone = cleanPhoneForWhatsApp(order.customerMobile || order.addressDetails?.mobile);
                          const isMenuOpen = openWhatsAppMenuOrderId === String(order._id);
                          const isNotifying = notifyingOrderId === String(order._id);

                          return (
                            <div className="relative pt-1 border-t border-slate-100">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setOpenWhatsAppMenuOrderId(prev => prev === String(order._id) ? null : String(order._id))}
                                  className="flex-1 flex items-center justify-between gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold transition cursor-pointer"
                                >
                                  <span className="flex items-center gap-1">
                                    <span>💬</span>
                                    <span>WhatsApp Menu</span>
                                  </span>
                                  <span className="text-[10px] text-emerald-600">
                                    {isMenuOpen ? '▲' : '▼'}
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  title="Quick Notify Server (GET API)"
                                  disabled={isNotifying}
                                  onClick={() => handleNotifyServer(order._id, 'all')}
                                  className="px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-black shadow-xs transition cursor-pointer shrink-0"
                                >
                                  {isNotifying ? '⏳' : '⚡ Notify'}
                                </button>
                              </div>

                              {/* WhatsApp Actions Dropdown Menu List */}
                              {isMenuOpen && (
                                <div className="mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl p-2.5 space-y-2 z-30 animate-fade-in text-xs">
                                  <div className="flex items-center justify-between pb-1 border-b border-slate-100 text-[11px] font-bold text-slate-500">
                                    <span>WhatsApp Notification Options</span>
                                    <button
                                      type="button"
                                      onClick={() => setOpenWhatsAppMenuOrderId(null)}
                                      className="text-slate-400 hover:text-slate-600 font-bold px-1 rounded cursor-pointer"
                                    >
                                      ✕
                                    </button>
                                  </div>

                                  {/* Option 1: Notify Server via GET API */}
                                  <button
                                    type="button"
                                    disabled={isNotifying}
                                    onClick={() => handleNotifyServer(order._id, 'all')}
                                    className="w-full text-left p-2 rounded-xl bg-slate-50 hover:bg-emerald-50 text-slate-800 hover:text-emerald-900 border border-slate-200 hover:border-emerald-200 font-bold transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                                  >
                                    <span className="text-base shrink-0">⚡</span>
                                    <div className="min-w-0 flex-1">
                                      <span className="block font-black text-xs text-slate-900">Notify Server (GET API)</span>
                                      <span className="block text-[10px] text-slate-500 font-normal">Triggers backend WhatsApp dispatch</span>
                                    </div>
                                  </button>

                                  {/* Option 2: Open in Chrome (WhatsApp Web - Rider) */}
                                  {cleanRiderPhone ? (
                                    <a
                                      href={`https://web.whatsapp.com/send?phone=${cleanRiderPhone}&text=${encodeURIComponent(buildOrderWhatsAppText(order, 'rider'))}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={() => setOpenWhatsAppMenuOrderId(null)}
                                      className="w-full text-left p-2 rounded-xl bg-slate-50 hover:bg-blue-50 text-slate-800 hover:text-blue-900 border border-slate-200 hover:border-blue-200 font-bold transition flex items-center gap-2 cursor-pointer no-underline block"
                                    >
                                      <span className="text-base shrink-0">🛵</span>
                                      <div className="min-w-0 flex-1">
                                        <span className="block font-black text-xs text-blue-900">Open in Chrome (Notify Rider)</span>
                                        <span className="block text-[10px] text-blue-600 font-normal truncate">WhatsApp Web: +{cleanRiderPhone}</span>
                                      </div>
                                      <span className="text-[11px] text-blue-400 shrink-0">↗</span>
                                    </a>
                                  ) : (
                                    <div className="p-2 rounded-xl bg-slate-50 text-slate-400 text-[11px] italic">
                                      Assign a delivery rider to notify via WhatsApp Web
                                    </div>
                                  )}

                                  {/* Option 3: Open in Chrome (WhatsApp Web - Customer) */}
                                  {cleanCustomerPhone ? (
                                    <a
                                      href={`https://web.whatsapp.com/send?phone=${cleanCustomerPhone}&text=${encodeURIComponent(buildOrderWhatsAppText(order, 'customer'))}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={() => setOpenWhatsAppMenuOrderId(null)}
                                      className="w-full text-left p-2 rounded-xl bg-slate-50 hover:bg-emerald-50 text-slate-800 hover:text-emerald-900 border border-slate-200 hover:border-emerald-200 font-bold transition flex items-center gap-2 cursor-pointer no-underline block"
                                    >
                                      <span className="text-base shrink-0">👤</span>
                                      <div className="min-w-0 flex-1">
                                        <span className="block font-black text-xs text-emerald-900">Open in Chrome (Notify Customer)</span>
                                        <span className="block text-[10px] text-emerald-600 font-normal truncate">WhatsApp Web: +{cleanCustomerPhone}</span>
                                      </div>
                                      <span className="text-[11px] text-emerald-400 shrink-0">↗</span>
                                    </a>
                                  ) : null}

                                  {/* Option 4: Quick Copy text */}
                                  <div className="flex gap-1.5 pt-1 border-t border-slate-100">
                                    {cleanRiderPhone && (
                                      <button
                                        type="button"
                                        onClick={() => handleCopyWhatsAppText(order, 'rider')}
                                        className="flex-1 py-1 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold rounded-lg transition cursor-pointer"
                                      >
                                        📋 Copy Rider Text
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleCopyWhatsAppText(order, 'customer')}
                                      className="flex-1 py-1 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold rounded-lg transition cursor-pointer"
                                    >
                                      📋 Copy Customer Text
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {col.id === 'Pending_Review' && (
                          <div className="space-y-2 border-t border-slate-100 pt-2">
                            {(order.prescriptionRequired || order.prescriptionUrl) && (
                              <div className="rounded-xl bg-rose-50 p-2 text-xs text-rose-800">
                                <p className="font-bold">{order.prescriptionRequired ? 'Prescription required' : 'Prescription attached'}</p>
                                {order.prescriptionUrl ? (
                                  <button
                                    type="button"
                                    onClick={() => viewPrescription(order)}
                                    disabled={viewingPrescriptionOrderId === String(order._id)}
                                    className="mt-1 min-h-11 font-bold underline disabled:cursor-wait disabled:opacity-60"
                                  >
                                    {viewingPrescriptionOrderId === String(order._id) ? 'Opening prescription…' : 'View uploaded prescription'}
                                  </button>
                                ) : (
                                  <p>Prescription file is missing.</p>
                                )}
                                {order.prescriptionUrl && (
                                  <p className="mt-1 text-[11px] font-semibold text-rose-800">
                                    {verifiedOrderIds.includes(String(order._id))
                                      ? 'Prescription opened. Approval is enabled.'
                                      : 'Open the prescription to enable approval.'}
                                  </p>
                                )}
                              </div>
                            )}
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => reviewOrder(order, 'Approved')}
                                disabled={isProcessing || (order.prescriptionRequired && !order.prescriptionUrl) || (Boolean(order.prescriptionUrl) && !verifiedOrderIds.includes(String(order._id)))}
                                className="min-h-11 flex-1 rounded-xl bg-emerald-600 px-2 py-2 text-xs font-extrabold text-white disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => reviewOrder(order, 'Rejected')}
                                disabled={isProcessing}
                                className="min-h-11 flex-1 rounded-xl bg-rose-600 px-2 py-2 text-xs font-extrabold text-white disabled:opacity-50"
                              >
                                Reject & Release Stock
                              </button>
                            </div>
                          </div>
                        )}

                        {col.id === 'Approved' && (
                          <button
                            type="button"
                            onClick={() => setAssignRiderModal(order)}
                            disabled={isProcessing}
                            className="min-h-11 w-full rounded-xl bg-blue-600 px-2 py-2 text-xs font-extrabold text-white disabled:opacity-50"
                          >
                            Assign Rider & Dispatch
                          </button>
                        )}

                        {(order.outForDeliveryAt || order.deliveredAt) && (
                          <div className="bg-slate-50 p-2 rounded-xl text-xs text-slate-600 space-y-1 break-words">
                            {order.outForDeliveryAt && (
                              <p>
                                <span className="font-bold">Out for delivery:</span>{' '}
                                {new Date(order.outForDeliveryAt).toLocaleString()}
                              </p>
                            )}
                            {order.deliveredAt && (
                              <p>
                                <span className="font-bold">Delivered:</span>{' '}
                                {new Date(order.deliveredAt).toLocaleString()}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Action Buttons according to allowed state transitions */}
                        <div className="pt-2 border-t border-slate-100">
                          {col.id === 'Processing Order' && (
                            <button
                              onClick={() => handleTransition(order._id, 'Ready to Dispatch')}
                              disabled={isProcessing}
                              className="min-h-11 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-2 py-2 rounded-xl transition cursor-pointer shadow-sm shadow-indigo-600/20"
                            >
                              {isProcessing ? 'Verifying...' : '🔬 Verify & Pack → Ready'}
                            </button>
                          )}

                          {col.id === 'Ready to Dispatch' && (
                            order.rider?.riderId ? (
                              <button
                                onClick={() => handleTransition(order._id, 'Dispatched', {
                                  riderId: order.rider.riderId,
                                  riderName: order.rider.riderName,
                                  riderMobile: order.rider.riderMobile
                                })}
                                disabled={isProcessing}
                                className="min-h-11 w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-2 py-2 rounded-xl transition cursor-pointer shadow-sm shadow-blue-600/20"
                              >
                                🛵 Dispatch Assigned Rider
                              </button>
                            ) : (
                              <button
                                onClick={() => setAssignRiderModal(order)}
                                disabled={isProcessing}
                                className="min-h-11 w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-2 py-2 rounded-xl transition cursor-pointer shadow-sm shadow-blue-600/20"
                              >
                                🛵 Assign Rider & Dispatch
                              </button>
                            )
                          )}

                          {col.id === 'Dispatched' && (
                            <button
                              onClick={() => handleTransition(order._id, 'Delivered')}
                              disabled={isProcessing}
                              className="min-h-11 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-2 py-2 rounded-xl transition cursor-pointer shadow-sm shadow-emerald-600/20"
                            >
                              {isProcessing ? 'Recording...' : '🏁 Confirm Delivered & Cash Collected'}
                            </button>
                          )}

                          {col.id === 'Delivered' && (
                            <div className="text-center text-[10px] font-extrabold text-emerald-700 bg-emerald-50 py-1.5 rounded-xl border border-emerald-100">
                              ✓ Completed & Finalized
                            </div>
                          )}
                        </div>

                      </div>
                    );
                  })
                )}
              </div>

              {col.id === 'Delivered' && !searchMode && !deliveredLoading && !deliveredError && deliveredPagination.totalPages > 0 && (
                <nav aria-label="Delivered order pages" className="mt-3 flex items-center justify-between gap-1 border-t border-slate-200 pt-2.5 overflow-x-auto no-scrollbar whitespace-nowrap text-xs">
                  <div className="flex items-center gap-0.5 shrink min-w-0">
                    {/* << First Page */}
                    <button
                      type="button"
                      title="First Page"
                      onClick={() => changeDeliveredPage(1)}
                      disabled={deliveredPage <= 1}
                      className="h-7 w-7 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-[10px] font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30 shrink-0 cursor-pointer"
                    >
                      &lt;&lt;
                    </button>

                    {/* < Previous Page */}
                    <button
                      type="button"
                      title="Previous Page"
                      onClick={() => changeDeliveredPage(deliveredPage - 1)}
                      disabled={!deliveredPagination.hasPreviousPage}
                      className="h-7 w-7 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-[11px] font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30 shrink-0 cursor-pointer"
                    >
                      &lt;
                    </button>

                    {/* Numbered Pages & Ellipsis */}
                    {getCompactPageWindow(deliveredPage, deliveredPagination.totalPages).map((page, idx) => (
                      page === '...' ? (
                        <span key={`ellipsis-${idx}`} className="px-0.5 text-slate-400 font-bold text-[10px] select-none">
                          …
                        </span>
                      ) : (
                        <button
                          key={page}
                          type="button"
                          onClick={() => changeDeliveredPage(page)}
                          aria-current={page === deliveredPage ? 'page' : undefined}
                          className={`h-7 min-w-7 px-1.5 flex items-center justify-center rounded-lg border text-xs font-bold shrink-0 cursor-pointer ${
                            page === deliveredPage
                              ? 'border-emerald-600 bg-emerald-600 text-white font-black'
                              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {page}
                        </button>
                      )
                    ))}

                    {/* > Next Page */}
                    <button
                      type="button"
                      title="Next Page"
                      onClick={() => changeDeliveredPage(deliveredPage + 1)}
                      disabled={!deliveredPagination.hasNextPage}
                      className="h-7 w-7 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-[11px] font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30 shrink-0 cursor-pointer"
                    >
                      &gt;
                    </button>

                    {/* >> Last Page */}
                    <button
                      type="button"
                      title="Last Page"
                      onClick={() => changeDeliveredPage(deliveredPagination.totalPages)}
                      disabled={deliveredPage >= deliveredPagination.totalPages}
                      className="h-7 w-7 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-[10px] font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30 shrink-0 cursor-pointer"
                    >
                      &gt;&gt;
                    </button>
                  </div>

                  {/* Page Indicator: page1 */}
                  <span className="text-[11px] font-extrabold text-slate-600 whitespace-nowrap pl-1 shrink-0">
                    page{deliveredPage}
                  </span>
                </nav>
              )}

            </div>
          );
        })}
      </div>

      {/* Assign Rider Modal */}
      {assignRiderModal && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div role="dialog" aria-modal="true" aria-labelledby="assign-rider-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 space-y-4 shadow-2xl">
            <div className="sticky top-0 z-10 flex justify-between items-center bg-white">
              <h4 id="assign-rider-title" className="text-sm font-black text-slate-900 uppercase tracking-wider">
                🛵 Assign Delivery Rider
              </h4>
              <button
                onClick={() => setAssignRiderModal(null)}
                aria-label="Close rider assignment"
                className="min-h-11 min-w-11 text-slate-500 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Assign dispatch courier for Order #{(assignRiderModal._id || '').slice(-6).toUpperCase()}.
            </p>

            <div className="space-y-3">
              <p className="text-[11px] font-bold text-slate-500">Available riders</p>
              {loadingAvailableRiders && (
                <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Loading available riders...</p>
              )}
              {availableRidersError && (
                <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{availableRidersError}</p>
              )}
              {!loadingAvailableRiders && !availableRidersError && availableRiders.length === 0 && (
                <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">No riders are currently available.</p>
              )}
              {!loadingAvailableRiders && availableRiders.length > 0 && (
                <div className="space-y-2">
                  <label htmlFor="fulfillment-rider-search" className="sr-only">Search available riders</label>
                  <input
                    id="fulfillment-rider-search"
                    type="search"
                    value={riderSearch}
                    onChange={(event) => setRiderSearch(event.target.value)}
                    placeholder="Search by rider name or mobile"
                    className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                  <div className="max-h-56 space-y-2 overflow-y-auto">
                  {filteredAvailableRiders.map((rider) => {
                    const distance = getDistanceToPickup(rider, assignRiderModal);
                    return (
                      <label
                        key={rider.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                          selectedRiderId === rider.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="delivery-rider"
                          value={rider.id}
                          checked={selectedRiderId === rider.id}
                          onChange={() => setSelectedRiderId(rider.id)}
                          className="mt-1 accent-blue-600"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-bold text-slate-800">{rider.name}</span>
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            {rider.mobile}{rider.vehicleType ? ` • ${rider.vehicleType}` : ''}
                          </span>
                          <span className="mt-1 block text-[10px] font-semibold text-blue-700">
                            {formatDistance(distance)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  {filteredAvailableRiders.length === 0 && (
                    <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">No available riders match that search.</p>
                  )}
                  </div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 flex flex-col-reverse sm:flex-row gap-2 bg-white pt-2">
              <button
                onClick={() => setAssignRiderModal(null)}
                className="min-h-11 w-full sm:w-1/2 bg-slate-100 hover:bg-slate-200 text-xs text-slate-700 font-bold py-2 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loadingAvailableRiders || !selectedRiderId || Boolean(availableRidersError)}
                onClick={() => {
                  const rider = availableRiders.find((candidate) => candidate.id === selectedRiderId);
                  if (!rider) return;
                  const riderInfo = {
                    riderId: rider.id,
                    riderName: rider.name,
                    riderMobile: rider.mobile
                  };
                  if (assignRiderModal.orderStatus === 'Approved') {
                    dispatchApprovedOrder(assignRiderModal._id, riderInfo);
                  } else {
                    handleTransition(assignRiderModal._id, 'Dispatched', riderInfo);
                  }
                }}
                className="min-h-11 w-full sm:w-1/2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-2 rounded-xl text-xs shadow-md shadow-blue-600/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Dispatch Order
              </button>
            </div>
          </div>
        </div>
      )}

      {prescriptionPreview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="prescription-review-title" className="flex h-[85dvh] max-h-[calc(100dvh-2rem)] min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white">
            <div className="flex items-center justify-between border-b p-3">
              <h4 id="prescription-review-title" className="text-sm font-bold text-slate-800">Prescription review</h4>
              <button type="button" onClick={closePrescriptionPreview} className="min-h-11 rounded-lg bg-slate-100 px-3 text-sm font-bold">
                Close
              </button>
            </div>
            <iframe title="Uploaded prescription" src={prescriptionPreview} className="min-h-0 flex-1 w-full" />
          </div>
        </div>
      )}
    </div>
  );
}
