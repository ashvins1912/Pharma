import React, { useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';
import { useTenant } from '../../context/TenantContext';
import { useLanguage } from '../../context/LanguageContext';
import { SpatialGridIndex, SimpleBloomFilter } from '../../utils/spatialProbUtils';

export default function AdminRouteOptimizer({ onRefresh }) {
  const { t } = useLanguage();
  const { addToast } = useToast();
  const { tenantId } = useTenant();

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
    apiClient.get('/api/admin/riders', { params: { status: 'Available', tenantId } })
      .then(({ data }) => {
        if (isCurrentRequest) {
          const list = Array.isArray(data) ? data : (data?.riders || data?.data || []);
          setRiders(Array.isArray(list) ? list : []);
        }
      })
      .catch((err) => {
        if (isCurrentRequest) {
          setRidersError(err.response?.data?.message || err.message || 'Could not load onboarded riders.');
          setRiders([]);
        }
      })
      .finally(() => {
        if (isCurrentRequest) setLoadingRiders(false);
      });
    return () => {
      isCurrentRequest = false;
    };
  }, [tenantId]);

  const riderList = Array.isArray(riders) ? riders : [];

  const filteredRiders = useMemo(() => {
    const term = riderSearch.trim().toLowerCase();
    if (!term) return riderList;
    return riderList.filter((rider) =>
      (rider.name || '').toLowerCase().includes(term) || (rider.mobile || '').toLowerCase().includes(term)
    );
  }, [riderSearch, riderList]);

  const selectedRider = riderList.find((rider) => String(rider.id || rider._id) === String(selectedRiderId));

  const handleFindNearbyOrders = async (e) => {
    e.preventDefault();
    if (!selectedRiderId) return;
    setSearching(true);
    try {
      const res = await apiClient.post('/api/orders/admin/optimize-and-club-routes', {
        riderId: selectedRiderId,
        tenantId,
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
        riderId: selectedRiderId,
        tenantId
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">🗺️</span>
            <h3 className="text-base font-black text-slate-900">
              {t('smartDeliveryRouteClubbing')}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-black px-2.5 py-1 rounded-full flex items-center gap-1">
              <span>📍 {t('spatialGeohashIndexing')}</span>
            </span>
            <span className="bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-black px-2.5 py-1 rounded-full flex items-center gap-1">
              <span>⚡ {t('probabilisticBloomFilter')}</span>
            </span>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          {t('routeCorridorDesc')}
        </p>
      </div>

      {ridersError && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold text-amber-800" role="alert">
          {ridersError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Step 1: Select Rider */}
        <div className="space-y-4">
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">
            {t('selectAvailableRider')}
          </h4>

          <div className="space-y-2">
            <input
              type="text"
              placeholder={t('searchRiders')}
              value={riderSearch}
              onChange={(e) => setRiderSearch(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs outline-none focus:border-blue-500"
            />
          </div>

          <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
            {loadingRiders ? (
              <div className="py-8 text-center text-xs text-slate-400">{t('loadingRiders')}</div>
            ) : filteredRiders.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">{t('noRiders')}</div>
            ) : (
              filteredRiders.map((rider) => {
                const riderId = String(rider.id || rider._id);
                const isSelected = String(selectedRiderId) === riderId;
                return (
                  <button
                    key={riderId}
                    type="button"
                    onClick={() => setSelectedRiderId(riderId)}
                    className={`w-full text-left p-3 rounded-2xl border transition flex items-center justify-between ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/70 shadow-sm'
                        : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    <div>
                      <div className="font-extrabold text-xs text-slate-900">{rider.name}</div>
                      <div className="text-[11px] text-slate-500">{rider.mobile} · {rider.vehicleType || 'Bike'}</div>
                    </div>
                    {isSelected && <span className="text-blue-600 font-black text-xs">Selected ✓</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Step 2: Configure Corridor & Find Orders */}
        <form onSubmit={handleFindNearbyOrders} className="space-y-4">
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">
            Step 2: Corridor Radius & Route Discovery
          </h4>

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div>
              <label className="block text-xs font-extrabold text-slate-700 mb-1">
                Corridor Search Radius (KM)
              </label>
              <select
                value={radiusKm}
                onChange={(e) => setRadiusKm(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-blue-500 font-bold"
              >
                <option value="3">3 KM (Immediate Vicinity)</option>
                <option value="5">5 KM (Standard Corridor)</option>
                <option value="10">10 KM (Extended Delivery Zone)</option>
                <option value="15">15 KM (Max Metropolitan Zone)</option>
              </select>
            </div>

            <div>
              <div className="text-[11px] text-slate-500 font-medium">
                Selected Courier: <strong className="text-slate-900">{selectedRider?.name || 'None selected'}</strong>
              </div>
            </div>

            <button
              type="submit"
              disabled={!selectedRiderId || searching}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs py-2.5 rounded-xl transition cursor-pointer shadow-sm"
            >
              {searching ? t('processing') : t('findNearbyOrders')}
            </button>
          </div>
        </form>
      </div>

      {/* Route Optimization Results */}
      {routeResult && (
        <div className="border border-emerald-200 bg-emerald-50/60 rounded-3xl p-5 space-y-4 animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="bg-emerald-200 text-emerald-900 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Optimized Delivery Route
              </span>
              <h4 className="text-sm font-black text-slate-900 mt-1">
                {routeResult.ordersFound} orders clustered · Total Distance: {routeResult.totalDistanceKm || '4.2'} KM
              </h4>
            </div>

            <div className="flex items-center gap-2">
              {routeResult.googleMapsUrl && (
                <a
                  href={routeResult.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold text-xs px-3.5 py-2 rounded-xl transition shadow-sm"
                >
                  🗺️ Open in Google Maps
                </a>
              )}
              <button
                type="button"
                onClick={handleDispatchBatch}
                disabled={dispatching || !routeResult.orders?.length}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-xs px-4 py-2 rounded-xl transition shadow-sm cursor-pointer"
              >
                {dispatching ? t('processing') : t('dispatchBatchToRider')}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {routeResult.orders?.map((ord, idx) => (
              <div key={ord._id || idx} className="bg-white border border-emerald-200 rounded-2xl p-3 flex items-center justify-between text-xs shadow-xs">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-black flex items-center justify-center text-xs">
                    {idx + 1}
                  </span>
                  <div>
                    <div className="font-extrabold text-slate-900">Order #{ord.orderNumber || ord._id.slice(-6)}</div>
                    <div className="text-[11px] text-slate-500">{ord.deliveryAddress?.street || 'Delivery Address'} · ₹{ord.finalTotal || ord.totalAmount}</div>
                  </div>
                </div>
                <span className="font-bold text-blue-600">
                  {ord.distanceKm ? `${ord.distanceKm} KM away` : 'Optimized Stop'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
