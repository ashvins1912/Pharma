import { z } from 'zod';

const optionalUrl = z.preprocess(
  value => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().url().optional()
);

const optionalString = z.preprocess(
  value => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).optional()
);

const frontendEnvSchema = z.object({
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
  VITE_SUPABASE_URL: parsedEnv.data.VITE_SUPABASE_URL || '',
  VITE_SUPABASE_ANON_KEY: parsedEnv.data.VITE_SUPABASE_ANON_KEY || ''
};
