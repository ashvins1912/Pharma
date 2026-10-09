import React, { useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';

const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;

export default function CustomerPromotionsView({ canManage = false }) {
  const { addToast } = useToast();
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
  const [label, setLabel] = useState('Pharma discount for you');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

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
      addToast(error.message || 'Could not load customer promotions.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const selected = useMemo(
    () => customers.find(customer => customer.customerId === selectedCustomer),
    [customers, selectedCustomer]
  );

  const createPromotion = async event => {
    event.preventDefault();
    if (!selectedCustomer || !discountValue) {
      addToast('Select a customer and enter a discount value.', 'warning');
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
        promotionLabel: label.trim() || 'Pharma discount for you'
      });
      addToast(promotionType === 'CUSTOMER_COUPON'
        ? 'Customer coupon assigned successfully.'
        : 'Customer-level pharmacy discount assigned successfully.', 'success');
      setDiscountValue('');
      setCode('');
      await load();
    } catch (error) {
      addToast(error.message || 'Could not create customer promotion.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const togglePromotion = async promotion => {
    try {
      await apiClient.patch(`/api/coupons/admin/customer-promotions/${promotion._id}`, { isActive: !promotion.isActive });
      await load();
    } catch (error) {
      addToast(error.message || 'Could not update promotion.', 'error');
    }
  };

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Customer Offers</p>
            <h3 className="mt-1 text-xl font-black text-slate-900">Personal discounts & coupons</h3>
            <p className="mt-1 text-xs text-slate-600">Use recent order history to target unique customers. Assigned offers automatically appear at checkout as “Pharma discount for you”.</p>
          </div>
          <button type="button" onClick={load} disabled={loading} className="min-h-10 rounded-xl bg-white px-4 text-xs font-black text-slate-700 shadow-sm border border-slate-200 disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-black text-slate-900">Recent & frequent customers</h4>
              <p className="text-[11px] text-slate-500">One customer appears once, ranked by recent/frequent ordering.</p>
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} placeholder="Search customer…" className="w-40 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-blue-500" />
          </div>
          <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
            {customers.map(customer => (
              <button type="button" key={customer.customerId} onClick={() => setSelectedCustomer(customer.customerId)}
                className={`w-full rounded-2xl border p-3 text-left transition ${selectedCustomer === customer.customerId ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-slate-50/60 hover:bg-slate-100'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-black text-slate-900">{customer.name}</span>
                  <span className="rounded-full bg-white px-2 py-1 text-[9px] font-black text-slate-600">{customer.frequency}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                  <span>{customer.mobile || customer.email || 'No contact'}</span>
                  <span>{customer.orderCount} orders</span>
                  <span>{customer.recentOrderCount90d} in 90d</span>
                  <span>{money(customer.lifetimeSpend)} lifetime</span>
                </div>
              </button>
            ))}
            {!customers.length && <p className="py-10 text-center text-xs text-slate-400">No customer history found.</p>}
          </div>
        </div>

        {canManage ? (
        <form onSubmit={createPromotion} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div>
            <h4 className="text-sm font-black text-slate-900">Assign an offer</h4>
            <p className="mt-1 text-[11px] text-slate-500">{selected ? `Selected: ${selected.name} · ${selected.orderCount} orders` : 'Select a customer from the history list.'}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setPromotionType('CUSTOMER_DISCOUNT')} className={`rounded-xl px-3 py-2 text-xs font-black ${promotionType === 'CUSTOMER_DISCOUNT' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Direct discount</button>
            <button type="button" onClick={() => setPromotionType('CUSTOMER_COUPON')} className={`rounded-xl px-3 py-2 text-xs font-black ${promotionType === 'CUSTOMER_COUPON' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Issue coupon</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[10px] font-black uppercase text-slate-500">Discount type<select value={discountType} onChange={e => setDiscountType(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs"><option value="percentage">Percentage %</option><option value="fixed">Fixed ₹</option></select></label>
            <label className="text-[10px] font-black uppercase text-slate-500">Value<input type="number" min="0.01" step="0.01" value={discountValue} onChange={e => setDiscountValue(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs" /></label>
          </div>
          <label className="block text-[10px] font-black uppercase text-slate-500">Minimum order<input type="number" min="0" step="1" value={minOrderAmount} onChange={e => setMinOrderAmount(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs" /></label>
          {promotionType === 'CUSTOMER_COUPON' && <label className="block text-[10px] font-black uppercase text-slate-500">Coupon code (optional)<input value={code} onChange={e => setCode(e.target.value)} placeholder="Auto-generated if empty" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs uppercase" /></label>}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[10px] font-black uppercase text-slate-500">Expiry<input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs" /></label>
            <label className="text-[10px] font-black uppercase text-slate-500">Checkout label<input value={label} onChange={e => setLabel(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs" /></label>
          </div>
          <button type="submit" disabled={saving || !selectedCustomer} className="w-full min-h-11 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white shadow-sm disabled:opacity-40">
            {saving ? 'Assigning…' : promotionType === 'CUSTOMER_COUPON' ? '🎟️ Issue & Assign Coupon' : '🏷️ Assign Customer Discount'}
          </button>
        </form>
        ) : (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
            <h4 className="text-sm font-black text-slate-900">Offers are read-only</h4>
            <p className="mt-1 text-xs text-slate-500">Your current permissions allow viewing customer offers, but not creating or changing them.</p>
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-black text-slate-900">Assigned offers</h4><span className="text-[10px] font-bold text-slate-400">{promotions.length} records</span></div>
        <div className="grid gap-2 md:grid-cols-2">
          {promotions.map(promotion => (
            <div key={promotion._id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-slate-900">{promotion.code}</span>
                {canManage ? (
                  <button type="button" onClick={() => togglePromotion(promotion)} className={`rounded-full px-2 py-1 text-[9px] font-black ${promotion.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{promotion.isActive ? 'Active' : 'Off'}</button>
                ) : (
                  <span className={`rounded-full px-2 py-1 text-[9px] font-black ${promotion.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{promotion.isActive ? 'Active' : 'Off'}</span>
                )}
              </div>
              <p className="mt-1 text-[10px] text-slate-500">{promotion.promotionType === 'CUSTOMER_COUPON' ? 'Customer coupon' : 'Direct customer discount'} · {promotion.discountType === 'percentage' ? `${promotion.discountValue}%` : money(promotion.discountValue)} off · min {money(promotion.minOrderAmount)}</p>
              <p className="mt-1 text-[10px] text-slate-400">Customer {promotion.customerId}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
