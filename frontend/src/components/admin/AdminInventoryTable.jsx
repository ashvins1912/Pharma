import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import apiClient from '../../api/apiClient';
import { invalidatePublicCatalogCache } from '../../api/publicCatalogCache';
import Pagination from '../common/Pagination';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
export default function AdminInventoryTable({ onOpenBulkImport, canManage = false, canImport = false }) {
  const { t } = useLanguage();
  const { fetchMedicines, setAdminNewStockModalOpen } = useApp();
  const { tenantId, branchId } = useTenant();
  const refreshStorefrontInventory = () => {
    invalidatePublicCatalogCache();
    void fetchMedicines({ force: true });
  };
  const { addToast } = useToast();
  
  const [adminMeds, setAdminMeds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const inventoryRequestRef = useRef(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [adminPage, setAdminPage] = useState(1);
  const [adminTotalPages, setAdminTotalPages] = useState(1);
  const [adminTotal, setAdminTotal] = useState(0);
  const [medicineDraft, setMedicineDraft] = useState(null);
  const [savingMedicine, setSavingMedicine] = useState(false);

  // Suggest Restock State
  const [showRestockModal, setShowRestockModal] = useState(false);
  const [restockLoading, setRestockLoading] = useState(false);
  const [restockSuggestions, setRestockSuggestions] = useState([]);
  const [restockSummary, setRestockSummary] = useState(null);
  const [restockQuantities, setRestockQuantities] = useState({});
  const [applyingRestock, setApplyingRestock] = useState(false);

  const fetchRestockSuggestions = async () => {
    if (!tenantId || !branchId) {
      addToast('Select an active pharmacy and branch first.', 'warning');
      return;
    }
    try {
      setRestockLoading(true);
      setShowRestockModal(true);
      const res = await apiClient.get('/api/medicines/admin/suggest-restock', {
        params: { tenantId, branchId }
      });
      const data = res.data?.data || res.data || {};
      const items = Array.isArray(data.items) ? data.items : [];
      setRestockSuggestions(items);
      setRestockSummary({
        totalItems: data.totalItemsNeedingRestock || items.length,
        totalUnits: data.totalSuggestedUnits || items.reduce((a, b) => a + (b.suggestedReorderQuantity || 0), 0),
        totalCost: data.totalEstimatedCost || items.reduce((a, b) => a + (b.estimatedTotalCost || 0), 0)
      });
      const initialQty = {};
      items.forEach(item => {
        initialQty[item.productId] = item.suggestedReorderQuantity;
      });
      setRestockQuantities(initialQty);
    } catch (err) {
      console.error('Fetch restock suggestions error:', err);
      addToast(err.response?.data?.message || err.message || 'Could not calculate restock suggestions.', 'error');
    } finally {
      setRestockLoading(false);
    }
  };

  const handleApplyRestock = async (specificItemId = null) => {
    if (!canManage) return;
    try {
      setApplyingRestock(true);
      const itemsToRestock = specificItemId
        ? [{ productId: specificItemId, quantity: Number(restockQuantities[specificItemId] || 10) }]
        : restockSuggestions.map(item => ({
            productId: item.productId,
            quantity: Number(restockQuantities[item.productId] || item.suggestedReorderQuantity || 10)
          })).filter(i => i.quantity > 0);

      if (!itemsToRestock.length) {
        addToast('No restock items selected.', 'warning');
        return;
      }

      await apiClient.post('/api/medicines/admin/apply-restock', {
        tenantId,
        branchId,
        restocks: itemsToRestock
      });

      addToast(`📦 Restock approved! Stock updated for ${itemsToRestock.length} items.`, 'success');
      window.dispatchEvent(new Event('pharma:inventory-updated'));
      void loadAdminInventory(adminPage, searchTerm);
      refreshStorefrontInventory();

      if (specificItemId) {
        setRestockSuggestions(prev => prev.filter(i => i.productId !== specificItemId));
      } else {
        setShowRestockModal(false);
      }
    } catch (err) {
      addToast(err.response?.data?.message || err.message || 'Restock application failed.', 'error');
    } finally {
      setApplyingRestock(false);
    }
  };

  const loadAdminInventory = async (page = 1, search = '') => {
    const requestVersion = ++inventoryRequestRef.current;
    if (!tenantId || !branchId) {
      setAdminMeds([]);
      setAdminTotal(0);
      setAdminTotalPages(1);
      setLoadError('Select an active pharmacy and branch to view inventory.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setLoadError('');
      const res = await apiClient.get('/api/medicines/admin/inventory', {
        params: { search, page, limit: 20, tenantId, branchId }
      });
      if (requestVersion !== inventoryRequestRef.current) return;

      const payload = res.data?.data || res.data || {};
      const medicines = Array.isArray(payload.medicines)
        ? payload.medicines
        : Array.isArray(payload.items)
          ? payload.items
          : Array.isArray(payload.data?.medicines)
            ? payload.data.medicines
            : null;
      if (!medicines) throw new Error('Inventory API returned an unexpected response format.');

      setAdminMeds(medicines);
      setAdminTotal(Number(payload.total ?? payload.pagination?.total ?? medicines.length) || 0);
      setAdminTotalPages(Number(payload.totalPages ?? payload.pages ?? payload.pagination?.totalPages ?? 1) || 1);
      setAdminPage(Number(payload.page) || page);
    } catch (err) {
      if (requestVersion !== inventoryRequestRef.current) return;
      console.error('Admin inventory load error:', err);
      setLoadError(err.response?.data?.message || err.message || 'Could not load inventory. Please retry.');
    } finally {
      if (requestVersion === inventoryRequestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminInventory(1, searchTerm);
  }, [searchTerm, tenantId, branchId]);

  // A published import changes Inventory Service records, not this component's
  // local React state. Listen for the shared refresh signal from the import UI.
  useEffect(() => {
    const handleInventoryUpdated = () => { void loadAdminInventory(1, searchTerm); };
    window.addEventListener('pharma:inventory-updated', handleInventoryUpdated);
    return () => window.removeEventListener('pharma:inventory-updated', handleInventoryUpdated);
  }, [searchTerm, tenantId, branchId]);

  const openMedicineForm = (medicine = null) => {
    if (!canManage) return;
    setMedicineDraft(medicine ? {
      ...medicine,
      drug: medicine.drug || medicine.activeSalt || '',
      hsnSac: medicine.hsnSac || '',
      imageUrl: medicine.imageUrl || '',
      stockQuantity: medicine.batchAvailability?.[0]?.stockQuantity ?? medicine.stockQuantity ?? medicine.stock ?? medicine.quantity ?? 0,
      price: medicine.batchAvailability?.[0]?.price ?? medicine.price ?? '',
      batchNumber: medicine.batchAvailability?.[0]?.batchNumber ?? medicine.batchNumber ?? '',
      expiryDate: (medicine.batchAvailability?.[0]?.expiryDate || medicine.expiryDate) ? new Date(medicine.batchAvailability?.[0]?.expiryDate || medicine.expiryDate).toISOString().slice(0, 10) : ''
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
        await apiClient.put(`/api/medicines/${encodeURIComponent(medicineDraft._id)}`, { ...medicineDraft, tenantId, branchId });
      } else {
        await apiClient.post('/api/medicines', { ...medicineDraft, tenantId, branchId });
      }
      addToast(medicineDraft._id ? t('medicineUpdated') : t('medicineCreated'), 'success');
      setMedicineDraft(null);
      await loadAdminInventory(adminPage, searchTerm);
      refreshStorefrontInventory();
    } catch (err) {
      addToast(err.message || t('saveMedicineFailed'), 'error');
    } finally {
      setSavingMedicine(false);
    }
  };

  const archiveMedicine = async (medicine) => {
    if (!canManage) return;
    if (!window.confirm(`Archive ${medicine.name} from the customer store?`)) return;
    try {
      await apiClient.delete(`/api/medicines/${encodeURIComponent(medicine._id)}`, { params: { tenantId, branchId } });
      addToast(t('medicineArchived'), 'success');
      await loadAdminInventory(adminPage, searchTerm);
      fetchMedicines();
    } catch (err) {
      addToast(err.message || t('archiveMedicineFailed'), 'error');
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
    <div className="admin-screen admin-screen--inventory bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h3 className="text-base font-black text-slate-900">📊 Inventory & Master Catalog ({adminTotal.toLocaleString()} Items)</h3>
          <p className="text-xs text-slate-500">{t('inventoryCatalogDescription')}</p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {canManage && (
            <button
              type="button"
              onClick={fetchRestockSuggestions}
              className="flex-1 sm:flex-initial rounded-xl bg-indigo-600 px-4 py-2 text-xs font-extrabold text-white transition hover:bg-indigo-700 shadow-sm shadow-indigo-600/20 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>⚡</span>
              <span>Suggest Restock</span>
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => setAdminNewStockModalOpen(true)}
              className="flex-1 sm:flex-initial rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white transition hover:bg-emerald-700 shadow-sm cursor-pointer"
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
              <span>{t('bulkExcelImport')}</span>
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
          placeholder={t("medicineDrugBatchHsnSearch")}
          className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:border-blue-500 transition"
        />
        <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Grid of Admin Medicines */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {loading && adminMeds.length === 0 ? (
          <div className="col-span-full py-12 text-center text-xs text-slate-400">{t('loadingInventory')}</div>
        ) : loadError ? (
          <div className="col-span-full py-10 text-center space-y-3">
            <p className="text-sm font-semibold text-rose-700">{loadError}</p>
            <button type="button" onClick={() => loadAdminInventory(1, searchTerm)} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700">
              Retry inventory
            </button>
          </div>
        ) : adminMeds.length === 0 ? (
          <div className="col-span-full py-12 text-center text-xs text-slate-400">{t('noProductsSearch')}</div>
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
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">{t('stock')}</span>
                    <span className="font-black text-slate-900">{physicalStock} units</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">{t('price')}</span>
                    <span className="font-black text-emerald-700 text-sm">₹{med.price}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1">
                  <span>{t('batch')}: <strong className="font-mono">{med.batchNumber || 'BTH-2024'}</strong></span>
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
                {medicineDraft._id ? t('editMedicineProduct') : t('addNewMedicineProduct')}
              </h4>
              <button type="button" onClick={() => setMedicineDraft(null)} className="rounded-lg bg-slate-100 px-3 py-1 text-slate-600 text-xs font-bold">
                ✕ Close
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                ['name', t('medicineName'), 'text'],
                ['drug', 'Drug / Active salt', 'text'],
                ['batchNumber', t('batchNumber'), 'text'],
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
                <span>{t('description')}</span>
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
                {savingMedicine ? t('savingAddress') : t('saveProductMedicine')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Automated Restock & Reorder Suggestions Modal */}
      {showRestockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="max-h-[90vh] w-full max-w-4xl space-y-4 overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl border border-slate-200">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">⚡</span>
                  <h3 className="text-base font-black text-slate-900">Automated Restock & Reorder Calculator</h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Calculated using 14-day sales velocity trends, current safety thresholds, and expiry dates.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRestockModal(false)}
                className="rounded-xl bg-slate-100 p-2 text-slate-500 hover:text-slate-800 text-xs font-bold transition hover:bg-slate-200 cursor-pointer"
              >
                ✕ Close
              </button>
            </div>

            {restockLoading ? (
              <div className="py-16 text-center space-y-3">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
                <p className="text-xs font-bold text-slate-600">Analyzing threshold trends & 30-day sales velocity...</p>
              </div>
            ) : restockSuggestions.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <span className="text-3xl">🎉</span>
                <h4 className="text-sm font-bold text-slate-800">Inventory Levels Optimal</h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  All inventory products currently maintain adequate safety stock buffers above sales velocity thresholds.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Summary Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-3.5">
                    <span className="text-[10px] font-black uppercase text-rose-700 tracking-wider">Reorder Needed</span>
                    <p className="text-lg font-black text-rose-950 mt-1">{restockSummary?.totalItems || restockSuggestions.length} Products</p>
                  </div>
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3.5">
                    <span className="text-[10px] font-black uppercase text-indigo-700 tracking-wider">Calculated Units Needed</span>
                    <p className="text-lg font-black text-indigo-950 mt-1">{restockSummary?.totalUnits || 0} Units</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3.5">
                    <span className="text-[10px] font-black uppercase text-emerald-700 tracking-wider">Est. Reorder Budget</span>
                    <p className="text-lg font-black text-emerald-950 mt-1">₹{(restockSummary?.totalCost || 0).toLocaleString()}</p>
                  </div>
                </div>

                {/* Bulk action bar */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                  <span className="text-xs font-bold text-slate-700">
                    Review and adjust suggested reorder quantities below:
                  </span>
                  <button
                    type="button"
                    onClick={() => handleApplyRestock(null)}
                    disabled={applyingRestock}
                    className="w-full sm:w-auto rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-4 py-2 transition shadow-md shadow-emerald-600/20 disabled:opacity-50 cursor-pointer"
                  >
                    {applyingRestock ? 'Processing Restock...' : `📦 Approve All (${restockSuggestions.length} Products)`}
                  </button>
                </div>

                {/* Reorder Table */}
                <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                  <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100/90 text-[10px] font-black uppercase text-slate-500 sticky top-0 z-10 border-b border-slate-200">
                        <tr>
                          <th className="p-3">Product / Drug</th>
                          <th className="p-3">Current Stock</th>
                          <th className="p-3">Daily Velocity</th>
                          <th className="p-3">Urgency & Reason</th>
                          <th className="p-3">Suggested Reorder Qty</th>
                          <th className="p-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {restockSuggestions.map((item) => {
                          const qty = restockQuantities[item.productId] ?? item.suggestedReorderQuantity;
                          return (
                            <tr key={item.productId} className="hover:bg-slate-50/80 transition">
                              <td className="p-3">
                                <p className="font-extrabold text-slate-900">{item.name}</p>
                                <p className="text-[10px] text-slate-400 font-mono">SKU: {item.sku}</p>
                              </td>
                              <td className="p-3">
                                <span className={`font-black ${item.currentStock <= 3 ? 'text-rose-700' : 'text-slate-800'}`}>
                                  {item.currentStock} units
                                </span>
                              </td>
                              <td className="p-3">
                                <span className="font-bold text-slate-700">{item.dailyVelocity} / day</span>
                                <p className="text-[10px] text-slate-400">({item.totalUnitsSold30d} in 30d)</p>
                              </td>
                              <td className="p-3">
                                <span className={`inline-block text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${
                                  item.urgency === 'CRITICAL' ? 'bg-rose-100 text-rose-800' :
                                  item.urgency === 'HIGH' ? 'bg-amber-100 text-amber-800' :
                                  'bg-blue-100 text-blue-800'
                                }`}>
                                  {item.urgency}
                                </span>
                                <p className="text-[10px] text-slate-500 mt-0.5">{item.reason}</p>
                              </td>
                              <td className="p-3">
                                <input
                                  type="number"
                                  min="1"
                                  value={qty}
                                  onChange={(e) => setRestockQuantities(prev => ({
                                    ...prev,
                                    [item.productId]: Math.max(1, parseInt(e.target.value, 10) || 1)
                                  }))}
                                  className="w-20 rounded-xl border border-slate-300 px-2.5 py-1 text-xs font-black text-slate-900 outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                                />
                              </td>
                              <td className="p-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleApplyRestock(item.productId)}
                                  disabled={applyingRestock}
                                  className="rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-[11px] px-3 py-1.5 transition disabled:opacity-50 cursor-pointer"
                                >
                                  Restock
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
