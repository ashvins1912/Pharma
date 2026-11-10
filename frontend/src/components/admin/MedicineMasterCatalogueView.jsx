import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';

const ARRAY_FIELDS = ['uses', 'sideEffects', 'indications', 'contraindications', 'drugInteractions'];
const TEXT_FIELDS = ['brandName', 'genericName', 'manufacturer', 'composition', 'strength', 'packSize', 'dosageForm', 'medicineType', 'therapeuticClass', 'chemicalClass', 'actionClass'];
const LABELS = { brandName: 'Brand name', genericName: 'Generic name', manufacturer: 'Manufacturer', composition: 'Composition', strength: 'Strength', packSize: 'Pack size', dosageForm: 'Dosage form', medicineType: 'Medicine type', therapeuticClass: 'Therapeutic class', chemicalClass: 'Chemical class', actionClass: 'Action class', uses: 'Uses', sideEffects: 'Side effects', indications: 'Indications', contraindications: 'Contraindications', drugInteractions: 'Drug interactions' };
const emptyForm = () => Object.fromEntries([...TEXT_FIELDS, ...ARRAY_FIELDS].map(field => [field, '']));

export default function MedicineMasterCatalogueView({ onOpenImport }) {
  const { addToast } = useToast();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], pagination: { total: 0, totalPages: 0 } });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [audit, setAudit] = useState([]);
  const [imports, setImports] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedBatchIds, setSelectedBatchIds] = useState([]);
  const [mergeBusy, setMergeBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/api/v1/inventory/catalogue/medicines', { params: { search: query, page, limit: 20 } });
      setData(response.data || { items: [], pagination: { total: 0, totalPages: 0 } });
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not load the shared medicine catalogue.', 'error');
    } finally { setLoading(false); }
  }, [query, page, addToast]);

  const loadImportHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await apiClient.get('/api/v1/inventory/catalogue/imports', { params: { page: 1, limit: 8 } });
      setImports(response.data?.items || []);
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not load catalogue import history.', 'warning');
    } finally { setHistoryLoading(false); }
  }, [addToast]);
  const mergeSelectedBatches = async () => {
    if (selectedBatchIds.length < 2) return;
    setMergeBusy(true);
    try {
      const response = await apiClient.post('/api/v1/inventory/catalogue/imports/merge', { batchIds: selectedBatchIds });
      setSelectedBatchIds([]);
      await loadImportHistory();
      addToast(`Combined ${Number(response.data?.report?.sourceRecords || 0).toLocaleString()} source rows into ${Number(response.data?.report?.normalizedRecords || 0).toLocaleString()} reconciled records. Review the merged batch before approval.`, 'success');
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not combine the selected staged batches.', 'error');
      await loadImportHistory();
    } finally { setMergeBusy(false); }
  };

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadImportHistory(); }, [loadImportHistory]);

  const openRecord = async item => {
    setSelected(item);
    setEditing(false);
    setForm(Object.fromEntries([...TEXT_FIELDS, ...ARRAY_FIELDS].map(field => [field, ARRAY_FIELDS.includes(field) ? (item[field] || []).join('\n') : (item[field] || '')])));
    setAudit([]);
    try {
      const [detail, history] = await Promise.all([
        apiClient.get(`/api/v1/inventory/catalogue/medicines/${encodeURIComponent(item.medicineId)}`),
        apiClient.get(`/api/v1/inventory/catalogue/medicines/${encodeURIComponent(item.medicineId)}/audit`)
      ]);
      const medicine = detail.data?.medicine || item;
      setSelected(medicine);
      setForm(Object.fromEntries([...TEXT_FIELDS, ...ARRAY_FIELDS].map(field => [field, ARRAY_FIELDS.includes(field) ? (medicine[field] || []).join('\n') : (medicine[field] || '')])));
      setAudit(history.data?.items || []);
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not load medicine details or audit history.', 'warning');
    }
  };

  const save = async () => {
    if (!selected) return;
    const payload = {};
    for (const field of TEXT_FIELDS) if (form[field].trim()) payload[field] = form[field].trim();
    for (const field of ARRAY_FIELDS) payload[field] = form[field].split('\n').map(value => value.trim()).filter(Boolean);
    setSaving(true);
    try {
      const response = await apiClient.patch(`/api/v1/inventory/catalogue/medicines/${encodeURIComponent(selected.medicineId)}`, payload);
      setSelected(response.data.medicine);
      setEditing(false);
      const history = await apiClient.get(`/api/v1/inventory/catalogue/medicines/${encodeURIComponent(selected.medicineId)}/audit`);
      setAudit(history.data?.items || []);
      await load();
      addToast('Shared medicine master record updated. Change history recorded.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || 'Medicine master update failed.', 'error');
    } finally { setSaving(false); }
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-black text-slate-900">Medicine Master Catalogue</h2><p className="mt-1 text-xs text-slate-500">Browse published shared records, inspect provenance and make audited platform-level updates.</p></div>
        <button type="button" onClick={onOpenImport} className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-violet-700">🧬 Enrich catalogue</button>
      </header>
      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row">
        <input value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { setPage(1); setQuery(search.trim()); } }} placeholder="Search brand, generic, composition or manufacturer" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
        <button type="button" onClick={() => { setPage(1); setQuery(search.trim()); }} className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white">Search</button>
        <button type="button" onClick={() => { setSearch(''); setQuery(''); setPage(1); }} className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700">Clear</button>
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"><div><strong className="text-xs text-slate-800">Recent enrichment batches</strong><p className="mt-1 text-[10px] text-slate-500">Select 2–10 unapproved READY batches to combine into one reviewable publish batch</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={mergeSelectedBatches} disabled={mergeBusy || selectedBatchIds.length < 2} className="rounded-lg bg-violet-600 px-3 py-2 text-[11px] font-extrabold text-white disabled:opacity-40">{mergeBusy ? 'Merging…' : `Merge selected (${selectedBatchIds.length})`}</button><button type="button" onClick={loadImportHistory} disabled={historyLoading} className="rounded-lg border px-3 py-2 text-[11px] font-bold disabled:opacity-50">{historyLoading ? "Refreshing…" : "Refresh history"}</button></div>
        {imports.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Select</th><th className="p-3">Uploaded file</th><th className="p-3">Dataset</th><th className="p-3">Status</th><th className="p-3">Records</th><th className="p-3">Published</th><th className="p-3">Approval</th><th className="p-3">Uploaded</th></tr></thead><tbody className="divide-y divide-slate-100">{imports.map(batch => <tr key={batch.batchId}><td className="p-3"><input type="checkbox" aria-label={`Select batch ${batch.batchId} for merge`} checked={selectedBatchIds.includes(batch.batchId)} disabled={batch.status !== 'READY' || Boolean(batch.approvedAt) || mergeBusy} onChange={event => setSelectedBatchIds(current => event.target.checked ? [...current, batch.batchId].slice(-10) : current.filter(id => id !== batch.batchId))} /></td><td className="p-3"><strong className="block text-slate-800">{batch.fileName}</strong><span className="font-mono text-[10px] text-slate-400">{batch.batchId}</span></td><td className="p-3 text-slate-600">{batch.dataset}</td><td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold">{batch.status}</span></td><td className="p-3 tabular-nums">{Number(batch.recordCount || batch.report?.normalizedRecords || 0).toLocaleString()}</td><td className="p-3 tabular-nums">{Number(batch.publishedCount || 0).toLocaleString()}</td><td className="p-3">{batch.approvedAt ? <span className="font-bold text-emerald-700">Approved</span> : <span className="text-amber-700">Pending</span>}</td><td className="p-3 text-slate-500">{batch.createdAt ? new Date(batch.createdAt).toLocaleString() : "—"}</td></tr>)}</tbody></table></div> : <p className="p-5 text-xs text-slate-500">{historyLoading ? "Loading batch history…" : "No enrichment batches have been uploaded yet."}</p>}
      </section>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><strong className="text-xs text-slate-800">Published medicines</strong><span className="text-[11px] text-slate-500">{Number(data.pagination?.total || 0).toLocaleString()} records</span></div>
        {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading catalogue…</p> : data.items?.length ? (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Medicine</th><th className="p-3">Composition</th><th className="p-3">Strength / form</th><th className="p-3">Manufacturer</th><th className="p-3">Quality</th><th className="p-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{data.items.map(item => <tr key={item.medicineId} className="hover:bg-slate-50"><td className="p-3"><strong className="block text-slate-900">{item.brandName}</strong><span className="font-mono text-[10px] text-slate-500">{item.medicineId}</span></td><td className="p-3 text-slate-600">{item.composition || 'Not supplied'}</td><td className="p-3 text-slate-600">{[item.strength, item.dosageForm].filter(Boolean).join(' · ') || '—'}</td><td className="p-3 text-slate-600">{item.manufacturer || 'Not supplied'}</td><td className="p-3"><span className="font-bold">{item.qualityScore ?? 0}%</span><span className="ml-1 text-slate-500">{item.qualityGrade || item.dataQualityStatus || '—'}</span></td><td className="p-3"><button type="button" onClick={() => openRecord(item)} className="rounded-lg border border-blue-200 px-3 py-2 font-bold text-blue-700 hover:bg-blue-50">View / Edit</button></td></tr>)}</tbody></table></div>
        ) : <p className="p-8 text-center text-sm text-slate-500">No published medicine records found.</p>}
        <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-3"><span className="text-[11px] text-slate-500">Page {data.pagination?.page || page} of {Math.max(1, data.pagination?.totalPages || 1)}</span><div className="flex gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Previous</button><button type="button" disabled={page >= (data.pagination?.totalPages || 1) || loading} onClick={() => setPage(value => value + 1)} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Next</button></div></footer>
      </div>
      {selected && <div className="fixed inset-0 z-[130] overflow-y-auto bg-slate-950/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="medicine-master-detail-title"><section className="mx-auto my-4 w-full max-w-4xl rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between border-b p-4 sm:p-5"><div><h3 id="medicine-master-detail-title" className="font-black text-slate-900">{editing ? 'Edit medicine master record' : selected.brandName}</h3><p className="mt-1 font-mono text-[10px] text-slate-500">{selected.medicineId}</p></div><button type="button" onClick={() => setSelected(null)} className="rounded-lg bg-slate-100 px-3 py-2 text-sm">✕</button></header>
        <div className="space-y-4 p-4 sm:p-5">{!editing ? <><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[...TEXT_FIELDS, ...ARRAY_FIELDS].map(field => <div key={field} className="rounded-xl border border-slate-100 p-3"><p className="text-[10px] font-bold uppercase text-slate-500">{LABELS[field]}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{Array.isArray(selected[field]) ? selected[field].join(', ') : selected[field] || 'Not supplied'}</p></div>)}</div><div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Clinical data, suggested alternatives and regulatory status remain source-dependent. Editing does not verify clinical claims. Tenant pricing, stock, batches and expiry are not editable here.</div></> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[...TEXT_FIELDS, ...ARRAY_FIELDS].map(field => <label key={field} className="text-xs font-bold text-slate-700">{LABELS[field]}{ARRAY_FIELDS.includes(field) ? <textarea rows={3} value={form[field]} onChange={event => setForm(value => ({ ...value, [field]: event.target.value }))} placeholder="One value per line" className="mt-1 block w-full rounded-xl border border-slate-300 p-2.5 font-normal" /> : <input value={form[field]} onChange={event => setForm(value => ({ ...value, [field]: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-300 p-2.5 font-normal" />}</label>)}</div>}
        <div className="border-t pt-4"><h4 className="text-xs font-black text-slate-800">Update history</h4>{audit.length ? <div className="mt-2 space-y-2">{audit.map(entry => <div key={entry._id} className="rounded-xl bg-slate-50 p-3 text-[11px]"><div className="flex flex-wrap justify-between gap-2"><strong>{entry.changedFields?.join(', ')}</strong><span className="text-slate-500">{new Date(entry.createdAt).toLocaleString()}</span></div><p className="mt-1 text-slate-500">Updated by {entry.actorId || 'Platform administrator'}</p></div>)}</div> : <p className="mt-2 text-xs text-slate-500">No manual updates recorded.</p>}</div></div>
        <footer className="flex flex-col-reverse justify-between gap-2 rounded-b-2xl border-t bg-slate-50 p-4 sm:flex-row">{editing ? <><button type="button" onClick={() => setEditing(false)} disabled={saving} className="rounded-xl border px-4 py-2.5 text-xs font-bold">Cancel</button><button type="button" onClick={save} disabled={saving} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-extrabold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save audited changes'}</button></> : <><button type="button" onClick={() => setSelected(null)} className="rounded-xl border px-4 py-2.5 text-xs font-bold">Close</button><button type="button" onClick={() => setEditing(true)} className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-extrabold text-white">Edit medicine</button></>}</footer>
      </section></div>}
    </section>
  );
}
