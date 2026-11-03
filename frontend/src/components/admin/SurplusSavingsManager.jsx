import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useApp } from '../../context/AppContext';
import { useTenant } from '../../context/TenantContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';

const toLocalDateTime = value => {
  const date = value ? new Date(value) : new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

export default function SurplusSavingsManager({ canManage = false }) {
  const { medicines } = useApp();
  const { tenantId } = useTenant();
  const { addToast } = useToast();
  const { t } = useLanguage();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '', description: '', medicineIds: [], discountType: 'percentage',
    discountValue: '15', maxDiscountAmount: '', minOrderAmount: '0',
    startsAt: toLocalDateTime(), endsAt: toLocalDateTime(Date.now() + 7 * 86400000),
    usageLimit: '', status: 'DRAFT'
  });

  const loadCampaigns = useCallback(async () => {
    if (!tenantId) {
      setCampaigns([]);
      setError(t('selectPharmacyCampaigns'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await apiClient.get('/api/surplus-savings/admin', { params: { tenantId } });
      setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : []);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || t('couldNotLoadCampaigns'));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  const selectableMedicines = useMemo(() => Array.isArray(medicines) ? medicines.filter(item => item?._id) : [], [medicines]);
  const updateForm = (field, value) => setForm(current => ({ ...current, [field]: value }));
  const toggleMedicine = id => updateForm('medicineIds', form.medicineIds.includes(id)
    ? form.medicineIds.filter(value => value !== id)
    : [...form.medicineIds, id]);

  const createCampaign = async event => {
    event.preventDefault();
    if (!canManage || saving) return;
    if (!form.name.trim() || form.medicineIds.length === 0) {
      setError(t('enterCampaignSelectMedicine'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiClient.post('/api/surplus-savings/admin', {
        ...form,
        tenantId,
        discountValue: Number(form.discountValue),
        maxDiscountAmount: form.maxDiscountAmount === '' ? null : Number(form.maxDiscountAmount),
        minOrderAmount: Number(form.minOrderAmount || 0),
        usageLimit: form.usageLimit === '' ? null : Number(form.usageLimit),
        perCustomerLimit: 1,
        medicineIds: form.medicineIds,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString()
      });
      setForm(current => ({ ...current, name: '', description: '', medicineIds: [], status: 'DRAFT' }));
      addToast(t('campaignCreated'), 'success');
      await loadCampaigns();
    } catch (err) {
      const message = err?.response?.data?.message || err.message || t('campaignSavedFailed');
      setError(message);
      addToast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const setCampaignStatus = async (campaign, status) => {
    if (!canManage) return;
    try {
      await apiClient.patch(`/api/surplus-savings/admin/${campaign._id}`, { tenantId, status });
      addToast(status === 'ACTIVE' ? t('campaignActivated') : t('campaignPaused'), 'success');
      await loadCampaigns();
    } catch (err) {
      addToast(err?.response?.data?.message || t('campaignStatusFailed'), 'error');
    }
  };

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">{t('tenantPromotions')}</p>
        <h2 className="mt-1 text-lg font-black text-slate-900 dark:text-white">{t('exclusiveSurplusSavings')}</h2>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{t('surplusCampaignDescription')}</p>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</div>}

      {canManage && (
        <form onSubmit={createCampaign} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <h3 className="text-sm font-black text-slate-900 dark:text-white">{t('createCampaign')}</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs font-bold text-slate-600 dark:text-slate-300">{t('campaignName')}
              <input required maxLength={120} value={form.name} onChange={e => updateForm('name', e.target.value)} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder={t('nearExpiryClearance')} />
            </label>
            <label className="space-y-1 text-xs font-bold text-slate-600 dark:text-slate-300">{t('discountType')}
              <select value={form.discountType} onChange={e => updateForm('discountType', e.target.value)} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950">
                <option value="percentage">{t('percentage')}</option><option value="fixed">{t('fixedPerUnit')}</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-bold text-slate-600 dark:text-slate-300">Discount value
              <input required type="number" min="0.01" max={form.discountType === 'percentage' ? 100 : undefined} step="0.01" value={form.discountValue} onChange={e => updateForm('discountValue', e.target.value)} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label className="space-y-1 text-xs font-bold text-slate-600 dark:text-slate-300">Maximum savings per order (optional)
              <input type="number" min="0.01" step="0.01" value={form.maxDiscountAmount} onChange={e => updateForm('maxDiscountAmount', e.target.value)} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder={t('noCap')} />
            </label>
            <label className="space-y-1 text-xs font-bold text-slate-600 dark:text-slate-300">Minimum basket value (₹)
              <input type="number" min="0" step="0.01" value={form.minOrderAmount} onChange={e => updateForm('minOrderAmount', e.target.value)} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label className="space-y-1 text-xs font-bold text-slate-600 dark:text-slate-300">Total campaign redemptions (optional)
              <input type="number" min="1" step="1" value={form.usageLimit} onChange={e => updateForm('usageLimit', e.target.value)} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder={t('unlimited')} />
            </label>
            <label className="space-y-1 text-xs font-bold text-slate-600 dark:text-slate-300">Starts at
              <input required type="datetime-local" value={form.startsAt} onChange={e => updateForm('startsAt', e.target.value)} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label className="space-y-1 text-xs font-bold text-slate-600 dark:text-slate-300">Ends at
              <input required type="datetime-local" value={form.endsAt} onChange={e => updateForm('endsAt', e.target.value)} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
          </div>
          <label className="block space-y-1 text-xs font-bold text-slate-600 dark:text-slate-300">Description
            <textarea maxLength={500} rows={2} value={form.description} onChange={e => updateForm('description', e.target.value)} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder={t('campaignDescriptionPlaceholder')} />
          </label>
          <div className="space-y-2">
            <div className="flex items-center justify-between"><h4 className="text-xs font-black text-slate-800 dark:text-slate-200">{t('selectPharmacyMedicines')}</h4><span className="text-[10px] text-slate-500">{form.medicineIds.length} {t('selectedCount')}</span></div>
            {selectableMedicines.length === 0 ? <p className="text-xs text-slate-500">{t('noTenantMedicines')}</p> : (
              <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {selectableMedicines.map(item => (
                  <label key={item._id} className="flex items-center gap-2 rounded-lg p-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800">
                    <input type="checkbox" checked={form.medicineIds.includes(String(item._id))} onChange={() => toggleMedicine(String(item._id))} />
                    <span className="min-w-0 flex-1 truncate">{item.name || item.title}</span>
                    <span className="text-slate-500">₹{Number(item.price || 0).toFixed(2)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <button type="submit" disabled={saving || form.medicineIds.length === 0} className="rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-black text-white hover:bg-amber-700 disabled:opacity-50">{saving ? 'Saving…' : 'Create campaign'}</button>
        </form>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-black text-slate-900 dark:text-white">{t('campaignHistory')}</h3><button type="button" onClick={loadCampaigns} disabled={loading} className="text-xs font-bold text-blue-600 disabled:opacity-50">{t('refreshStatus')}</button></div>
        {loading ? <p className="py-6 text-center text-xs text-slate-500">{t('loadCampaigns')}</p> : campaigns.length === 0 ? <p className="py-6 text-center text-xs text-slate-500">{t('noCampaignsYet')}</p> : (
          <div className="space-y-3">
            {campaigns.map(campaign => (
              <article key={campaign._id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h4 className="text-xs font-black text-slate-900 dark:text-white">{campaign.name}</h4><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${campaign.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{campaign.status}</span></div>
                  <p className="mt-1 text-[11px] text-slate-500">{campaign.discountType === 'percentage' ? `${campaign.discountValue}% off` : `₹${campaign.discountValue} off per unit`} · {campaign.medicineIds?.length || 0} products · {campaign.usageCount || 0}{campaign.usageLimit ? `/${campaign.usageLimit}` : ''} redemptions</p>
                  <p className="text-[10px] text-slate-400">{new Date(campaign.startsAt).toLocaleString()} – {new Date(campaign.endsAt).toLocaleString()}</p>
                </div>
                {canManage && <div className="flex gap-2">{campaign.status !== 'ACTIVE' && <button type="button" onClick={() => setCampaignStatus(campaign, 'ACTIVE')} className="rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-black text-white">{t('activate')}</button>}{campaign.status === 'ACTIVE' && <button type="button" onClick={() => setCampaignStatus(campaign, 'PAUSED')} className="rounded-lg bg-amber-600 px-3 py-2 text-[10px] font-black text-white">{t('pause')}</button>}</div>}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
