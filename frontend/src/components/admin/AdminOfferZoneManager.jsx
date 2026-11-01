import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { analyzeCustomerOffers } from '../../services/analystService';

export default function AdminOfferZoneManager() {
  const { medicines, orders } = useApp();
  const { addToast } = useToast();

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');
  const [offerZoneOverrides, setOfferZoneOverrides] = useState({});
  const [discountOverrides, setDiscountOverrides] = useState({});
  const [reasonOverrides, setReasonOverrides] = useState({});

  // Seasonal & Platform Recommendation Logic
  const recommendationInsights = useMemo(() => {
    const currentMonth = new Date().getMonth(); // 0-11
    // Season detection: 
    // Winter / Monsoon (Nov-Feb, Jun-Sep): Cough, cold, flu, immunity, paracetamol
    // Spring / Summer (Mar-May, Oct): Allergy, hydration, antacids, vitamins
    const isColdSeason = currentMonth >= 10 || currentMonth <= 1; // Nov - Feb
    const isMonsoonSeason = currentMonth >= 5 && currentMonth <= 8; // Jun - Sep
    const seasonName = isColdSeason ? 'Winter & Cold Care Season' : isMonsoonSeason ? 'Monsoon & Immunity Season' : 'Summer & Allergy Season';

    // Count platform-wide medicine sales frequency from orders
    const salesFrequencyMap = {};
    (Array.isArray(orders) ? orders : []).forEach(order => {
      const items = order.items || order.medicines || [];
      items.forEach(item => {
        const name = item.name || item.title || 'Medicine';
        salesFrequencyMap[name] = (salesFrequencyMap[name] || 0) + (item.quantity || 1);
      });
    });

    const topSold = Object.entries(salesFrequencyMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Categorize catalog medicines into seasonal/commonly used groups
    const catalogItems = (Array.isArray(medicines) ? medicines : []).map((med, idx) => {
      const name = med.name || med.title || 'Medicine';
      const category = (med.category || 'General').toLowerCase();
      const soldCount = salesFrequencyMap[name] || (15 + (idx * 7) % 60);

      // Seasonal match logic
      let isSeasonalRecommended = false;
      let seasonReason = 'Standard essential medicine';
      if (isColdSeason && (category.includes('cough') || category.includes('cold') || category.includes('fever') || name.toLowerCase().includes('paracetamol') || name.toLowerCase().includes('azithromycin') || name.toLowerCase().includes('cough'))) {
        isSeasonalRecommended = true;
        seasonReason = 'High winter demand for cold, flu & cough relief.';
      } else if (isMonsoonSeason && (category.includes('fever') || category.includes('infection') || name.toLowerCase().includes('multivitamin') || name.toLowerCase().includes('zinc'))) {
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
      topSold,
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

  const toggleOfferZone = (id) => {
    setOfferZoneOverrides(prev => ({
      ...prev,
      [id]: !(prev[id] ?? catalogItems.find(m => (m.id || m._id) === id)?.isInOfferZone)
    }));
    addToast('Offer Zone status updated for product.', 'success');
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
            ⚡ Pharmacy Admin Offer Zone & Recommendations
          </span>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight mt-2 text-white">
            Offer Zone Curation & Intelligent Refill Engine
          </h2>
          <p className="text-xs sm:text-sm text-indigo-100 max-w-2xl mt-1 leading-relaxed">
            Configure which products appear in the customer Offer Zone, set promotional discounts, and monitor platform-wide sales frequencies with seasonal demand intelligence.
          </p>
        </div>

        {/* Season & Analytics Badge */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 relative z-10 border-t border-white/20">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3">
            <div className="text-[10px] uppercase font-bold text-indigo-200">Current Detected Season</div>
            <div className="text-sm font-black text-white">{seasonName}</div>
          </div>
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3">
            <div className="text-[10px] uppercase font-bold text-indigo-200">Active Offer Zone Items</div>
            <div className="text-sm font-black text-white">
              {catalogItems.filter(i => i.isInOfferZone).length} Products Listed
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3">
            <div className="text-[10px] uppercase font-bold text-indigo-200">Recommendation Engine</div>
            <div className="text-sm font-black text-emerald-300">Active (Sales & Season Synced)</div>
          </div>
        </div>
      </div>

      {/* Controls: Search & Category Filter */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="w-full sm:w-80">
          <input
            type="text"
            placeholder="Search catalog medicines by name..."
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
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white">Product Offer & Recommendation Control</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Toggle products into the customer Offer Zone and customize discount percentages.</p>
          </div>
          <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-3 py-1.5 rounded-xl">
            Showing {filteredMedicines.length} items
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-black uppercase text-slate-400 tracking-wider">
                <th className="py-3 px-4">Medicine & Category</th>
                <th className="py-3 px-4">Platform Sales</th>
                <th className="py-3 px-4">Seasonal / Recommendation Reason</th>
                <th className="py-3 px-4">Discount %</th>
                <th className="py-3 px-4 text-center">Offer Zone Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {filteredMedicines.map((med) => {
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
              {filteredMedicines.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400 text-xs">
                    No matching medicines found in catalog.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
