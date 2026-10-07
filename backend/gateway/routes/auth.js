/**
 * API Gateway Auth Identity and Operations Route (/api/v1/auth & /auth)
 * Implements production-grade specifications for:
 * - POST /auth/signup
 * - POST /auth/activate & POST /auth/verify-email
 * - POST /auth/login
 * - POST /auth/google
 * - POST /auth/resend-verification
 * - PUT  /auth/onboarding & PUT /auth/complete-profile
 * - GET  /auth/me
 * - POST /auth/logout
 */
import express from 'express';
import {
    authService,
    maskEmail,
    isValidDOB,
    isValidMobile,
    isStrongPassword,
    calculateAge
} from '../../services/identity-service/AuthService.js';
import { authenticateUser } from '../../middleware/auth.js';
import { authorize } from '../../middleware/authorization.js';
import { authLimiter } from '../../middleware/rateLimiter.js';
import { sendSuccess, sendError } from '../../shared/responses.js';
import { setSessionCookies, clearSessionCookies, generateCsrfToken } from '../../security/sessionCookie.js';
import { verifySupabaseExchangeToken } from '../../security/pharmaToken.js';
import { env } from '../../config/env.js';

const router = express.Router();

/**
 * POST /auth/signup
 * Local signup flow with persistent User model & LOCAL UserIdentity
 */
router.post('/signup', authLimiter, async (req, res) => {
    const { email, password, gender } = req.body || {};
    const mobile = req.body?.mobileNumber || req.body?.mobile || '';
    const dateOfBirth = req.body?.dateOfBirth;
    let firstName = (req.body?.firstName || '').trim();
    let lastName = (req.body?.lastName || '').trim();

    if (!firstName && req.body?.name) {
        const parts = req.body.name.trim().split(/\s+/);
        firstName = parts[0] || '';
        lastName = parts.slice(1).join(' ') || '';
    }

    const validationDetails = [];
    if (!firstName) {
        validationDetails.push({ field: 'firstName', code: 'REQUIRED', message: 'First name is required.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        validationDetails.push({ field: 'email', code: 'INVALID_EMAIL', message: 'Enter a valid email address.' });
    }
    if (!gender || !['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'].includes(gender)) {
        validationDetails.push({ field: 'gender', code: 'INVALID_GENDER', message: 'Select a valid gender option.' });
    }
    if (!dateOfBirth) {
        validationDetails.push({ field: 'dateOfBirth', code: 'REQUIRED', message: 'Date of birth is required.' });
    } else if (!isValidDOB(dateOfBirth)) {
        validationDetails.push({ field: 'dateOfBirth', code: 'INVALID_DOB', message: 'Date of birth must be a valid past date.' });
    }
    if (!mobile || !isValidMobile(mobile)) {
        validationDetails.push({ field: 'mobileNumber', code: 'INVALID_MOBILE', message: 'Enter a valid mobile number (at least 10 digits).' });
    }
    if (!password || !isStrongPassword(password)) {
        validationDetails.push({
            field: 'password',
            code: 'WEAK_PASSWORD',
            message: 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number.'
        });
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
            mobileNumber: mobile,
            mobile,
            dateOfBirth,
            gender,
            password
        });

        return sendSuccess(res, {
            data: result,
            message: 'Account created. Please check your email to activate your account.',
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
 * POST /auth/activate
 * Cryptographically secure single-use account activation
 */
router.post('/activate', authLimiter, async (req, res) => {
    const { token } = req.body || {};
    if (!token) {
        return sendError(res, {
            code: 'INVALID_TOKEN',
            message: 'Activation token is required.',
            statusCode: 400,
            req
        });
    }

    try {
        const result = await authService.activateAccount(token);
        return sendSuccess(res, {
            data: result,
            message: 'Account successfully activated. You can now log in.',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'ACTIVATION_ERROR',
            message: err.message || 'Failed to activate account.',
            statusCode: err.status || 400,
            req
        });
    }
});

/**
 * POST /auth/verify-email (alias for backward compatibility)
 */
router.post('/verify-email', authLimiter, async (req, res) => {
    const { token } = req.body || {};
    if (!token) {
        return sendError(res, {
            code: 'INVALID_TOKEN',
            message: 'Verification token is required.',
            statusCode: 400,
            req
        });
    }

    try {
        const result = await authService.activateAccount(token);
        return sendSuccess(res, {
            data: result,
            message: 'Email verified and account activated successfully.',
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
 * POST /auth/login
 * Validates credentials and enforces account activation state
 */
router.post('/login', authLimiter, async (req, res) => {
    const { email, password } = req.body || {};
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

        if (result.requiresProfileCompletion || result.code === 'PROFILE_INCOMPLETE') {
            if (result.accessToken) {
                setSessionCookies(res, { accessToken: result.accessToken });
            }
            return sendSuccess(res, {
                data: result,
                message: 'Profile completion required.',
                statusCode: 200,
                req
            });
        }

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
        if (err.code === 'EMAIL_VERIFICATION_REQUIRED' || err.code === 'ACCOUNT_ACTIVATION_REQUIRED') {
            return res.status(403).json({
                success: false,
                code: err.code,
                error: {
                    code: err.code,
                    message: err.message,
                    email: err.email || maskEmail(email),
                    canResendVerification: true
                },
                message: err.message,
                email: err.email || maskEmail(email),
                canResendVerification: true
            });
        }

        return sendError(res, {
            code: err.code || 'AUTHENTICATION_FAILED',
            message: err.message || 'Authentication failed. Please try again.',
            statusCode: err.status || 401,
            req
        });
    }
});

/**
 * POST /auth/resend-verification
 * Safe rate-limited resend without revealing account existence
 */
router.post('/resend-verification', authLimiter, async (req, res) => {
    const { email } = req.body || {};
    if (!email) {
        return sendError(res, {
            code: 'VALIDATION_ERROR',
            message: 'Email is required.',
            statusCode: 400,
            req
        });
    }

    try {
        const result = await authService.resendVerificationEmail({
            email,
            requestIp: req.ip
        });

        return sendSuccess(res, {
            data: result,
            message: result.message,
            statusCode: 202,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'RESEND_ERROR',
            message: err.message || 'Failed to resend verification email.',
            statusCode: err.status || 500,
            req
        });
    }
});

/**
 * POST /auth/google
 * Server-side verified Google sign-in and account linking
 */
router.post('/google', authLimiter, async (req, res) => {
    const upstreamToken = req.body?.supabaseAccessToken || req.body?.access_token || req.body?.token;

    try {
        let identity;

        if (upstreamToken) {
            const { payload } = await verifySupabaseExchangeToken(upstreamToken);
            identity = {
                providerUserId: payload.sub,
                email: payload.email,
                emailVerified: payload.email_verified !== false,
                firstName: payload.user_metadata?.full_name || payload.user_metadata?.name || payload.user_metadata?.first_name || '',
                lastName: payload.user_metadata?.last_name || '',
                picture: payload.user_metadata?.avatar_url || payload.user_metadata?.picture || ''
            };

            const names = String(identity.firstName || '').trim().split(/\s+/);
            if (!identity.lastName && names.length > 1) {
                identity.lastName = names.slice(1).join(' ');
                identity.firstName = names[0];
            }
        } else if (env.NODE_ENV !== 'production' && req.body?.providerUserId && req.body?.email) {
            // Test/development compatibility only. Production must prove the
            // upstream identity cryptographically before account linking.
            identity = {
                providerUserId: req.body.providerUserId,
                email: req.body.email,
                emailVerified: req.body.email_verified !== false,
                firstName: req.body.firstName || '',
                lastName: req.body.lastName || '',
                picture: req.body.picture || ''
            };
        } else {
            return sendError(res, {
                code: 'UPSTREAM_IDENTITY_REQUIRED',
                message: 'A verified Google identity exchange token is required.',
                statusCode: 401,
                req
            });
        }

        if (!identity.providerUserId || !identity.email || !identity.emailVerified) {
            return sendError(res, {
                code: 'INVALID_GOOGLE_IDENTITY',
                message: 'Google identity could not be verified.',
                statusCode: 401,
                req
            });
        }

        const result = await authService.authenticateGoogle(identity);

        if (result.accessToken) {
            setSessionCookies(res, { accessToken: result.accessToken });
        }

        return sendSuccess(res, {
            data: result,
            message: result.requiresProfileCompletion ? 'Please complete your Pharma profile.' : 'Google sign-in successful.',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'GOOGLE_AUTH_FAILED',
            message: err.code === 'ERR_JWT_EXPIRED' ? 'Google sign-in session expired. Please sign in again.' : (err.message || 'Google authentication failed.'),
            statusCode: err.status || 401,
            req
        });
    }
});
/**
 * PUT /auth/onboarding and PUT /auth/complete-profile
 */
const handleProfileCompletion = async (req, res) => {
    const userId = req.user?.id || req.user?.sub || req.user?.userId;
    if (!userId) {
        return sendError(res, {
            code: 'UNAUTHORIZED',
            message: 'Authentication required to complete profile.',
            statusCode: 401,
            req
        });
    }

    const { firstName, lastName, dateOfBirth, mobileNumber, mobile, gender } = req.body || {};
    const phone = (mobileNumber || mobile || '').trim();

    const validationDetails = [];
    if (!firstName || !firstName.trim()) {
        validationDetails.push({ field: 'firstName', code: 'REQUIRED', message: 'First name is required.' });
    }
    if (!dateOfBirth) {
        validationDetails.push({ field: 'dateOfBirth', code: 'REQUIRED', message: 'Date of birth is required.' });
    } else if (!isValidDOB(dateOfBirth)) {
        validationDetails.push({ field: 'dateOfBirth', code: 'INVALID_DOB', message: 'Date of birth must be a valid past date.' });
    }
    if (!phone || !isValidMobile(phone)) {
        validationDetails.push({ field: 'mobileNumber', code: 'INVALID_MOBILE', message: 'Valid mobile number with at least 10 digits is required.' });
    }
    if (!gender || !['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'].includes(gender)) {
        validationDetails.push({ field: 'gender', code: 'INVALID_GENDER', message: 'Select a valid gender option.' });
    }

    if (validationDetails.length > 0) {
        return sendError(res, {
            code: 'VALIDATION_ERROR',
            message: 'Please complete all required fields.',
            details: validationDetails,
            statusCode: 400,
            req
        });
    }

    try {
        const result = await authService.completeProfile({
            userId,
            firstName,
            lastName,
            dateOfBirth,
            mobileNumber: phone,
            gender
        });

        if (result.accessToken) {
            setSessionCookies(res, { accessToken: result.accessToken });
        }

        return sendSuccess(res, {
            data: result,
            message: 'Profile completed successfully.',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'PROFILE_ERROR',
            message: err.message || 'Failed to complete profile.',
            statusCode: err.status || 400,
            req
        });
    }
};

router.put('/onboarding', authenticateUser, authorize('profile.complete'), handleProfileCompletion);
router.put('/complete-profile', authenticateUser, authorize('profile.complete'), handleProfileCompletion);

/**
 * GET /auth/csrf
 */
router.get('/csrf', (req, res) => {
    const token = generateCsrfToken();
    setSessionCookies(res, { csrfToken: token });
    return res.json({ csrfToken: token });
});

/**
 * POST /auth/password/forgot
 */
router.post('/password/forgot', authLimiter, async (req, res) => {
    try {
        const result = await authService.requestPasswordReset({ email: req.body?.email, requestIp: req.ip });
        return sendSuccess(res, { data: result, message: result.message, statusCode: 202, req });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'PASSWORD_RESET_REQUEST_FAILED',
            message: err.message || 'Unable to process password reset request.',
            statusCode: err.status || 429,
            req
        });
    }
});

/**
 * POST /auth/password/reset
 */
router.post('/password/reset', authLimiter, async (req, res) => {
    try {
        const result = await authService.resetPassword({
            token: req.body?.token,
            password: req.body?.password
        });
        if (result.accessToken) setSessionCookies(res, { accessToken: result.accessToken });
        return sendSuccess(res, {
            data: result,
            message: 'Password updated successfully.',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'PASSWORD_RESET_FAILED',
            message: err.message || 'Unable to reset password.',
            statusCode: err.status || 400,
            req
        });
    }
});

/**
 * POST /auth/mfa/verify
 */
router.post('/mfa/verify', authLimiter, async (req, res) => {
    try {
        const result = await authService.verifyMfaChallenge(req.body?.challengeToken, req.body?.code);
        setSessionCookies(res, { accessToken: result.accessToken });
        return sendSuccess(res, {
            data: { user: result.user, accessToken: result.accessToken, aal: 'aal2' },
            message: 'MFA verification successful.',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'MFA_VERIFY_FAILED',
            message: err.message || 'MFA verification failed.',
            statusCode: err.status || 401,
            req
        });
    }
});

/**
 * POST /auth/mfa/enroll
 */
router.post('/mfa/enroll', authenticateUser, async (req, res) => {
    try {
        const result = await authService.enrollMfa(req.user);
        return sendSuccess(res, { data: result, message: 'MFA enrollment initialized.', statusCode: 200, req });
    } catch (err) {
        return sendError(res, { code: err.code || 'MFA_ENROLL_FAILED', message: err.message, statusCode: err.status || 400, req });
    }
});

/**
 * POST /auth/mfa/confirm-enroll
 */
router.post('/mfa/confirm-enroll', authenticateUser, async (req, res) => {
    try {
        const result = await authService.confirmMfaEnrollment(req.user, req.body?.code);
        return sendSuccess(res, { data: result, message: 'MFA enabled successfully.', statusCode: 200, req });
    } catch (err) {
        return sendError(res, { code: err.code || 'MFA_ENROLL_FAILED', message: err.message, statusCode: err.status || 400, req });
    }
});

/**
 * POST /auth/mfa/mfa-disable
 */
router.post('/mfa/mfa-disable', authenticateUser, async (req, res) => {
    try {
        const result = await authService.disableMfa(req.user);
        return sendSuccess(res, { data: result, message: 'MFA disabled successfully.', statusCode: 200, req });
    } catch (err) {
        return sendError(res, { code: err.code || 'MFA_DISABLE_FAILED', message: err.message, statusCode: err.status || 400, req });
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
