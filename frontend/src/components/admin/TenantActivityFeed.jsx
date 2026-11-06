import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useTenant } from '../../context/TenantContext';

const formatLabel = value => String(value || '').replace(/[-_]/g, ' ').toLowerCase().replace(/\b\w/g, char => char.toUpperCase());

export default function TenantActivityFeed() {
  const { tenantId, branchId } = useTenant();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (page = 1) => {
    if (!tenantId) {
      setItems([]);
      setError('Select a pharmacy to view its activity.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/api/v1/activity', {
        params: { tenantId, ...(branchId ? { branchId } : {}), page, limit: 15 }
      });
      const payload = response.data || {};
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setPagination(payload.pagination || { page, totalPages: 0, total: 0 });
    } catch (err) {
      setItems([]);
      setError(err?.response?.data?.message || 'Activity history could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, branchId]);

  useEffect(() => { void load(1); }, [load]);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-slate-900">Live pharmacy activity</h3>
          <p className="mt-1 text-xs text-slate-500">Successful creates, edits, status changes and workflow decisions across this tenant and branch.</p>
        </div>
        <button type="button" onClick={() => void load(pagination.page || 1)} disabled={loading} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh activity'}</button>
      </div>
      {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{error}</p>}
      {!error && !loading && items.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">No recorded changes yet. Successful changes made through the API will appear here.</p>}
      <ol className="space-y-2">
        {items.map(item => (
          <li key={item._id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-100 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-900">{formatLabel(item.action)} · {formatLabel(item.entityType)}</p>
              <p className="mt-1 text-xs text-slate-600">{item.actorName || 'User'} <span className="text-slate-400">({formatLabel(item.actorRole)})</span> · {item.method} · HTTP {item.statusCode}</p>
              {item.entityId && <p className="mt-1 break-all font-mono text-[10px] text-slate-500">Record: {item.entityId}</p>}
              {item.changedFields?.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Fields: {item.changedFields.join(', ')}</p>}
              <p className="mt-1 break-all font-mono text-[10px] text-slate-400">{item.path}</p>
            </div>
            <time className="whitespace-nowrap text-[10px] text-slate-500">{new Date(item.createdAt).toLocaleString()}</time>
          </li>
        ))}
      </ol>
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <button type="button" disabled={loading || pagination.page <= 1} onClick={() => void load(pagination.page - 1)} className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-40">Previous</button>
          <span className="text-xs text-slate-500">Page {pagination.page} of {pagination.totalPages} · {pagination.total} changes</span>
          <button type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => void load(pagination.page + 1)} className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-40">Next</button>
        </div>
      )}
    </section>
  );
}
