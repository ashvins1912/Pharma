import React, { useState } from 'react';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';

const DATASETS = [
  { value: '', label: 'Auto-detect', description: 'Detect the structure from your JSON file.' },
  { value: 'INDIAN_MEDICINE_DATA', label: 'Indian Medicine Dataset', description: 'Object containing a drugDetails array.' },
  { value: 'INDIA_MEDICINES_INFO', label: 'India Medicines Info', description: 'Retail product array with Medicine Name and Composition.' },
  { value: 'MEDICINES_PART_1', label: 'Medicines Part 1', description: 'Clinical detail array with id, name, use0 and sideEffect0 fields.' }
];

const DATASET_SAMPLES = {
  '': `{
  "drugDetails": [
    {
      "brandIdentifier": "BRAND-001",
      "brandName": "Example 500 Tablet",
      "genericName": "Example ingredient",
      "substanceName": "Example ingredient",
      "doseForm": "Tablet",
      "indication": "Example source-provided indication"
    }
  ],
  "count": 1
}`,
  INDIAN_MEDICINE_DATA: `{
  "drugDetails": [
    {
      "brandIdentifier": "BRAND-001",
      "brandName": "Example 500 Tablet",
      "genericIdentifier": "GEN-001",
      "genericName": "Example ingredient",
      "supplierIdentifier": "SUP-001",
      "supplierName": "Example manufacturer",
      "substanceIdentifier": "SUB-001",
      "substanceName": "Example ingredient",
      "doseForm": "Tablet",
      "routeOfAdministrationName": "Oral",
      "indication": "Example source-provided indication",
      "contraIndication": "",
      "interactionWithDrugs": "",
      "alternativeDrugs": []
    }
  ],
  "count": 1
}`,
  INDIA_MEDICINES_INFO: `[
  {
    "Medicine Name": "Example 500 Tablet",
    "Product Name": "Example 500 Tablet - Pack of 10",
    "Composition": "Example ingredient 500 mg",
    "Type of Medicine": "Tablet",
    "Image URL": "",
    "Is Prescription Required?": "Yes",
    "Price": "₹100"
  }
]`,
  MEDICINES_PART_1: `[
  {
    "id": "CLINICAL-001",
    "name": "Example 500 Tablet",
    "use0": "Example source-provided use",
    "sideEffect0": "Example source-provided side effect",
    "substitute0": "Example suggested alternative",
    "Chemical Class": "Example chemical class",
    "Habit Forming": "No",
    "Therapeutic Class": "Example therapeutic class",
    "Action Class": "Example action class"
  }
]`
};

export default function MedicineCatalogueImportModal({ isOpen, onClose }) {
  const { addToast } = useToast();
  const [file, setFile] = useState(null);
  const [dataset, setDataset] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(null);
  const [batchStatus, setBatchStatus] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false);

  if (!isOpen) return null;

  const reset = () => {
    setFile(null);
    setPreview(null);
    setPublished(null);
    setBatchStatus(null);
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
      if (response.data?.batchId) {
        try {
          const statusResponse = await apiClient.get(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(response.data.batchId)}`);
          setBatchStatus(statusResponse.data);
        } catch (statusError) {
          addToast(statusError.response?.data?.message || 'Preview is ready, but batch status could not be loaded. Use Refresh status before publishing.', 'warning');
        }
      }
      addToast('Catalogue dataset analyzed. Review the reconciliation report and batch status before publishing.', 'success');
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
      try {
        const statusResponse = await apiClient.get(`/api/v1/inventory/catalogue/imports/${encodeURIComponent(preview.batchId)}`);
        setBatchStatus(statusResponse.data);
      } catch { /* Publish response remains authoritative if status refresh is temporarily unavailable. */ }
      addToast(response.data.status === 'PUBLISHED' ? 'Medicine catalogue published successfully.' : 'Catalogue import completed with a partial result.', response.data.status === 'PUBLISHED' ? 'success' : 'warning');
    } catch (error) {
      addToast(error.response?.data?.message || error.response?.data?.error?.message || error.message || 'Catalogue publishing failed.', 'error');
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
              <div className="sm:col-span-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700">Dataset format</span>
                  <span className="text-[10px] font-medium text-slate-500">Choose the structure matching your file</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Dataset format">
                  {DATASETS.map(item => (
                    <button key={item.value} type="button" role="radio" aria-checked={dataset === item.value}
                      onClick={() => { setDataset(item.value); setPreview(null); }}
                      disabled={busy || Boolean(preview)}
                      className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${dataset === item.value ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:border-blue-300'}`}>
                      <span className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${dataset === item.value ? 'border-blue-600' : 'border-slate-400'}`}>{dataset === item.value && <span className="h-2 w-2 rounded-full bg-blue-600" />}</span>
                        {item.label}
                      </span>
                      <span className="mt-1 block pl-6 text-[11px] leading-4 text-slate-500">{item.description}</span>
                    </button>
                  ))}
                </div>
                <details className="rounded-xl border border-slate-200 bg-slate-50">
                  <summary className="cursor-pointer px-3 py-2.5 text-xs font-bold text-slate-700">View sample dataset format</summary>
                  <div className="border-t border-slate-200 p-3">
                    <p className="mb-2 text-[11px] leading-4 text-slate-500">Illustrative structure only. Replace the example values with your source records. The importer validates the actual JSON structure and required identifiers.</p>
                    <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] leading-4 text-slate-100"><code>{DATASET_SAMPLES[dataset]}</code></pre>
                  </div>
                </details>
              </div>
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
                {batchStatus?.errorMessage && <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{batchStatus.errorMessage}</p>}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {metric('Source records', report.sourceRecords)}
                {metric('Clean records', report.normalizedRecords)}
                {metric('New medicines', report.newRecords)}
                {metric('Update candidates', report.updateCandidates)}
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
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-950">
                Clinical uses, side effects, habit-forming flags and suggested alternatives are source-provided and unverified; they are informational, not prescribing guidance. Suggested alternatives are not confirmed therapeutic equivalents. Prescription flags and source licensing remain unverified. Confirm dataset redistribution rights before commercial use. Third-party image URLs are not trusted or served as product images.
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
          <button type="button" onClick={preview ? () => { setPreview(null); setFile(null); setPublished(null); setBatchStatus(null); } : close} disabled={busy} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 disabled:opacity-50">{preview ? 'Choose another dataset' : 'Close'}</button>
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
