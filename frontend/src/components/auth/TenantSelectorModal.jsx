import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import { useTenant } from '../../context/TenantContext';

export default function TenantSelectorModal({ isOpen, onClose }) {
  const { tenantId, setTenantId } = useTenant();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchNearbyTenants();
    }
  }, [isOpen]);

  const fetchNearbyTenants = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/api/tenants/nearby');
      const list = response.data?.tenants || [];
      setTenants(list);
      // If no tenant is selected yet, auto-select the first nearby tenant
      if (!tenantId && list.length > 0) {
        setTenantId(list[0]._id);
      }
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Failed to fetch nearby pharmacies');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl max-w-lg w-full p-6 md:p-8 border border-gray-100 dark:border-gray-800 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Geolocation & Address Mapping</span>
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
          Based on your delivery address or current GPS geolocation, multiple verified dispensary branches are available nearby. Select one to view its product catalogue, pricing, and order flow.
        </p>

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-xs rounded-xl">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center">
            <div className="inline-block w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-xs text-gray-400">Scanning nearby dispensary networks...</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {tenants.map((tenant) => {
              const isSelected = String(tenantId) === String(tenant._id);
              return (
                <div
                  key={tenant._id}
                  onClick={() => {
                    setTenantId(tenant._id);
                    onClose();
                  }}
                  className={`p-4 rounded-2xl border-2 transition cursor-pointer flex items-center gap-4 ${
                    isSelected
                      ? 'border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-md'
                      : 'border-gray-200 dark:border-gray-700 hover:border-emerald-400 bg-gray-50 dark:bg-gray-800/40'
                  }`}
                >
                  <img
                    src={tenant.shopPhotoUrl}
                    alt={tenant.shopName}
                    className="w-16 h-16 rounded-xl object-cover border border-gray-200 dark:border-gray-700 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-gray-900 dark:text-white truncate">{tenant.shopName}</h4>
                      <span className="text-xs font-semibold px-2.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded-full">
                        {tenant.distanceKm} km away
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                      {tenant.address?.street}, {tenant.address?.city}
                    </p>
                  </div>
                  {isSelected && (
                    <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                      ✓
                    </div>
                  )}
                </div>
              );
            })}
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
