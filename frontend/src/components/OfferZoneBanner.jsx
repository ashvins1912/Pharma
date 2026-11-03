import React, { useEffect, useRef, useState } from 'react';
import apiClient from '../api/apiClient';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';

const CACHE_PREFIX = 'pharma_surplus_savings_v1:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const readCampaignCache = key => {
  if (!key || typeof window === 'undefined') return null;
  try {
    const cached = JSON.parse(window.localStorage.getItem(key) || 'null');
    if (!cached || !Array.isArray(cached.items) || Date.now() - cached.savedAt > CACHE_TTL_MS) return null;
    return cached.items.filter(item => !item.endsAt || new Date(item.endsAt).getTime() > Date.now());
  } catch {
    return null;
  }
};

const writeCampaignCache = (key, items) => {
  if (!key || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ items, savedAt: Date.now() }));
  } catch {
    // Storage can be unavailable or full; the live API remains authoritative.
  }
};

export default function OfferZoneBanner() {
  const { t } = useLanguage();
  const { addToCart } = useApp();
  const { user, loading: authLoading, isFullyAuthenticated } = useAuth();
  const { tenantId, activeTenant } = useTenant();
  const { addToast } = useToast();
  const [items, setItems] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [displayedTenantId, setDisplayedTenantId] = useState(null);
  const requestSequence = useRef(0);
  const displayedCacheKeyRef = useRef(null);
  const itemsPerPage = 4;
  const cacheKey = user?.id && tenantId ? `${CACHE_PREFIX}${user.id}:${tenantId}` : null;

  useEffect(() => {
    const sequence = ++requestSequence.current;
    let active = true;

    if (authLoading) return () => { active = false; };
    if (!user) {
      setItems([]);
      setDisplayedTenantId(null);
      displayedCacheKeyRef.current = null;
      setLoading(false);
      setLoadError('');
      return () => { active = false; };
    }

    if (!tenantId) {
      setDisplayedTenantId(null);
      displayedCacheKeyRef.current = null;
      setItems([]);
      setLoading(false);
      setLoadError('');
      return () => { active = false; };
    }

    // Keep the last known-good offers through short auth/token hydration gaps.
    // Never show one pharmacy's offers under another pharmacy's heading.
    if (displayedCacheKeyRef.current && displayedCacheKeyRef.current !== cacheKey) {
      setItems([]);
      setLoadError('');
    }
    if (!isFullyAuthenticated) {
      setLoading(false);
      return () => { active = false; };
    }

    const cachedItems = readCampaignCache(cacheKey);
    setItems(cachedItems || []);
    setDisplayedTenantId(tenantId);
    displayedCacheKeyRef.current = cacheKey;
    setCurrentPage(1);
    setLoadError('');
    setLoading(true);

    apiClient.get('/api/surplus-savings', { params: { tenantId } })
      .then(({ data }) => {
        if (!active || sequence !== requestSequence.current) return;
        const nextItems = Array.isArray(data?.items) ? data.items : [];
        setItems(nextItems);
        writeCampaignCache(cacheKey, nextItems);
        setLoadError('');
      })
      .catch(error => {
        if (!active || sequence !== requestSequence.current) return;
        // Keep the last known-good campaign list during temporary auth/network/API
        // failures. An error is not proof that the pharmacy has no active offers.
        setLoadError(error?.response?.data?.message || error?.message || 'Surplus Savings are temporarily unavailable.');
      })
      .finally(() => {
        if (active && sequence === requestSequence.current) setLoading(false);
      });

    return () => { active = false; };
  }, [user?.id, authLoading, isFullyAuthenticated, tenantId, cacheKey]);

  if (authLoading || !user || !tenantId || (displayedTenantId && displayedTenantId !== tenantId)) return null;

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
    <section className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 rounded-2xl sm:rounded-3xl p-5 sm:p-7 text-white shadow-lg shadow-orange-500/20 space-y-4 my-6 relative overflow-hidden" aria-label={t("exclusiveSurplusSavings")}>
      <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-white/10 skew-x-12 pointer-events-none" />
      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <span className="bg-white/20 px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-black uppercase tracking-wider backdrop-blur-md">
            Pharmacy-verified clearance offers
          </span>
          <h2 className="text-base sm:text-xl font-black tracking-tight text-white mt-2">{t('exclusiveSurplusSavings')}</h2>
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

      {loading && <p className="relative z-10 text-xs font-semibold">{items.length ? t('refreshingPharmacySavings') : t('loadingPharmacySavings')}</p>}
      {loadError && <p role="alert" className="relative z-10 text-xs font-semibold">{loadError} {items.length > 0 ? 'Showing the last successfully loaded offers.' : ''}</p>}
      {!loading && !loadError && items.length === 0 && (
        <p className="relative z-10 text-xs font-semibold">{t('noActiveSurplusCampaigns')}</p>
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
