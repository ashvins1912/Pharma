/**
 * API Gateway Auth Identity and Operations Route (/api/v1/auth & /auth)
 * Implements exact JSON contracts:
 * - POST /auth/signup
 * - POST /auth/login
 * - GET  /auth/me
 * - POST /auth/verify-email
 * - POST /auth/resend-verification
 * - POST /auth/logout
 *
 * Isolated Service Architecture:
 * Security-level cryptographic hashing, credential verification,
 * identity token issuance, and multi-tenant profiling are isolated into AuthService.
 * The API Gateway enforces input validation, rate limiting, session cookies, and standard envelopes.
 */
import express from 'express';
import crypto from 'node:crypto';
import { authService } from '../../services/identity-service/AuthService.js';
import { emailService } from '../../services/email-service/EmailService.js';
import { authenticateUser } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimiter.js';
import { sendSuccess, sendError } from '../../shared/responses.js';
import { setSessionCookies, clearSessionCookies } from '../../security/sessionCookie.js';

const router = express.Router();

/**
 * POST /auth/signup
 */
router.post('/signup', authLimiter, async (req, res) => {
    const { email, password, mobile } = req.body;
    let firstName = (req.body.firstName || '').trim();
    let lastName = (req.body.lastName || '').trim();

    if (!firstName && req.body.name) {
        const parts = req.body.name.trim().split(/\s+/);
        firstName = parts[0] || '';
        lastName = parts.slice(1).join(' ') || '';
    }

    const validationDetails = [];
    if (!firstName) {
        validationDetails.push({ field: 'firstName', code: 'REQUIRED', message: 'First name is required.' });
    }
    if (!lastName) {
        validationDetails.push({ field: 'lastName', code: 'REQUIRED', message: 'Last name is required.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        validationDetails.push({ field: 'email', code: 'INVALID_EMAIL', message: 'Enter a valid email address.' });
    }
    if (!mobile || mobile.replace(/\D/g, '').length < 10) {
        validationDetails.push({ field: 'mobile', code: 'INVALID_MOBILE', message: 'Enter a valid mobile number.' });
    }
    if (!password || password.length < 8) {
        validationDetails.push({ field: 'password', code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters long.' });
    } else if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        validationDetails.push({ field: 'password', code: 'WEAK_PASSWORD', message: 'Password does not meet the security requirements.' });
    }

    if (validationDetails.length > 0) {
        return sendError(res, {
            code: 'VALIDATION_ERROR',
            message: 'Please correct the highlighted fields.',
            details: validationDetails,
            statusCode: 400,
            req
        });
    }

    try {
        const result = await authService.registerUser({
            firstName,
            lastName,
            email,
            mobile,
            password
        });

        return sendSuccess(res, {
            data: result,
            message: 'Account created. Please verify your email.',
            statusCode: 201,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'SIGNUP_ERROR',
            message: err.message || 'An unexpected error occurred during signup.',
            statusCode: err.status || 500,
            req
        });
    }
});

/**
 * POST /auth/login
 */
router.post('/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return sendError(res, {
            code: 'VALIDATION_ERROR',
            message: 'Email and password are required.',
            statusCode: 400,
            req
        });
    }

    try {
        const result = await authService.authenticateCredentials({ email, password });
        if (result.accessToken) {
            setSessionCookies(res, { accessToken: result.accessToken });
        }

        return sendSuccess(res, {
            data: result,
            message: 'Login successful',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'AUTHENTICATION_FAILED',
            message: err.message || 'Authentication failed. Please try again.',
            statusCode: err.status || 401,
            req
        });
    }
});

/**
 * GET /auth/me
 */
router.get('/me', authenticateUser, async (req, res) => {
    try {
        const profile = await authService.getUserProfile(req.user, req.context);
        return sendSuccess(res, {
            data: profile,
            message: 'Profile retrieved successfully',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: 'INTERNAL_SERVER_ERROR',
            message: err.message,
            statusCode: 500,
            req
        });
    }
});

/**
 * POST /auth/verify-email
 */
router.post('/verify-email', authLimiter, async (req, res) => {
    const { token } = req.body;
    try {
        const user = await authService.verifyEmail(token);
        return sendSuccess(res, {
            data: { user },
            message: 'Email verified successfully',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'VERIFICATION_ERROR',
            message: err.message || 'Failed to verify email address.',
            statusCode: err.status || 400,
            req
        });
    }
});

/**
 * POST /auth/resend-verification
 */
router.post('/resend-verification', authLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return sendError(res, {
            code: 'VALIDATION_ERROR',
            message: 'Email is required.',
            statusCode: 400,
            req
        });
    }

    const normalizedEmail = email.trim().toLowerCase();
    try {
        const user = await authService.findUser({ normalizedEmail });
        if (user && !user.emailVerified) {
            const rawToken = crypto.randomBytes(32).toString('hex');
            user.verificationTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
            user.verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await authService.saveUser(user.userId || user.supabase_user_id || user.id, user);

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const verificationUrl = `${frontendUrl}/verify-email?token=${rawToken}`;

            await emailService.sendEmailVerification({
                email: normalizedEmail,
                name: user.name,
                token: rawToken,
                verificationUrl
            });
        }

        return sendSuccess(res, {
            data: {
                verificationEmailSent: true
            },
            message: 'If the account exists, a verification email has been sent.',
            statusCode: 202,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to resend verification email.',
            statusCode: 500,
            req
        });
    }
});

/**
 * POST /auth/logout
 */
router.post('/logout', (req, res) => {
    clearSessionCookies(res);
    return sendSuccess(res, {
        data: {},
        message: 'Logged out successfully',
        statusCode: 200,
        req
    });
});

export default router;
