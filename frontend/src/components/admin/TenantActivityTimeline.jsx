import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';

const label = value => String(value || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, char => char.toUpperCase());

export default function TenantActivityTimeline({ tenantId = '' }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = tenantId ? { tenantId, limit: 40 } : { limit: 40 };
      const response = await apiClient.get('/api/tenant/activity', { params });
      setEvents(Array.isArray(response.data?.events) ? response.data.events : []);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Activity history could not be loaded.');
    } finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-black uppercase tracking-wide text-slate-900">Tenant activity & audit trail</h3><p className="mt-1 text-xs text-slate-500">Persisted domain events with actor, tenant, branch and timestamp.</p></div><button type="button" onClick={load} disabled={loading} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">{loading ? 'Loading…' : 'Refresh'}</button></div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
      {!loading && !error && events.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">No persisted domain events are available for this tenant yet. New supported changes will appear here.</p>}
      <div className="space-y-2">
        {events.map(event => <article key={event._id || event.entityId + event.occurredAt} className="flex gap-3 rounded-xl border border-slate-100 p-3">
          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-500" />
          <div className="min-w-0 flex-1"><p className="text-xs font-bold text-slate-800">{event.summary || label(event.eventType)}</p><p className="mt-1 break-all text-[10px] text-slate-500">Record {event.entityId || '—'} · By {event.actorId || 'system'} · {label(event.actorRole)}{event.branchId ? ` · Branch ${event.branchId}` : ''}</p>
            {event.details && Object.keys(event.details).length > 0 && <p className="mt-1 break-words text-[10px] text-slate-500">{Object.entries(event.details).map(([key, value]) => `${label(key)}: ${Array.isArray(value) ? value.join(', ') : String(value)}`).join(' · ')}</p>}
            <time className="mt-1 block text-[10px] text-slate-400">{event.occurredAt ? new Date(event.occurredAt).toLocaleString() : ''}</time></div>
        </article>)}
      </div>
    </section>
  );
}
