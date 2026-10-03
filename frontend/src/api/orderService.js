import apiClient from './apiClient';

export function normalizeOrdersResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.orders)) return data.orders;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.orders)) return data.data.orders;
  throw new Error('The orders response was invalid.');
}

export async function createOrder(orderData) {
  const { data } = await apiClient.post('/api/orders', orderData);
  return data.order;
}

export async function fetchOrders(filters = {}) {
  const { data } = await apiClient.get('/api/orders', { params: filters });
  return normalizeOrdersResponse(data);
}
