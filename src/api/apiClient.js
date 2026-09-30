import axios from 'axios';
import { supabase } from '../supabaseClient';

const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '',
    timeout: 10000,
    withCredentials: true
});

function getCsrfCookie() {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^|;\\s*)XSRF-TOKEN=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : null;
}

// Resilient request interceptor that ensures tokens and anti-CSRF headers are sent
apiClient.interceptors.request.use(async (config) => {
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
        const { data } = await supabase.auth.getSession();
        if (!token && data?.session?.access_token) {
            token = data.session.access_token;
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
    return config;
}, (error) => Promise.reject(error));

// Resilient response interceptor that prevents false session timeouts
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        let handledError = { message: "Network communication error." };
        if (error.response) {
            if (error.response.status === 401) {
                // Only clear if explicitly an expired custom token
                handledError.message = error.response.data?.message || "Session authentication required.";
            } else {
                handledError.message = error.response.data?.message || "Internal server error.";
            }
        } else if (error.request) {
            handledError.message = "Pharmacy core API endpoint server offline or unreachable.";
        }
        return Promise.reject(handledError);
    }
);

export default apiClient;
