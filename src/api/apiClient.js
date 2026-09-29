import axios from 'axios';
import { supabase } from '../supabaseClient';

const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '',
    timeout: 10000
});

// Resilient request interceptor that ensures a valid token is always sent
apiClient.interceptors.request.use(async (config) => {
    let token = null;

    // 1. Check active Supabase session
    try {
        const { data } = await supabase.auth.getSession();
        if (data?.session?.access_token) {
            token = data.session.access_token;
        }
    } catch {
        // ignore Supabase error
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

    // 4. Default to customer demo token for development preview
    if (!token) {
        token = 'demo-customer-token';
    }

    config.headers.Authorization = `Bearer ${token}`;
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
