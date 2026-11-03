import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useLanguage } from '../../context/LanguageContext';

const emptyForm = { name: '', code: '', phone: '', email: '', street: '', city: '', state: '', pincode: '' };

export default function TenantRegistry() {
  const { t } = useLanguage();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activatingId, setActivatingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/api/tenant/branches?includePending=true&limit=100');
      setBranches(Array.isArray(response.data?.branches) ? response.data.branches : []);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Failed to fetch your pharmacy branches.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  const updateField = (field, value) => setForm(current => ({ ...current, [field]: value }));

  const createBranch = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiClient.post('/api/tenant/branches', {
        name: form.name, code: form.code, phone: form.phone, email: form.email,
        address: { street: form.street, city: form.city, state: form.state, pincode: form.pincode }
      });
      setForm(emptyForm);
      setShowForm(false);
      setNotice('Branch created as Pending. Review the details, then activate it when setup is complete.');
      await fetchBranches();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Branch could not be created.');
    } finally {
      setSaving(false);
    }
  };

  const activateBranch = async (branchId) => {
    setActivatingId(branchId);
    setError('');
    setNotice('');
    try {
      await apiClient.post(`/api/tenant/branches/${encodeURIComponent(branchId)}/activate`);
      setNotice('Branch activated. It is now available in your branch selector.');
      await fetchBranches();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Branch could not be activated.');
    } finally {
      setActivatingId('');
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-8 space-y-6 my-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-gray-900 p-6 rounded-3xl shadow-xl border border-gray-100 dark:border-gray-800">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">{t('tenantInfrastructure')}</span>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white mt-1">{t('dispensaryBranchesRegistry')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Create, review and activate locations belonging to your pharmacy.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={fetchBranches} className="px-4 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-xl">Refresh</button>
          <button type="button" onClick={() => setShowForm(value => !value)} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl shadow transition">{showForm ? 'Close form' : 'Create branch'}</button>
        </div>
      </div>

      {error && <div role="alert" className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 rounded-2xl text-sm">{error}</div>}
      {notice && <div role="status" className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300 rounded-2xl text-sm">{notice}</div>}

      {showForm && (
        <form onSubmit={createBranch} className="bg-white dark:bg-gray-900 rounded-3xl shadow-lg border border-gray-100 dark:border-gray-800 p-6 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">New pharmacy branch</h2>
            <p className="text-sm text-gray-500 mt-1">All fields are required. The branch remains Pending until explicitly activated.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              ['name', 'Branch name', 'e.g. Sarjapur Main Branch'],
              ['code', 'Unique branch code', 'e.g. BLR-SAR-01'],
              ['phone', 'Contact phone', '+91 9876543210'],
              ['email', 'Contact email', 'branch@example.com'],
              ['street', 'Street address', 'Building, road, locality'],
              ['city', 'City', 'Bengaluru'],
              ['state', 'State', 'Karnataka'],
              ['pincode', 'PIN code', '560035']
            ].map(([field, label, placeholder]) => (
              <label key={field} className="block text-sm font-semibold text-gray-700 dark:text-gray-200">
                {label}
                <input required value={form[field]} onChange={event => updateField(field, event.target.value)} placeholder={placeholder} maxLength={field === 'street' ? 200 : field === 'name' ? 120 : 120} className="mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowForm(false); setForm(emptyForm); }} className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm font-semibold">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save as Pending'}</button>
          </div>
        </form>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        {loading ? <div className="p-12 text-center text-gray-500">{t('loadingBranchRegistry')}</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead><tr className="border-b border-gray-100 dark:border-gray-800 text-xs font-bold uppercase tracking-wider text-gray-400">
                <th className="py-4 px-6">Branch</th><th className="py-4 px-6">Address</th><th className="py-4 px-6">Code</th><th className="py-4 px-6">Status</th><th className="py-4 px-6 text-right">Action</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 text-sm">
                {branches.length ? branches.map(branch => (
                  <tr key={branch.id || branch._id}>
                    <td className="py-4 px-6 font-bold text-gray-900 dark:text-white">{branch.name}</td>
                    <td className="py-4 px-6 text-gray-600 dark:text-gray-300">{[branch.address?.street, branch.address?.city, branch.address?.state, branch.address?.pincode].filter(Boolean).join(', ')}</td>
                    <td className="py-4 px-6 font-mono text-xs">{branch.code}</td>
                    <td className="py-4 px-6"><span className={`text-xs font-semibold px-3 py-1 rounded-full ${branch.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>{branch.status}</span></td>
                    <td className="py-4 px-6 text-right">{branch.status === 'PENDING' && <button type="button" disabled={activatingId === String(branch.id || branch._id)} onClick={() => activateBranch(String(branch.id || branch._id))} className="text-xs font-semibold px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl disabled:opacity-50">{activatingId === String(branch.id || branch._id) ? 'Activating…' : 'Verify & activate'}</button>}</td>
                  </tr>
                )) : <tr><td colSpan="5" className="py-12 text-center text-gray-400">No branches registered for this pharmacy yet. Create your first branch to continue.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-gray-500">Only branches belonging to your authenticated pharmacy are shown. Inventory imports remain disabled until the separate import safety process is approved.</p>
    </div>
  );
}
