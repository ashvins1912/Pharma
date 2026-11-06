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
  TENANT_ADMIN: []
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
          <select value={form.branchId} onChange={event => setForm(current => ({ ...current, branchId: event.target.value }))} required={form.role !== 'TENANT_ADMIN'} disabled={form.role === 'TENANT_ADMIN'} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
            <option value="">All branches (tenant-wide)</option>
            {branches.map(branch => <option key={idOf(branch)} value={idOf(branch)}>{branch.name || branch.code}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-bold text-slate-600">Role
          <select value={form.role} onChange={event => setForm(current => ({ ...current, role: event.target.value, branchId: event.target.value === 'TENANT_ADMIN' ? '' : current.branchId }))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
            {ROLES.map(role => <option key={role} value={role}>{role.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <div className="md:col-span-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">The email must belong to an active registered user of this pharmacy. Existing owner/admin memberships are protected.</p>
          <button disabled={saving || !form.email.trim() || (form.role !== 'TENANT_ADMIN' && !form.branchId)} className="rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-extrabold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Add / assign user'}</button>
        </div>
      </form>
      <div className="space-y-2">
        <div className="flex items-center justify-between"><h4 className="text-sm font-black text-slate-800">Current memberships ({memberships.length})</h4><button type="button" onClick={() => void load()} disabled={loading} className="text-xs font-bold text-blue-700">{loading ? 'Loading…' : 'Refresh'}</button></div>
        {memberships.length === 0 && !loading ? <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">No staff memberships found.</p> : memberships.map(member => (
          <div key={idOf(member)} className="grid gap-2 rounded-xl border border-slate-100 p-3 md:grid-cols-[minmax(0,1fr)_180px_180px_auto_auto] md:items-center">
            <div className="min-w-0"><p className="break-all text-xs font-bold text-slate-800">{member.name || member.email || member.userId}</p><p className="break-all text-[10px] text-slate-400">{member.userId} · {member.status}</p></div>
            {member.role === 'TENANT_OWNER'
              ? <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">TENANT OWNER · protected</span>
              : <select aria-label="Staff role" value={member.role} disabled={member.status !== 'ACTIVE'} onChange={event => updateStaff(member, { role: event.target.value, branchId: event.target.value === 'TENANT_ADMIN' ? null : (member.branchId || null), permissions: ROLE_PERMISSIONS[event.target.value] || [] })} className="rounded-lg border border-slate-300 px-2 py-2 text-xs disabled:opacity-50">
                  {ROLES.map(role => <option key={role} value={role} disabled={member.role === 'TENANT_ADMIN' && role !== 'TENANT_ADMIN'}>{role.replace(/_/g, ' ')}</option>)}
                </select>}
            <select aria-label="Staff branch" value={member.branchId || ''} disabled={member.status !== 'ACTIVE' || member.role === 'TENANT_OWNER'} onChange={event => {
              const branchId = event.target.value || null;
              const role = member.role === 'TENANT_ADMIN' && branchId ? 'PHARMACY_STAFF' : member.role;
              updateStaff(member, { role, branchId, permissions: ROLE_PERMISSIONS[role] || [] });
            }} className="rounded-lg border border-slate-300 px-2 py-2 text-xs disabled:opacity-50">
              <option value="" disabled={member.role !== 'TENANT_ADMIN'}>{member.role === 'TENANT_ADMIN' ? 'Choose branch to scope' : member.role === 'TENANT_OWNER' ? 'Tenant-wide owner' : 'Branch required'}</option>
              {branches.map(branch => <option key={idOf(branch)} value={idOf(branch)}>{branch.name || branch.code}</option>)}
            </select>
            <button type="button" onClick={() => void updateStaff(member, { status: member.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' })} disabled={member.role === 'TENANT_OWNER' || !['ACTIVE', 'SUSPENDED'].includes(member.status)} className="rounded-lg border border-amber-200 disabled:cursor-not-allowed disabled:opacity-40 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50">{member.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}</button>
            <button type="button" onClick={() => void revokeStaff(member)} disabled={String(member.role).toUpperCase() === 'TENANT_OWNER' || !['ACTIVE', 'SUSPENDED'].includes(member.status)} className="rounded-lg border border-rose-200 disabled:cursor-not-allowed disabled:opacity-40 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50">Revoke</button>
          </div>
        ))}
      </div>
    </section>
  );
}
