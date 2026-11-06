import apiClient from './apiClient';
import { getCachedPublicCatalog } from './publicCatalogCache';
import { buildCatalogQuery, normalizeCatalogResponse } from './catalogMapper';

export { buildCatalogQuery, normalizeCatalogResponse };

export async function fetchMedicineCatalog(params, { force = false, client = apiClient } = {}) {
  // A forced refresh must not join a previous in-flight request for the same
  // key; inventory mutations may have changed the response while it was pending.
  const response = force
    ? await client.get('/api/medicines', { params })
    : await getCachedPublicCatalog(client, '/api/medicines', params);
  return normalizeCatalogResponse(response);
}

export const medicineCatalogService = {
  buildCatalogQuery,
  fetchMedicineCatalog,
  normalizeResponse: normalizeCatalogResponse
};
