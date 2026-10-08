import axios from 'axios';
import { normalizeApiError } from './apiErrors';

let runtimeAccessToken = null;

export function setRuntimeAccessToken(token) {
    runtimeAccessToken = typeof token === 'string' && token.trim() ? token.trim() : null;
}

export function clearRuntimeAccessToken() {
    runtimeAccessToken = null;
}

const configuredApiBaseUrl = String(import.meta.env.VITE_API_URL || '/api').trim();
const rawApiBaseUrl = import.meta.env.PROD
    ? (typeof window !== 'undefined' ? window.location.origin : '')
    : configuredApiBaseUrl.replace(/\/+$/, '');
const apiBaseUrl = import.meta.env.PROD
    ? rawApiBaseUrl
    : rawApiBaseUrl === '/api'
        ? ''
        : rawApiBaseUrl.endsWith('/api')
            ? rawApiBaseUrl.slice(0, -4)
            : rawApiBaseUrl;

const apiClient = axios.create({
    baseURL: apiBaseUrl,
    timeout: 10000,
    withCredentials: true
});

function getCsrfCookie() {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^|;\\s*)XSRF-TOKEN=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : null;
}

apiClient.interceptors.request.use(async (config) => {
    if (typeof window !== 'undefined' && config.loadingAction) {
        window.dispatchEvent(new CustomEvent('pharma:request-start', {
            detail: { action: config.loadingAction }
        }));
        config.__pharmaLoader = { action: config.loadingAction };
    }
    if (!config.headers['X-Request-ID']) {
        config.headers['X-Request-ID'] = globalThis.crypto?.randomUUID?.()
            || `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    const csrfToken = getCsrfCookie();
    if (csrfToken) config.headers['X-XSRF-TOKEN'] = csrfToken;

    if (runtimeAccessToken && !config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${runtimeAccessToken}`;
    }
    return config;
}, (error) => Promise.reject(error));

apiClient.interceptors.response.use(
    (response) => {
        if (typeof window !== 'undefined' && response.config?.__pharmaLoader) {
            window.dispatchEvent(new CustomEvent('pharma:request-stop', { detail: response.config.__pharmaLoader }));
        }
        const url = String(response.config?.url || '');
        const result = response.data?.data || response.data;
        if (/\/api\/(?:v1\/auth|auth)\/(login|signup|google|mfa\/verify|complete-profile|onboarding)(\/|$)/.test(url)
            && result?.accessToken) {
            setRuntimeAccessToken(result.accessToken);
        }
        if (/\/api\/(?:v1\/auth|auth)\/logout(\/|$)/.test(url)) clearRuntimeAccessToken();
        return response;
    },
    async (error) => {
        if (typeof window !== 'undefined' && error.config?.__pharmaLoader) {
            window.dispatchEvent(new CustomEvent('pharma:request-stop', { detail: error.config.__pharmaLoader }));
        }

        const url = String(error.config?.url || '');
        const status = error.response?.status;
        const isRefreshRequest = /\/api\/(?:v1\/auth|auth)\/refresh(\/|$)/.test(url);
        const isCredentialSubmission = /\/api\/(?:v1\/auth|auth)\/(login|signup|google|verify-email-code|resend-verification|complete-profile|onboarding|password\/forgot|password\/reset|mfa\/verify)(\/|$)/.test(url);
        const isSessionProbe = /\/api\/(?:v1\/auth|auth)\/(session|me|logout|csrf)(\/|$)/.test(url);

        // Recover transparently from an expired access JWT using the HttpOnly
        // refresh cookie. Retry the original request exactly once.
        if (status === 401 && !isRefreshRequest && !isCredentialSubmission && !isSessionProbe
            && typeof window !== 'undefined' && !error.config?.__pharmaAuthRetry) {
            try {
                await apiClient.post('/api/v1/auth/refresh', null, {
                    __pharmaRefreshRequest: true,
                    __pharmaAuthRetry: true
                });
                return apiClient({ ...error.config, __pharmaAuthRetry: true });
            } catch {
                // The refresh cookie is also expired/revoked; continue normally.
            }
        }

        const normalized = normalizeApiError(error);
        if (normalized.status === 401) clearRuntimeAccessToken();

        if (normalized.status === 401 && !isCredentialSubmission && !isSessionProbe && !isRefreshRequest && typeof window !== 'undefined') {
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

