import React from 'react';
import { useOrderFinancials } from '../../hooks/useOrderFinancials';

export default function AdminOrderFinancials({ order, currency = 'INR' }) {
  const financials = useOrderFinancials(order, currency);
  const orderId = String(order?._id || order?.orderId || '').slice(-6).toUpperCase();

  return (
    <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
            Order #{orderId || '—'} · {order?.orderStatus || 'Order'}
          </p>
          <h3 className="mt-1 text-xs font-bold text-slate-600">Net profit</h3>
          <p className={`text-2xl font-black tracking-tight ${financials.marginTone.valueClass}`}>
            {financials.formatted.netProfit}
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${financials.marginTone.badgeClass}`}>
          {financials.marginTone.label} · {financials.formattedMargin}
        </span>
      </header>

      <section aria-labelledby={`financial-breakdown-${orderId}`} className="space-y-2">
        <h4 id={`financial-breakdown-${orderId}`} className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
          Financial breakdown
        </h4>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-slate-50 p-3">
          <div>
            <dt className="text-[10px] font-medium text-slate-500">Gross revenue</dt>
            <dd className="mt-0.5 text-xs font-bold text-slate-800">{financials.formatted.totalRevenue}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium text-slate-500">Wholesale cost</dt>
            <dd className="mt-0.5 text-xs font-bold text-slate-800">{financials.formatted.totalCostPrice}</dd>
          </div>
          {financials.couponDiscount > 0 && (
            <div>
              <dt className="text-[10px] font-medium text-slate-500">Coupon discount</dt>
              <dd className="mt-0.5 text-xs font-bold text-rose-700">−{financials.formatted.couponDiscount}</dd>
            </div>
          )}
          <div className="col-span-2 border-t border-slate-200 pt-2">
            <dt className="text-[10px] font-medium text-slate-500">Points discount applied</dt>
            <dd className="mt-0.5 text-xs font-bold text-rose-700">−{financials.formatted.cashDiscount}</dd>
          </div>
        </dl>
      </section>

      <section aria-label="Customer loyalty impact" className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2.5">
        <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-800">
          Customer loyalty impact
        </h4>
        <p className="mt-1 text-xs font-bold text-indigo-950">
          +{financials.pointsEarned} points earned
          <span className="mx-1.5 text-indigo-300">/</span>
          −{financials.pointsRedeemed} points used
        </p>
      </section>
    </article>
  );
}
