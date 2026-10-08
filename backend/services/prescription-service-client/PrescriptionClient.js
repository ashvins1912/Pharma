import axios from 'axios';
import jwt from 'jsonwebtoken';

const baseUrl = (process.env.PRESCRIPTION_SERVICE_URL || '').replace(/\/+$/, '');

const buildToken = ({ userId, tenantId = null, branchId = null, role = 'system', isAdmin = false, scopes = [] } = {}) => {
  const secret = process.env.SERVICE_AUTH_SECRET;
  const issuer = process.env.SERVICE_JWT_ISSUER || 'ashvin-pharmacy';
  const audience = process.env.PRESCRIPTION_SERVICE_JWT_AUDIENCE || 'prescription-service';
  if (!secret || secret.length < 32) {
    const error = new Error('Prescription service authentication is not configured.');
    error.code = 'PRESCRIPTION_SERVICE_AUTH_UNAVAILABLE';
    throw error;
  }
  return jwt.sign(
    {
      sub: userId || 'backend',
      userId: userId || 'backend',
      tenantId,
      branchId,
      role,
      roles: [role],
      permissions: scopes,
      scope: scopes.join(' '),
      isAdmin
    },
    secret,
    {
      algorithm: 'HS256',
      issuer,
      audience,
      expiresIn: 60
    }
  );
};

const headers = (context = {}) => ({
  Authorization: `Bearer ${buildToken(context)}`
});

const ensureConfigured = () => {
  if (!baseUrl) {
    const error = new Error('PRESCRIPTION_SERVICE_URL is not configured.');
    error.code = 'PRESCRIPTION_SERVICE_UNAVAILABLE';
    throw error;
  }
};

const normalizeError = error => {
  if (error?.code === 'PRESCRIPTION_SERVICE_UNAVAILABLE' || error?.code === 'PRESCRIPTION_SERVICE_AUTH_UNAVAILABLE') {
    return error;
  }
  const mapped = new Error(
    error?.response?.data?.detail
      || error?.response?.data?.message
      || 'Prescription service is unavailable.'
  );
  mapped.code = error?.response?.status >= 400 && error?.response?.status < 500
    ? 'PRESCRIPTION_SERVICE_REJECTED'
    : 'PRESCRIPTION_SERVICE_UNAVAILABLE';
  mapped.statusCode = error?.response?.status || 503;
  return mapped;
};

export const prescriptionClient = {
  isConfigured() {
    return Boolean(baseUrl);
  },

  async upload({ buffer, filename, contentType, idempotencyKey, userId, tenantId, branchId, patientPuid = null, orderId = null, role = 'customer' }) {
    ensureConfigured();
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: contentType || 'application/octet-stream' }), filename || 'prescription');
    if (patientPuid) form.append('patient_puid', patientPuid);
    if (orderId) form.append('order_id', orderId);

    try {
      const response = await axios.post(
        `${baseUrl}/api/v1/prescriptions/upload`,
        form,
        {
          headers: {
            ...headers({
              userId,
              tenantId,
              branchId,
              role,
              scopes: ['prescription.write']
            }),
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
            ...((typeof form.getHeaders === 'function') ? form.getHeaders() : {})
          },
          timeout: 15_000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );
      return response.data?.data || response.data;
    } catch (error) {
      throw normalizeError(error);
    }
  },

  async replace(prescriptionId, { buffer, filename, contentType, idempotencyKey, userId, tenantId, branchId, role = 'customer' } = {}) {
    ensureConfigured();
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: contentType || 'application/octet-stream' }), filename || 'prescription');
    try {
      const response = await axios.put(
        `${baseUrl}/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/document`,
        form,
        {
          headers: {
            ...headers({
              userId,
              tenantId,
              branchId,
              role,
              scopes: ['prescription.write']
            }),
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
            ...((typeof form.getHeaders === 'function') ? form.getHeaders() : {})
          },
          timeout: 15_000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );
      return response.data?.data || response.data;
    } catch (error) {
      throw normalizeError(error);
    }
  },

  async convertToOrder(prescriptionId, orderId, { userId, tenantId, branchId, role = 'customer' } = {}) {
    ensureConfigured();
    const form = new FormData();
    form.append('order_id', String(orderId));
    try {
      const response = await axios.post(
        `${baseUrl}/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/convert-to-order`,
        form,
        { headers: { ...headers({ userId, tenantId, branchId, role, scopes: ['prescription.write'] }) }, timeout: 10_000 }
      );
      return response.data?.data || response.data;
    } catch (error) {
      throw normalizeError(error);
    }
  },

  async get(prescriptionId, { userId, tenantId, branchId, role = 'customer', isAdmin = false } = {}) {
    ensureConfigured();
    try {
      const response = await axios.get(
        `${baseUrl}/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}`,
        {
          headers: headers({
            userId,
            tenantId,
            branchId,
            role,
            isAdmin,
            scopes: isAdmin ? ['prescription.review'] : ['prescription.read']
          }),
          timeout: 10_000
        }
      );
      return response.data?.data || response.data;
    } catch (error) {
      throw normalizeError(error);
    }
  }
};

export default prescriptionClient;
