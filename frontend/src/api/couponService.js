import apiClient from './apiClient';

export async function applyCouponCode(code, currentCartTotal) {
  const normalizedCode = String(code || '').trim();
  const total = Number(currentCartTotal);
  if (!normalizedCode) throw new Error('Enter a coupon code.');
  if (!Number.isFinite(total) || total < 0) throw new Error('Cart total must be a non-negative number.');

  const { data } = await apiClient.get(`/api/coupons/${encodeURIComponent(normalizedCode)}`, {
    params: { orderTotal: total }
  });
  return data;
}
