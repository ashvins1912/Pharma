import React, { useState } from 'react';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';

const DATASETS = [
  { value: '', label: 'Auto-detect JSON format' },
  { value: 'INDIAN_MEDICINE_DATA', label: 'Indian Medicine Dataset (drugDetails)' },
  { value: 'INDIA_MEDICINES_INFO', label: 'India Medicines and Drug Info (retail array)' },
  { value: 'MEDICINES_PART_1', label: 'Medicines Part 1 (50,000 clinical detail records)' }
];

export default function MedicineCatalogueImportModal({ isOpen, onClose }) {
  const { addToast } = useToast();
  const [file, setFile] = useState(null);
  const [dataset, setDataset] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(null);

  if (!isOpen) return null;

  const reset = () => {
    setFile(null);
    setPreview(null);
    setPublished(null);
    setDataset('');
    setBusy(false);
  };

  const close = () => { reset(); onClose(); };

  const createPreview = async () => {
    if (!file) return addToast('Choose a JSON dataset first.', 'warning');
    setBusy(true);
    setPreview(null);
    setPublished(null);
    try {
      const body = new FormData();
      body.append('jsonFile', file);
      if (dataset) body.append('dataset', dataset);
      const response = await apiClient.post('/api/v1/inventory/catalogue/imports/preview', body, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600000
      });
      setPreview(response.data);
      addToast('Catalogue dataset analyzed. Review the reconciliation report before publishing.', 'success');
    } catch (error) {
      addToast(error.response?.data?.message || error.response?.data?.error?.message || error.message || 'Could not analyze this JSON dataset.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!preview?.batchId) return;
    if (!window.confirm('Publish these cleaned records to the shared medicine master catalogue? This will not update tenant prices, branch stock, batches or expiry data.')) return;
    setBusy(true);
    try {
      const response = await apiClient.post(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(preview.batchId)}/publish`, {});
      setPublished(response.data);
      addToast(response.data.status === 'PUBLISHED' ? 'Medicine catalogue published successfully.' : 'Catalogue import completed with a partial result.', response.data.status === 'PUBLISHED' ? 'success' : 'warning');
    } catch (error) {
      addToast(error.response?.data?.message || error.response?.data?.error?.message || error.message || 'Catalogue publishing failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const report = published?.report || preview?.report;
  const metric = (label, value) => (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 min-w-0">
      <div className="text-[10px] uppercase tracking-wide font-bold text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-black text-slate-900 tabular-nums">{Number(value || 0).toLocaleString()}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-2 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="medicine-catalogue-import-title">
      <section className="w-full max-w-4xl max-h-[94dvh] min-h-0 flex flex-col overflow-hidden rounded-2xl sm:rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <header className="shrink-0 flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="medicine-catalogue-import-title" className="text-base sm:text-lg font-black text-slate-900">Medicine Master Catalogue Enrichment</h2>
            <p className="mt-1 text-xs text-slate-500">Upload, clean, deduplicate and reconcile a medicine JSON dataset.</p>
          </div>
          <button type="button" onClick={close} disabled={busy} className="shrink-0 rounded-full bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200" aria-label="Close">✕</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-950">
            Platform-level shared catalogue import. It enriches medicine identity and clinical/product metadata only. Pharmacy selling price, stock, branch, batch, MRP, expiry and manufacturing dates are not imported.
          </div>
          {!published && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs font-bold text-slate-700">
                Dataset format
                <select value={dataset} onChange={event => { setDataset(event.target.value); setPreview(null); }} disabled={busy || Boolean(preview)} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  {DATASETS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-700">
                JSON file (max 110 MB)
                <input type="file" accept=".json,application/json" disabled={busy || Boolean(preview)} onChange={event => setFile(event.target.files?.[0] || null)} className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-white p-2 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:font-bold file:text-blue-700" />
              </label>
            </div>
          )}
          {file && !preview && <p className="text-xs text-slate-500 break-all">Selected: <strong>{file.name}</strong> · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
          {report && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-black text-slate-900">Reconciliation report</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-extrabold text-slate-600">{published?.status || preview?.status}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {metric('Source records', report.sourceRecords)}
                {metric('Clean records', report.normalizedRecords)}
                {metric('New medicines', report.newRecords)}
                {metric('Update candidates', report.updateCandidates)}
                {metric('Duplicates removed', report.duplicatesRemoved)}
                {metric('Rejected rows', report.rejectedRecords)}
                {metric('With composition', report.withComposition)}
                {metric('With manufacturer', report.withManufacturer)}
                {metric('With pack size', report.withPackSize)}
                {metric('With side effects', report.withSideEffects)}
                {metric('With uses', report.withUses)}
                {metric('With suggested alternatives', report.withSuggestedAlternatives)}
                {metric('With therapeutic class', report.withTherapeuticClass)}
                {metric('With chemical class', report.withChemicalClass)}
                {metric('Habit-forming metadata', report.withHabitFormingMetadata)}
                {metric('Partial records', report.partialRecords)}
                {metric('Missing composition', report.missingComposition)}
                {metric('Missing manufacturer', report.missingManufacturer)}
                {metric('Need review', report.needsReview)}
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-950">
                Prescription flags and source licensing remain unverified. Confirm dataset redistribution rights before commercial use. Third-party image URLs are retained only as source references and are not trusted or served as product images. Missing interactions or contraindications do not imply safety.
              </div>
              {preview?.sample?.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[920px] text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Medicine</th><th className="p-3">Composition</th><th className="p-3">Strength / Form</th><th className="p-3">Therapeutic class</th><th className="p-3">Uses / Side effects</th><th className="p-3">Manufacturer</th><th className="p-3">Quality</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.sample.map(item => <tr key={item.medicineId}><td className="p-3 font-bold text-slate-800">{item.brandName}</td><td className="p-3 text-slate-600">{item.composition || 'Not supplied'}</td><td className="p-3 text-slate-600">{[item.strength, item.dosageForm, item.packSize].filter(Boolean).join(' · ') || '—'}</td><td className="p-3 text-slate-600">{item.therapeuticClass || '—'}</td><td className="p-3 text-slate-600">{[...(item.uses || []).slice(0, 2), ...(item.sideEffects || []).slice(0, 2)].join(' · ') || '—'}</td><td className="p-3 text-slate-600">{item.manufacturer || 'Not supplied'}</td><td className="p-3">{item.dataQualityStatus}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              )}
              {published && <p className="text-sm font-bold text-emerald-700">Published {Number(published.publishedCount || 0).toLocaleString()} catalogue records. Status: {published.status}.</p>}
            </div>
          )}
        </div>
        <footer className="shrink-0 flex flex-col-reverse sm:flex-row sm:justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
          <button type="button" onClick={preview ? () => { setPreview(null); setFile(null); setPublished(null); } : close} disabled={busy} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 disabled:opacity-50">{preview ? 'Choose another dataset' : 'Close'}</button>
          {!preview ? (
            <button type="button" onClick={createPreview} disabled={busy || !file} className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Analyzing JSON…' : 'Analyze & Preview'}</button>
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
