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

const isProduction = process.env.NODE_ENV === 'production';

const optionalString = (schema) => z.preprocess(
    value => typeof value === 'string' && value.trim() === '' ? undefined : value,
    schema.optional()
);

const corsOriginsSchema = z.string().transform(value => value.split(',').map(origin => origin.trim()).filter(Boolean))
    .refine(origins => origins.length > 0, 'At least one allowed origin must be configured.')
    .refine(origins => origins.every(origin => {
        try {
            const parsed = new URL(origin);
            return ['http:', 'https:'].includes(parsed.protocol)
                && parsed.origin === origin
                && parsed.username === ''
                && parsed.password === '';
        } catch {
            return false;
        }
    }), 'Origins must be exact HTTP(S) origins without paths, credentials, or trailing slashes.')
    .refine(origins => !isProduction || origins.every(origin => origin.startsWith('https://')),
        'Production CORS origins must use HTTPS.');

export const envSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(isProduction ? 5000 : 8090),
    MONGO_URI: isProduction ? mongoUriSchema : optionalString(mongoUriSchema),
    SUPABASE_URL: isProduction ? z.string().trim().url() : optionalString(z.string().trim().url()),
    SUPABASE_ANON_KEY: optionalString(z.string().trim().min(1)),
    SUPABASE_SERVICE_ROLE_KEY: isProduction ? z.string().trim().min(20) : optionalString(z.string().trim().min(20)),
    GATEWAY_AUTH_SECRET: isProduction
        ? z.string().trim().min(32)
        : optionalString(z.string().trim().min(32)),
    CORS_ALLOWED_ORIGINS: isProduction
        ? corsOriginsSchema
        : z.preprocess(
            value => typeof value !== 'string' || !value.trim()
                ? 'http://localhost:3000,http://localhost:5173'
                : value,
            corsOriginsSchema
        ),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development')
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
