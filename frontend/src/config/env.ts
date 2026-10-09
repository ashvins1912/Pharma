import { z } from 'zod';

const optionalUrl = z.preprocess(
  value => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().url().optional()
);

// API base URLs may intentionally be relative (Render serves the UI and proxies
// /api/* to the gateway). Other URL settings must remain absolute URLs.
const optionalApiBase = z.preprocess(
  value => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.union([
    z.string().trim().url(),
    z.string().trim().regex(/^\/(?!\/).*/, 'Use an absolute URL or a single-slash relative path.')
  ]).optional()
);

const optionalString = z.preprocess(
  value => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).optional()
);

const frontendEnvSchema = z.object({
  VITE_API_URL: optionalApiBase,
  VITE_DEV_API_PROXY: optionalUrl,
  VITE_FRONTEND_URL: optionalUrl,
  VITE_SUPABASE_URL: optionalUrl,
  VITE_SUPABASE_ANON_KEY: optionalString
});

const parsedEnv = frontendEnvSchema.safeParse(import.meta.env ?? {});

if (!parsedEnv.success) {
  const details = parsedEnv.error.issues
    .map(({ path, message }) => `  - ${path.join('.') || 'environment'}: ${message}`)
    .join('\n');

  console.error(`Invalid frontend environment configuration:\n${details}`);
  throw new Error('Frontend environment validation failed.');
}

export const env = {
  VITE_API_URL: parsedEnv.data.VITE_API_URL || '',
  VITE_DEV_API_PROXY: parsedEnv.data.VITE_DEV_API_PROXY || '',
  VITE_FRONTEND_URL: parsedEnv.data.VITE_FRONTEND_URL || '',
  VITE_SUPABASE_URL: parsedEnv.data.VITE_SUPABASE_URL || '',
  VITE_SUPABASE_ANON_KEY: parsedEnv.data.VITE_SUPABASE_ANON_KEY || ''
};
