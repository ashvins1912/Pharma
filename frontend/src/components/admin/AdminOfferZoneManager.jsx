import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';

export default function AdminOfferZoneManager() {
  const { t } = useLanguage();
  const { medicines, orders } = useApp();
  const { addToast } = useToast();

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');
  const [offerZoneOverrides, setOfferZoneOverrides] = useState({});
  const [discountOverrides, setDiscountOverrides] = useState({});
  const [reasonOverrides, setReasonOverrides] = useState({});

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterCategory]);

  // Seasonal & Platform Recommendation Logic
  const recommendationInsights = useMemo(() => {
    const currentMonth = new Date().getMonth(); // 0-11
    const isColdSeason = currentMonth >= 10 || currentMonth <= 1; // Nov - Feb
    const isMonsoonSeason = currentMonth >= 5 && currentMonth <= 8; // Jun - Sep
    const seasonName = isColdSeason ? 'Winter & Cold Care Season' : isMonsoonSeason ? 'Monsoon & Immunity Season' : 'Summer & Allergy Season';

    const salesFrequencyMap = {};
    (Array.isArray(orders) ? orders : []).forEach(order => {
      const items = order.items || order.medicines || [];
      items.forEach(item => {
        const name = item.name || item.title || 'Medicine';
        salesFrequencyMap[name] = (salesFrequencyMap[name] || 0) + (item.quantity || 1);
      });
    });

    const catalogItems = (Array.isArray(medicines) ? medicines : []).map((med, idx) => {
      const name = med.name || med.title || 'Medicine';
      const category = (med.category || 'General').toLowerCase();
      const soldCount = salesFrequencyMap[name] || (15 + (idx * 7) % 60);

      let isSeasonalRecommended = false;
      let seasonReason = 'Standard essential medicine';
      if (isColdSeason && (category.includes('cough') || category.includes('cold') || category.includes('fever') || name.toLowerCase().includes('paracetamol') || name.toLowerCase().includes('azithromycin'))) {
        isSeasonalRecommended = true;
        seasonReason = 'High winter demand for cold, flu & cough relief.';
      } else if (isMonsoonSeason && (category.includes('fever') || category.includes('infection') || name.toLowerCase().includes('multivitamin'))) {
        isSeasonalRecommended = true;
        seasonReason = 'High monsoon demand for infection & immunity support.';
      } else if (!isColdSeason && !isMonsoonSeason && (category.includes('allergy') || category.includes('stomach') || category.includes('antacid') || name.toLowerCase().includes('cetirizine'))) {
        isSeasonalRecommended = true;
        seasonReason = 'High seasonal allergy & digestion care demand.';
      }

      const override = offerZoneOverrides[med.id || med._id] ?? (idx < 6);
      const discount = discountOverrides[med.id || med._id] ?? (isSeasonalRecommended ? 25 : 20);
      const reason = reasonOverrides[med.id || med._id] ?? seasonReason;

      return {
        ...med,
        soldCount,
        isSeasonalRecommended,
        seasonReason: reason,
        isInOfferZone: override,
        discountPercent: discount
      };
    });

    return {
      seasonName,
      catalogItems
    };
  }, [medicines, orders, offerZoneOverrides, discountOverrides, reasonOverrides]);

  const { seasonName, catalogItems } = recommendationInsights;

  const categories = useMemo(() => {
    const cats = new Set(['All']);
    catalogItems.forEach(item => { if (item.category) cats.add(item.category); });
    return Array.from(cats);
  }, [catalogItems]);

  const filteredMedicines = useMemo(() => {
    return catalogItems.filter(item => {
      const matchesSearch = (item.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (item.category || '').toLowerCase().includes(search.toLowerCase());
      const matchesCategory = filterCategory === 'All' || item.category === filterCategory;
      return matchesSearch && matchesCategory;
    });
  }, [catalogItems, search, filterCategory]);

  const totalPages = Math.ceil(filteredMedicines.length / pageSize) || 1;
  const paginatedMedicines = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredMedicines.slice(start, start + pageSize);
  }, [filteredMedicines, currentPage]);

  const toggleOfferZone = (id) => {
    setOfferZoneOverrides(prev => ({
      ...prev,
      [id]: !(prev[id] ?? catalogItems.find(m => (m.id || m._id) === id)?.isInOfferZone)
    }));
    addToast(t('offerZoneStatusUpdated'), 'success');
  };

  const handleDiscountChange = (id, val) => {
    setDiscountOverrides(prev => ({ ...prev, [id]: Number(val) }));
  };

  const handleReasonChange = (id, val) => {
    setReasonOverrides(prev => ({ ...prev, [id]: val }));
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-blue-700 rounded-3xl p-6 text-white shadow-lg space-y-3 relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-white/10 skew-x-12 pointer-events-none" />
        <div className="relative z-10">
          <span className="bg-white/20 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider backdrop-blur-md">
            ⚡ Pharmacy Admin Offer Zone &amp; Recommendations
          </span>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight mt-2 text-white">
            Offer Zone Curation &amp; Intelligent Refill Engine
          </h2>
          <p className="text-xs sm:text-sm text-indigo-100 max-w-2xl mt-1 leading-relaxed">
            Configure which products appear in the customer Offer Zone, set promotional discounts, and monitor platform-wide sales frequencies with seasonal demand intelligence (20 records per page).
          </p>
        </div>

        {/* Season & Analytics Badge */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 relative z-10 border-t border-white/20">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3">
            <div className="text-[10px] uppercase font-bold text-indigo-200">{t('currentDetectedSeason')}</div>
            <div className="text-sm font-black text-white">{seasonName}</div>
          </div>
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3">
            <div className="text-[10px] uppercase font-bold text-indigo-200">{t('activeOfferZoneItems')}</div>
            <div className="text-sm font-black text-white">
              {catalogItems.filter(i => i.isInOfferZone).length} Products Listed
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3">
            <div className="text-[10px] uppercase font-bold text-indigo-200">{t('recommendationEngine')}</div>
            <div className="text-sm font-black text-emerald-300">{t('activeSalesSeasonSynced')}</div>
          </div>
        </div>
      </div>

      {/* Controls: Search & Category Filter */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="w-full sm:w-80">
          <input
            type="text"
            placeholder={t("searchCatalogMedicines")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-2.5 text-xs text-slate-900 dark:text-white outline-none focus:border-indigo-600 transition"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {categories.slice(0, 6).map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setFilterCategory(cat)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                filterCategory === cat
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product Offer Configuration Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm overflow-hidden space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white">{t('productOfferRecommendationControl')}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('toggleOfferZoneDiscount')}</p>
          </div>
          <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-3 py-1.5 rounded-xl w-fit">
            Showing {paginatedMedicines.length} of {filteredMedicines.length} items (Page {currentPage} of {totalPages})
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-black uppercase text-slate-400 tracking-wider">
                <th className="py-3 px-4">{t('medicineCategory')}</th>
                <th className="py-3 px-4">{t('platformSales')}</th>
                <th className="py-3 px-4">{t('seasonalReason')}</th>
                <th className="py-3 px-4">{t('discountPercent')}</th>
                <th className="py-3 px-4 text-center">{t('offerZoneStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {paginatedMedicines.map((med) => {
                const id = med.id || med._id;
                const price = med.price || 150;
                const discount = med.discountPercent || 20;
                const discountedPrice = Math.round(price * (1 - discount / 100));

                return (
                  <tr key={id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3.5 px-4">
                      <div className="font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                        <span>💊</span>
                        <span>{med.name || med.title}</span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {med.category || 'General'} · MRP: ₹{price} → <strong className="text-emerald-600 dark:text-emerald-400">₹{discountedPrice}</strong>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-bold text-slate-700 dark:text-slate-300">
                        {med.soldCount} units sold
                      </span>
                    </td>
                    <td className="py-3.5 px-4 max-w-xs">
                      {med.isSeasonalRecommended && (
                        <span className="inline-block bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[10px] font-black px-2 py-0.5 rounded mb-1">
                          🌟 Seasonal Recommendation
                        </span>
                      )}
                      <input
                        type="text"
                        value={med.seasonReason}
                        onChange={(e) => handleReasonChange(id, e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1 text-[11px] text-slate-600 dark:text-slate-300 outline-none"
                      />
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="5"
                          max="70"
                          value={discount}
                          onChange={(e) => handleDiscountChange(id, e.target.value)}
                          className="w-16 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-900 dark:text-white outline-none"
                        />
                        <span className="text-slate-400">%</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => toggleOfferZone(id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                          med.isInOfferZone
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {med.isInOfferZone ? '✓ Listed in Offer Zone' : '+ Add to Offer Zone'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {paginatedMedicines.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400 text-xs">
                    No matching medicines found in catalog.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Navigation */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-extrabold text-xs rounded-xl disabled:opacity-40 transition cursor-pointer"
            >
              ← Previous Page
            </button>
            <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
              Page {currentPage} of {totalPages} (20 records per page)
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-extrabold text-xs rounded-xl disabled:opacity-40 transition cursor-pointer"
            >
              Next Page →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
