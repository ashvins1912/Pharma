import apiClient from './apiClient';

export function normalizeOrdersResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.orders)) return data.orders;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.orders)) return data.data.orders;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data?.items)) return data.data.items;
  if (data && typeof data === 'object') {
    const found = Object.values(data).find(val => Array.isArray(val));
    if (found) return found;
    if (data.data && typeof data.data === 'object') {
      const foundInner = Object.values(data.data).find(val => Array.isArray(val));
      if (foundInner) return foundInner;
    }
  }
  return [];
}

export async function createOrder(orderData) {
  const { data } = await apiClient.post('/api/orders', orderData);
  return data.order;
}

export async function fetchOrders(filters = {}) {
  const { data } = await apiClient.get('/api/orders', { params: filters });
  return normalizeOrdersResponse(data);
}
