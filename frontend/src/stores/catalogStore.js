import { create } from 'zustand';
import { buildCatalogQuery, fetchMedicineCatalog } from '../api/medicineCatalogService';

const pendingRequests = new Map();
let requestSequence = 0;

function makeKey(params) {
  return JSON.stringify(Object.keys(params).sort().reduce((result, key) => {
    result[key] = params[key];
    return result;
  }, {}));
}

export const useCatalogStore = create((set, get) => ({
  medicines: [],
  error: '',
  loading: false,
  total: 0,
  totalPages: 1,
  page: 1,
  isSearching: false,
  activeKey: null,
  lastLoadedAt: 0,
  activeRequestId: null,

  loadCatalog: async (filters, options = {}) => {
    let params;
    try {
      params = buildCatalogQuery(filters);
    } catch (error) {
      set({ medicines: [], error: error.message, loading: false, total: 0, totalPages: 1, activeKey: null });
      return null;
    }
    const key = makeKey(params);
    const current = get();
    if (!options.force && current.activeKey === key && current.lastLoadedAt && Date.now() - current.lastLoadedAt < 12000) {
      return { medicines: current.medicines, total: current.total, totalPages: current.totalPages, cached: true };
    }

    if (!options.force && pendingRequests.has(key)) {
      set({ activeKey: key, loading: true, error: '' });
      return pendingRequests.get(key);
    }

    // Clear cross-pharmacy data immediately. Never flash the previous pharmacy's medicines.
    // Each request owns a sequence token so even same-key forced refreshes cannot
    // be overwritten by an older response that happens to finish later.
    const requestId = ++requestSequence;
    set({
      activeKey: key,
      activeRequestId: requestId,
      ...(current.activeKey !== key ? { medicines: [], total: 0, totalPages: 1 } : {}),
      loading: true,
      error: ''
    });

    const request = fetchMedicineCatalog(params, options)
      .then(result => {
        if (get().activeKey !== key || get().activeRequestId !== requestId) return result;
        set({
          medicines: result.medicines,
          total: result.total,
          totalPages: result.totalPages,
          page: result.page,
          isSearching: result.isSearching,
          loading: false,
          error: '',
          lastLoadedAt: Date.now()
        });
        return result;
      })
      .catch(error => {
        if (get().activeKey === key && get().activeRequestId === requestId) {
          set({
            medicines: [],
            total: 0,
            totalPages: 1,
            loading: false,
            error: error?.response?.data?.message || error.message || 'Unable to load medicines.'
          });
        }
        throw error;
      })
      .finally(() => {
        if (pendingRequests.get(key) === request) pendingRequests.delete(key);
      });
    pendingRequests.set(key, request);
    return request;
  },

  clearCatalog: message => {
    set({ medicines: [], total: 0, totalPages: 1, loading: false, error: message || '', activeKey: null, activeRequestId: null, lastLoadedAt: 0 });
  }
}));
