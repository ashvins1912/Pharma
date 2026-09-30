import { createClient } from '@supabase/supabase-js';
import { env } from './config/env.ts';

const getEnvVar = (key) => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta?.env?.[key]) {
      return import.meta.env[key];
    }
  } catch {}
  try {
    if (typeof process !== 'undefined' && process?.env?.[key]) {
      return process.env[key];
    }
  } catch {}
  return '';
};

const supabaseUrl = (getEnvVar('VITE_SUPABASE_URL') || getEnvVar('SUPABASE_URL') || '')?.trim();
const supabaseAnonKey = (getEnvVar('VITE_SUPABASE_ANON_KEY') || getEnvVar('SUPABASE_ANON_KEY') || '')?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
    env.VITE_SUPABASE_URL,
    env.VITE_SUPABASE_ANON_KEY
);
