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

const corsOriginsSchema = z.string().trim().min(1).refine(value => {
    const origins = value.split(',').map(origin => origin.trim()).filter(Boolean);
    if (!origins.length) return false;

    return origins.every(origin => {
        try {
            const parsed = new URL(origin);
            return (parsed.protocol === 'https:' || (!isProduction && parsed.protocol === 'http:'))
                && parsed.origin === origin;
        } catch {
            return false;
        }
    });
}, {
    message: 'Expected a comma-separated list of exact origins; production origins must use HTTPS.'
});

export const envSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(isProduction ? 5000 : 3000),
    MONGO_URI: isProduction ? mongoUriSchema : optionalString(mongoUriSchema),
    SUPABASE_URL: isProduction ? z.string().trim().url() : optionalString(z.string().trim().url()),
    SUPABASE_ANON_KEY: optionalString(z.string().trim().min(1)),
    SUPABASE_SERVICE_ROLE_KEY: isProduction ? z.string().trim().min(20) : optionalString(z.string().trim().min(20)),
    PHARMA_JWT_PRIVATE_KEY: isProduction ? z.string().trim().min(100) : optionalString(z.string().trim().min(100)),
    PHARMA_JWT_PUBLIC_KEY: isProduction ? z.string().trim().min(100) : optionalString(z.string().trim().min(100)),
    PHARMA_JWT_ISSUER: z.string().trim().default('pharma-auth'),
    PHARMA_JWT_AUDIENCE: z.string().trim().default('pharma-api'),
    // Keep the signed access token lifetime aligned with the 1-hour HttpOnly session cookie.
    // A shorter default (for example 10m) caused valid browser sessions to hold an
    // expired JWT and then fail protected requests such as /api/user/addresses.
    PHARMA_ACCESS_TOKEN_TTL: z.string().trim().default('1h'),
    PHARMA_REFRESH_TOKEN_TTL: z.string().trim().default('7d'),
    GATEWAY_AUTH_SECRET: isProduction ? z.string().trim().min(32) : optionalString(z.string().trim().min(32)),
    REQUIRE_GATEWAY_TRUST: z.enum(['true', 'false']).default(isProduction ? 'true' : 'false'),
    SERVICE_AUTH_SECRET: isProduction ? z.string().trim().min(32) : optionalString(z.string().trim().min(32)),
    SERVICE_JWT_ISSUER: z.string().trim().default('ashvin-pharmacy'),
    INVENTORY_SERVICE_URL: optionalString(z.string().trim().url()),
    PRESCRIPTION_SERVICE_URL: optionalString(z.string().trim().url()),
    ORDER_SERVICE_URL: optionalString(z.string().trim().url()),
    ORDER_SERVICE_JWT_AUDIENCE: z.string().trim().default('order-service'),
    PRESCRIPTION_SERVICE_JWT_AUDIENCE: z.string().trim().default('prescription-service'),
    CORS_ALLOWED_ORIGINS: isProduction ? corsOriginsSchema : optionalString(corsOriginsSchema),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PAYMENT_REMINDER_ENABLED: z.enum(['true', 'false']).default('false'),
    PAYMENT_REMINDER_ENGINE_ENABLED: z.enum(['true', 'false']).default('false'),
    PAYMENT_REMINDER_THROTTLE_HOURS: optionalString(z.coerce.number().int().positive()),
    PAYMENT_REMINDER_SNOOZE_HOURS: optionalString(z.coerce.number().positive()),
    PAYMENT_ACTION_BASE_URL: optionalString(z.string().url().refine(value => !isProduction || value.startsWith('https://'), {
        message: 'Payment action URLs must use HTTPS in production.'
    })),
    SYSTEM_SECRET_KEY: optionalString(z.string().min(32)),
    WHATSAPP_DELIVERY_TRACKING_ENABLED: z.enum(['true', 'false']).default('false'),
    MONGO_TRANSACTIONS_CONFIRMED: z.enum(['true', 'false']).default('false'),
    DELIVERY_MAX_ATTEMPTS: optionalString(z.coerce.number().int().positive()),
    DELIVERY_ACTION_BASE_URL: optionalString(z.string().url().refine(value => !isProduction || value.startsWith('https://'), {
        message: 'Delivery action URLs must use HTTPS in production.'
    })),
    DELIVERY_EVENT_SECRET: optionalString(z.string().min(32)),
    SMTP_HOST: optionalString(z.string().trim()),
    SMTP_PORT: optionalString(z.coerce.number().int().min(1).max(65535)),
    SMTP_SECURE: optionalString(z.enum(['true', 'false'])),
    SMTP_USER: optionalString(z.string().trim()),
    SMTP_PASS: optionalString(z.string().trim()),
    SMTP_FROM: optionalString(z.string().trim()),
    SMTP_SERVICE: optionalString(z.string().trim())
}).superRefine((value, context) => {
    if (value.PAYMENT_REMINDER_ENABLED === 'true' || value.PAYMENT_REMINDER_ENGINE_ENABLED === 'true') {
        if (!value.SYSTEM_SECRET_KEY) context.addIssue({ code: 'custom', path: ['SYSTEM_SECRET_KEY'], message: 'Required when payment reminders are enabled.' });
        if (!value.PAYMENT_ACTION_BASE_URL) context.addIssue({ code: 'custom', path: ['PAYMENT_ACTION_BASE_URL'], message: 'Required when payment reminders are enabled.' });
    }
    if (value.WHATSAPP_DELIVERY_TRACKING_ENABLED === 'true') {
        for (const key of ['SYSTEM_SECRET_KEY', 'DELIVERY_EVENT_SECRET', 'DELIVERY_ACTION_BASE_URL', 'DELIVERY_MAX_ATTEMPTS']) {
            if (!value[key]) context.addIssue({ code: 'custom', path: [key], message: 'Required when delivery event tracking is enabled.' });
        }
        if (value.MONGO_TRANSACTIONS_CONFIRMED !== 'true') {
            context.addIssue({ code: 'custom', path: ['MONGO_TRANSACTIONS_CONFIRMED'], message: 'Confirm transaction support before enabling delivery tracking.' });
        }
    }
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
