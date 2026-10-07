import axios from 'axios';
import jwt from 'jsonwebtoken';

const baseUrl = () => String(process.env.ORDER_SERVICE_URL || '').replace(/\/+$/, '');

const buildToken = ({ userId = 'backend', tenantId = null, branchId = null, role = 'system', isPlatformUser = false, scope = 'orders.create' } = {}) => {
  const secret = process.env.SERVICE_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    const error = new Error('Order Service authentication is not configured.');
    error.code = 'ORDER_SERVICE_AUTH_UNAVAILABLE';
    error.statusCode = 503;
    throw error;
  }

  return jwt.sign({
    sub: 'backend-platform',
    userId,
    tenantId,
    branchId,
    userRole: role,
    isPlatformUser,
    scope
  }, secret, {
    algorithm: 'HS256',
    issuer: process.env.SERVICE_JWT_ISSUER || 'ashvin-pharmacy',
    audience: process.env.ORDER_SERVICE_JWT_AUDIENCE || 'order-service',
    expiresIn: 60
  });
};

const request = async (method, path, { userId, tenantId, branchId, role, isPlatformUser, scope, data, params } = {}) => {
  const url = baseUrl();
  if (!url) {
    const error = new Error('ORDER_SERVICE_URL is not configured.');
    error.code = 'ORDER_SERVICE_UNAVAILABLE';
    error.statusCode = 503;
    throw error;
  }

  try {
    const response = await axios({
      method,
      url: `${url}${path}`,
      params,
      data,
      timeout: 15_000,
      headers: {
        Authorization: `Bearer ${buildToken({ userId, tenantId, branchId, role, isPlatformUser, scope })}`
      }
    });
    return response.data;
  } catch (error) {
    const status = error.response?.status;
    const message = error.response?.data?.message || 'Order Service is unavailable.';
    const mapped = new Error(message);
    mapped.statusCode = status ? (status >= 500 ? 503 : status) : (error.code === 'ECONNABORTED' ? 504 : 503);
    mapped.code = status ? 'ORDER_SERVICE_REJECTED' : 'ORDER_SERVICE_UNAVAILABLE';
    throw mapped;
  }
};

export const orderClient = {
  isConfigured() {
    return Boolean(baseUrl());
  },

  async createOrder(body, context = {}) {
    return request('POST', '/api/v1/orders', {
      ...context,
      scope: 'orders.create',
      data: body
    });
  },

  async getOrder(orderNumber, context = {}) {
    return request('GET', `/api/v1/orders/${encodeURIComponent(orderNumber)}`, {
      ...context,
      scope: 'orders.read'
    });
  }
};

export default orderClient;
