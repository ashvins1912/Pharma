import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';

const bytes = value => {
  if (value === null || value === undefined) return 'Not reported';
  const n = Number(value); if (!Number.isFinite(n)) return 'Not reported';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB']; let size = n / 1024, i = 0;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i += 1; }
  return `${size.toFixed(2)} ${units[i]}`;
};
const pct = (used, limit) => used == null || !limit ? 'Not reported' : `${(Number(used) / Number(limit) * 100).toFixed(1)}%`;
const unwrap = response => response?.data?.data || response?.data || {};

export default function InfrastructureOperations() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { const response = await apiClient.get('/api/v1/admin/infrastructure/status'); setSnapshot(unwrap(response)); }
    catch (failure) { setError(failure.response?.data?.message || failure.message || 'Could not load infrastructure status.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const runAction = async (resource, action) => {
    const phrase = `${action.toUpperCase()} RESOURCE`;
    const confirmed = window.prompt(`This sends a ${action} request to ${resource.name} (${resource.provider}). Type "${phrase}" to continue.`);
    if (confirmed !== phrase) return;
    setBusy(resource.id); setNotice(''); setError('');
    try {
      const response = await apiClient.post(`/api/v1/admin/infrastructure/resources/${encodeURIComponent(resource.id)}/${action}`, { confirmation: phrase });
      setNotice(response.data?.message || `${action} request accepted.`);
      await refresh();
    } catch (failure) { setError(failure.response?.data?.message || failure.message || 'Lifecycle action failed.'); }
    finally { setBusy(''); }
  };

  const providers = snapshot?.providers || [];
  const databases = snapshot?.databases || [];
  const resources = providers.flatMap(provider => provider.resources || []);
  const mongo = databases.find(item => item.id === 'mongodb');

  return <section className="space-y-5">
    <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Super Admin · Task Operations</p><h2 className="mt-1 text-xl font-black">Infrastructure & Resource Operations</h2><p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">Provider-neutral control plane for cloud resources and databases. Review resource state, memory, CPU, bandwidth and MongoDB storage; start, stop or restart supported compute services.</p></div>
        <button type="button" onClick={refresh} disabled={loading || Boolean(busy)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh usage'}</button>
      </div>
      {snapshot?.checkedAt && <p className="mt-3 text-xs text-slate-500">Last checked: {new Date(snapshot.checkedAt).toLocaleString()}</p>}
    </header>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <section className="space-y-3"><div><h3 className="font-black">Cloud providers</h3><p className="text-xs text-slate-500">Only configured providers are connected. Render is the initial lifecycle adapter; other clouds plug into the same normalized resource contract.</p></div>
      {providers.map(provider => <article key={provider.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-extrabold">{provider.name}</div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold dark:bg-slate-800">{provider.status}</span></div>
        {provider.error && <p className="mt-2 text-sm text-rose-700">{provider.error}</p>}
        {provider.message && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{provider.message}</p>}
        {(provider.resources || []).map(resource => <div key={resource.id} className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-bold">{resource.name}</p><p className="text-xs text-slate-500">{resource.type} · {resource.region || 'Region unknown'} · {resource.plan || 'Plan unknown'} · {resource.status}</p></div><div className="flex flex-wrap gap-2">
            {resource.capabilities?.start && <button disabled={Boolean(busy)} onClick={() => runAction(resource, 'start')} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Start</button>}
            {resource.capabilities?.stop && <button disabled={Boolean(busy)} onClick={() => runAction(resource, 'stop')} className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Stop</button>}
            {resource.capabilities?.restart && <button disabled={Boolean(busy)} onClick={() => runAction(resource, 'restart')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold disabled:opacity-50">Restart</button>}
          </div></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4"><div><p className="text-xs text-slate-500">Memory</p><p className="text-sm font-bold">{bytes(resource.usage?.memoryBytes)}</p><p className="text-xs text-slate-500">Limit: {bytes(resource.usage?.memoryLimitBytes)} · {pct(resource.usage?.memoryBytes, resource.usage?.memoryLimitBytes)}</p></div><div><p className="text-xs text-slate-500">CPU</p><p className="text-sm font-bold">{resource.usage?.cpu == null ? 'Not reported' : `${resource.usage.cpu}%`}</p></div><div><p className="text-xs text-slate-500">Outbound bandwidth</p><p className="text-sm font-bold">{bytes(resource.usage?.outboundBytes)}</p></div><div><p className="text-xs text-slate-500">Disk</p><p className="text-sm font-bold">{bytes(resource.usage?.diskBytes)}</p></div></div>
          <p className="mt-2 text-xs text-slate-500">{resource.usage?.source}</p>
        </div>)}
      </article>)}
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-black">MongoDB resource usage</h3><p className="text-xs text-slate-500">Database-level storage, data, indexes and per-collection footprint.</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold dark:bg-slate-800">{mongo?.status || 'Loading'}</span></div>
      {mongo?.message && <p className="mt-2 text-sm text-amber-700">{mongo.message}</p>}
      {mongo?.configured && <><div className="mt-3 grid gap-3 sm:grid-cols-4">{[['Database', mongo.database], ['Storage', bytes(mongo.storageBytes)], ['Data', bytes(mongo.dataBytes)], ['Indexes', bytes(mongo.indexBytes)]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-sm font-bold">{value}</p></div>)}</div><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="p-2">Collection</th><th className="p-2 text-right">Documents</th><th className="p-2 text-right">Data</th><th className="p-2 text-right">Indexes</th><th className="p-2 text-right">Storage</th></tr></thead><tbody>{(mongo.collections || []).map(item => <tr key={item.name} className="border-b border-slate-100 dark:border-slate-800"><td className="p-2 font-semibold">{item.name}</td><td className="p-2 text-right">{Number(item.documents || 0).toLocaleString()}</td><td className="p-2 text-right">{bytes(item.dataBytes)}</td><td className="p-2 text-right">{bytes(item.indexBytes)}</td><td className="p-2 text-right">{bytes(item.storageBytes)}</td></tr>)}</tbody></table></div><p className="mt-2 text-xs text-slate-500">MongoDB collection storage figures are database statistics, not guaranteed reclaimable disk space. Use Database Cleanup for retention-governed document cleanup.</p></>}
    </section>
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"><h3 className="font-bold">Metrics and multi-cloud adapter contract</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{snapshot?.metrics?.note || 'Metrics availability depends on the provider adapter.'} The Render service-list API does not return live CPU, RAM or egress samples, so those values are intentionally shown as “Not reported” rather than zero. Connect provider metrics/OTel to supply normalized usage samples.</p><p className="mt-2 text-xs text-slate-500">Adapter targets: Render, AWS, Azure, GCP, MongoDB Atlas and self-hosted MongoDB. No cloud credentials are exposed to the browser.</p></section>
  </section>;
}
