import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';

const ROLE_PERMISSIONS = {
  PHARMACY_STAFF: ['orders.read', 'inventory.read'],
  PHARMACIST: ['orders.read', 'orders.manage', 'inventory.read', 'medicine_requests.read', 'medicine_requests.manage'],
  ORDER_MANAGER: ['orders.read', 'orders.manage', 'medicine_requests.read', 'medicine_requests.manage'],
  INVENTORY_MANAGER: ['inventory.read', 'inventory.write'],
  DISPATCHER: ['orders.read', 'orders.manage', 'delivery.read', 'delivery.manage'],
  RIDER: ['delivery.read'],
  TENANT_RIDER: ['delivery.read'],
  TENANT_ADMIN: ['*']
};
const ROLES = Object.keys(ROLE_PERMISSIONS);
const idOf = item => String(item?._id || item?.id || '');

export default function TenantStaffManager({ tenantId }) {
  const [memberships, setMemberships] = useState([]);
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState({ email: '', branchId: '', role: 'PHARMACY_STAFF' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const [staffResponse, branchResponse] = await Promise.all([
        apiClient.get(`/api/v1/tenants/${encodeURIComponent(tenantId)}/memberships`),
        apiClient.get(`/api/v1/tenants/${encodeURIComponent(tenantId)}/branches`)
      ]);
      const staff = staffResponse.data?.data || [];
      const branchPayload = branchResponse.data?.data || [];
      setMemberships(Array.isArray(staff) ? staff : []);
      setBranches(Array.isArray(branchPayload) ? branchPayload.filter(branch => String(branch.status || 'ACTIVE').toUpperCase() === 'ACTIVE') : []);
    } catch (err) {
      setError(err?.response?.data?.message || 'Branch staff could not be loaded. Check tenant administrator access.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const addStaff = async event => {
    event.preventDefault();
    if (!tenantId || !form.email.trim()) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiClient.post(`/api/v1/tenants/${encodeURIComponent(tenantId)}/memberships`, {
        email: form.email.trim(),
        branchId: form.branchId || null,
        role: form.role,
        permissions: ROLE_PERMISSIONS[form.role]
      });
      setForm(current => ({ ...current, email: '' }));
      setNotice('User access assigned. The change is recorded in pharmacy activity.');
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not assign this user to the pharmacy branch.');
    } finally {
      setSaving(false);
    }
  };

  const updateStaff = async (member, changes) => {
    setError('');
    setNotice('');
    try {
      await apiClient.patch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/memberships/${encodeURIComponent(idOf(member))}`, changes);
      setNotice('Staff role or branch assignment updated.');
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Staff membership could not be updated.');
    }
  };

  const revokeStaff = async member => {
    if (!window.confirm(`Revoke pharmacy access for user ${member.userId}?`)) return;
    try {
      await apiClient.delete(`/api/v1/tenants/${encodeURIComponent(tenantId)}/memberships/${encodeURIComponent(idOf(member))}`);
      setNotice('Staff access revoked. Historical records are preserved.');
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Staff access could not be revoked.');
    }
  };

  if (!tenantId) return null;
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div>
        <h3 className="text-lg font-black text-slate-900">Branch staff &amp; role access</h3>
        <p className="mt-1 text-xs text-slate-500">Assign an existing registered pharmacy user by email to this pharmacy or a specific branch. Role presets grant only the listed operational permissions.</p>
      </div>
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</p>}
      <form onSubmit={addStaff} className="grid gap-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 md:grid-cols-4">
        <label className="space-y-1 text-xs font-bold text-slate-600 md:col-span-2">Registered pharmacy user email
          <input required type="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} placeholder="staff@pharmacy.com" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
        </label>
        <label className="space-y-1 text-xs font-bold text-slate-600">Branch
          <select value={form.branchId} onChange={event => setForm(current => ({ ...current, branchId: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
            <option value="">All branches (tenant-wide)</option>
            {branches.map(branch => <option key={idOf(branch)} value={idOf(branch)}>{branch.name || branch.code}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-bold text-slate-600">Role
          <select value={form.role} onChange={event => setForm(current => ({ ...current, role: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
            {ROLES.map(role => <option key={role} value={role}>{role.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <div className="md:col-span-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">The email must belong to an active registered user of this pharmacy. Existing owner/admin memberships are protected.</p>
          <button disabled={saving || !form.email.trim()} className="rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-extrabold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Add / assign user'}</button>
        </div>
      </form>
      <div className="space-y-2">
        <div className="flex items-center justify-between"><h4 className="text-sm font-black text-slate-800">Current memberships ({memberships.length})</h4><button type="button" onClick={() => void load()} disabled={loading} className="text-xs font-bold text-blue-700">{loading ? 'Loading…' : 'Refresh'}</button></div>
        {memberships.length === 0 && !loading ? <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">No staff memberships found.</p> : memberships.map(member => (
          <div key={idOf(member)} className="grid gap-2 rounded-xl border border-slate-100 p-3 md:grid-cols-[minmax(0,1fr)_180px_180px_auto] md:items-center">
            <div className="min-w-0"><p className="break-all text-xs font-bold text-slate-800">{member.name || member.email || member.userId}</p><p className="break-all text-[10px] text-slate-400">{member.userId} · {member.status}</p></div>
            <select aria-label="Staff role" value={member.role} onChange={event => updateStaff(member, { role: event.target.value, permissions: ROLE_PERMISSIONS[event.target.value] || [] })} className="rounded-lg border border-slate-300 px-2 py-2 text-xs">
              {ROLES.map(role => <option key={role} value={role}>{role.replace(/_/g, ' ')}</option>)}
            </select>
            <select aria-label="Staff branch" value={member.branchId || ''} onChange={event => updateStaff(member, { branchId: event.target.value || null })} className="rounded-lg border border-slate-300 px-2 py-2 text-xs">
              <option value="">All branches</option>
              {branches.map(branch => <option key={idOf(branch)} value={idOf(branch)}>{branch.name || branch.code}</option>)}
            </select>
            <button type="button" onClick={() => void revokeStaff(member)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50">Revoke</button>
          </div>
        ))}
      </div>
    </section>
  );
}
