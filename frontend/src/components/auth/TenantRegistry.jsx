import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';

export default function TenantRegistry() {
  const [branchesData, setBranchesData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  const fetchBranches = async (currentPage = 1) => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get(`/api/tenant/branches?page=${currentPage}&limit=10`);
      setBranchesData(response.data);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Failed to fetch tenant branches registry');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches(page);
  }, [page]);

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-8 space-y-6 my-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-gray-900 p-6 rounded-3xl shadow-xl border border-gray-100 dark:border-gray-800">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Tenant Infrastructure</span>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white mt-1">Dispensary Branches Registry</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage physical dispensary locations, service radii, operational status, and branch assignments.
          </p>
        </div>
        <button
          onClick={() => fetchBranches(page)}
          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl shadow transition"
        >
          Refresh Registry
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 rounded-2xl text-sm">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-block w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-500 dark:text-gray-400 text-sm">Loading branch registry...</p>
          </div>
        ) : (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 text-xs font-bold uppercase tracking-wider text-gray-400">
                    <th className="py-4 px-6">Branch Name</th>
                    <th className="py-4 px-6">Location / Address</th>
                    <th className="py-4 px-6">Service Radius</th>
                    <th className="py-4 px-6">Status</th>
                    <th className="py-4 px-6 text-right">Management</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 text-sm">
                  {branchesData?.branches && branchesData.branches.length > 0 ? (
                    branchesData.branches.map((branch) => (
                      <tr key={branch.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition">
                        <td className="py-4 px-6 font-bold text-gray-900 dark:text-white">{branch.name}</td>
                        <td className="py-4 px-6 text-gray-600 dark:text-gray-300">{branch.location || branch.address?.street}</td>
                        <td className="py-4 px-6 font-mono text-xs text-gray-500">{branch.serviceRadiusKm} km</td>
                        <td className="py-4 px-6">
                          <span className={`text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wider ${
                            branch.status === 'ACTIVE'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                          }`}>
                            {branch.status}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button
                            onClick={() => alert(`Managing branch: ${branch.name}`)}
                            className="text-xs font-semibold px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-600 text-gray-700 dark:text-gray-300 rounded-xl transition"
                          >
                            Manage Branch →
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5" className="py-12 text-center text-gray-400 italic text-sm">
                        No physical branches registered yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            <div className="flex items-center justify-between p-6 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-500">
              <div>
                Showing page <span className="font-bold text-gray-900 dark:text-white">{branchesData?.pagination?.page || 1}</span> of{' '}
                <span className="font-bold text-gray-900 dark:text-white">{branchesData?.pagination?.totalPages || 1}</span>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(p - 1, 1))}
                  className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold rounded-xl disabled:opacity-50 transition"
                >
                  Previous
                </button>
                <button
                  disabled={page >= (branchesData?.pagination?.totalPages || 1)}
                  onClick={() => setPage(p => p + 1)}
                  className="px-4 py-2 bg-emerald-600 text-white font-semibold rounded-xl disabled:opacity-50 transition"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
