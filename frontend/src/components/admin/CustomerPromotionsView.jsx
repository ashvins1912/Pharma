import React, { useEffect, useMemo, useState } from 'react';
import { getReadableErrorMessage } from '../../utils/errorMessage';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';

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

const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;

export default function CustomerPromotionsView({ canManage = false }) {
  const { addToast } = useToast();
  const { t } = useLanguage();
  const [customers, setCustomers] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [search, setSearch] = useState('');
  const [promotionType, setPromotionType] = useState('CUSTOMER_DISCOUNT');
  const [discountType, setDiscountType] = useState('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [minOrderAmount, setMinOrderAmount] = useState('0');
  const [expiryDate, setExpiryDate] = useState('');
  const [code, setCode] = useState('');
  const [label, setLabel] = useState(t('pharmaDiscountForYou'));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customerPage, setCustomerPage] = useState(1);
  const [offerPage, setOfferPage] = useState(1);
  const CUSTOMER_PAGE_SIZE = 10;
  const OFFER_PAGE_SIZE = 10;

  const load = async () => {
    setLoading(true);
    try {
      const [customerResponse, promotionResponse] = await Promise.all([
        apiClient.get('/api/coupons/admin/customers', { params: { search, limit: 100 } }),
        apiClient.get('/api/coupons/admin/customer-promotions')
      ]);
      setCustomers(customerResponse.data?.customers || []);
      setPromotions(promotionResponse.data?.promotions || []);
    } catch (error) {
      addToast(getReadableErrorMessage(error, t('couldNotLoadCustomerPromotions')), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const uniqueCustomers = useMemo(() => Array.from(new Map(customers.map(customer => [String(customer.customerId), customer])).values()), [customers]);
  const visibleCustomers = useMemo(() => uniqueCustomers.slice((customerPage - 1) * CUSTOMER_PAGE_SIZE, customerPage * CUSTOMER_PAGE_SIZE), [uniqueCustomers, customerPage]);
  const visiblePromotions = useMemo(() => promotions.slice((offerPage - 1) * OFFER_PAGE_SIZE, offerPage * OFFER_PAGE_SIZE), [promotions, offerPage]);

  useEffect(() => { setCustomerPage(1); }, [search]);
  useEffect(() => { setCustomerPage(page => Math.min(page, Math.max(1, Math.ceil(uniqueCustomers.length / CUSTOMER_PAGE_SIZE)))); }, [uniqueCustomers.length]);
  useEffect(() => { setOfferPage(page => Math.min(page, Math.max(1, Math.ceil(promotions.length / OFFER_PAGE_SIZE)))); }, [promotions.length]);

  const selected = useMemo(
    () => customers.find(customer => customer.customerId === selectedCustomer),
    [customers, selectedCustomer]
  );
  const selectedHasActiveOffer = promotions.some(promotion =>
    String(promotion.customerId) === String(selectedCustomer) && promotion.isActive
  );

  const createPromotion = async event => {
    event.preventDefault();
    if (!selectedCustomer || !discountValue) {
      addToast(t('selectCustomerAndDiscount'), 'warning');
      return;
    }
    if (selectedHasActiveOffer) {
      addToast(t('activeOfferExists'), 'warning');
      return;
    }
    setSaving(true);
    try {
      await apiClient.post('/api/coupons/admin/customer-promotions', {
        customerId: selectedCustomer,
        promotionType,
        discountType,
        discountValue: Number(discountValue),
        minOrderAmount: Number(minOrderAmount || 0),
        expiryDate: expiryDate || null,
        code: code.trim() || undefined,
        promotionLabel: label.trim() || 'Pharma discount for you',
        customerName: selected?.name || ''
      });
      addToast(promotionType === 'CUSTOMER_COUPON'
        ? t('customerCouponAssigned')
        : t('customerDiscountAssigned'), 'success');
      setDiscountValue('');
      setCode('');
      await load();
    } catch (error) {
      addToast(getReadableErrorMessage(error, t('couldNotCreatePromotion')), 'error');
    } finally {
      setSaving(false);
    }
  };

  const togglePromotion = async promotion => {
    try {
      await apiClient.patch(`/api/coupons/admin/customer-promotions/${promotion._id}`, { isActive: !promotion.isActive });
      addToast(promotion.isActive ? t('offerRevokedNotified') : t('offerReactivated'), 'success');
      await load();
    } catch (error) {
      addToast(getReadableErrorMessage(error, t('couldNotUpdatePromotion')), 'error');
    }
  };

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">{t('customerOffers')}</p>
            <h3 className="mt-1 text-xl font-black text-slate-900">{t('personalDiscountCoupons')}</h3>
            <p className="mt-1 text-xs text-slate-600">{t('offerHistoryTargeting')}</p>
          </div>
          <button type="button" onClick={load} disabled={loading} className="min-h-10 rounded-xl bg-white px-4 text-xs font-black text-slate-700 shadow-sm border border-slate-200 disabled:opacity-50">
            {loading ? t('refreshing') : t('refreshStatus')}
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-black text-slate-900">{t('recentFrequentCustomers')}</h4>
              <p className="text-[11px] text-slate-500">{t('customerRankingNote')}</p>
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} placeholder={t('searchCustomer')} className="w-40 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-blue-500" />
          </div>
          <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
            {visibleCustomers.map(customer => {
              const hasActiveOffer = promotions.some(promotion => String(promotion.customerId) === String(customer.customerId) && promotion.isActive);
              return (
              <button type="button" key={customer.customerId} onClick={() => setSelectedCustomer(customer.customerId)}
                className={`w-full rounded-2xl border p-3 text-left transition ${selectedCustomer === customer.customerId ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-slate-50/60 hover:bg-slate-100'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-black text-slate-900">{customer.name}</span>
                  <span className={`rounded-full px-2 py-1 text-[9px] font-black ${hasActiveOffer ? 'bg-amber-100 text-amber-800' : 'bg-white text-slate-600'}`}>{hasActiveOffer ? t('hasActiveOffer') : customer.frequency}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                  <span>{customer.mobile || customer.email || t('noContact')}</span>
                  <span>{customer.orderCount} {t('ordersCount')}</span>
                  <span>{customer.recentOrderCount90d} {t('inLast90Days')}</span>
                  <span>{money(customer.lifetimeSpend)} {t('lifetimeSpend')}</span>
                </div>
              </button>
            );
            })}
            {!uniqueCustomers.length && <p className="py-10 text-center text-xs text-slate-400">{t('noCustomerHistory')}</p>}
          </div>
          <SectionPagination page={customerPage} pageSize={CUSTOMER_PAGE_SIZE} total={uniqueCustomers.length} onPageChange={setCustomerPage} label="customers"/>
        </div>

        {canManage ? (
        <form onSubmit={createPromotion} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div>
            <h4 className="text-sm font-black text-slate-900">{t('assignOffer')}</h4>
            <p className="mt-1 text-[11px] text-slate-500">{selected ? `Selected: ${selected.name} · Customer ID: ${selected.customerId} · ${selected.orderCount} orders` : t('selectCustomerHistory')}</p>
            {selectedHasActiveOffer && <p role="alert" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">This customer already has an active discount or coupon. Revoke the existing offer before assigning another.</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setPromotionType('CUSTOMER_DISCOUNT')} className={`rounded-xl px-3 py-2 text-xs font-black ${promotionType === 'CUSTOMER_DISCOUNT' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{t('directDiscount')}</button>
            <button type="button" onClick={() => setPromotionType('CUSTOMER_COUPON')} className={`rounded-xl px-3 py-2 text-xs font-black ${promotionType === 'CUSTOMER_COUPON' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{t('issueCoupon')}</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[10px] font-black uppercase text-slate-500">{t('discountType')}<select value={discountType} onChange={e => setDiscountType(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs"><option value="percentage">{t('percentage')}</option><option value="fixed">{t('fixedRupees')}</option></select></label>
            <label className="text-[10px] font-black uppercase text-slate-500">{t('valueLabel')}<input type="number" min="0.01" step="0.01" value={discountValue} onChange={e => setDiscountValue(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs" /></label>
          </div>
          <label className="block text-[10px] font-black uppercase text-slate-500">{t('minimumOrder')}<input type="number" min="0" step="1" value={minOrderAmount} onChange={e => setMinOrderAmount(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs" /></label>
          {promotionType === 'CUSTOMER_COUPON' && <label className="block text-[10px] font-black uppercase text-slate-500">{t('couponCodeOptional')}<input value={code} onChange={e => setCode(e.target.value)} placeholder={t('autoGeneratedEmpty')} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs uppercase" /></label>}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[10px] font-black uppercase text-slate-500">{t('expiry')}<input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs" /></label>
            <label className="text-[10px] font-black uppercase text-slate-500">{t('checkoutLabel')}<input value={label} onChange={e => setLabel(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs" /></label>
          </div>
          <button type="submit" disabled={saving || !selectedCustomer || selectedHasActiveOffer} className="w-full min-h-11 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white shadow-sm disabled:opacity-40">
            {saving ? t('assigning') : promotionType === 'CUSTOMER_COUPON' ? `🎟️ ${t('issueAssignCoupon')}` : `🏷️ ${t('assignCustomerDiscount')}`}
          </button>
        </form>
        ) : (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
            <h4 className="text-sm font-black text-slate-900">{t('offersReadOnly')}</h4>
            <p className="mt-1 text-xs text-slate-500">{t('viewOnlyPermission')}</p>
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-black text-slate-900">{t('assignedOffers')}</h4><span className="text-[10px] font-bold text-slate-400">{promotions.length} {t('records')}</span></div>
        <div className="grid gap-2 md:grid-cols-2">
          {visiblePromotions.map(promotion => (
            <div key={promotion._id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-slate-900">{promotion.code}</span>
                {canManage ? (
                  <button type="button" onClick={() => togglePromotion(promotion)} className={`rounded-full px-2 py-1 text-[9px] font-black ${promotion.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{promotion.isActive ? t('active') : t('off')}</button>
                ) : (
                  <span className={`rounded-full px-2 py-1 text-[9px] font-black ${promotion.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{promotion.isActive ? 'Active' : 'Off'}</span>
                )}
              </div>
              <p className="mt-1 text-[10px] text-slate-500">{promotion.promotionType === 'CUSTOMER_COUPON' ? t('customerCoupon') : t('directCustomerDiscount')} · {promotion.discountType === 'percentage' ? `${promotion.discountValue}%` : money(promotion.discountValue)} off · min {money(promotion.minOrderAmount)}</p>
              <p className="mt-1 text-[10px] text-slate-600">{t('customer')}: <span className="font-bold">{promotion.customerName || customers.find(customer => String(customer.customerId) === String(promotion.customerId))?.name || t('customer')}</span></p>
              <p className="mt-1 break-all text-[10px] text-slate-400">{t('customerId')}: {promotion.customerId}</p>
              {canManage && promotion.isActive && promotion.tenantId && <button type="button" onClick={async () => { try { const response = await apiClient.post(`/api/coupons/admin/customer-promotions/${promotion._id}/notify`); addToast(response.data?.message || t('customerNotified'), 'success'); } catch (error) { addToast(getReadableErrorMessage(error, t('couldNotNotifyCustomer')), 'error'); } }} className="mt-3 min-h-9 rounded-lg border border-blue-200 bg-blue-50 px-3 text-[10px] font-black text-blue-800 hover:bg-blue-100">🔔 {t('notifyRemindCustomer')}</button>}
            </div>
          ))}
        </div>
        {!promotions.length && <p className="py-8 text-center text-xs text-slate-400">No assigned offers yet.</p>}
        <SectionPagination page={offerPage} pageSize={OFFER_PAGE_SIZE} total={promotions.length} onPageChange={setOfferPage} label="offers"/>
      </div>
    </section>
  );
}
