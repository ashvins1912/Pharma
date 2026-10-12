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
        <p className="text-gray-500 dark:text-gray-400 font-medium">Aggregating vendor profile and personnel records...</p>
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

  // Frontend sanitization logic: ensure sensitive fields like passwordHash are strictly filtered out
  const sanitizedPersonnel = (personnel || []).map(user => {
    const { passwordHash, __v, ...safeUser } = user;
    return safeUser;
  });

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-8 my-8">
      {/* Header & Shop Details Card Layout */}
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
                Active Tenant Cluster
              </span>
              <h1 className="text-3xl md:text-4xl font-extrabold text-white">{tenant?.shopName}</h1>
            </div>
          </div>
        </div>

        <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Address */}
          <div className="p-5 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2">Physical Address</h3>
            <p className="text-sm text-gray-800 dark:text-gray-200 font-medium">{tenant?.address?.street}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
              {tenant?.address?.city}, {tenant?.address?.state} {tenant?.address?.zipCode}
            </p>
          </div>

          {/* Card 2: Geo-Location */}
          <div className="p-5 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2">GeoJSON Coordinates</h3>
            <p className="text-sm text-gray-800 dark:text-gray-200 font-medium">Longitude: {tenant?.geoLocation?.coordinates?.[0]}</p>
            <p className="text-sm text-gray-800 dark:text-gray-200 font-medium">Latitude: {tenant?.geoLocation?.coordinates?.[1]}</p>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 inline-block font-semibold">2dsphere Proximity Index Active</span>
          </div>

          {/* Card 3: Owner Details */}
          <div className="p-5 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2">Shop Owner</h3>
            <p className="text-sm text-gray-800 dark:text-gray-200 font-semibold">{tenant?.ownerDetails?.name}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{tenant?.ownerDetails?.email}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{tenant?.ownerDetails?.phone}</p>
          </div>
        </div>
      </div>

      {/* Administrative Personnel Table Layout */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-xl border border-gray-100 dark:border-gray-800 p-6 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Administrative Personnel Directory</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Scoped management accounts. Sensitive properties (such as passwordHash) are filtered out via frontend security logic.
            </p>
          </div>
          <span className="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded-full">
            {sanitizedPersonnel.length} Accounts
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-xs font-bold uppercase tracking-wider text-gray-400">
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Account ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 text-sm">
              {sanitizedPersonnel.map((user) => (
                <tr key={user._id || user.email} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition">
                  <td className="py-4 px-4 font-semibold text-gray-900 dark:text-white">{user.name}</td>
                  <td className="py-4 px-4 text-gray-600 dark:text-gray-300">{user.email}</td>
                  <td className="py-4 px-4">
                    <span className={`text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wider ${
                      user.role === 'OWNER'
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300'
                        : user.role === 'TENANT_ADMIN'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-xs font-mono text-gray-400">{user._id || 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
