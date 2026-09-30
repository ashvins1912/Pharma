import 'dotenv/config';
import { z } from 'zod';

const mongoUriSchema = z.string().trim().refine(value => {
    const match = value.match(/^(mongodb(?:\+srv)?):\/\/([^/?#]*)(.*)$/);
    if (!match) return false;

    const [, scheme, authority, suffix] = match;
    const credentialsEnd = authority.lastIndexOf('@');
    const credentials = credentialsEnd >= 0 ? authority.slice(0, credentialsEnd + 1) : '';
    const hosts = authority.slice(credentialsEnd + 1).split(',');
    if (hosts.some(host => !host) || (scheme === 'mongodb+srv' && hosts.length !== 1)) {
        return false;
    }

    return hosts.every(host => {
        try {
            const uri = new URL(`${scheme}://${credentials}${host}${suffix}`);
            return Boolean(uri.hostname) && (scheme !== 'mongodb+srv' || !uri.port);
        } catch {
            return false;
        }
    });
}, {
    message: 'Expected a valid MongoDB URI starting with mongodb:// or mongodb+srv://.'
});

export const envSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    MONGO_URI: mongoUriSchema,
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
