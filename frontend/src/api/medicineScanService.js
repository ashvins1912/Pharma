import apiClient from './apiClient';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const getPayload = response => response?.data?.data || response?.data || {};

export async function scanMedicineProductLabel(file) {
  if (!(file instanceof File)) throw new Error('Choose a product photo before scanning.');
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiClient.post('/api/v1/prescriptions/scan-product-label', formData);
  const result = getPayload(response);
  return result;
}

export async function uploadAndReadPrescription(file, { patientPuid, onStatus, attempts = 12, intervalMs = 1500 } = {}) {
  if (!(file instanceof File)) throw new Error('Choose a prescription image or PDF before scanning.');
  const formData = new FormData();
  formData.append('file', file);
  if (patientPuid) formData.append('patient_puid', patientPuid);
  const idempotencyKey = globalThis.crypto?.randomUUID?.()
    || 'prescription-scan-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  const uploaded = await apiClient.post('/api/v1/prescriptions/upload', formData, {
    headers: { 'Idempotency-Key': idempotencyKey }
  });
  const uploadData = getPayload(uploaded);
  const prescriptionId = uploadData.prescriptionId;
  if (!prescriptionId) throw new Error('Prescription was uploaded but no tracking ID was returned.');

  let latest = { ...uploadData, prescriptionId };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    onStatus?.(latest);
    if (['REVIEW_REQUIRED', 'AUTO_APPROVED', 'APPROVED', 'REJECTED', 'FAILED', 'INACTIVE'].includes(String(latest.status || '').toUpperCase())) {
      break;
    }
    if (attempt > 0) await sleep(intervalMs);
    try {
      const response = await apiClient.get('/api/v1/prescriptions/' + encodeURIComponent(prescriptionId));
      latest = { ...getPayload(response), prescriptionId };
    } catch (error) {
      if (error?.response?.status !== 404 && error?.response?.status !== 409) throw error;
    }
  }
  onStatus?.(latest);
  return latest;
}
