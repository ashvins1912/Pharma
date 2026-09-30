import React, { useEffect, useState } from 'react';
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

const COLUMNS = [
  { id: 'Pending_Review', title: 'Pending Review', color: 'border-amber-500 text-amber-800 bg-amber-50' },
  { id: 'Approved', title: 'Approved', color: 'border-teal-500 text-teal-800 bg-teal-50' },
  { id: 'Rejected', title: 'Rejected', color: 'border-rose-500 text-rose-800 bg-rose-50' },
  { id: 'Processing Order', title: 'Processing Order', color: 'border-amber-500 text-amber-800 bg-amber-50' },
  { id: 'Ready to Dispatch', title: 'Ready to Dispatch', color: 'border-indigo-500 text-indigo-800 bg-indigo-50' },
  { id: 'Dispatched', title: 'Dispatched', color: 'border-blue-500 text-blue-800 bg-blue-50' },
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
  const [verifiedOrderIds, setVerifiedOrderIds] = useState([]);
  const [prescriptionPreview, setPrescriptionPreview] = useState(null);

  useEffect(() => {
    if (!assignRiderModal) return undefined;

    let isCurrentRequest = true;
    setAvailableRiders([]);
    setSelectedRiderId('');
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

  const handleTransition = async (orderId, newStatus, riderInfo = null) => {
    try {
      setUpdatingId(orderId);
      const res = await apiClient.post('/api/orders/admin/transition', {
        orderId,
        newStatus,
        riderInfo
      });
      addToast(res.data.message || `Order shifted to ${newStatus}`, 'success');
      onRefresh();
    } catch (err) {
      addToast(err.message || 'State transition failed', 'error');
    } finally {
      setUpdatingId(null);
      setAssignRiderModal(null);
    }
  };

  const reviewOrder = async (order, status) => {
    if (status === 'Approved' && order.prescriptionRequired && !verifiedOrderIds.includes(order._id)) {
      addToast('View and verify the uploaded prescription before approving.', 'warning');
      return;
    }
    try {
      setUpdatingId(order._id);
      const res = await apiClient.put(`/api/orders/${encodeURIComponent(order._id)}/review`, {
        status,
        prescriptionVerified: status === 'Approved'
      });
      addToast(res.data.message || `Order ${status.toLowerCase()}.`, 'success');
      setVerifiedOrderIds(prev => prev.filter(id => id !== order._id));
      onRefresh();
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
      onRefresh();
    } catch (err) {
      addToast(err.message || 'Order dispatch failed.', 'error');
    } finally {
      setUpdatingId(null);
      setAssignRiderModal(null);
    }
  };

  const viewPrescription = async (order) => {
    try {
      const res = await apiClient.get(order.prescriptionUrl, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      setPrescriptionPreview(url);
    } catch (err) {
      addToast(err.message || 'Could not open prescription file.', 'error');
    }
  };

  const closePrescriptionPreview = () => {
    if (prescriptionPreview) URL.revokeObjectURL(prescriptionPreview);
    setPrescriptionPreview(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-base font-black text-slate-900">📦 Order Fulfillment Pipeline</h3>
          <p className="text-xs text-slate-500">Live order state machine & dispatch lifecycle</p>
        </div>
        <button
          onClick={onRefresh}
          className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl cursor-pointer transition"
        >
          🔄 Refresh Board
        </button>
      </div>

      {/* 4-Column Kanban Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const colOrders = orders.filter(o => o.orderStatus === col.id);

          return (
            <div key={col.id} className="bg-slate-100/70 border border-slate-200 rounded-3xl p-4 flex flex-col min-h-[500px]">
              
              {/* Column Header */}
              <div className="flex justify-between items-center pb-3 border-b border-slate-200 mb-3">
                <span className={`text-xs font-black px-2.5 py-1 rounded-xl uppercase tracking-wider ${col.color}`}>
                  {col.title}
                </span>
                <span className="text-xs font-black text-slate-500 bg-white border border-slate-200 w-6 h-6 rounded-full flex items-center justify-center">
                  {colOrders.length}
                </span>
              </div>

              {/* Cards Container */}
              <div className="space-y-3 flex-1 overflow-y-auto">
                {colOrders.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-slate-400 text-xs italic">
                    No orders in this stage
                  </div>
                ) : (
                  colOrders.map((order) => {
                    const orderId = (order._id || '').slice(-6).toUpperCase();
                    const isProcessing = updatingId === order._id;

                    return (
                      <div
                        key={order._id}
                        className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition space-y-3"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-black text-slate-900 text-xs">#{orderId}</span>
                            <span className="text-[10px] text-slate-400 block">
                              {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <span className="font-black text-emerald-600 text-xs bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100">
                            ₹{order.finalTotal} COD
                          </span>
                        </div>

                        {/* Customer & Address */}
                        <div className="text-[11px] text-slate-600 space-y-0.5 border-t border-slate-100 pt-2">
                          <p className="font-bold text-slate-800">{order.customerName || 'Customer'}</p>
                          <p className="text-slate-400">{order.customerMobile || 'No phone'}</p>
                          <p className="text-slate-500 line-clamp-2 mt-1">📍 {order.deliveryAddress}</p>
                        </div>

                        {/* Items list preview */}
                        <div className="bg-slate-50 p-2 rounded-xl text-[10px] text-slate-500 space-y-0.5">
                          {(order.items || []).map((i, idx) => (
                            <div key={idx} className="flex items-start justify-between gap-2">
                              <span className="min-w-0 flex-1 whitespace-normal break-words" title={i.name || 'Medicine name unavailable'}>• {i.name}</span>
                              <span className="shrink-0 font-bold text-slate-700">x{i.quantity}</span>
                            </div>
                          ))}
                        </div>

                        {/* Rider details if assigned */}
                        {order.rider && (
                          <div className="bg-blue-50 p-2 rounded-xl text-[10px] text-blue-900">
                            <span className="font-bold">🛵 Rider: {order.rider.riderName}</span>
                            <p className="text-blue-700">{order.rider.riderMobile}</p>
                          </div>
                        )}

                        {col.id === 'Pending_Review' && (
                          <div className="space-y-2 border-t border-slate-100 pt-2">
                            {order.prescriptionRequired && (
                              <div className="rounded-xl bg-rose-50 p-2 text-[10px] text-rose-800">
                                <p className="font-bold">Prescription required</p>
                                {order.prescriptionUrl ? (
                                  <button
                                    type="button"
                                    onClick={() => viewPrescription(order)}
                                    className="mt-1 font-bold underline"
                                  >
                                    View uploaded prescription
                                  </button>
                                ) : (
                                  <p>Prescription file is missing.</p>
                                )}
                                <label className="mt-2 flex items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    checked={verifiedOrderIds.includes(order._id)}
                                    disabled={!order.prescriptionUrl}
                                    onChange={event => setVerifiedOrderIds(prev =>
                                      event.target.checked
                                        ? [...prev, order._id]
                                        : prev.filter(id => id !== order._id)
                                    )}
                                  />
                                  I verified the prescription
                                </label>
                              </div>
                            )}
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => reviewOrder(order, 'Approved')}
                                disabled={isProcessing || (order.prescriptionRequired && !order.prescriptionUrl)}
                                className="flex-1 rounded-xl bg-emerald-600 py-2 text-[11px] font-extrabold text-white disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => reviewOrder(order, 'Rejected')}
                                disabled={isProcessing}
                                className="flex-1 rounded-xl bg-rose-600 py-2 text-[11px] font-extrabold text-white disabled:opacity-50"
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
                            className="w-full rounded-xl bg-blue-600 py-2 text-[11px] font-extrabold text-white disabled:opacity-50"
                          >
                            Assign Rider & Dispatch
                          </button>
                        )}

                        {(order.outForDeliveryAt || order.deliveredAt) && (
                          <div className="bg-slate-50 p-2 rounded-xl text-[10px] text-slate-600 space-y-1">
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
                              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[11px] py-2 rounded-xl transition cursor-pointer shadow-sm shadow-indigo-600/20"
                            >
                              {isProcessing ? 'Verifying...' : '🔬 Verify & Pack → Ready'}
                            </button>
                          )}

                          {col.id === 'Ready to Dispatch' && (
                            <button
                              onClick={() => setAssignRiderModal(order)}
                              disabled={isProcessing}
                              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-[11px] py-2 rounded-xl transition cursor-pointer shadow-sm shadow-blue-600/20"
                            >
                              🛵 Assign Rider & Dispatch
                            </button>
                          )}

                          {col.id === 'Dispatched' && (
                            <button
                              onClick={() => handleTransition(order._id, 'Delivered')}
                              disabled={isProcessing}
                              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[11px] py-2 rounded-xl transition cursor-pointer shadow-sm shadow-emerald-600/20"
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

            </div>
          );
        })}
      </div>

      {/* Assign Rider Modal */}
      {assignRiderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                🛵 Assign Delivery Rider
              </h4>
              <button
                onClick={() => setAssignRiderModal(null)}
                className="text-slate-400 hover:text-slate-600"
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
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {availableRiders.map((rider) => {
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
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setAssignRiderModal(null)}
                className="w-1/2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 rounded-xl text-xs"
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
                className="w-1/2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-2 rounded-xl text-xs shadow-md shadow-blue-600/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Dispatch Order
              </button>
            </div>
          </div>
        </div>
      )}

      {prescriptionPreview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 p-4">
          <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white">
            <div className="flex items-center justify-between border-b p-3">
              <h4 className="text-sm font-bold text-slate-800">Prescription review</h4>
              <button type="button" onClick={closePrescriptionPreview} className="rounded-lg bg-slate-100 px-3 py-1 text-sm font-bold">
                Close
              </button>
            </div>
            <iframe title="Uploaded prescription" src={prescriptionPreview} className="h-full w-full" />
          </div>
        </div>
      )}
    </div>
  );
}
