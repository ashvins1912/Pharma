import crypto from 'node:crypto';
import express from 'express';
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
import UserProfile from '../models/UserProfile.js';
import { getIsConnected } from '../config/db.js';
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

router.post('/demo-customer', async (req, res) => {
    if (!isDemoCustomerEnabled()) {
        return res.status(404).json({ message: 'Demo customer access is disabled.' });
    }
    try {
        const access_token = await issueDemoCustomerToken();
        res.json({ access_token, token_type: 'Bearer', expires_in: 3600, user: getDemoCustomerIdentity() });
    } catch (error) {
        console.error('Demo customer token creation failed:', error);
        res.status(503).json({ message: 'Demo customer access is not configured correctly.' });
    }
});

// In-memory shadow profiles store when MongoDB is offline
const inMemoryShadowProfiles = new Map();

// Helper: Hash password with salt using scrypt
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(password, salt, 32).toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
    if (!password || !salt || !storedHash) return false;
    const computed = crypto.scryptSync(password, salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash));
}

const defaultCustomerSeed = hashPassword('Customer@123');
inMemoryShadowProfiles.set('customer@ashvinpharma.com', {
    supabase_user_id: 'demo-customer-id',
    userId: 'demo-customer-id',
    name: 'Ashvin Singh',
    email: 'customer@ashvinpharma.com',
    role: 'customer',
    mobile: '+91 95899 16475',
    salt: defaultCustomerSeed.salt,
    passwordHash: defaultCustomerSeed.hash,
    mfaEnabled: false
});

// Pending MFA enrollment state
const pendingEnrollments = new Map();

// JWT signing key for intermediate MFA challenges & demo sessions
const JWT_SECRET = process.env.DEMO_ADMIN_JWT_SECRET
    || process.env.ENCRYPTION_SECRET_KEY
    || 'ashvin-pharmacy-demo-admin-jwt-secret-key-32chars!';
const SIGNING_KEY = new TextEncoder().encode(JWT_SECRET);

/**
 * Helper: Find or create MongoDB shadow profile (strictly isolated by supabase_user_id)
 */
async function getShadowProfile(userIdOrEmail) {
    if (getIsConnected()) {
        try {
            return await UserProfile.findOne({
                $or: [
                    { supabase_user_id: userIdOrEmail },
                    { userId: userIdOrEmail },
                    { email: String(userIdOrEmail).toLowerCase().trim() }
                ]
            });
        } catch (e) {
            console.warn('Failed to query Mongo shadow profile:', e.message);
        }
    }
    for (const [, profile] of inMemoryShadowProfiles.entries()) {
        if (profile.userId === userIdOrEmail ||
            profile.supabase_user_id === userIdOrEmail ||
            profile.email === String(userIdOrEmail).toLowerCase().trim()) {
            return profile;
        }
    }
    return inMemoryShadowProfiles.get(userIdOrEmail) || null;
}

/**
 * Helper: Save shadow profile with AES-256-GCM encrypted PII
 */
async function saveShadowProfile(userId, profileData) {
    const shadowDoc = {
        supabase_user_id: userId,
        userId,
        name: profileData.name || 'Valued User',
        email: (profileData.email || '').toLowerCase().trim(),
        role: profileData.role || 'customer',
        mfaEnabled: Boolean(profileData.mfaEnabled),
        mfaSecretEncrypted: profileData.mfaSecretEncrypted || null,
        mfaEnrolledAt: profileData.mfaEnrolledAt || null,
        salt: profileData.salt || null,
        passwordHash: profileData.passwordHash || null,
        lastLoginAt: new Date()
    };

    // Encrypt sensitive PII (mobile, addresses, etc.) at rest
    if (profileData.mobile) {
        shadowDoc.encryptedPii = encryptPII({ mobile: profileData.mobile });
        shadowDoc.mobile = profileData.mobile.slice(-4).padStart(profileData.mobile.length, '*'); // Masked for DB
    }

    if (getIsConnected()) {
        try {
            return await UserProfile.findOneAndUpdate(
                { $or: [{ supabase_user_id: userId }, { userId }, { email: shadowDoc.email }] },
                { $set: shadowDoc },
                { upsert: true, new: true }
            );
        } catch (e) {
            console.warn('Failed to update Mongo shadow profile:', e.message);
        }
    }

    inMemoryShadowProfiles.set(shadowDoc.email, shadowDoc);
    inMemoryShadowProfiles.set(userId, shadowDoc);
    return shadowDoc;
}

/**
 * Helper: Issue intermediate MFA challenge JWT (5-minute expiry, aal1)
 */
async function issueMfaChallengeToken(user, factorId) {
    return new SignJWT({
        sub: user.id || user.sub,
        email: user.email,
        role: user.app_metadata?.role || user.role || 'customer',
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
 * POST /api/auth/login
 * Step 1 of Authentication: Verifies credentials, detects MFA enrollment.
 */
router.post('/login', validateLogin, async (req, res) => {
    const { email, password } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    try {
        // 1. Configured demo admin account. Password and identity are supplied
        // through environment configuration; never bake credentials into source.
        if (verifyDemoAdminPassword(normalizedEmail, password)) {
            if (!process.env.DEMO_ADMIN_JWT_SECRET && process.env.NODE_ENV === 'production') {
                return res.status(503).json({ message: 'Admin sign-in is not configured correctly.' });
            }
            const configuredAdmin = getDemoAdminIdentity();
            const demoAdmin = {
                id: configuredAdmin.id,
                sub: configuredAdmin.id,
                email: configuredAdmin.email,
                role: 'admin',
                app_metadata: { role: 'admin' },
                user_metadata: configuredAdmin.user_metadata
            };
            const shadow = await getShadowProfile(configuredAdmin.id);

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

            const adminToken = await new SignJWT({
                sub: configuredAdmin.id,
                email: configuredAdmin.email,
                app_metadata: { role: 'admin' },
                user_metadata: configuredAdmin.user_metadata,
                aal: 'aal1'
            })
                .setProtectedHeader({ alg: 'HS256' })
                .setSubject(configuredAdmin.id)
                .setIssuedAt()
                .setExpirationTime('2h')
                .sign(SIGNING_KEY);

            const csrfToken = setSessionCookies(res, { accessToken: adminToken });
            return res.json({
                success: true,
                aal: 'aal1',
                user: demoAdmin,
                csrfToken
            });
        }

        // 2. Direct Demo Customer Match
        if (normalizedEmail === 'customer@ashvinpharma.com' && password === 'Customer@123') {
            const demoCustomer = {
                id: 'demo-customer-id',
                sub: 'demo-customer-id',
                email: 'customer@ashvinpharma.com',
                role: 'customer',
                app_metadata: { role: 'customer' },
                user_metadata: { name: 'Ashvin Singh', mobile: '+91 95899 16475' }
            };
            const shadow = await getShadowProfile('demo-customer-id');

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

            const demoToken = await new SignJWT({
                sub: demoCustomer.id,
                email: demoCustomer.email,
                app_metadata: { role: 'customer' },
                user_metadata: demoCustomer.user_metadata,
                aal: 'aal1'
            })
                .setProtectedHeader({ alg: 'HS256' })
                .setSubject(demoCustomer.id)
                .setIssuedAt()
                .setExpirationTime('2h')
                .sign(SIGNING_KEY);

            const csrfToken = setSessionCookies(res, { accessToken: demoToken });
            return res.json({
                success: true,
                aal: 'aal1',
                user: demoCustomer,
                csrfToken
            });
        }

        // 3. Check Registered Local User Profile
        const shadow = await getShadowProfile(normalizedEmail);
        if (shadow && shadow.passwordHash && shadow.salt) {
            const valid = verifyPassword(password, shadow.salt, shadow.passwordHash);
            if (valid) {
                const localUser = {
                    id: shadow.supabase_user_id || shadow.userId,
                    sub: shadow.supabase_user_id || shadow.userId,
                    email: shadow.email,
                    role: shadow.role || 'customer',
                    app_metadata: { role: shadow.role || 'customer' },
                    user_metadata: { name: shadow.name, mobile: shadow.mobile }
                };

                if (shadow.mfaEnabled) {
                    const challengeToken = await issueMfaChallengeToken(localUser, 'local-totp-factor');
                    return res.json({
                        mfaRequired: true,
                        factorId: 'local-totp-factor',
                        challengeToken,
                        email: localUser.email,
                        message: 'Enter the 6-digit TOTP code from your authenticator app.'
                    });
                }

                const userToken = await new SignJWT({
                    sub: localUser.id,
                    email: localUser.email,
                    app_metadata: { role: localUser.role },
                    user_metadata: localUser.user_metadata,
                    aal: 'aal1'
                })
                    .setProtectedHeader({ alg: 'HS256' })
                    .setSubject(localUser.id)
                    .setIssuedAt()
                    .setExpirationTime('2h')
                    .sign(SIGNING_KEY);

                const csrfToken = setSessionCookies(res, { accessToken: userToken });
                return res.json({
                    success: true,
                    aal: 'aal1',
                    user: localUser,
                    csrfToken
                });
            }
        }

        // 4. Authenticate via Supabase Auth
        if (isSupabaseConfigured) {
            try {
                const { data, error } = await supabase.auth.signInWithPassword({
                    email: normalizedEmail,
                    password
                });

                if (!error && data?.user) {
                    const user = data.user;
                    const session = data.session;

                    let mfaEnrolled = false;
                    let factorId = null;

                    try {
                        const { data: factors } = await supabase.auth.mfa.listFactors();
                        const verifiedTotp = factors?.totp?.find(f => f.status === 'verified');
                        if (verifiedTotp) {
                            mfaEnrolled = true;
                            factorId = verifiedTotp.id;
                        }
                    } catch {}

                    if (shadow?.mfaEnabled) {
                        mfaEnrolled = true;
                        factorId = factorId || 'totp-shadow-factor';
                    }

                    if (mfaEnrolled) {
                        const challengeToken = await issueMfaChallengeToken(user, factorId);
                        return res.json({
                            mfaRequired: true,
                            factorId,
                            challengeToken,
                            email: user.email,
                            message: 'Two-factor authentication required. Enter the 6-digit code from your authenticator app.'
                        });
                    }

                    const csrfToken = setSessionCookies(res, {
                        accessToken: session?.access_token,
                        refreshToken: session?.refresh_token
                    });

                    return res.json({
                        success: true,
                        aal: 'aal1',
                        user: {
                            id: user.id,
                            email: user.email,
                            role: user.app_metadata?.role || 'customer',
                            user_metadata: user.user_metadata
                        },
                        csrfToken
                    });
                }
            } catch {}
        }

        return res.status(401).json({ message: 'Invalid email or password.' });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Authentication processing failed.' });
    }
});

/**
 * POST /api/auth/mfa/verify
 * Step 2 of Authentication: Verifies 6-digit TOTP code and upgrades session to AAL2.
 */
router.post('/mfa/verify', validateTotp, async (req, res) => {
    const { code, challengeToken } = req.body;

    if (!challengeToken) {
        return res.status(400).json({ message: 'MFA challenge token is missing.' });
    }

    try {
        // Verify intermediate challenge token
        const { payload } = await jwtVerify(challengeToken, SIGNING_KEY, {
            algorithms: ['HS256'],
            issuer: 'ashvin-auth-mfa',
            audience: 'ashvin-api'
        });

        const userId = payload.sub;
        const email = payload.email;
        const role = payload.role;

        // Fetch shadow profile to retrieve encrypted TOTP secret
        const shadow = await getShadowProfile(userId);
        let isValidCode = false;

        if (shadow?.mfaSecretEncrypted) {
            const secret = decryptPII(shadow.mfaSecretEncrypted);
            isValidCode = verifyTotpCode(secret, code);
        } else if (isSupabaseConfigured) {
            // Verify via Supabase MFA API
            try {
                const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
                    factorId: payload.factor_id,
                    code
                });
                isValidCode = !verifyError;
            } catch (err) {
                console.warn('Supabase MFA challengeAndVerify error:', err.message);
            }
        }

        if (!isValidCode) {
            return res.status(401).json({
                message: 'Invalid 6-digit authenticator code. Check the time on your device and try again.'
            });
        }

        // Code is valid! Issue full AAL2 authenticated session
        const aal2Token = await new SignJWT({
            sub: userId,
            email,
            app_metadata: { role },
            user_metadata: { name: shadow?.name || 'Verified User' },
            aal: 'aal2',
            mfa_verified: true
        })
            .setProtectedHeader({ alg: 'HS256' })
            .setSubject(userId)
            .setIssuedAt()
            .setExpirationTime('2h')
            .sign(SIGNING_KEY);

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
            csrfToken
        });
    } catch (err) {
        console.error('MFA verify error:', err);
        res.status(401).json({ message: 'MFA challenge expired or invalid. Please sign in again.' });
    }
});

/**
 * POST /api/auth/mfa/enroll
 * Generates a new TOTP factor (QR Code + Raw Secret) for authenticator apps.
 */
router.post('/mfa/enroll', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub || req.user.id;
        const accountEmail = req.user.email || 'customer@ashvinpharma.com';

        // Generate 160-bit RFC 6238 Base32 secret
        const secret = generateTotpSecret(20);
        const otpauthUri = buildOtpauthUri({
            issuer: 'Ashvin Pharmacy',
            accountName: accountEmail,
            secret
        });

        // Generate QR code Data URL
        const qrCodeDataUrl = await generateQrCodeDataUrl(otpauthUri);

        // Store pending enrollment in memory for 10 minutes
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
        console.error('MFA enrollment error:', err);
        res.status(500).json({ message: 'Failed to initiate MFA enrollment.' });
    }
});

/**
 * POST /api/auth/mfa/confirm-enroll
 * Confirms and activates TOTP MFA after user enters a code from their authenticator app.
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

        // Verify the user's code against the pending secret
        const isValid = verifyTotpCode(pending.secret, code);
        if (!isValid) {
            return res.status(400).json({
                message: 'Invalid 6-digit code. Please enter the current code shown in your authenticator app.'
            });
        }

        // Encrypt TOTP secret at rest with AES-256-GCM
        const encryptedSecret = encryptPII(pending.secret);

        // Update shadow profile in MongoDB
        await saveShadowProfile(userId, {
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
        console.error('Confirm MFA enrollment error:', err);
        res.status(500).json({ message: 'Failed to confirm MFA enrollment.' });
    }
});

/**
 * POST /api/auth/mfa/unenroll
 * Disables TOTP MFA
 */
router.post('/mfa/mfa-disable', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.sub || req.user.id;

        await saveShadowProfile(userId, {
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
        console.error('MFA unenroll error:', err);
        res.status(500).json({ message: 'Failed to disable MFA.' });
    }
});

/**
 * POST /api/auth/signup
 * Registers user and synchronizes isolated shadow profile in MongoDB with encrypted PII
 */
router.post('/signup', validateSignup, async (req, res) => {
    const { email, password, name, mobile } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    try {
        let userId = `usr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        if (isSupabaseConfigured) {
            try {
                const { data, error } = await supabase.auth.signUp({
                    email: normalizedEmail,
                    password,
                    options: {
                        data: { name, mobile, role: 'customer' }
                    }
                });

                if (!error && data?.user?.id) {
                    userId = data.user.id;
                }
            } catch (supaErr) {
                console.warn('[Signup] Supabase note, activating local resilience:', supaErr.message);
            }
        }

        // Salt and hash password with scrypt for local authentication resilience
        const { salt, hash } = hashPassword(password);

        // Synchronize MongoDB Shadow Profile with AES-256-GCM encrypted PII
        const shadow = await saveShadowProfile(userId, {
            name,
            email: normalizedEmail,
            mobile,
            role: 'customer',
            salt,
            passwordHash: hash
        });

        // Generate immediate session cookie so user is logged in
        const userToken = await new SignJWT({
            sub: userId,
            email: normalizedEmail,
            app_metadata: { role: 'customer' },
            user_metadata: { name: shadow.name, mobile },
            aal: 'aal1'
        })
            .setProtectedHeader({ alg: 'HS256' })
            .setSubject(userId)
            .setIssuedAt()
            .setExpirationTime('2h')
            .sign(SIGNING_KEY);

        const csrfToken = setSessionCookies(res, { accessToken: userToken });

        res.status(201).json({
            success: true,
            message: 'Account registered successfully.',
            user: {
                id: userId,
                email: normalizedEmail,
                name: shadow.name,
                role: 'customer'
            },
            csrfToken
        });
    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ message: 'Registration processing failed.' });
    }
});

/**
 * POST /api/auth/logout
 * Clears HttpOnly session cookies
 */
router.post('/logout', (req, res) => {
    clearSessionCookies(res);
    res.json({ success: true, message: 'Logged out successfully.' });
});

/**
 * GET /api/auth/session
 * Returns authenticated session, MFA status, and assurance level
 */
router.get('/session', authenticateUser, async (req, res) => {
    const userId = req.user.sub || req.user.id;
    const shadow = await getShadowProfile(userId);

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
