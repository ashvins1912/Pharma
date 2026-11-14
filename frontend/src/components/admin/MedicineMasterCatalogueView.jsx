import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';
import MedicineMatchReviewQueue from './MedicineMatchReviewQueue';
import {
  RECONCILIATION_PIPELINE_STAGES,
  createActionIdempotencyKey,
  getEffectiveBatchState,
  getPipelineStageIndex,
  getReconciliationStatusMeta,
  isBatchReviewable,
  isBatchSelectableForMergeOrDelete
} from './reconciliationStatus';

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
  const [reviewResolutionDrafts, setReviewResolutionDrafts] = useState({});

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
      await apiClient.post(
        `/api/v1/inventory/catalogue/imports/jobs/${encodeURIComponent(jobId)}/retry`,
        {},
        { headers: { 'Idempotency-Key': createActionIdempotencyKey('retry-job', jobId) } }
      );
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
      await apiClient.post(
        `/api/v1/inventory/catalogue/imports/jobs/${encodeURIComponent(jobId)}/restart`,
        {},
        { headers: { 'Idempotency-Key': createActionIdempotencyKey('restart-job', jobId) } }
      );
      await loadImportHistory();
      addToast('Stuck import re-queued. Refresh history to follow its progress.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not restart this import. Refresh history to check its worker lease.', 'error');
      await loadImportHistory();
    } finally { setBatchActionBusy(false); }
  };
  const openBatchReview = async batchId => {
    console.log('OPEN BATCH REVIEW:', batchId);
    setBatchActionBusy(true);
    try {
      const response = await apiClient.get(
          `/api/v1/inventory/catalogue/imports/${encodeURIComponent(batchId)}`,
          { timeout: 30000 }
      );

      console.log('BATCH REVIEW API RESPONSE:', response.data);

      setReviewBatch(response.data);
      setReviewConfirmed(false);
      setReviewResolutionDrafts({});
      setReviewRecordsPage(1);
      setReviewRecordsSearch('');
      await loadBatchRecords(batchId, 1, '');
    } catch (error) {
      console.error('BATCH REVIEW ERROR:', error.response?.data || error);
      addToast(error.response?.data?.message || 'Could not load the staged batch report.', 'error');
    } finally {
      setBatchActionBusy(false);
    }
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
  const reconcileReviewedBatch = async () => {
    if (!reviewBatch?.batchId) return;
    setBatchActionBusy(true);
    try {
      const response = await apiClient.post(
        `/api/v1/inventory/catalogue/imports/${encodeURIComponent(reviewBatch.batchId)}/reconcile`,
        { reason: 'Administrator triggered batch reconciliation pass' },
        {
          headers: { 'Idempotency-Key': createActionIdempotencyKey('reconcile', reviewBatch.batchId, reviewBatch.stateVersion ?? 0) },
          timeout: 120000
        }
      );
      setReviewBatch(response.data);
      setReviewConfirmed(false);
      await loadImportHistory();
      const state = getEffectiveBatchState(response.data);
      addToast(
        state === 'CONFLICTS_FOUND'
          ? 'Reconciliation completed with unresolved conflicts.'
          : 'Reconciliation completed cleanly. Ready for approval.',
        state === 'CONFLICTS_FOUND' ? 'warning' : 'success'
      );
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not re-run reconciliation for this batch.', 'error');
    } finally { setBatchActionBusy(false); }
  };
  const resolveReviewedBatchConflicts = async () => {
    if (!reviewBatch?.batchId) return;
    const unresolved = (reviewBatch.conflicts || []).filter(item => !item?.resolved && item?.medicineId);
    const resolutions = unresolved
      .map(conflict => {
        const key = conflict.conflictId || conflict.medicineId;
        const draftAction = reviewResolutionDrafts[key];
        if (!draftAction) return null;
        return {
          conflictId: conflict.conflictId || '',
          medicineId: conflict.medicineId,
          action: draftAction,
          targetMedicineId: draftAction === 'ACCEPT_CANDIDATE' ? (conflict.targetMedicineId || conflict.currentTargetMedicineId || '') : ''
        };
      })
      .filter(Boolean);
    if (!resolutions.length) {
      addToast('Select a resolution decision for at least one conflict first.', 'warning');
      return;
    }
    setBatchActionBusy(true);
    try {
      const response = await apiClient.post(
        `/api/v1/inventory/catalogue/imports/${encodeURIComponent(reviewBatch.batchId)}/conflicts/resolve`,
        { resolutions, autoReconcile: true },
        {
          headers: { 'Idempotency-Key': createActionIdempotencyKey('resolve', reviewBatch.batchId, reviewBatch.stateVersion ?? 0) },
          timeout: 120000
        }
      );
      setReviewBatch(response.data);
      setReviewResolutionDrafts({});
      setReviewConfirmed(false);
      await loadImportHistory();
      const state = getEffectiveBatchState(response.data);
      addToast(
        state === 'CONFLICTS_FOUND'
          ? 'Resolutions applied; remaining conflicts require review.'
          : 'Conflicts resolved and batch reconciled.',
        state === 'CONFLICTS_FOUND' ? 'warning' : 'success'
      );
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not apply conflict resolutions.', 'error');
    } finally { setBatchActionBusy(false); }
  };
  const approveReviewedBatch = async () => {
    if (!reviewBatch?.batchId || !reviewConfirmed || !reviewBatch.reportFingerprint) return;
    setBatchActionBusy(true);
    try {
      await apiClient.post(
        `/api/v1/inventory/catalogue/imports/${encodeURIComponent(reviewBatch.batchId)}/approve`,
        { confirmReconciliation: true, reportFingerprint: reviewBatch.reportFingerprint },
        { headers: { 'Idempotency-Key': createActionIdempotencyKey('approve', reviewBatch.batchId, reviewBatch.reportFingerprint) } }
      );
      await refreshReviewedBatch();
      addToast('Reconciliation report approved.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not approve this batch.', 'error');
    } finally { setBatchActionBusy(false); }
  };
  const publishReviewedBatch = async () => {
    const effective = getEffectiveBatchState(reviewBatch);
    if (!reviewBatch?.batchId || (!reviewBatch?.approvedAt && effective !== 'APPROVED')) return;
    if (!window.confirm('Publish this approved batch to the shared medicine master catalogue?')) return;
    setBatchActionBusy(true);
    try {
      await apiClient.post(
        `/api/v1/inventory/catalogue/imports/${encodeURIComponent(reviewBatch.batchId)}/publish`,
        {},
        {
          headers: { 'Idempotency-Key': createActionIdempotencyKey('publish', reviewBatch.batchId, reviewBatch.stateVersion ?? reviewBatch.reportFingerprint) },
          timeout: 300000
        }
      );
      await refreshReviewedBatch();
      await load();
      addToast('Medicine batch published to shared catalogue.', 'success');
    } catch (error) {
      const payload = error.response?.data;
      if (error.response?.status === 409 && payload?.status === 'CONFLICTS_FOUND') {
        setReviewBatch(current => ({ ...(current || {}), ...payload, approvedAt: null, approvedBy: '' }));
        setReviewConfirmed(false);
        await loadImportHistory();
      } else {
        await refreshReviewedBatch().catch(() => {});
      }
      addToast(payload?.message || 'Could not publish this batch.', 'error');
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

  const reviewEffectiveState = getEffectiveBatchState(reviewBatch);
  const reviewStatusMeta = getReconciliationStatusMeta(reviewEffectiveState);
  const reviewPipelineIndex = getPipelineStageIndex(reviewEffectiveState);
  const reviewUnresolvedConflicts = (reviewBatch?.conflicts || []).filter(item => !item?.resolved);
  const reviewHasBlockingConflicts = Number(reviewBatch?.report?.blockingConflicts || 0) > 0 || reviewUnresolvedConflicts.length > 0;
  const reviewCanResolveConflicts = ['CONFLICTS_FOUND', 'RESOLVING', 'FAILED'].includes(reviewEffectiveState) && reviewUnresolvedConflicts.some(item => item?.medicineId);
  const reviewCanReconcile = ['STAGED', 'CONFLICTS_FOUND', 'RECONCILED', 'AWAITING_APPROVAL', 'APPROVED', 'FAILED', 'PARTIALLY_PUBLISHED', 'READY'].includes(reviewEffectiveState);
  const reviewCanApprove = ['RECONCILED', 'AWAITING_APPROVAL', 'READY'].includes(reviewEffectiveState) && !reviewBatch?.approvedAt && !reviewHasBlockingConflicts;
  const reviewCanPublish = ['APPROVED', 'PARTIALLY_PUBLISHED'].includes(reviewEffectiveState) || (reviewEffectiveState === 'READY' && Boolean(reviewBatch?.approvedAt));

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
              <span>Platform data workspace</span>
            </div>
            <h2 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
              <span>Medicine Master Catalogue</span>
            </h2>
            <p className="mt-2 max-w-xl text-xs leading-5 text-slate-600 sm:text-sm">
              <span>Manage trusted shared medicine records, review incoming reconciliation batches and track platform-level changes in one workspace.</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenImport}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-xs font-extrabold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            <span>＋ Enrich catalogue</span>
          </button>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <div className="min-w-[140px] flex-1 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"><span>Published records</span></p>
            <p className="mt-1 text-xl font-black tabular-nums text-slate-900"><span>{Number(data.pagination?.total || 0).toLocaleString()}</span></p>
          </div>
          <div className="min-w-[140px] flex-1 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"><span>Recent batches</span></p>
            <p className="mt-1 text-xl font-black tabular-nums text-slate-900"><span>{imports.length}</span></p>
          </div>
          <div className="min-w-[140px] flex-1 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"><span>Catalogue scope</span></p>
            <p className="mt-1 text-sm font-bold text-slate-900"><span>Shared platform records</span></p>
          </div>
        </div>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs sm:p-4">
        <label className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">
          <span>Find a medicine</span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">⌕</span>
            <input
              aria-label="Search medicine catalogue"
              value={search}
              onChange={event => setSearch(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { setPage(1); setQuery(search.trim()); } }}
              placeholder="Brand, generic, composition or manufacturer…"
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-600/20"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setPage(1); setQuery(search.trim()); }}
              className="min-h-11 flex-1 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 sm:flex-none"
            >
              <span>Search catalogue</span>
            </button>
            <button
              type="button"
              onClick={() => { setSearch(''); setQuery(''); setPage(1); }}
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <span>Reset</span>
            </button>
          </div>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div>
            <strong className="text-xs text-slate-900">Recent enrichment batches</strong>
            <p className="mt-1 text-[11px] text-slate-500">
              <span>Select standalone, unapproved staged or reconciled batches to merge or delete</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={mergeSelectedBatches}
              disabled={mergeBusy || removeBatchesBusy || selectedBatchIds.length < 2 || selectedBatchIds.length > 10}
              className="min-h-11 rounded-lg bg-blue-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-blue-700 disabled:opacity-40"
            >
              <span>{mergeBusy ? 'Merging…' : `Merge selected (${selectedBatchIds.length})`}</span>
            </button>
            <button
              type="button"
              onClick={removeSelectedBatches}
              disabled={removeBatchesBusy || mergeBusy || selectedBatchIds.length < 1}
              className="min-h-11 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-40"
            >
              <span>{removeBatchesBusy ? 'Deleting…' : `Delete selected (${selectedBatchIds.length})`}</span>
            </button>
            <button
              type="button"
              onClick={loadImportHistory}
              disabled={historyLoading || removeBatchesBusy}
              className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <span>{historyLoading ? 'Refreshing…' : 'Refresh history'}</span>
            </button>
          </div>
        </div>

        {imports.length ? (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[740px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Select</th>
                    <th className="p-3">Uploaded file</th>
                    <th className="p-3">Dataset</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Records</th>
                    <th className="p-3">Published</th>
                    <th className="p-3">Approval</th>
                    <th className="p-3">Uploaded</th>
                    <th className="p-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {imports.map(batch => {
                    const effective = batch.isImportJob ? batch.status : getEffectiveBatchState(batch);
                    const badgeMeta = getReconciliationStatusMeta(effective);
                    const selectable = isBatchSelectableForMergeOrDelete(batch);
                    const canReview = isBatchReviewable(batch);
                    const stuckWorker = batch.isImportJob && batch.status === 'PROCESSING' && (
                      batch.leaseExpiresAt
                        ? new Date(batch.leaseExpiresAt).getTime() <= Date.now()
                        : Date.now() - new Date(batch.updatedAt || batch.createdAt || 0).getTime() >= 15 * 60 * 1000
                    );
                    return (
                      <tr key={batch.jobId || batch.batchId}>
                        <td className="p-3">
                          <input
                            type="checkbox"
                            aria-label={`Select batch ${batch.batchId} for merge or removal`}
                            checked={selectedBatchIds.includes(batch.batchId)}
                            disabled={!selectable || mergeBusy || removeBatchesBusy}
                            onChange={event => setSelectedBatchIds(current => event.target.checked ? [...current, batch.batchId].slice(-10) : current.filter(id => id !== batch.batchId))}
                          />
                        </td>
                        <td className="p-3">
                          <strong className="block text-slate-900">{batch.fileName}</strong>
                          <span className="font-mono text-[10px] text-slate-500">{batch.isImportJob ? `Job ${batch.jobId}` : batch.batchId}</span>
                        </td>
                        <td className="p-3 text-slate-600">{batch.dataset || 'Detecting…'}</td>
                        <td className="p-3">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold ${badgeMeta.pillClass}`}>
                            <span>{badgeMeta.label}</span>
                          </span>
                          {batch.isImportJob && batch.status === 'PROCESSING' && (
                            <div className="mt-1 min-w-20">
                              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, Number(batch.progressPercent || 0)))}%` }} />
                              </div>
                              <span className="text-[10px] text-slate-500">{batch.progressPercent || 0}% · {batch.stage}</span>
                            </div>
                          )}
                          {batch.status === 'FAILED' && batch.errorMessage && (
                            <p className="mt-1 max-w-44 text-[10px] text-rose-700">{batch.errorMessage}</p>
                          )}
                        </td>
                        <td className="p-3 tabular-nums text-slate-900">
                          {batch.isImportJob ? `${Number(batch.processedRecords || 0).toLocaleString()} / ${Number(batch.totalRecords || 0).toLocaleString()}` : Number(batch.recordCount || batch.report?.normalizedRecords || 0).toLocaleString()}
                        </td>
                        <td className="p-3 tabular-nums text-slate-900">{Number(batch.publishedCount || 0).toLocaleString()}</td>
                        <td className="p-3">
                          {batch.isImportJob ? '—' : batch.approvedAt ? <span className="font-bold text-emerald-700">Approved</span> : <span className="text-amber-800">Pending</span>}
                        </td>
                        <td className="p-3 text-slate-500">{batch.createdAt ? new Date(batch.createdAt).toLocaleString() : '—'}</td>
                        <td className="p-3">
                          {batch.isImportJob && batch.status === 'FAILED' ? (
                            <button
                              type="button"
                              onClick={() => retryImportJob(batch.jobId)}
                              disabled={batchActionBusy}
                              className="min-h-11 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                            >
                              <span>Retry</span>
                            </button>
                          ) : stuckWorker ? (
                            <button
                              type="button"
                              onClick={() => restartStuckImportJob(batch.jobId)}
                              disabled={batchActionBusy}
                              title="Worker lease expired; safely requeue the retained upload"
                              className="min-h-11 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                            >
                              <span>{batchActionBusy ? 'Restarting…' : 'Restart'}</span>
                            </button>
                          ) : canReview && (
                            <button
                              type="button"
                              onClick={() => openBatchReview(batch.batchId)}
                              disabled={batchActionBusy}
                              className="min-h-11 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                            >
                              <span>{effective === 'CONFLICTS_FOUND' ? 'Resolve' : effective === 'FAILED' ? 'Recover' : 'Review'}</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 p-3 sm:hidden">
              {imports.map(batch => {
                const effective = batch.isImportJob ? batch.status : getEffectiveBatchState(batch);
                const badgeMeta = getReconciliationStatusMeta(effective);
                const selectable = isBatchSelectableForMergeOrDelete(batch) && !mergeBusy && !removeBatchesBusy;
                const canReview = isBatchReviewable(batch);
                const stuckWorker = batch.isImportJob && batch.status === 'PROCESSING' && (
                  batch.leaseExpiresAt
                    ? new Date(batch.leaseExpiresAt).getTime() <= Date.now()
                    : Date.now() - new Date(batch.updatedAt || batch.createdAt || 0).getTime() >= 15 * 60 * 1000
                );
                return (
                  <article key={batch.jobId || batch.batchId} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-bold text-slate-900">{batch.fileName || 'Catalogue import'}</p>
                        <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{batch.isImportJob ? `Job ${batch.jobId}` : batch.batchId}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${badgeMeta.pillClass}`}>
                        <span>{badgeMeta.label}</span>
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
                      <div className="min-w-[110px] flex-1">
                        <span className="text-slate-500">Dataset</span>
                        <p className="mt-0.5 break-words font-semibold text-slate-900">{batch.dataset || 'Detecting…'}</p>
                      </div>
                      <div className="min-w-[110px] flex-1">
                        <span className="text-slate-500">Records</span>
                        <p className="mt-0.5 font-semibold tabular-nums text-slate-900">{batch.isImportJob ? `${Number(batch.processedRecords || 0).toLocaleString()} / ${Number(batch.totalRecords || 0).toLocaleString()}` : Number(batch.recordCount || batch.report?.normalizedRecords || 0).toLocaleString()}</p>
                      </div>
                      <div className="min-w-[110px] flex-1">
                        <span className="text-slate-500">Published</span>
                        <p className="mt-0.5 font-semibold tabular-nums text-slate-900">{Number(batch.publishedCount || 0).toLocaleString()}</p>
                      </div>
                      <div className="min-w-[110px] flex-1">
                        <span className="text-slate-500">Approval</span>
                        <p className="mt-0.5 font-semibold text-slate-900">{batch.isImportJob ? '—' : batch.approvedAt ? 'Approved' : 'Pending'}</p>
                      </div>
                    </div>
                    {batch.isImportJob && batch.status === 'PROCESSING' && (
                      <div className="mt-3">
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, Number(batch.progressPercent || 0)))}%` }} />
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500">{batch.progressPercent || 0}% · {batch.stage}</p>
                      </div>
                    )}
                    {batch.status === 'FAILED' && batch.errorMessage && (
                      <p className="mt-2 break-words text-[10px] text-rose-700">{batch.errorMessage}</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                      {selectable && (
                        <label className="flex min-h-11 items-center gap-2 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            aria-label={`Select batch ${batch.batchId} for merge or removal`}
                            checked={selectedBatchIds.includes(batch.batchId)}
                            onChange={event => setSelectedBatchIds(current => event.target.checked ? [...current, batch.batchId].slice(-10) : current.filter(id => id !== batch.batchId))}
                          />
                          <span>Select</span>
                        </label>
                      )}
                      <div className="ml-auto flex gap-2">
                        {batch.isImportJob && batch.status === 'FAILED' && (
                          <button type="button" onClick={() => retryImportJob(batch.jobId)} disabled={batchActionBusy} className="min-h-11 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-800 disabled:opacity-50">
                            <span>Retry</span>
                          </button>
                        )}
                        {stuckWorker && (
                          <button type="button" onClick={() => restartStuckImportJob(batch.jobId)} disabled={batchActionBusy} className="min-h-11 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-rose-700 disabled:opacity-50">
                            <span>{batchActionBusy ? 'Restarting…' : 'Restart'}</span>
                          </button>
                        )}
                        {canReview && (
                          <button type="button" onClick={() => openBatchReview(batch.batchId)} disabled={batchActionBusy} className="min-h-11 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 disabled:opacity-50">
                            <span>{effective === 'CONFLICTS_FOUND' ? 'Resolve batch' : effective === 'FAILED' ? 'Recover batch' : 'Review batch'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] text-slate-500">{batch.createdAt ? new Date(batch.createdAt).toLocaleString() : 'Upload time unavailable'}</p>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <p className="p-5 text-xs text-slate-500">
            <span>{historyLoading ? 'Loading batch history…' : 'No enrichment batches have been uploaded yet.'}</span>
          </p>
        )}
      </section>

      <MedicineMatchReviewQueue />

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <strong className="text-xs text-slate-900">Published medicines</strong>
          <span className="text-[11px] text-slate-500">{Number(data.pagination?.total || 0).toLocaleString()} records</span>
        </div>
        {loading ? (
          <p className="p-8 text-center text-sm text-slate-500"><span>Loading catalogue…</span></p>
        ) : data.items?.length ? (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Medicine</th>
                    <th className="p-3">Composition</th>
                    <th className="p-3">Strength / form</th>
                    <th className="p-3">Manufacturer</th>
                    <th className="p-3">Quality</th>
                    <th className="p-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map(item => (
                    <tr key={item.medicineId} className="hover:bg-slate-50">
                      <td className="p-3">
                        <strong className="block text-slate-900">{item.brandName}</strong>
                        <span className="font-mono text-[10px] text-slate-500">{item.medicineId}</span>
                      </td>
                      <td className="p-3 text-slate-600">{item.composition || 'Not supplied'}</td>
                      <td className="p-3 text-slate-600">{[item.strength, item.dosageForm].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="p-3 text-slate-600">{item.manufacturer || 'Not supplied'}</td>
                      <td className="p-3">
                        <span className="font-bold text-slate-900">{item.qualityScore ?? 0}%</span>
                        <span className="ml-1 text-slate-500">{item.qualityGrade || item.dataQualityStatus || '—'}</span>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => openRecord(item)} className="min-h-11 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 font-bold text-blue-700 hover:bg-blue-100">
                            <span>View / Edit</span>
                          </button>
                          <button type="button" onClick={() => deleteRecord(item)} disabled={saving} className="min-h-11 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 p-3 sm:hidden">
              {data.items.map(item => (
                <article key={item.medicineId} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words text-sm font-extrabold text-slate-900"><span>{item.brandName}</span></h3>
                      <p className="mt-1 break-all font-mono text-[10px] text-slate-500"><span>{item.medicineId}</span></p>
                    </div>
                    <span className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">
                      <span>{item.qualityScore ?? 0}% quality</span>
                    </span>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-600"><span>{item.composition || 'Composition not supplied'}</span></p>
                  <div className="mt-2 flex flex-wrap gap-3 text-[10px]">
                    <div className="min-w-[110px] flex-1">
                      <span className="text-slate-500">Strength / form</span>
                      <p className="mt-0.5 font-semibold text-slate-900"><span>{[item.strength, item.dosageForm].filter(Boolean).join(' · ') || '—'}</span></p>
                    </div>
                    <div className="min-w-[110px] flex-1">
                      <span className="text-slate-500">Manufacturer</span>
                      <p className="mt-0.5 break-words font-semibold text-slate-900"><span>{item.manufacturer || 'Not supplied'}</span></p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                    <button type="button" onClick={() => openRecord(item)} className="min-h-11 flex-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-extrabold text-blue-700">
                      <span>View / Edit</span>
                    </button>
                    <button type="button" onClick={() => deleteRecord(item)} disabled={saving} className="min-h-11 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                      <span>Delete</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="p-8 text-center text-sm text-slate-500"><span>No published medicine records found.</span></p>
        )}
        <footer className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <span className="text-[11px] text-slate-500">Page {data.pagination?.page || page} of {Math.max(1, data.pagination?.totalPages || 1)}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">
              <span>Previous</span>
            </button>
            <button type="button" disabled={page >= (data.pagination?.totalPages || 1) || loading} onClick={() => setPage(value => value + 1)} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">
              <span>Next</span>
            </button>
          </div>
        </footer>
      </div>

      {reviewBatch && createPortal(
        <div className="catalogue-review-overlay fixed inset-0 z-[125] flex h-[100dvh] items-center justify-center overflow-hidden overscroll-none bg-slate-500/40 p-0 backdrop-blur-sm sm:p-3" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalogue-batch-review-title"
            tabIndex={-1}
            onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setReviewBatch(null); } }}
            className="catalogue-review-dialog mx-auto flex h-[100dvh] max-h-[100dvh] min-h-0 w-full max-w-none shrink-0 flex-col overflow-hidden rounded-none border border-slate-200 bg-white shadow-sm sm:h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-1.5rem)] sm:w-[96vw] sm:max-w-[96vw] sm:rounded-2xl"
          >
            <header className="catalogue-review-header flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="catalogue-batch-review-title" className="font-black text-slate-900">
                    <span>Batch reconciliation review</span>
                  </h3>
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${reviewStatusMeta.pillClass}`}>
                    <span>{reviewStatusMeta.label}</span>
                  </span>
                </div>
                <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
                  <span>{reviewBatch.batchId} · v{reviewBatch.stateVersion || 0}</span>
                </p>
              </div>
              <button
                type="button"
                data-modal-initial-focus
                onClick={() => setReviewBatch(null)}
                aria-label="Close batch reconciliation review"
                className="min-h-11 min-w-11 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200"
              >
                <span>✕</span>
              </button>
            </header>

            <div className="catalogue-review-body min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain touch-pan-y bg-slate-50 p-4 pb-6 sm:p-5" data-modal-scroll>
              <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-3">
                {RECONCILIATION_PIPELINE_STAGES.map((stage, index) => {
                  const isCurrent = reviewPipelineIndex === index && reviewEffectiveState !== 'FAILED';
                  const isCompleted = reviewPipelineIndex > index || reviewEffectiveState === 'PUBLISHED';
                  const chipClass = isCurrent
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : isCompleted
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-slate-50 text-slate-500';
                  return (
                    <div key={stage.key} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${chipClass}`}>
                      <span>{index + 1}.</span>
                      <span>{stage.label}</span>
                    </div>
                  );
                })}
                {reviewEffectiveState === 'FAILED' && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-bold text-rose-700">
                    <span>Failed — Ready for Recovery (FAILED → RECONCILING)</span>
                  </div>
                )}
              </div>

              {reviewBatch.errorMessage && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                  <span>{reviewBatch.errorMessage}</span>
                </div>
              )}

              <div className="catalogue-review-stats flex flex-wrap gap-2">
                {[
                  ['Status', reviewEffectiveState],
                  ['Dataset', reviewBatch.dataset],
                  ['Source rows', reviewBatch.report?.sourceRecords],
                  ['Merged records', reviewBatch.report?.normalizedRecords],
                  ['Exact batch merges', reviewBatch.report?.exactBatchMerges],
                  ['Fuzzy batch merges', reviewBatch.report?.fuzzyBatchMerges],
                  ['Manual review', reviewBatch.report?.fuzzyManualReview],
                  ['Blocking conflicts', reviewBatch.report?.blockingConflicts],
                  ['Update candidates', reviewBatch.report?.updateCandidates]
                ].map(([label, value]) => (
                  <div key={label} className="catalogue-review-stat min-w-[130px] flex-1 rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-[10px] font-bold uppercase text-slate-500"><span>{label}</span></p>
                    <p className="mt-1 text-sm font-black text-slate-900"><span>{value ?? '—'}</span></p>
                  </div>
                ))}
              </div>

              {reviewUnresolvedConflicts.length > 0 && (
                <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-black text-amber-800">
                        <span>Unresolved conflicts ({reviewUnresolvedConflicts.length})</span>
                      </h4>
                      <p className="mt-1 text-[11px] text-amber-800">
                        <span>Resolve conflicts cleanly (`CONFLICTS_FOUND → RESOLVING → RECONCILING`) before approval and publishing.</span>
                      </p>
                    </div>
                    {reviewCanResolveConflicts && (
                      <button
                        type="button"
                        onClick={resolveReviewedBatchConflicts}
                        disabled={batchActionBusy}
                        className="min-h-11 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        <span>{batchActionBusy ? 'Resolving…' : 'Resolve & Re-reconcile'}</span>
                      </button>
                    )}
                  </div>
                  <div className="max-h-56 overflow-y-auto space-y-2">
                    {reviewUnresolvedConflicts.slice(0, 50).map((conflict, index) => {
                      const draftKey = conflict.conflictId || conflict.medicineId || `rev-cnf-${index}`;
                      const targetId = conflict.targetMedicineId || conflict.currentTargetMedicineId || '';
                      return (
                        <div key={draftKey} className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold text-slate-900">{conflict.brandName || conflict.medicineId || conflict.reason}</span>
                              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">{conflict.reason}</span>
                            </div>
                            <p className="text-[11px] text-slate-600">
                              <span>
                                {conflict.medicineId ? `Source: ${conflict.medicineId}` : ''}
                                {targetId ? ` · Candidate: ${targetId}` : ''}
                                {conflict.score ? ` · Score ${conflict.score}%` : ''}
                                {conflict.warnings?.length ? ` · ${conflict.warnings.join(', ')}` : ''}
                              </span>
                            </p>
                          </div>
                          {conflict.medicineId && reviewCanResolveConflicts && (
                            <select
                              aria-label={`Batch conflict action for ${conflict.brandName || conflict.medicineId}`}
                              value={reviewResolutionDrafts[draftKey] || ''}
                              onChange={event => setReviewResolutionDrafts(prev => ({ ...prev, [draftKey]: event.target.value }))}
                              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900"
                            >
                              <option value="">Select resolution…</option>
                              {targetId && <option value="ACCEPT_CANDIDATE">Merge into candidate ({targetId})</option>}
                              <option value="KEEP_SEPARATE">Keep as separate medicine</option>
                              <option value="SKIP_RECORD">Skip staged record</option>
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <div className="catalogue-review-notice rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                <span>Fuzzy auto-merges require matching composition and compatible strength and dosage form. Ambiguous candidates are retained separately for review. Conflicting source identifiers block approval and must be resolved first.</span>
              </div>

              <section className="catalogue-review-records space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                <div className="catalogue-review-record-toolbar flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-black text-slate-900"><span>All staged / merged medicine records</span></h4>
                    <p className="text-[10px] text-slate-500"><span>{Number(reviewRecords.pagination?.total || 0).toLocaleString()} matching records · inspect before approval</span></p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={reviewRecordsSearch}
                      onChange={event => setReviewRecordsSearch(event.target.value)}
                      onKeyDown={event => { if (event.key === 'Enter') loadBatchRecords(reviewBatch.batchId, 1, reviewRecordsSearch); }}
                      placeholder="Search this batch"
                      className="min-h-11 w-44 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-900"
                    />
                    <button type="button" onClick={() => loadBatchRecords(reviewBatch.batchId, 1, reviewRecordsSearch)} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100">
                      <span>Search</span>
                    </button>
                  </div>
                </div>
                {reviewRecordsLoading ? (
                  <p className="p-4 text-center text-xs text-slate-500"><span>Loading staged records…</span></p>
                ) : (
                  <>
                    <div className="catalogue-review-table-wrap hidden overflow-x-auto sm:block">
                      <table className="w-full min-w-[680px] text-left text-[11px]">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="p-2">Medicine</th>
                            <th className="p-2">Composition</th>
                            <th className="p-2">Strength / form</th>
                            <th className="p-2">Manufacturer</th>
                            <th className="p-2">Quality</th>
                            <th className="p-2">Source</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {reviewRecords.items?.map(item => (
                            <tr key={item.medicineId}>
                              <td className="p-2">
                                <strong className="text-slate-900">{item.brandName}</strong>
                                <span className="block font-mono text-[9px] text-slate-500">{item.medicineId}</span>
                              </td>
                              <td className="p-2 text-slate-600">{item.composition || '—'}</td>
                              <td className="p-2 text-slate-600">{[item.strength, item.dosageForm].filter(Boolean).join(' · ') || '—'}</td>
                              <td className="p-2 text-slate-600">{item.manufacturer || '—'}</td>
                              <td className="p-2 text-slate-900">{item.qualityScore ?? 0}% · {item.qualityGrade || '—'}</td>
                              <td className="p-2 text-slate-600">
                                <span>{item.sourceDataset || '—'}</span>
                                <span className="block text-[9px] text-slate-500">{item.sourceRecordId || ''}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="catalogue-review-mobile-list flex flex-col gap-2 sm:hidden">
                      {reviewRecords.items?.map(item => (
                        <article key={item.medicineId} className="rounded-lg border border-slate-200 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="break-words text-xs font-bold text-slate-900"><span>{item.brandName}</span></p>
                              <p className="mt-1 break-all font-mono text-[9px] text-slate-500"><span>{item.medicineId}</span></p>
                            </div>
                            <span className="shrink-0 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">
                              <span>{item.qualityScore ?? 0}%</span>
                            </span>
                          </div>
                          <p className="mt-2 break-words text-xs text-slate-600"><span>{item.composition || 'Composition not supplied'}</span></p>
                          <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                            <div className="min-w-[110px] flex-1">
                              <span className="text-slate-500">Strength / form</span>
                              <p className="mt-0.5 break-words font-semibold text-slate-900"><span>{[item.strength, item.dosageForm].filter(Boolean).join(' · ') || '—'}</span></p>
                            </div>
                            <div className="min-w-[110px] flex-1">
                              <span className="text-slate-500">Manufacturer</span>
                              <p className="mt-0.5 break-words font-semibold text-slate-900"><span>{item.manufacturer || '—'}</span></p>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                    {!reviewRecords.items?.length && <p className="p-4 text-center text-xs text-slate-500"><span>No matching staged records.</span></p>}
                  </>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Page {reviewRecords.pagination?.page || 1} of {Math.max(1, reviewRecords.pagination?.totalPages || 1)}</span>
                  <div className="flex gap-2">
                    <button type="button" disabled={reviewRecordsPage <= 1 || reviewRecordsLoading} onClick={() => loadBatchRecords(reviewBatch.batchId, reviewRecordsPage - 1)} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-40">
                      <span>Previous</span>
                    </button>
                    <button type="button" disabled={reviewRecordsPage >= (reviewRecords.pagination?.totalPages || 1) || reviewRecordsLoading} onClick={() => loadBatchRecords(reviewBatch.batchId, reviewRecordsPage + 1)} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-40">
                      <span>Next</span>
                    </button>
                  </div>
                </div>
              </section>

              {reviewBatch.stateHistory?.length > 0 && (
                <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                  <h4 className="text-xs font-black text-slate-900"><span>State transition history</span></h4>
                  <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                    {reviewBatch.stateHistory.slice(-10).reverse().map((entry, idx) => (
                      <div key={`${entry.at || idx}-${entry.to}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px]">
                        <div className="min-w-0">
                          <span className="font-bold text-slate-900">{entry.from} → {entry.to}</span>
                          {entry.reason && <span className="ml-2 text-slate-600">· {entry.reason}</span>}
                        </div>
                        <span className="text-slate-500">{entry.at ? new Date(entry.at).toLocaleString() : '—'}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {reviewCanApprove && (
                <label className="flex min-h-11 items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-900">
                  <input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4" />
                  <span>I reviewed the batch analytics and approve this exact reconciliation report for publishing.</span>
                </label>
              )}
              {reviewBatch.approvedAt && (
                <p className="text-xs font-semibold text-emerald-700">
                  <span>Approved by {reviewBatch.approvedBy || 'platform administrator'} at {new Date(reviewBatch.approvedAt).toLocaleString()}.</span>
                </p>
              )}
            </div>

            <footer className="catalogue-review-footer flex shrink-0 flex-col-reverse justify-between gap-2 border-t border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={refreshReviewedBatch} disabled={batchActionBusy} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                  <span>Refresh status</span>
                </button>
                {reviewCanReconcile && (
                  <button type="button" onClick={reconcileReviewedBatch} disabled={batchActionBusy} className="min-h-11 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                    <span>{reviewEffectiveState === 'FAILED' ? 'Recover & Re-reconcile' : 'Re-run Reconciliation'}</span>
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {reviewCanApprove && (
                  <button type="button" onClick={approveReviewedBatch} disabled={batchActionBusy || !reviewConfirmed} className="min-h-11 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-blue-700 disabled:opacity-40">
                    <span>{batchActionBusy ? 'Working…' : 'Approve report'}</span>
                  </button>
                )}
                {reviewCanPublish && (
                  <button type="button" onClick={publishReviewedBatch} disabled={batchActionBusy} className="min-h-11 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-blue-700 disabled:opacity-40">
                    <span>{batchActionBusy ? 'Publishing…' : 'Publish to catalogue'}</span>
                  </button>
                )}
              </div>
            </footer>
          </section>
        </div>,
        document.body
      )}

      {selected && createPortal(
        <div className="fixed inset-0 z-[130] flex items-center justify-center overflow-hidden bg-slate-500/40 p-0 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="medicine-master-detail-title" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setSelected(null); setEditing(false); } }}>
          <section className="mx-auto flex h-[100dvh] max-h-[100dvh] min-h-0 w-full max-w-4xl flex-col overflow-hidden border border-slate-200 bg-white shadow-sm sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl">
            <header className="flex items-center justify-between border-b border-slate-200 bg-white p-4 sm:p-5">
              <div>
                <h3 id="medicine-master-detail-title" className="font-black text-slate-900">
                  <span>{editing ? 'Edit medicine master record' : selected.brandName}</span>
                </h3>
                <p className="mt-1 font-mono text-[10px] text-slate-500"><span>{selected.medicineId}</span></p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="min-h-11 min-w-11 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200">
                <span>✕</span>
              </button>
            </header>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50 p-4 sm:p-5" data-modal-scroll>
              {!editing ? (
                <>
                  <div className="flex flex-wrap gap-3">
                    {[...TEXT_FIELDS, ...ARRAY_FIELDS].map(field => (
                      <div key={field} className="min-w-[220px] flex-1 rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-[10px] font-bold uppercase text-slate-500"><span>{LABELS[field]}</span></p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900"><span>{Array.isArray(selected[field]) ? selected[field].join(', ') : selected[field] || 'Not supplied'}</span></p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    <span>Clinical data, suggested alternatives and regulatory status remain source-dependent. Editing does not verify clinical claims. Tenant pricing, stock, batches and expiry are not editable here.</span>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {[...TEXT_FIELDS, ...ARRAY_FIELDS].map(field => (
                    <label key={field} className="min-w-[220px] flex-1 text-xs font-bold text-slate-900">
                      <span>{LABELS[field]}</span>
                      {ARRAY_FIELDS.includes(field) ? (
                        <textarea rows={3} value={form[field]} onChange={event => setForm(value => ({ ...value, [field]: event.target.value }))} placeholder="One value per line" className="mt-1 block w-full rounded-xl border border-slate-300 bg-white p-2.5 font-normal text-slate-900" />
                      ) : (
                        <input value={form[field]} onChange={event => setForm(value => ({ ...value, [field]: event.target.value }))} className="mt-1 block min-h-11 w-full rounded-xl border border-slate-300 bg-white p-2.5 font-normal text-slate-900" />
                      )}
                    </label>
                  ))}
                </div>
              )}
              <div className="border-t border-slate-200 pt-4">
                <h4 className="text-xs font-black text-slate-900"><span>Update history</span></h4>
                {audit.length ? (
                  <div className="mt-2 space-y-2">
                    {audit.map(entry => (
                      <div key={entry._id} className="rounded-xl border border-slate-200 bg-white p-3 text-[11px]">
                        <div className="flex flex-wrap justify-between gap-2">
                          <strong className="text-slate-900">{entry.changedFields?.join(', ')}</strong>
                          <span className="text-slate-500">{new Date(entry.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="mt-1 text-slate-500"><span>Updated by {entry.actorId || 'Platform administrator'}</span></p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500"><span>No manual updates recorded.</span></p>
                )}
              </div>
            </div>
            <footer className="flex shrink-0 flex-col-reverse justify-between gap-2 border-t border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row">
              {editing ? (
                <>
                  <button type="button" onClick={() => setEditing(false)} disabled={saving} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700">
                    <span>Cancel</span>
                  </button>
                  <button type="button" onClick={save} disabled={saving} className="min-h-11 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-blue-700 disabled:opacity-50">
                    <span>{saving ? 'Saving…' : 'Save audited changes'}</span>
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setSelected(null)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700">
                    <span>Close</span>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => deleteRecord(selected)} disabled={saving} className="min-h-11 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                      <span>Delete record</span>
                    </button>
                    <button type="button" onClick={() => setEditing(true)} className="min-h-11 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-blue-700">
                      <span>Edit medicine</span>
                    </button>
                  </div>
                </>
              )}
            </footer>
          </section>
        </div>,document.body
      )}
    </section>
  );
}
