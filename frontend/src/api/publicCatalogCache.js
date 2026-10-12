const CACHE_TTL_MS = 15_000;
const cache = new Map();
const inFlight = new Map();

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Short-lived, in-memory cache for the anonymous read-only medicine catalog.
 * Never use this helper for orders, prescriptions, customer/tenant profiles,
 * permissions, or any endpoint whose response depends on authenticated identity.
 */
export async function getCachedPublicCatalog(apiClient, url, params = {}, { ttlMs = CACHE_TTL_MS, now = Date.now } = {}) {
  const key = `${url}?${JSON.stringify(stableValue(params))}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now()) return { ...hit.response, data: clone(hit.response.data), __cache: 'hit' };
  if (inFlight.has(key)) return inFlight.get(key).then(response => ({ ...response, data: clone(response.data), __cache: 'deduplicated' }));

  const request = apiClient.get(url, { params }).then(response => {
    const stored = { ...response, data: clone(response.data) };
    cache.set(key, { response: stored, expiresAt: now() + ttlMs });
    return stored;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request.then(response => ({ ...response, data: clone(response.data), __cache: 'miss' }));
}

export function invalidatePublicCatalogCache() {
  cache.clear();
}

export function getPublicCatalogCacheStats() {
  return { entries: cache.size, inFlight: inFlight.size };
}
