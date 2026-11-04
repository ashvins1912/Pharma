import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';

const editableFields = ['sku', 'name', 'price', 'stockQuantity', 'batchNumber', 'expiryDate', 'category', 'manufacturer', 'baseCostPrice', 'marginTier'];

export default function AdminImportBatchManager({ batchId, headers, onInventoryChanged, publishingEnabled = false }) {
  const [rows, setRows] = useState([]);
  const [activeBatchId, setActiveBatchId] = useState(batchId || '');
  const [batchItems, setBatchItems] = useState([]);
  const [serverPublishingEnabled, setServerPublishingEnabled] = useState(false);
  const [selected, setSelected] = useState([]);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const headersKey = JSON.stringify(headers || {});
  const stableHeaders = useMemo(() => headers || {}, [headersKey]);
  const base = activeBatchId ? `/api/v1/inventory/imports/batches/${encodeURIComponent(activeBatchId)}` : '';
  useEffect(() => { if (batchId) setActiveBatchId(batchId); }, [batchId]);
  const canPublish = publishingEnabled || serverPublishingEnabled;
  const loadBatches = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/v1/inventory/imports/batches', { params: { page: 1, limit: 20 }, headers: stableHeaders });
      setBatchItems(response.data.items || []);
      setServerPublishingEnabled(response.data.publishEnabled === true);
      setError('');
    } catch (e) { setError(e.response?.data?.message || 'Could not load previous import batches.'); }
  }, [stableHeaders]);

  const load = useCallback(async () => {
    if (!activeBatchId) return;
    setLoading(true);
    try {
      const response = await apiClient.get(`${base}/rows`, { params: { page, limit: 50, status: status || undefined, q: query || undefined }, headers: stableHeaders });
      setRows(response.data.items || []);
      setTotal(response.data.total || 0);
      setPages(response.data.pages || 1);
      setSelected([]);
      setError('');
    } catch (e) {
      setError(e.response?.data?.message || 'Could not load staged import rows.');
    } finally {
      setLoading(false);
    }
  }, [activeBatchId, base, stableHeaders, page, status, query]);

  useEffect(() => { if (activeBatchId) void load(); else void loadBatches(); }, [activeBatchId, load, loadBatches]);

  const allVisibleSelected = rows.length > 0 && rows.every(row => selected.includes(row.rowId));
  const toggleAll = checked => setSelected(checked ? rows.map(row => row.rowId) : []);
  const toggleRow = (id, checked) => setSelected(current => checked ? [...new Set([...current, id])] : current.filter(value => value !== id));

  const beginEdit = row => {
    setEditing(row.rowId);
    setDraft(Object.fromEntries(editableFields.map(field => [field, row.normalized?.[field] ?? ''])));
  };
  const saveEdit = async row => {
    setBusy(true);
    try {
      await apiClient.patch(`${base}/rows/${encodeURIComponent(row.rowId)}`, draft, { headers: stableHeaders, timeout: 30000 });
      setEditing(null);
      await load();
    } catch (e) {
      setError(e.response?.data?.message || 'Could not save row changes.');
    } finally { setBusy(false); }
  };
  const bulkAction = async action => {
    if (!selected.length || busy || !canPublish) return;
    const eligibleIds = rows
      .filter(row => selected.includes(row.rowId) && (action === 'publish'
        ? ['READY', 'UNPUBLISHED'].includes(row.status)
        : row.status === 'PUBLISHED'))
      .map(row => row.rowId);
    if (!eligibleIds.length) return;
    if (!window.confirm(`${action === 'publish' ? 'Publish' : 'Unpublish / revert'} ${eligibleIds.length} selected row(s)?`)) return;
    setBusy(true);
    try {
      if (action === 'publish') await apiClient.post(`${base}/publish`, { rowIds: eligibleIds }, { headers: stableHeaders, timeout: 60000 });
      else await apiClient.post(`${base}/unpublish`, { rowIds: eligibleIds }, { headers: stableHeaders });
      await load();
      onInventoryChanged?.();
    } catch (e) {
      setError(e.response?.data?.message || 'Bulk operation failed. Refresh and review the selected rows.');
    } finally { setBusy(false); }
  };
  const rowAction = async (row, action) => {
    if (busy || !canPublish) return;
    const message = action === 'publish' ? `Publish row ${row.rowNumber}?` : `Unpublish and revert row ${row.rowNumber}?`;
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      if (action === 'publish') await apiClient.post(`${base}/rows/${encodeURIComponent(row.rowId)}/publish`, {}, { headers: stableHeaders });
      else await apiClient.post(`${base}/unpublish`, { rowIds: [row.rowId] }, { headers: stableHeaders, timeout: 60000 });
      await load();
      if (action === 'publish') onInventoryChanged?.();
      else onInventoryChanged?.();
    } catch (e) {
      setError(e.response?.data?.message || 'The row operation could not be completed.');
    } finally { setBusy(false); }
  };
  const revertBatch = async () => {
    if (!canPublish) return;
    if (!window.confirm('Revert every published row in this batch? Rows changed by another operation will be protected and may block the transaction.')) return;
    setBusy(true);
    try {
      await apiClient.post(`${base}/rollback`, {}, { headers: stableHeaders, timeout: 110000 });
      await load();
      onInventoryChanged?.();
    } catch (e) {
      setError(e.response?.data?.message || 'Batch revert failed.');
    } finally { setBusy(false); }
  };

  if (!activeBatchId) return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 space-y-3">
      <div><h3 className="text-sm font-black text-slate-900">Previous inventory upload batches</h3><p className="text-[11px] text-slate-500">Open a batch to review, edit, publish or revert its individual records.</p></div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
      {!batchItems.length ? <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">No saved import batches for this branch yet.</p> : <div className="divide-y rounded-xl border border-slate-200">{batchItems.map(item => <div key={item.batchId} className="flex flex-wrap items-center justify-between gap-2 p-3"><div className="min-w-0"><p className="break-all text-xs font-bold text-slate-800">{item.fileName || item.batchId}</p><p className="text-[10px] text-slate-500">{item.batchId} · {item.totalRows} rows · {item.publishedRows || 0} published · {item.invalidRows || 0} invalid</p><span className="text-[10px] font-bold text-blue-700">{item.status}</span></div><button type="button" onClick={() => { setActiveBatchId(item.batchId); setPage(1); setStatus(''); setQuery(''); }} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">Open batch</button></div>)}</div>}
      <button type="button" onClick={loadBatches} className="rounded-lg border px-3 py-2 text-xs font-bold">Refresh batches</button>
    </section>
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button type="button" onClick={() => { setActiveBatchId(''); setSelected([]); setEditing(null); }} className="mb-1 text-[11px] font-bold text-blue-700">← All batches</button>
          <h3 className="text-sm font-black text-slate-900">Batch records · review & publish</h3>
          <p className="text-[11px] text-slate-500">{total.toLocaleString()} rows · staged records do not affect live stock until published</p>
        </div>
        <button type="button" onClick={revertBatch} disabled={busy || !canPublish} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">Revert published batch</button>
      </div>
      {!canPublish && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Publishing, unpublishing and reverting are disabled by the Inventory Service. Enable INVENTORY_IMPORTS_ENABLED only in the isolated test environment to exercise live test-stock changes.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-2">
        <input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Search SKU or medicine" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs" />
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
          <option value="">All statuses</option>
          {['READY','INVALID','PUBLISHED','UNPUBLISHED','REVERTED'].map(value => <option key={value}>{value}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={allVisibleSelected} onChange={e => toggleAll(e.target.checked)} /> Select page</label>
        <span className="text-[11px] text-slate-500">{selected.length} selected</span>
        <button type="button" onClick={() => bulkAction('publish')} disabled={!selected.length || busy || !canPublish} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Publish selected</button>
        <button type="button" onClick={() => bulkAction('unpublish')} disabled={!selected.length || busy || !canPublish || !rows.some(r => selected.includes(r.rowId) && r.status === 'PUBLISHED')} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800 disabled:opacity-40">Unpublish / revert selected</button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[1080px] text-left text-[11px]">
          <thead className="bg-slate-50 text-slate-500"><tr>
            <th className="p-2">Select</th><th className="p-2">Row</th><th className="p-2">SKU</th><th className="p-2">Medicine</th><th className="p-2">Price</th><th className="p-2">Stock</th><th className="p-2">Batch / expiry</th><th className="p-2">Category / manufacturer</th><th className="p-2">Status / errors</th><th className="p-2">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? <tr><td colSpan="10" className="p-5 text-center text-slate-500">Loading batch rows…</td></tr> :
              rows.map(row => <tr key={row.rowId} className="align-top">
                <td className="p-2"><input type="checkbox" checked={selected.includes(row.rowId)} onChange={e => toggleRow(row.rowId, e.target.checked)} /></td>
                <td className="p-2">{row.rowNumber}</td>
                {editing === row.rowId ? <>
                  <td className="p-2"><input value={draft.sku} onChange={e => setDraft(v => ({...v,sku:e.target.value}))} className="w-28 rounded border p-1" /></td>
                  <td className="p-2"><input value={draft.name} onChange={e => setDraft(v => ({...v,name:e.target.value}))} className="w-44 rounded border p-1" /></td>
                  <td className="p-2"><input type="number" min="0" value={draft.price} onChange={e => setDraft(v => ({...v,price:e.target.value}))} className="w-20 rounded border p-1" /></td>
                  <td className="p-2"><input type="number" min="0" step="1" value={draft.stockQuantity} onChange={e => setDraft(v => ({...v,stockQuantity:e.target.value}))} className="w-20 rounded border p-1" /></td>
                  <td className="p-2 space-y-1"><input value={draft.batchNumber} onChange={e => setDraft(v => ({...v,batchNumber:e.target.value}))} className="w-24 rounded border p-1" /><input type="date" value={draft.expiryDate && Number.isFinite(new Date(draft.expiryDate).getTime()) ? new Date(draft.expiryDate).toISOString().slice(0,10) : ''} onChange={e => setDraft(v => ({...v,expiryDate:e.target.value}))} className="w-28 rounded border p-1" /></td><td className="p-2 space-y-1"><input value={draft.category} onChange={e => setDraft(v => ({...v,category:e.target.value}))} className="w-28 rounded border p-1" placeholder="Category" /><input value={draft.manufacturer} onChange={e => setDraft(v => ({...v,manufacturer:e.target.value}))} className="w-28 rounded border p-1" placeholder="Manufacturer" /><input type="number" min="0" value={draft.baseCostPrice ?? ''} onChange={e => setDraft(v => ({...v,baseCostPrice:e.target.value}))} className="w-28 rounded border p-1" placeholder="Base cost" /><select value={draft.marginTier || 'LOW'} onChange={e => setDraft(v => ({...v,marginTier:e.target.value}))} className="w-28 rounded border p-1"><option value="LOW">LOW margin</option><option value="MID">MID margin</option><option value="HIGH">HIGH margin</option></select></td>
                </> : <>
                  <td className="p-2 font-mono">{row.normalized?.sku}</td>
                  <td className="p-2 font-semibold">{row.normalized?.name}</td>
                  <td className="p-2">₹{row.normalized?.price}</td>
                  <td className="p-2">{row.normalized?.stockQuantity}</td>
                  <td className="p-2">{row.normalized?.batchNumber || '—'}<div className="text-[10px] text-slate-500">{row.normalized?.expiryDate && Number.isFinite(new Date(row.normalized.expiryDate).getTime()) ? new Date(row.normalized.expiryDate).toLocaleDateString() : 'No expiry'}</div></td><td className="p-2">{row.normalized?.category || '—'}<div className="text-[10px] text-slate-500">{row.normalized?.manufacturer || '—'}</div><div className="text-[10px] text-slate-500">Cost: {row.normalized?.baseCostPrice ?? '—'} · {row.normalized?.marginTier || 'LOW'}</div></td>
                </>}
                <td className="p-2"><span className={`rounded px-2 py-1 font-bold ${row.status === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-700' : row.status === 'INVALID' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>{row.status}</span>{row.validationErrors?.length > 0 && <ul className="mt-1 list-disc pl-4 text-rose-700">{row.validationErrors.map((item,i)=><li key={i}>{item}</li>)}</ul>}</td>
                <td className="p-2"><div className="flex flex-wrap gap-1">
                  {editing === row.rowId ? <>
                    <button type="button" onClick={() => saveEdit(row)} disabled={busy} className="rounded bg-blue-600 px-2 py-1 text-white">Save</button>
                    <button type="button" onClick={() => setEditing(null)} className="rounded border px-2 py-1">Cancel</button>
                  </> : <>
                    {row.status !== 'PUBLISHED' && <button type="button" onClick={() => beginEdit(row)} className="rounded border px-2 py-1">Edit</button>}
                    {row.status === 'PUBLISHED' ? <button type="button" onClick={() => rowAction(row,'unpublish')} disabled={busy || !canPublish} className="rounded border border-amber-300 px-2 py-1 text-amber-800">Unpublish</button> : <button type="button" onClick={() => rowAction(row,'publish')} disabled={busy || !canPublish || row.status === 'INVALID'} className="rounded bg-emerald-600 px-2 py-1 text-white disabled:opacity-40">Publish</button>}
                  </>}
                </div></td>
              </tr>)}
            {!loading && !rows.length && <tr><td colSpan="9" className="p-5 text-center text-slate-500">No rows match this filter.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">Page {page} of {pages}</span>
        <div className="flex gap-2">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(v => v - 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">Previous</button>
          <button type="button" disabled={page >= pages || loading} onClick={() => setPage(v => v + 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      </div>
    </section>
  );
}
