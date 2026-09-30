import { z } from 'zod';

const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().trim().url(),
  VITE_SUPABASE_ANON_KEY: z.string().trim().min(1, 'Required')
});

const parsedEnv = envSchema.safeParse(import.meta.env);

if (!parsedEnv.success) {
  const details = parsedEnv.error.issues
    .map(({ path, message }) => `  - ${path.join('.')}: ${message}`)
    .join('\n');

  console.error(`Invalid frontend environment configuration:\n${details}`);
  throw new Error('Frontend environment validation failed.');
}

export const env = parsedEnv.data;
