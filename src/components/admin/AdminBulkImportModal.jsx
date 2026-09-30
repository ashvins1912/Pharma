import React, { useState } from 'react';
import * as xlsx from 'xlsx';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';
import { useApp } from '../../context/AppContext';

export default function AdminBulkImportModal({ isOpen, onClose }) {
  const { addToast } = useToast();
  const { fetchMedicines } = useApp();

  const [file, setFile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);

  if (!isOpen) return null;

  const handleFileChange = async (selectedFile) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    setAnalyzing(true);
    setPreviewData(null);

    const formData = new FormData();
    formData.append('excelFile', selectedFile);

    try {
      const res = await apiClient.post('/api/medicines/validate-import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setPreviewData(res.data);
      addToast(`Analyzed ${res.data.rowsDetected} rows (${res.data.validCount} valid)`, 'info');
    } catch (err) {
      addToast(err.message || 'Validation failed', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleConfirmImport = async () => {
    if (!previewData || !previewData.validRows || previewData.validRows.length === 0) {
      addToast('No valid rows available to import', 'warning');
      return;
    }

    setCommitting(true);
    try {
      const res = await apiClient.post('/api/medicines/confirm-import', {
        rows: previewData.validRows
      });
      addToast(res.data.message || 'Bulk inventory merged successfully!', 'success');
      fetchMedicines();
      onClose();
    } catch (err) {
      addToast(err.message || 'Import commit failed', 'error');
    } finally {
      setCommitting(false);
    }
  };

  const downloadSampleTemplate = () => {
    const sampleRows = [
      {
        SKU: "MED-DLO-650",
        "Medicine Name": "Dolo 650mg",
        Category: "Pain & Fever",
        Description: "Anti-pyretic formulation for severe fever and headache.",
        Price: 32,
        Stock: 150,
        "Expiry Date": "2027-12-31",
        "Batch Number": "BTH-DLO-2401",
        "Requires Prescription": "false",
        "Cloudinary Image URL": "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80",
        Manufacturer: "Micro Labs Ltd"
      },
      {
        SKU: "MED-AUG-625",
        "Medicine Name": "Augmentin 625 Duo",
        Category: "Antibiotics",
        Description: "Amoxicillin and Potassium Clavulanate Tablets IP.",
        Price: 205,
        Stock: 50,
        "Expiry Date": "2027-09-15",
        "Batch Number": "BTH-AUG-2390",
        "Requires Prescription": "true",
        "Cloudinary Image URL": "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=500&q=80",
        Manufacturer: "GlaxoSmithKline"
      }
    ];

    const ws = xlsx.utils.json_to_sheet(sampleRows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory");
    xlsx.writeFile(wb, "Ashvin_Pharmacy_Inventory_Template.xlsx");
    addToast("Sample Excel template downloaded!", "success");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto overflow-x-hidden bg-white border border-slate-200 rounded-3xl shadow-2xl p-4 sm:p-8 relative">
        
        {/* Header */}
        <div className="flex flex-wrap justify-between items-start gap-3 pb-4 border-b border-slate-100">
        <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📥</span>
              <h2 className="min-w-0 break-words text-base sm:text-lg font-black text-slate-900">
                Bulk Inventory Excel Ingestion
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              SheetJS (.xlsx) ingestion engine with atomic validation and SKU merge rules
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
          >
            ✕
          </button>
        </div>

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
                  Supports thousands of rows with automated validation and SKU conflict merge
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
                {analyzing ? 'Validating Workbook...' : 'Choose Excel File (.xlsx)'}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs text-slate-500 pt-2">
              <span className="break-words">Required: SKU, Medicine Name, Price, Stock, Expiry Date</span>
              <button
                type="button"
                onClick={downloadSampleTemplate}
                className="text-blue-600 font-extrabold hover:underline cursor-pointer"
              >
                📥 Download Sample Template (.xlsx)
              </button>
            </div>
          </div>
        )}

        {/* Preview & Validation Report */}
        {previewData && (
          <div className="py-4 space-y-4 animate-fade-in">
            {/* Metric Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="bg-slate-50 border border-slate-200 p-3 rounded-2xl text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">Total Rows</span>
                <span className="text-lg font-black text-slate-900">{previewData.rowsDetected}</span>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-2xl text-center">
                <span className="text-[10px] font-bold text-emerald-700 uppercase block">Valid</span>
                <span className="text-lg font-black text-emerald-800">{previewData.validCount}</span>
              </div>
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-2xl text-center">
                <span className="text-[10px] font-bold text-amber-700 uppercase block">Warnings</span>
                <span className="text-lg font-black text-amber-800">{previewData.warningsCount}</span>
              </div>
              <div className="bg-rose-50 border border-rose-200 p-3 rounded-2xl text-center">
                <span className="text-[10px] font-bold text-rose-700 uppercase block">Errors</span>
                <span className="text-lg font-black text-rose-800">{previewData.errorsCount}</span>
              </div>
            </div>

            {/* Error Review Banner if any */}
            {previewData.errorsCount > 0 && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs space-y-2">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-2 text-rose-800 font-bold">
                  <span>⚠️ {previewData.errorsCount} rows failed schema validation (excluded from import)</span>
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
                  <span>Import Preview (First 5 Rows)</span>
                  <span className="min-w-0 max-w-full truncate text-slate-400">{file?.name}</span>
                </div>
                <div className="max-h-48 overflow-auto">
                  <table className="w-full min-w-[620px] text-left text-[11px]">
                    <thead className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold">
                      <tr>
                        <th className="py-2 px-2.5">SKU</th>
                        <th className="py-2 px-2.5">Name</th>
                        <th className="py-2 px-2.5">Price</th>
                        <th className="py-2 px-2.5">Stock</th>
                        <th className="py-2 px-2.5">Expiry</th>
                        <th className="py-2 px-2.5">Batch</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previewData.previewRows.slice(0, 5).map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-2 px-2.5 font-mono text-slate-600">{row.SKU || row.sku || 'AUTO'}</td>
                          <td className="py-2 px-2.5 font-bold text-slate-900">{row['Medicine Name'] || row.name}</td>
                          <td className="py-2 px-2.5 text-emerald-600 font-black">₹{row.Price || row.price}</td>
                          <td className="py-2 px-2.5 font-bold">{row.Stock || row.stock}</td>
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
            <div className="pt-3 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-between gap-3">
              <button
                onClick={() => { setPreviewData(null); setFile(null); }}
                className="w-full sm:w-auto bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-4 py-2.5 rounded-xl cursor-pointer"
              >
                Upload Different File
              </button>

              <button
                onClick={handleConfirmImport}
                disabled={committing || previewData.validCount === 0}
                className="w-full sm:w-auto justify-center bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-extrabold text-xs px-6 py-2.5 rounded-xl shadow-md shadow-emerald-600/25 cursor-pointer transition flex items-center gap-1.5"
              >
                <span>{committing ? 'Merging Inventory...' : `Import ${previewData.validCount} Valid Rows`}</span>
                <span>✓</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
