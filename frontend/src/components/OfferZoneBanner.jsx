import React, { useEffect, useState } from 'react';
import apiClient from '../api/apiClient';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { useToast } from '../context/ToastContext';

export default function OfferZoneBanner() {
  const { addToCart } = useApp();
  const { user } = useAuth();
  const { tenantId, activeTenant } = useTenant();
  const { addToast } = useToast();
  const [items, setItems] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const itemsPerPage = 4;

  useEffect(() => {
    let active = true;
    setItems([]);
    setCurrentPage(1);
    setLoadError('');
    if (!user || !tenantId) return () => { active = false; };
    setLoading(true);
    apiClient.get('/api/surplus-savings', { params: { tenantId } })
      .then(({ data }) => {
        if (!active) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(error => {
        if (active) setLoadError(error?.message || 'Surplus Savings are temporarily unavailable.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [user?.id, tenantId]);

  if (!user || !tenantId || (!loading && items.length === 0 && !loadError)) return null;

  const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
  const currentOffers = items.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleAddToCart = item => {
    if (Number(item.stock || 0) <= 0) {
      addToast(`${item.name} is currently out of stock at this pharmacy.`, 'warning');
      return;
    }
    addToCart({
      ...item,
      _id: item.medicineId || item._id,
      price: Number(item.discountedPrice),
      originalPrice: Number(item.originalPrice),
      tenantId
    });
    addToast(`Added ${item.name} with ${Number(item.discountPercent).toFixed(0)}% Surplus Savings.`, 'success');
  };

  return (
    <section className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 rounded-2xl sm:rounded-3xl p-5 sm:p-7 text-white shadow-lg shadow-orange-500/20 space-y-4 my-6 relative overflow-hidden" aria-label="Exclusive Surplus Savings">
      <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-white/10 skew-x-12 pointer-events-none" />
      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <span className="bg-white/20 px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-black uppercase tracking-wider backdrop-blur-md">
            Pharmacy-verified clearance offers
          </span>
          <h2 className="text-base sm:text-xl font-black tracking-tight text-white mt-2">Exclusive Surplus Savings</h2>
          <p className="text-xs text-amber-50 mt-1">
            {activeTenant?.shopName || activeTenant?.name || 'Selected pharmacy'} offers, applied again by the server at checkout
          </p>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2 bg-white/20 backdrop-blur-md px-3 py-1.5 rounded-2xl w-fit">
            <button onClick={() => setCurrentPage(page => Math.max(page - 1, 1))} disabled={currentPage === 1} className="text-xs font-extrabold px-2 py-1 bg-white/20 hover:bg-white/40 disabled:opacity-40 rounded-xl transition">
              ← Prev
            </button>
            <span className="text-xs font-bold text-white px-1">Page {currentPage} of {totalPages}</span>
            <button onClick={() => setCurrentPage(page => Math.min(page + 1, totalPages))} disabled={currentPage === totalPages} className="text-xs font-extrabold px-2 py-1 bg-white/20 hover:bg-white/40 disabled:opacity-40 rounded-xl transition">
              Next →
            </button>
          </div>
        )}
      </div>

      {loading && <p className="relative z-10 text-xs font-semibold">Loading this pharmacy's active savings…</p>}
      {loadError && <p role="alert" className="relative z-10 text-xs font-semibold">{loadError}</p>}
      {!loading && !loadError && items.length === 0 && (
        <p className="relative z-10 text-xs font-semibold">No active surplus campaigns at this pharmacy right now.</p>
      )}

      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pt-1">
        {currentOffers.map(item => (
          <article key={item.campaignId + ':' + item.medicineId} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-3 border border-orange-200/50 dark:border-slate-800">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-300 text-[10px] font-black px-2 py-0.5 rounded-md">
                  {Number(item.discountPercent).toFixed(0)}% OFF
                </span>
                <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                  {Number(item.stock) > 0 ? `${item.stock} available` : 'Out of stock'}
                </span>
              </div>
              <h3 className="font-extrabold text-xs sm:text-sm line-clamp-2">{item.name}</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">{item.campaignName}{item.campaignDescription ? ` · ${item.campaignDescription}` : ''}</p>
              {Number(item.minOrderAmount) > 0 && <p className="text-[10px] text-amber-700 dark:text-amber-300">Minimum basket ₹{Number(item.minOrderAmount).toFixed(0)}</p>}
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] text-slate-400 line-through">₹{Number(item.originalPrice).toFixed(2)}</div>
                <div className="text-sm font-black text-emerald-600 dark:text-emerald-400">₹{Number(item.discountedPrice).toFixed(2)}</div>
                <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">Save ₹{Number(item.savingsAmount).toFixed(2)}</div>
              </div>
              <button type="button" onClick={() => handleAddToCart(item)} disabled={Number(item.stock) <= 0} className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-bold text-xs px-3 py-2 rounded-xl transition shadow-sm">
                Claim Offer
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
