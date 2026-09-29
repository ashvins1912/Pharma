import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import apiClient from '../../api/apiClient';

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

  const loadAdminInventory = async (page = 1, search = '') => {
    try {
      setLoading(true);
      const res = await apiClient.get('/api/medicines', {
        params: {
          search,
          page,
          limit: 20,
          includeOutOfStock: 'true'
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

      {/* Table View */}
      <div className="overflow-x-auto">
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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400">Loading catalog items...</td>
              </tr>
            ) : adminMeds.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400">No matching medicines found.</td>
              </tr>
            ) : (
              adminMeds.map((med) => {
                const stock = med.stock !== undefined ? med.stock : med.quantity;
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
                        {stock} units
                      </span>
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
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      {adminTotalPages > 1 && (
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          <span className="text-slate-500 font-medium">
            Page {adminPage} of {adminTotalPages} ({adminTotal.toLocaleString()} items)
          </span>

          <div className="flex gap-1.5">
            <button
              onClick={() => loadAdminInventory(adminPage - 1, searchTerm)}
              disabled={adminPage <= 1}
              className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 font-bold disabled:opacity-40 cursor-pointer"
            >
              ‹ Prev
            </button>
            <span className="px-3 py-1 font-bold bg-slate-100 rounded-lg text-slate-800">
              {adminPage}
            </span>
            <button
              onClick={() => loadAdminInventory(adminPage + 1, searchTerm)}
              disabled={adminPage >= adminTotalPages}
              className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 font-bold disabled:opacity-40 cursor-pointer"
            >
              Next ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
