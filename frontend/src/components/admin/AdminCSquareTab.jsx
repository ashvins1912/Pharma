import React, { useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useAuth } from '../../context/AuthContext';

export default function AdminCSquareTab() {
  const { user, hasPermission } = useAuth();
  const canRead = hasPermission('csquare.read');
  const canManage = hasPermission('csquare.manage');
  const canSync = hasPermission('csquare.sync');
  const [tenantId, setTenantId] = useState(user?.tenantId || '');
  const [branchId, setBranchId] = useState(user?.branchId || '');
  const [integration, setIntegration] = useState(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');

  const headers = tenantId ? { 'X-Tenant-Id': tenantId, ...(branchId ? { 'X-Branch-Id': branchId } : {}) } : {};

  const load = async () => {
    if (!canRead || !tenantId) return;
    setLoading(true); setMessage('');
    try {
      const { data } = await apiClient.get('/api/v1/integrations', {
        params: { tenantId, ...(branchId ? { branchId } : {}) },
        headers
      });
      setIntegration(data?.data || null);
    } catch (error) {
      setMessage(error.message || 'Unable to load C-Square integration.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [canRead, tenantId, branchId]);

  const run = async (action) => {
    if (!tenantId || working) return;
    setWorking(true); setMessage('');
    try {
      const path = action === 'sync' ? '/api/v1/integrations/sync' : '/api/v1/integrations/test-connection';
      const { data } = await apiClient.post(path, { tenantId, branchId, syncType: 'STOCK' }, { headers });
      setIntegration(data?.data || integration);
      setMessage(action === 'sync' ? 'C-Square stock sync completed.' : 'C-Square connection test completed.');
    } catch (error) {
      setMessage(error.message || 'C-Square operation failed.');
    } finally { setWorking(false); }
  };

  if (!canRead) {
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm font-bold text-amber-900">C-Square access is not enabled for your account.</div>;
  }

  return (
    <section className="space-y-4">
      <div className="rounded-3xl bg-slate-950 p-6 text-white">
        <p className="text-[10px] font-black uppercase tracking-[.18em] text-blue-300">POS / ERP Integration</p>
        <h3 className="mt-1 text-xl font-black">C-Square Operations</h3>
        <p className="mt-2 text-xs text-slate-300">Monitor the branch connection and control inventory synchronization with C-Square.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <h4 className="text-sm font-black text-slate-900">Target pharmacy</h4>
          <input value={tenantId} onChange={e => setTenantId(e.target.value)} placeholder="Tenant ID" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" />
          <input value={branchId} onChange={e => setBranchId(e.target.value)} placeholder="Branch ID (optional)" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" />
          <button onClick={load} disabled={loading || !tenantId} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white disabled:opacity-50">{loading ? 'Loading…' : 'Refresh Status'}</button>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h4 className="text-sm font-black text-slate-900">Connection</h4>
          <div className="mt-3 rounded-xl bg-slate-50 p-4">
            <div className="text-xs text-slate-500">Provider</div>
            <div className="font-black text-slate-900">{integration?.provider || 'CSQUARE'}</div>
            <div className="mt-2 text-xs text-slate-500">Status</div>
            <div className="font-black text-emerald-700">{integration?.status || 'Not configured'}</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {canManage && <button onClick={() => run('test')} disabled={working || !tenantId} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 disabled:opacity-50">Test Connection</button>}
            {canSync && <button onClick={() => run('sync')} disabled={working || !tenantId} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{working ? 'Working…' : 'Sync Stock'}</button>}
          </div>
        </div>
      </div>
      {message && <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{message}</div>}
    </section>
  );
}
