import React, { useId } from 'react';
import { useOrderFinancials } from '../../hooks/useOrderFinancials';

export default function AdminOrderFinancials({ order, currency = 'INR' }) {
  const financials = useOrderFinancials(order, currency);
  const orderId = String(order?._id || order?.orderId || '').slice(-6).toUpperCase();
  const sectionId = useId();

  return (
    <article className="order-financial-card">
      <header className="order-financial-card__header">
        <div className="order-financial-card__identity">
          <p className="order-financial-card__eyebrow">
            Order #{orderId || '—'} <span aria-hidden="true">·</span> {order?.orderStatus || 'Order'}
          </p>
          <p className="order-financial-card__label">Net profit</p>
          <p className={`order-financial-card__profit ${financials.marginTone.valueClass}`}>
            {financials.formatted.netProfit}
          </p>
        </div>
        <span className={`order-financial-card__margin ${financials.marginTone.badgeClass}`}>
          {financials.marginTone.label} · {financials.formattedMargin}
        </span>
      </header>

      <section className="order-financial-card__section" aria-labelledby={sectionId}>
        <h4 id={sectionId} className="order-financial-card__section-title">
          Financial breakdown
        </h4>
        <dl className="order-financial-card__metrics">
          <div className="order-financial-card__metric">
            <dt>Gross revenue</dt>
            <dd>{financials.formatted.totalRevenue}</dd>
          </div>
          <div className="order-financial-card__metric">
            <dt>Wholesale cost</dt>
            <dd>{financials.formatted.totalCostPrice}</dd>
          </div>
          <div className="order-financial-card__metric order-financial-card__metric--discount">
            <dt>Coupon discount</dt>
            <dd>{financials.couponDiscount > 0 ? `−${financials.formatted.couponDiscount}` : '—'}</dd>
          </div>
          <div className="order-financial-card__metric order-financial-card__metric--discount">
            <dt>Points discount</dt>
            <dd>{financials.cashDiscount > 0 ? `−${financials.formatted.cashDiscount}` : '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="order-financial-card__loyalty" aria-label="Customer loyalty impact">
        <div className="order-financial-card__loyalty-heading">
          <h4>Customer loyalty</h4>
          <span>Points activity</span>
        </div>
        <div className="order-financial-card__loyalty-values">
          <p><strong>+{financials.pointsEarned}</strong><span>Earned</span></p>
          <p><strong>−{financials.pointsRedeemed}</strong><span>Redeemed</span></p>
        </div>
      </section>
    </article>
  );
}
