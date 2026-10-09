import axios from 'axios';
import { normalizeApiError } from './apiErrors';
import { resolveApiCapability } from './apiCapabilities';

let runtimeAccessToken = null;
let sessionRefreshPromise = null;
let sessionProbePromise = null;
let csrfBootstrapPromise = null;
let authorizationRevalidationPromise = null;
let applicationSessionAuthenticated = false;
let authorizationCapabilities = { userId: null, role: null, permissions: [] };

export function setRuntimeAccessToken(token) {
    runtimeAccessToken = typeof token === 'string' && token.trim() ? token.trim() : null;
}

export function clearRuntimeAccessToken() {
    runtimeAccessToken = null;
}

// HttpOnly session cookies cannot be inspected from JavaScript. AuthContext
// explicitly mirrors the authenticated state here so a public 401 can never
// cause the refresh interceptor to probe/rotate a session that does not exist.
export function setApplicationSessionAuthenticated(authenticated) {
    applicationSessionAuthenticated = Boolean(authenticated);
}

export function setAuthorizationCapabilities({ userId = null, role = null, permissions = [] } = {}) {
    authorizationCapabilities = {
        userId,
        role,
        permissions: Array.isArray(permissions) ? [...permissions] : []
    };
}

export function clearAuthorizationCapabilities() {
    authorizationCapabilities = { userId: null, role: null, permissions: [] };
}

export function getAuthMe({ allowAnonymous = false } = {}) {
    if (sessionProbePromise) return sessionProbePromise;
    sessionProbePromise = apiClient.get('/api/v1/auth/me', {
        __skipAuthorizationRevalidation: true,
        __allowAnonymousProbe: allowAnonymous
    }).finally(() => {
        sessionProbePromise = null;
    });
    return sessionProbePromise;
}

export function getCsrf() {
    if (csrfBootstrapPromise) return csrfBootstrapPromise;
    csrfBootstrapPromise = apiClient.get('/api/v1/auth/csrf', {
        __skipAuthorizationRevalidation: true
    }).finally(() => {
        csrfBootstrapPromise = null;
    });
    return csrfBootstrapPromise;
}

function hasCapability(permission) {
    if (!permission || !authorizationCapabilities.userId) return false;
    if (authorizationCapabilities.role === 'SUPER_ADMIN'
        || authorizationCapabilities.role === 'PLATFORM_SUPER_ADMIN'
        || authorizationCapabilities.role === 'admin') return true;
    const granted = authorizationCapabilities.permissions;
    return granted.includes('*')
        || granted.includes(permission)
        || granted.some(item => item.endsWith('.*') && permission.startsWith(item.slice(0, -1)));
}

// Revalidate the canonical application RBAC snapshot before blocking a protected
// UI API call. This handles permission/role changes made in another tab or by
// an administrator without requiring a logout/login cycle. /auth/me is the
// identity/authorization probe and is deliberately exempt from capability
// preflight to avoid recursive revalidation.
async function revalidateAuthorization() {
    if (authorizationRevalidationPromise) return authorizationRevalidationPromise;
    authorizationRevalidationPromise = getAuthMe().then(response => {
        const data = response.data?.data || response.data || {};
        const refreshedUser = data.user || data;
        if (refreshedUser?.id) {
            const refreshedRole = refreshedUser.app_metadata?.role || refreshedUser.role || 'customer';
            const refreshedPermissions = Array.isArray(refreshedUser.permissions) ? refreshedUser.permissions : [];
            setAuthorizationCapabilities({
                userId: refreshedUser.id,
                role: refreshedRole,
                permissions: refreshedPermissions
            });
        } else {
            clearAuthorizationCapabilities();
        }
        return refreshedUser;
    }).finally(() => {
        authorizationRevalidationPromise = null;
    });
    return authorizationRevalidationPromise;
}


const configuredApiBaseUrl = String(import.meta.env.VITE_API_URL || '/api').trim();
const rawApiBaseUrl = configuredApiBaseUrl.replace(/\/+$/, '');

// The Render static site rewrites same-origin /api/* requests to the API Gateway.
// Keep production browser traffic on the frontend origin so HttpOnly session
// cookies remain first-party. Calling *.onrender.com API hosts directly makes
// refresh requests cross-site, so browsers can omit SameSite=Lax cookies.
// VITE_API_URL is still honored for local development and its Vite proxy.
const apiBaseUrl = import.meta.env.PROD
    ? ''
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
    const capability = config.permission
        ? { permission: config.permission }
        : resolveApiCapability(config.method, config.url);
    if (capability?.permission && applicationSessionAuthenticated && !hasCapability(capability.permission) && !config.__skipAuthorizationRevalidation) {
        // Revalidate once before denying. This prevents stale UI RBAC state from
        // incorrectly blocking a permission that is currently granted.
        try {
            await revalidateAuthorization();
        } catch {
            // If authorization cannot be revalidated, fail closed below.
        }
        if (!hasCapability(capability.permission)) {
            const denied = new Error('API request blocked by frontend RBAC policy.');
            denied.code = 'FRONTEND_PERMISSION_DENIED';
            denied.status = 403;
            denied.permission = capability.permission;
            return Promise.reject(denied);
        }
    }

    if (typeof window !== 'undefined' && config.loadingAction) {
        window.dispatchEvent(new CustomEvent('pharma:request-start', {
            detail: { action: config.loadingAction }
        }));
        config.__pharmaLoader = { action: config.loadingAction };
    }
    // Explicit first-party browser marker. It is not a credential; it allows the
    // Gateway to distinguish our SPA fetches when privacy tooling strips Origin.
    config.headers['X-Pharma-Client'] = 'web';

    if (!config.headers['X-Request-ID']) {
        config.headers['X-Request-ID'] = globalThis.crypto?.randomUUID?.()
            || `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    const csrfToken = getCsrfCookie();
    if (csrfToken) config.headers['X-XSRF-TOKEN'] = csrfToken;

    const isRefreshRequest = /\/api\/(?:v1\/auth|auth)\/refresh(\/|$)/.test(String(config.url || ''));
    if (isRefreshRequest) {
        // Refresh is authenticated exclusively by the HttpOnly refresh cookie.
        // Never attach a stale access JWT to this request.
        config.headers.delete?.('Authorization');
        config.headers.delete?.('authorization');
        delete config.headers.Authorization;
        delete config.headers.authorization;
    } else if (runtimeAccessToken && !config.__skipRuntimeAuth && !config.headers.Authorization) {
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

        // Anonymous application hydration intentionally probes /auth/me. A 401
        // here is a normal "no session" result, not a failed application request.
        // Keep the HTTP semantics (401) for security and observability while
        // preventing console noise and authentication side effects.
        if (status === 401 && error.config?.__allowAnonymousProbe) {
            // First-page hydration starts unauthenticated, but an existing access
            // cookie may have expired while the HttpOnly refresh cookie is still
            // valid. The gateway explicitly signals that case so we can recover
            // the session without blindly refreshing every anonymous visitor.
            const refreshable = String(error.response?.headers?.['x-session-refreshable'] || '').toLowerCase() === 'true';
            if (refreshable && !error.config?.__pharmaSessionBootstrapRetry && typeof window !== 'undefined') {
                try {
                    if (!sessionRefreshPromise) {
                        sessionRefreshPromise = apiClient.post('/api/v1/auth/refresh', null, {
                            __pharmaRefreshRequest: true,
                            __pharmaAuthRetry: true,
                            __skipRuntimeAuth: true
                        }).finally(() => {
                            sessionRefreshPromise = null;
                        });
                    }
                    await sessionRefreshPromise;
                    clearRuntimeAccessToken();
                    const retryConfig = {
                        ...error.config,
                        __allowAnonymousProbe: false,
                        __pharmaSessionBootstrapRetry: true,
                        __pharmaAuthRetry: true,
                        __skipRuntimeAuth: true,
                        headers: { ...(error.config?.headers || {}) }
                    };
                    delete retryConfig.headers.Authorization;
                    delete retryConfig.headers.authorization;
                    return apiClient(retryConfig);
                } catch {
                    // No usable refresh session; continue as an anonymous visitor.
                }
            }
            clearRuntimeAccessToken();
            return {
                data: null,
                status: 401,
                statusText: 'Unauthorized',
                headers: error.response?.headers || {},
                config: error.config,
                request: error.request
            };
        }

        // Recover transparently from an expired access JWT using the HttpOnly
        // refresh cookie. Retry the original request exactly once.
        if (status === 401 && applicationSessionAuthenticated && !isRefreshRequest && !isCredentialSubmission && !isSessionProbe
            && typeof window !== 'undefined' && !error.config?.__pharmaAuthRetry) {
            try {
                if (!sessionRefreshPromise) {
                    sessionRefreshPromise = apiClient.post('/api/v1/auth/refresh', null, {
                        __pharmaRefreshRequest: true,
                        __pharmaAuthRetry: true,
                        __skipRuntimeAuth: true
                    }).finally(() => {
                        sessionRefreshPromise = null;
                    });
                }
                await sessionRefreshPromise;
                // Refresh rotates the HttpOnly cookie; the refresh endpoint deliberately
                // does not expose the new access token to JavaScript. Drop the stale
                // in-memory bearer and retry with the fresh cookie instead.
                clearRuntimeAccessToken();
                const retryConfig = {
                    ...error.config,
                    __pharmaAuthRetry: true,
                    __skipRuntimeAuth: true,
                    headers: { ...(error.config?.headers || {}) }
                };
                delete retryConfig.headers.Authorization;
                delete retryConfig.headers.authorization;
                return apiClient(retryConfig);
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

export default apiClient;
