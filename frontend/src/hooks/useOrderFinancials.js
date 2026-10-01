import { useMemo } from 'react';

const numberOrZero = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export function useOrderFinancials(order, currency = 'INR', tax = 0) {
  return useMemo(() => {
    const rewardMetrics = order?.rewardMetrics || {};
    const items = order?.medicineItems || order?.items || [];
    const totalRevenue = numberOrZero(
      order?.totalRevenue ?? rewardMetrics.totalRevenue ?? order?.subtotal ?? order?.finalTotal
    );
    const totalCostPrice = numberOrZero(
      order?.totalCostPrice
      ?? rewardMetrics.totalCostPrice
      ?? items.reduce((sum, item) => (
        sum + numberOrZero(item.baseCostPrice) * numberOrZero(item.quantity)
      ), 0)
    );
    const cashDiscount = numberOrZero(order?.cashDiscount ?? order?.pointsDiscountApplied);
    const netProfit = numberOrZero(
      order?.netProfit
      ?? (rewardMetrics.netProfit !== undefined
        ? rewardMetrics.netProfit
        : totalRevenue - totalCostPrice - cashDiscount)
    );
    const netMarginPercentage = numberOrZero(
      order?.netMarginPercentage
      ?? rewardMetrics.netMarginPercentage
      ?? (totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0)
    );
    const pointsEarned = numberOrZero(order?.pointsEarned ?? order?.rewardPointsEarned);
    const pointsRedeemed = numberOrZero(order?.pointsRedeemed);
    const currencyFormatter = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2
    });
    const subtotal = numberOrZero(order?.subtotal ?? totalRevenue);
    const taxAmount = numberOrZero(tax);
    const couponDiscount = numberOrZero(order?.discountApplied);
    const paidTotal = numberOrZero(
      order?.finalTotal
      ?? order?.totalAmount
      ?? (subtotal + taxAmount - couponDiscount - cashDiscount)
    );

    const marginTone = netMarginPercentage > 25
      ? {
        label: 'High margin',
        badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        valueClass: 'text-emerald-700'
      }
      : netMarginPercentage >= 15
        ? {
          label: 'Mid margin',
          badgeClass: 'border-amber-200 bg-amber-50 text-amber-800',
          valueClass: 'text-amber-700'
        }
        : {
          label: 'Low margin',
          badgeClass: 'border-rose-200 bg-rose-50 text-rose-800',
          valueClass: 'text-rose-700'
        };

    return {
      totalRevenue,
      totalCostPrice,
      netProfit,
      netMarginPercentage,
      pointsEarned,
      pointsRedeemed,
      cashDiscount,
      subtotal,
      tax: taxAmount,
      couponDiscount,
      paidTotal,
      formatted: {
        totalRevenue: currencyFormatter.format(totalRevenue),
        totalCostPrice: currencyFormatter.format(totalCostPrice),
        netProfit: currencyFormatter.format(netProfit),
        cashDiscount: currencyFormatter.format(cashDiscount),
        subtotal: currencyFormatter.format(subtotal),
        tax: currencyFormatter.format(taxAmount),
        couponDiscount: currencyFormatter.format(couponDiscount),
        paidTotal: currencyFormatter.format(paidTotal)
      },
      formattedMargin: `${netMarginPercentage.toFixed(1)}%`,
      marginTone
    };
  }, [order, currency, tax]);
}

export default useOrderFinancials;
