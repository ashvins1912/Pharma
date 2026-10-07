import axios from 'axios';
import { normalizeApiError } from './apiErrors';

// Production browser traffic stays same-origin. Render rewrites /api/* to the API Gateway,
 // so HttpOnly session cookies remain first-party to the Pharma UI origin.
const rawApiBaseUrl = String(import.meta.env.VITE_API_URL || '/api').trim().replace(/\/+$/, '');
const apiBaseUrl = rawApiBaseUrl === '/api'
    ? ''
    : rawApiBaseUrl.endsWith('/api')
        ? rawApiBaseUrl.slice(0, -4)
        : rawApiBaseUrl;

const apiClient = axios.create({
    // Call sites already include /api; keep VITE_API_URL as an origin or /api base.
    baseURL: apiBaseUrl,
    timeout: 10000,
    withCredentials: true
});

// Pharma is the single application authentication transport.
// Access tokens are HttpOnly cookies; JavaScript never handles bearer credentials.
function getCsrfCookie() {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^|;\\s*)XSRF-TOKEN=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : null;
}

apiClient.interceptors.request.use(async (config) => {
    if (!config.headers['X-Request-ID']) {
        config.headers['X-Request-ID'] = globalThis.crypto?.randomUUID?.()
            || `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    const csrfToken = getCsrfCookie();
    if (csrfToken) config.headers['X-XSRF-TOKEN'] = csrfToken;

    // Authentication is exclusively the HttpOnly Pharma session cookie.
    delete config.headers.Authorization;
    return config;
}, (error) => Promise.reject(error));

apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        const normalized = normalizeApiError(error);
        const url = String(error.config?.url || '');
        const isCredentialSubmission = /\/api\/auth\/(login|signup|demo-admin|demo-customer)(\/|$)/.test(url);
        const isSessionProbe = /\/api\/auth\/(session|logout)(\/|$)/.test(url);

        if (normalized.status === 401 && !isCredentialSubmission && !isSessionProbe && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('ashvin:authentication-required', {
                detail: { requestId: normalized.requestId }
            }));
        }

        console.warn('API request failed', {
            requestId: normalized.requestId,
            endpoint: url,
            status: normalized.status || null,
            code: normalized.code
        });
        normalized.response = error.response;
        normalized.config = error.config;
        return Promise.reject(normalized);
    }
);

export default apiClient;
