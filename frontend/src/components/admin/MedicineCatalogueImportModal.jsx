import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';
import {
  RECONCILIATION_PIPELINE_STAGES,
  createActionIdempotencyKey,
  getEffectiveBatchState,
  getPipelineStageIndex,
  getReconciliationStatusMeta,
  pollImportJobWithBackoff
} from './reconciliationStatus';

export default function MedicineCatalogueImportModal({ isOpen, onClose }) {
  const { addToast } = useToast();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(null);
  const [batchStatus, setBatchStatus] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [jobStatus, setJobStatus] = useState(null);
  const [resolutionDrafts, setResolutionDrafts] = useState({});
  const pollAbortRef = useRef(null);

  useEffect(() => () => {
    pollAbortRef.current?.abort();
  }, []);

  if (!isOpen) return null;

  const stopActivePolling = () => {
    if (pollAbortRef.current) {
      pollAbortRef.current.abort();
      pollAbortRef.current = null;
    }
  };

  const reset = () => {
    stopActivePolling();
    setFile(null);
    setPreview(null);
    setPublished(null);
    setBatchStatus(null);
    setReviewConfirmed(false);
    setJobStatus(null);
    setResolutionDrafts({});
    setBusy(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const fetchBatchDetails = async (batchId) => {
    const response = await apiClient.get(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(batchId)}`);
    setBatchStatus(response.data);
    return response.data;
  };

  const runJobPolling = async (jobId) => {
    stopActivePolling();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    try {
      const job = await pollImportJobWithBackoff({
        jobId,
        signal: controller.signal,
        fetchJob: async (id, signal) => {
          const statusResponse = await apiClient.get(
            `/api/v1/inventory/catalogue/imports/jobs/${encodeURIComponent(id)}`,
            { signal, __skipCoalescing: true }
          );
          return statusResponse.data;
        },
        onUpdate: (latestJob) => setJobStatus(latestJob)
      });
      return job;
    } finally {
      if (pollAbortRef.current === controller) {
        pollAbortRef.current = null;
      }
    }
  };

  const createPreview = async () => {
    if (!file) return addToast('Choose a JSON dataset first.', 'warning');
    setBusy(true);
    setPreview(null);
    setPublished(null);
    setJobStatus(null);
    setReviewConfirmed(false);
    setResolutionDrafts({});
    try {
      const body = new FormData();
      body.append('jsonFile', file);
      const response = await apiClient.post('/api/v1/inventory/catalogue/imports/preview', body, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600000
      });
      const jobId = response.data?.jobId;
      if (!jobId) throw new Error('The server did not return an import job ID.');
      const job = await runJobPolling(jobId);
      if (job.status === 'FAILED') {
        throw new Error(job.errorMessage || 'Catalogue processing failed. The uploaded file remains available for an administrator to retry.');
      }
      const batch = await fetchBatchDetails(job.batchId);
      const completedPreview = {
        batchId: job.batchId,
        dataset: batch?.dataset || job.dataset,
        status: getEffectiveBatchState(batch) || 'AWAITING_APPROVAL',
        report: batch?.report || job.report,
        reportFingerprint: batch?.reportFingerprint || job.reportFingerprint,
        sample: job.sample
      };
      setPreview(completedPreview);
      addToast('Background catalogue processing completed. Review the reconciliation state before approving.', 'success');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      addToast(error.response?.data?.message || error.response?.data?.error?.message || error.message || 'Could not analyze this JSON dataset.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const retryFailedJob = async () => {
    if (!jobStatus?.jobId || jobStatus.status !== 'FAILED') return;
    setBusy(true);
    try {
      await apiClient.post(
        `/api/v1/inventory/catalogue/imports/jobs/${encodeURIComponent(jobStatus.jobId)}/retry`,
        {},
        { headers: { 'Idempotency-Key': createActionIdempotencyKey('retry-job', jobStatus.jobId, jobStatus.attempts || 1) } }
      );
      const job = await runJobPolling(jobStatus.jobId);
      if (job.status === 'FAILED') throw new Error(job.errorMessage || 'The retry failed. Check the import job details.');
      const batch = await fetchBatchDetails(job.batchId);
      setPreview({
        batchId: job.batchId,
        dataset: batch?.dataset || job.dataset,
        status: getEffectiveBatchState(batch) || 'AWAITING_APPROVAL',
        report: batch?.report || job.report,
        reportFingerprint: batch?.reportFingerprint || job.reportFingerprint,
        sample: job.sample
      });
      addToast('Catalogue import retry completed. Review the reconciliation report.', 'success');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      addToast(error.response?.data?.message || error.message || 'Could not retry this import job.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const rerunReconciliation = async () => {
    if (!preview?.batchId) return;
    setBusy(true);
    try {
      const response = await apiClient.post(
        `/api/v1/inventory/catalogue/imports/${encodeURIComponent(preview.batchId)}/reconcile`,
        { reason: 'Administrator triggered reconciliation pass' },
        {
          headers: { 'Idempotency-Key': createActionIdempotencyKey('reconcile', preview.batchId, batchStatus?.stateVersion ?? 0) },
          timeout: 120000
        }
      );
      const updated = response.data;
      setBatchStatus(updated);
      setPreview(current => current ? {
        ...current,
        status: getEffectiveBatchState(updated),
        report: updated.report || current.report,
        reportFingerprint: updated.reportFingerprint || current.reportFingerprint
      } : current);
      setReviewConfirmed(false);
      addToast(
        getEffectiveBatchState(updated) === 'CONFLICTS_FOUND'
          ? 'Reconciliation finished with conflicts requiring resolution.'
          : 'Reconciliation completed cleanly. Ready for approval.',
        getEffectiveBatchState(updated) === 'CONFLICTS_FOUND' ? 'warning' : 'success'
      );
    } catch (error) {
      addToast(error.response?.data?.message || error.response?.data?.error?.message || error.message || 'Could not run reconciliation.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const applyConflictResolutions = async () => {
    if (!preview?.batchId) return;
    const unresolvedConflicts = (batchStatus?.conflicts || []).filter(item => !item?.resolved && item?.medicineId);
    const resolutions = unresolvedConflicts
      .map(conflict => {
        const key = conflict.conflictId || conflict.medicineId;
        const draftAction = resolutionDrafts[key];
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
      return addToast('Choose a resolution action for at least one conflict first.', 'warning');
    }

    setBusy(true);
    try {
      const response = await apiClient.post(
        `/api/v1/inventory/catalogue/imports/${encodeURIComponent(preview.batchId)}/conflicts/resolve`,
        { resolutions, autoReconcile: true },
        {
          headers: { 'Idempotency-Key': createActionIdempotencyKey('resolve', preview.batchId, batchStatus?.stateVersion ?? 0) },
          timeout: 120000
        }
      );
      const updated = response.data;
      setBatchStatus(updated);
      setPreview(current => current ? {
        ...current,
        status: getEffectiveBatchState(updated),
        report: updated.report || current.report,
        reportFingerprint: updated.reportFingerprint || current.reportFingerprint
      } : current);
      setResolutionDrafts({});
      setReviewConfirmed(false);
      addToast(
        getEffectiveBatchState(updated) === 'CONFLICTS_FOUND'
          ? 'Resolutions saved, but remaining conflicts still require review.'
          : 'Conflicts resolved and reconciliation passed. Ready for approval.',
        getEffectiveBatchState(updated) === 'CONFLICTS_FOUND' ? 'warning' : 'success'
      );
    } catch (error) {
      addToast(error.response?.data?.message || error.response?.data?.error?.message || error.message || 'Could not apply conflict resolutions.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const approveReconciliation = async () => {
    if (!preview?.batchId || !reviewConfirmed || !preview?.reportFingerprint) return;
    setBusy(true);
    try {
      const response = await apiClient.post(
        `/api/v1/inventory/catalogue/imports/${encodeURIComponent(preview.batchId)}/approve`,
        { confirmReconciliation: true, reportFingerprint: preview.reportFingerprint },
        { headers: { 'Idempotency-Key': createActionIdempotencyKey('approve', preview.batchId, preview.reportFingerprint) } }
      );
      setBatchStatus(response.data);
      addToast('Reconciliation approved. You can now publish this batch.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || error.response?.data?.error?.message || 'Could not approve this reconciliation report.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    const effective = getEffectiveBatchState(batchStatus || preview);
    if (!preview?.batchId || (!batchStatus?.approvedAt && effective !== 'APPROVED')) return;
    if (!window.confirm('Publish these cleaned records to the shared medicine master catalogue? This will not update tenant prices, branch stock, batches or expiry data.')) return;
    setBusy(true);
    try {
      const response = await apiClient.post(
        `/api/v1/inventory/catalogue/imports/${encodeURIComponent(preview.batchId)}/publish`,
        {},
        {
          headers: { 'Idempotency-Key': createActionIdempotencyKey('publish', preview.batchId, batchStatus?.stateVersion ?? preview.reportFingerprint) },
          timeout: 300000
        }
      );
      setPublished(response.data);
      try {
        await fetchBatchDetails(preview.batchId);
      } catch {
        setBatchStatus(response.data);
      }
      addToast(
        response.data.status === 'PUBLISHED'
          ? 'Medicine catalogue published successfully.'
          : 'Catalogue import completed with a partial result.',
        response.data.status === 'PUBLISHED' ? 'success' : 'warning'
      );
    } catch (error) {
      const payload = error.response?.data;
      if (error.response?.status === 409 && (payload?.status === 'CONFLICTS_FOUND' || payload?.status === 'READY')) {
        setPreview(current => current ? {
          ...current,
          status: payload.canonicalStatus || payload.status,
          report: payload.report || current.report,
          reportFingerprint: payload.reportFingerprint || current.reportFingerprint
        } : current);
        setBatchStatus(current => ({
          ...(current || {}),
          ...payload,
          batchId: payload.batchId || preview.batchId,
          approvedAt: null,
          approvedBy: ''
        }));
        setPublished(null);
        setReviewConfirmed(false);
      } else {
        try {
          await fetchBatchDetails(preview.batchId);
        } catch {
          // Leave existing batch status intact when refresh also fails.
        }
      }
      addToast(payload?.message || payload?.error?.message || error.message || 'Catalogue publishing failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const refreshBatchStatus = async () => {
    if (!preview?.batchId) return;
    setStatusBusy(true);
    try {
      const updated = await fetchBatchDetails(preview.batchId);
      setPreview(current => current ? {
        ...current,
        status: getEffectiveBatchState(updated),
        report: updated.report || current.report,
        reportFingerprint: updated.reportFingerprint || current.reportFingerprint
      } : current);
      addToast('Import batch status refreshed.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || error.response?.data?.error?.message || 'Could not refresh import batch status.', 'error');
    } finally {
      setStatusBusy(false);
    }
  };

  const report = published?.report || batchStatus?.report || preview?.report;
  const effectiveState = getEffectiveBatchState(batchStatus || published || preview);
  const statusMeta = getReconciliationStatusMeta(effectiveState);
  const pipelineIndex = getPipelineStageIndex(effectiveState);
  const unresolvedConflicts = (batchStatus?.conflicts || []).filter(item => !item?.resolved);
  const hasBlockingConflicts = Number(report?.blockingConflicts || 0) > 0 || unresolvedConflicts.length > 0;
  const canResolveConflicts = ['CONFLICTS_FOUND', 'RESOLVING', 'FAILED'].includes(effectiveState) && unresolvedConflicts.some(item => item.medicineId);
  const canReconcile = ['STAGED', 'CONFLICTS_FOUND', 'RECONCILED', 'AWAITING_APPROVAL', 'APPROVED', 'FAILED', 'PARTIALLY_PUBLISHED', 'READY'].includes(effectiveState);
  const canApprove = ['RECONCILED', 'AWAITING_APPROVAL', 'READY'].includes(effectiveState) && !batchStatus?.approvedAt && !hasBlockingConflicts;
  const canPublish = ['APPROVED', 'PARTIALLY_PUBLISHED'].includes(effectiveState) || (effectiveState === 'READY' && Boolean(batchStatus?.approvedAt));

  const metric = (label, value) => (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 min-w-0">
      <div className="text-[10px] uppercase tracking-wide font-bold text-slate-500"><span>{label}</span></div>
      <div className="mt-1 text-xl font-black text-slate-900 tabular-nums"><span>{typeof value === 'number' ? value.toLocaleString() : (value ?? 0)}</span></div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[2147483000] h-[100dvh] w-screen overflow-y-auto overscroll-y-contain bg-slate-500/40 p-0 backdrop-blur-sm sm:px-5 sm:py-6" role="dialog" aria-modal="true" aria-labelledby="medicine-catalogue-import-title">
      <section className="mx-auto flex h-full max-h-[100dvh] min-h-0 w-full max-w-5xl flex-col overflow-hidden border border-slate-200 bg-white shadow-sm sm:my-0 sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:rounded-3xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="medicine-catalogue-import-title" className="text-base sm:text-lg font-black text-slate-900">
              <span>Medicine Master Catalogue Enrichment</span>
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              <span>Upload, clean, deduplicate and reconcile a medicine JSON dataset through the deterministic state machine.</span>
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="min-h-11 min-w-11 shrink-0 rounded-full border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
            aria-label="Close"
          >
            <span>✕</span>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-slate-50 p-4 sm:p-6 space-y-5">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-slate-900">
            <span>Platform-level shared catalogue import. It enriches medicine identity and clinical/product metadata only. Pharmacy selling price, stock, branch, batch, MRP, expiry and manufacturing dates are not imported.</span>
          </div>

          {!published && !preview && (
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-600">
                <span>Dataset type is detected automatically from the uploaded JSON structure.</span>
              </p>
              <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-900">
                <span>JSON file (max 110 MB)</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy || Boolean(preview)}
                  onChange={event => setFile(event.target.files?.[0] || null)}
                  className="min-h-11 w-full rounded-xl border border-slate-300 bg-white p-2 text-xs text-slate-900 file:mr-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:font-bold file:text-blue-700"
                />
              </label>
            </div>
          )}

          {jobStatus && busy && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-bold text-slate-900">Background import: {jobStatus.stage || jobStatus.status}</span>
                <span className="font-bold tabular-nums text-blue-700">{Number(jobStatus.progressPercent || 0)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white border border-blue-200">
                <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.max(0, Math.min(100, Number(jobStatus.progressPercent || 0)))}%` }} />
              </div>
              <p className="text-[11px] text-slate-600">
                <span>{jobStatus.fileName} · {jobStatus.processedRecords ? Number(jobStatus.processedRecords).toLocaleString() : 'Preparing'} / {jobStatus.totalRecords ? Number(jobStatus.totalRecords).toLocaleString() : '—'} records · Job {jobStatus.jobId}</span>
              </p>
            </div>
          )}

          {jobStatus?.status === 'FAILED' && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <span>Processing failed: {jobStatus.errorMessage || 'Unknown processing error'} · Attempt {jobStatus.attempts || 1}</span>
            </p>
          )}

          {file && !preview && (
            <p className="text-xs text-slate-600 break-all">
              <span>Selected: <strong>{file.name}</strong> · {(file.size / 1024 / 1024).toFixed(2)} MB</span>
            </p>
          )}

          {report && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-black text-slate-900">
                  <span>Reconciliation state & report</span>
                </h3>
                <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold ${statusMeta.pillClass}`}>
                  <span>{statusMeta.label}</span>
                </span>
              </div>

              <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-3">
                {RECONCILIATION_PIPELINE_STAGES.map((stage, index) => {
                  const isCurrent = pipelineIndex === index && effectiveState !== 'FAILED';
                  const isCompleted = pipelineIndex > index || effectiveState === 'PUBLISHED';
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
                {effectiveState === 'FAILED' && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-bold text-rose-700">
                    <span>Failed — Ready for Recovery (FAILED → RECONCILING)</span>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      <span>Import batch inspection</span>
                    </p>
                    <p className="mt-1 break-all font-mono text-[11px] text-slate-600">
                      <span>{preview.batchId}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canReconcile && (
                      <button
                        type="button"
                        onClick={rerunReconciliation}
                        disabled={busy || statusBusy}
                        className="min-h-11 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
                      >
                        <span>{effectiveState === 'FAILED' ? 'Recover & Re-reconcile' : 'Re-run Reconciliation'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={refreshBatchStatus}
                      disabled={statusBusy || busy}
                      className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
                    >
                      <span>{statusBusy ? 'Refreshing…' : 'Refresh status'}</span>
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-xs">
                  <div className="min-w-[120px] flex-1">
                    <span className="block text-[10px] text-slate-500">Batch status</span>
                    <span className="font-bold text-slate-900">{effectiveState || 'Not loaded'}</span>
                  </div>
                  <div className="min-w-[120px] flex-1">
                    <span className="block text-[10px] text-slate-500">Dataset</span>
                    <span className="font-bold text-slate-900">{batchStatus?.dataset || preview.dataset || 'Auto-detected'}</span>
                  </div>
                  <div className="min-w-[140px] flex-1">
                    <span className="block text-[10px] text-slate-500">File</span>
                    <span className="font-bold break-all text-slate-900">{batchStatus?.fileName || file?.name || '—'}</span>
                  </div>
                  <div className="min-w-[100px] flex-1">
                    <span className="block text-[10px] text-slate-500">Published</span>
                    <span className="font-bold tabular-nums text-slate-900">{Number(batchStatus?.publishedCount ?? published?.publishedCount ?? 0).toLocaleString()}</span>
                  </div>
                </div>
                {batchStatus?.errorMessage && (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
                    <span>{batchStatus.errorMessage}</span>
                  </p>
                )}
              </div>

              {unresolvedConflicts.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-extrabold text-amber-800">
                        <span>Conflict Resolution Loop ({unresolvedConflicts.length} unresolved)</span>
                      </h4>
                      <p className="mt-1 text-[11px] text-amber-800">
                        <span>Choose how each conflicting or ambiguous medicine should be handled (`CONFLICTS_FOUND → RESOLVING → RECONCILING`).</span>
                      </p>
                    </div>
                    {canResolveConflicts && (
                      <button
                        type="button"
                        onClick={applyConflictResolutions}
                        disabled={busy || statusBusy}
                        className="min-h-11 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
                      >
                        <span>Apply Resolutions & Re-reconcile</span>
                      </button>
                    )}
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-2">
                    {unresolvedConflicts.slice(0, 50).map((conflict, index) => {
                      const draftKey = conflict.conflictId || conflict.medicineId || `conflict-${index}`;
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
                          {conflict.medicineId && canResolveConflicts && (
                            <div className="shrink-0">
                              <select
                                aria-label={`Resolution action for ${conflict.brandName || conflict.medicineId}`}
                                value={resolutionDrafts[draftKey] || ''}
                                onChange={event => setResolutionDrafts(prev => ({ ...prev, [draftKey]: event.target.value }))}
                                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                              >
                                <option value="">Select resolution…</option>
                                {targetId && <option value="ACCEPT_CANDIDATE">Merge into candidate ({targetId})</option>}
                                <option value="KEEP_SEPARATE">Keep as separate medicine</option>
                                <option value="SKIP_RECORD">Skip staged record</option>
                              </select>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <div className="min-w-[140px] flex-1">{metric('Source records', report.sourceRecords)}</div>
                <div className="min-w-[140px] flex-1">{metric('Clean records', report.normalizedRecords)}</div>
                <div className="min-w-[140px] flex-1">{metric('New medicines', report.newRecords)}</div>
                <div className="min-w-[140px] flex-1">{metric('Update candidates', report.updateCandidates)}</div>
                <div className="min-w-[140px] flex-1">{metric('Fuzzy auto-merges', report.fuzzyAutoMerge)}</div>
                <div className="min-w-[140px] flex-1">{metric('Fuzzy matches to review', report.fuzzyManualReview)}</div>
                <div className="min-w-[140px] flex-1">{metric('Blocking conflicts', report.blockingConflicts)}</div>
                <div className="min-w-[140px] flex-1">{metric('Duplicates removed', report.duplicatesRemoved)}</div>
                <div className="min-w-[140px] flex-1">{metric('Rejected rows', report.rejectedRecords)}</div>
                <div className="min-w-[140px] flex-1">{metric('Average quality score', `${report.averageQualityScore || 0}%`)}</div>
              </div>

              {report.publishReconciliation && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <h4 className="text-xs font-extrabold text-amber-800">
                    <span>Fresh live reconciliation summary</span>
                  </h4>
                  <div className="flex flex-wrap gap-3 text-[11px] text-amber-800">
                    <span>Checked: <strong>{Number(report.publishReconciliation.checkedRecords || 0).toLocaleString()}</strong></span>
                    <span>Updates: <strong>{Number(report.publishReconciliation.matchedUpdates || 0).toLocaleString()}</strong></span>
                    <span>New inserts: <strong>{Number(report.publishReconciliation.newInserts || 0).toLocaleString()}</strong></span>
                    <span>Skipped: <strong>{Number(report.publishReconciliation.skippedRecords || 0).toLocaleString()}</strong></span>
                    <span>Manual review: <strong>{Number(report.publishReconciliation.manualReview || 0).toLocaleString()}</strong></span>
                    <span>Clinical conflicts: <strong>{Number(report.publishReconciliation.clinicalConflicts || 0).toLocaleString()}</strong></span>
                    <span>Blockers: <strong>{Number(report.publishReconciliation.blockerCount || 0).toLocaleString()}</strong></span>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-xs text-slate-900">Reconciliation approval</strong>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${batchStatus?.approvedAt ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-amber-200 bg-amber-50 text-amber-800'}`}>
                    <span>{batchStatus?.approvedAt ? 'Approved' : 'Review required'}</span>
                  </span>
                </div>
                <p className="text-[11px] leading-5 text-slate-600">
                  <span>New medicines: {Number(report.newRecords || 0).toLocaleString()} · Existing-record update candidates: {Number(report.updateCandidates || 0).toLocaleString()} · Rejected rows: {Number(report.rejectedRecords || 0).toLocaleString()}. Publishing applies the staged reconciliation to the shared master catalogue; it does not change tenant prices or branch inventory.</span>
                </p>
                {canApprove && (
                  <label className="flex min-h-11 items-start gap-2.5 text-xs font-semibold text-slate-900 pt-1">
                    <input
                      type="checkbox"
                      checked={reviewConfirmed}
                      onChange={event => setReviewConfirmed(event.target.checked)}
                      className="mt-1 h-4 w-4"
                    />
                    <span>I have reviewed the reconciliation totals, conflict resolutions, duplicate handling, rejected records and clinical-data warnings, and approve this exact report for publication.</span>
                  </label>
                )}
                {batchStatus?.approvedAt && (
                  <p className="text-[11px] font-semibold text-emerald-700">
                    <span>Approved by {batchStatus.approvedBy || 'platform administrator'} at {new Date(batchStatus.approvedAt).toLocaleString()}.</span>
                  </p>
                )}
              </div>

              {preview?.sample?.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                      <tr>
                        <th className="p-3">Medicine</th>
                        <th className="p-3">Composition</th>
                        <th className="p-3">Strength / Form</th>
                        <th className="p-3">Manufacturer</th>
                        <th className="p-3">Quality score</th>
                        <th className="p-3">Reconciliation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.sample.map(item => (
                        <tr key={item.medicineId}>
                          <td className="p-3 font-bold text-slate-900">{item.brandName}</td>
                          <td className="p-3 text-slate-600">{item.composition || 'Not supplied'}</td>
                          <td className="p-3 text-slate-600">{[item.strength, item.dosageForm, item.packSize].filter(Boolean).join(' · ') || '—'}</td>
                          <td className="p-3 text-slate-600">{item.manufacturer || 'Not supplied'}</td>
                          <td className="p-3 font-bold tabular-nums text-slate-900">{Number(item.qualityScore || 0)}% · {item.qualityGrade || item.dataQualityStatus}</td>
                          <td className="p-3 text-slate-900">
                            <strong>{item.reconciliationMatch?.decision || 'NEW RECORD'}</strong>
                            {item.reconciliationMatch && (
                              <span className="block text-slate-500">{item.reconciliationMatch.method} · {item.reconciliationMatch.score}% · {item.reconciliationMatch.targetMedicineId}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {published && (
                <p className="text-sm font-bold text-emerald-700">
                  <span>Published {Number(published.publishedCount || 0).toLocaleString()} catalogue records. Status: {published.status}.</span>
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:justify-between sm:px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={preview ? () => { reset(); } : close}
            disabled={busy}
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <span>{preview ? 'Choose another dataset' : 'Close'}</span>
          </button>
          {!preview ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={createPreview}
                disabled={busy || !file || jobStatus?.status === 'FAILED'}
                className="min-h-11 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
              >
                <span>{busy ? (jobStatus ? `Processing… ${jobStatus.progressPercent || 0}%` : 'Uploading securely…') : 'Upload & Analyze'}</span>
              </button>
              {jobStatus?.status === 'FAILED' && (
                <button
                  type="button"
                  onClick={retryFailedJob}
                  disabled={busy}
                  className="min-h-11 rounded-xl border border-amber-200 bg-amber-50 px-5 py-2.5 text-xs font-extrabold text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  <span>{busy ? 'Retrying…' : 'Retry failed job'}</span>
                </button>
              )}
            </div>
          ) : canApprove ? (
            <button
              type="button"
              onClick={approveReconciliation}
              disabled={busy || !reviewConfirmed || !preview?.reportFingerprint}
              className="min-h-11 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              <span>{busy ? 'Approving…' : 'Approve reconciliation'}</span>
            </button>
          ) : canPublish && !published ? (
            <button
              type="button"
              onClick={publish}
              disabled={busy || report?.normalizedRecords === 0}
              className="min-h-11 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              <span>{busy ? 'Publishing…' : 'Publish to Shared Catalogue'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={close}
              className="min-h-11 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <span>Done</span>
            </button>
          )}
        </footer>
      </section>
    </div>,
  document.body
  );
}
