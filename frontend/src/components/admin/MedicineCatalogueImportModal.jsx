import React, { useState } from 'react';
import { getReadableErrorMessage } from '../../utils/errorMessage';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';

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

  if (!isOpen) return null;

  const reset = () => {
    setFile(null);
    setPreview(null);
    setPublished(null);
    setBatchStatus(null);
    setReviewConfirmed(false);
    setJobStatus(null);
    setBusy(false);
  };

  const close = () => { reset(); onClose(); };

  const createPreview = async () => {
    if (!file) return addToast('Choose a JSON dataset first.', 'warning');
    setBusy(true);
    setPreview(null);
    setPublished(null);
    setJobStatus(null);
    setReviewConfirmed(false);
    try {
      const body = new FormData();
      body.append('jsonFile', file);
      const response = await apiClient.post('/api/v1/inventory/catalogue/imports/preview', body, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600000
      });
      const jobId = response.data?.jobId;
      if (!jobId) throw new Error('The server did not return an import job ID.');
      let job;
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const statusResponse = await apiClient.get(`/api/v1/inventory/catalogue/imports/jobs/${encodeURIComponent(jobId)}`);
        job = statusResponse.data;
        setJobStatus(job);
        if (job.status === 'READY' || job.status === 'FAILED') break;
      }
      if (job.status === 'FAILED') throw new Error(job.errorMessage || 'Catalogue processing failed. The uploaded file remains available for an administrator to retry.');
      const completedPreview = {
        batchId: job.batchId, dataset: job.dataset, status: 'READY',
        report: job.report, reportFingerprint: job.reportFingerprint, sample: job.sample
      };
      setPreview(completedPreview);
      const statusResponse = await apiClient.get(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(job.batchId)}`);
      setBatchStatus(statusResponse.data);
      addToast('Background catalogue processing completed. Review the reconciliation report before publishing.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || error.response?.data?.error?.message || error.message || 'Could not analyze this JSON dataset.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const retryFailedJob = async () => {
    if (!jobStatus?.jobId || jobStatus.status !== 'FAILED') return;
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/inventory/catalogue/imports/jobs/${encodeURIComponent(jobStatus.jobId)}/retry`, {});
      let job;
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const response = await apiClient.get(`/api/v1/inventory/catalogue/imports/jobs/${encodeURIComponent(jobStatus.jobId)}`);
        job = response.data;
        setJobStatus(job);
        if (job.status === 'READY' || job.status === 'FAILED') break;
      }
      if (job.status === 'FAILED') throw new Error(job.errorMessage || 'The retry failed. Check the import job details.');
      const completedPreview = { batchId: job.batchId, dataset: job.dataset, status: 'READY', report: job.report, reportFingerprint: job.reportFingerprint, sample: job.sample };
      setPreview(completedPreview);
      const batch = await apiClient.get(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(job.batchId)}`);
      setBatchStatus(batch.data);
      addToast('Catalogue import retry completed. Review the reconciliation report.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || error.message || 'Could not retry this import job.', 'error');
    } finally { setBusy(false); }
  };

  const approveReconciliation = async () => {
    if (!preview?.batchId || !reviewConfirmed || !preview?.reportFingerprint) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(preview.batchId)}/approve`, { confirmReconciliation: true, reportFingerprint: preview.reportFingerprint });
      const statusResponse = await apiClient.get(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(preview.batchId)}`);
      setBatchStatus(statusResponse.data);
      addToast('Reconciliation approved. You can now publish this batch.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || error.response?.data?.error?.message || 'Could not approve this reconciliation report.', 'error');
    } finally { setBusy(false); }
  };
  const publish = async () => {
    if (!preview?.batchId || !batchStatus?.approvedAt) return;
    if (!window.confirm('Publish these cleaned records to the shared medicine master catalogue? This will not update tenant prices, branch stock, batches or expiry data.')) return;
    setBusy(true);
    try {
      const response = await apiClient.post(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(preview.batchId)}/publish`, {});
      setPublished(response.data);
      try {
        const statusResponse = await apiClient.get(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(preview.batchId)}`);
        setBatchStatus(statusResponse.data);
      } catch { /* Publish response remains authoritative if status refresh is temporarily unavailable. */ }
      addToast(response.data.status === 'PUBLISHED' ? 'Medicine catalogue published successfully.' : 'Catalogue import completed with a partial result.', response.data.status === 'PUBLISHED' ? 'success' : 'warning');
    } catch (error) {
      const payload = error.response?.data;
      if (error.response?.status === 409 && payload?.status === 'READY' && payload?.reportFingerprint) {
        setPreview(current => current ? { ...current, report: payload.report || current.report, reportFingerprint: payload.reportFingerprint } : current);
        setBatchStatus(current => ({ ...(current || {}), batchId: payload.batchId || preview.batchId, status: 'READY', report: payload.report, reportFingerprint: payload.reportFingerprint, approvedAt: null, approvedBy: '', errorMessage: payload.message || 'Live reconciliation requires a fresh review.' }));
        setPublished(null);
        setReviewConfirmed(false);
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
      const response = await apiClient.get(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(preview.batchId)}`);
      setBatchStatus(response.data);
      addToast('Import batch status refreshed.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || error.response?.data?.error?.message || 'Could not refresh import batch status.', 'error');
    } finally { setStatusBusy(false); }
  };

  const report = published?.report || preview?.report;
  const metric = (label, value) => (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 min-w-0">
      <div className="text-[10px] uppercase tracking-wide font-bold text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-black text-slate-900 tabular-nums">{typeof value === 'number' ? value.toLocaleString() : (value ?? 0)}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[120] h-[100dvh] w-screen overflow-y-auto overscroll-y-contain bg-slate-950/60 p-0 backdrop-blur-sm sm:h-auto sm:w-auto sm:px-5 sm:py-6" role="dialog" aria-modal="true" aria-labelledby="medicine-catalogue-import-title">
      <section className="mx-auto flex h-full max-h-[100dvh] min-h-0 w-full max-w-5xl flex-col overflow-hidden border-0 bg-white shadow-2xl sm:my-0 sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:rounded-3xl sm:border">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="medicine-catalogue-import-title" className="text-base sm:text-lg font-black text-slate-900">Medicine Master Catalogue Enrichment</h2>
            <p className="mt-1 text-xs text-slate-500">Upload, clean, deduplicate and reconcile a medicine JSON dataset.</p>
          </div>
          <button type="button" onClick={close} disabled={busy} className="shrink-0 rounded-full bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200" aria-label="Close">✕</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4 sm:p-6 space-y-5">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-950">
            Platform-level shared catalogue import. It enriches medicine identity and clinical/product metadata only. Pharmacy selling price, stock, branch, batch, MRP, expiry and manufacturing dates are not imported.
          </div>
          {!published && !preview && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 text-xs text-slate-500">Dataset type is detected automatically from the uploaded JSON structure.</div>
              <label className="block text-xs font-bold text-slate-700">
                JSON file (max 110 MB)
                <input type="file" accept=".json,application/json" disabled={busy || Boolean(preview)} onChange={event => setFile(event.target.files?.[0] || null)} className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-white p-2 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:font-bold file:text-blue-700" />
              </label>
            </div>
          )}
          {jobStatus && busy && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-2"><div className="flex items-center justify-between gap-3 text-xs"><strong className="text-blue-950">Background import: {jobStatus.stage || jobStatus.status}</strong><span className="font-bold tabular-nums text-blue-800">{Number(jobStatus.progressPercent || 0)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-blue-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.max(0, Math.min(100, Number(jobStatus.progressPercent || 0)))}%` }} /></div><p className="text-[11px] text-blue-900">{jobStatus.fileName} · {jobStatus.processedRecords ? Number(jobStatus.processedRecords).toLocaleString() : 'Preparing'} / {jobStatus.totalRecords ? Number(jobStatus.totalRecords).toLocaleString() : '—'} records · Job {jobStatus.jobId}</p></div>}
          {jobStatus?.status === 'FAILED' && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">Processing failed: {getReadableErrorMessage(jobStatus.errorMessage, 'Unknown processing error')} · Attempt {jobStatus.attempts || 1}</p>}
          {file && !preview && <p className="text-xs text-slate-500 break-all">Selected: <strong>{file.name}</strong> · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
          {report && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-black text-slate-900">Reconciliation report</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-extrabold text-slate-600">{batchStatus?.status || published?.status || preview?.status}</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Import batch inspection</p><p className="mt-1 break-all font-mono text-[11px] text-slate-700">{preview.batchId}</p></div>
                  <button type="button" onClick={refreshBatchStatus} disabled={statusBusy || busy} className="rounded-lg border border-slate-300 px-3 py-2 text-[11px] font-bold text-slate-700 disabled:opacity-50">{statusBusy ? 'Refreshing…' : 'Refresh status'}</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div><span className="block text-[10px] text-slate-500">Batch status</span><strong>{batchStatus?.status || 'Not loaded'}</strong></div>
                  <div><span className="block text-[10px] text-slate-500">Dataset</span><strong>{batchStatus?.dataset || preview.dataset || 'Auto-detected'}</strong></div>
                  <div><span className="block text-[10px] text-slate-500">File</span><strong className="break-all">{batchStatus?.fileName || file?.name || '—'}</strong></div>
                  <div><span className="block text-[10px] text-slate-500">Published</span><strong>{Number(batchStatus?.publishedCount ?? published?.publishedCount ?? 0).toLocaleString()}</strong></div>
                </div>
                {batchStatus?.errorMessage && <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{getReadableErrorMessage(batchStatus.errorMessage, '')}</p>}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {metric('Source records', report.sourceRecords)}
                {metric('Clean records', report.normalizedRecords)}
                {metric('New medicines', report.newRecords)}
                {metric('Update candidates', report.updateCandidates)}
                {metric('Fuzzy auto-merges', report.fuzzyAutoMerge)}
                {metric('Fuzzy matches to review', report.fuzzyManualReview)}
                {metric('Unmatched records', report.unmatchedRecords)}
                {metric('Duplicates removed', report.duplicatesRemoved)}
                {metric('Rejected rows', report.rejectedRecords)}
                {metric('With composition', report.withComposition)}
                {metric('Ingredient chemistry details', report.withIngredientDetails)}
                {metric('CAS / UNII identifiers', report.withChemicalIdentifiers)}
                {metric('With toxicology metadata', report.withToxicology)}
                {metric('With administration routes', report.withRoutes)}
                {metric('With manufacturer', report.withManufacturer)}
                {metric('With pack size', report.withPackSize)}
                {metric('With side effects', report.withSideEffects)}
                {metric('With uses', report.withUses)}
                {metric('With suggested alternatives', report.withSuggestedAlternatives)}
                {metric('Records with alternatives', report.withAlternatives)}
                {metric('Linked alternative IDs', report.withLinkedAlternativeIds)}
                {metric('Total alternative links', report.totalAlternativeLinks)}
                {metric('With therapeutic class', report.withTherapeuticClass)}
                {metric('With chemical class', report.withChemicalClass)}
                {metric('Habit-forming metadata', report.withHabitFormingMetadata)}
                {metric('Partial records', report.partialRecords)}
                {metric('Missing composition', report.missingComposition)}
                {metric('Missing manufacturer', report.missingManufacturer)}
                {metric('Need review', report.needsReview)}
                {metric('Average quality score', `${report.averageQualityScore || 0}%`)}
                {metric('Excellent quality', report.excellentQualityRecords)}
                {metric('Good quality', report.goodQualityRecords)}
                {metric('Partial quality', report.partialQualityRecords)}
                {metric('Quality needs review', report.needsReviewQualityRecords)}
              </div>
              {report.publishReconciliation && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <h4 className="text-xs font-extrabold text-amber-950">Fresh publish-time reconciliation</h4>
                  <p className="text-[11px] leading-5 text-amber-900">The live master catalogue changed after preview or contains unresolved candidates. Publishing is blocked until the updated report is reviewed and approved.</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div>Checked: <strong>{Number(report.publishReconciliation.checkedRecords || 0).toLocaleString()}</strong></div>
                    <div>Updates: <strong>{Number(report.publishReconciliation.matchedUpdates || 0).toLocaleString()}</strong></div>
                    <div>New inserts: <strong>{Number(report.publishReconciliation.newInserts || 0).toLocaleString()}</strong></div>
                    <div>Manual review: <strong>{Number(report.publishReconciliation.manualReview || 0).toLocaleString()}</strong></div>
                    <div>Clinical conflicts: <strong>{Number(report.publishReconciliation.clinicalConflicts || 0).toLocaleString()}</strong></div>
                    <div>Stale decisions: <strong>{Number(report.publishReconciliation.staleDecisions || 0).toLocaleString()}</strong></div>
                    <div>Blockers: <strong>{Number(report.publishReconciliation.blockerCount || 0).toLocaleString()}</strong></div>
                  </div>
                  {report.publishReconciliation.blockerExamples?.length > 0 && (
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {report.publishReconciliation.blockerExamples.slice(0, 20).map((item, index) => (
                        <div key={item.medicineId || item.targetMedicineId || item.reason + '-' + index} className="rounded-lg bg-white/80 p-2 text-[10px] text-amber-950">
                          <strong>{item.brandName || item.targetMedicineId || item.reason}</strong> · {item.reason}
                          {item.warnings?.length > 0 && <span> · {item.warnings.join(', ')}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs text-violet-950">Reconciliation approval</strong><span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${batchStatus?.approvedAt ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{batchStatus?.approvedAt ? 'Approved' : 'Review required'}</span></div>
                <p className="text-[11px] leading-5 text-violet-950">New medicines: {Number(report.newRecords || 0).toLocaleString()} · Existing-record update candidates: {Number(report.updateCandidates || 0).toLocaleString()} · Rejected rows: {Number(report.rejectedRecords || 0).toLocaleString()}. Publishing applies the staged reconciliation to the shared master catalogue; it does not change tenant prices or branch inventory.</p>
                {!batchStatus?.approvedAt && <label className="flex items-start gap-2 text-[11px] font-semibold text-violet-950"><input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} className="mt-0.5" />I have reviewed the reconciliation totals, duplicate handling, rejected records and clinical-data warnings, and approve this exact report for publication.</label>}
                {batchStatus?.approvedAt && <p className="text-[11px] text-emerald-800">Approved by {batchStatus.approvedBy || 'platform administrator'} at {batchStatus.approvedAt ? new Date(batchStatus.approvedAt).toLocaleString() : '—'}.</p>}
              </div>
              {report.fuzzyMatchExamples?.length > 0 && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 space-y-2">
                  <h4 className="text-xs font-extrabold text-indigo-950">Intelligent reconciliation candidates</h4>
                  <p className="text-[11px] leading-5 text-indigo-900">High-confidence matches are merged into the existing master record. Ambiguous matches remain separate and are listed for manual review. Strength, dosage-form and composition conflicts are never auto-merged.</p>
                  <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-[11px]"><thead><tr className="text-indigo-900"><th className="p-2">Incoming medicine</th><th className="p-2">Existing master ID</th><th className="p-2">Score</th><th className="p-2">Decision</th><th className="p-2">Warnings</th></tr></thead><tbody className="divide-y divide-indigo-100">{report.fuzzyMatchExamples.map((match, index) => <tr key={match.matchedMedicineId + '-' + index}><td className="p-2">{match.incomingMedicine}</td><td className="p-2 font-mono">{match.matchedMedicineId}</td><td className="p-2 font-bold">{match.score}%</td><td className="p-2">{match.decision}</td><td className="p-2">{(match.warnings || []).join(', ') || '—'}</td></tr>)}</tbody></table></div>
                  {report.fuzzyCandidateScanTruncated && <p className="text-[10px] font-semibold text-amber-800">Candidate scan reached its safety cap. Some possible fuzzy matches may require a separate reconciliation pass.</p>}
                </div>
              )}
              {report.qualityIssueCounts && Object.keys(report.qualityIssueCounts).length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                  <h4 className="text-xs font-extrabold text-slate-800">Most common quality gaps</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {Object.entries(report.qualityIssueCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([issue, count]) => (
                      <div key={issue} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px]">
                        <span className="min-w-0 break-words text-slate-600">{issue.replace(/_/g, ' ').toLowerCase()}</span>
                        <strong className="shrink-0 tabular-nums text-slate-900">{Number(count).toLocaleString()}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-950">
                Quality scores measure supplied-field completeness and consistency, not clinical correctness or regulatory approval. Missing fields are reported rather than invented. Clinical uses, side effects, habit-forming flags and suggested alternatives are source-provided and unverified; they are informational, not prescribing guidance. Suggested alternatives are not confirmed therapeutic equivalents. Prescription flags and source licensing remain unverified. Confirm dataset redistribution rights before commercial use. Third-party image URLs are not trusted or served as product images.
              </div>
              {preview?.sample?.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[920px] text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Medicine</th><th className="p-3">Composition</th><th className="p-3">Strength / Form</th><th className="p-3">Therapeutic class</th><th className="p-3">Uses / Side effects</th><th className="p-3">Manufacturer</th><th className="p-3">Quality score</th><th className="p-3">Quality issues</th><th className="p-3">Reconciliation</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.sample.map(item => <tr key={item.medicineId}><td className="p-3 font-bold text-slate-800">{item.brandName}</td><td className="p-3 text-slate-600">{item.composition || 'Not supplied'}</td><td className="p-3 text-slate-600">{[item.strength, item.dosageForm, item.packSize].filter(Boolean).join(' · ') || '—'}</td><td className="p-3 text-slate-600">{item.therapeuticClass || '—'}</td><td className="p-3 text-slate-600">{[...(item.uses || []).slice(0, 2), ...(item.sideEffects || []).slice(0, 2)].join(' · ') || '—'}</td><td className="p-3 text-slate-600">{item.manufacturer || 'Not supplied'}</td><td className="p-3 font-bold tabular-nums">{Number(item.qualityScore || 0)}% · {item.qualityGrade || item.dataQualityStatus}</td><td className="p-3 text-slate-600">{(item.qualityIssues || []).slice(0, 4).join(', ') || 'No detected gaps'}</td><td className="p-3"><strong>{item.reconciliationMatch?.decision || 'NEW RECORD'}</strong>{item.reconciliationMatch && <span className="block text-slate-500">{item.reconciliationMatch.method} · {item.reconciliationMatch.score}% · {item.reconciliationMatch.targetMedicineId}</span>}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              )}
              {published && <p className="text-sm font-bold text-emerald-700">Published {Number(published.publishedCount || 0).toLocaleString()} catalogue records. Status: {published.status}.</p>}
            </div>
          )}
        </div>
        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:justify-between sm:px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={preview ? () => { setPreview(null); setFile(null); setPublished(null); setBatchStatus(null); setReviewConfirmed(false); } : close} disabled={busy} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 disabled:opacity-50">{preview ? 'Choose another dataset' : 'Close'}</button>
          {!preview ? (
            <div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={createPreview} disabled={busy || !file || jobStatus?.status === 'FAILED'} className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? (jobStatus ? `Processing… ${jobStatus.progressPercent || 0}%` : 'Uploading securely…') : 'Upload & Analyze'}</button>{jobStatus?.status === 'FAILED' && <button type="button" onClick={retryFailedJob} disabled={busy} className="rounded-xl bg-amber-600 px-5 py-2.5 text-xs font-extrabold text-white disabled:opacity-50">{busy ? 'Retrying…' : 'Retry failed job'}</button>}</div>
          ) : !published && !batchStatus?.approvedAt ? (
            <button type="button" onClick={approveReconciliation} disabled={busy || !reviewConfirmed || !preview?.reportFingerprint} className="rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-violet-700 disabled:opacity-50">{busy ? 'Approving…' : 'Approve reconciliation'}</button>
          ) : !published ? (
            <button type="button" onClick={publish} disabled={busy || report?.normalizedRecords === 0} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? 'Publishing…' : 'Publish to Shared Catalogue'}</button>
          ) : (
            <button type="button" onClick={close} className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-extrabold text-white">Done</button>
          )}
        </footer>
      </section>
    </div>
  );
}
