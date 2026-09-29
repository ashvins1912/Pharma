import axios from 'axios';
import { supabase } from '../supabaseClient';

const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5001',
    timeout: 10000
});

apiClient.interceptors.request.use(async (config) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
        config.headers.Authorization = `Bearer ${session.access_token}`;
    }
    return config;
}, (error) => Promise.reject(error));

apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        let handledError = { message: "A communication network error has dropped links." };
        if (error.response) {
            if (error.response.status === 401) {
                supabase.auth.signOut();
                handledError.message = "Session reference timeout. Re-authentication triggered.";
            } else {
                handledError.message = error.response.data?.message || "Internal network error logs.";
            }
        } else if (error.request) {
            handledError.message = "Pharmacy core API endpoint server went offline unexpectedly.";
        }
        return Promise.reject(handledError);
    }
);

export default apiClient;
