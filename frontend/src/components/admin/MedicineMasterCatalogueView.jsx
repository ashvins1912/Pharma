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
  const [removeBatchesBusy, setRemoveBatchesBusy] = useState(false);
  const [reviewBatch, setReviewBatch] = useState(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [reviewRecords, setReviewRecords] = useState({ items: [], pagination: { page: 1, total: 0, totalPages: 0 } });
  const [reviewRecordsPage, setReviewRecordsPage] = useState(1);
  const [reviewRecordsSearch, setReviewRecordsSearch] = useState('');
  const [reviewRecordsLoading, setReviewRecordsLoading] = useState(false);
  const [batchActionBusy, setBatchActionBusy] = useState(false);

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
      const jobs = (response.data?.jobs || []).map(job => ({ ...job, isImportJob: true, batchId: job.batchId || job.jobId, recordCount: job.totalRecords || job.processedRecords || 0 }));
      setImports([...jobs, ...(response.data?.items || [])].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 12));
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not load catalogue import history.', 'warning');
    } finally { setHistoryLoading(false); }
  }, [addToast]);
  const retryImportJob = async jobId => {
    try {
      await apiClient.post(`/api/v1/inventory/catalogue/imports/jobs/${encodeURIComponent(jobId)}/retry`, {});
      await loadImportHistory();
      addToast('Failed import queued for retry. Refresh history to follow its progress.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not retry this import job.', 'error');
    }
  };
  const restartStuckImportJob = async jobId => {
    if (!jobId || batchActionBusy) return;
    const confirmed = window.confirm('Restart this stalled import from its retained source upload? Any incomplete processing progress will be reset and the file will be processed again.');
    if (!confirmed) return;
    setBatchActionBusy(true);
    try {
      await apiClient.post(`/api/v1/inventory/catalogue/imports/jobs/${encodeURIComponent(jobId)}/restart`, {});
      await loadImportHistory();
      addToast('Stuck import re-queued. Refresh history to follow its progress.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not restart this import. Refresh history to check its worker lease.', 'error');
      await loadImportHistory();
    } finally { setBatchActionBusy(false); }
  };
  const openBatchReview = async batchId => {
    setBatchActionBusy(true);
    try {
      const response = await apiClient.get(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(batchId)}`, { timeout: 30000 });
      setReviewBatch(response.data);
      setReviewConfirmed(false);
      setReviewRecordsPage(1);
      setReviewRecordsSearch('');
      await loadBatchRecords(batchId, 1, '');
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not load the staged batch report.', 'error');
    } finally { setBatchActionBusy(false); }
  };
  const loadBatchRecords = async (batchId, nextPage = reviewRecordsPage, searchValue = reviewRecordsSearch) => {
    if (!batchId) return;
    setReviewRecordsLoading(true);
    try {
      const normalizedSearch = String(searchValue || '').trim();
      const response = await apiClient.get(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(batchId)}/records`, {
        params: { page: nextPage, limit: 20, ...(normalizedSearch ? { search: normalizedSearch } : {}) },
        // Staged imports can contain large reconciliation datasets; do not let
        // the shared 10s API default abort this paginated review request.
        timeout: 45000
      });
      setReviewRecords(response.data || { items: [], pagination: { page: nextPage, total: 0, totalPages: 0 } });
      setReviewRecordsPage(nextPage);
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not load staged medicine records.', 'error');
    } finally { setReviewRecordsLoading(false); }
  };

  const refreshReviewedBatch = async () => {
    if (!reviewBatch?.batchId) return;
    const response = await apiClient.get(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(reviewBatch.batchId)}`);
    setReviewBatch(response.data);
    await loadImportHistory();
  };
  const approveReviewedBatch = async () => {
    if (!reviewBatch?.batchId || !reviewConfirmed || !reviewBatch.reportFingerprint) return;
    setBatchActionBusy(true);
    try {
      await apiClient.post(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(reviewBatch.batchId)}/approve`, { confirmReconciliation: true, reportFingerprint: reviewBatch.reportFingerprint });
      await refreshReviewedBatch();
      addToast('Combined reconciliation report approved.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not approve the combined batch.', 'error');
    } finally { setBatchActionBusy(false); }
  };
  const publishReviewedBatch = async () => {
    if (!reviewBatch?.batchId || !reviewBatch?.approvedAt) return;
    if (!window.confirm('Publish this approved combined batch to the shared medicine master catalogue?')) return;
    setBatchActionBusy(true);
    try {
      await apiClient.post(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(reviewBatch.batchId)}/publish`, {});
      await refreshReviewedBatch();
      addToast('Combined medicine batch published.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not publish the combined batch.', 'error');
    } finally { setBatchActionBusy(false); }
  };

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

  const removeSelectedBatches = async () => {
    if (!selectedBatchIds.length || removeBatchesBusy || mergeBusy) return;
    const confirmed = window.confirm(`PERMANENTLY DELETE ${selectedBatchIds.length} selected enrichment batch(es)? This irreversibly deletes their staged records, import-job metadata and retained source uploads. This cannot be undone. Approved, merged, superseded and published batches are protected.`);
    if (!confirmed) return;
    setRemoveBatchesBusy(true);
    try {
      const response = await apiClient.post('/api/v1/inventory/catalogue/imports/remove-selected', { batchIds: selectedBatchIds });
      setSelectedBatchIds([]);
      await loadImportHistory();
      addToast(response.data?.message || `Removed ${Number(response.data?.removedCount || 0)} enrichment batch(es) from the recent list.`, 'success');
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not permanently delete the selected enrichment batches.', 'error');
      await loadImportHistory();
    } finally { setRemoveBatchesBusy(false); }
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


  const deleteRecord = async item => {
    if (!item?.medicineId || saving) return;
    const confirmed = window.confirm(`Delete "${item.brandName || item.medicineId}" from the active shared Medicine Master Catalogue? This hides it from catalogue searches but preserves its source provenance and audit history.`);
    if (!confirmed) return;
    setSaving(true);
    try {
      await apiClient.delete(`/api/v1/inventory/catalogue/medicines/${encodeURIComponent(item.medicineId)}`);
      if (selected?.medicineId === item.medicineId) setSelected(null);
      await load();
      addToast('Medicine master record deleted from the active catalogue. Audit and provenance retained.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not delete the medicine master record.', 'error');
    } finally { setSaving(false); }
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
      <header className="relative overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-900 p-5 text-white shadow-lg sm:p-7"><div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div className="max-w-2xl"><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[.16em] text-indigo-100"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400"/> Platform data workspace</div><h2 className="text-xl font-black tracking-tight sm:text-2xl">Medicine Master Catalogue</h2><p className="mt-2 max-w-xl text-xs leading-5 text-indigo-100/80 sm:text-sm">Manage trusted shared medicine records, review incoming datasets and track platform-level changes in one workspace.</p></div><button type="button" onClick={onOpenImport} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-xs font-black text-indigo-950 shadow-lg hover:bg-indigo-50">＋ Enrich catalogue</button></div><div className="relative mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3"><div className="rounded-xl border border-white/10 bg-white/10 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-100/70">Published records</p><p className="mt-1 text-xl font-black tabular-nums">{Number(data.pagination?.total || 0).toLocaleString()}</p></div><div className="rounded-xl border border-white/10 bg-white/10 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-100/70">Recent batches</p><p className="mt-1 text-xl font-black tabular-nums">{imports.length}</p></div><div className="col-span-2 rounded-xl border border-white/10 bg-white/10 p-3 sm:col-span-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-100/70">Catalogue scope</p><p className="mt-1 text-sm font-bold">Shared platform records</p></div></div></header>
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4"><label className="mb-2 block text-[10px] font-black uppercase tracking-[.14em] text-slate-500">Find a medicine</label><div className="flex flex-col gap-2 sm:flex-row"><div className="relative min-w-0 flex-1"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">⌕</span><input aria-label="Search medicine catalogue" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { setPage(1); setQuery(search.trim()); } }} placeholder="Brand, generic, composition or manufacturer…" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100" /></div><div className="flex gap-2"><button type="button" onClick={() => { setPage(1); setQuery(search.trim()); }} className="min-h-11 flex-1 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-indigo-700 sm:flex-none">Search catalogue</button><button type="button" onClick={() => { setSearch(''); setQuery(''); setPage(1); }} className="min-h-11 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Reset</button></div></div></div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"><div><strong className="text-xs text-slate-800">Recent enrichment batches</strong><p className="mt-1 text-[10px] text-slate-500">Select standalone, unapproved READY batches to merge or permanently delete</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={mergeSelectedBatches} disabled={mergeBusy || removeBatchesBusy || selectedBatchIds.length < 2 || selectedBatchIds.length > 10} className="rounded-lg bg-violet-600 px-3 py-2 text-[11px] font-extrabold text-white disabled:opacity-40">{mergeBusy ? 'Merging…' : `Merge selected (${selectedBatchIds.length})`}</button><button type="button" onClick={removeSelectedBatches} disabled={removeBatchesBusy || mergeBusy || selectedBatchIds.length < 1} className="rounded-lg border border-rose-200 px-3 py-2 text-[11px] font-extrabold text-rose-700 disabled:opacity-40">{removeBatchesBusy ? 'Deleting…' : `Delete selected (${selectedBatchIds.length})`}</button><button type="button" onClick={loadImportHistory} disabled={historyLoading || removeBatchesBusy} className="rounded-lg border px-3 py-2 text-[11px] font-bold disabled:opacity-50">{historyLoading ? "Refreshing…" : "Refresh history"}</button></div></div>
        {imports.length ? <>
          <div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Select</th><th className="p-3">Uploaded file</th><th className="p-3">Dataset</th><th className="p-3">Status</th><th className="p-3">Records</th><th className="p-3">Published</th><th className="p-3">Approval</th><th className="p-3">Uploaded</th><th className="p-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{imports.map(batch => <tr key={batch.jobId || batch.batchId}><td className="p-3"><input type="checkbox" aria-label={`Select batch ${batch.batchId} for merge or removal`} checked={selectedBatchIds.includes(batch.batchId)} disabled={batch.isImportJob || batch.status !== 'READY' || Boolean(batch.approvedAt) || Boolean(batch.supersededByBatchId) || Boolean(batch.sourceBatchIds?.length) || mergeBusy || removeBatchesBusy} onChange={event => setSelectedBatchIds(current => event.target.checked ? [...current, batch.batchId].slice(-10) : current.filter(id => id !== batch.batchId))} /></td><td className="p-3"><strong className="block text-slate-800">{batch.fileName}</strong><span className="font-mono text-[10px] text-slate-400">{batch.isImportJob ? `Job ${batch.jobId}` : batch.batchId}</span></td><td className="p-3 text-slate-600">{batch.dataset || 'Detecting…'}</td><td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold">{batch.status}</span>{batch.isImportJob && batch.status === 'PROCESSING' && <div className="mt-1 min-w-20"><div className="h-1.5 overflow-hidden rounded-full bg-blue-100"><div className="h-full bg-blue-600" style={{width:`${Math.max(0,Math.min(100,Number(batch.progressPercent||0)))}%`}} /></div><span className="text-[9px] text-slate-500">{batch.progressPercent || 0}% · {batch.stage}</span></div>}{batch.isImportJob && batch.status === 'FAILED' && <p className="mt-1 max-w-40 text-[9px] text-rose-700">{batch.errorMessage}</p>}</td><td className="p-3 tabular-nums">{batch.isImportJob ? `${Number(batch.processedRecords||0).toLocaleString()} / ${Number(batch.totalRecords||0).toLocaleString()}` : Number(batch.recordCount || batch.report?.normalizedRecords || 0).toLocaleString()}</td><td className="p-3 tabular-nums">{Number(batch.publishedCount || 0).toLocaleString()}</td><td className="p-3">{batch.isImportJob ? '—' : batch.approvedAt ? <span className="font-bold text-emerald-700">Approved</span> : <span className="text-amber-700">Pending</span>}</td><td className="p-3 text-slate-500">{batch.createdAt ? new Date(batch.createdAt).toLocaleString() : "—"}</td><td className="p-3">{batch.isImportJob && batch.status === 'FAILED' ? <button type="button" onClick={() => retryImportJob(batch.jobId)} disabled={batchActionBusy} className="rounded-lg border border-amber-200 px-2.5 py-1.5 text-[10px] font-bold text-amber-800 disabled:opacity-50">Retry</button> : batch.isImportJob && batch.status === 'PROCESSING' && (batch.leaseExpiresAt ? new Date(batch.leaseExpiresAt).getTime() <= Date.now() : Date.now() - new Date(batch.updatedAt || batch.createdAt || 0).getTime() >= 15 * 60 * 1000) ? <button type="button" onClick={() => restartStuckImportJob(batch.jobId)} disabled={batchActionBusy} title="Worker lease expired; safely requeue the retained upload" className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-[10px] font-bold text-rose-700 disabled:opacity-50">{batchActionBusy ? 'Restarting…' : 'Restart'}</button> : !batch.isImportJob && ['READY','PUBLISHED','PARTIALLY_PUBLISHED','FAILED'].includes(batch.status) && <button type="button" onClick={() => openBatchReview(batch.batchId)} disabled={batchActionBusy} className="rounded-lg border border-blue-200 px-2.5 py-1.5 text-[10px] font-bold text-blue-700 disabled:opacity-50">Review</button>}</td></tr>)}</tbody></table></div>
          <div className="grid gap-3 p-3 sm:hidden">{imports.map(batch => {
            const selectable = !batch.isImportJob && batch.status === 'READY' && !batch.approvedAt && !batch.supersededByBatchId && !batch.sourceBatchIds?.length && !mergeBusy && !removeBatchesBusy;
            const canReview = !batch.isImportJob && ['READY','PUBLISHED','PARTIALLY_PUBLISHED','FAILED'].includes(batch.status);
            return <article key={batch.jobId || batch.batchId} className="min-w-0 rounded-xl border border-slate-200 p-3">
              <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="break-words text-sm font-bold text-slate-900">{batch.fileName || 'Catalogue import'}</p><p className="mt-1 break-all font-mono text-[9px] text-slate-400">{batch.isImportJob ? `Job ${batch.jobId}` : batch.batchId}</p></div><span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold">{batch.status}</span></div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]"><div><span className="text-slate-400">Dataset</span><p className="mt-0.5 break-words font-semibold text-slate-700">{batch.dataset || 'Detecting…'}</p></div><div><span className="text-slate-400">Records</span><p className="mt-0.5 font-semibold tabular-nums text-slate-700">{batch.isImportJob ? `${Number(batch.processedRecords||0).toLocaleString()} / ${Number(batch.totalRecords||0).toLocaleString()}` : Number(batch.recordCount || batch.report?.normalizedRecords || 0).toLocaleString()}</p></div><div><span className="text-slate-400">Published</span><p className="mt-0.5 font-semibold tabular-nums text-slate-700">{Number(batch.publishedCount || 0).toLocaleString()}</p></div><div><span className="text-slate-400">Approval</span><p className="mt-0.5 font-semibold text-slate-700">{batch.isImportJob ? '—' : batch.approvedAt ? 'Approved' : 'Pending'}</p></div></div>
              {batch.isImportJob && batch.status === 'PROCESSING' && <div className="mt-3"><div className="h-1.5 overflow-hidden rounded-full bg-blue-100"><div className="h-full bg-blue-600" style={{width:`${Math.max(0,Math.min(100,Number(batch.progressPercent||0)))}%`}} /></div><p className="mt-1 text-[10px] text-slate-500">{batch.progressPercent || 0}% · {batch.stage}</p></div>}
              {batch.isImportJob && batch.status === 'FAILED' && <p className="mt-2 break-words text-[10px] text-rose-700">{batch.errorMessage}</p>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">{selectable && <label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" aria-label={`Select batch ${batch.batchId} for merge or removal`} checked={selectedBatchIds.includes(batch.batchId)} onChange={event => setSelectedBatchIds(current => event.target.checked ? [...current, batch.batchId].slice(-10) : current.filter(id => id !== batch.batchId))}/> Select to merge</label>}<div className="ml-auto flex gap-2">{batch.isImportJob && batch.status === 'FAILED' && <button type="button" onClick={() => retryImportJob(batch.jobId)} disabled={batchActionBusy} className="min-h-10 rounded-lg border border-amber-200 px-3 text-xs font-bold text-amber-800 disabled:opacity-50">Retry</button>}{batch.isImportJob && batch.status === 'PROCESSING' && (batch.leaseExpiresAt ? new Date(batch.leaseExpiresAt).getTime() <= Date.now() : Date.now() - new Date(batch.updatedAt || batch.createdAt || 0).getTime() >= 15 * 60 * 1000) && <button type="button" onClick={() => restartStuckImportJob(batch.jobId)} disabled={batchActionBusy} className="min-h-10 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-700 disabled:opacity-50">{batchActionBusy ? 'Restarting…' : 'Restart'}</button>}{canReview && <button type="button" onClick={() => openBatchReview(batch.batchId)} disabled={batchActionBusy} className="min-h-10 rounded-lg border border-blue-200 px-3 text-xs font-bold text-blue-700 disabled:opacity-50">Review batch</button>}</div></div>
              <p className="mt-2 text-[10px] text-slate-400">{batch.createdAt ? new Date(batch.createdAt).toLocaleString() : 'Upload time unavailable'}</p>
            </article>;
          })}</div>
        </> : <p className="p-5 text-xs text-slate-500">{historyLoading ? "Loading batch history…" : "No enrichment batches have been uploaded yet."}</p>}
      </section>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><strong className="text-xs text-slate-800">Published medicines</strong><span className="text-[11px] text-slate-500">{Number(data.pagination?.total || 0).toLocaleString()} records</span></div>
        {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading catalogue…</p> : data.items?.length ? (
          <div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Medicine</th><th className="p-3">Composition</th><th className="p-3">Strength / form</th><th className="p-3">Manufacturer</th><th className="p-3">Quality</th><th className="p-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{data.items.map(item => <tr key={item.medicineId} className="hover:bg-slate-50"><td className="p-3"><strong className="block text-slate-900">{item.brandName}</strong><span className="font-mono text-[10px] text-slate-500">{item.medicineId}</span></td><td className="p-3 text-slate-600">{item.composition || 'Not supplied'}</td><td className="p-3 text-slate-600">{[item.strength, item.dosageForm].filter(Boolean).join(' · ') || '—'}</td><td className="p-3 text-slate-600">{item.manufacturer || 'Not supplied'}</td><td className="p-3"><span className="font-bold">{item.qualityScore ?? 0}%</span><span className="ml-1 text-slate-500">{item.qualityGrade || item.dataQualityStatus || '—'}</span></td><td className="p-3"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => openRecord(item)} className="rounded-lg border border-blue-200 px-3 py-2 font-bold text-blue-700 hover:bg-blue-50">View / Edit</button><button type="button" onClick={() => deleteRecord(item)} disabled={saving} className="rounded-lg border border-rose-200 px-3 py-2 font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Delete</button></div></td></tr>)}</tbody></table></div><div className="grid gap-3 p-3 sm:hidden">{data.items.map(item => <article key={item.medicineId} className="rounded-xl border border-slate-200 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-sm font-extrabold text-slate-900">{item.brandName}</h3><p className="mt-1 break-all font-mono text-[9px] text-slate-400">{item.medicineId}</p></div><span className="shrink-0 rounded-lg bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-700">{item.qualityScore ?? 0}% quality</span></div><p className="mt-3 text-xs leading-5 text-slate-700">{item.composition || 'Composition not supplied'}</p><div className="mt-2 grid grid-cols-2 gap-2 text-[10px]"><div><span className="text-slate-400">Strength / form</span><p className="mt-0.5 font-semibold text-slate-700">{[item.strength,item.dosageForm].filter(Boolean).join(' · ') || '—'}</p></div><div><span className="text-slate-400">Manufacturer</span><p className="mt-0.5 break-words font-semibold text-slate-700">{item.manufacturer || 'Not supplied'}</p></div></div><div className="mt-3 flex gap-2 border-t border-slate-100 pt-3"><button type="button" onClick={() => openRecord(item)} className="min-h-10 flex-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] font-extrabold text-indigo-700">View / Edit</button><button type="button" onClick={() => deleteRecord(item)} disabled={saving} className="min-h-10 rounded-lg border border-rose-200 px-3 py-2 text-[11px] font-bold text-rose-700">Delete</button></div></article>)}</div>
        ) : <p className="p-8 text-center text-sm text-slate-500">No published medicine records found.</p>}
        <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-3"><span className="text-[11px] text-slate-500">Page {data.pagination?.page || page} of {Math.max(1, data.pagination?.totalPages || 1)}</span><div className="flex gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Previous</button><button type="button" disabled={page >= (data.pagination?.totalPages || 1) || loading} onClick={() => setPage(value => value + 1)} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Next</button></div></footer>
      </div>
      {reviewBatch && <div className="fixed inset-0 z-[125] flex h-[100dvh] items-center justify-center overflow-hidden bg-slate-950/60 p-0 sm:h-auto sm:p-4" role="dialog" aria-modal="true" aria-labelledby="catalogue-batch-review-title" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setReviewBatch(null); } }}><section className="mx-auto flex h-full max-h-[100dvh] min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-none bg-white shadow-2xl sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"><header className="flex shrink-0 items-center justify-between gap-3 border-b p-4"><div><h3 id="catalogue-batch-review-title" className="font-black text-slate-900">Batch reconciliation review</h3><p className="mt-1 break-all font-mono text-[10px] text-slate-500">{reviewBatch.batchId}</p></div><button type="button" onClick={() => setReviewBatch(null)} className="rounded-lg bg-slate-100 px-3 py-2 text-sm">✕</button></header><div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5" data-modal-scroll><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Status',reviewBatch.status],['Dataset',reviewBatch.dataset],['Source rows',reviewBatch.report?.sourceRecords],['Merged records',reviewBatch.report?.normalizedRecords],['Exact batch merges',reviewBatch.report?.exactBatchMerges],['Fuzzy batch merges',reviewBatch.report?.fuzzyBatchMerges],['Manual review',reviewBatch.report?.fuzzyManualReview],['Blocking conflicts',reviewBatch.report?.blockingConflicts],['Update candidates',reviewBatch.report?.updateCandidates]].map(([label,value]) => <div key={label} className="rounded-xl border bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase text-slate-500">{label}</p><p className="mt-1 text-sm font-black text-slate-900">{value ?? '—'}</p></div>)}</div><div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">Fuzzy auto-merges require matching composition and compatible strength and dosage form. Ambiguous candidates are retained separately for review. Conflicting source identifiers block approval and must be separated. Clinical and regulatory verification is never inferred by a merge.</div><section className="space-y-2 rounded-xl border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-xs font-black text-slate-800">All staged / merged medicine records</h4><p className="text-[10px] text-slate-500">{Number(reviewRecords.pagination?.total || 0).toLocaleString()} matching records · inspect before approval</p></div><div className="flex gap-2"><input value={reviewRecordsSearch} onChange={event => setReviewRecordsSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') loadBatchRecords(reviewBatch.batchId, 1, reviewRecordsSearch); }} placeholder="Search this batch" className="w-44 rounded-lg border px-2 py-1.5 text-xs"/><button type="button" onClick={() => loadBatchRecords(reviewBatch.batchId, 1, reviewRecordsSearch)} className="rounded-lg border px-3 py-1.5 text-xs font-bold">Search</button></div></div>{reviewRecordsLoading ? <p className="p-4 text-center text-xs text-slate-500">Loading staged records…</p> : <>
          <div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[680px] text-left text-[11px]"><thead className="bg-slate-50"><tr><th className="p-2">Medicine</th><th className="p-2">Composition</th><th className="p-2">Strength / form</th><th className="p-2">Manufacturer</th><th className="p-2">Quality</th><th className="p-2">Source</th></tr></thead><tbody>{reviewRecords.items?.map(item => <tr key={item.medicineId} className="border-t"><td className="p-2"><strong>{item.brandName}</strong><span className="block font-mono text-[9px] text-slate-400">{item.medicineId}</span></td><td className="p-2">{item.composition || '—'}</td><td className="p-2">{[item.strength,item.dosageForm].filter(Boolean).join(' · ') || '—'}</td><td className="p-2">{item.manufacturer || '—'}</td><td className="p-2">{item.qualityScore ?? 0}% · {item.qualityGrade || '—'}</td><td className="p-2">{item.sourceDataset || '—'}<span className="block text-[9px] text-slate-400">{item.sourceRecordId || ''}</span></td></tr>)}</tbody></table></div>
          <div className="grid gap-2 sm:hidden">{reviewRecords.items?.map(item => <article key={item.medicineId} className="rounded-lg border border-slate-200 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-xs font-bold text-slate-900">{item.brandName}</p><p className="mt-1 break-all font-mono text-[9px] text-slate-400">{item.medicineId}</p></div><span className="shrink-0 rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700">{item.qualityScore ?? 0}%</span></div><p className="mt-2 break-words text-xs text-slate-700">{item.composition || 'Composition not supplied'}</p><div className="mt-2 grid grid-cols-2 gap-2 text-[10px]"><div><span className="text-slate-400">Strength / form</span><p className="mt-0.5 break-words font-semibold text-slate-700">{[item.strength,item.dosageForm].filter(Boolean).join(' · ') || '—'}</p></div><div><span className="text-slate-400">Manufacturer</span><p className="mt-0.5 break-words font-semibold text-slate-700">{item.manufacturer || '—'}</p></div></div><div className="mt-2 border-t border-slate-100 pt-2 text-[10px]"><p className="break-words text-slate-600">{item.sourceDataset || 'Source unavailable'}</p><p className="break-all font-mono text-[9px] text-slate-400">{item.sourceRecordId || ''}</p></div></article>)}</div>
          {!reviewRecords.items?.length && <p className="p-4 text-center text-xs text-slate-500">No matching staged records.</p>}
        </>}<div className="flex items-center justify-between"><span className="text-[10px] text-slate-500">Page {reviewRecords.pagination?.page || 1} of {Math.max(1,reviewRecords.pagination?.totalPages || 1)}</span><div className="flex gap-2"><button type="button" disabled={reviewRecordsPage <= 1 || reviewRecordsLoading} onClick={() => loadBatchRecords(reviewBatch.batchId, reviewRecordsPage - 1)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">Previous</button><button type="button" disabled={reviewRecordsPage >= (reviewRecords.pagination?.totalPages || 1) || reviewRecordsLoading} onClick={() => loadBatchRecords(reviewBatch.batchId, reviewRecordsPage + 1)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">Next</button></div></div></section>{reviewBatch.report?.fuzzyMatchExamples?.length > 0 && <section className="rounded-xl border p-3"><h4 className="mb-2 text-xs font-black text-slate-800">Fuzzy match examples</h4><div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[620px] text-left text-[11px]"><thead className="bg-slate-50"><tr><th className="p-2">Incoming</th><th className="p-2">Candidate</th><th className="p-2">Score</th><th className="p-2">Linkage evidence</th><th className="p-2">Warnings</th></tr></thead><tbody>{reviewBatch.report.fuzzyMatchExamples.map((item,index)=><tr key={index} className="border-t"><td className="p-2">{item.incomingMedicine}</td><td className="p-2">{item.candidateMedicine || item.matchedMedicineId}</td><td className="p-2">{item.score}%</td><td className="p-2">Name {item.nameScore ?? '—'}% · n-gram {item.ngramNameScore ?? '—'}% · TF-IDF {item.tfIdfNameScore ?? '—'}% · composition {item.compositionScore ?? '—'}%</td><td className="p-2">{(item.warnings||[]).join(', ')}</td></tr>)}</tbody></table></div><div className="grid gap-2 sm:hidden">{reviewBatch.report.fuzzyMatchExamples.map((item,index)=><article key={index} className="rounded-lg border border-slate-200 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase text-slate-400">Incoming</p><p className="break-words text-xs font-bold text-slate-900">{item.incomingMedicine}</p></div><span className="shrink-0 rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700">{item.score}%</span></div><p className="mt-2 text-[10px] font-semibold uppercase text-slate-400">Candidate</p><p className="break-words text-xs text-slate-800">{item.candidateMedicine || item.matchedMedicineId}</p><p className="mt-2 text-[10px] text-slate-600">Name {item.nameScore ?? '—'}% · n-gram {item.ngramNameScore ?? '—'}% · TF-IDF {item.tfIdfNameScore ?? '—'}% · composition {item.compositionScore ?? '—'}%</p>{Boolean(item.warnings?.length) && <p className="mt-2 break-words text-[10px] text-amber-800">Warnings: {item.warnings.join(', ')}</p>}</article>)}</div></section>}{reviewBatch.status === 'READY' && !reviewBatch.approvedAt && <label className="flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-950"><input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} className="mt-0.5" />I reviewed the combined batch analytics and approve this exact reconciliation report.</label>}{reviewBatch.approvedAt && <p className="text-xs font-semibold text-emerald-700">Approved by {reviewBatch.approvedBy || 'platform administrator'} at {new Date(reviewBatch.approvedAt).toLocaleString()}.</p>}</div><footer className="flex shrink-0 flex-col-reverse justify-between gap-2 border-t bg-slate-50 p-4 sm:flex-row"><button type="button" onClick={refreshReviewedBatch} disabled={batchActionBusy} className="rounded-xl border px-4 py-2.5 text-xs font-bold">Refresh status</button><div className="flex flex-col gap-2 sm:flex-row">{reviewBatch.status === 'READY' && !reviewBatch.approvedAt && <button type="button" onClick={approveReviewedBatch} disabled={batchActionBusy || !reviewConfirmed || Number(reviewBatch.report?.blockingConflicts || 0) > 0} className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-extrabold text-white disabled:opacity-40">{batchActionBusy ? 'Working…' : 'Approve report'}</button>}{reviewBatch.status === 'READY' && reviewBatch.approvedAt && <button type="button" onClick={publishReviewedBatch} disabled={batchActionBusy} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-extrabold text-white disabled:opacity-40">{batchActionBusy ? 'Publishing…' : 'Publish combined batch'}</button>}</div></footer></section></div>}
      {selected && <div className="fixed inset-0 z-[130] flex items-center justify-center overflow-hidden bg-slate-950/70 p-0 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="medicine-master-detail-title" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setSelected(null); setEditing(false); } }}><section className="mx-auto flex h-[100dvh] max-h-[100dvh] min-h-0 w-full max-w-4xl flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"><header className="flex items-center justify-between border-b p-4 sm:p-5"><div><h3 id="medicine-master-detail-title" className="font-black text-slate-900">{editing ? 'Edit medicine master record' : selected.brandName}</h3><p className="mt-1 font-mono text-[10px] text-slate-500">{selected.medicineId}</p></div><button type="button" onClick={() => setSelected(null)} className="rounded-lg bg-slate-100 px-3 py-2 text-sm">✕</button></header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5" data-modal-scroll>{!editing ? <><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[...TEXT_FIELDS, ...ARRAY_FIELDS].map(field => <div key={field} className="rounded-xl border border-slate-100 p-3"><p className="text-[10px] font-bold uppercase text-slate-500">{LABELS[field]}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{Array.isArray(selected[field]) ? selected[field].join(', ') : selected[field] || 'Not supplied'}</p></div>)}</div><div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Clinical data, suggested alternatives and regulatory status remain source-dependent. Editing does not verify clinical claims. Tenant pricing, stock, batches and expiry are not editable here.</div></> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[...TEXT_FIELDS, ...ARRAY_FIELDS].map(field => <label key={field} className="text-xs font-bold text-slate-700">{LABELS[field]}{ARRAY_FIELDS.includes(field) ? <textarea rows={3} value={form[field]} onChange={event => setForm(value => ({ ...value, [field]: event.target.value }))} placeholder="One value per line" className="mt-1 block w-full rounded-xl border border-slate-300 p-2.5 font-normal" /> : <input value={form[field]} onChange={event => setForm(value => ({ ...value, [field]: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-300 p-2.5 font-normal" />}</label>)}</div>}
        <div className="border-t pt-4"><h4 className="text-xs font-black text-slate-800">Update history</h4>{audit.length ? <div className="mt-2 space-y-2">{audit.map(entry => <div key={entry._id} className="rounded-xl bg-slate-50 p-3 text-[11px]"><div className="flex flex-wrap justify-between gap-2"><strong>{entry.changedFields?.join(', ')}</strong><span className="text-slate-500">{new Date(entry.createdAt).toLocaleString()}</span></div><p className="mt-1 text-slate-500">Updated by {entry.actorId || 'Platform administrator'}</p></div>)}</div> : <p className="mt-2 text-xs text-slate-500">No manual updates recorded.</p>}</div></div>
        <footer className="flex shrink-0 flex-col-reverse justify-between gap-2 border-t bg-slate-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row">{editing ? <><button type="button" onClick={() => setEditing(false)} disabled={saving} className="rounded-xl border px-4 py-2.5 text-xs font-bold">Cancel</button><button type="button" onClick={save} disabled={saving} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-extrabold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save audited changes'}</button></> : <><button type="button" onClick={() => setSelected(null)} className="rounded-xl border px-4 py-2.5 text-xs font-bold">Close</button><button type="button" onClick={() => deleteRecord(selected)} disabled={saving} className="rounded-xl border border-rose-200 px-4 py-2.5 text-xs font-extrabold text-rose-700 disabled:opacity-50">Delete record</button><button type="button" onClick={() => setEditing(true)} className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-extrabold text-white">Edit medicine</button></>}</footer>
      </section></div>}
    </section>
  );
}
