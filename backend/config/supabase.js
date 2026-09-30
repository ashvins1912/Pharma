import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

const anonKey = env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(env.SUPABASE_URL && anonKey);
export const supabase = isSupabaseConfigured
    ? createClient(env.SUPABASE_URL, anonKey)
    : null;
