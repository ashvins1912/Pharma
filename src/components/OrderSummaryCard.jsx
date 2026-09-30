import React from 'react';
import { useOrderFinancials } from '../hooks/useOrderFinancials';

export default function OrderSummaryCard({ order, currency = 'INR', tax = 0 }) {
  const financials = useOrderFinancials(order, currency, tax);

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm">
      <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">Order summary</h3>
      <dl className="divide-y divide-slate-100 text-xs">
        <div className="flex items-center justify-between py-2.5 text-slate-600">
          <dt>Subtotal</dt>
          <dd className="font-semibold text-slate-900">{financials.formatted.subtotal}</dd>
        </div>
        <div className="flex items-center justify-between py-2.5 text-slate-600">
          <dt>Tax</dt>
          <dd className="font-semibold text-slate-900">{financials.formatted.tax}</dd>
        </div>
        {financials.couponDiscount > 0 && (
          <div className="flex items-center justify-between py-2.5 text-emerald-700">
            <dt>Coupon discount</dt>
            <dd className="font-bold">−{financials.formatted.couponDiscount}</dd>
          </div>
        )}
        <div className="flex items-center justify-between py-2.5 text-rose-700">
          <dt>Points Discount</dt>
          <dd className="font-bold">−{financials.formatted.cashDiscount}</dd>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 py-3 text-sm font-black text-slate-900">
          <dt>Total paid</dt>
          <dd className="text-emerald-700">{financials.formatted.paidTotal}</dd>
        </div>
      </dl>

      {financials.pointsEarned > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-center text-xs font-extrabold text-emerald-900">
          🎉 You earned {financials.pointsEarned} reward points on this order!
        </div>
      )}
    </section>
  );
}
