import 'dotenv/config';
import { z } from 'zod';

export const envSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    MONGO_URI: z.string().trim().url(),
    SUPABASE_URL: z.string().trim().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(20),
    NODE_ENV: z.enum(['development', 'production', 'test'])
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error('Invalid backend environment configuration:');
    for (const issue of parsedEnv.error.issues) {
        const key = issue.path.length > 0 ? issue.path.join('.') : 'environment';
        console.error(`  - ${key}: ${issue.message}`);
    }
    process.exit(1);
}

/** @type {import('zod').infer<typeof envSchema>} */
export const env = parsedEnv.data;
