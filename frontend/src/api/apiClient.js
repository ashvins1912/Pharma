import axios from 'axios';
import { supabase } from '../supabaseClient';
import { normalizeApiError } from './apiErrors';

const rawApiBaseUrl = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
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

// First-party platform authentication is cookie-first.
// Email/password and MFA sessions are issued by the backend as HttpOnly cookies.
// Google/Supabase sessions use the Supabase bearer token until they are exchanged
// for the same platform session. Never let a stale bearer token override a valid
// first-party cookie session.
let authTransport = 'cookie';

export function setAuthTransport(transport) {
    authTransport = transport === 'bearer' ? 'bearer' : 'cookie';
}

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
    if (csrfToken) {
        config.headers['X-XSRF-TOKEN'] = csrfToken;
    }

    // The HttpOnly platform cookie is authoritative. Do not send a stale
    // bearer token alongside it because the gateway intentionally prioritizes
    // Authorization over cookies.
    if (authTransport === 'cookie') {
        delete config.headers.Authorization;
        return config;
    }

    let token = null;

    // Demo sessions are explicit bearer sessions.
    try {
        const savedDemo = localStorage.getItem('demo_session');
        if (savedDemo) {
            const parsed = JSON.parse(savedDemo);
            if (parsed?.access_token) token = parsed.access_token;
        }
    } catch {}

    // Google/Supabase bearer session is used only when no platform cookie
    // session is active.
    try {
        if (supabase && !token) {
            const { data } = await supabase.auth.getSession();
            if (data?.session?.access_token) token = data.session.access_token;
        }
    } catch {}

    if (!token) token = localStorage.getItem('demo_auth_token');

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    } else {
        delete config.headers.Authorization;
    }

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
