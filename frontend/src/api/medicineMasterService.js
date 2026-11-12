import apiClient from './apiClient';

// Cache identical Store detail lookups briefly and share in-flight requests.
// This prevents repeated modal renders from issuing duplicate match requests.
const MATCH_CACHE_TTL_MS = 30_000;
const MATCH_CACHE_MAX_ENTRIES = 500;
const matchCache = new Map();

export async function matchStoreMedicineToMaster(product) {
  const params = {
    name: String(product?.name || '').trim(),
    brand: String(product?.brand || '').trim(),
    genericName: String(product?.genericName || '').trim(),
    composition: String(product?.composition || '').trim(),
    strength: String(product?.strength || '').trim(),
    dosageForm: String(product?.dosageForm || product?.form || '').trim(),
    packSize: String(product?.packSize || '').trim(),
  };
  if (![params.name, params.brand, params.genericName, params.composition].some(Boolean)) {
    return { status: 'NO_MATCH', confidence: 0, medicine: null, mappingStatus: 'PENDING' };
  }

  const key = JSON.stringify(params);
  const cached = matchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (cached) matchCache.delete(key);

  const promise = apiClient.get('/api/v1/inventory/catalogue/medicines/match', { params })
    .then(response => response.data?.data || response.data)
    .catch(error => {
      matchCache.delete(key);
      throw error;
    });
  matchCache.set(key, { expiresAt: Date.now() + MATCH_CACHE_TTL_MS, promise });
  if (matchCache.size > MATCH_CACHE_MAX_ENTRIES) {
    const oldestKey = matchCache.keys().next().value;
    if (oldestKey !== undefined) matchCache.delete(oldestKey);
  }
  return promise;
}
