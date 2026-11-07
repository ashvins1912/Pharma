import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

const anonKey = env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(env.SUPABASE_URL && anonKey);
// Route tests and local backend tests must not initialize the browser-oriented
// Realtime WebSocket transport; auth verification uses the existing JWT path.
export const supabase = isSupabaseConfigured && env.NODE_ENV !== 'test'
    ? createClient(env.SUPABASE_URL, anonKey)
    : null;
