import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import { useTenant } from '../../context/TenantContext';

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
  const { tenantId, setTenantId, setActiveTenant } = useTenant();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      getUserLocationAndFetchTenants();
    }
  }, [isOpen]);

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

  const fetchNearbyTenants = async (coords) => {
    try {
      const response = await apiClient.get('/api/tenants/nearby', {
        params: coords ? { lat: coords.lat, lng: coords.lng } : {}
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
      const preferred = preferredTenantId ? list.find(tenant => String(tenant._id) === String(preferredTenantId)) : null;
      if (preferred) {
        setTenantId(preferred._id);
        setActiveTenant(preferred);
        setSearchQuery(preferred.shopName || '');
      } else if (!tenantId && list.length > 0) {
        setTenantId(list[0]._id);
        setActiveTenant(list[0]);
      }
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Failed to fetch nearby pharmacies');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl max-w-lg w-full p-6 md:p-8 border border-gray-100 dark:border-gray-800 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Geolocation Proximity Engine</span>
            <h3 className="text-xl font-black text-gray-900 dark:text-white mt-1">Select Active Pharmacy Dispensary</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:text-gray-800 dark:hover:text-white transition"
          >
            ✕
          </button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          Based on your current GPS coordinates, verified dispensary branches are sorted by proximity. Search or select one to view its product catalogue and order flow.
        </p>

        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search dispensary by shop name, street, or city..."
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
          />
          <svg className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-xs rounded-xl">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center">
            <div className="inline-block w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-xs text-gray-400">Scanning GPS and sorting nearby dispensary networks...</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {filteredTenants.map((tenant) => {
              const isSelected = String(tenantId) === String(tenant._id);
              return (
                <div
                  key={tenant._id}
                  onClick={() => {
                    setTenantId(tenant._id);
                    setActiveTenant(tenant);
                  }}
                  className={`p-4 rounded-2xl border-2 transition cursor-pointer flex items-center gap-4 ${
                    isSelected
                      ? 'border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-md'
                      : 'border-gray-200 dark:border-gray-700 hover:border-emerald-400 bg-gray-50 dark:bg-gray-800/40'
                  }`}
                >
                  <img
                    src={tenant.shopPhotoUrl || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80'}
                    alt={tenant.shopName}
                    className="w-16 h-16 rounded-xl object-cover border border-gray-200 dark:border-gray-700 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-gray-900 dark:text-white truncate">{tenant.shopName}</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                      {tenant.address?.street}, {tenant.address?.city}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      <span>📍</span>
                      <span>{tenant.calculatedDistance == null ? 'Distance unavailable — enable location to sort nearby' : `Distance: ${tenant.calculatedDistance} km away`}</span>
                    </div>
                  </div>
                  {isSelected && (
                    <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                      ✓
                    </div>
                  )}
                </div>
              );
            })}
            {filteredTenants.length === 0 && (
              <div className="py-8 text-center text-sm text-gray-400">
                No dispensaries found matching "{searchQuery}".
              </div>
            )}
          </div>
        )}

        <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-2xl shadow transition"
          >
            Confirm & View Product Catalogue
          </button>
        </div>
      </div>
    </div>
  );
}
