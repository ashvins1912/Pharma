import React, { useState, useEffect } from 'react';
import apiClient from '../../../api/apiClient';
import { useToast } from '../../../context/ToastContext';

export default function RiderTerminal({ riderId, onClose }) {
  const { addToast } = useToast();
  const [rider, setRider] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('offline');
  const [pendingOrders, setPendingOrders] = useState([]);
  const [activeOrder, setActiveOrder] = useState(null);
  const [countdown, setCountdown] = useState(30);
  const [currentAlert, setCurrentAlert] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  const [verifyingDelivery, setVerifyingDelivery] = useState(false);
  const [gpsCoords, setGpsCoords] = useState({ lat: 12.9716, lng: 77.5946 });
  const [isTracking, setIsTracking] = useState(false);

  // Fetch rider profile and pending orders within 3km 2dsphere radius
  const fetchRiderData = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/api/admin/riders');
      const ridersList = res.data || [];
      const currentRider = riderId ? ridersList.find(r => r._id === riderId) : ridersList[0];
      if (currentRider) {
        setRider(currentRider);
        setStatus(currentRider.status || 'offline');
        if (currentRider.currentLocation?.coordinates) {
          setGpsCoords({
            lng: currentRider.currentLocation.coordinates[0],
            lat: currentRider.currentLocation.coordinates[1]
          });
        }
      }

      // Fetch pending orders for delivery dispatch
      const ordersRes = await apiClient.get('/api/admin/orders');
      const allOrders = ordersRes.data?.orders || ordersRes.data || [];
      const pending = allOrders.filter(o => o.status === 'pending' || o.status === 'assigned');
      setPendingOrders(pending);
      const activeDelivery = allOrders.find(order =>
        ['dispatched', 'out_for_delivery'].includes(String(order.orderStatus || order.status || '').toLowerCase())
        && String(order.rider?.riderId || order.riderId || '') === String(currentRider?._id || '')
      );
      setActiveOrder(previous => {
        const refreshed = previous && allOrders.find(order => String(order._id) === String(previous._id));
        if (refreshed) {
          const refreshedStatus = String(refreshed.orderStatus || refreshed.status || '').toLowerCase();
          return ['delivered', 'cancelled', 'canceled'].includes(refreshedStatus) ? null : refreshed;
        }
        return previous || activeDelivery || null;
      });
      if (pending.length > 0 && !currentAlert && status === 'online') {
        setCurrentAlert(pending[0]);
        setCountdown(30);
      }
    } catch (error) {
      console.error('Error fetching rider terminal data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRiderData();
    const interval = setInterval(fetchRiderData, 10000);
    return () => clearInterval(interval);
  }, [riderId, status]);

  // Handle geolocation tracking and 2dsphere GPS telemetry push
  useEffect(() => {
    if (status !== 'online' && status !== 'busy') {
      setIsTracking(false);
      return;
    }

    setIsTracking(true);
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setGpsCoords({ lat: latitude, lng: longitude });
        if (rider?._id) {
          try {
            await apiClient.patch(`/api/admin/riders/${rider._id}/location`, {
              lat: latitude,
              lng: longitude
            });
          } catch (err) {
            console.warn('GPS telemetry update note:', err);
          }
        }
      },
      (error) => console.warn('Geolocation error:', error),
      { enableHighAccuracy: true, maximumAge: 0 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [status, rider?._id]);

  // Countdown timer ticker for incoming alert
  useEffect(() => {
    if (!currentAlert || countdown <= 0) {
      if (countdown <= 0 && currentAlert) {
        handleRejectOrder();
      }
      return;
    }
    const timer = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown, currentAlert]);

  const handleToggleStatus = async (newStatus) => {
    if (!rider?._id) {
      addToast('No rider profile selected for terminal control.', 'warning');
      return;
    }
    try {
      await apiClient.patch(`/api/admin/riders/${rider._id}/status`, { status: newStatus });
      setStatus(newStatus);
      addToast(`Rider duty status updated to ${newStatus.toUpperCase()}`, 'success');
      fetchRiderData();
    } catch (error) {
      addToast(error.response?.data?.message || 'Failed to update status', 'error');
    }
  };

  const handleAcceptOrder = (order) => {
    setActiveOrder(order);
    setCurrentAlert(null);
    addToast(`Order #${order._id?.slice(-6)} accepted! Proceeding to Dark Store pickup.`, 'success');
  };

  const handleRejectOrder = () => {
    addToast('Order alert dismissed/timed out.', 'info');
    setCurrentAlert(null);
    // Cycle to next pending order if available
    const remaining = pendingOrders.filter(o => o._id !== currentAlert?._id);
    if (remaining.length > 0 && status === 'online') {
      setCurrentAlert(remaining[0]);
      setCountdown(30);
    }
  };

  const handleCompleteOrder = async () => {
    if (!activeOrder?._id || !/^\d{4}$/.test(otpCode)) {
      addToast('Enter the 4-digit code shared by the customer.', 'warning');
      return;
    }
    const assignedRiderId = activeOrder.rider?.riderId || activeOrder.riderId || rider?._id;
    if (!assignedRiderId) {
      addToast('This order does not have an assigned rider. Ask the pharmacy to assign it first.', 'warning');
      return;
    }
    setVerifyingDelivery(true);
    try {
      const response = await apiClient.post(`/api/orders/${activeOrder._id}/verify-delivery`, {
        otp: otpCode,
        riderId: assignedRiderId
      });
      addToast(response.data?.message || 'Delivery verified and order completed.', 'success');
      setActiveOrder(null);
      setOtpCode('');
      await fetchRiderData();
    } catch (error) {
      addToast(error.response?.data?.message || 'Delivery verification failed. Check the code and order assignment.', 'error');
    } finally {
      setVerifyingDelivery(false);
    }
  };

  if (loading && !rider) {
    return (
      <div className="p-8 text-center text-slate-500">
        <span className="inline-block animate-spin text-2xl mb-2">⏳</span>
        <p className="text-sm font-bold">Initializing Rider Terminal & 2dsphere Geolocation Index...</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-2xl border border-slate-800 space-y-6 max-w-4xl mx-auto">
      {/* Header & Status Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🛵</span>
            <h2 className="text-xl font-black tracking-tight text-white">
              {rider ? rider.name : 'Rider Terminal (GPS Proximity)'}
            </h2>
            <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400 font-bold">
              {rider?.vehicleType || 'EV Scooter'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Mobile: {rider?.mobile || 'N/A'} • 2dsphere Geolocation: [{gpsCoords.lng.toFixed(4)}, {gpsCoords.lat.toFixed(4)}] {isTracking && '🟢 Live Tracking Active'}
          </p>
        </div>

        {/* Online / Offline Toggle */}
        <div className="flex items-center gap-2 bg-slate-800 p-1.5 rounded-2xl border border-slate-700">
          <button
            onClick={() => handleToggleStatus('offline')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
              status === 'offline' ? 'bg-red-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            🔴 Offline
          </button>
          <button
            onClick={() => handleToggleStatus('online')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
              status === 'online' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            🟢 Online
          </button>
          <button
            onClick={() => handleToggleStatus('busy')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
              status === 'busy' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            🟡 Busy
          </button>
        </div>
      </div>

      {/* Main Grid: Pending Orders & Active Execution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pending Orders Column */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span>📦 Pending Orders (2dsphere 3km Match)</span>
              <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-xs">
                {pendingOrders.length}
              </span>
            </h3>
          </div>

          {pendingOrders.length === 0 ? (
            <div className="bg-slate-800/50 border border-slate-800 rounded-2xl p-6 text-center text-slate-400 text-xs">
              No pending orders in your immediate 3km radius. Stay online for instant broadcast alerts!
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {pendingOrders.map((ord) => (
                <div key={ord._id} className="bg-slate-800 border border-slate-700 rounded-2xl p-4 space-y-3 shadow-md hover:border-blue-500 transition">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-black uppercase text-blue-400">Order #{ord._id?.slice(-6)}</span>
                      <p className="text-xs font-bold text-white mt-0.5">{ord.items?.length || 1} items • ₹{ord.totalAmount || 350}</p>
                    </div>
                    <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-[10px] font-black rounded-lg">
                      Payout: ₹45
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 space-y-1">
                    <p>📍 Dark Store Pickup: Central Dark Store #1</p>
                    <p>🏁 Delivery Zone: Sector {ord._id?.slice(-3) || '4'} (Approx. 1.8 km)</p>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleAcceptOrder(ord)}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs py-2 rounded-xl transition shadow-md shadow-emerald-600/20 cursor-pointer"
                    >
                      Accept Order
                    </button>
                    <button
                      onClick={() => handleRejectOrder()}
                      className="px-3 bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold text-xs py-2 rounded-xl transition cursor-pointer"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active Delivery Execution Column */}
        <div className="space-y-4">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <span>🚀 Active Fulfillment & Security</span>
          </h3>

          {activeOrder ? (
            <div className="bg-slate-800 border border-blue-500/50 rounded-2xl p-5 space-y-4 shadow-xl">
              <div className="flex justify-between items-center border-b border-slate-700 pb-3">
                <span className="text-xs font-black bg-blue-600 text-white px-2.5 py-1 rounded-lg">
                  ACTIVE ROUTE
                </span>
                <span className="text-xs font-bold text-amber-400">Arriving in ~8 mins</span>
              </div>

              <div className="space-y-2 text-xs text-slate-300">
                <p><strong className="text-white">Order ID:</strong> #{activeOrder._id}</p>
                <p><strong className="text-white">Items Packed:</strong> {activeOrder.items?.length || 1} medicines verified</p>
                <p><strong className="text-white">Destination:</strong> Customer Delivery Address</p>
              </div>

              {/* Only the rider workflow can submit the customer's code; no code is displayed here. */}
              {['dispatched', 'out_for_delivery'].includes(String(activeOrder.orderStatus || activeOrder.status || '').toLowerCase()) ? (
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 space-y-3">
                <label className="block text-xs font-black uppercase text-slate-400">
                  Secure Customer Delivery OTP (4 Digits)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={4}
                    value={otpCode}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="e.g. 4821"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono tracking-widest text-center text-sm focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleCompleteOrder}
                    disabled={verifyingDelivery || otpCode.length !== 4}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-black text-xs px-4 py-2 rounded-xl shadow-md transition cursor-pointer whitespace-nowrap"
                  >
                    {verifyingDelivery ? 'Verifying…' : 'Verify & Deliver'}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 text-center">
                  The code is sent to the customer. Enter it only at handover; the backend verifies it before closing this delivery.
                </p>
              </div>
              ) : (
                <div className="rounded-xl border border-amber-700/60 bg-amber-950/30 p-4 text-xs text-amber-200">
                  Delivery verification becomes available after the pharmacy marks this order Out for Delivery.
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-800/50 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 text-xs space-y-3">
              <span className="text-3xl">🛵</span>
              <p className="font-bold text-white">No Active Delivery in Progress</p>
              <p className="text-slate-500">Accept an incoming order from the left panel to begin fulfillment and telemetry streaming.</p>
            </div>
          )}
        </div>
      </div>

      {/* Floating Incoming Order Modal Alert (Zepto/Blinkit style) */}
      {currentAlert && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 border border-amber-500/50 w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <span className="bg-amber-500/20 text-amber-400 font-black px-3 py-1 rounded-full text-xs">
                🚨 NEW ORDER ALERT
              </span>
              <span className="text-red-400 font-black text-lg bg-red-950/50 border border-red-800 px-3 py-1 rounded-xl">
                {countdown}s
              </span>
            </div>

            <div className="space-y-2 text-xs text-slate-300">
              <p className="text-sm font-bold text-white">Order #{currentAlert._id?.slice(-6)} • ₹{currentAlert.totalAmount || 350}</p>
              <p>📍 Pickup: Central Dark Store (1.2 km away)</p>
              <p>🏁 Dropoff: Customer Delivery Zone</p>
              <p className="text-emerald-400 font-bold">Estimated Payout: ₹45 + Surge Bonus</p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => handleAcceptOrder(currentAlert)}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm py-3 rounded-2xl shadow-lg transition cursor-pointer"
              >
                Accept Delivery
              </button>
              <button
                onClick={() => handleRejectOrder()}
                className="px-5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm py-3 rounded-2xl transition cursor-pointer"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
