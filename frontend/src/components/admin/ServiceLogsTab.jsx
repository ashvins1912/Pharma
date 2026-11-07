import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, index) => index + 1);

const levelStyle = level => level === 'ERROR'
  ? 'bg-rose-100 text-rose-800'
  : 'bg-amber-100 text-amber-800';

export default function ServiceLogsTab() {
  const [hours, setHours] = useState(1);
  const [service, setService] = useState('');
  const [level, setLevel] = useState('');
  const [services, setServices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/api/v1/admin/service-logs', {
        params: { hours, ...(service ? { service } : {}), ...(level ? { level } : {}), limit: 300 }
      });
      const payload = response.data || {};
      setLogs(Array.isArray(payload.data) ? payload.data : []);
      setServices(Array.isArray(payload.services) ? payload.services : []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err?.response?.data?.message || 'Application service logs could not be loaded.');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [hours, service, level]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600">Platform diagnostics</p>
          <h2 className="mt-1 text-xl font-black text-slate-900">Service-level logs</h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">Sanitized Pharma application errors and throttling events. Select a rolling window from 1 to 12 hours. Host-provider logs are not included.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh logs'}</button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs font-bold text-slate-600">Time window
          <select value={hours} onChange={event => setHours(Number(event.target.value))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5">
            {HOUR_OPTIONS.map(value => <option key={value} value={value}>Last {value} {value === 1 ? 'hour' : 'hours'}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-bold text-slate-600">Service
          <select value={service} onChange={event => setService(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5">
            <option value="">All recorded services</option>
            {services.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-bold text-slate-600">Severity
          <select value={level} onChange={event => setLevel(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5">
            <option value="">All severities</option>
            <option value="ERROR">Errors</option>
            <option value="WARN">Warnings</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-y border-slate-100 py-3 text-xs text-slate-500">
        <span><strong className="text-slate-900">{logs.length}</strong> matching events · rolling {hours}h window</span>
        <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Not yet updated'}</span>
      </div>

      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
      {!error && !loading && logs.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-500">No application service errors or throttling events were recorded in this time window.</p>}

      <div className="space-y-2">
        {logs.map((log, index) => (
          <article key={log._id || log.requestId || index} className="rounded-2xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-1 text-[10px] font-black ${levelStyle(log.level)}`}>{log.level}</span>
              <span className="text-xs font-black text-slate-800">{log.service}</span>
              <span className="rounded bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-600">HTTP {log.statusCode}</span>
              <time className="ml-auto text-[10px] text-slate-400">{log.createdAt ? new Date(log.createdAt).toLocaleString() : ''}</time>
            </div>
            <p className="mt-2 break-words text-xs font-semibold text-slate-800">{log.message}</p>
            <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{log.method} {log.path}</p>
            <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-slate-400">
              {log.code && <span>Code: {log.code}</span>}
              {log.requestId && <span>Request: {log.requestId}</span>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
