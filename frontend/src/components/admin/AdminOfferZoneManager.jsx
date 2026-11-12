import React, { useState, useEffect, useMemo } from 'react';
import { getReadableErrorMessage } from '../../utils/errorMessage';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
import apiClient from '../../api/apiClient';

export default function AdminOfferZoneManager() {
  const { t } = useLanguage();
  const {
    medicines, orders, searchQuery, setSearchQuery, selectedCategory,
    setSelectedCategory, page, setPage, totalPages, totalMedicines, limit, setLimit
  } = useApp();
  const { tenantId } = useTenant();
  const { addToast } = useToast();
  const [campaigns, setCampaigns] = useState([]);
  const [campaignLoadError, setCampaignLoadError] = useState('');
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [campaignDraft, setCampaignDraft] = useState({ name: '', description: '', status: 'DRAFT', endsAt: '' });
  const [campaignSaving, setCampaignSaving] = useState(false);

  const search = searchQuery;
  const filterCategory = selectedCategory;
  const [offerZoneOverrides, setOfferZoneOverrides] = useState({});
  const [discountOverrides, setDiscountOverrides] = useState({});
  const [reasonOverrides, setReasonOverrides] = useState({});

  useEffect(() => {
    if (!tenantId) { setCampaigns([]); return undefined; }
    let active = true;
    apiClient.get('/api/surplus-savings/admin', { params: { tenantId } })
      .then(response => {
        if (active) {
          const rows = response.data?.campaigns || response.data?.data?.campaigns || [];
          setCampaigns(Array.isArray(rows) ? rows : []);
          setCampaignLoadError('');
        }
      })
      .catch(error => {
        if (active) setCampaignLoadError(getReadableErrorMessage(error, 'Campaigns could not be loaded.'));
      });
    return () => { active = false; };
  }, [tenantId]);

  useEffect(() => { setPage(1); }, [search, filterCategory, limit, setPage]);

  const beginCampaignEdit = campaign => {
    setEditingCampaign(String(campaign._id || campaign.id));
    setCampaignDraft({
      name: campaign.name || '',
      description: campaign.description || '',
      status: campaign.status || 'DRAFT',
      endsAt: campaign.endsAt ? new Date(campaign.endsAt).toISOString().slice(0, 10) : ''
    });
  };

  const saveCampaign = async event => {
    event.preventDefault();
    if (!editingCampaign || !tenantId) return;
    setCampaignSaving(true);
    try {
      const response = await apiClient.patch(
        `/api/surplus-savings/admin/${encodeURIComponent(editingCampaign)}`,
        { tenantId, ...campaignDraft, endsAt: campaignDraft.endsAt ? new Date(campaignDraft.endsAt).toISOString() : undefined }
      );
      const updated = response.data?.campaign;
      if (updated) setCampaigns(current => current.map(item => String(item._id || item.id) === editingCampaign ? updated : item));
      setEditingCampaign(null);
      addToast('Campaign updated successfully.', 'success');
    } catch (error) {
      addToast(getReadableErrorMessage(error, 'Campaign could not be updated.'), 'error');
    } finally {
      setCampaignSaving(false);
    }
  };

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

    const catalogItems = (Array.isArray(medicines) ? medicines : []).map(med => {
      const name = med.name || med.title || 'Medicine';
      const category = (med.category || 'General').toLowerCase();
      const soldCount = salesFrequencyMap[name] || 0;

      let isSeasonalRecommended = false;
      let seasonReason = 'Standard essential medicine';
      if (isColdSeason && (category.includes('cough') || category.includes('cold') || category.includes('fever') || name.toLowerCase().includes('paracetamol') || name.toLowerCase().includes('azithromycin'))) {
        isSeasonalRecommended = true;
        seasonReason = 'Seasonal category match: cold, flu and cough care.';
      } else if (isMonsoonSeason && (category.includes('fever') || category.includes('infection') || name.toLowerCase().includes('multivitamin'))) {
        isSeasonalRecommended = true;
        seasonReason = 'Seasonal category match: fever, infection and immunity support.';
      } else if (!isColdSeason && !isMonsoonSeason && (category.includes('allergy') || category.includes('stomach') || category.includes('antacid') || name.toLowerCase().includes('cetirizine'))) {
        isSeasonalRecommended = true;
        seasonReason = 'Seasonal category match: allergy and digestion care.';
      }

      const override = offerZoneOverrides[med.id || med._id] ?? false;
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

  const paginatedMedicines = filteredMedicines;
  const visibleTotalPages = Math.max(1, Number(totalPages) || 1);

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
            ⚡ Pharmacy Admin Offer Zone &amp; Rule-based Recommendations
          </span>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight mt-2 text-white">
            Offer Zone Curation &amp; Seasonal Demand Insights
          </h2>
          <p className="text-xs sm:text-sm text-indigo-100 max-w-2xl mt-1 leading-relaxed">
            Review seasonal and sales-based product recommendations. Only saved, active campaigns in the Saved campaigns section are published to customers.
          </p>
        </div>

        {/* Season & Analytics Badge */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 relative z-10 border-t border-white/20">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3">
            <div className="text-[10px] uppercase font-bold text-indigo-200">{t('currentDetectedSeason')}</div>
            <div className="text-sm font-black text-white">{seasonName}</div>
          </div>
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3">
            <div className="text-[10px] uppercase font-bold text-indigo-200">Preview selections</div>
            <div className="text-sm font-black text-white">
              {catalogItems.filter(i => i.isInOfferZone).length} Selected (preview only)
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3">
            <div className="text-[10px] uppercase font-bold text-indigo-200">Recommendation logic</div>
            <div className="text-sm font-black text-emerald-300">Rule-based</div>
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
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-2.5 text-xs text-slate-900 dark:text-white outline-none focus:border-indigo-600 transition"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {categories.slice(0, 6).map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
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

      {/* Persisted campaign management: edits call the tenant-scoped campaign API. */}
      <section className="rounded-3xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white">Saved campaigns</h3>
            <p className="text-xs text-slate-500">Edit campaign details and status; changes are saved to the selected pharmacy.</p>
          </div>
          <span className="text-xs font-bold text-slate-500">{campaigns.length} campaigns</span>
        </div>
        {campaignLoadError && <p role="alert" className="text-xs text-rose-600">{campaignLoadError}</p>}
        {!campaignLoadError && campaigns.length === 0 && <p className="text-xs text-slate-500">No saved campaigns found for this pharmacy.</p>}
        <div className="space-y-2">
          {campaigns.map(campaign => (
            <div key={campaign._id || campaign.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 dark:border-slate-800 p-3">
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-slate-900 dark:text-white">{campaign.name}</p>
                <p className="text-[11px] text-slate-500">{campaign.status} · Ends {campaign.endsAt ? new Date(campaign.endsAt).toLocaleDateString() : 'not set'}</p>
              </div>
              <button type="button" onClick={() => beginCampaignEdit(campaign)} className="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100">Edit campaign</button>
            </div>
          ))}
        </div>
        {editingCampaign && (
          <form onSubmit={saveCampaign} className="grid gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 sm:grid-cols-2">
            <label className="text-xs font-bold text-slate-700">Campaign name
              <input required maxLength={120} value={campaignDraft.name} onChange={event => setCampaignDraft(current => ({ ...current, name: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </label>
            <label className="text-xs font-bold text-slate-700">End date
              <input required type="date" value={campaignDraft.endsAt} onChange={event => setCampaignDraft(current => ({ ...current, endsAt: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
            </label>
            <label className="text-xs font-bold text-slate-700 sm:col-span-2">Description
              <textarea maxLength={500} value={campaignDraft.description} onChange={event => setCampaignDraft(current => ({ ...current, description: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" rows={2} />
            </label>
            <label className="text-xs font-bold text-slate-700">Status
              <select value={campaignDraft.status} onChange={event => setCampaignDraft(current => ({ ...current, status: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                <option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option>
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button type="submit" disabled={campaignSaving} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{campaignSaving ? 'Saving…' : 'Save campaign'}</button>
              <button type="button" disabled={campaignSaving} onClick={() => setEditingCampaign(null)} className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-600">Cancel</button>
            </div>
          </form>
        )}
      </section>

      {/* Product Offer Configuration Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm overflow-hidden space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white">{t('productOfferRecommendationControl')}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('toggleOfferZoneDiscount')} · Preview only; use Saved campaigns to persist customer-facing promotions.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
              Medicines per page
              <select value={limit} onChange={event => setLimit(Number(event.target.value))} className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-white" aria-label="Medicines per page">
                <option value={16}>16</option><option value={32}>32</option><option value={48}>48</option><option value={64}>64</option>
              </select>
            </label>
            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-3 py-1.5 rounded-xl w-fit">
              Showing {paginatedMedicines.length} of {Number(totalMedicines || filteredMedicines.length)} medicines (Page {page} of {visibleTotalPages})
            </span>
          </div>
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
        {visibleTotalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={() => setPage(p => Math.max(p - 1, 1))}
              disabled={page === 1}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-extrabold text-xs rounded-xl disabled:opacity-40 transition cursor-pointer"
            >
              ← Previous Page
            </button>
            <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
              Page {page} of {visibleTotalPages} ({limit} records per page)
            </span>
            <button
              onClick={() => setPage(p => Math.min(p + 1, visibleTotalPages))}
              disabled={page === visibleTotalPages}
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
