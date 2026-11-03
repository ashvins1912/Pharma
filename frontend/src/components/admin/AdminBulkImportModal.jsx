import React, { useEffect, useState } from 'react';
import * as xlsx from 'xlsx';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';

export default function AdminBulkImportModal({ isOpen, onClose }) {
  const { t } = useLanguage();
  const { addToast } = useToast();
  const { fetchMedicines } = useApp();
  const { isSuperAdmin, isTenantAdmin, user } = useAuth();
  const needsBranchSelection = Boolean(isTenantAdmin && !(user?.branchId || user?.app_metadata?.branchId));
  const [targetTenantId, setTargetTenantId] = useState(() => typeof window !== 'undefined' ? (localStorage.getItem('pharma_import_target_tenant_id') || localStorage.getItem('pharma_tenant_id') || '') : '');
  const [targetBranchId, setTargetBranchId] = useState(() => typeof window !== 'undefined' ? (localStorage.getItem('pharma_import_target_branch_id') || localStorage.getItem('pharma_branch_id') || '') : '');
  const getImportScopeHeaders = () => isSuperAdmin
    ? { 'X-Tenant-Id': targetTenantId.trim(), 'X-Branch-Id': targetBranchId.trim() }
    : needsBranchSelection ? { 'X-Branch-Id': targetBranchId.trim() } : {};

  const [file, setFile] = useState(null);
  const [stockMode, setStockMode] = useState('REPLACE');
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [importJob, setImportJob] = useState(null);
  const [pollError, setPollError] = useState('');

  // Status Polling for active import jobs
  useEffect(() => {
    if (pollError || !importJob?.jobId || !['QUEUED', 'PROCESSING'].includes(importJob.status)) return undefined;
    let cancelled = false;

    const pollStatus = async () => {
      try {
        const response = await apiClient.get(`/api/v1/inventory/imports/${importJob.jobId}`, { headers: getImportScopeHeaders() });
        if (cancelled) return;
        setPollError('');
        setImportJob(response.data);
        if (['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(response.data.status)) {
          fetchMedicines();
          addToast(
            response.data.status === 'COMPLETED'
              ? 'Bulk inventory import completed successfully!'
              : t('importCompletedPartial'),
            response.data.status === 'COMPLETED' ? 'success' : 'warning'
          );
        }
      } catch (error) {
        if (!cancelled) setPollError(error.response?.data?.message || t('couldNotRefreshImport'));
      }
    };

    void pollStatus();
    const timer = window.setInterval(pollStatus, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [importJob?.jobId, importJob?.status, fetchMedicines, addToast, pollError, isSuperAdmin, targetTenantId, targetBranchId]);

  if (!isOpen) return null;

  // Single-Upload Architecture: Read workbook locally in browser for instant preview
  const handleFileChange = async (selectedFile) => {
    if (!selectedFile) return;
    if (!/\.(xlsx|xls)$/i.test(selectedFile.name)) { addToast(t('selectWorkbook'), 'warning'); return; }
    if ((isSuperAdmin && (!targetTenantId.trim() || !targetBranchId.trim())) || (needsBranchSelection && !targetBranchId.trim())) {
      addToast(t('selectTenantBranch'), 'warning');
      return;
    }
    setFile(selectedFile); setAnalyzing(true); setPreviewData(null); setImportJob(null); setPollError('');
    try {
      const formData = new FormData(); formData.append('excelFile', selectedFile);
      const response = await apiClient.post('/api/v1/inventory/imports/preview', formData, { headers: { 'Content-Type': 'multipart/form-data', ...getImportScopeHeaders() } });
      setPreviewData(response.data);
      addToast('Server validated ' + response.data.rowsDetected + ' rows (' + response.data.validCount + ' valid)', 'info');
    } catch (error) {
      setFile(null); addToast(error.response?.data?.message || error.message || 'Server-side validation failed.', 'error');
    } finally { setAnalyzing(false); }
  };
  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  // Authoritative Single Upload to /api/v1/inventory/imports with unique Idempotency-Key
  const handleConfirmImport = async () => {
    if ((isSuperAdmin && (!targetTenantId.trim() || !targetBranchId.trim())) || (needsBranchSelection && !targetBranchId.trim())) {
      addToast(t('selectTenantBranchImport'), 'warning');
      return;
    }
    if (!previewData?.importsEnabled) {
      addToast(t('inventoryWritesDisabled'), 'warning');
      return;
    }
    if (!previewData || previewData.rowsDetected === 0 || !file) {
      addToast(t('noRecordsToImport'), 'warning');
      return;
    }

    setCommitting(true);
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.()
        || `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

      const formData = new FormData();
      formData.append('excelFile', file);
      formData.append('stockMode', stockMode);
      formData.append('previewFingerprint', previewData.previewFingerprint);
      formData.append('confirmImport', 'true');

      const res = await apiClient.post('/api/v1/inventory/imports', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Idempotency-Key': idempotencyKey,
          ...getImportScopeHeaders()
        }
      });

      setImportJob(res.data);
      addToast(t('importQueued'), 'info');
    } catch (err) {
      addToast(err.response?.data?.message || err.message || t('importStartFailed'), 'error');
    } finally {
      setCommitting(false);
    }
  };

  const rollbackImport = async () => {
    if (!importJob?.batchId) return;
    if ((isSuperAdmin && (!targetTenantId.trim() || !targetBranchId.trim())) || (needsBranchSelection && !targetBranchId.trim())) {
      addToast(t('selectOriginalScopeRollback'), 'warning');
      return;
    }
    if (!window.confirm(`Revert inventory changes from batch ${importJob.batchId}? This is allowed only if affected stock and catalogue records have not changed since import.`)) return;
    try {
      const response = await apiClient.post(`/api/v1/inventory/imports/batches/${importJob.batchId}/rollback`, {}, { headers: getImportScopeHeaders() });
      setImportJob(previous => ({ ...previous, status: response.data.status, revertedAt: response.data.revertedAt }));
      fetchMedicines();
      addToast(t('batchReverted'), 'success');
    } catch (error) {
      addToast(error.response?.data?.message || t('rollbackBlocked'), 'error');
    }
  };

  // Download Row-Level Failure Excel Workbook from Inventory Service
  const downloadFailedRows = async () => {
    if (!importJob?.jobId) return;
    try {
      const response = await apiClient.get(
        `/api/v1/inventory/imports/${importJob.jobId}/failures/download`,
        { responseType: 'blob', headers: getImportScopeHeaders() }
      );
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Failed_Inventory_Import_${importJob.jobId}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      addToast(error.response?.data?.message || t('failedRecordsDownload'), 'error');
    }
  };

  // Retry Transient Failures via Inventory Service with a new Idempotency-Key
  const retryImport = async () => {
    if (!importJob?.jobId) return;
    try {
      const retryKey = globalThis.crypto?.randomUUID?.()
        || `retry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

      const response = await apiClient.post(
        `/api/v1/inventory/imports/${importJob.jobId}/retry`,
        {},
        {
          headers: {
            'Idempotency-Key': retryKey,
            ...getImportScopeHeaders()
          }
        }
      );
      setImportJob(previous => ({ ...previous, ...response.data, status: 'QUEUED' }));
      addToast(t('importRetryQueued'), 'info');
    } catch (error) {
      addToast(error.response?.data?.message || t('importRetryFailed'), 'error');
    }
  };

  const downloadSampleTemplate = async () => {
    const sampleRows = [
      {
        SKU: "TEST-MED-001",
        "Medicine Name": "Synthetic Test Medicine Alpha",
        Category: "IMPORT TEST DATA",
        Description: "Synthetic record for controlled inventory import verification only.",
        Price: 10,
        Stock: 5,
        "Base Cost Price": 6,
        "Margin Tier": "LOW",
        "Expiry Date": "2030-12-31",
        "Batch Number": "TEST-LOT-A",
        "Requires Prescription": "false",
        Manufacturer: "Synthetic Test Supplier"
      },
      {
        SKU: "TEST-MED-001",
        "Medicine Name": "Synthetic Test Medicine Alpha",
        Category: "IMPORT TEST DATA",
        Description: "Second synthetic batch for the same SKU.",
        Price: 11,
        Stock: 7,
        "Base Cost Price": 6,
        "Margin Tier": "LOW",
        "Expiry Date": "2031-06-30",
        "Batch Number": "TEST-LOT-B",
        "Requires Prescription": "false",
        Manufacturer: "Synthetic Test Supplier"
      },
      {
        SKU: "TEST-MED-002",
        "Medicine Name": "Synthetic Test Medicine Beta",
        Category: "IMPORT TEST DATA",
        Description: "Synthetic record for controlled rollback verification.",
        Price: 15,
        Stock: 3,
        "Base Cost Price": 8,
        "Margin Tier": "MID",
        "Expiry Date": "2030-09-30",
        "Batch Number": "TEST-LOT-C",
        "Requires Prescription": "false",
        Manufacturer: "Synthetic Test Supplier"
      }
    ];

    try {
      const ws = xlsx.utils.json_to_sheet(sampleRows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, "Inventory");
      xlsx.writeFile(wb, "Pharma_Controlled_Test_Inventory_Template.xlsx");
      addToast("Synthetic controlled-test template downloaded. Do not use it for live inventory.", "success");
    } catch (error) {
      console.error('Sample inventory workbook generation failed:', error);
      addToast(t('sampleTemplateFailed'), 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-[2px] animate-fade-in overscroll-none" aria-modal="true" role="dialog">
      <div className="w-full max-w-3xl h-[88dvh] sm:h-[90dvh] max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] min-h-0 flex flex-col bg-white border border-slate-200 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden relative mt-auto sm:my-auto overscroll-contain">
        
        {/* Sticky Header */}
        <div className="shrink-0 p-4 sm:p-6 pb-3.5 border-b border-slate-100 bg-white flex justify-between items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl shrink-0">📥</span>
              <h2 className="min-w-0 break-words text-base sm:text-lg font-black text-slate-900 truncate">
                Bulk Inventory Excel Ingestion
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              Multi-tenant isolated background processing with row-level error reporting.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 transition cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 overscroll-contain">
          {!isSuperAdmin && needsBranchSelection && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 space-y-2">
              <p className="text-xs font-extrabold text-sky-950">{t('selectPharmacyBranch')}</p>
              <p className="text-[11px] text-sky-800">{t('signedTenantIdentity')}</p>
              <input
                value={targetBranchId}
                onChange={event => {
                  setTargetBranchId(event.target.value);
                  localStorage.setItem('pharma_import_target_branch_id', event.target.value);
                  setPreviewData(null);
                }}
                placeholder={t("branchId")}
                disabled={Boolean(importJob)}
                className="w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs"
              />
            </div>
          )}
          {isSuperAdmin && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 space-y-2">
              <p className="text-xs font-extrabold text-sky-950">{t('platformImportTarget')}</p>
              <p className="text-[11px] text-sky-800">{t('targetTenantBranchHelp')}</p>
              <input
                value={targetTenantId}
                onChange={event => {
                  setTargetTenantId(event.target.value);
                  localStorage.setItem('pharma_import_target_tenant_id', event.target.value);
                  setPreviewData(null);
                }}
                placeholder={t("targetTenantId")}
                disabled={Boolean(importJob)}
                className="w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs"
              />
              <input
                value={targetBranchId}
                onChange={event => {
                  setTargetBranchId(event.target.value);
                  localStorage.setItem('pharma_import_target_branch_id', event.target.value);
                  setPreviewData(null);
                }}
                placeholder={t("branchId")}
                disabled={Boolean(importJob)}
                className="w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs"
              />
            </div>
          )}
          {/* Upload Zone */}
          {!previewData && (
          <div className="py-6 space-y-4">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-3xl p-4 sm:p-12 text-center transition bg-slate-50/50 hover:bg-blue-50/30 flex flex-col items-center justify-center space-y-3 cursor-pointer"
              onClick={() => document.getElementById('excel-file-input').click()}
            >
              <div className="w-16 h-16 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center text-3xl">
                📊
              </div>
              <div>
                <h3 className="font-extrabold text-slate-900 text-sm">
                  Drag & Drop your .xlsx spreadsheet here
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Server-side read-only preview, explicit confirmation and reversible batch tracking
                </p>
              </div>

              <input
                id="excel-file-input"
                type="file"
                accept=".xlsx, .xls"
                className="hidden"
                onChange={(e) => handleFileChange(e.target.files?.[0])}
              />

              <button
                type="button"
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-md shadow-blue-600/20 cursor-pointer"
              >
                {analyzing ? 'Analyzing Spreadsheet...' : 'Choose Excel File (.xlsx)'}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs text-slate-500 pt-2">
              <span className="break-words">{t('requiredColumns')}</span>
              <button
                type="button"
                onClick={downloadSampleTemplate}
                className="text-blue-600 font-extrabold hover:underline cursor-pointer"
              >
                📥 Download Sample Template (.xlsx)
              </button>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
              <label htmlFor="inventory-stock-mode" className="block text-xs font-bold text-amber-900">{t('stockUpdateBehaviour')}</label>
              <select id="inventory-stock-mode" value={stockMode} onChange={event => setStockMode(event.target.value)} className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-800">
                <option value="REPLACE">{t('replaceBatchQuantity')}</option>
              </select>
              <p className="text-[11px] text-amber-900">{t('inventoryImportRules')}</p>
            </div>
          </div>
        )}

        {/* Preview & Validation Report */}
        {previewData && (
          <div className="py-4 space-y-4 animate-fade-in">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
              <p className="font-bold text-slate-800">{t('targetInventoryScope')}</p>
              <p className="break-all text-slate-600">{t('tenantAdmin')} : <strong>{previewData.tenantId || 'Missing'}</strong></p>
              <p className="break-all text-slate-600">{t('branchId')}: <strong>{previewData.branchId || 'Missing'}</strong></p>
            </div>
            {!previewData.importsEnabled && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                Production inventory writes are disabled. You can review this preview, but no stock will be changed.
              </div>
            )}
            {/* Metric Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="bg-slate-50 border border-slate-200 p-3 rounded-2xl text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">{t('totalRows')}</span>
                <span className="text-lg font-black text-slate-900">{previewData.rowsDetected}</span>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-2xl text-center">
                <span className="text-[10px] font-bold text-emerald-700 uppercase block">{t('valid')}</span>
                <span className="text-lg font-black text-emerald-800">{previewData.validCount}</span>
              </div>
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-2xl text-center">
                <span className="text-[10px] font-bold text-amber-700 uppercase block">{t('warnings')}</span>
                <span className="text-lg font-black text-amber-800">{previewData.warningsCount}</span>
              </div>
              <div className="bg-rose-50 border border-rose-200 p-3 rounded-2xl text-center">
                <span className="text-[10px] font-bold text-rose-700 uppercase block">{t('errors')}</span>
                <span className="text-lg font-black text-rose-800">{previewData.errorsCount}</span>
              </div>
            </div>

            {/* Active Import Job Progress Banner */}
            {importJob && (
              <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-3" aria-live="polite">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-black text-slate-900">
                    {['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(importJob.status)
                      ? '✓ Import Completed'
                      : importJob.status === 'REVERTED'
                        ? t('importBatchReverted')
                        : importJob.status === 'FAILED'
                          ? t('importPausedFailed')
                           : t('inventoryImportProcessing')}
                  </h3>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-blue-800 uppercase">
                    {(importJob.status || 'QUEUED').replaceAll('_', ' ')}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-blue-100">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{ width: `${Math.min(100, importJob.progress ?? 0)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-700">
                  {importJob.processedRecords || 0} / {importJob.totalRecords || previewData.rowsDetected || 0} records processed
                  {' '}({Math.round(importJob.progress || 0)}%)
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <p className="rounded-xl bg-white p-2.5 text-emerald-800">
                    Successful: <strong>{importJob.successfulRecords || 0}</strong>
                    {importJob.insertedRecords !== undefined && (
                      <span className="text-[10px] text-slate-500 block">
                        ({importJob.insertedRecords || 0} new, {importJob.updatedRecords || 0} updated)
                      </span>
                    )}
                  </p>
                  <p className="rounded-xl bg-white p-2.5 text-rose-800">
                    Failed: <strong>{importJob.failedRecords || 0}</strong>
                  </p>
                </div>
                {importJob.errorMessage && (
                  <p className="text-xs font-semibold text-rose-800">{importJob.errorMessage}</p>
                )}
                {pollError && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-rose-800">
                    <span>{pollError}</span>
                    <button type="button" onClick={() => setPollError('')} className="font-bold underline">
                      Retry status check
                    </button>
                  </div>
                )}
                {importJob.failedFileAvailable && (
                  <button
                    type="button"
                    onClick={downloadFailedRows}
                    className="w-full rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-rose-700 sm:w-auto cursor-pointer"
                  >
                    📥 Download Failed Records (.xlsx)
                  </button>
                )}
                {importJob.batchId && ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'].includes(importJob.status) && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                    <p className="text-xs text-amber-900 break-all">{t('importBatchId')}: <strong>{importJob.batchId}</strong></p>
                    <button
                      type="button"
                      onClick={rollbackImport}
                      className="rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-xs font-extrabold text-rose-700 hover:bg-rose-50 cursor-pointer"
                    >
                      Revert / Remove This Batch
                    </button>
                  </div>
                )}
                {importJob.status === 'REVERTED' && (
                  <p className="text-xs font-bold text-emerald-800">{t('batchRevertedMessage')}</p>
                )}
                {['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'REVERTED'].includes(importJob.status) && (
                  <button
                    type="button"
                    onClick={() => {
                      setImportJob(null);
                      setPreviewData(null);
                      setFile(null);
                      setPollError('');
                    }}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Prepare Another Import
                  </button>
                )}
                {importJob.status === 'FAILED' && (
                  <button
                    type="button"
                    onClick={retryImport}
                    className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-blue-700 cursor-pointer"
                  >
                    🔄 Retry Transient Failures
                  </button>
                )}
              </section>
            )}

            {/* Error Review Banner if any detected client-side */}
            {previewData.errorsCount > 0 && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs space-y-2">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-2 text-rose-800 font-bold">
                  <span>⚠️ {previewData.errorsCount} rows failed schema checks (will be logged to failure report)</span>
                  <button
                    onClick={() => setShowErrorsOnly(!showErrorsOnly)}
                    className="underline text-[11px] font-extrabold cursor-pointer"
                  >
                    {showErrorsOnly ? 'Show Valid Preview' : 'View Errors'}
                  </button>
                </div>
                {showErrorsOnly && (
                  <div className="max-h-40 overflow-y-auto space-y-1 text-[11px] text-rose-700">
                    {previewData.errors.map((err, idx) => (
                      <div key={idx} className="bg-white/80 p-2 rounded-xl border border-rose-200">
                        Row {err.rowNumber} [{err.sku} - {err.name}]: {err.errors.join(', ')}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Preview Sample Table */}
            {!showErrorsOnly && (
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 text-xs font-bold text-slate-700 flex justify-between">
                  <span>{t('serverInventoryPreview')}</span>
                  <span className="min-w-0 max-w-full truncate text-slate-400">{file?.name}</span>
                </div>
                <div className="max-h-48 overflow-auto">
                  <table className="w-full min-w-[620px] text-left text-[11px]">
                    <thead className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold">
                      <tr>
                        <th className="py-2 px-2.5">{t('sku')}</th>
                        <th className="py-2 px-2.5">{t('name')}</th>
                        <th className="py-2 px-2.5">{t('price')}</th>
                        <th className="py-2 px-2.5">{t('existing')}</th>
                        <th className="py-2 px-2.5">{t('newStock')}</th>
                        <th className="py-2 px-2.5">{t('available')}</th>
                        <th className="py-2 px-2.5">{t('expiry')}</th>
                        <th className="py-2 px-2.5">{t('batch')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previewData.previewRows.slice(0, 5).map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-2 px-2.5 font-mono text-slate-600">{row.SKU || row.sku || 'AUTO'}</td>
                          <td className="py-2 px-2.5 font-bold text-slate-900">{row['Medicine Name'] || row.name}</td>
                          <td className="py-2 px-2.5 text-emerald-600 font-black">₹{row.Price || row.price}</td>
                          <td className="py-2 px-2.5 font-bold">{row['Existing Stock'] ?? 0}</td>
                          <td className="py-2 px-2.5 font-bold">{row['New Stock'] ?? row.Stock ?? row.stock}</td>
                          <td className="py-2 px-2.5 font-bold">{row['Available After Import'] ?? '—'}</td>
                          <td className="py-2 px-2.5 text-slate-500">{row['Expiry Date'] || row.expiryDate || 'Default'}</td>
                          <td className="py-2 px-2.5 font-mono text-slate-500">{row['Batch Number'] || row.batchNumber || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Actions */}
            {!importJob && (
              <div className="pt-3 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-between gap-3">
                <button
                  onClick={() => { setPreviewData(null); setFile(null); }}
                  className="w-full sm:w-auto bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-4 py-2.5 rounded-xl cursor-pointer"
                >
                  Upload Different File
                </button>

                <button
                  onClick={handleConfirmImport}
                  disabled={!previewData.importsEnabled || committing || previewData.rowsDetected === 0 || !previewData.previewFingerprint}
                  className="w-full sm:w-auto justify-center bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-extrabold text-xs px-6 py-2.5 rounded-xl shadow-md shadow-emerald-600/25 cursor-pointer transition flex items-center gap-1.5"
                >
                  <span>{!previewData.importsEnabled ? t('importWritesDisabled') : committing ? t('startingIngestion') : t('importRecords').replace('{count}', previewData.rowsDetected)}</span>
                  <span>✓</span>
                </button>
              </div>
            )}
          </div>
        )}

        </div>
      </div>
    </div>
  );
}
