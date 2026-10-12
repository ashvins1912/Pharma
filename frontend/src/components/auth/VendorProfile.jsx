import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';

export default function VendorProfile() {
  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchProfile = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/api/vendor/profile');
      setProfileData(response.data);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Failed to fetch vendor profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-12 text-center">
        <div className="inline-block w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-500 dark:text-gray-400 font-medium">Aggregating vendor profile and personnel data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-8 my-8 bg-white dark:bg-gray-900 rounded-3xl shadow-xl border border-red-100 dark:border-red-900/50 text-center">
        <div className="text-red-500 font-semibold mb-2">Unable to Load Vendor Profile</div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{error}</p>
        <button
          onClick={fetchProfile}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow transition"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const { tenant, personnel } = profileData || {};

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-8 my-8">
      {/* Header & Storefront Card */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        <div className="relative h-48 md:h-64 bg-gray-100 dark:bg-gray-800">
          <img
            src={tenant?.shopPhotoUrl || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&q=80'}
            alt={tenant?.shopName}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex items-end p-6">
            <div>
              <span className="text-xs font-semibold px-3 py-1 bg-emerald-500 text-white rounded-full uppercase tracking-wider mb-2 inline-block">
                Verified Pharmacy Tenant
              </span>
              <h1 className="text-3xl md:text-4xl font-extrabold text-white">{tenant?.shopName}</h1>
            </div>
          </div>
        </div>

        <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Address */}
          <div className="p-5 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2">Physical Address</h3>
            <p className="text-sm text-gray-800 dark:text-gray-200 font-medium">{tenant?.address?.street}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {tenant?.address?.city}, {tenant?.address?.state} {tenant?.address?.zipCode}
            </p>
          </div>

          {/* Geo-Location */}
          <div className="p-5 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2">GeoJSON Point Location</h3>
            <p className="text-sm text-gray-800 dark:text-gray-200 font-medium">Longitude: {tenant?.geoLocation?.coordinates?.[0]}</p>
            <p className="text-sm text-gray-800 dark:text-gray-200 font-medium">Latitude: {tenant?.geoLocation?.coordinates?.[1]}</p>
            <span className="text-xs text-gray-400 mt-1 block">Spatial 2dsphere index active</span>
          </div>

          {/* Owner Details */}
          <div className="p-5 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2">Owner Contact</h3>
            <p className="text-sm text-gray-800 dark:text-gray-200 font-semibold">{tenant?.ownerDetails?.name}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{tenant?.ownerDetails?.email}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{tenant?.ownerDetails?.phone}</p>
          </div>
        </div>
      </div>

      {/* Administrative Personnel Section */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-xl border border-gray-100 dark:border-gray-800 p-6 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Administrative Personnel</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Active management and operator accounts scoped to this tenant cluster. Sensitive credentials (password hashes) are strictly filtered out.
            </p>
          </div>
          <span className="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded-full">
            {personnel?.length || 0} Members
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {personnel && personnel.map((user) => (
            <div
              key={user._id || user.email}
              className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-200/60 dark:border-gray-700 flex items-center justify-between"
            >
              <div>
                <h4 className="text-sm font-bold text-gray-900 dark:text-white">{user.name}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">{user.email}</p>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-xl uppercase tracking-wider ${
                user.role === 'OWNER'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300'
                  : user.role === 'TENANT_ADMIN'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
              }`}>
                {user.role}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
