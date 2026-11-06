import React, { useState, useEffect, useRef } from 'react';
import apiClient from '../../api/apiClient';
import { useTenant } from '../../context/TenantContext';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useLanguage } from '../../context/LanguageContext';

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(1));
}

export default function TenantSelectorModal({ isOpen, onClose, preferredTenantId = '' }) {
  const { t } = useLanguage();
  const { tenantId, setTenantId, setActiveTenant } = useTenant();
  const { addresses, loadAddresses } = useApp();
  const { isFullyAuthenticated } = useAuth();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const modalRef = useFocusTrap(isOpen, onClose);
  const addressLoadAttemptedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      addressLoadAttemptedRef.current = false;
      return undefined;
    }
    let cancelled = false;

    const load = async () => {
      let savedAddresses = Array.isArray(addresses) ? addresses : [];
      if (isFullyAuthenticated && savedAddresses.length === 0 && !addressLoadAttemptedRef.current) {
        addressLoadAttemptedRef.current = true;
        try {
          const loaded = await loadAddresses({ force: true });
          if (Array.isArray(loaded)) savedAddresses = loaded;
        } catch (loadError) {
          console.warn('[PharmacyDiscovery] Could not load saved addresses:', loadError?.message || loadError);
        }
      }
      if (cancelled) return;

      const defaultAddress = savedAddresses.find(address => address.isDefault) || savedAddresses[0] || null;
      if (defaultAddress) {
        const lat = Number(defaultAddress.coordinates?.lat);
        const lng = Number(defaultAddress.coordinates?.lng);
        const hasCoordinates = defaultAddress.coordinates?.lat != null
          && defaultAddress.coordinates?.lng != null
          && Number.isFinite(lat) && lat >= -90 && lat <= 90
          && Number.isFinite(lng) && lng >= -180 && lng <= 180;
        // Older addresses were silently assigned Bengaluru's city-centre coordinates.
        // Treat that legacy placeholder as address-only, not as the customer's pin.
        const isLegacyPlaceholder = Math.abs(lat - 12.9716) < 0.00001 && Math.abs(lng - 77.5946) < 0.00001;
        const addressContext = {
          city: defaultAddress.city || '',
          pincode: defaultAddress.pincode || defaultAddress.postalCode || ''
        };
        setSearchQuery('');
        if (hasCoordinates && !isLegacyPlaceholder) {
          setUserLocation({ lat, lng, source: 'saved-address', label: [defaultAddress.label || 'Saved address', defaultAddress.city, defaultAddress.pincode || defaultAddress.postalCode].filter(Boolean).join(' · ') });
          await fetchNearbyTenants({ lat, lng }, addressContext);
        } else {
          setUserLocation({ source: 'saved-address', label: [defaultAddress.label || 'Saved address', defaultAddress.city, defaultAddress.pincode || defaultAddress.postalCode].filter(Boolean).join(' · ') });
          await fetchNearbyTenants(null, addressContext);
        }
        return;
      }

      // Ask for browser location only when there is no saved delivery address.
      if (!navigator.geolocation) {
        await fetchNearbyTenants(null);
        if (!cancelled) setError(t('addDeliveryAddressNearby'));
        return;
      }
      try {
        const permission = navigator.permissions?.query
          ? await navigator.permissions.query({ name: 'geolocation' })
          : null;
        if (permission?.state === 'denied') {
          await fetchNearbyTenants(null);
          if (!cancelled) setError('Location access is blocked. Add a saved address or search pharmacies manually.');
          return;
        }
        if (permission?.state === 'prompt') localStorage.setItem('pharma_location_prompted_v1', 'true');
      } catch {
        // Continue with the browser's normal one-time permission prompt.
      }
      if (!cancelled) getUserLocationAndFetchTenants();
    };

    load();
    return () => { cancelled = true; };
  }, [isOpen, isFullyAuthenticated, addresses, loadAddresses]); 

  const getUserLocationAndFetchTenants = () => {
    setLoading(true);
    setError('');
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setUserLocation(coords);
          fetchNearbyTenants(coords);
        },
        (err) => {
          console.warn('Geolocation denied or unavailable:', err);
          setUserLocation(null);
          setError('Location permission was denied or unavailable. Showing pharmacies without distance sorting. Allow location access to see the nearest options first.');
          fetchNearbyTenants(null);
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    } else {
      setUserLocation(null);
      setError('Location is not supported by this browser. Showing pharmacies without distance sorting.');
      fetchNearbyTenants(null);
    }
  };

  const fetchNearbyTenants = async (coords, addressContext = {}) => {
    try {
      const response = await apiClient.get('/api/tenants/nearby', {
        params: {
          ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
          ...(addressContext.city ? { city: addressContext.city } : {}),
          ...(addressContext.pincode ? { pincode: addressContext.pincode } : {})
        }
      });
      let list = response.data?.tenants || [];

      list = list.map((tenant) => {
        const coordinates = tenant?.geoLocation?.coordinates;
        const hasCoordinates = Array.isArray(coordinates)
          && Number.isFinite(Number(coordinates[0]))
          && Number.isFinite(Number(coordinates[1]));
        const distance = coords && hasCoordinates
          ? calculateDistance(coords.lat, coords.lng, Number(coordinates[1]), Number(coordinates[0]))
          : null;
        return {
          ...tenant,
          calculatedDistance: distance
        };
      });

      if (coords) {
        list.sort((a, b) => (a.calculatedDistance ?? Number.POSITIVE_INFINITY) - (b.calculatedDistance ?? Number.POSITIVE_INFINITY));
      }

      setTenants(list);
      setError('');
      // Manual customer selection wins over URL defaults and discovery order.
      // The first nearby pharmacy is selected only when no pharmacy was selected yet.
      const getTenantId = (tenant) => String(tenant?._id || tenant?.id || '');
      const selected = tenantId
        ? list.find(tenant => getTenantId(tenant) === String(tenantId))
        : null;
      const preferred = selected
        || (!tenantId && preferredTenantId
          ? list.find(tenant => getTenantId(tenant) === String(preferredTenantId))
          : null)
        || (!tenantId ? (list[0] || null) : null);

      // Hydrate the persisted selection from the current discovery response.
      // TenantContext stores the ID and tenant display object separately; if
      // the ID survived but the object cache was missing/stale, previously the
      // modal showed a selected pharmacy without restoring activeTenant.
      if (preferred && getTenantId(preferred)) {
        setActiveTenant(preferred);
      }
    } catch (err) {
      setError(err?.response?.data?.message || err.message || t('failedFetchNearby'));
    } finally {
      setLoading(false);
    }
  };

  const filteredTenants = tenants.filter(tenant => {
    const query = searchQuery.toLowerCase();
    const name = (tenant.shopName || '').toLowerCase();
    const street = (tenant.address?.street || '').toLowerCase();
    const city = (tenant.address?.city || '').toLowerCase();
    const state = (tenant.address?.state || '').toLowerCase();
    return name.includes(query) || street.includes(query) || city.includes(query) || state.includes(query);
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center overflow-y-auto bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <section
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tenant-modal-title"
        tabIndex={-1}
        className="flex max-h-[94dvh] min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900 sm:max-h-[min(90dvh,48rem)] sm:rounded-3xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-4 py-4 dark:border-slate-800 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-400">
              <span aria-hidden="true">📍</span>{t('nearbyPharmacyFinder')}
            </span>
            <h3 id="tenant-modal-title" className="mt-1 text-xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
              {t('selectActivePharmacy')}
            </h3>
            <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500 dark:text-slate-400 sm:text-sm">
              {userLocation?.source === 'saved-address'
                ? t('showingNearSavedAddress')
                : userLocation?.lat != null
                  ? t('showingNearCurrentLocation')
                  : t('searchOrAddAddress')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close pharmacy selector"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          <label className="relative block">
            <span className="sr-only">{t('searchDispensaryPlaceholder')}</span>
            <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('searchDispensaryPlaceholder')}
              className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:bg-slate-800"
            />
          </label>

          {error && (
            <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 py-10 text-center" role="status" aria-live="polite">
              <span className="h-9 w-9 animate-spin rounded-full border-4 border-emerald-600 border-r-transparent" />
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('findingPharmacies')}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredTenants.map((tenant) => {
                const id = String(tenant?._id || tenant?.id || '');
                const isSelected = String(tenantId || '') === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setActiveTenant(tenant)}
                    className={`group flex w-full min-w-0 items-center gap-3 rounded-2xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 sm:gap-4 sm:p-4 ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-50/80 ring-2 ring-emerald-500/10 dark:border-emerald-500 dark:bg-emerald-950/30'
                        : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-700 dark:hover:bg-slate-800'
                    }`}
                  >
                    <img
                      src={tenant.shopPhotoUrl || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80'}
                      alt=""
                      loading="lazy"
                      className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 bg-slate-100 object-cover sm:h-16 sm:w-16 dark:border-slate-700"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 break-words text-sm font-bold leading-5 text-slate-900 dark:text-white sm:text-base">
                          {tenant.shopName || tenant.name || 'Pharmacy'}
                        </span>
                        {isSelected && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                            <span aria-hidden="true">✓</span> Selected
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block break-words text-xs leading-5 text-slate-500 dark:text-slate-400">
                        {[tenant.address?.street, tenant.address?.city, tenant.address?.state, tenant.address?.zipCode || tenant.address?.pincode].filter(Boolean).join(', ') || 'Address not provided'}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        <span aria-hidden="true">📍</span>
                        {tenant.calculatedDistance == null
                          ? (userLocation?.source === 'saved-address' ? t('matchesSavedAddress') : t('locationDistanceUnavailable'))
                          : `${t('distanceLabel')}: ${tenant.calculatedDistance} ${t('kmAway')}`}
                      </span>
                    </span>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-slate-300 text-transparent group-hover:border-emerald-400 dark:border-slate-600'
                    }`} aria-hidden="true">✓</span>
                  </button>
                );
              })}
              {filteredTenants.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center dark:border-slate-700 dark:bg-slate-800/50">
                  <span className="text-2xl" aria-hidden="true">🏥</span>
                  <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {searchQuery.trim() ? t('noPharmacyMatches') : t('noActivePharmaciesArea')}
                  </p>
                  {searchQuery.trim() && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('pleaseTryAgain')}</p>}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-slate-100 bg-white/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] dark:border-slate-800 dark:bg-slate-900/95 sm:px-6 sm:py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={!tenantId || !tenants.some(tenant => String(tenant?._id || tenant?.id || '') === String(tenantId))}
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          >
            {t('confirmAndViewCatalogue')}
          </button>
        </footer>
      </section>
    </div>
  );
}
}