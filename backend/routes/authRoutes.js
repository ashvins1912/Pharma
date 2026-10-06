/**
 * Core Authentication Routes (/api/auth & /api/v1/auth)
 * Features:
 * - Secure password hashing with bcryptjs (cost factor 12)
 * - User Signup with email normalization and unique database constraints
 * - Single-use SHA-256 hashed email verification tokens with expiration
 * - SMTP notification dispatch via centralized EmailService
 * - Multi-tenant & platform role resolution
 * - HttpOnly session cookies + CSRF protection + MFA support
 */
import crypto from 'node:crypto';
import express from 'express';
import bcrypt from '../security/hasher.js';
import { SignJWT, jwtVerify } from 'jose';
import { supabase, isSupabaseConfigured } from '../config/supabase.js';
import {
    encryptPII,
    decryptPII
} from '../security/cryptoVault.js';
import {
    generateTotpSecret,
    verifyTotpCode,
    buildOtpauthUri,
    generateQrCodeDataUrl
} from '../security/totp.js';
import {
    setSessionCookies,
    clearSessionCookies,
    generateCsrfToken
} from '../security/sessionCookie.js';
import {
    validateLogin,
    validateSignup,
    validateTotp,
    sanitizeBodyMiddleware
} from '../security/validator.js';
import { authenticateUser } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import UserProfile from '../models/UserProfile.js';
import { getIsConnected } from '../config/db.js';
import { emailService } from '../services/email-service/EmailService.js';
import { tenantService } from '../services/tenant-service/TenantService.js';
import { isPlatformSuperAdmin } from '../shared/contracts/index.js';
import { logger } from '../shared/observability/logger.js';
import { authService, maskEmail, isValidDOB, isValidMobile, calculateAge } from '../services/identity-service/AuthService.js';
import {
    getDemoAdminIdentity,
    isDemoAdminEnabled,
    isInstantDemoAdminEnabled,
    issueDemoAdminToken,
    verifyDemoAdminPassword
} from '../config/demoAdmin.js';
import {
    getDemoCustomerIdentity,
    isDemoCustomerEnabled,
    issueDemoCustomerToken
} from '../config/demoCustomer.js';

const router = express.Router();
router.use(sanitizeBodyMiddleware);

// In-memory shadow profiles store when MongoDB is offline / for unit tests
export const inMemoryShadowProfiles = new Map();

// Pending MFA enrollment state
const pendingEnrollments = new Map();

// JWT signing key for intermediate MFA challenges & sessions
const JWT_SECRET = process.env.DEMO_ADMIN_JWT_SECRET
    || process.env.ENCRYPTION_SECRET_KEY
    || 'ashvin-pharmacy-demo-admin-jwt-secret-key-32chars!';
const SIGNING_KEY = new TextEncoder().encode(JWT_SECRET);

/**
 * Pre-seed default demo accounts in memory for instant verification
 */
const defaultAdminHash = bcrypt.hashSync('Admin@123', 10);
inMemoryShadowProfiles.set('ashvinsingh25@gmail.com', {
    supabase_user_id: 'admin',
    userId: 'admin',
    name: 'Ashvin Singh (Admin)',
    firstName: 'Ashvin',
    lastName: 'Singh',
    email: 'ashvinsingh25@gmail.com',
    normalizedEmail: 'ashvinsingh25@gmail.com',
    role: 'SUPER_ADMIN',
    roles: ['SUPER_ADMIN', 'admin'],
    passwordHash: defaultAdminHash,
    emailVerified: true,
    status: 'ACTIVE',
    mfaEnabled: false
});

const defaultCustomerHash = bcrypt.hashSync('Customer@123', 10);
inMemoryShadowProfiles.set('customer@ashvinpharma.com', {
    supabase_user_id: 'demo-customer-id',
    userId: 'demo-customer-id',
    name: 'Ashvin Singh',
    firstName: 'Ashvin',
    lastName: 'Singh',
    email: 'customer@ashvinpharma.com',
    normalizedEmail: 'customer@ashvinpharma.com',
    role: 'customer',
    roles: ['customer'],
    mobile: '+91 95899 16475',
    passwordHash: defaultCustomerHash,
    emailVerified: true,
    status: 'ACTIVE',
    mfaEnabled: false
});

/**
 * Helper: Find user profile from MongoDB or memory fallback
 */
async function findUserProfile(query) {
    if (getIsConnected()) {
        try {
            return await UserProfile.findOne(query);
        } catch (e) {
            logger.warn('Failed to query Mongo UserProfile:', { error: e.message });
        }
    }

    const emailQuery = query.email || query.normalizedEmail;
    if (emailQuery) {
        const norm = String(emailQuery).toLowerCase().trim();
        for (const [, profile] of inMemoryShadowProfiles.entries()) {
            if (profile.normalizedEmail === norm || profile.email === norm) {
                return profile;
            }
        }
    }
    if (query.userId || query.supabase_user_id) {
        const id = query.userId || query.supabase_user_id;
        for (const [, profile] of inMemoryShadowProfiles.entries()) {
            if (profile.userId === id || profile.supabase_user_id === id) {
                return profile;
            }
        }
    }
    if (query.verificationTokenHash) {
        for (const [, profile] of inMemoryShadowProfiles.entries()) {
            if (profile.verificationTokenHash === query.verificationTokenHash) {
                return profile;
            }
        }
    }
    return null;
}

/**
 * Helper: Save or update user profile
 */
async function saveUserProfile(userId, profileData) {
    const normEmail = (profileData.email || '').toLowerCase().trim();
    const doc = {
        supabase_user_id: userId,
        userId,
        name: profileData.name || `${profileData.firstName || ''} ${profileData.lastName || ''}`.trim() || 'Valued User',
        firstName: profileData.firstName || '',
        lastName: profileData.lastName || '',
        email: normEmail,
        normalizedEmail: normEmail,
        mobile: profileData.mobile || '',
        passwordHash: profileData.passwordHash || null,
        emailVerified: Boolean(profileData.emailVerified),
        verificationTokenHash: profileData.verificationTokenHash || null,
        verificationTokenExpiresAt: profileData.verificationTokenExpiresAt || null,
        status: profileData.status || (profileData.emailVerified ? 'ACTIVE' : 'PENDING_VERIFICATION'),
        role: profileData.role || 'customer',
        roles: profileData.roles || [profileData.role || 'customer'],
        permissions: profileData.permissions || [],
        tenantId: profileData.tenantId || null,
        branchId: profileData.branchId || null,
        mfaEnabled: Boolean(profileData.mfaEnabled),
        mfaSecretEncrypted: profileData.mfaSecretEncrypted || null,
        mfaEnrolledAt: profileData.mfaEnrolledAt || null,
        lastLoginAt: profileData.lastLoginAt || null
    };

    if (getIsConnected()) {
        try {
            return await UserProfile.findOneAndUpdate(
                { $or: [{ supabase_user_id: userId }, { userId }, { normalizedEmail: normEmail }] },
                { $set: doc },
                { upsert: true, new: true, runValidators: true }
            );
        } catch (e) {
            logger.warn('Failed to persist UserProfile to Mongo:', { error: e.message });
        }
    }

    inMemoryShadowProfiles.set(normEmail, doc);
    inMemoryShadowProfiles.set(userId, doc);
    return doc;
}

/**
 * Issue standard platform session JWT
 */
async function issueSessionToken(user, aal = 'aal1') {
    const rawRole = user.role || user.app_metadata?.role || (user.roles && user.roles[0]) || 'customer';
    const role = isPlatformSuperAdmin(rawRole) ? 'SUPER_ADMIN' : rawRole;
    const isPlatform = role === 'SUPER_ADMIN';
    const tenantId = isPlatform ? null : (user.tenantId || user.app_metadata?.tenantId || null);

    return new SignJWT({
        sub: user.id || user.userId || user.supabase_user_id,
        email: user.email,
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        role,
        roles: user.roles || [role],
        tenantId,
        branchId: user.branchId || null,
        app_metadata: { role, tenantId },
        user_metadata: {
            name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
            mobile: user.mobile
        },
        aal
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id || user.userId || user.supabase_user_id)
        .setIssuedAt()
        .setExpirationTime('2h')
        .sign(SIGNING_KEY);
}

/**
 * Helper: Issue intermediate MFA challenge JWT (5-minute expiry, aal1)
 */
async function issueMfaChallengeToken(user, factorId) {
    return new SignJWT({
        sub: user.id || user.userId || user.sub,
        email: user.email,
        role: user.role || 'customer',
        mfa_required: true,
        factor_id: factorId,
        aal: 'aal1'
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('ashvin-auth-mfa')
        .setAudience('ashvin-api')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(SIGNING_KEY);
}

/**
 * GET /api/auth/csrf
 * Generates an anti-CSRF token and returns it while setting XSRF-TOKEN cookie
 */
router.get('/csrf', (req, res) => {
    const token = generateCsrfToken();
    setSessionCookies(res, { csrfToken: token });
    res.json({ csrfToken: token });
});

/**
 * POST /api/auth/demo-admin
 */
router.post('/demo-admin', validateLogin, async (req, res) => {
    if (!isDemoAdminEnabled()) {
        return res.status(404).json({ message: 'Demo admin sign-in is disabled.' });
    }
    if (!verifyDemoAdminPassword(req.body?.email, req.body?.password)) {
        return res.status(401).json({ message: 'Invalid demo admin email or password.' });
    }
    try {
        const access_token = await issueDemoAdminToken();
        res.json({ access_token, token_type: 'Bearer', expires_in: 3600, user: getDemoAdminIdentity() });
    } catch (error) {
        console.error('Demo admin token creation failed:', error);
        res.status(503).json({ message: 'Demo admin sign-in is not configured correctly.' });
    }
});

/**
 * POST /api/auth/demo-admin/instant
 */
router.post('/demo-admin/instant', async (req, res) => {
    if (!isDemoAdminEnabled() || !isInstantDemoAdminEnabled()) {
        return res.status(404).json({ message: 'Instant demo admin access is disabled.' });
    }
    try {
        const access_token = await issueDemoAdminToken(true);
        res.json({ access_token, token_type: 'Bearer', expires_in: 3600, user: getDemoAdminIdentity() });
    } catch (error) {
        console.error('Instant demo admin sign-in failed:', error);
        res.status(503).json({ message: 'Instant demo admin access is not configured correctly.' });
    }
});

/**
 * POST /api/auth/demo-customer
 */
router.post('/demo-customer', async (req, res) => {
    if (!isDemoCustomerEnabled()) {
        return res.status(404).json({ message: 'Demo customer access is disabled.' });
    }
    try {
        const access_token = await issueDemoCustomerToken();
        res.json({ access_token, token_type: 'Bearer', expires_in: 3600, user: getDemoCustomerIdentity() });
    } catch (error) {
        console.error('Demo customer sign-in failed:', error);
        res.status(503).json({ message: 'Demo customer access is not configured correctly.' });
    }
});

/**
 * POST /api/auth/signup & /api/v1/auth/signup
 * Secure User Registration with:
 * - First/Last name validation
 * - Normalized email uniqueness
 * - Bcrypt password hashing
 * - Cryptographically secure verification token (hashed with SHA-256 before storage)
 * - SMTP Email verification dispatch
 */
router.post('/signup', authLimiter, validateSignup, async (req, res) => {
    const { email, password, mobile } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    // Derive first and last name
    let firstName = (req.body.firstName || '').trim();
    let lastName = (req.body.lastName || '').trim();
    if (!firstName && req.body.name) {
        const parts = req.body.name.trim().split(/\s+/);
        firstName = parts[0] || '';
        lastName = parts.slice(1).join(' ') || '';
    }
    const fullName = `${firstName} ${lastName}`.trim() || 'Valued Customer';

    // Password strength check
    if (!password || password.length < 8) {
        return res.status(400).json({
            success: false,
            code: 'WEAK_PASSWORD',
            message: 'Password must be at least 8 characters long.'
        });
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({
            success: false,
            code: 'WEAK_PASSWORD',
            message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number.'
        });
    }

    try {
        // Check for existing user by normalized email
        const existing = await findUserProfile({ normalizedEmail });
        if (existing) {
            logger.warn('USER_SIGNUP_FAILED: Duplicate email attempt', { email: normalizedEmail });
            return res.status(409).json({
                success: false,
                code: 'EMAIL_ALREADY_EXISTS',
                message: 'An account already exists with this email address.'
            });
        }

        // Generate secure 256-bit password hash via bcrypt
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Generate cryptographically secure email verification token
        const rawVerificationToken = crypto.randomBytes(32).toString('hex');
        const verificationTokenHash = crypto.createHash('sha256').update(rawVerificationToken).digest('hex');
        const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const userId = `usr_${crypto.randomUUID()}`;

        // Attempt Supabase synchronization if configured
        if (isSupabaseConfigured) {
            try {
                await supabase.auth.signUp({
                    email: normalizedEmail,
                    password,
                    options: {
                        data: { name: fullName, firstName, lastName, mobile, role: 'customer' }
                    }
                });
            } catch (supaErr) {
                logger.warn('Supabase auth signup notice:', { error: supaErr.message });
            }
        }

        // Save User Profile in MongoDB with hashed password and verification token
        const userDoc = await saveUserProfile(userId, {
            name: fullName,
            firstName,
            lastName,
            email: normalizedEmail,
            mobile: (mobile || '').trim(),
            passwordHash,
            emailVerified: false,
            verificationTokenHash,
            verificationTokenExpiresAt,
            status: 'PENDING_VERIFICATION',
            role: 'customer',
            roles: ['customer']
        });

        // Dispatch Email Verification via Centralized Email Service
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const verificationUrl = `${frontendUrl}/verify-email?token=${rawVerificationToken}`;

        await emailService.sendEmailVerification({
            email: normalizedEmail,
            name: fullName,
            token: rawVerificationToken,
            verificationUrl
        });

        logger.info('USER_SIGNUP_SUCCESS', {
            userId,
            email: normalizedEmail,
            verificationExpiresAt: verificationTokenExpiresAt
        });

        res.status(201).json({
            success: true,
            message: 'Account registered successfully. Please check your email to verify your account.',
            requiresEmailVerification: true,
            user: {
                id: userId,
                firstName,
                lastName,
                name: fullName,
                email: normalizedEmail,
                mobile: (mobile || '').trim(),
                role: 'customer',
                roles: ['customer'],
                emailVerified: false,
                status: 'PENDING_VERIFICATION'
            }
        });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({
                success: false,
                code: 'EMAIL_ALREADY_EXISTS',
                message: 'An account already exists with this email address.'
            });
        }
        logger.error('Signup error:', { error: err.message });
        res.status(500).json({
            success: false,
            code: 'SIGNUP_FAILED',
            message: 'Registration processing failed. Please try again.'
        });
    }
});

/**
 * POST /api/auth/activate & /api/v1/auth/activate
 * Verifies user email via single-use cryptographically secure token & activates account
 */
router.post('/activate', authLimiter, async (req, res) => {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
        return res.status(400).json({
            success: false,
            code: 'INVALID_TOKEN',
            message: 'Activation token is required.'
        });
    }

    try {
        const result = await authService.activateAccount(token);
        res.json({
            success: true,
            status: 'ACTIVE',
            emailVerified: true,
            message: '🎉 Account activated successfully! You can now log in.',
            user: result.user
        });
    } catch (err) {
        res.status(err.status || 400).json({
            success: false,
            code: err.code || 'ACTIVATION_ERROR',
            message: err.message || 'Failed to activate account.'
        });
    }
});

/**
 * POST /api/auth/verify-email & /api/v1/auth/verify-email
 * Verifies user email via single-use cryptographically secure token
 */
router.post('/verify-email', authLimiter, async (req, res) => {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
        return res.status(400).json({
            success: false,
            code: 'INVALID_TOKEN',
            message: 'Verification token is required.'
        });
    }

    try {
        const result = await authService.activateAccount(token);
        res.json({
            success: true,
            status: 'ACTIVE',
            emailVerified: true,
            message: '🎉 Email verified successfully! You can now log in to your account.',
            user: result.user
        });
    } catch (err) {
        res.status(err.status || 400).json({
            success: false,
            code: err.code || 'VERIFICATION_ERROR',
            message: err.message || 'Failed to verify email address.'
        });
    }
});

/**
 * POST /api/auth/resend-verification
 * Resends verification email for unverified user
 */
router.post('/resend-verification', authLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({
            success: false,
            code: 'EMAIL_REQUIRED',
            message: 'Email address is required.'
        });
    }

    try {
        const result = await authService.resendVerificationEmail({
            email,
            requestIp: req.ip
        });
        res.status(202).json({
            success: true,
            canResendVerification: true,
            message: result.message
        });
    } catch (err) {
        res.status(err.status || 500).json({
            success: false,
            code: err.code || 'RESEND_ERROR',
            message: err.message || 'Could not process verification request.'
        });
    }
});

/**
 * POST /api/auth/login & /api/v1/auth/login
 * Production Login with email normalization, password comparison, status check, and session generation
 */
router.post('/login', authLimiter, validateLogin, async (req, res) => {
    const { email, password } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    try {
        // 1. Direct Demo Admin Match
        if (normalizedEmail === 'ashvinsingh25@gmail.com' && password === 'Admin@123') {
            const demoAdmin = {
                id: 'admin',
                userId: 'admin',
                sub: 'admin',
                name: 'Ashvin Singh (Admin)',
                firstName: 'Ashvin',
                lastName: 'Singh',
                email: 'ashvinsingh25@gmail.com',
                role: 'SUPER_ADMIN',
                roles: ['SUPER_ADMIN', 'admin'],
                app_metadata: { role: 'SUPER_ADMIN' },
                user_metadata: { name: 'Ashvin Singh (Admin)' },
                emailVerified: true
            };
            const shadow = await findUserProfile({ userId: 'admin' });

            if (shadow?.mfaEnabled) {
                const challengeToken = await issueMfaChallengeToken(demoAdmin, 'demo-totp-factor');
                return res.json({
                    mfaRequired: true,
                    factorId: 'demo-totp-factor',
                    challengeToken,
                    email: demoAdmin.email,
                    message: 'Two-factor authentication required. Enter the 6-digit code from your authenticator app.'
                });
            }

            const adminToken = await issueSessionToken(demoAdmin, 'aal1');
            const csrfToken = setSessionCookies(res, { accessToken: adminToken });

            logger.info('USER_LOGIN_SUCCESS: Demo Admin', { email: normalizedEmail });
            return res.json({
                success: true,
                aal: 'aal1',
                user: demoAdmin,
                token: adminToken,
                csrfToken
            });
        }

        // 2. Direct Demo Customer Match
        if (normalizedEmail === 'customer@ashvinpharma.com' && password === 'Customer@123') {
            const demoCustomer = {
                id: 'demo-customer-id',
                userId: 'demo-customer-id',
                sub: 'demo-customer-id',
                name: 'Ashvin Singh',
                firstName: 'Ashvin',
                lastName: 'Singh',
                email: 'customer@ashvinpharma.com',
                role: 'customer',
                roles: ['customer'],
                app_metadata: { role: 'customer' },
                user_metadata: { name: 'Ashvin Singh', mobile: '+91 95899 16475' },
                emailVerified: true
            };
            const shadow = await findUserProfile({ userId: 'demo-customer-id' });

            if (shadow?.mfaEnabled) {
                const challengeToken = await issueMfaChallengeToken(demoCustomer, 'demo-totp-factor');
                return res.json({
                    mfaRequired: true,
                    factorId: 'demo-totp-factor',
                    challengeToken,
                    email: demoCustomer.email,
                    message: 'Enter 6-digit TOTP code from your authenticator app.'
                });
            }

            const demoToken = await issueSessionToken(demoCustomer, 'aal1');
            const csrfToken = setSessionCookies(res, { accessToken: demoToken });

            logger.info('USER_LOGIN_SUCCESS: Demo Customer', { email: normalizedEmail });
            return res.json({
                success: true,
                aal: 'aal1',
                user: demoCustomer,
                token: demoToken,
                csrfToken
            });
        }

        // 3. Authenticate registered user in MongoDB / Memory
        const user = await findUserProfile({ normalizedEmail });

        if (user && user.passwordHash) {
            // Check password validity
            let valid = false;
            if (user.passwordHash.startsWith('$2')) {
                // Bcrypt hash
                valid = await bcrypt.compare(password, user.passwordHash);
            } else if (user.salt) {
                // Legacy scrypt fallback
                const computed = crypto.scryptSync(password, user.salt, 32).toString('hex');
                valid = crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(user.passwordHash));
            }

            if (valid) {
                // Check account status
                if (user.status === 'SUSPENDED' || user.status === 'DISABLED') {
                    logger.warn('USER_LOGIN_FAILED: Account suspended', { email: normalizedEmail });
                    return res.status(403).json({
                        success: false,
                        code: 'ACCOUNT_SUSPENDED',
                        message: 'Your account is suspended or disabled. Please contact support.'
                    });
                }

                // Check email verification / account activation
                if (user.accountStatus === 'PENDING_EMAIL_VERIFICATION' || (user.emailVerified === false && (user.status === 'PENDING_VERIFICATION' || user.accountStatus === 'PENDING_VERIFICATION'))) {
                    logger.warn('USER_LOGIN_FAILED: Email unverified', { email: normalizedEmail });
                    return res.status(403).json({
                        success: false,
                        code: 'EMAIL_VERIFICATION_REQUIRED',
                        error: {
                            code: 'EMAIL_VERIFICATION_REQUIRED',
                            message: 'Please verify your email address.',
                            email: maskEmail(normalizedEmail),
                            canResendVerification: true
                        },
                        message: 'Please verify your email address.',
                        email: maskEmail(normalizedEmail),
                        canResendVerification: true
                    });
                }

                if (user.accountStatus === 'PENDING_ACCOUNT_ACTIVATION') {
                    return res.status(403).json({
                        success: false,
                        code: 'ACCOUNT_ACTIVATION_REQUIRED',
                        error: {
                            code: 'ACCOUNT_ACTIVATION_REQUIRED',
                            message: 'Please activate your Pharma account.',
                            email: maskEmail(normalizedEmail),
                            canResendVerification: true
                        },
                        message: 'Please activate your Pharma account.',
                        email: maskEmail(normalizedEmail),
                        canResendVerification: true
                    });
                }

                if (user.accountStatus === 'PROFILE_INCOMPLETE' || user.profileCompleted === false) {
                    return res.json({
                        success: false,
                        code: 'PROFILE_INCOMPLETE',
                        message: 'Please complete your profile to continue.',
                        requiresProfileCompletion: true,
                        user: {
                            id: user.userId || user.supabase_user_id,
                            email: user.email,
                            firstName: user.firstName,
                            lastName: user.lastName,
                            dateOfBirth: user.dateOfBirth,
                            mobileNumber: user.mobileNumber || user.mobile,
                            accountStatus: 'PROFILE_INCOMPLETE',
                            profileCompleted: false
                        }
                    });
                }

                // Update last login timestamp
                user.lastLoginAt = new Date();
                await saveUserProfile(user.userId || user.supabase_user_id, user);

                const rawRole = user.role || (user.roles && user.roles[0]) || 'customer';
                const role = isPlatformSuperAdmin(rawRole) ? 'SUPER_ADMIN' : rawRole;

                const localUser = {
                    id: user.userId || user.supabase_user_id,
                    userId: user.userId || user.supabase_user_id,
                    sub: user.userId || user.supabase_user_id,
                    name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    role,
                    roles: user.roles || [role],
                    tenantId: user.tenantId || null,
                    branchId: user.branchId || null,
                    emailVerified: Boolean(user.emailVerified)
                };

                if (user.mfaEnabled) {
                    const challengeToken = await issueMfaChallengeToken(localUser, 'local-totp-factor');
                    return res.json({
                        mfaRequired: true,
                        factorId: 'local-totp-factor',
                        challengeToken,
                        email: localUser.email,
                        message: 'Enter the 6-digit TOTP code from your authenticator app.'
                    });
                }

                const userToken = await issueSessionToken(localUser, 'aal1');
                const csrfToken = setSessionCookies(res, { accessToken: userToken });

                logger.info('USER_LOGIN_SUCCESS', { userId: localUser.id, email: normalizedEmail, role });
                return res.json({
                    success: true,
                    aal: 'aal1',
                    user: localUser,
                    token: userToken,
                    csrfToken
                });
            }
        }

        // 4. Fallback to Supabase Auth if configured
        if (isSupabaseConfigured) {
            try {
                const { data, error } = await supabase.auth.signInWithPassword({
                    email: normalizedEmail,
                    password
                });

                if (!error && data?.user) {
                    const supaUser = data.user;
                    const supaSession = data.session;

                    const userRole = supaUser.app_metadata?.role || 'customer';
                    const resolvedRole = isPlatformSuperAdmin(userRole) ? 'SUPER_ADMIN' : userRole;

                    const loggedUser = {
                        id: supaUser.id,
                        userId: supaUser.id,
                        email: supaUser.email,
                        name: supaUser.user_metadata?.name || '',
                        role: resolvedRole,
                        roles: [resolvedRole],
                        emailVerified: Boolean(supaUser.email_confirmed_at)
                    };

                    const csrfToken = setSessionCookies(res, {
                        accessToken: supaSession?.access_token,
                        refreshToken: supaSession?.refresh_token
                    });

                    logger.info('USER_LOGIN_SUCCESS: Supabase', { userId: supaUser.id, email: normalizedEmail });
                    return res.json({
                        success: true,
                        aal: 'aal1',
                        user: loggedUser,
                        token: supaSession?.access_token,
                        csrfToken
                    });
                }
            } catch {}
        }

        logger.warn('USER_LOGIN_FAILED: Invalid credentials', { email: normalizedEmail });
        return res.status(401).json({
            success: false,
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password.'
        });
    } catch (err) {
        logger.error('Login error:', { error: err.message });
        res.status(500).json({
            success: false,
            code: 'AUTH_FAILED',
            message: 'Authentication processing failed.'
        });
    }
});

/**
 * POST /api/auth/mfa/verify
 */
router.post('/mfa/verify', authLimiter, validateTotp, async (req, res) => {
    const { code, challengeToken } = req.body;

    if (!challengeToken) {
        return res.status(400).json({
            success: false,
            code: 'CHALLENGE_TOKEN_REQUIRED',
            message: 'MFA challenge token is missing.'
        });
    }

    try {
        const { payload } = await jwtVerify(challengeToken, SIGNING_KEY, {
            algorithms: ['HS256'],
            issuer: 'ashvin-auth-mfa',
            audience: 'ashvin-api'
        });

        const userId = payload.sub;
        const email = payload.email;
        const role = payload.role;

        const shadow = await findUserProfile({ userId });
        let isValidCode = false;

        if (shadow?.mfaSecretEncrypted) {
            const secret = decryptPII(shadow.mfaSecretEncrypted);
            isValidCode = verifyTotpCode(secret, code);
        } else if (isSupabaseConfigured) {
            try {
                const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
                    factorId: payload.factor_id,
                    code
                });
                isValidCode = !verifyError;
            } catch (err) {
                logger.warn('Supabase MFA error:', { error: err.message });
            }
        }

        if (!isValidCode) {
            return res.status(401).json({
                success: false,
                code: 'INVALID_TOTP_CODE',
                message: 'Invalid 6-digit authenticator code. Check the time on your device and try again.'
            });
        }

        const aal2Token = await issueSessionToken({
            id: userId,
            email,
            role,
            roles: shadow?.roles || [role],
            name: shadow?.name,
            tenantId: shadow?.tenantId
        }, 'aal2');

        const csrfToken = setSessionCookies(res, { accessToken: aal2Token });

        res.json({
            success: true,
            message: 'MFA verification successful. Session upgraded to AAL2.',
            aal: 'aal2',
            user: {
                id: userId,
                email,
                role,
                name: shadow?.name
            },
            token: aal2Token,
            csrfToken
        });
    } catch (err) {
        logger.error('MFA verify error:', { error: err.message });
        res.status(401).json({
            success: false,
            code: 'MFA_EXPIRED',
            message: 'MFA challenge expired or invalid. Please sign in again.'
        });
    }
});

/**
 * POST /api/auth/mfa/enroll
 */
router.post('/mfa/enroll', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub || req.user.id;
        const accountEmail = req.user.email || 'customer@ashvinpharma.com';

        const secret = generateTotpSecret(20);
        const otpauthUri = buildOtpauthUri({
            issuer: 'Ashvin Pharmacy',
            accountName: accountEmail,
            secret
        });

        const qrCodeDataUrl = await generateQrCodeDataUrl(otpauthUri);

        pendingEnrollments.set(userId, {
            secret,
            createdAt: Date.now()
        });

        res.json({
            secret,
            qrCode: qrCodeDataUrl,
            otpauthUri,
            accountName: accountEmail,
            issuer: 'Ashvin Pharmacy',
            instructions: 'Scan this QR code using Google Authenticator, Microsoft Authenticator, or Bitwarden, then enter the 6-digit code to activate.'
        });
    } catch (err) {
        logger.error('MFA enrollment error:', { error: err.message });
        res.status(500).json({ message: 'Failed to initiate MFA enrollment.' });
    }
});

/**
 * POST /api/auth/mfa/confirm-enroll
 */
router.post('/mfa/confirm-enroll', authenticateUser, validateTotp, async (req, res) => {
    try {
        const userId = req.user.sub || req.user.id;
        const { code } = req.body;

        const pending = pendingEnrollments.get(userId);
        if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
            return res.status(400).json({
                message: 'MFA enrollment session expired. Please start enrollment again.'
            });
        }

        const isValid = verifyTotpCode(pending.secret, code);
        if (!isValid) {
            return res.status(400).json({
                message: 'Invalid 6-digit code. Please enter the current code shown in your authenticator app.'
            });
        }

        const encryptedSecret = encryptPII(pending.secret);

        await saveUserProfile(userId, {
            email: req.user.email,
            name: req.user.user_metadata?.name,
            role: req.user.app_metadata?.role || 'customer',
            mfaEnabled: true,
            mfaSecretEncrypted: encryptedSecret,
            mfaEnrolledAt: new Date()
        });

        pendingEnrollments.delete(userId);

        res.json({
            success: true,
            message: '🎉 Zero-cost TOTP Two-Factor Authentication is now enabled for your account!'
        });
    } catch (err) {
        logger.error('Confirm MFA enrollment error:', { error: err.message });
        res.status(500).json({ message: 'Failed to confirm MFA enrollment.' });
    }
});

/**
 * POST /api/auth/mfa/mfa-disable
 */
router.post('/mfa/mfa-disable', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub || req.user.id;
        await saveUserProfile(userId, {
            email: req.user.email,
            role: req.user.app_metadata?.role || 'customer',
            mfaEnabled: false,
            mfaSecretEncrypted: null,
            mfaEnrolledAt: null
        });

        res.json({
            success: true,
            message: 'Two-factor authentication has been disabled.'
        });
    } catch (err) {
        logger.error('MFA disable error:', { error: err.message });
        res.status(500).json({ message: 'Failed to disable MFA.' });
    }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
    clearSessionCookies(res);
    res.json({ success: true, message: 'Logged out successfully.' });
});

/**
 * POST /api/auth/google & /api/v1/auth/google
 * Google OAuth authentication and account linking
 */
router.post('/google', authLimiter, async (req, res) => {
    const {
        credential,
        token,
        providerUserId,
        email,
        email_verified,
        emailVerified,
        firstName,
        lastName,
        picture
    } = req.body || {};

    let sub = providerUserId;
    let userEmail = email;
    let isEmailVerified = email_verified !== undefined ? email_verified : (emailVerified !== undefined ? emailVerified : true);
    let fName = firstName || '';
    let lName = lastName || '';

    if (credential && typeof credential === 'string') {
        try {
            const parts = credential.split('.');
            if (parts.length === 3) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
                sub = payload.sub || sub;
                userEmail = payload.email || userEmail;
                isEmailVerified = payload.email_verified !== undefined ? payload.email_verified : true;
                fName = payload.given_name || payload.name?.split(' ')[0] || fName;
                lName = payload.family_name || payload.name?.split(' ').slice(1).join(' ') || lName;
            }
        } catch (e) {
            // fallback
        }
    }

    if (!sub || !userEmail) {
        return res.status(400).json({
            success: false,
            code: 'INVALID_CREDENTIALS',
            message: 'Google credentials could not be verified.'
        });
    }

    try {
        const result = await authService.authenticateGoogle({
            providerUserId: sub,
            email: userEmail,
            emailVerified: isEmailVerified,
            firstName: fName,
            lastName: lName,
            picture
        });

        if (result.accessToken) {
            setSessionCookies(res, { accessToken: result.accessToken });
        }

        return res.json({
            success: true,
            data: result,
            user: result.user,
            requiresProfileCompletion: Boolean(result.requiresProfileCompletion),
            code: result.code,
            message: result.message || 'Google sign-in successful.'
        });
    } catch (err) {
        if (err.code === 'ACCOUNT_ACTIVATION_REQUIRED') {
            return res.status(403).json({
                success: false,
                code: err.code,
                error: {
                    code: err.code,
                    message: err.message,
                    email: err.email || maskEmail(userEmail),
                    canResendVerification: true
                },
                message: err.message,
                email: err.email || maskEmail(userEmail),
                canResendVerification: true
            });
        }

        return res.status(err.status || 401).json({
            success: false,
            code: err.code || 'GOOGLE_AUTH_FAILED',
            message: err.message || 'Google authentication failed.'
        });
    }
});

/**
 * PUT /api/auth/onboarding
 * Completes profile after Google login or profile incomplete state
 */
router.put('/onboarding', authenticateUser, async (req, res) => {
    const userId = req.user?.sub || req.user?.id || req.body?.userId;
    if (!userId) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required to complete profile.'
        });
    }

    const { firstName, lastName, dateOfBirth, mobileNumber, mobile } = req.body || {};
    const phone = (mobileNumber || mobile || '').trim();

    if (!firstName || !firstName.trim()) {
        return res.status(400).json({ success: false, message: 'First name is required.' });
    }
    if (!dateOfBirth || !isValidDOB(dateOfBirth)) {
        return res.status(400).json({ success: false, message: 'Date of birth must be a valid past date.' });
    }
    if (!phone || !isValidMobile(phone)) {
        return res.status(400).json({ success: false, message: 'Valid mobile number with at least 10 digits is required.' });
    }

    try {
        const result = await authService.completeProfile({
            userId,
            firstName,
            lastName,
            dateOfBirth,
            mobileNumber: phone
        });

        if (result.accessToken) {
            setSessionCookies(res, { accessToken: result.accessToken });
        }

        return res.json({
            success: true,
            data: result,
            user: result.user,
            message: 'Profile completed successfully.'
        });
    } catch (err) {
        return res.status(err.status || 400).json({
            success: false,
            code: err.code || 'PROFILE_ERROR',
            message: err.message || 'Failed to complete profile.'
        });
    }
});

/**
 * GET /api/auth/session & /api/v1/auth/session
 */
router.get('/session', authenticateUser, async (req, res) => {
    const userId = req.user.sub || req.user.id;
    const shadow = await findUserProfile({ userId });

    res.json({
        user: {
            id: userId,
            email: req.user.email,
            name: req.user.user_metadata?.name || shadow?.name || 'Customer',
            mobile: req.user.user_metadata?.mobile || shadow?.mobile || '',
            role: req.user.app_metadata?.role || shadow?.role || 'customer'
        },
        mfaEnabled: Boolean(shadow?.mfaEnabled),
        aal: req.user.aal || (shadow?.mfaEnabled ? 'aal2' : 'aal1')
    });
});

export default router;
