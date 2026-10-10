import React, { useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useActionLoading, LOADING_ACTIONS } from '../../context/LoadingContext';
import { useToast } from '../../context/ToastContext';
import { normalizePrescriptionBlob } from '../../utils/prescriptionFile';
import Pagination from '../common/Pagination';

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

const getPageWindow = (currentPage, totalPages) => {
  const visibleCount = Math.min(totalPages, 7);
  const firstPage = Math.max(1, Math.min(currentPage - 3, totalPages - visibleCount + 1));
  return Array.from({ length: visibleCount }, (_, index) => firstPage + index);
};

const COLUMNS = [
  { id: 'Pending_Review', title: 'Pending Review', color: 'border-amber-500 text-amber-800 bg-amber-50' },
  { id: 'Approved', title: 'Approved', color: 'border-teal-500 text-teal-800 bg-teal-50' },
  { id: 'Rejected', title: 'Rejected', color: 'border-rose-500 text-rose-800 bg-rose-50' },
  { id: 'Processing Order', title: 'Processing Order', color: 'border-amber-500 text-amber-800 bg-amber-50' },
  { id: 'Ready to Dispatch', title: 'Ready to Dispatch', color: 'border-blue-500 text-blue-800 bg-blue-50' },
  { id: 'Dispatched', title: 'Out for Delivery', color: 'border-blue-500 text-blue-800 bg-blue-50' },
  { id: 'Delivered', title: 'Delivered', color: 'border-emerald-500 text-emerald-800 bg-emerald-50' }
];

export default function AdminFulfillmentKanban({ orders, onRefresh }) {
  const { addToast } = useToast();
  const { runAction, isActionLoading } = useActionLoading();
  const [updatingId, setUpdatingId] = useState(null);
  const [assignRiderModal, setAssignRiderModal] = useState(null);
  const [availableRiders, setAvailableRiders] = useState([]);
  const [loadingAvailableRiders, setLoadingAvailableRiders] = useState(false);
  const [availableRidersError, setAvailableRidersError] = useState(null);
  const [selectedRiderId, setSelectedRiderId] = useState('');
  const [riderSearch, setRiderSearch] = useState('');
  const [verifiedOrderIds, setVerifiedOrderIds] = useState([]);
  const [prescriptionPreview, setPrescriptionPreview] = useState(null);
  const [prescriptionModalOrder, setPrescriptionModalOrder] = useState(null);
  const [prescriptionPreviewLoading, setPrescriptionPreviewLoading] = useState(false);
  const [prescriptionPreviewError, setPrescriptionPreviewError] = useState('');
  const [imageZoom, setImageZoom] = useState(1);
  const [viewingPrescriptionOrderId, setViewingPrescriptionOrderId] = useState(null);
  const [deliveredPage, setDeliveredPage] = useState(1);
  const [deliveredOrders, setDeliveredOrders] = useState([]);
  const [deliveredPagination, setDeliveredPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
  const [deliveredLoading, setDeliveredLoading] = useState(true);
  const [deliveredError, setDeliveredError] = useState('');
  const [deliveredRetryKey, setDeliveredRetryKey] = useState(0);
  const [expandedDeliveredOrderId, setExpandedDeliveredOrderId] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [searchOrders, setSearchOrders] = useState([]);
  const [searchPagination, setSearchPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchRetryKey, setSearchRetryKey] = useState(0);
  const [approvalReason, setApprovalReason] = useState('Pharmacist clinical review approved');

  // Keep derived state below its source state declarations to avoid a
  // production-build temporal-dead-zone crash in minified bundles.
  const isProcessing = Boolean(updatingId || viewingPrescriptionOrderId)
    || Boolean(
      isActionLoading(LOADING_ACTIONS.APPROVE_PRESCRIPTION)
      || isActionLoading(LOADING_ACTIONS.REJECT_PRESCRIPTION)
    );

  const normalizeOrderStatus = (order) => {
    if (!order) return '';
    const s = String(order.orderStatus || order.status || '').trim();
    if (['Pending_Review', 'pending', 'Pending'].includes(s)) return 'Pending_Review';
    if (['Approved', 'accepted', 'approved'].includes(s)) return 'Approved';
    if (['Processing Order', 'processing', 'Processing', 'Processing_Order', 'ProcessingOrder'].includes(s)) return 'Processing Order';
    if (['Ready to Dispatch', 'ready_to_dispatch', 'Ready_To_Dispatch', 'ready', 'Ready'].includes(s)) return 'Ready to Dispatch';
    if (['Dispatched', 'out_for_delivery', 'dispatched', 'Dispatched_Order'].includes(s)) return 'Dispatched';
    if (['Delivered', 'delivered', 'completed', 'Delivered_Order'].includes(s)) return 'Delivered';
    if (['Rejected', 'rejected', 'Cancelled', 'cancelled'].includes(s)) return 'Rejected';
    return s || 'Pending_Review';
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && prescriptionModalOrder) {
        closePrescriptionPreview();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [prescriptionModalOrder, prescriptionPreview]);

  useEffect(() => {
    if (prescriptionModalOrder) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [prescriptionModalOrder]);

  useEffect(() => {
    let isCurrentRequest = true;
    setDeliveredLoading(true);
    setDeliveredError('');
    apiClient.get('/api/orders/admin/all', {
      params: { status: 'Delivered', page: deliveredPage, limit: 10 }
    }).then(response => {
      if (!isCurrentRequest) return;
      const data = response.data || {};
      setDeliveredOrders(Array.isArray(data.items) ? data.items : []);
      setDeliveredPagination(data.pagination || { page: deliveredPage, limit: 10, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
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
      params: { search: appliedSearch, page: searchPagination.page, limit: 10 }
    }).then(response => {
      if (!isCurrentRequest) return;
      const data = response.data || {};
      setSearchOrders(Array.isArray(data.items) ? data.items : []);
      setSearchPagination(data.pagination || { page: 1, limit: 10, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
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
    setSearchPagination(current => ({ ...current, page: 1 }));
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
    setSearchPagination({ page: 1, limit: 10, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
  };

  const changeSearchPage = (page) => {
    if (page < 1 || page > searchPagination.totalPages || page === searchPagination.page) return;
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
      addToast(err.response?.data?.message || err.message || 'State transition failed', 'error');
    } finally {
      setUpdatingId(null);
      setAssignRiderModal(null);
    }
  };

  const reviewOrder = async (order, status) => {
    const orderId = String(order._id);
    const isMatched = order.prescriptionVerification?.status === 'MATCHED' || order.prescriptionVerification?.manualApproval === true;
    if (status === 'Approved' && order.prescriptionRequired && !isMatched && !order.prescriptionUrl && !order.prescriptionId) {
      addToast('This order requires a prescription verification or approval before approving.', 'warning');
      return;
    }
    if (status === 'Approved' && order.prescriptionRequired && !isMatched && order.prescriptionUrl && !verifiedOrderIds.includes(orderId)) {
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

  const reinitiatePrescriptionVerification = async (order) => {
    try {
      setUpdatingId(order._id);
      const res = await apiClient.post(`/api/orders/admin/${encodeURIComponent(order._id)}/prescription/reinitiate`);
      addToast(res.data.message || 'Prescription verification re-initiated.', 'success');
      if (res.data?.order && prescriptionModalOrder && String(prescriptionModalOrder._id) === String(order._id)) {
        setPrescriptionModalOrder(res.data.order);
      } else if (res.data?.verification && prescriptionModalOrder && String(prescriptionModalOrder._id) === String(order._id)) {
        setPrescriptionModalOrder(prev => prev ? {
          ...prev,
          prescriptionVerification: res.data.verification
        } : null);
      }
      refreshBoard();
    } catch (err) {
      addToast(err.response?.data?.message || err.message || 'Could not re-initiate prescription verification.', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const manualApprovePrescription = async (order, scope = 'order', itemIndex = null, customReason = null) => {
    const orderId = String(order?._id || '');
    let reason = customReason;
    if (reason === null || reason === undefined) {
      reason = window.prompt(
        scope === 'order'
          ? 'Reason for manual order-level prescription approval (optional):'
          : 'Reason for manual medicine approval (optional):',
        'Pharmacist clinical review approved'
      );
      if (reason === null) return;
    }

    try {
      setUpdatingId(order._id);
      const res = await apiClient.post(
        `/api/orders/admin/${encodeURIComponent(order._id)}/prescription/manual-approve`,
        {
          scope,
          itemIndex,
          reason: String(reason || 'Pharmacist clinical review approved').trim()
        }
      );
      addToast(res.data.message || 'Manual prescription approval saved.', 'success');
      setVerifiedOrderIds(prev => prev.includes(orderId) ? prev : [...prev, orderId]);
      if (res.data?.order) {
        if (prescriptionModalOrder && String(prescriptionModalOrder._id) === orderId) {
          setPrescriptionModalOrder(res.data.order);
        }
      } else if (prescriptionModalOrder && String(prescriptionModalOrder._id) === orderId) {
        setPrescriptionModalOrder(prev => {
          if (!prev) return null;
          const prevMed = Array.isArray(prev.prescriptionVerification?.medicines) ? [...prev.prescriptionVerification.medicines] : [];
          if (scope === 'medicine' && itemIndex !== null && prevMed[itemIndex]) {
            prevMed[itemIndex] = {
              ...prevMed[itemIndex],
              status: 'MATCHED',
              manualApproved: true,
              manualApprovedBy: 'Pharmacist'
            };
          }
          return {
            ...prev,
            prescriptionVerification: {
              ...(prev.prescriptionVerification || {}),
              status: scope === 'order' ? 'MATCHED' : (prev.prescriptionVerification?.status || 'MATCHED'),
              manualApproval: true,
              manualApprovedBy: 'Pharmacist',
              medicines: scope === 'order'
                ? prevMed.map(m => ({ ...m, status: 'MATCHED', manualApproved: true, manualApprovedBy: 'Pharmacist' }))
                : prevMed
            }
          };
        });
      }
      refreshBoard();
    } catch (err) {
      addToast(err.response?.data?.message || err.message || 'Manual prescription approval failed.', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const viewPrescription = async (order) => {
    if (!order) return;
    setPrescriptionModalOrder(order);
    const orderId = String(order._id);
    setVerifiedOrderIds(prev => prev.includes(orderId) ? prev : [...prev, orderId]);
    setImageZoom(1);

    const targetUrl = order.prescriptionUrl
      || (order.prescriptionId ? `/api/v1/prescriptions/${encodeURIComponent(order.prescriptionId)}/document` : null)
      || (order.prescriptionId ? `/api/orders/prescriptions/${encodeURIComponent(order.prescriptionId)}` : null);

    if (!targetUrl) {
      setPrescriptionPreview(null);
      setPrescriptionPreviewError('No binary prescription document file is attached to this order. You can still inspect the ordered medicines and record a pharmacist decision.');
      setPrescriptionPreviewLoading(false);
      return;
    }

    if (targetUrl.startsWith('data:') || targetUrl.startsWith('blob:')) {
      const isPdf = targetUrl.toLowerCase().includes('application/pdf');
      setPrescriptionPreview({
        url: targetUrl,
        type: isPdf ? 'application/pdf' : 'image/jpeg'
      });
      setPrescriptionPreviewLoading(false);
      setPrescriptionPreviewError('');
      return;
    }

    setPrescriptionPreviewLoading(true);
    setPrescriptionPreviewError('');

    await runAction(LOADING_ACTIONS.VIEW_PRESCRIPTION, async () => {
      try {
        setViewingPrescriptionOrderId(orderId);
        const res = await apiClient.get(targetUrl, {
          responseType: 'blob',
          headers: { Accept: 'application/pdf,image/*' }
        });
        const contentType = String(
          res.headers?.['content-type'] || res.data?.type || ''
        ).toLowerCase();

        let blob;
        try {
          blob = await normalizePrescriptionBlob(res.data, contentType);
        } catch {
          if (res.data instanceof Blob && res.data.size > 0) {
            blob = res.data;
          } else if (res.data) {
            blob = new Blob([res.data], { type: contentType || 'application/octet-stream' });
          } else {
            throw new Error('Prescription file is empty.');
          }
        }

        const url = URL.createObjectURL(blob);
        if (prescriptionPreview?.url && prescriptionPreview.url.startsWith('blob:')) {
          URL.revokeObjectURL(prescriptionPreview.url);
        }
        setPrescriptionPreview({
          url,
          type: blob.type || contentType
        });
      } catch (loadError) {
        console.warn('Prescription fetch error:', loadError);
        if (targetUrl.startsWith('http') || targetUrl.startsWith('/uploads')) {
          setPrescriptionPreview({
            url: targetUrl,
            type: targetUrl.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'
          });
        } else {
          setPrescriptionPreview(null);
          setPrescriptionPreviewError('Could not load the prescription document file. You can still inspect the order details below and record manual approval.');
        }
      } finally {
        setPrescriptionPreviewLoading(false);
        setViewingPrescriptionOrderId(null);
      }
    });
  };

  const reviewPrescription = async (order, decision, customReason = null) => {
    if (!order?.prescriptionId) return;
    await runAction(decision === 'approve' ? LOADING_ACTIONS.APPROVE_PRESCRIPTION : LOADING_ACTIONS.REJECT_PRESCRIPTION, async () => {
      try {
        const current = await apiClient.get(`/api/v1/prescriptions/${encodeURIComponent(order.prescriptionId)}`);
        const version = current.data?.version || current.data?.data?.version || 1;
        const form = new FormData();
        form.append('expected_version', String(version));
        if (decision === 'reject') {
          let reason = customReason;
          if (reason === null || reason === undefined) {
            reason = window.prompt('Reason for prescription rejection:', 'Prescription unreadable or mismatch');
            if (reason === null) return;
          }
          form.append('reason', String(reason).trim());
        }
        const endpoint = decision === 'approve' ? 'approve' : 'reject';
        await apiClient.post(`/api/v1/prescriptions/${encodeURIComponent(order.prescriptionId)}/review/${endpoint}`, form);
        if (decision === 'approve' && order._id) {
          const conversionForm = new FormData();
          conversionForm.append('order_id', String(order._id));
          await apiClient.post(`/api/v1/prescriptions/${encodeURIComponent(order.prescriptionId)}/convert-to-order`, conversionForm);
        }
        addToast(decision === 'approve' ? 'Prescription approved and converted to order.' : 'Prescription rejected.', decision === 'approve' ? 'success' : 'info');
        if (prescriptionModalOrder && String(prescriptionModalOrder._id) === String(order._id)) {
          setPrescriptionModalOrder(prev => prev ? {
            ...prev,
            prescriptionVerification: {
              ...(prev.prescriptionVerification || {}),
              status: decision === 'approve' ? 'MATCHED' : 'REJECTED'
            }
          } : null);
        }
        await onRefresh();
      } catch (error) {
        addToast(error.message || `Could not ${decision} prescription.`, 'error');
      }
    });
  };

  const closePrescriptionPreview = () => {
    if (prescriptionPreview?.url && prescriptionPreview.url.startsWith('blob:')) {
      URL.revokeObjectURL(prescriptionPreview.url);
    }
    setPrescriptionPreview(null);
    setPrescriptionModalOrder(null);
    setPrescriptionPreviewError('');
    setImageZoom(1);
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
            <Pagination
              page={searchPagination.page}
              totalPages={searchPagination.totalPages}
              total={searchPagination.total}
              pageSize={10}
              onPageChange={changeSearchPage}
              loading={searchLoading}
              label="matching orders"
            />
          </div>
        )}
        {searchLoading && <p className="mt-3 text-xs text-slate-500" role="status">Searching orders…</p>}
        {searchError && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-rose-700" role="alert"><span>{searchError}</span><button type="button" onClick={retrySearch} disabled={searchLoading} className="font-bold underline">Try again</button></div>}
      </form>

      {/* 4-Column Kanban Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const searchMode = Boolean(appliedSearch);
          const colOrders = searchMode
            ? searchOrders.filter(order => normalizeOrderStatus(order) === col.id)
            : col.id === 'Delivered'
              ? deliveredOrders
            : (orders || []).filter(o => normalizeOrderStatus(o) === col.id);

          return (
            <div key={col.id} className="min-w-0 bg-slate-100/70 border border-slate-200 rounded-3xl p-3 sm:p-4 flex flex-col min-h-[500px]">
              
              {/* Column Header */}
              <div className="flex justify-between items-center pb-3 border-b border-slate-200 mb-3">
                <span className={`min-w-0 text-xs font-black px-2.5 py-1 rounded-xl uppercase tracking-wider break-words ${col.color}`}>
                  {col.title}
                </span>
                <span className="text-xs font-black text-slate-500 bg-white border border-slate-200 min-w-6 h-6 px-1 rounded-full flex items-center justify-center">
                  {col.id === 'Delivered' ? (deliveredPagination.total || deliveredOrders.length) : colOrders.length}
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
                          {(order.items || order.medicineItems || []).map((i, idx) => (
                            <div key={idx} className="flex items-start justify-between gap-2">
                              <span className="min-w-0 flex-1 whitespace-normal break-words" title={i.productName || i.name || i.genericName || 'Medicine'}>
                                • {i.productName || i.name || i.genericName || 'Medicine'}
                              </span>
                              <span className="shrink-0 font-bold text-slate-700">x{i.quantity || 1}</span>
                            </div>
                          ))}
                          {(order.items || order.medicineItems || []).length === 0 && (
                            <p className="text-[11px] text-slate-400 italic">No medicines listed</p>
                          )}
                        </div>

                        {/* Rider details if assigned */}
                        {order.rider && (
                          <div className="bg-blue-50 p-2 rounded-xl text-xs text-blue-900">
                            <span className="font-bold break-words">🛵 Rider: {order.rider.riderName}</span>
                            <p className="text-blue-700 break-words">{order.rider.riderMobile}</p>
                          </div>
                        )}

                        {col.id === 'Pending_Review' && (
                          <div className="space-y-2 border-t border-slate-100 pt-2">
                            {(order.prescriptionRequired || order.prescriptionUrl || order.prescriptionId) && (
                              <div className="rounded-xl bg-rose-50 p-2.5 text-xs text-rose-800 space-y-2">
                                <div className="flex items-center justify-between gap-1">
                                  <p className="font-bold">{order.prescriptionRequired ? 'Prescription required' : 'Prescription attached'}</p>
                                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                                    order.prescriptionVerification?.status === 'MATCHED' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                                  }`}>
                                    {order.prescriptionVerification?.status || 'REVIEW_REQUIRED'}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => viewPrescription(order)}
                                  disabled={viewingPrescriptionOrderId === String(order._id) || isActionLoading(LOADING_ACTIONS.VIEW_PRESCRIPTION)}
                                  className="min-h-9 w-full rounded-lg bg-white border border-rose-200 text-rose-900 font-bold text-xs hover:bg-rose-100/50 flex items-center justify-center gap-1.5 transition shadow-sm"
                                >
                                  <span>🩺</span>
                                  <span>{viewingPrescriptionOrderId === String(order._id) ? 'Opening prescription…' : 'View prescription & review'}</span>
                                </button>
                                <p className="text-[11px] font-semibold text-rose-800">
                                  {verifiedOrderIds.includes(String(order._id)) || order.prescriptionVerification?.status === 'MATCHED'
                                    ? '✓ Prescription verified. Approval enabled.'
                                    : 'Open prescription to inspect and approve.'}
                                </p>
                              </div>
                            )}
                            {order.prescriptionRequired && (
                              <div className="rounded-xl border border-amber-200 bg-amber-50 p-2 space-y-2">
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => reinitiatePrescriptionVerification(order)}
                                    disabled={isProcessing}
                                    className="min-h-9 rounded-lg border border-amber-300 bg-white px-3 text-[11px] font-extrabold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                                  >
                                    🔄 Re-initiate Verification
                                  </button>
                                  {order.prescriptionId && (
                                    <>
                                      <button type="button" onClick={() => reviewPrescription(order, 'approve')}
                                        disabled={isActionLoading(LOADING_ACTIONS.APPROVE_PRESCRIPTION) || isActionLoading(LOADING_ACTIONS.REJECT_PRESCRIPTION)}
                                        className="min-h-9 rounded-lg bg-emerald-600 px-3 text-[11px] font-extrabold text-white disabled:opacity-50">
                                        {isActionLoading(LOADING_ACTIONS.APPROVE_PRESCRIPTION) ? 'Approving…' : '✓ Approve Prescription'}
                                      </button>
                                      <button type="button" onClick={() => reviewPrescription(order, 'reject')}
                                        disabled={isActionLoading(LOADING_ACTIONS.APPROVE_PRESCRIPTION) || isActionLoading(LOADING_ACTIONS.REJECT_PRESCRIPTION)}
                                        className="min-h-9 rounded-lg bg-rose-50 px-3 text-[11px] font-extrabold text-rose-700 disabled:opacity-50">
                                        {isActionLoading(LOADING_ACTIONS.REJECT_PRESCRIPTION) ? 'Rejecting…' : '✕ Reject Prescription'}
                                      </button>
                                    </>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => manualApprovePrescription(order, 'order')}
                                    disabled={isProcessing}
                                    className="min-h-9 rounded-lg bg-amber-600 px-3 text-[11px] font-extrabold text-white hover:bg-amber-700 disabled:opacity-50"
                                  >
                                    ✓ Manual Approve Order
                                  </button>
                                </div>
                                <div className="space-y-1.5">
                                  {(order.items || order.medicineItems || []).map((item, index) => (
                                    <div key={`${item.productId || item.medicineId || item.name || 'medicine'}-${index}`} className="flex items-center justify-between gap-2 rounded-lg bg-white/80 px-2 py-1.5">
                                      <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-700">
                                        {index + 1}. {item.productName || item.name || item.genericName || 'Medicine'}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => manualApprovePrescription(order, 'medicine', index)}
                                        disabled={isProcessing}
                                        className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-extrabold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                      >
                                        Approve medicine
                                      </button>
                                    </div>
                                  ))}
                                </div>
                                <p className="text-[10px] text-amber-800">
                                  Use manual approval only after reviewing the uploaded prescription. Order fulfillment remains blocked until every required medicine is approved.
                                </p>
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

                        {col.id === 'Processing Order' && Boolean(order.prescriptionUrl || order.prescriptionId) && (
                          order.prescriptionVerification?.status !== 'MATCHED' ? (
                            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                              <div className="flex items-center gap-1.5">
                                <span className="text-amber-700 font-bold">⚠️</span>
                                <p className="text-xs font-extrabold text-amber-900">
                                  Prescription review is blocking fulfillment
                                </p>
                              </div>
                              <p className="text-[11px] text-amber-800">
                                Status: <strong className="font-bold">{order.prescriptionVerification?.status || 'REVIEW_REQUIRED'}</strong>.
                                Open the prescription, re-queue extraction, or record an explicit pharmacist decision.
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => viewPrescription(order)}
                                  disabled={isProcessing || viewingPrescriptionOrderId === String(order._id)}
                                  className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-[11px] font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-50 shadow-sm"
                                >
                                  {viewingPrescriptionOrderId === String(order._id) ? 'Opening…' : '👁️ View prescription'}
                                </button>
                                {order.prescriptionId && (
                                  <button
                                    type="button"
                                    onClick={() => reinitiatePrescriptionVerification(order)}
                                    disabled={isProcessing}
                                    className="min-h-9 rounded-lg border border-amber-300 bg-white px-3 text-[11px] font-extrabold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                                  >
                                    🔄 Re-initiate extraction
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => viewPrescription(order)}
                                  disabled={isProcessing}
                                  className="min-h-9 rounded-lg bg-emerald-600 px-3 text-[11px] font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
                                >
                                  ✓ Manual review & approve
                                </button>
                              </div>
                              <p className="text-[10px] text-amber-800">
                                Manual approval must only be used after reviewing the actual prescription. Dispatch remains blocked until the backend records MATCHED verification.
                              </p>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                                <span>✓</span>
                                <span>Prescription Verified (MATCHED)</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => viewPrescription(order)}
                                className="text-[11px] font-bold text-emerald-700 hover:underline"
                              >
                                View prescription
                              </button>
                            </div>
                          )
                        )}

                        {col.id === 'Processing Order' && order.prescriptionRequired && !order.prescriptionUrl && !order.prescriptionId && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
                            Prescription upload is required before dispatch. No prescription service call or manual-review action is available until a document is uploaded.
                          </div>
                        )}

                        {col.id !== 'Pending_Review' && col.id !== 'Processing Order' && Boolean(order.prescriptionUrl || order.prescriptionId) && (
                          <div className="flex items-center justify-between text-[11px] bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
                            <span className="font-semibold text-slate-600">
                              📄 Prescription:{' '}
                              <strong className={order.prescriptionVerification?.status === 'MATCHED' ? 'text-emerald-700' : 'text-amber-700'}>
                                {order.prescriptionVerification?.status || 'Attached'}
                              </strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => viewPrescription(order)}
                              className="font-bold text-blue-600 hover:text-blue-800 underline"
                            >
                              View
                            </button>
                          </div>
                        )}

                        {/* Action Buttons according to allowed state transitions */}
                        <div className="pt-2 border-t border-slate-100">
                          {col.id === 'Processing Order' && (
                            <div className="space-y-1">
                              <button
                                onClick={() => handleTransition(order._id, 'Ready to Dispatch')}
                                disabled={isProcessing || (order.prescriptionRequired && order.prescriptionVerification?.status !== 'MATCHED')}
                                className="min-h-11 w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-2 py-2 rounded-xl transition cursor-pointer shadow-sm shadow-blue-600/20 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isProcessing ? 'Verifying...' : '🔬 Verify & Pack → Ready'}
                              </button>
                              {order.prescriptionRequired && !order.prescriptionUrl && !order.prescriptionId && (
                                <p className="text-[10px] text-center text-amber-800 font-bold">
                                  Upload a prescription before dispatch; no prescription review service is needed yet.
                                </p>
                              )}
                              {order.prescriptionRequired && (order.prescriptionUrl || order.prescriptionId) && order.prescriptionVerification?.status !== 'MATCHED' && (
                                <p className="text-[10px] text-center text-amber-800 font-bold">
                                  Uploaded prescription must be verified before dispatch
                                </p>
                              )}
                            </div>
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

              {col.id === 'Delivered' && !searchMode && !deliveredLoading && !deliveredError && (
                <Pagination
                  page={deliveredPagination.page || deliveredPage}
                  totalPages={deliveredPagination.totalPages}
                  total={deliveredPagination.total}
                  pageSize={10}
                  onPageChange={(page) => changeDeliveredPage(page)}
                  loading={deliveredLoading}
                  label="delivered orders"
                />
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

      {prescriptionModalOrder && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/75 backdrop-blur-sm p-2 sm:p-4 animate-fade-in"
          onClick={(event) => {
            if (event.target === event.currentTarget) closePrescriptionPreview();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="prescription-review-modal-title"
            className="flex h-[92dvh] w-full max-w-6xl min-h-0 flex-col overflow-hidden rounded-3xl bg-white shadow-2xl border border-slate-200"
          >
            {/* Modal Header */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/90 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 font-bold text-lg">
                  🩺
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 id="prescription-review-modal-title" className="text-sm sm:text-base font-black text-slate-900 truncate">
                      Prescription Review & Verification
                    </h4>
                    <span className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs font-black text-blue-700 border border-blue-200 font-mono">
                      #{String(prescriptionModalOrder._id).slice(-6).toUpperCase()}
                    </span>
                    <span className={`rounded-lg px-2 py-0.5 text-xs font-black border ${
                      prescriptionModalOrder.prescriptionVerification?.status === 'MATCHED'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : prescriptionModalOrder.prescriptionVerification?.status === 'REJECTED'
                        ? 'bg-rose-50 text-rose-800 border-rose-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}>
                      {prescriptionModalOrder.prescriptionVerification?.status || 'REVIEW_REQUIRED'}
                    </span>
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-500 truncate">
                    Stage: <strong className="text-slate-700">{prescriptionModalOrder.orderStatus}</strong> • Customer: <span className="font-semibold text-slate-700">{prescriptionModalOrder.customerName || prescriptionModalOrder.addressDetails?.fullName || 'Customer'}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {prescriptionPreview?.url && (
                  <a
                    href={prescriptionPreview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm"
                  >
                    <span>⬇</span>
                    <span>Open in New Tab</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={closePrescriptionPreview}
                  aria-label="Close prescription review"
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-200/80 text-slate-700 hover:bg-slate-300 transition font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body - 2 Columns */}
            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-12 overflow-hidden bg-slate-100/50">
              {/* Left Column: Prescription Document Viewer */}
              <div className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-100 lg:col-span-7">
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <span>📄</span>
                    <span>Prescription Document</span>
                  </span>
                  {prescriptionPreview?.type?.startsWith('image/') && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setImageZoom(z => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                        className="h-7 w-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center font-bold text-slate-700 transition"
                        title="Zoom Out"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={() => setImageZoom(1)}
                        className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-[11px] text-slate-700 transition"
                        title="Reset Zoom"
                      >
                        {Math.round(imageZoom * 100)}%
                      </button>
                      <button
                        type="button"
                        onClick={() => setImageZoom(z => Math.min(3, Number((z + 0.25).toFixed(2))))}
                        className="h-7 w-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center font-bold text-slate-700 transition"
                        title="Zoom In"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex min-h-[320px] flex-1 items-center justify-center overflow-auto p-3 sm:p-4">
                  {prescriptionPreviewLoading ? (
                    <div className="flex flex-col items-center gap-3 text-slate-500 py-12" role="status">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                      <p className="text-xs font-bold">Loading prescription document…</p>
                    </div>
                  ) : prescriptionPreview?.url ? (
                    prescriptionPreview.type?.startsWith('image/') ? (
                      <div className="flex h-full w-full items-center justify-center overflow-auto rounded-2xl bg-slate-900/10 p-2">
                        <img
                          src={prescriptionPreview.url}
                          alt="Prescription document preview"
                          style={{
                            transform: `scale(${imageZoom})`,
                            transformOrigin: 'center center',
                            transition: 'transform 0.15s ease-out'
                          }}
                          className="max-h-full max-w-full rounded-xl object-contain shadow-lg"
                        />
                      </div>
                    ) : (
                      <div className="h-full w-full flex flex-col rounded-2xl overflow-hidden border border-slate-200 bg-white">
                        <iframe
                          title="Uploaded prescription document"
                          src={prescriptionPreview.url}
                          className="h-full w-full min-h-[350px] border-0"
                        />
                      </div>
                    )
                  ) : (
                    <div className="flex flex-col items-center justify-center max-w-md p-6 text-center space-y-3 rounded-2xl border border-dashed border-slate-300 bg-white">
                      <span className="text-3xl">📄</span>
                      <p className="text-sm font-bold text-slate-800">
                        {prescriptionPreviewError || 'No binary document preview is linked.'}
                      </p>
                      <p className="text-xs text-slate-500">
                        You can still verify all prescribed medicines against the order items and record an explicit pharmacist approval decision.
                      </p>
                      {prescriptionModalOrder.prescriptionUrl && (
                        <button
                          type="button"
                          onClick={() => viewPrescription(prescriptionModalOrder)}
                          className="rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100"
                        >
                          🔄 Retry Loading File
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Order Details, Diagnostics & Pharmacist Decision */}
              <div className="flex min-h-0 flex-col overflow-y-auto bg-white lg:col-span-5">
                {/* 1. Fulfillment Gate Banner */}
                {prescriptionModalOrder.prescriptionVerification?.status !== 'MATCHED' ? (
                  <div className="m-3 sm:m-4 mb-2 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-600 font-bold text-sm">⚠️</span>
                      <span className="text-xs font-black text-amber-900">
                        Prescription review is blocking fulfillment
                      </span>
                    </div>
                    <p className="text-xs text-amber-800">
                      Status: <strong>{prescriptionModalOrder.prescriptionVerification?.status || 'REVIEW_REQUIRED'}</strong>.
                      Verify medicines against prescription, re-queue extraction, or record an explicit pharmacist decision.
                    </p>
                    {prescriptionModalOrder.prescriptionVerification?.issues?.length > 0 && (
                      <ul className="text-[11px] text-amber-800 list-disc list-inside space-y-0.5 pt-1">
                        {prescriptionModalOrder.prescriptionVerification.issues.map((issue, idx) => (
                          <li key={idx}>{issue}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div className="m-3 sm:m-4 mb-2 rounded-2xl border border-emerald-300 bg-emerald-50 p-3.5 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold text-sm">✓</span>
                      <span className="text-xs font-black text-emerald-900">
                        Prescription verification passed
                      </span>
                    </div>
                    <p className="text-xs text-emerald-800">
                      Status: <strong>MATCHED</strong>.
                      {prescriptionModalOrder.prescriptionVerification?.manualApproved && (
                        <span> Manually approved by {prescriptionModalOrder.prescriptionVerification.manualApprovedBy || 'Pharmacist'}.</span>
                      )}
                    </p>
                  </div>
                )}

                {/* 2. Order & Patient Info Card */}
                <div className="mx-3 sm:mx-4 my-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:p-3.5 space-y-2 text-xs">
                  <div className="flex justify-between items-center border-b border-slate-200 pb-1.5">
                    <span className="font-extrabold text-slate-500 uppercase text-[10px] tracking-wider">Order & Customer</span>
                    <span className="font-mono text-slate-500 text-[11px]">ID: {prescriptionModalOrder._id}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-slate-700">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Customer</span>
                      <span className="font-bold text-slate-900">{prescriptionModalOrder.customerName || prescriptionModalOrder.addressDetails?.fullName || 'Customer'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Phone</span>
                      <span className="font-bold text-slate-900">{prescriptionModalOrder.customerMobile || prescriptionModalOrder.addressDetails?.phone || 'No phone'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Total Amount</span>
                      <span className="font-bold text-emerald-700">₹{prescriptionModalOrder.finalTotal ?? prescriptionModalOrder.totalAmount} COD</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Payment Method</span>
                      <span className="font-bold text-slate-900">{prescriptionModalOrder.paymentMethod || 'Cash on Delivery'}</span>
                    </div>
                  </div>
                  {prescriptionModalOrder.patientPuid && (
                    <div className="pt-1 border-t border-slate-200">
                      <span className="text-slate-400 text-[10px] block">Patient Profile</span>
                      <span className="font-semibold text-blue-700">PUID: {prescriptionModalOrder.patientPuid}</span>
                    </div>
                  )}
                  {prescriptionModalOrder.deliveryAddress && (
                    <div className="pt-1 border-t border-slate-200">
                      <span className="text-slate-400 text-[10px] block">Delivery Address</span>
                      <span className="text-slate-700">📍 {prescriptionModalOrder.deliveryAddress}</span>
                    </div>
                  )}
                </div>

                {/* 3. Items & Extraction Matching Table */}
                <div className="mx-3 sm:mx-4 my-2 flex-1 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-black text-slate-900 text-xs uppercase tracking-wider">
                      Ordered Medicines ({(prescriptionModalOrder.items || prescriptionModalOrder.medicineItems || []).length})
                    </span>
                    <span className="text-[11px] text-slate-500">Cross-reference with document</span>
                  </div>
                  <div className="space-y-1.5">
                    {(prescriptionModalOrder.items || prescriptionModalOrder.medicineItems || []).map((item, index) => {
                      const medVerification = prescriptionModalOrder.prescriptionVerification?.medicines?.[index];
                      const isItemMatched = prescriptionModalOrder.prescriptionVerification?.status === 'MATCHED'
                        || item.manualApproved
                        || medVerification?.status === 'MATCHED'
                        || medVerification?.manualApproved;
                      return (
                        <div
                          key={index}
                          className={`rounded-xl border p-2.5 transition flex items-center justify-between gap-2 ${
                            isItemMatched ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs text-slate-800">
                                {index + 1}. {item.productName || item.name || item.genericName || 'Medicine'}
                              </span>
                              <span className="text-xs text-slate-500 font-semibold">×{item.quantity || 1}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px]">
                              <span className={`font-bold ${isItemMatched ? 'text-emerald-700' : 'text-amber-700'}`}>
                                {isItemMatched ? '✓ MATCHED' : '⚠️ REVIEW REQUIRED'}
                              </span>
                              {medVerification?.manualApprovedBy && (
                                <span className="text-slate-400 text-[10px]">
                                  Approved by {medVerification.manualApprovedBy}
                                </span>
                              )}
                            </div>
                          </div>

                          {!isItemMatched && (
                            <button
                              type="button"
                              onClick={() => manualApprovePrescription(prescriptionModalOrder, 'medicine', index, approvalReason)}
                              disabled={isProcessing}
                              className="shrink-0 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 transition shadow-sm"
                            >
                              Approve
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 4. Pharmacist Decision & Actions */}
                <div className="p-3 sm:p-4 border-t border-slate-200 bg-slate-50 space-y-2 mt-auto">
                  <div>
                    <label htmlFor="modal-approval-reason" className="block text-[11px] font-bold text-slate-700 mb-1">
                      Pharmacist Clinical Decision Note (optional):
                    </label>
                    <input
                      id="modal-approval-reason"
                      type="text"
                      value={approvalReason}
                      onChange={e => setApprovalReason(e.target.value)}
                      placeholder="e.g. Doctor prescription verified, correct dosage"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => manualApprovePrescription(prescriptionModalOrder, 'order', null, approvalReason)}
                      disabled={isProcessing}
                      className="min-h-10 flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-3 py-2 transition shadow-md shadow-emerald-600/20 disabled:opacity-50"
                    >
                      {updatingId === prescriptionModalOrder._id ? 'Saving…' : '✓ Approve Prescription & Order'}
                    </button>

                    {prescriptionModalOrder.prescriptionId && (
                      <button
                        type="button"
                        onClick={() => reviewPrescription(prescriptionModalOrder, 'reject', approvalReason || 'Prescription rejected by pharmacist')}
                        disabled={isProcessing}
                        className="min-h-10 rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 font-extrabold text-xs px-3 py-2 transition disabled:opacity-50"
                      >
                        ✕ Reject
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => reinitiatePrescriptionVerification(prescriptionModalOrder)}
                      disabled={isProcessing}
                      className="min-h-10 rounded-xl border border-amber-300 bg-white hover:bg-amber-50 text-amber-900 font-extrabold text-xs px-3 py-2 transition disabled:opacity-50"
                    >
                      🔄 Re-queue
                    </button>
                  </div>

                  {prescriptionModalOrder.orderStatus === 'Pending_Review' && (
                    <div className="flex gap-2 pt-1 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() => {
                          reviewOrder(prescriptionModalOrder, 'Approved');
                          closePrescriptionPreview();
                        }}
                        disabled={isProcessing}
                        className="min-h-9 flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs disabled:opacity-50"
                      >
                        Approve Order Stage
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          reviewOrder(prescriptionModalOrder, 'Rejected');
                          closePrescriptionPreview();
                        }}
                        disabled={isProcessing}
                        className="min-h-9 flex-1 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs disabled:opacity-50"
                      >
                        Reject Order
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
