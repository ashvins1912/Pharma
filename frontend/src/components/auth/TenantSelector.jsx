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

export default function TenantSelector({ onTenantSelected }) {
  const { tenantId, activeTenant, setActiveTenant, setTenantId } = useTenant();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    getUserLocationAndFetchTenants();
  }, []);

  const getUserLocationAndFetchTenants = () => {
    setLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setUserLocation(coords);
          fetchTenants(coords);
        },
        (err) => {
          console.warn('Geolocation denied or unavailable:', err);
          setUserLocation(null);
          fetchTenants(null);
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    } else {
      setUserLocation(null);
      fetchTenants(null);
    }
  };

  const fetchTenants = async (coords) => {
    setError('');
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
      
      if (!tenantId && list.length > 0) {
        setActiveTenant(list[0]);
        setTenantId(list[0]._id);
      } else if (tenantId && !activeTenant && list.length > 0) {
        const found = list.find(t => String(t._id) === String(tenantId));
        if (found) setActiveTenant(found);
      }
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Failed to fetch available tenants');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTenant = (tenant) => {
    setActiveTenant(tenant);
    setTenantId(tenant._id);
    if (onTenantSelected) onTenantSelected(tenant);
  };

  const filteredTenants = tenants.filter(tenant => {
    const query = searchQuery.toLowerCase();
    const name = (tenant.shopName || '').toLowerCase();
    const street = (tenant.address?.street || '').toLowerCase();
    const city = (tenant.address?.city || '').toLowerCase();
    const state = (tenant.address?.state || '').toLowerCase();
    return name.includes(query) || street.includes(query) || city.includes(query) || state.includes(query);
  });

  if (loading) {
    return (
      <div className="p-6 text-center text-xs text-gray-400">
        Scanning GPS coordinates and sorting nearby dispensary clusters...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-xs rounded-xl">
        {error}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-xl border border-gray-100 dark:border-gray-800 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Geolocation Proximity Engine</span>
          <h3 className="text-lg font-black text-gray-900 dark:text-white mt-0.5">Select Active Pharmacy Dispensary</h3>
        </div>
        <span className="text-xs px-3 py-1 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-bold rounded-full">
          {filteredTenants.length} Available
        </span>
      </div>

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
        {filteredTenants.map((tenant) => {
          const isSelected = String(tenantId) === String(tenant._id);
          return (
            <div
              key={tenant._id}
              onClick={() => handleSelectTenant(tenant)}
              className={`p-4 rounded-2xl border-2 transition cursor-pointer flex items-center gap-3 ${
                isSelected
                  ? 'border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-md'
                  : 'border-gray-200 dark:border-gray-700 hover:border-emerald-400 bg-gray-50 dark:bg-gray-800/40'
              }`}
            >
              <img
                src={tenant.shopPhotoUrl || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80'}
                alt={tenant.shopName}
                className="w-12 h-12 rounded-xl object-cover border border-gray-200 dark:border-gray-700 flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-sm text-gray-900 dark:text-white truncate">{tenant.shopName}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                  {tenant.address?.street}, {tenant.address?.city}
                </p>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <span>📍</span>
                  <span>{tenant.calculatedDistance == null ? 'Distance unavailable — enable location to sort nearby' : `Distance: ${tenant.calculatedDistance} km away`}</span>
                </div>
              </div>
              {isSelected && (
                <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                  ✓
                </div>
              )}
            </div>
          );
        })}
        {filteredTenants.length === 0 && (
          <div className="col-span-full py-8 text-center text-sm text-gray-400">
            No dispensaries found matching "{searchQuery}".
          </div>
        )}
      </div>
    </div>
  );
}
