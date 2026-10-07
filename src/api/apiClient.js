import axios from 'axios';
import { supabase } from '../supabaseClient';
import { normalizeApiError } from './apiErrors';

const resolveBaseUrl = () => {
    const configuredUrl = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
    const rawUrl = configuredUrl === '/api'
        ? ''
        : configuredUrl.endsWith('/api')
            ? configuredUrl.slice(0, -4)
            : configuredUrl;
    if (typeof window !== 'undefined') {
        // In browser, if VITE_API_URL points to localhost/127.0.0.1 while the page
        // is hosted on a remote domain (e.g. Cloud Run preview), use relative URL.
        // The Express backend and Vite frontend are hosted together on the same origin.
        if (!rawUrl || rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1')) {
            if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                return '';
            }
        }
        if (window.location.protocol === 'https:' && rawUrl.startsWith('http://')) {
            return '';
        }
    }
    return rawUrl;
};

const apiClient = axios.create({
    baseURL: resolveBaseUrl(),
    timeout: 15000,
    withCredentials: true
});

function getCsrfCookie() {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^|;\\s*)XSRF-TOKEN=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : null;
}

// Resilient request interceptor that ensures tokens and anti-CSRF headers are sent
apiClient.interceptors.request.use(async (config) => {
    if (!config.headers['X-Request-ID']) {
        config.headers['X-Request-ID'] = globalThis.crypto?.randomUUID?.()
            || `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
    // 1. Auto-attach Anti-CSRF Token header for Double Submit Cookie pattern
    const csrfToken = getCsrfCookie();
    if (csrfToken) {
        config.headers['X-XSRF-TOKEN'] = csrfToken;
    }

    let token = null;

    // Keep the server-issued local demo admin token ahead of any prior Supabase session.
    try {
        const savedDemo = localStorage.getItem('demo_session');
        if (savedDemo) {
            const parsed = JSON.parse(savedDemo);
            if (parsed?.user?.id === 'admin' && parsed?.access_token) {
                token = parsed.access_token;
            }
        }
    } catch {}

    // Check active Supabase session
    try {
        if (supabase) {
            const { data } = await supabase.auth.getSession();
            if (!token && data?.session?.access_token) {
                token = data.session.access_token;
            }
        }
    } catch {
        // Continue with the saved demo token when Supabase is unavailable.
    }

    // 2. Check demo auth token in localStorage
    if (!token) {
        token = localStorage.getItem('demo_auth_token');
    }

    // 3. Check demo session object in localStorage
    if (!token) {
        try {
            const savedDemo = localStorage.getItem('demo_session');
            if (savedDemo) {
                const parsed = JSON.parse(savedDemo);
                if (parsed?.access_token) token = parsed.access_token;
            }
        } catch {}
    }

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    } else {
        delete config.headers.Authorization;
    }

    const tenantId = localStorage.getItem('selected_tenant_id') || 'tenant-ashvin-main';
    const branchId = localStorage.getItem('selected_branch_id') || 'branch-indore-central';
    if (!config.headers['x-tenant-id']) config.headers['x-tenant-id'] = tenantId;
    if (!config.headers['x-branch-id']) config.headers['x-branch-id'] = branchId;

    return config;
}, (error) => Promise.reject(error));

// Resilient response interceptor that prevents false session timeouts
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        const normalized = normalizeApiError(error);
        const url = String(error.config?.url || '');
        const isCredentialSubmission = /\/api\/auth\/(login|signup|demo-admin|demo-customer)(\/|$)/.test(url);
        const isSessionProbe = /\/api\/auth\/(session|logout)(\/|$)/.test(url);
        if (normalized.status === 401 && !isCredentialSubmission && !isSessionProbe && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('ashvin:authentication-required', {
                detail: { requestId: normalized.requestId, config: error.config }
            }));
        } else if (normalized.status === 403 && normalized.code === 'MFA_CHALLENGE_REQUIRED' && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('ashvin:mfa-required', {
                detail: { requestId: normalized.requestId, config: error.config }
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
