import React, { useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';

export default function AdminRouteOptimizer({ onRefresh }) {
  const { addToast } = useToast();

  const [riders, setRiders] = useState([]);
  const [selectedRiderId, setSelectedRiderId] = useState('');
  const [riderSearch, setRiderSearch] = useState('');
  const [loadingRiders, setLoadingRiders] = useState(true);
  const [ridersError, setRidersError] = useState('');
  const [radiusKm, setRadiusKm] = useState('5');
  const [searching, setSearching] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [routeResult, setRouteResult] = useState(null);

  useEffect(() => {
    let isCurrentRequest = true;
    apiClient.get('/api/admin/riders', { params: { status: 'Available' } })
      .then(({ data }) => {
        if (isCurrentRequest) setRiders(data || []);
      })
      .catch((err) => {
        if (isCurrentRequest) {
          setRidersError(err.response?.data?.message || err.message || 'Could not load onboarded riders.');
        }
      })
      .finally(() => {
        if (isCurrentRequest) setLoadingRiders(false);
      });
    return () => {
      isCurrentRequest = false;
    };
  }, []);

  const filteredRiders = useMemo(() => {
    const term = riderSearch.trim().toLowerCase();
    if (!term) return riders;
    return riders.filter((rider) =>
      rider.name.toLowerCase().includes(term) || rider.mobile.toLowerCase().includes(term)
    );
  }, [riderSearch, riders]);

  const selectedRider = riders.find((rider) => rider.id === selectedRiderId);

  const handleFindNearbyOrders = async (e) => {
    e.preventDefault();
    if (!selectedRiderId) return;
    setSearching(true);
    try {
      const res = await apiClient.post('/api/orders/admin/optimize-and-club-routes', {
        riderId: selectedRiderId,
        maxRadiusKm: Number(radiusKm) || 5,
        startLat: 12.9716, // Bengaluru Dispensary Coordinates
        startLng: 77.5946
      });
      setRouteResult(res.data);
      addToast(`Found ${res.data.ordersFound} orders within ${radiusKm} KM corridor!`, 'info');
    } catch (err) {
      addToast(err.message || 'Route discovery failed', 'error');
    } finally {
      setSearching(false);
    }
  };

  const handleDispatchBatch = async () => {
    if (!routeResult || routeResult.orders.length === 0) return;
    setDispatching(true);

    try {
      const orderIds = routeResult.orders.map(o => o._id);
      const res = await apiClient.post('/api/orders/admin/dispatch-batch', {
        orderIds,
        riderId: selectedRiderId
      });
      addToast(res.data.message || 'Batch dispatched successfully!', 'success');
      if (res.data.dispatchErrors?.length) {
        addToast(`${res.data.dispatchErrors.length} order(s) could not be dispatched.`, 'warning');
      }
      setRouteResult(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      addToast(err.message || 'Dispatch failed', 'error');
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xl">🗺️</span>
          <h3 className="text-base font-black text-slate-900">
            Smart Delivery Route Clubbing & Dispatch
          </h3>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          Haversine geographic corridor clustering with multi-stop Google Maps deep links.
        </p>
      </div>

      {/* Input Parameters Form */}
      <form onSubmit={handleFindNearbyOrders} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        <div className="min-w-0">
          <label htmlFor="route-rider-search" className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Select Available Rider
          </label>
          <input
            id="route-rider-search"
            type="search"
            value={riderSearch}
            onChange={(event) => setRiderSearch(event.target.value)}
            placeholder="Search by name or mobile"
            className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none font-bold text-slate-800"
          />
          <select
            value={selectedRiderId}
            onChange={(event) => setSelectedRiderId(event.target.value)}
            disabled={loadingRiders || Boolean(ridersError) || filteredRiders.length === 0}
            className="mt-2 w-full min-w-0 px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none font-bold text-slate-800 disabled:bg-slate-100"
            required
          >
            <option value="">Choose an onboarded rider</option>
            {filteredRiders.map((rider) => (
              <option key={rider.id} value={rider.id}>
                {rider.name} — {rider.mobile}{rider.vehicleType ? ` · ${rider.vehicleType}` : ''}
              </option>
            ))}
          </select>
          <div className="mt-1 min-h-4" aria-live="polite">
            {loadingRiders && <p className="text-[11px] text-slate-500">Loading riders…</p>}
            {!loadingRiders && ridersError && <p role="alert" className="text-[11px] text-rose-600">{ridersError}</p>}
          </div>
          {!loadingRiders && !ridersError && riders.length === 0 && (
            <p className="mt-1 text-[11px] text-amber-700">No available onboarded riders found.</p>
          )}
          {!loadingRiders && !ridersError && riders.length > 0 && filteredRiders.length === 0 && (
            <p className="mt-1 text-[11px] text-slate-500">No riders match that search.</p>
          )}
          {selectedRider && <p className="mt-1 text-[11px] text-slate-500">Selected: {selectedRider.name}</p>}
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Corridor Radius (KM)
          </label>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="1"
              max="50"
              value={radiusKm}
              onChange={(e) => setRadiusKm(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none font-bold text-slate-800"
              required
            />
            <span className="text-xs font-bold text-slate-400">KM</span>
          </div>
        </div>

        <button
          type="submit"
          disabled={searching || loadingRiders || Boolean(ridersError) || !selectedRiderId}
          className="w-full bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs py-2.5 px-4 rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>{searching ? 'Computing Routes...' : 'Find Nearby Orders'}</span>
          <span>🔍</span>
        </button>
      </form>

      {/* Stable result region prevents the page from jumping when route data is fetched. */}
      {!routeResult && !searching && (
        <div className="min-h-[320px] flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 text-center">
          <div><div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-lg shadow-sm">🗺️</div><p className="text-xs font-bold text-slate-600">Choose a rider and find nearby orders</p><p className="mt-1 text-[11px] text-slate-400">Route results stay in this area so the controls above do not move.</p></div>
        </div>
      )}
      {searching && !routeResult && (
        <div className="min-h-[320px] rounded-2xl border border-slate-200 bg-slate-50/70 p-4" role="status">
          <div className="mb-4 flex items-center justify-between"><div className="h-4 w-48 animate-pulse rounded bg-slate-200" /><div className="h-8 w-28 animate-pulse rounded-lg bg-slate-200" /></div>
          <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-12 animate-pulse rounded-xl border border-slate-200 bg-white" />)}</div>
        </div>
      )}
      {routeResult && (
        <div className="min-h-[320px] space-y-4 animate-fade-in border-t border-slate-100 pt-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-blue-50/70 border border-blue-200 p-4 rounded-2xl">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-blue-900">
                  Delivery Route for {routeResult.riderName} ({routeResult.riderMobile})
                </span>
                <span className="bg-blue-200 text-blue-800 text-[10px] font-black px-2 py-0.5 rounded-full">
                  {routeResult.ordersFound} Orders Found
                </span>
              </div>
              <p className="text-[11px] text-blue-700 mt-0.5">
                Computed within straight-line Haversine radius of {routeResult.configuredRadiusKm} KM from central dispensary.
              </p>
            </div>

            {/* Google Maps Deep Link */}
            {routeResult.googleMapsUrl && (
              <a
                href={routeResult.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-4 py-2 rounded-xl shadow-sm transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <span>🗺️</span>
                <span>Open Route in Google Maps</span>
                <span>↗</span>
              </a>
            )}
          </div>

          {routeResult.orders.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center italic">
              No orders in 'Ready to Dispatch' stage within {routeResult.configuredRadiusKm} KM radius.
            </p>
          ) : (
            <div className="space-y-2">
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                Waypoint Stops in Optimized Order:
              </h4>

              <div className="space-y-2">
                {routeResult.orders.map((order, idx) => {
                  const orderId = (order._id || '').slice(-6).toUpperCase();
                  return (
                    <div
                      key={order._id}
                      className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-black text-xs flex items-center justify-center flex-shrink-0">
                          {idx + 1}
                        </span>
                        <div>
                          <span className="font-extrabold text-slate-900">Stop #{idx + 1}: #{orderId}</span>
                          <span className="text-slate-500 ml-2">({order.customerName})</span>
                          <p className="text-[11px] text-slate-400 truncate max-w-sm">📍 {order.deliveryAddress}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-auto">
                        <span className="font-bold text-slate-500 text-[11px]">
                          ~{order.distanceKm} KM
                        </span>
                        <span className="font-black text-emerald-600">
                          ₹{order.finalTotal} COD
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Batch Dispatch Action */}
              <div className="pt-3 flex justify-end">
                <button
                  onClick={handleDispatchBatch}
                  disabled={dispatching}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-extrabold text-xs px-6 py-3 rounded-2xl shadow-lg shadow-blue-600/25 transition cursor-pointer flex items-center gap-2"
                >
                  <span>{dispatching ? 'Assigning Courier...' : `Create Delivery Route & Dispatch (${routeResult.orders.length} Orders)`}</span>
                  <span>🚀</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
