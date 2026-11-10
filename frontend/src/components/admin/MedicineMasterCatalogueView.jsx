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
  const openBatchReview = async batchId => {
    setBatchActionBusy(true);
    try {
      const response = await apiClient.get(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(batchId)}`);
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
      const response = await apiClient.get(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(batchId)}/records`, { params: { page: nextPage, limit: 20, search: searchValue } });
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
      <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-black text-slate-900">Medicine Master Catalogue</h2><p className="mt-1 text-xs text-slate-500">Browse published shared records, inspect provenance, make audited platform-level updates and remove records from the active catalogue.</p></div>
        <button type="button" onClick={onOpenImport} className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-violet-700">🧬 Enrich catalogue</button>
      </header>
      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row">
        <input value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { setPage(1); setQuery(search.trim()); } }} placeholder="Search brand, generic, composition or manufacturer" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
        <button type="button" onClick={() => { setPage(1); setQuery(search.trim()); }} className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white">Search</button>
        <button type="button" onClick={() => { setSearch(''); setQuery(''); setPage(1); }} className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700">Clear</button>
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"><div><strong className="text-xs text-slate-800">Recent enrichment batches</strong><p className="mt-1 text-[10px] text-slate-500">Select standalone, unapproved READY batches to merge or permanently delete</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={mergeSelectedBatches} disabled={mergeBusy || removeBatchesBusy || selectedBatchIds.length < 2 || selectedBatchIds.length > 10} className="rounded-lg bg-violet-600 px-3 py-2 text-[11px] font-extrabold text-white disabled:opacity-40">{mergeBusy ? 'Merging…' : `Merge selected (${selectedBatchIds.length})`}</button><button type="button" onClick={removeSelectedBatches} disabled={removeBatchesBusy || mergeBusy || selectedBatchIds.length < 1} className="rounded-lg border border-rose-200 px-3 py-2 text-[11px] font-extrabold text-rose-700 disabled:opacity-40">{removeBatchesBusy ? 'Deleting…' : `Delete selected (${selectedBatchIds.length})`}</button><button type="button" onClick={loadImportHistory} disabled={historyLoading || removeBatchesBusy} className="rounded-lg border px-3 py-2 text-[11px] font-bold disabled:opacity-50">{historyLoading ? "Refreshing…" : "Refresh history"}</button></div></div>
        {imports.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Select</th><th className="p-3">Uploaded file</th><th className="p-3">Dataset</th><th className="p-3">Status</th><th className="p-3">Records</th><th className="p-3">Published</th><th className="p-3">Approval</th><th className="p-3">Uploaded</th><th className="p-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{imports.map(batch => <tr key={batch.jobId || batch.batchId}><td className="p-3"><input type="checkbox" aria-label={`Select batch ${batch.batchId} for merge or removal`} checked={selectedBatchIds.includes(batch.batchId)} disabled={batch.isImportJob || batch.status !== 'READY' || Boolean(batch.approvedAt) || Boolean(batch.supersededByBatchId) || Boolean(batch.sourceBatchIds?.length) || mergeBusy || removeBatchesBusy} onChange={event => setSelectedBatchIds(current => event.target.checked ? [...current, batch.batchId].slice(-10) : current.filter(id => id !== batch.batchId))} /></td><td className="p-3"><strong className="block text-slate-800">{batch.fileName}</strong><span className="font-mono text-[10px] text-slate-400">{batch.isImportJob ? `Job ${batch.jobId}` : batch.batchId}</span></td><td className="p-3 text-slate-600">{batch.dataset || 'Detecting…'}</td><td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold">{batch.status}</span>{batch.isImportJob && batch.status === 'PROCESSING' && <div className="mt-1 min-w-20"><div className="h-1.5 overflow-hidden rounded-full bg-blue-100"><div className="h-full bg-blue-600" style={{width:`${Math.max(0,Math.min(100,Number(batch.progressPercent||0)))}%`}} /></div><span className="text-[9px] text-slate-500">{batch.progressPercent || 0}% · {batch.stage}</span></div>}{batch.isImportJob && batch.status === 'FAILED' && <p className="mt-1 max-w-40 text-[9px] text-rose-700">{batch.errorMessage}</p>}</td><td className="p-3 tabular-nums">{batch.isImportJob ? `${Number(batch.processedRecords||0).toLocaleString()} / ${Number(batch.totalRecords||0).toLocaleString()}` : Number(batch.recordCount || batch.report?.normalizedRecords || 0).toLocaleString()}</td><td className="p-3 tabular-nums">{Number(batch.publishedCount || 0).toLocaleString()}</td><td className="p-3">{batch.isImportJob ? '—' : batch.approvedAt ? <span className="font-bold text-emerald-700">Approved</span> : <span className="text-amber-700">Pending</span>}</td><td className="p-3 text-slate-500">{batch.createdAt ? new Date(batch.createdAt).toLocaleString() : "—"}</td><td className="p-3">{batch.isImportJob && batch.status === 'FAILED' ? <button type="button" onClick={() => retryImportJob(batch.jobId)} className="rounded-lg border border-amber-200 px-2.5 py-1.5 text-[10px] font-bold text-amber-800">Retry</button> : !batch.isImportJob && ['READY','PUBLISHED','PARTIALLY_PUBLISHED','FAILED'].includes(batch.status) && <button type="button" onClick={() => openBatchReview(batch.batchId)} disabled={batchActionBusy} className="rounded-lg border border-blue-200 px-2.5 py-1.5 text-[10px] font-bold text-blue-700 disabled:opacity-50">Review</button>}</td></tr>)}</tbody></table></div> : <p className="p-5 text-xs text-slate-500">{historyLoading ? "Loading batch history…" : "No enrichment batches have been uploaded yet."}</p>}
      </section>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><strong className="text-xs text-slate-800">Published medicines</strong><span className="text-[11px] text-slate-500">{Number(data.pagination?.total || 0).toLocaleString()} records</span></div>
        {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading catalogue…</p> : data.items?.length ? (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Medicine</th><th className="p-3">Composition</th><th className="p-3">Strength / form</th><th className="p-3">Manufacturer</th><th className="p-3">Quality</th><th className="p-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{data.items.map(item => <tr key={item.medicineId} className="hover:bg-slate-50"><td className="p-3"><strong className="block text-slate-900">{item.brandName}</strong><span className="font-mono text-[10px] text-slate-500">{item.medicineId}</span></td><td className="p-3 text-slate-600">{item.composition || 'Not supplied'}</td><td className="p-3 text-slate-600">{[item.strength, item.dosageForm].filter(Boolean).join(' · ') || '—'}</td><td className="p-3 text-slate-600">{item.manufacturer || 'Not supplied'}</td><td className="p-3"><span className="font-bold">{item.qualityScore ?? 0}%</span><span className="ml-1 text-slate-500">{item.qualityGrade || item.dataQualityStatus || '—'}</span></td><td className="p-3"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => openRecord(item)} className="rounded-lg border border-blue-200 px-3 py-2 font-bold text-blue-700 hover:bg-blue-50">View / Edit</button><button type="button" onClick={() => deleteRecord(item)} disabled={saving} className="rounded-lg border border-rose-200 px-3 py-2 font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Delete</button></div></td></tr>)}</tbody></table></div>
        ) : <p className="p-8 text-center text-sm text-slate-500">No published medicine records found.</p>}
        <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-3"><span className="text-[11px] text-slate-500">Page {data.pagination?.page || page} of {Math.max(1, data.pagination?.totalPages || 1)}</span><div className="flex gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Previous</button><button type="button" disabled={page >= (data.pagination?.totalPages || 1) || loading} onClick={() => setPage(value => value + 1)} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Next</button></div></footer>
      </div>
      {reviewBatch && <div className="fixed inset-0 z-[125] overflow-y-auto bg-slate-950/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="catalogue-batch-review-title"><section className="mx-auto my-4 w-full max-w-4xl rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between gap-3 border-b p-4"><div><h3 id="catalogue-batch-review-title" className="font-black text-slate-900">Batch reconciliation review</h3><p className="mt-1 break-all font-mono text-[10px] text-slate-500">{reviewBatch.batchId}</p></div><button type="button" onClick={() => setReviewBatch(null)} className="rounded-lg bg-slate-100 px-3 py-2 text-sm">✕</button></header><div className="space-y-4 p-4 sm:p-5"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Status',reviewBatch.status],['Dataset',reviewBatch.dataset],['Source rows',reviewBatch.report?.sourceRecords],['Merged records',reviewBatch.report?.normalizedRecords],['Exact batch merges',reviewBatch.report?.exactBatchMerges],['Fuzzy batch merges',reviewBatch.report?.fuzzyBatchMerges],['Manual review',reviewBatch.report?.fuzzyManualReview],['Blocking conflicts',reviewBatch.report?.blockingConflicts],['Update candidates',reviewBatch.report?.updateCandidates]].map(([label,value]) => <div key={label} className="rounded-xl border bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase text-slate-500">{label}</p><p className="mt-1 text-sm font-black text-slate-900">{value ?? '—'}</p></div>)}</div><div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">Fuzzy auto-merges require matching composition and compatible strength and dosage form. Ambiguous candidates are retained separately for review. Conflicting source identifiers block approval and must be separated. Clinical and regulatory verification is never inferred by a merge.</div><section className="space-y-2 rounded-xl border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-xs font-black text-slate-800">All staged / merged medicine records</h4><p className="text-[10px] text-slate-500">{Number(reviewRecords.pagination?.total || 0).toLocaleString()} matching records · inspect before approval</p></div><div className="flex gap-2"><input value={reviewRecordsSearch} onChange={event => setReviewRecordsSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') loadBatchRecords(reviewBatch.batchId, 1, reviewRecordsSearch); }} placeholder="Search this batch" className="w-44 rounded-lg border px-2 py-1.5 text-xs"/><button type="button" onClick={() => loadBatchRecords(reviewBatch.batchId, 1, reviewRecordsSearch)} className="rounded-lg border px-3 py-1.5 text-xs font-bold">Search</button></div></div>{reviewRecordsLoading ? <p className="p-4 text-center text-xs text-slate-500">Loading staged records…</p> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-[11px]"><thead className="bg-slate-50"><tr><th className="p-2">Medicine</th><th className="p-2">Composition</th><th className="p-2">Strength / form</th><th className="p-2">Manufacturer</th><th className="p-2">Quality</th><th className="p-2">Source</th></tr></thead><tbody>{reviewRecords.items?.map(item => <tr key={item.medicineId} className="border-t"><td className="p-2"><strong>{item.brandName}</strong><span className="block font-mono text-[9px] text-slate-400">{item.medicineId}</span></td><td className="p-2">{item.composition || '—'}</td><td className="p-2">{[item.strength,item.dosageForm].filter(Boolean).join(' · ') || '—'}</td><td className="p-2">{item.manufacturer || '—'}</td><td className="p-2">{item.qualityScore ?? 0}% · {item.qualityGrade || '—'}</td><td className="p-2">{item.sourceDataset || '—'}<span className="block text-[9px] text-slate-400">{item.sourceRecordId || ''}</span></td></tr>)}</tbody></table>{!reviewRecords.items?.length && <p className="p-4 text-center text-xs text-slate-500">No matching staged records.</p>}</div>}<div className="flex items-center justify-between"><span className="text-[10px] text-slate-500">Page {reviewRecords.pagination?.page || 1} of {Math.max(1,reviewRecords.pagination?.totalPages || 1)}</span><div className="flex gap-2"><button type="button" disabled={reviewRecordsPage <= 1 || reviewRecordsLoading} onClick={() => loadBatchRecords(reviewBatch.batchId, reviewRecordsPage - 1)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">Previous</button><button type="button" disabled={reviewRecordsPage >= (reviewRecords.pagination?.totalPages || 1) || reviewRecordsLoading} onClick={() => loadBatchRecords(reviewBatch.batchId, reviewRecordsPage + 1)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">Next</button></div></div></section>{reviewBatch.report?.fuzzyMatchExamples?.length > 0 && <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[620px] text-left text-[11px]"><thead className="bg-slate-50"><tr><th className="p-2">Incoming</th><th className="p-2">Candidate</th><th className="p-2">Score</th><th className="p-2">Linkage evidence</th><th className="p-2">Warnings</th></tr></thead><tbody>{reviewBatch.report.fuzzyMatchExamples.map((item,index)=><tr key={index} className="border-t"><td className="p-2">{item.incomingMedicine}</td><td className="p-2">{item.candidateMedicine || item.matchedMedicineId}</td><td className="p-2">{item.score}%</td><td className="p-2">Name {item.nameScore ?? '—'}% · n-gram {item.ngramNameScore ?? '—'}% · TF-IDF {item.tfIdfNameScore ?? '—'}% · composition {item.compositionScore ?? '—'}%</td><td className="p-2">{(item.warnings||[]).join(', ')}</td></tr>)}</tbody></table></div>}{reviewBatch.status === 'READY' && !reviewBatch.approvedAt && <label className="flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-950"><input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} className="mt-0.5" />I reviewed the combined batch analytics and approve this exact reconciliation report.</label>}{reviewBatch.approvedAt && <p className="text-xs font-semibold text-emerald-700">Approved by {reviewBatch.approvedBy || 'platform administrator'} at {new Date(reviewBatch.approvedAt).toLocaleString()}.</p>}</div><footer className="flex flex-col-reverse justify-between gap-2 border-t bg-slate-50 p-4 sm:flex-row"><button type="button" onClick={refreshReviewedBatch} disabled={batchActionBusy} className="rounded-xl border px-4 py-2.5 text-xs font-bold">Refresh status</button><div className="flex flex-col gap-2 sm:flex-row">{reviewBatch.status === 'READY' && !reviewBatch.approvedAt && <button type="button" onClick={approveReviewedBatch} disabled={batchActionBusy || !reviewConfirmed || Number(reviewBatch.report?.blockingConflicts || 0) > 0} className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-extrabold text-white disabled:opacity-40">{batchActionBusy ? 'Working…' : 'Approve report'}</button>}{reviewBatch.status === 'READY' && reviewBatch.approvedAt && <button type="button" onClick={publishReviewedBatch} disabled={batchActionBusy} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-extrabold text-white disabled:opacity-40">{batchActionBusy ? 'Publishing…' : 'Publish combined batch'}</button>}</div></footer></section></div>}
      {selected && <div className="fixed inset-0 z-[130] overflow-y-auto bg-slate-950/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="medicine-master-detail-title"><section className="mx-auto my-4 w-full max-w-4xl rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between border-b p-4 sm:p-5"><div><h3 id="medicine-master-detail-title" className="font-black text-slate-900">{editing ? 'Edit medicine master record' : selected.brandName}</h3><p className="mt-1 font-mono text-[10px] text-slate-500">{selected.medicineId}</p></div><button type="button" onClick={() => setSelected(null)} className="rounded-lg bg-slate-100 px-3 py-2 text-sm">✕</button></header>
        <div className="space-y-4 p-4 sm:p-5">{!editing ? <><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[...TEXT_FIELDS, ...ARRAY_FIELDS].map(field => <div key={field} className="rounded-xl border border-slate-100 p-3"><p className="text-[10px] font-bold uppercase text-slate-500">{LABELS[field]}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{Array.isArray(selected[field]) ? selected[field].join(', ') : selected[field] || 'Not supplied'}</p></div>)}</div><div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Clinical data, suggested alternatives and regulatory status remain source-dependent. Editing does not verify clinical claims. Tenant pricing, stock, batches and expiry are not editable here.</div></> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[...TEXT_FIELDS, ...ARRAY_FIELDS].map(field => <label key={field} className="text-xs font-bold text-slate-700">{LABELS[field]}{ARRAY_FIELDS.includes(field) ? <textarea rows={3} value={form[field]} onChange={event => setForm(value => ({ ...value, [field]: event.target.value }))} placeholder="One value per line" className="mt-1 block w-full rounded-xl border border-slate-300 p-2.5 font-normal" /> : <input value={form[field]} onChange={event => setForm(value => ({ ...value, [field]: event.target.value }))} className="mt-1 block w-full rounded-xl border border-slate-300 p-2.5 font-normal" />}</label>)}</div>}
        <div className="border-t pt-4"><h4 className="text-xs font-black text-slate-800">Update history</h4>{audit.length ? <div className="mt-2 space-y-2">{audit.map(entry => <div key={entry._id} className="rounded-xl bg-slate-50 p-3 text-[11px]"><div className="flex flex-wrap justify-between gap-2"><strong>{entry.changedFields?.join(', ')}</strong><span className="text-slate-500">{new Date(entry.createdAt).toLocaleString()}</span></div><p className="mt-1 text-slate-500">Updated by {entry.actorId || 'Platform administrator'}</p></div>)}</div> : <p className="mt-2 text-xs text-slate-500">No manual updates recorded.</p>}</div></div>
        <footer className="flex flex-col-reverse justify-between gap-2 rounded-b-2xl border-t bg-slate-50 p-4 sm:flex-row">{editing ? <><button type="button" onClick={() => setEditing(false)} disabled={saving} className="rounded-xl border px-4 py-2.5 text-xs font-bold">Cancel</button><button type="button" onClick={save} disabled={saving} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-extrabold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save audited changes'}</button></> : <><button type="button" onClick={() => setSelected(null)} className="rounded-xl border px-4 py-2.5 text-xs font-bold">Close</button><button type="button" onClick={() => deleteRecord(selected)} disabled={saving} className="rounded-xl border border-rose-200 px-4 py-2.5 text-xs font-extrabold text-rose-700 disabled:opacity-50">Delete record</button><button type="button" onClick={() => setEditing(true)} className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-extrabold text-white">Edit medicine</button></>}</footer>
      </section></div>}
    </section>
  );
}
