import axios from 'axios';
import jwt from 'jsonwebtoken';

const baseUrl = () => String(process.env.INVENTORY_SERVICE_URL || '').replace(/\/+$/, '');

const buildToken = ({ userId = 'backend', scopes = ['inventory.read'] } = {}) => {
  const secret = process.env.SERVICE_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    const error = new Error('Inventory Service authentication is not configured.');
    error.code = 'INVENTORY_SERVICE_AUTH_UNAVAILABLE';
    throw error;
  }

  return jwt.sign({
    scope: scopes.join(' '),
    userId
  }, secret, {
    algorithm: 'HS256',
    subject: 'backend-platform',
    issuer: process.env.SERVICE_JWT_ISSUER || 'ashvin-pharmacy',
    audience: process.env.INVENTORY_SERVICE_JWT_AUDIENCE || 'inventory-service',
    expiresIn: 60
  });
};

const request = async (method, path, {
  userId = 'backend',
  scopes = ['inventory.read'],
  data,
  params,
  idempotencyKey
} = {}) => {
  const url = baseUrl();
  if (!url) {
    const error = new Error('INVENTORY_SERVICE_URL is not configured.');
    error.code = 'INVENTORY_SERVICE_UNAVAILABLE';
    error.statusCode = 503;
    throw error;
  }

  try {
    const response = await axios({
      method,
      url: `${url}${path}`,
      params,
      data,
      timeout: 10_000,
      headers: {
        Authorization: `Bearer ${buildToken({ userId, scopes })}`,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      }
    });
    return response.data;
  } catch (error) {
    if (error.code === 'INVENTORY_SERVICE_UNAVAILABLE' || error.code === 'INVENTORY_SERVICE_AUTH_UNAVAILABLE') {
      throw error;
    }
    const mapped = new Error(
      error.response?.data?.message ||
      error.response?.data?.error?.message ||
      'Inventory Service is unavailable.'
    );
    mapped.statusCode = error.response?.status
      ? (error.response.status >= 500 ? 503 : error.response.status)
      : (error.code === 'ECONNABORTED' ? 504 : 503);
    mapped.code = error.response?.status
      ? 'INVENTORY_SERVICE_REJECTED'
      : 'INVENTORY_SERVICE_UNAVAILABLE';
    throw mapped;
  }
};

export const inventoryClient = {
  isConfigured() {
    return Boolean(baseUrl());
  },

  async searchProducts({ tenantId = null, branchId = null, query = '', category = '', page = 1, limit = 50, userId = 'backend' } = {}) {
    return request('GET', '/api/v1/inventory/products/search', {
      userId,
      params: { tenantId, branchId, q: query, category, page, limit }
    });
  },

  async getProductById(productId, { tenantId = null, branchId = null, userId = 'backend' } = {}) {
    const params = { tenantId, branchId };
    return request('GET', `/api/v1/inventory/${encodeURIComponent(productId)}`, { userId, params });
  },

  async lookup({ productIds = [], skus = [], tenantId = null, branchId = null, userId = 'backend' } = {}) {
    return request('POST', '/api/v1/inventory/bulk/lookup', {
      userId,
      data: { productIds, skus, tenantId, branchId }
    });
  },

  async adjust({ sku, stockQuantity, price, batchNumber, expiryDate, tenantId, branchId, userId = 'backend', operationKey }) {
    return request('POST', '/api/v1/inventory/adjust', {
      userId,
      scopes: ['inventory.adjust'],
      data: { sku, stockQuantity, price, batchNumber, expiryDate, tenantId, branchId },
      idempotencyKey: operationKey
    });
  },

  async reserve({ orderId, items, tenantId, branchId, userId = 'backend', idempotencyKey }) {
    return request('POST', '/api/v1/inventory/reservations', {
      userId,
      scopes: ['inventory.reserve'],
      data: { orderId, items, tenantId, branchId },
      idempotencyKey
    });
  },

  async release(reservationId, { userId = 'backend', idempotencyKey } = {}) {
    return request('POST', `/api/v1/inventory/reservations/${encodeURIComponent(reservationId)}/release`, {
      userId,
      scopes: ['inventory.release'],
      idempotencyKey
    });
  },

  async deduct(reservationId, { userId = 'backend', idempotencyKey } = {}) {
    return request('POST', `/api/v1/inventory/reservations/${encodeURIComponent(reservationId)}/deduct`, {
      userId,
      scopes: ['inventory.deduct'],
      idempotencyKey
    });
  }
};

export default inventoryClient;
