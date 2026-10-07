import axios from 'axios';
import { normalizeApiError } from './apiErrors';

// Runtime-only bearer fallback for deployments where the browser cannot
// persist the gateway's HttpOnly cookie (for example, an older direct-gateway
// deployment). The token is never written to localStorage/sessionStorage.
let runtimeAccessToken = null;

export function setRuntimeAccessToken(token) {
    runtimeAccessToken = typeof token === 'string' && token.trim() ? token.trim() : null;
}

export function clearRuntimeAccessToken() {
    runtimeAccessToken = null;
}

// Production browser traffic MUST stay on the Pharma UI origin.
// Render rewrites /api/* to the API Gateway, which keeps HttpOnly session
// cookies first-party to the browser's current site. Never use the gateway
// hostname as a browser API base URL in production.
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
    // Call sites already include /api. In production this resolves explicitly
    // to https://pharma-ui.onrender.com/api/... and Render rewrites internally.
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
    if (typeof window !== 'undefined' && config.showLoader !== false) {
        const url = String(config.url || '');
        const blocking = /\/api\/(?:v1\/auth|auth)\/(login|signup|google|verify-email-code|complete-profile|onboarding|mfa\/verify|password\/forgot|password\/reset)(\/|$)/.test(url);
        window.dispatchEvent(new CustomEvent('pharma:request-start', { detail: { blocking } }));
        config.__pharmaLoader = { blocking };
    }
    if (!config.headers['X-Request-ID']) {
        config.headers['X-Request-ID'] = globalThis.crypto?.randomUUID?.()
            || `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    const csrfToken = getCsrfCookie();
    if (csrfToken) config.headers['X-XSRF-TOKEN'] = csrfToken;

    // Prefer the HttpOnly cookie. If the browser did not retain/send that
    // cookie, use the short-lived runtime-only token returned by Pharma auth.
    // This does not persist credentials in browser storage.
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
        if (/\/api\/(?:v1\/auth|auth)\/logout(\/|$)/.test(url)) {
            clearRuntimeAccessToken();
        }
        return response;
    },
    (error) => {
        if (typeof window !== 'undefined' && error.config?.__pharmaLoader) {
            window.dispatchEvent(new CustomEvent('pharma:request-stop', { detail: error.config.__pharmaLoader }));
        }
        const normalized = normalizeApiError(error);
        const url = String(error.config?.url || '');
        if (normalized.status === 401) {
            clearRuntimeAccessToken();
        }
        const isCredentialSubmission = /\/api\/(?:v1\/auth|auth)\/(login|signup|google|verify-email-code|resend-verification|complete-profile|onboarding|password\/forgot|password\/reset|mfa\/verify)(\/|$)/.test(url);
        const isSessionProbe = /\/api\/(?:v1\/auth|auth)\/(session|me|logout|csrf)(\/|$)/.test(url);

        // A failed onboarding/auth endpoint must not globally clear the
        // current React auth state. In particular, a transient 401 from
        // complete-profile should be shown in the onboarding dialog instead
        // of redirecting the user to the login screen.
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
