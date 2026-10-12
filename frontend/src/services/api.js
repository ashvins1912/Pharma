import axios from 'axios';
import useGlobalStore from '../store/useGlobalStore';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:8080',
  timeout: 10000,
});

api.interceptors.request.use(
  (config) => {
    const token = useGlobalStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    useGlobalStore.getState().incrementRequestCount();
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const store = useGlobalStore.getState();
    store.logError(error);

    if (error.response && error.response.status === 401) {
      store.logout();
    }

    if (!error.response) {
      // Network error or service unreachable
      store.setCircuitBreakerStatus('OPEN');
    }

    return Promise.reject(error);
  }
);

export default api;
