import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';

const roles = ['PHARMACY_STAFF', 'PHARMACIST', 'ORDER_MANAGER', 'INVENTORY_MANAGER', 'DISPATCHER', 'RIDER', 'TENANT_RIDER'];

export default function TenantBranchTeamManager({ tenantId = '' }) {
  const [branches, setBranches] = useState([]);
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState('');
  const [branchId, setBranchId] = useState('');
  const [role, setRole] = useState('PHARMACY_STAFF');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = tenantId ? { tenantId } : {};
      const [branchResponse, memberResponse] = await Promise.all([
        apiClient.get('/api/tenant/branches', { params }),
        apiClient.get('/api/tenant/members', { params })
      ]);
      const branchRows = branchResponse.data?.branches || branchResponse.data?.data || [];
      setBranches(Array.isArray(branchRows) ? branchRows : []);
      setMembers(Array.isArray(memberResponse.data?.members) ? memberResponse.data.members : []);
      setBranchId(current => current || String(branchRows.find(item => item.isDefault)?.id || branchRows[0]?.id || branchRows[0]?._id || ''));
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Branch team could not be loaded.');
    } finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const assign = async event => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      await apiClient.post('/api/tenant/members', { email, branchId, role, ...(tenantId ? { tenantId } : {}) });
      setEmail('');
      setNotice('Existing user assigned to the selected branch.');
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'User could not be assigned.');
    } finally { setSaving(false); }
  };

  const updateMember = async (member, changes) => {
    setSaving(true); setError(''); setNotice('');
    try {
      await apiClient.patch(`/api/tenant/members/${member._id || member.id}`, changes, { params: tenantId ? { tenantId } : undefined });
      setNotice('Branch user assignment updated.');
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Branch user could not be updated.');
    } finally { setSaving(false); }
  };

  return (
    <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div><h3 className="text-sm font-black uppercase tracking-wide text-slate-900">Branch users & role assignment</h3><p className="mt-1 text-xs text-slate-500">Assign an already registered account to one active branch. Branch roles cannot grant tenant-owner or tenant-admin privileges.</p></div>
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700">{notice}</p>}
      <form onSubmit={assign} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="space-y-1 text-xs font-bold text-slate-600 sm:col-span-2">Registered user email
          <input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="staff@example.com" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
        </label>
        <label className="space-y-1 text-xs font-bold text-slate-600">Branch
          <select required value={branchId} onChange={event => setBranchId(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
            <option value="">Select branch</option>{branches.map(item => <option key={item.id || item._id} value={item.id || item._id}>{item.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-bold text-slate-600">Role
          <select value={role} onChange={event => setRole(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">{roles.map(item => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select>
        </label>
        <div className="sm:col-span-4"><button type="submit" disabled={saving || !branchId} className="rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Assign branch user'}</button></div>
      </form>
      <div className="space-y-2">
        {loading ? <p className="text-xs text-slate-500">Loading branch users…</p> : members.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">No branch user assignments found.</p> : members.map(member => (
          <div key={member.id || member._id} className="grid grid-cols-1 items-center gap-2 rounded-xl border border-slate-100 p-3 sm:grid-cols-[1fr_180px_180px_110px]">
            <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800">{member.name || member.email || member.userId}</p><p className="truncate text-[11px] text-slate-500">{member.email || member.userId} · {member.status}</p></div>
            <select aria-label="Branch role" value={member.role} disabled={saving || !roles.includes(member.role)} onChange={event => updateMember(member, { role: event.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-xs">{roles.map(item => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select>
            <select aria-label="Assigned branch" value={member.branchId || ''} disabled={saving || member.status === 'REVOKED'} onChange={event => updateMember(member, { branchId: event.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-xs">{branches.map(item => <option key={item.id || item._id} value={item.id || item._id}>{item.name}</option>)}</select>
            <button type="button" disabled={saving || member.status === 'REVOKED'} onClick={() => updateMember(member, { status: 'REVOKED' })} className="rounded-lg border border-rose-200 px-2 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">Revoke access</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={load} disabled={loading} className="text-xs font-bold text-blue-700">{loading ? 'Refreshing…' : 'Refresh team'}</button>
    </section>
  );
}
