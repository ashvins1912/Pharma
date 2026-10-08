import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import apiClient from '../../api/apiClient';
import Pagination from '../common/Pagination';

export default function AdminInventoryTable({ onOpenBulkImport }) {
  const { fetchMedicines } = useApp();
  const { addToast } = useToast();
  
  const [adminMeds, setAdminMeds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [adminPage, setAdminPage] = useState(1);
  const [adminTotalPages, setAdminTotalPages] = useState(1);
  const [adminTotal, setAdminTotal] = useState(0);
  const [seeding, setSeeding] = useState(false);
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

  const handleSeed = async () => {
    try {
      setSeeding(true);
      const res = await apiClient.post('/api/test/seed-medicines');
      addToast(res.data.message || '1,000+ item catalog initialized!', 'success');
      loadAdminInventory(1, searchTerm);
      fetchMedicines();
    } catch (err) {
      addToast('Failed to seed catalog: ' + err.message, 'error');
    } finally {
      setSeeding(false);
    }
  };

  const openMedicineForm = (medicine = null) => {
    setMedicineDraft(medicine ? {
      ...medicine,
      stockQuantity: medicine.stockQuantity ?? medicine.stock ?? medicine.quantity ?? 0,
      expiryDate: medicine.expiryDate ? new Date(medicine.expiryDate).toISOString().slice(0, 10) : ''
    } : {
      name: '',
      brand: '',
      sku: '',
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
          <p className="text-xs text-slate-500">Track stock levels, batch numbers, out-of-stock items, and regulatory expiry dates.</p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => openMedicineForm()}
            className="flex-1 sm:flex-initial rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white transition hover:bg-emerald-700"
          >
            + Add Medicine
          </button>
          <button
            onClick={onOpenBulkImport}
            className="flex-1 sm:flex-initial bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-4 py-2 rounded-xl transition cursor-pointer shadow-md shadow-blue-600/20 flex items-center justify-center gap-1.5"
          >
            <span>📥</span>
            <span>Bulk Excel Import</span>
          </button>

          <button
            onClick={handleSeed}
            disabled={seeding}
            className="flex-1 sm:flex-initial bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-3.5 py-2 rounded-xl transition cursor-pointer"
          >
            {seeding ? 'Reloading 1000+...' : '⚡ Re-seed 1000+'}
          </button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex items-center relative">
        <span className="absolute left-3.5 text-slate-400 text-xs">🔍</span>
        <input
          type="text"
          placeholder="Filter by SKU (e.g. MED-PNF-PARA-01), medicine name, category, or brand..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white"
        />
      </div>

      {/* Desktop/Tablet Table View */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-400 text-[10px] font-extrabold uppercase tracking-wider">
              <th className="py-3 px-3">Medicine & Brand</th>
              <th className="py-3 px-3">SKU</th>
              <th className="py-3 px-3">Category</th>
              <th className="py-3 px-3">Stock Units</th>
              <th className="py-3 px-3">Price</th>
              <th className="py-3 px-3">Batch & Expiry</th>
              <th className="py-3 px-3">Rx Status</th>
              <th className="py-3 px-3 text-right">Inventory Health</th>
              <th className="py-3 px-3 text-right">Admin Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-400">Loading catalog items...</td>
              </tr>
            ) : adminMeds.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-400">No matching medicines found.</td>
              </tr>
            ) : (
              adminMeds.map((med) => {
                const stock = med.availableQuantity ?? med.stock ?? med.quantity ?? 0;
                const physicalStock = med.stockQuantity ?? stock;
                return (
                  <tr key={med._id} className="hover:bg-slate-50/70 transition">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={med.imageUrl || "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=80&q=80"}
                          alt={med.name}
                          className="w-9 h-9 object-cover rounded-lg bg-slate-100 border border-slate-200"
                          onError={(e) => { e.target.src = "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=80&q=80"; }}
                        />
                        <div>
                          <span className="font-bold text-slate-900 block leading-tight">{med.name}</span>
                          <span className="text-[10px] text-slate-400">{med.brand} • {med.manufacturer || 'Lab'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-600 font-bold">
                      {med.sku || 'N/A'}
                    </td>
                    <td className="py-3 px-3 text-slate-600 font-medium">
                      {med.category || 'General'}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`font-black ${stock <= 0 ? 'text-slate-400' : stock <= 3 ? 'text-amber-600' : 'text-slate-900'}`}>
                        {physicalStock} units
                      </span>
                      {(med.reservedQuantity || 0) > 0 && (
                        <span className="block text-[10px] text-slate-400">
                          {stock} available · {med.reservedQuantity} reserved
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-black text-emerald-600">
                      ₹{med.price}
                    </td>
                    <td className="py-3 px-3 text-[11px]">
                      <span className="font-mono text-slate-500 block">{med.batchNumber || 'BTH-2024'}</span>
                      <span className={med.isExpired ? 'text-red-600 font-bold' : med.isExpiringSoon ? 'text-amber-600 font-bold' : 'text-slate-500'}>
                        Exp: {new Date(med.expiryDate).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      {med.requiresPrescription ? (
                        <span className="bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-black px-1.5 py-0.5 rounded">
                          Rx Only
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px] font-bold">OTC</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {getStatusBadge(med)}
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openMedicineForm(med)}
                        className="mr-2 font-bold text-blue-700 hover:underline cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => archiveMedicine(med)}
                        className="font-bold text-rose-700 hover:underline cursor-pointer"
                      >
                        Archive
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View (Section 16 Option B) */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="py-8 text-center text-slate-400 text-xs">Loading catalog items...</div>
        ) : adminMeds.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs">No matching medicines found.</div>
        ) : (
          adminMeds.map((med) => {
            const stock = med.availableQuantity ?? med.stock ?? med.quantity ?? 0;
            const physicalStock = med.stockQuantity ?? stock;
            return (
              <div key={med._id} className="p-3.5 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <img
                    src={med.imageUrl || "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=80&q=80"}
                    alt={med.name}
                    className="w-12 h-12 object-cover rounded-xl bg-white border border-slate-200 flex-shrink-0"
                    onError={(e) => { e.target.src = "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=80&q=80"; }}
                  />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-extrabold text-xs text-slate-900 leading-tight truncate">{med.name}</h4>
                    <p className="text-[10px] text-slate-500 mt-0.5">{med.brand} • {med.category || 'General'}</p>
                    <span className="font-mono text-[9px] text-slate-400">{med.sku || 'N/A'}</span>
                  </div>
                  <div>
                    {getStatusBadge(med)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-200 text-slate-600">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Stock</span>
                    <span className="font-black text-slate-900">{physicalStock} units</span>
                    {(med.reservedQuantity || 0) > 0 && (
                      <span className="text-[10px] text-slate-400 block">({stock} avail)</span>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Unit Price</span>
                    <span className="font-black text-emerald-700 text-sm">₹{med.price}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1">
                  <span>Batch: <strong className="font-mono">{med.batchNumber || 'BTH-2024'}</strong></span>
                  <span className={med.isExpired ? 'text-red-600 font-bold' : ''}>
                    Exp: {new Date(med.expiryDate).toLocaleDateString()}
                  </span>
                </div>

                <div className="pt-2 border-t border-slate-200 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => openMedicineForm(med)}
                    className="px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 text-xs font-bold hover:bg-blue-100 min-h-[36px]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => archiveMedicine(med)}
                    className="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 min-h-[36px]"
                  >
                    Archive
                  </button>
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

      {medicineDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <form onSubmit={saveMedicine} className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h4 className="text-base font-black text-slate-900">
                {medicineDraft._id ? 'Edit medicine' : 'Add medicine'}
              </h4>
              <button type="button" onClick={() => setMedicineDraft(null)} className="rounded-lg bg-slate-100 px-3 py-1 text-slate-600">
                Close
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                ['name', 'Medicine name', 'text'],
                ['brand', 'Brand', 'text'],
                ['sku', 'SKU / Code', 'text'],
                ['category', 'Category', 'text'],
                ['price', 'Price', 'number'],
                ['stockQuantity', 'Physical stock', 'number'],
                ['expiryDate', 'Expiry date', 'date']
              ].map(([field, label, type]) => (
                <label key={field} className="space-y-1 text-xs font-bold text-slate-600">
                  <span>{label}</span>
                  <input
                    type={type}
                    value={medicineDraft[field] ?? ''}
                    min={type === 'number' ? 0 : undefined}
                    step={field === 'price' ? '0.01' : type === 'number' ? '1' : undefined}
                    required={['name', 'brand', 'price', 'stockQuantity', 'expiryDate'].includes(field)}
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
                Prescription required
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t pt-3">
              <button type="button" onClick={() => setMedicineDraft(null)} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700">
                Cancel
              </button>
              <button type="submit" disabled={savingMedicine} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-extrabold text-white disabled:opacity-50">
                {savingMedicine ? 'Saving…' : 'Save medicine'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
