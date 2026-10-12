import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import apiClient from '../../api/apiClient';
import Pagination from '../common/Pagination';

export default function AdminInventoryTable({ onOpenBulkImport, canManage = false, canImport = false }) {
  const { fetchMedicines } = useApp();
  const { addToast } = useToast();
  
  const [adminMeds, setAdminMeds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [adminPage, setAdminPage] = useState(1);
  const [adminTotalPages, setAdminTotalPages] = useState(1);
  const [adminTotal, setAdminTotal] = useState(0);
  const [medicineDraft, setMedicineDraft] = useState(null);
  const [savingMedicine, setSavingMedicine] = useState(false);

  const loadAdminInventory = async (page = 1, search = '') => {
    try {
      setLoading(true);
      const res = await apiClient.get('/api/medicines/admin/inventory', {
        params: {
          search,
          page,
          limit: 20
        }
      });
      if (res.data && res.data.medicines) {
        setAdminMeds(res.data.medicines);
        setAdminTotal(res.data.total || 0);
        setAdminTotalPages(res.data.totalPages || 1);
        setAdminPage(page);
      } else if (Array.isArray(res.data)) {
        setAdminMeds(res.data);
        setAdminTotal(res.data.length);
        setAdminTotalPages(1);
      }
    } catch (err) {
      console.error("Admin inventory load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminInventory(1, searchTerm);
  }, [searchTerm]);

  const openMedicineForm = (medicine = null) => {
    if (!canManage) return;
    setMedicineDraft(medicine ? {
      ...medicine,
      drug: medicine.drug || medicine.activeSalt || '',
      batchNumber: medicine.batchNumber || '',
      hsnSac: medicine.hsnSac || '',
      imageUrl: medicine.imageUrl || '',
      stockQuantity: medicine.stockQuantity ?? medicine.stock ?? medicine.quantity ?? 0,
      expiryDate: medicine.expiryDate ? new Date(medicine.expiryDate).toISOString().slice(0, 10) : ''
    } : {
      name: '',
      brand: '',
      sku: '',
      drug: '',
      batchNumber: '',
      hsnSac: '',
      imageUrl: '',
      category: 'General Medicine',
      description: '',
      price: '',
      stockQuantity: 0,
      expiryDate: '',
      isPrescriptionRequired: false
    });
  };

  const saveMedicine = async (event) => {
    event.preventDefault();
    if (!canManage) return;
    try {
      setSavingMedicine(true);
      if (medicineDraft._id) {
        await apiClient.put(`/api/medicines/${encodeURIComponent(medicineDraft._id)}`, medicineDraft);
      } else {
        await apiClient.post('/api/medicines', medicineDraft);
      }
      addToast(`Medicine ${medicineDraft._id ? 'updated' : 'created'} successfully.`, 'success');
      setMedicineDraft(null);
      await loadAdminInventory(adminPage, searchTerm);
      fetchMedicines();
    } catch (err) {
      addToast(err.message || 'Could not save medicine.', 'error');
    } finally {
      setSavingMedicine(false);
    }
  };

  const archiveMedicine = async (medicine) => {
    if (!canManage) return;
    if (!window.confirm(`Archive ${medicine.name} from the customer store?`)) return;
    try {
      await apiClient.delete(`/api/medicines/${encodeURIComponent(medicine._id)}`);
      addToast('Medicine archived from the customer catalog.', 'success');
      await loadAdminInventory(adminPage, searchTerm);
      fetchMedicines();
    } catch (err) {
      addToast(err.message || 'Could not archive medicine.', 'error');
    }
  };

  const getStatusBadge = (med) => {
    const stock = med.stock !== undefined ? med.stock : med.quantity;
    if (med.isExpired) {
      return <span className="bg-red-100 text-red-800 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">🔴 Expired</span>;
    }
    if (med.isExpiringSoon) {
      return <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">🟠 Expiring Soon ({med.daysUntilExpiry}d)</span>;
    }
    if (stock <= 0) {
      return <span className="bg-slate-200 text-slate-700 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">⚫ Sold Out</span>;
    }
    if (stock <= 3) {
      return <span className="bg-yellow-100 text-yellow-800 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">🟡 Low Stock ({stock})</span>;
    }
    return <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">🟢 In Stock ({stock})</span>;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h3 className="text-base font-black text-slate-900">📊 Inventory & Master Catalog ({adminTotal.toLocaleString()} Items)</h3>
          <p className="text-xs text-slate-500">Track stock levels, batch numbers, HSN/SAC, drug formulas, and regulatory expiry dates.</p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {canManage && (
            <button
              type="button"
              onClick={() => openMedicineForm()}
              className="flex-1 sm:flex-initial rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white transition hover:bg-emerald-700 shadow-sm"
            >
              + Add Medicine / Product
            </button>
          )}
          {canImport && (
            <button
              onClick={onOpenBulkImport}
              className="flex-1 sm:flex-initial bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-4 py-2 rounded-xl transition cursor-pointer shadow-md shadow-blue-600/20 flex items-center justify-center gap-1.5"
            >
              <span>📥</span>
              <span>Bulk Excel Import</span>
            </button>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by medicine name, drug, batch number, or HSN/SAC..."
          className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:border-blue-500 transition"
        />
        <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Grid of Admin Medicines */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {loading && adminMeds.length === 0 ? (
          <div className="col-span-full py-12 text-center text-xs text-slate-400">Loading catalog inventory...</div>
        ) : adminMeds.length === 0 ? (
          <div className="col-span-full py-12 text-center text-xs text-slate-400">No products found matching your search.</div>
        ) : (
          adminMeds.map((med) => {
            const stock = med.stock !== undefined ? med.stock : med.quantity;
            const physicalStock = med.stockQuantity !== undefined ? med.stockQuantity : stock;
            return (
              <div key={med._id} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3 flex flex-col justify-between shadow-xs">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <img
                      src={med.imageUrl || med.image || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80'}
                      alt={med.name}
                      className="w-12 h-12 rounded-xl object-cover border border-slate-200 bg-white flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-extrabold text-slate-900 text-xs truncate">{med.name}</h4>
                      <p className="text-[11px] text-blue-700 font-bold truncate">Drug: {med.drug || med.activeSalt || 'Standard'}</p>
                      <p className="text-[10px] text-slate-400 truncate">HSN/SAC: {med.hsnSac || '3004'} | SKU: {med.sku || 'N/A'}</p>
                    </div>
                  </div>
                  <div>{getStatusBadge(med)}</div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-200 text-slate-600">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Stock</span>
                    <span className="font-black text-slate-900">{physicalStock} units</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Price</span>
                    <span className="font-black text-emerald-700 text-sm">₹{med.price}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1">
                  <span>Batch: <strong className="font-mono">{med.batchNumber || 'BTH-2024'}</strong></span>
                  <span className={med.isExpired ? 'text-red-600 font-bold' : ''}>
                    Exp: {med.expiryDate ? new Date(med.expiryDate).toLocaleDateString() : 'N/A'}
                  </span>
                </div>

                <div className="pt-2 border-t border-slate-200 flex justify-end gap-2">
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => openMedicineForm(med)}
                      className="px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 text-xs font-bold hover:bg-blue-100 min-h-[36px]"
                    >
                      Edit
                    </button>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => archiveMedicine(med)}
                      className="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 min-h-[36px]"
                    >
                      Archive
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <Pagination
        page={adminPage}
        totalPages={adminTotalPages}
        total={adminTotal}
        pageSize={20}
        onPageChange={(nextPage) => loadAdminInventory(nextPage, searchTerm)}
        loading={loading}
        label="inventory items"
        className="mt-3"
      />

      {medicineDraft && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <form onSubmit={saveMedicine} className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h4 className="text-base font-black text-slate-900">
                {medicineDraft._id ? 'Edit Medicine / Product' : 'Add New Medicine / Product'}
              </h4>
              <button type="button" onClick={() => setMedicineDraft(null)} className="rounded-lg bg-slate-100 px-3 py-1 text-slate-600 text-xs font-bold">
                ✕ Close
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                ['name', 'Medicine name', 'text'],
                ['drug', 'Drug / Active salt', 'text'],
                ['batchNumber', 'Batch number', 'text'],
                ['hsnSac', 'HSN/SAC code', 'text'],
                ['brand', 'Brand', 'text'],
                ['sku', 'SKU / Code', 'text'],
                ['category', 'Category', 'text'],
                ['price', 'Price (₹)', 'number'],
                ['stockQuantity', 'Physical stock', 'number'],
                ['expiryDate', 'Expiry date', 'date'],
                ['imageUrl', 'Image URL (photo)', 'text']
              ].map(([field, label, type]) => (
                <label key={field} className="space-y-1 text-xs font-bold text-slate-600">
                  <span>{label}</span>
                  <input
                    type={type}
                    value={medicineDraft[field] ?? ''}
                    min={type === 'number' ? 0 : undefined}
                    step={field === 'price' ? '0.01' : type === 'number' ? '1' : undefined}
                    required={['name', 'drug', 'batchNumber', 'hsnSac', 'price', 'stockQuantity', 'expiryDate'].includes(field)}
                    onChange={event => setMedicineDraft(prev => ({ ...prev, [field]: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 font-normal outline-none focus:border-blue-500"
                  />
                </label>
              ))}
              <label className="space-y-1 text-xs font-bold text-slate-600 sm:col-span-2">
                <span>Description</span>
                <textarea
                  value={medicineDraft.description || ''}
                  onChange={event => setMedicineDraft(prev => ({ ...prev, description: event.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 font-normal outline-none focus:border-blue-500"
                  rows={3}
                />
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={Boolean(medicineDraft.isPrescriptionRequired ?? medicineDraft.requiresPrescription)}
                  onChange={event => setMedicineDraft(prev => ({
                    ...prev,
                    isPrescriptionRequired: event.target.checked
                  }))}
                />
                Prescription required (Rx)
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t pt-3">
              <button type="button" onClick={() => setMedicineDraft(null)} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700">
                Cancel
              </button>
              <button type="submit" disabled={savingMedicine} className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-extrabold text-white disabled:opacity-50">
                {savingMedicine ? 'Saving…' : 'Save Product / Medicine'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
