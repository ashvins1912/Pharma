import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';

const editableFields = ['sku', 'name', 'price', 'stockQuantity', 'batchNumber', 'expiryDate', 'category', 'manufacturer'];

export default function AdminImportBatchManager({ batchId, headers, onInventoryChanged }) {
  const [rows, setRows] = useState([]);
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
  const base = `/api/v1/inventory/imports/batches/${encodeURIComponent(batchId)}`;

  const load = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    try {
      const response = await apiClient.get(`${base}/rows`, { params: { page, limit: 50, status: status || undefined, q: query || undefined }, headers });
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
  }, [batchId, base, headers, page, status, query]);

  useEffect(() => { void load(); }, [load]);

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
      await apiClient.patch(`${base}/rows/${encodeURIComponent(row.rowId)}`, draft, { headers });
      setEditing(null);
      await load();
    } catch (e) {
      setError(e.response?.data?.message || 'Could not save row changes.');
    } finally { setBusy(false); }
  };
  const bulkAction = async action => {
    if (!selected.length || busy) return;
    if (!window.confirm(`${action === 'publish' ? 'Publish' : 'Unpublish / revert'} ${selected.length} selected row(s)?`)) return;
    setBusy(true);
    try {
      if (action === 'publish') await apiClient.post(`${base}/publish`, { rowIds: selected }, { headers });
      else await apiClient.post(`${base}/unpublish`, { rowIds: selected }, { headers });
      await load();
      if (action === 'publish') onInventoryChanged?.();
    } catch (e) {
      setError(e.response?.data?.message || 'Bulk operation failed. Refresh and review the selected rows.');
    } finally { setBusy(false); }
  };
  const rowAction = async (row, action) => {
    if (busy) return;
    const message = action === 'publish' ? `Publish row ${row.rowNumber}?` : `Unpublish and revert row ${row.rowNumber}?`;
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      if (action === 'publish') await apiClient.post(`${base}/rows/${encodeURIComponent(row.rowId)}/publish`, {}, { headers });
      else await apiClient.post(`${base}/unpublish`, { rowIds: [row.rowId] }, { headers });
      await load();
      if (action === 'publish') onInventoryChanged?.();
      else onInventoryChanged?.();
    } catch (e) {
      setError(e.response?.data?.message || 'The row operation could not be completed.');
    } finally { setBusy(false); }
  };
  const revertBatch = async () => {
    if (!window.confirm('Revert every published row in this batch? Rows changed by another operation will be protected and may block the transaction.')) return;
    setBusy(true);
    try {
      await apiClient.post(`${base}/rollback`, {}, { headers });
      await load();
      onInventoryChanged?.();
    } catch (e) {
      setError(e.response?.data?.message || 'Batch revert failed.');
    } finally { setBusy(false); }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-900">Batch records · review & publish</h3>
          <p className="text-[11px] text-slate-500">{total.toLocaleString()} rows · staged records do not affect live stock until published</p>
        </div>
        <button type="button" onClick={revertBatch} disabled={busy} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">Revert published batch</button>
      </div>
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
        <button type="button" onClick={() => bulkAction('publish')} disabled={!selected.length || busy} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Publish selected</button>
        <button type="button" onClick={() => bulkAction('unpublish')} disabled={!selected.length || busy || !rows.some(r => selected.includes(r.rowId) && r.status === 'PUBLISHED')} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800 disabled:opacity-40">Unpublish / revert selected</button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[980px] text-left text-[11px]">
          <thead className="bg-slate-50 text-slate-500"><tr>
            <th className="p-2">Select</th><th className="p-2">Row</th><th className="p-2">SKU</th><th className="p-2">Medicine</th><th className="p-2">Price</th><th className="p-2">Stock</th><th className="p-2">Batch</th><th className="p-2">Status / errors</th><th className="p-2">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? <tr><td colSpan="9" className="p-5 text-center text-slate-500">Loading batch rows…</td></tr> :
              rows.map(row => <tr key={row.rowId} className="align-top">
                <td className="p-2"><input type="checkbox" checked={selected.includes(row.rowId)} onChange={e => toggleRow(row.rowId, e.target.checked)} /></td>
                <td className="p-2">{row.rowNumber}</td>
                {editing === row.rowId ? <>
                  <td className="p-2"><input value={draft.sku} onChange={e => setDraft(v => ({...v,sku:e.target.value}))} className="w-28 rounded border p-1" /></td>
                  <td className="p-2"><input value={draft.name} onChange={e => setDraft(v => ({...v,name:e.target.value}))} className="w-44 rounded border p-1" /></td>
                  <td className="p-2"><input type="number" min="0" value={draft.price} onChange={e => setDraft(v => ({...v,price:e.target.value}))} className="w-20 rounded border p-1" /></td>
                  <td className="p-2"><input type="number" min="0" step="1" value={draft.stockQuantity} onChange={e => setDraft(v => ({...v,stockQuantity:e.target.value}))} className="w-20 rounded border p-1" /></td>
                  <td className="p-2"><input value={draft.batchNumber} onChange={e => setDraft(v => ({...v,batchNumber:e.target.value}))} className="w-24 rounded border p-1" /></td>
                </> : <>
                  <td className="p-2 font-mono">{row.normalized?.sku}</td>
                  <td className="p-2 font-semibold">{row.normalized?.name}</td>
                  <td className="p-2">₹{row.normalized?.price}</td>
                  <td className="p-2">{row.normalized?.stockQuantity}</td>
                  <td className="p-2">{row.normalized?.batchNumber || '—'}</td>
                </>}
                <td className="p-2"><span className={`rounded px-2 py-1 font-bold ${row.status === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-700' : row.status === 'INVALID' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>{row.status}</span>{row.validationErrors?.length > 0 && <ul className="mt-1 list-disc pl-4 text-rose-700">{row.validationErrors.map((item,i)=><li key={i}>{item}</li>)}</ul>}</td>
                <td className="p-2"><div className="flex flex-wrap gap-1">
                  {editing === row.rowId ? <>
                    <button type="button" onClick={() => saveEdit(row)} disabled={busy} className="rounded bg-blue-600 px-2 py-1 text-white">Save</button>
                    <button type="button" onClick={() => setEditing(null)} className="rounded border px-2 py-1">Cancel</button>
                  </> : <>
                    {row.status !== 'PUBLISHED' && <button type="button" onClick={() => beginEdit(row)} className="rounded border px-2 py-1">Edit</button>}
                    {row.status === 'PUBLISHED' ? <button type="button" onClick={() => rowAction(row,'unpublish')} disabled={busy} className="rounded border border-amber-300 px-2 py-1 text-amber-800">Unpublish</button> : <button type="button" onClick={() => rowAction(row,'publish')} disabled={busy || row.status === 'INVALID'} className="rounded bg-emerald-600 px-2 py-1 text-white disabled:opacity-40">Publish</button>}
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
