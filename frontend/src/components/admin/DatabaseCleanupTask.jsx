import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';

const SERVICES = [
  { key: 'inventory', label: 'Inventory imports', base: '/api/v1/inventory/admin/database-cleanup', phrase: 'DELETE ELIGIBLE INVENTORY IMPORT DATA' },
  { key: 'medicine', label: 'Medicine catalogue imports', base: '/api/v1/inventory/catalogue/admin/database-cleanup', phrase: 'DELETE ELIGIBLE MEDICINE IMPORT DATA' },
  { key: 'notifications', label: 'Delivered notifications', base: '/api/v1/admin/database-cleanup/notifications', phrase: 'DELETE ELIGIBLE NOTIFICATION HISTORY' }
];
const formatBytes = value => {
  if (value === null || value === undefined) return 'Not estimated';
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024, index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size.toFixed(2)} ${units[index]}`;
};
const unwrap = response => response?.data?.data || response?.data || {};

export default function DatabaseCleanupTask() {
  const [status, setStatus] = useState({});
  const [preview, setPreview] = useState(null);
  const [results, setResults] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    const entries = await Promise.all(SERVICES.map(async service => {
      try {
        const response = await apiClient.get(`${service.base}/status`);
        return [service.key, { ...unwrap(response), available: true }];
      } catch (failure) {
        return [service.key, { available: false, error: failure.response?.data?.message || failure.message || 'Service unavailable' }];
      }
    }));
    setStatus(Object.fromEntries(entries));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const allServices = useMemo(() => SERVICES.map(service => ({ ...service, data: status[service.key] })), [status]);
  const previewCleanup = async () => {
    setLoading(true); setError(''); setResults(null);
    const entries = await Promise.all(SERVICES.map(async service => {
      try {
        const response = await apiClient.post(`${service.base}/preview`, {});
        return [service.key, { ...unwrap(response), available: true }];
      } catch (failure) {
        return [service.key, { available: false, error: failure.response?.data?.message || failure.message || 'Preview failed' }];
      }
    }));
    setPreview(Object.fromEntries(entries));
    setLoading(false);
  };

  const executeCleanup = async () => {
    setExecuting(true); setError('');
    const entries = await Promise.all(SERVICES.map(async service => {
      try {
        const response = await apiClient.post(`${service.base}/execute`, { confirmation: service.phrase });
        return [service.key, { ...unwrap(response), available: true }];
      } catch (failure) {
        return [service.key, { available: false, error: failure.response?.data?.message || failure.message || 'Execution failed', results: failure.response?.data?.results || [] }];
      }
    }));
    const next = Object.fromEntries(entries);
    setResults(next);
    setPreview(null);
    setConfirmation('');
    setExecuting(false);
    await refresh();
  };

  const totalEstimatedBytes = allServices.reduce((sum, service) => {
    const collections = service.data?.collections || [];
    return sum + collections.reduce((inner, collection) => inner + (Number(collection.estimatedBytes) || 0), 0);
  }, 0);

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Super Admin · Task Operations</p>
            <h2 className="mt-1 text-xl font-black text-slate-900 dark:text-white">Database Cleanup</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">Review eligible import staging data and delivered notification history across the connected services. A fresh server-side eligibility check runs again when cleanup executes.</p>
          </div>
          <button type="button" onClick={refresh} disabled={loading || executing} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50 dark:border-slate-600">{loading ? 'Refreshing…' : 'Refresh status'}</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><p className="text-xs text-slate-500">Estimated reclaimable data</p><p className="mt-1 text-2xl font-black">{formatBytes(totalEstimatedBytes)}</p><p className="mt-1 text-xs text-slate-500">Document-size estimate, not guaranteed Atlas disk space returned</p></div>
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><p className="text-xs text-slate-500">Connected cleanup services</p><p className="mt-1 text-2xl font-black">{allServices.filter(item => item.data?.available).length} / 3</p><p className="mt-1 text-xs text-slate-500">A failed service is shown explicitly and is not treated as cleaned</p></div>
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-3">
        {allServices.map(service => {
          const data = preview?.[service.key] || service.data;
          return <article key={service.key} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2"><h3 className="font-extrabold">{service.label}</h3><span className={`rounded-full px-2 py-1 text-xs font-bold ${data?.available ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{data?.available ? 'Available' : 'Unavailable'}</span></div>
            {!data?.available ? <p className="mt-3 text-sm text-amber-800">{data?.error || 'Waiting for status'}</p> : <>
              <p className="mt-2 text-xs text-slate-500">{data.retention ? `Retention policy: ${JSON.stringify(data.retention)}` : 'Server-recalculated eligibility'}</p>
              <div className="mt-3 space-y-2">
                {(data.collections || []).map(collection => <div key={collection.name} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
                  <div className="font-bold break-all">{collection.name}</div>
                  <div className="mt-1 flex justify-between gap-2 text-xs text-slate-600 dark:text-slate-300"><span>{Number(collection.count || 0).toLocaleString()} eligible</span><span>{formatBytes(collection.estimatedBytes)}</span></div>
                  {collection.activeCount !== undefined && <p className="mt-1 text-xs text-amber-700">{collection.activeCount} active reservations protected</p>}
                  <p className="mt-1 text-xs text-slate-500">{collection.rule}</p>
                </div>)}
              </div>
            </>}
          </article>;
        })}
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={previewCleanup} disabled={loading || executing} className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Dry run / Preview</button>
        <button type="button" onClick={refresh} disabled={loading || executing} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold disabled:opacity-50 dark:border-slate-600">Refresh counts</button>
      </div>

      {preview && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:bg-amber-950/20">
        <h3 className="font-black text-amber-950 dark:text-amber-200">Dry-run results</h3>
        <p className="mt-1 text-sm text-amber-900 dark:text-amber-100">Only records matching the server-side retention and terminal-state rules are eligible. Unavailable services must be resolved before you run cleanup.</p>
        <div className="mt-3 space-y-2">{SERVICES.map(service => <p key={service.key} className="text-sm">{service.label}: <strong>{preview[service.key]?.available ? 'Preview ready' : `Blocked — ${preview[service.key]?.error}`}</strong></p>)}</div>
        <label className="mt-4 block text-sm font-bold text-amber-950 dark:text-amber-100" htmlFor="cleanup-confirmation">Type EXECUTE DATABASE CLEANUP to confirm</label>
        <input id="cleanup-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} className="mt-2 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900" placeholder="EXECUTE DATABASE CLEANUP" />
        <button type="button" onClick={executeCleanup} disabled={executing || confirmation !== 'EXECUTE DATABASE CLEANUP' || SERVICES.some(service => !preview[service.key]?.available)} className="mt-3 rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-40">{executing ? 'Executing…' : 'Execute cleanup'}</button>
      </section>}

      {results && <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="font-black">Execution report</h3>
        {SERVICES.map(service => {
          const result = results[service.key];
          return <div key={service.key} className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-700">
            <p className="font-bold">{service.label}: {result?.available && result.success !== false ? 'Request completed' : 'Failed / partially failed'}</p>
            {result?.executedAt && <p className="text-xs text-slate-500">Executed: {new Date(result.executedAt).toLocaleString()} · Actor: {result.actor || 'Super Admin'}</p>}
            {result?.error && <p className="text-sm text-rose-700">{result.error}</p>}
            {(result?.results || []).map((item, index) => <p key={index} className="text-sm text-slate-600 dark:text-slate-300">{item.collection}: {item.status}, deleted {item.deletedCount || 0}{item.error ? ` — ${item.error}` : ''}</p>)}
          </div>;
        })}
      </section>}

      <p className="text-xs text-slate-500">Protected data: the live medicine master catalogue, import batch summaries/reports, batches awaiting publication, active/undelivered notifications, and all inventory reservations. Atlas may retain allocated disk space after document deletion; a cleanup run does not guarantee an immediate reduction in the cluster's reported storage allocation.</p>
    </section>
  );
}
