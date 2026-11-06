import apiClient from './apiClient';
import { getCachedPublicCatalog, invalidatePublicCatalogCache } from './publicCatalogCache';
import { buildCatalogQuery, normalizeCatalogResponse } from './catalogMapper';

export { buildCatalogQuery, normalizeCatalogResponse };

export async function fetchMedicineCatalog(params, { force = false, client = apiClient } = {}) {
  if (force) invalidatePublicCatalogCache();
  const response = await getCachedPublicCatalog(client, '/api/medicines', params);
  return normalizeCatalogResponse(response);
}

export const medicineCatalogService = {
  buildCatalogQuery,
  fetchMedicineCatalog,
  normalizeResponse: normalizeCatalogResponse
};
