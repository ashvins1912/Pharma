import apiClient from './apiClient';
import { getCachedPublicCatalog, invalidatePublicCatalogCache } from './publicCatalogCache';

function unwrapCatalogPayload(response) {
  let payload = response?.data ?? response ?? {};
  for (let depth = 0; depth < 3 && payload && typeof payload === 'object' && payload.data; depth += 1) {
    if (payload.medicines || Array.isArray(payload)) break;
    payload = payload.data;
  }
  if (Array.isArray(payload)) {
    return { medicines: payload, total: payload.length, page: 1, limit: payload.length, totalPages: 1, isSearching: false };
  }
  const medicines = Array.isArray(payload?.medicines)
    ? payload.medicines
    : Array.isArray(payload?.items) ? payload.items : null;
  if (!medicines) {
    const error = new Error(payload?.message || 'Medicine catalogue returned an unexpected response.');
    error.code = payload?.code || 'INVALID_CATALOG_RESPONSE';
    throw error;
  }
  return {
    medicines,
    total: Number(payload.total ?? payload.pagination?.total ?? medicines.length) || 0,
    page: Number(payload.page ?? payload.pagination?.page ?? 1) || 1,
    limit: Number(payload.limit ?? payload.pagination?.limit ?? medicines.length) || 1,
    totalPages: Number(payload.totalPages ?? payload.pages ?? payload.pagination?.totalPages ?? 1) || 1,
    isSearching: Boolean(payload.isSearching),
    outOfStockHidden: payload.outOfStockHidden
  };
}

export function buildCatalogQuery({
  tenantId, branchId, page = 1, limit = 16, search = '',
  hideRx = false, category = 'All', sort = 'default'
}) {
  if (!tenantId) {
    const error = new Error('Select a pharmacy to view its medicine catalogue.');
    error.code = 'PHARMACY_SELECTION_REQUIRED';
    error.status = 400;
    throw error;
  }
  return {
    tenantId: String(tenantId),
    ...(branchId ? { branchId: String(branchId) } : {}),
    page,
    limit,
    ...(search ? { search } : {}),
    ...(hideRx ? { hideRx: 'true' } : {}),
    ...(category && category !== 'All' ? { category } : {}),
    ...(sort && sort !== 'default' ? { sort } : {})
  };
}

export async function fetchMedicineCatalog(params, { force = false, client = apiClient } = {}) {
  if (force) invalidatePublicCatalogCache();
  const response = await getCachedPublicCatalog(client, '/api/medicines', params);
  return unwrapCatalogPayload(response);
}

export const medicineCatalogService = {
  buildCatalogQuery,
  fetchMedicineCatalog,
  normalizeResponse: unwrapCatalogPayload
};
