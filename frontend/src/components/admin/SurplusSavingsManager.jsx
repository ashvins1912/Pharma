import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getReadableErrorMessage } from '../../utils/errorMessage';
import apiClient from '../../api/apiClient';
import { useApp } from '../../context/AppContext';
import { useTenant } from '../../context/TenantContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import './SurplusSavingsManager.css';

function SectionPagination({ page, pageSize, total, onPageChange, label = 'records' }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);
  if (total <= pageSize) return null;
  return (
    <nav aria-label={`${label} pagination`} className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
      <p className="text-xs text-slate-500">Showing <strong className="text-slate-700">{start}–{end}</strong> of <strong className="text-slate-700">{total}</strong> {label}</p>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
        <span className="min-w-16 text-center text-xs font-bold tabular-nums text-slate-600">Page {page} / {pageCount}</span>
        <button type="button" onClick={() => onPageChange(Math.min(pageCount, page + 1))} disabled={page >= pageCount} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
      </div>
    </nav>
  );
}

const toLocalDateTime = value => {
  const date = value ? new Date(value) : new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function SurplusSavingsManager({ canManage = false }) {
  const { medicines } = useApp();
  const { tenantId, branchId } = useTenant();
  const { addToast } = useToast();
  const { t } = useLanguage();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [medicineQuery, setMedicineQuery] = useState('');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [medicinePage, setMedicinePage] = useState(1);
  const [campaignPage, setCampaignPage] = useState(1);
  const MEDICINES_PER_PAGE = 50;
  const CAMPAIGNS_PER_PAGE = 5;
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
      const { data } = await apiClient.get('/api/surplus-savings/admin', { params: { tenantId, branchId } });
      setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : []);
    } catch (err) {
      setError(getReadableErrorMessage(err, t('couldNotLoadCampaigns')));
    } finally {
      setLoading(false);
    }
  }, [tenantId, branchId, t]);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  const selectableMedicines = useMemo(() => Array.isArray(medicines) ? medicines.filter(item => item?._id) : [], [medicines]);
  const filteredMedicines = useMemo(() => selectableMedicines.filter(item => {
    const name = String(item.name || item.title || '');
    const matchesQuery = name.toLocaleLowerCase().includes(medicineQuery.trim().toLocaleLowerCase());
    const isSelected = form.medicineIds.includes(String(item._id));
    return matchesQuery && (!showSelectedOnly || isSelected);
  }), [selectableMedicines, medicineQuery, showSelectedOnly, form.medicineIds]);
  const visibleMedicines = useMemo(() => filteredMedicines.slice((medicinePage - 1) * MEDICINES_PER_PAGE, medicinePage * MEDICINES_PER_PAGE), [filteredMedicines, medicinePage]);
  const visibleCampaigns = useMemo(() => campaigns.slice((campaignPage - 1) * CAMPAIGNS_PER_PAGE, campaignPage * CAMPAIGNS_PER_PAGE), [campaigns, campaignPage]);
  useEffect(() => { setMedicinePage(1); }, [medicineQuery, showSelectedOnly]);
  useEffect(() => { setMedicinePage(page => Math.min(page, Math.max(1, Math.ceil(filteredMedicines.length / MEDICINES_PER_PAGE)))); }, [filteredMedicines.length]);
  useEffect(() => { setCampaignPage(page => Math.min(page, Math.max(1, Math.ceil(campaigns.length / CAMPAIGNS_PER_PAGE)))); }, [campaigns.length]);

  const selectedMedicines = useMemo(
    () => selectableMedicines.filter(item => form.medicineIds.includes(String(item._id))),
    [selectableMedicines, form.medicineIds]
  );
  const summary = useMemo(() => ({
    active: campaigns.filter(item => item.status === 'ACTIVE').length,
    drafts: campaigns.filter(item => item.status === 'DRAFT').length,
    redemptions: campaigns.reduce((total, item) => total + Number(item.usageCount || 0), 0),
    products: campaigns.reduce((total, item) => total + (Array.isArray(item.medicineIds) ? item.medicineIds.length : 0), 0)
  }), [campaigns]);

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
    if (!Number.isFinite(Number(form.discountValue)) || Number(form.discountValue) <= 0
      || (form.discountType === 'percentage' && Number(form.discountValue) > 100)
      || new Date(form.endsAt) <= new Date(form.startsAt)) {
      setError('Enter a valid discount and ensure the end date is after the start date.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiClient.post('/api/surplus-savings/admin', {
        ...form,
        tenantId,
        branchId,
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
      const message = getReadableErrorMessage(err, t('campaignSavedFailed'));
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
      addToast(getReadableErrorMessage(err, t('campaignStatusFailed')), 'error');
    }
  };

  return (
    <section className="admin-screen admin-screen--surplus-savings space-y-5">
      <header className="surplus-page-hero">
        <div className="surplus-hero-copy">
          <span className="surplus-eyebrow"><span aria-hidden="true">✦</span> {t('tenantPromotions')}</span>
          <h2>{t('exclusiveSurplusSavings')}</h2>
          <p>{t('surplusCampaignDescription')}</p>
        </div>
        {canManage && <a href="#surplus-campaign-form" className="surplus-hero-action">＋ Create campaign</a>}
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}

      <div className="surplus-summary-grid" aria-label="Campaign overview">
        <article className="surplus-summary-card"><span className="surplus-summary-icon surplus-summary-icon--active" aria-hidden="true">◉</span><div><p>Active campaigns</p><strong>{summary.active}</strong></div></article>
        <article className="surplus-summary-card"><span className="surplus-summary-icon surplus-summary-icon--draft" aria-hidden="true">✎</span><div><p>Draft campaigns</p><strong>{summary.drafts}</strong></div></article>
        <article className="surplus-summary-card"><span className="surplus-summary-icon surplus-summary-icon--redemptions" aria-hidden="true">↗</span><div><p>Total redemptions</p><strong>{summary.redemptions.toLocaleString('en-IN')}</strong></div></article>
        <article className="surplus-summary-card"><span className="surplus-summary-icon surplus-summary-icon--products" aria-hidden="true">▦</span><div><p>Products enrolled</p><strong>{summary.products.toLocaleString('en-IN')}</strong></div></article>
      </div>

      {canManage && (
        <form id="surplus-campaign-form" onSubmit={createCampaign} className="surplus-form-card">
          <div className="surplus-section-heading">
            <div><span className="surplus-step">01</span><div><h3>Create a savings campaign</h3><p>Set your offer, schedule and eligible medicines.</p></div></div>
            <span className="surplus-required-note">* Required</span>
          </div>

          <section className="surplus-form-section" aria-labelledby="surplus-details-title">
            <h4 id="surplus-details-title">Campaign details</h4>
            <div className="surplus-form-grid">
              <label className="surplus-field surplus-field--wide"><span>Campaign name <b>*</b></span><input required maxLength={120} value={form.name} onChange={e => updateForm('name', e.target.value)} placeholder={t('nearExpiryClearance')} /></label>
              <label className="surplus-field"><span>Discount type</span><select value={form.discountType} onChange={e => updateForm('discountType', e.target.value)}><option value="percentage">{t('percentage')}</option><option value="fixed">{t('fixedPerUnit')}</option></select></label>
              <label className="surplus-field"><span>Discount value <b>*</b></span><div className="surplus-input-suffix"><input required type="number" min="0.01" max={form.discountType === 'percentage' ? 100 : undefined} step="0.01" value={form.discountValue} onChange={e => updateForm('discountValue', e.target.value)} /><span>{form.discountType === 'percentage' ? '%' : '₹'}</span></div></label>
              <label className="surplus-field"><span>Maximum savings per order</span><div className="surplus-input-suffix"><input type="number" min="0.01" step="0.01" value={form.maxDiscountAmount} onChange={e => updateForm('maxDiscountAmount', e.target.value)} placeholder={t('noCap')} /><span>₹</span></div></label>
              <label className="surplus-field"><span>Minimum basket value</span><div className="surplus-input-suffix"><input type="number" min="0" step="0.01" value={form.minOrderAmount} onChange={e => updateForm('minOrderAmount', e.target.value)} /><span>₹</span></div></label>
              <label className="surplus-field"><span>Total redemptions limit</span><input type="number" min="1" step="1" value={form.usageLimit} onChange={e => updateForm('usageLimit', e.target.value)} placeholder={t('unlimited')} /></label>
            </div>
          </section>

          <section className="surplus-form-section" aria-labelledby="surplus-schedule-title">
            <h4 id="surplus-schedule-title">Schedule & message</h4>
            <div className="surplus-form-grid">
              <label className="surplus-field"><span>Starts at <b>*</b></span><input required type="datetime-local" value={form.startsAt} onChange={e => updateForm('startsAt', e.target.value)} /></label>
              <label className="surplus-field"><span>Ends at <b>*</b></span><input required type="datetime-local" min={form.startsAt} value={form.endsAt} onChange={e => updateForm('endsAt', e.target.value)} /></label>
              <label className="surplus-field surplus-field--wide"><span>Customer-facing description</span><textarea maxLength={500} rows={3} value={form.description} onChange={e => updateForm('description', e.target.value)} placeholder={t('campaignDescriptionPlaceholder')} /></label>
            </div>
          </section>

          <section className="surplus-form-section" aria-labelledby="surplus-medicines-title">
            <div className="surplus-medicine-heading"><div><h4 id="surplus-medicines-title">Eligible medicines</h4><p>Choose the products included in this offer.</p></div><span className="surplus-selected-count">{form.medicineIds.length} selected</span></div>
            <div className="surplus-medicine-tools"><label className="surplus-search"><span aria-hidden="true">⌕</span><input type="search" value={medicineQuery} onChange={e => setMedicineQuery(e.target.value)} placeholder="Search medicines by name…" aria-label="Search medicines" /></label><label className="surplus-selected-filter"><input type="checkbox" checked={showSelectedOnly} onChange={e => setShowSelectedOnly(e.target.checked)} /> Selected only</label></div>
            {selectableMedicines.length === 0 ? <p className="surplus-empty-state">{t('noTenantMedicines')}</p> : filteredMedicines.length === 0 ? <p className="surplus-empty-state">No medicines match this filter.</p> : (
              <div className="surplus-medicine-list">
                {visibleMedicines.map(item => {
                  const selected = form.medicineIds.includes(String(item._id));
                  return <label key={item._id} className={`surplus-medicine-option${selected ? ' is-selected' : ''}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleMedicine(String(item._id))} />
                    <span className="surplus-medicine-name">{item.name || item.title}</span>
                    <span className="surplus-medicine-price">{money(item.price)}</span>
                  </label>;
                })}
              </div>
            )}
            <SectionPagination page={medicinePage} pageSize={MEDICINES_PER_PAGE} total={filteredMedicines.length} onPageChange={setMedicinePage} label="medicines"/>
          </section>

          <aside className="surplus-offer-preview" aria-live="polite">
            <span className="surplus-preview-mark" aria-hidden="true">✦</span>
            <div><span className="surplus-preview-label">Offer preview</span><strong>{form.discountType === 'percentage' ? `${Number(form.discountValue || 0)}% off` : `${money(form.discountValue)} off per unit`}</strong><p>{form.name.trim() || 'Your campaign name'} · {form.medicineIds.length} eligible {form.medicineIds.length === 1 ? 'medicine' : 'medicines'}{Number(form.minOrderAmount) > 0 ? ` · Minimum basket ${money(form.minOrderAmount)}` : ''}</p></div>
          </aside>

          <div className="surplus-form-actions"><span>{form.medicineIds.length ? `${form.medicineIds.length} medicines included` : 'Select at least one medicine to continue'}</span><button type="submit" disabled={saving || form.medicineIds.length === 0}>{saving ? 'Saving campaign…' : 'Create campaign'} <span aria-hidden="true">→</span></button></div>
        </form>
      )}

      <section className="surplus-history-card" aria-labelledby="surplus-history-title">
        <div className="surplus-history-heading"><div><span className="surplus-step">02</span><div><h3 id="surplus-history-title">{t('campaignHistory')}</h3><p>Review and manage your savings campaigns.</p></div></div><button type="button" onClick={loadCampaigns} disabled={loading} className="surplus-refresh-button"><span aria-hidden="true">↻</span> {loading ? 'Refreshing…' : t('refreshStatus')}</button></div>
        {loading ? <div className="surplus-loading-state" role="status">Loading campaigns…</div> : campaigns.length === 0 ? <div className="surplus-empty-state"><span aria-hidden="true">✦</span><strong>{t('noCampaignsYet')}</strong><p>Create a savings campaign to start enrolling eligible medicines.</p>{canManage && <a href="#surplus-campaign-form">Create your first campaign</a>}</div> : (
          <div className="surplus-campaign-list">
            {visibleCampaigns.map(campaign => {
              const status = String(campaign.status || 'DRAFT').toUpperCase();
              const usageCount = Number(campaign.usageCount || 0);
              const usageLimit = Number(campaign.usageLimit || 0);
              const progress = usageLimit > 0 ? Math.min(100, usageCount / usageLimit * 100) : null;
              return <article key={campaign._id} className="surplus-campaign-card">
                <div className="surplus-campaign-main"><div className="surplus-campaign-title-row"><h4>{campaign.name}</h4><span className={`surplus-status-pill surplus-status-pill--${status.toLowerCase()}`}>{status}</span></div>
                  <p className="surplus-campaign-offer">{campaign.discountType === 'percentage' ? `${campaign.discountValue}% off` : `${money(campaign.discountValue)} off per unit`} <span>·</span> {campaign.medicineIds?.length || 0} products</p>
                  <p className="surplus-campaign-dates">{new Date(campaign.startsAt).toLocaleString()} <span>→</span> {new Date(campaign.endsAt).toLocaleString()}</p>
                  <div className="surplus-redemption"><div className="surplus-redemption-label"><span>{usageCount.toLocaleString('en-IN')} redemptions</span><span>{usageLimit ? `${usageLimit.toLocaleString('en-IN')} limit` : 'No limit'}</span></div>{progress !== null && <div className="surplus-progress-track" role="progressbar" aria-label="Campaign redemption progress" aria-valuenow={Math.round(progress)} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${progress}%` }} /></div>}</div>
                </div>
                {canManage && <div className="surplus-campaign-actions">{status !== 'ACTIVE' && <button type="button" onClick={() => setCampaignStatus(campaign, 'ACTIVE')} className="surplus-activate-button">{t('activate')}</button>}{status === 'ACTIVE' && <button type="button" onClick={() => setCampaignStatus(campaign, 'PAUSED')} className="surplus-pause-button">{t('pause')}</button>}</div>}
              </article>;
            })}
          </div>
        )}
        <SectionPagination page={campaignPage} pageSize={CAMPAIGNS_PER_PAGE} total={campaigns.length} onPageChange={setCampaignPage} label="campaigns"/>
      </section>
    </section>
  );
}
