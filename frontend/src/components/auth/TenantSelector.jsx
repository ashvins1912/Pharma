import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import { useTenant } from '../../context/TenantContext';

export default function TenantSelector({ onTenantSelected }) {
  const { tenantId, activeTenant, setActiveTenant, setTenantId } = useTenant();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/api/tenants/nearby');
      const list = response.data?.tenants || [];
      setTenants(list);
      
      // If no active tenant is set, default to the first available tenant
      if (!tenantId && list.length > 0) {
        setActiveTenant(list[0]);
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

  if (loading) {
    return (
      <div className="p-6 text-center text-xs text-gray-400">
        Loading active tenant clusters...
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
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Multi-Tenant Gateway</span>
          <h3 className="text-lg font-black text-gray-900 dark:text-white mt-0.5">Active Tenant Scope</h3>
        </div>
        <span className="text-xs px-3 py-1 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-bold rounded-full">
          {tenants.length} Available
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {tenants.map((tenant) => {
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
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {tenant.address?.street}, {tenant.address?.city}
                </p>
              </div>
              {isSelected && (
                <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                  ✓
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
