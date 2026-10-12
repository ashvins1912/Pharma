import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios';

export interface DashboardItem { id: string; title: string; description: string; buttonText?: string; actionPayload: string; }
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://example.com';
const apiClient: AxiosInstance = axios.create({ baseURL: BASE_URL, timeout: 10000 });

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('auth_token');
  if (token && config.headers) config.headers.Authorization = `Bearer ${token}`;
  return config;
}, (error) => Promise.reject(error));
let isRefreshing = false;
let failedQueue: any[] = [];

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => { failedQueue.push({ resolve, reject }); })
          .then(t => { originalRequest.headers.Authorization = `Bearer ${t}`; return apiClient(originalRequest); });
      }
      originalRequest._retry = true;
      isRefreshing = true;
      return new Promise((resolve, reject) => {
        const refresh = localStorage.getItem('refresh_token');
        if (!refresh) { isRefreshing = false; localStorage.clear(); window.location.href = '/login'; reject(error); return; }
        axios.post(`${BASE_URL}/auth/refresh`, { refresh_token: refresh })
          .then(({ data }) => {
            localStorage.setItem('auth_token', data.accessToken);
            failedQueue.forEach(p => p.resolve(data.accessToken));
            failedQueue = [];
            resolve(apiClient(originalRequest));
          }).catch(err => { failedQueue.forEach(p => p.reject(err)); failedQueue = []; localStorage.clear(); window.location.href = '/login'; reject(err); })
          .finally(() => { isRefreshing = false; });
      });
    }
    return Promise.reject(error);
  }
);
export const dashboardService = {
  async getGridItems(): Promise<DashboardItem[]> {
    const response = await apiClient.get<DashboardItem[]>('/dashboard/items');
    return response.data;
  },
  async triggerAction(payload: string): Promise<{ success: boolean }> {
    const response = await apiClient.post<{ success: boolean }>('/dashboard/actions', { action: payload });
    return response.data;
  }
};
