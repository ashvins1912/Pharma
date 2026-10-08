import axios from 'axios';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

const normalize = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(tab|tablet|tabs|tablets|cap|capsule|caps|syrup|injection)\b/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const strengthOf = value => {
  if (!value) return '';
  if (typeof value === 'string') return normalize(value);
  if (typeof value === 'object') {
    return normalize(`${value.value ?? ''}${value.unit ?? ''}`);
  }
  return normalize(value);
};

const tokenOverlap = (left, right) => {
  const a = new Set(normalize(left).split(' ').filter(Boolean));
  const b = new Set(normalize(right).split(' ').filter(Boolean));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(a.size, b.size);
};

const extractPrescribedQuantity = medicine => {
  const course = medicine?.course || {};
  if (Number.isFinite(Number(course.calculatedQuantity))) return Number(course.calculatedQuantity);
  if (Number.isFinite(Number(course.value))) return Number(course.value);
  return null;
};

const compareItem = (orderItem, prescriptionMedicine) => {
  const orderName = orderItem.name || orderItem.productName || orderItem.genericName || '';
  const prescriptionName = prescriptionMedicine.normalizedName || prescriptionMedicine.rawName || '';
  const nameScore = tokenOverlap(orderName, prescriptionName);
  const orderStrength = strengthOf(orderItem.strength);
  const rxStrength = strengthOf(prescriptionMedicine.strength);
  const strengthMatch = !orderStrength || !rxStrength
    || orderStrength === rxStrength
    || orderStrength.includes(rxStrength)
    || rxStrength.includes(orderStrength);

  const prescribedQuantity = extractPrescribedQuantity(prescriptionMedicine);
  const requestedQuantity = Number(orderItem.quantity || 0);
  const quantityMatch = prescribedQuantity == null || requestedQuantity <= prescribedQuantity;

  const exactProductMatch = prescriptionMedicine.medicineValidation?.productId
    && orderItem.productId
    && String(prescriptionMedicine.medicineValidation.productId) === String(orderItem.productId);

  const matched = Boolean(exactProductMatch || (nameScore >= 0.72 && strengthMatch));
  const partial = !matched && nameScore >= 0.55 && strengthMatch;

  return {
    orderMedicine: orderName,
    prescriptionMedicine: prescriptionName,
    requestedQuantity,
    prescribedQuantity,
    nameScore: Number(nameScore.toFixed(3)),
    strengthMatch,
    quantityMatch,
    exactProductMatch: Boolean(exactProductMatch),
    status: matched && quantityMatch ? 'MATCHED'
      : partial && quantityMatch ? 'PARTIAL_MATCH'
      : 'MISMATCH',
    reason: !quantityMatch
      ? `Requested quantity (${requestedQuantity}) exceeds the prescribed quantity (${prescribedQuantity}).`
      : !strengthMatch
        ? 'Strength does not match the prescription.'
        : !matched
          ? 'Medicine name does not sufficiently match the prescription.'
          : null
  };
};

const serviceToken = ({ userId, role = 'customer', isAdmin = false, permissions = ['prescription.read'] }) => {
  if (!config.prescriptionServiceUrl) {
    const error = new Error('Prescription Service is not configured.');
    error.statusCode = 503;
    throw error;
  }
  if (!config.serviceAuthSecret || config.serviceAuthSecret.length < 32) {
    const error = new Error('Prescription Service authentication is not configured.');
    error.statusCode = 503;
    throw error;
  }

  return jwt.sign({
    sub: userId,
    userId,
    role,
    roles: [role],
    permissions,
    scope: permissions.join(' '),
    isAdmin
  }, config.serviceAuthSecret, {
    algorithm: 'HS256',
    issuer: config.serviceJwtIssuer,
    audience: config.prescriptionJwtAudience,
    expiresIn: 60
  });
};

const fetchPrescription = async ({ prescriptionId, userId, role, isAdmin }) => {
  const token = serviceToken({ userId, role, isAdmin });
  try {
    const response = await axios.get(
      `${config.prescriptionServiceUrl}/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10_000
      }
    );
    return response.data?.data || response.data;
  } catch (error) {
    if (error.response?.status) {
      const detail = error.response.data?.detail || error.response.data?.message || 'Prescription Service request failed.';
      throw Object.assign(new Error(detail), {
        statusCode: error.response.status === 404 ? 404 : 502
      });
    }
    throw Object.assign(new Error('Prescription Service is unavailable.'), {
      statusCode: error.code === 'ECONNABORTED' ? 504 : 503
    });
  }
};

export async function reinitiatePrescriptionProcessing({ prescriptionId, userId, role = 'admin', isAdmin = true }) {
  const token = serviceToken({ userId, role, isAdmin });
  try {
    const response = await axios.post(
      `${config.prescriptionServiceUrl}/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/reprocess`,
      {},
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10_000
      }
    );
    return response.data?.data || response.data;
  } catch (error) {
    if (error.response?.status) {
      const detail = error.response.data?.detail || error.response.data?.message || 'Prescription reprocessing failed.';
      throw Object.assign(new Error(detail), {
        statusCode: error.response.status === 404 ? 404 : error.response.status === 409 ? 409 : 502
      });
    }
    throw Object.assign(new Error('Prescription Service is unavailable.'), {
      statusCode: error.code === 'ECONNABORTED' ? 504 : 503
    });
  }
}

export async function verifyPrescriptionAgainstItems({
  prescriptionId,
  items,
  userId,
  patientPuid = null,
  role = 'customer',
  isAdmin = false
}) {
  if (!prescriptionId) {
    return {
      status: 'NOT_REQUIRED',
      overallConfidence: 1,
      medicines: [],
      issues: []
    };
  }

  const prescription = await fetchPrescription({ prescriptionId, userId, role, isAdmin });
  const status = prescription?.status;
  const prescriptionPuid = prescription?.patientPuid || null;
  const requestedPuid = patientPuid || null;

  if (requestedPuid && prescriptionPuid && String(requestedPuid) !== String(prescriptionPuid)) {
    return {
      status: 'MISMATCH',
      prescriptionId,
      patientPuid: prescriptionPuid,
      overallConfidence: Number(prescription?.quality?.overallConfidence || 0),
      medicines: [],
      issues: ['Prescription patient does not match the order patient PUID.']
    };
  }

  if (requestedPuid && !prescriptionPuid) {
    return {
      status: 'REVIEW_REQUIRED',
      prescriptionId,
      patientPuid: null,
      overallConfidence: Number(prescription?.quality?.overallConfidence || 0),
      medicines: [],
      issues: ['Prescription is missing patient PUID information required for order verification.']
    };
  }

  if (['QUEUED', 'PROCESSING', 'REVIEW_REQUIRED', 'UPLOADED'].includes(status)) {
    return {
      status: 'PROCESSING',
      prescriptionId,
      overallConfidence: Number(prescription?.quality?.overallConfidence || 0),
      medicines: prescription?.medicines || [],
      issues: ['Prescription processing or manual verification is still pending.']
    };
  }

  if (status === 'REJECTED') {
    return {
      status: 'REJECTED',
      prescriptionId,
      overallConfidence: Number(prescription?.quality?.overallConfidence || 0),
      medicines: prescription?.medicines || [],
      issues: ['Prescription has been rejected.']
    };
  }

  if (status === 'INACTIVE') {
    return {
      status: 'INACTIVE',
      prescriptionId,
      overallConfidence: 0,
      medicines: [],
      issues: ['Prescription is inactive.']
    };
  }

  const prescriptionMedicines = Array.isArray(prescription?.medicines) ? prescription.medicines : [];
  if (!prescriptionMedicines.length) {
    return {
      status: 'REVIEW_REQUIRED',
      prescriptionId,
      overallConfidence: Number(prescription?.quality?.overallConfidence || 0),
      medicines: [],
      issues: ['No medicines could be extracted from the prescription.']
    };
  }

  const matched = [];
  const issues = [];
  for (const item of items || []) {
    const candidates = prescriptionMedicines
      .map(medicine => compareItem(item, medicine))
      .sort((a, b) => {
        const rank = { MATCHED: 2, PARTIAL_MATCH: 1, MISMATCH: 0 };
        return rank[b.status] - rank[a.status] || b.nameScore - a.nameScore;
      });
    const best = candidates[0];
    matched.push(best);
    if (!best || best.status !== 'MATCHED') {
      issues.push(best?.reason || `No prescription match found for ${item.name || item.productName || 'medicine'}.`);
    }
  }

  const hasMismatch = matched.some(item => item.status === 'MISMATCH');
  const hasPartial = matched.some(item => item.status === 'PARTIAL_MATCH');
  const overallConfidence = Number(prescription?.quality?.overallConfidence || 0);
  const finalStatus = hasMismatch
    ? 'MISMATCH'
    : hasPartial || overallConfidence < 0.90
      ? 'PARTIAL_MATCH'
      : 'MATCHED';

  return {
    status: finalStatus,
    prescriptionId,
    patientPuid: prescriptionPuid,
    overallConfidence,
    medicines: matched,
    issues
  };
}

export default verifyPrescriptionAgainstItems;


async function postPrescriptionAction({ prescriptionId, orderId, path, userId, role = 'customer' }) {
  const token = serviceToken({
    userId,
    role,
    isAdmin: role === 'admin' || role === 'super_admin',
    permissions: ['prescription.read', 'prescription.write']
  });
  const response = await axios.post(
    `${config.prescriptionServiceUrl}/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/${path}`,
    new URLSearchParams({ order_id: String(orderId) }),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10_000
    }
  );
  return response.data?.data || response.data;
}

export const prescriptionClient = {
  async linkOrder(prescriptionId, orderId, context = {}) {
    try {
      return await postPrescriptionAction({ prescriptionId, orderId, path: 'link-order', ...context });
    } catch (error) {
      const detail = error.response?.data?.detail || error.message || 'Prescription order association failed.';
      throw Object.assign(new Error(detail), { statusCode: error.response?.status || 502 });
    }
  },
  async convertToOrder(prescriptionId, orderId, context = {}) {
    try {
      return await postPrescriptionAction({ prescriptionId, orderId, path: 'convert-to-order', ...context });
    } catch (error) {
      const detail = error.response?.data?.detail || error.message || 'Prescription conversion failed.';
      throw Object.assign(new Error(detail), { statusCode: error.response?.status || 502 });
    }
  }
};
