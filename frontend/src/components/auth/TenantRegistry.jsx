import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import apiClient from '../../api/apiClient';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

const blankBranch = {
  name: '', code: '', phone: '', email: '',
  address: { street: '', city: '', state: '', pincode: '' },
  serviceRadiusKm: '', deliveryMode: '',
  minimumOrderValue: '', freeDeliveryAbove: '', deliveryFee: '',
  operatingHours: { open: '', close: '' }, isDefault: false
};

const fieldClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';
const labelClass = 'mb-1 block text-xs font-bold text-slate-600';

export default function TenantRegistry() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const role = String(user?.app_metadata?.role || user?.role || '').toUpperCase();
  const canManageBranches = ['TENANT_OWNER', 'TENANT_ADMIN', 'OWNER', 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankBranch);

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/api/tenant/branches?limit=100');
      setBranches(Array.isArray(response.data?.branches) ? response.data.branches : []);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Failed to fetch branches.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...blankBranch, address: { ...blankBranch.address }, operatingHours: { ...blankBranch.operatingHours } });
    setError('');
    setModalOpen(true);
  };

  const openEdit = branch => {
    setEditingId(branch.id || branch._id);
    setForm({
      ...blankBranch, ...branch,
      address: { ...blankBranch.address, ...(branch.address || {}) },
      operatingHours: { ...blankBranch.operatingHours, ...(branch.operatingHours || {}) },
      isDefault: Boolean(branch.isDefault)
    });
    setError('');
    setModalOpen(true);
  };

  const setField = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const setAddress = (key, value) => setForm(current => ({ ...current, address: { ...current.address, [key]: value } }));
  const setHours = (key, value) => setForm(current => ({ ...current, operatingHours: { ...current.operatingHours, [key]: value } }));

  const saveBranch = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (editingId) {
        await apiClient.patch(`/api/tenant/branches/${encodeURIComponent(editingId)}`, form);
        setNotice('Branch details updated successfully.');
      } else {
        await apiClient.post('/api/tenant/branches', form);
        setNotice('Branch created successfully.');
      }
      setModalOpen(false);
      await fetchBranches();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Branch could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (branch, status) => {
    setError('');
    setNotice('');
    try {
      await apiClient.patch(`/api/tenant/branches/${encodeURIComponent(branch.id || branch._id)}/status`, { status });
      setNotice(status === 'ACTIVE' ? 'Branch activated.' : 'Branch deactivated.');
      await fetchBranches();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Branch status could not be changed.');
    }
  };

  const archiveBranch = async branch => {
    const name = branch.name || 'this branch';
    if (!window.confirm(`Archive ${name}? It will no longer accept new activity. Historical orders and inventory references will be preserved.`)) return;
    setError('');
    setNotice('');
    try {
      await apiClient.delete(`/api/tenant/branches/${encodeURIComponent(branch.id || branch._id)}`);
      setNotice('Branch archived. Historical records have been preserved.');
      await fetchBranches();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Branch could not be archived.');
    }
  };

  const visibleBranches = branches.filter(branch => statusFilter === 'ALL' || branch.status === statusFilter);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">{t('tenantInfrastructure')}</span>
          <h3 className="mt-1 text-xl font-black text-slate-900">{t('dispensaryBranchesRegistry')}</h3>
          <p className="mt-1 text-sm text-slate-500">Manage this pharmacy’s locations, delivery settings and operational status.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={fetchBranches} disabled={loading} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">Refresh</button>
          {canManageBranches && <button type="button" onClick={openCreate} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700">+ Add branch</button>}
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{branches.length} branch{branches.length === 1 ? '' : 'es'} registered</p>
        <select aria-label="Filter branches by status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <option value="ALL">All branches</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive / archived</option><option value="SUSPENDED">Suspended</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? <div className="p-10 text-center text-sm text-slate-500">Loading branch registry…</div> : visibleBranches.length ? (
          <div className="divide-y divide-slate-100">
            {visibleBranches.map(branch => {
              const id = branch.id || branch._id;
              const address = [branch.address?.street, branch.address?.city, branch.address?.state, branch.address?.pincode].filter(Boolean).join(', ');
              return <article key={id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-bold text-slate-900">{branch.name}</h4>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">{branch.code}</span>
                    {branch.isDefault && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700">DEFAULT</span>}
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${branch.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{branch.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{address || 'Address not added'} · {branch.serviceRadiusKm != null ? `${branch.serviceRadiusKm} km service radius` : 'Service radius not configured'}</p>
                  <p className="mt-1 text-xs text-slate-400">{branch.phone || 'No phone'}{branch.email ? ` · ${branch.email}` : ''}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => openEdit(branch)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Edit</button>
                  {branch.status === 'ACTIVE'
                    ? <button type="button" onClick={() => changeStatus(branch, 'INACTIVE')} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-50">Deactivate</button>
                    : <button type="button" onClick={() => changeStatus(branch, 'ACTIVE')} className="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50">Activate</button>}
                  <button type="button" onClick={() => archiveBranch(branch)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50">Remove</button>
                </div>
              </article>;
            })}
          </div>
        ) : <div className="p-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-2xl">⌖</div>
          <h4 className="font-bold text-slate-900">{statusFilter === 'ALL' ? 'No branches added yet' : `No ${statusFilter.toLowerCase()} branches`}</h4>
          <p className="mt-1 text-sm text-slate-500">Add your first pharmacy branch to configure its address and delivery settings.</p>
          {statusFilter === 'ALL' && canManageBranches && <button type="button" onClick={openCreate} className="mt-4 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white">Add your first branch</button>}
        </div>}
      </div>

      {modalOpen && createPortal(<div className="fixed inset-0 z-[10000] flex items-center justify-center overflow-hidden bg-slate-950/60 p-2 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="branch-dialog-title">
        <form onSubmit={saveBranch} className="flex w-full max-w-3xl min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:rounded-3xl" style={{ maxHeight: 'calc(100dvh - 2rem)' }}>
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-4 py-4 sm:px-7 sm:py-5">
            <div className="min-w-0"><h3 id="branch-dialog-title" className="text-xl font-black text-slate-900">{editingId ? 'Edit branch' : 'Add pharmacy branch'}</h3><p className="mt-1 text-sm text-slate-500">Branch details are scoped to the authenticated tenant.</p></div>
            <button type="button" onClick={() => setModalOpen(false)} className="shrink-0 rounded-lg px-3 py-1 text-xl text-slate-400 hover:bg-slate-100" aria-label="Close">×</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-7 sm:py-5">
            <div className="grid gap-4 sm:grid-cols-2">
            <label><span className={labelClass}>Branch name *</span><input required maxLength={100} className={fieldClass} value={form.name} onChange={e => setField('name', e.target.value)} /></label>
            <label><span className={labelClass}>Branch code *</span><input required maxLength={20} className={fieldClass} value={form.code} onChange={e => setField('code', e.target.value.toUpperCase())} /></label>
            <label><span className={labelClass}>Phone</span><input className={fieldClass} value={form.phone || ''} onChange={e => setField('phone', e.target.value)} /></label>
            <label><span className={labelClass}>Email</span><input type="email" className={fieldClass} value={form.email || ''} onChange={e => setField('email', e.target.value)} /></label>
            <label className="sm:col-span-2"><span className={labelClass}>Street address</span><input className={fieldClass} value={form.address?.street || ''} onChange={e => setAddress('street', e.target.value)} /></label>
            <label><span className={labelClass}>City</span><input className={fieldClass} value={form.address?.city || ''} onChange={e => setAddress('city', e.target.value)} /></label>
            <label><span className={labelClass}>State</span><input className={fieldClass} value={form.address?.state || ''} onChange={e => setAddress('state', e.target.value)} /></label>
            <label><span className={labelClass}>PIN code</span><input className={fieldClass} value={form.address?.pincode || ''} onChange={e => setAddress('pincode', e.target.value)} /></label>
            <label><span className={labelClass}>Service radius (km)</span><input type="number" min="0" step="0.1" className={fieldClass} value={form.serviceRadiusKm} onChange={e => setField('serviceRadiusKm', e.target.value)} /></label>
            <label><span className={labelClass}>Delivery mode</span><select className={fieldClass} value={form.deliveryMode || ''} onChange={e => setField('deliveryMode', e.target.value)}><option value="">Select delivery mode</option><option value="OWN_RIDER">Own rider</option><option value="THIRD_PARTY">Third party</option><option value="PICKUP">Customer pickup</option></select></label>
            <label><span className={labelClass}>Delivery fee (₹)</span><input type="number" min="0" className={fieldClass} value={form.deliveryFee} onChange={e => setField('deliveryFee', e.target.value)} /></label>
            <label><span className={labelClass}>Minimum order (₹)</span><input type="number" min="0" className={fieldClass} value={form.minimumOrderValue} onChange={e => setField('minimumOrderValue', e.target.value)} /></label>
            <label><span className={labelClass}>Free delivery above (₹)</span><input type="number" min="0" className={fieldClass} value={form.freeDeliveryAbove} onChange={e => setField('freeDeliveryAbove', e.target.value)} /></label>
            <label><span className={labelClass}>Opening time</span><input type="time" className={fieldClass} value={form.operatingHours?.open || ''} onChange={e => setHours('open', e.target.value)} /></label>
            <label><span className={labelClass}>Closing time</span><input type="time" className={fieldClass} value={form.operatingHours?.close || ''} onChange={e => setHours('close', e.target.value)} /></label>
            </div>
            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={Boolean(form.isDefault)} onChange={e => setField('isDefault', e.target.checked)} /> Set as default branch</label>
              {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
            </div>
          </div>
          <div className="flex shrink-0 flex-col-reverse justify-end gap-2 border-t border-slate-100 bg-white px-4 py-3 sm:flex-row sm:px-7 sm:py-4">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create branch'}</button>
          </div>
        </form>
      </div>, document.body)}
    </div>
  );
}
