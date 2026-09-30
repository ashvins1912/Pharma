/**
 * Input Validation & Data Sanitization Middleware
 * Enforces strict typing, regex constraints, and strips NoSQL operator injections.
 */

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const TOTP_REGEX = /^\d{6}$/;

/**
 * Strips MongoDB operators ($gt, $ne, $where, etc.) from objects to prevent NoSQL injection
 */
export function sanitizeInput(value) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.map(sanitizeInput);
    if (typeof value === 'object') {
        const sanitized = {};
        for (const [k, v] of Object.entries(value)) {
            // Strip keys starting with '$' or containing '.'
            if (!k.startsWith('$') && !k.includes('.')) {
                sanitized[k] = sanitizeInput(v);
            }
        }
        return sanitized;
    }
    return value;
}

export function sanitizeBodyMiddleware(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeInput(req.body);
    }
    next();
}

export function validateLogin(req, res, next) {
    const { email, password } = req.body || {};
    const errors = [];

    if (!email || !EMAIL_REGEX.test(String(email).trim())) {
        errors.push('A valid email address is required.');
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
        errors.push('Password must be at least 6 characters long.');
    }

    if (errors.length > 0) {
        return res.status(400).json({ message: errors[0], errors });
    }
    next();
}

export function validateSignup(req, res, next) {
    const { email, password, name, mobile } = req.body || {};
    const errors = [];

    if (!email || !EMAIL_REGEX.test(String(email).trim())) {
        errors.push('A valid email address is required.');
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
        errors.push('Password must contain at least 8 characters.');
    } else {
        const hasUpper = /[A-Z]/.test(password);
        const hasLower = /[a-z]/.test(password);
        const hasDigit = /[0-9]/.test(password);
        if (!hasUpper || !hasLower || !hasDigit) {
            errors.push('Password must contain at least one uppercase letter, one lowercase letter, and one number.');
        }
    }
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
        errors.push('Full name must be at least 2 characters.');
    }
    if (mobile) {
        const digits = String(mobile).replace(/\D/g, '');
        if (digits.length < 10) {
            errors.push('Mobile number must be at least 10 digits.');
        }
    }

    if (errors.length > 0) {
        return res.status(400).json({ message: errors[0], errors });
    }
    next();
}

export function validateTotp(req, res, next) {
    const { code } = req.body || {};
    if (!code || !TOTP_REGEX.test(String(code).trim())) {
        return res.status(400).json({ message: 'A 6-digit numeric TOTP authentication code is required.' });
    }
    req.body.code = String(code).trim();
    next();
}

export default {
    sanitizeInput,
    sanitizeBodyMiddleware,
    validateLogin,
    validateSignup,
    validateTotp
};
