import apiClient from './apiClient';

export async function createOrder(orderData) {
  const { data } = await apiClient.post('/api/orders', orderData);
  return data.order;
}

export async function fetchOrders(filters = {}) {
  const { data } = await apiClient.get('/api/orders', { params: filters });
  return data.orders;
}
