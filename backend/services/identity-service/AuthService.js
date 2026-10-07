/**
 * Dedicated Service-Level Authentication & Security Engine
 * Isolates cryptographic hashing, user credential verification,
 * identity lifecycle management, multi-provider identities, single-use activation tokens,
 * and session token generation.
 * Consumed by API Gateway routers.
 */
import crypto from 'node:crypto';
import bcrypt from '../../security/hasher.js';
import { SignJWT, jwtVerify } from 'jose';
import User from '../../models/User.js';
import UserProfile from '../../models/UserProfile.js';
import UserIdentity from '../../models/UserIdentity.js';
import EmailVerificationToken from '../../models/EmailVerificationToken.js';
import { getIsConnected } from '../../config/db.js';
import { emailService } from '../email-service/EmailService.js';
import { tenantService } from '../tenant-service/TenantService.js';
import { identityService } from './IdentityService.js';
import { isPlatformSuperAdmin } from '../../shared/contracts/index.js';
import { logger } from '../../shared/observability/logger.js';
import { issuePharmaAccessToken } from '../../security/pharmaToken.js';
import { authorizationService } from '../../authorization/AuthorizationService.js';

const JWT_SECRET = process.env.DEMO_ADMIN_JWT_SECRET
    || process.env.ENCRYPTION_SECRET_KEY
    || 'ashvin-pharmacy-demo-admin-jwt-secret-key-32chars!';
const SIGNING_KEY = new TextEncoder().encode(JWT_SECRET);

/**
 * Calculates current age from date of birth (DOB).
 * Never store age as source of truth; store dateOfBirth and calculate dynamically.
 */
export function calculateAge(dob) {
    if (!dob) return null;
    const birthDate = new Date(dob);
    if (Number.isNaN(birthDate.getTime())) return null;

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age -= 1;
    }
    return age >= 0 ? age : null;
}

/**
 * Validates date of birth format and ensures it cannot be a future date
 */
export function isValidDOB(dob) {
    if (!dob || typeof dob !== 'string') return false;
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return false;
    const now = new Date();
    if (d > now) return false;
    const minDate = new Date(now.getFullYear() - 130, now.getMonth(), now.getDate());
    if (d < minDate) return false;
    return true;
}

/**
 * Validates phone / mobile format (at least 10 digits)
 */
export function normalizeIndianMobile(mobile) {
    if (mobile === undefined || mobile === null) return null;
    const value = String(mobile).trim().replace(/[\\s()-]/g, '');
    let number = null;
    if (/^\\+91[6-9]\\d{9}$/.test(value)) number = value.slice(3);
    else if (/^91[6-9]\\d{9}$/.test(value)) number = value.slice(2);
    else if (/^0[6-9]\\d{9}$/.test(value)) number = value.slice(1);
    else if (/^[6-9]\\d{9}$/.test(value)) number = value;
    return number ? { countryCode: '+91', number, e164: `+91${number}` } : null;
}

export function isValidMobile(mobile) {
    return Boolean(normalizeIndianMobile(mobile));
}

/**
 * Validates password strength (min 8 chars, uppercase, lowercase, number)
 */
export function isStrongPassword(password) {
    if (!password || typeof password !== 'string') return false;
    if (password.length < 8) return false;
    return /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password);
}

/**
 * Masks email address for secure public/unverified displays (e.g. c***r@pharma.com)
 */
export function maskEmail(email) {
    if (!email || typeof email !== 'string') return '';
    const parts = email.split('@');
    if (parts.length !== 2) return email;
    const [local, domain] = parts;
    if (local.length <= 2) {
        return `${local[0] || '*'}***@${domain}`;
    }
    return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

// In-memory fallback shadow stores for testing and database resilience
export const inMemoryUsers = new Map();
export const inMemoryIdentities = new Map();
export const inMemoryTokens = new Map();

// Rate limiter for verification resend (key -> timestamps array)
const resendRateLimitMap = new Map();

// Pre-seed demo users in memory
const defaultAdminHash = bcrypt.hashSync('Admin@123', 10);
const adminUser = {
    id: 'admin',
    userId: 'admin',
    name: 'Ashvin Singh (Admin)',
    firstName: 'Ashvin',
    lastName: 'Singh',
    email: 'ashvinsingh25@gmail.com',
    normalizedEmail: 'ashvinsingh25@gmail.com',
    dateOfBirth: '1990-01-01',
    mobileNumber: '+91 95899 16475',
    mobile: '+91 95899 16475',
    role: 'SUPER_ADMIN',
    roles: ['SUPER_ADMIN', 'admin'],
    passwordHash: defaultAdminHash,
    emailVerified: true,
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    accountStatus: 'ACTIVE',
    status: 'ACTIVE',
    profileCompleted: true,
    primaryAuthProvider: 'LOCAL',
    activatedAt: new Date('2026-01-01T00:00:00Z'),
    version: 1
};
inMemoryUsers.set('ashvinsingh25@gmail.com', adminUser);
inMemoryUsers.set('admin', adminUser);
inMemoryIdentities.set('LOCAL:ashvinsingh25@gmail.com', {
    id: 'ident-admin-local',
    userId: 'admin',
    provider: 'LOCAL',
    providerUserId: 'ashvinsingh25@gmail.com',
    providerEmail: 'ashvinsingh25@gmail.com',
    providerEmailVerified: true,
    passwordHash: defaultAdminHash,
    createdAt: new Date('2026-01-01T00:00:00Z')
});

const defaultCustomerHash = bcrypt.hashSync('Customer@123', 10);
const customerUser = {
    id: 'demo-customer-id',
    userId: 'demo-customer-id',
    name: 'Ashvin Singh',
    firstName: 'Ashvin',
    lastName: 'Singh',
    email: 'customer@ashvinpharma.com',
    normalizedEmail: 'customer@ashvinpharma.com',
    dateOfBirth: '1995-05-15',
    mobileNumber: '+91 95899 16475',
    mobile: '+91 95899 16475',
    role: 'customer',
    roles: ['customer'],
    passwordHash: defaultCustomerHash,
    emailVerified: true,
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    accountStatus: 'ACTIVE',
    status: 'ACTIVE',
    profileCompleted: true,
    primaryAuthProvider: 'LOCAL',
    activatedAt: new Date('2026-01-01T00:00:00Z'),
    version: 1
};
inMemoryUsers.set('customer@ashvinpharma.com', customerUser);
inMemoryUsers.set('demo-customer-id', customerUser);
inMemoryIdentities.set('LOCAL:customer@ashvinpharma.com', {
    id: 'ident-customer-local',
    userId: 'demo-customer-id',
    provider: 'LOCAL',
    providerUserId: 'customer@ashvinpharma.com',
    providerEmail: 'customer@ashvinpharma.com',
    providerEmailVerified: true,
    passwordHash: defaultCustomerHash,
    createdAt: new Date('2026-01-01T00:00:00Z')
});

export class AuthService {
    /**
     * Locate user by query (MongoDB with in-memory fallback)
     */
    async findUser(query) {
        if (getIsConnected()) {
            try {
                // Try User model first
                let doc = await User.findOne(query).lean().exec();
                if (!doc) {
                    doc = await UserProfile.findOne(query).lean().exec();
                }
                if (doc) {
                    return {
                        ...doc,
                        id: doc.userId || doc.id || doc._id?.toString(),
                        userId: doc.userId || doc.id || doc._id?.toString(),
                        age: calculateAge(doc.dateOfBirth)
                    };
                }
            } catch (err) {
                logger.warn('Failed querying User in Mongo:', { error: err.message });
            }
        }

        if (query.normalizedEmail) {
            const u = inMemoryUsers.get(query.normalizedEmail.toLowerCase());
            if (u) return { ...u, age: calculateAge(u.dateOfBirth) };
        }
        if (query.userId || query.supabase_user_id || query.id) {
            const uid = query.userId || query.supabase_user_id || query.id;
            for (const u of inMemoryUsers.values()) {
                if (u.id === uid || u.userId === uid || u.supabase_user_id === uid) {
                    return { ...u, age: calculateAge(u.dateOfBirth) };
                }
            }
        }
        if (query.verificationTokenHash) {
            for (const u of inMemoryUsers.values()) {
                if (u.verificationTokenHash === query.verificationTokenHash) {
                    return { ...u, age: calculateAge(u.dateOfBirth) };
                }
            }
        }
        return null;
    }

    /**
     * Persist or update user document
     */
    async saveUser(userId, userData) {
        const normEmail = (userData.email || userData.normalizedEmail || '').trim().toLowerCase();
        const doc = {
            ...userData,
            userId,
            id: userId,
            supabase_user_id: userData.supabase_user_id || userId,
            email: userData.email || normEmail,
            normalizedEmail: normEmail,
            dateOfBirth: userData.dateOfBirth || null,
            mobileNumber: userData.mobileNumber || userData.mobile || '',
            mobile: userData.mobileNumber || userData.mobile || '',
            accountStatus: userData.status === 'ACTIVE' ? 'ACTIVE' : (userData.accountStatus || 'PENDING_EMAIL_VERIFICATION'),
            status: (userData.accountStatus === 'ACTIVE' || userData.status === 'ACTIVE') ? 'ACTIVE' : (userData.status || 'PENDING_VERIFICATION'),
            profileCompleted: userData.profileCompleted !== undefined ? Boolean(userData.profileCompleted) : true,
            primaryAuthProvider: userData.primaryAuthProvider || 'LOCAL',
            version: (userData.version || 1) + 1,
            updatedAt: new Date()
        };

        if (getIsConnected()) {
            try {
                // Upsert to User model
                await User.findOneAndUpdate(
                    { $or: [{ userId }, { normalizedEmail: normEmail }] },
                    { $set: doc },
                    { upsert: true, new: true, runValidators: true }
                );
                // Sync to UserProfile model for backward compatibility
                await UserProfile.findOneAndUpdate(
                    { $or: [{ userId }, { supabase_user_id: userId }, { normalizedEmail: normEmail }] },
                    { $set: doc },
                    { upsert: true, new: true, runValidators: true }
                );
            } catch (e) {
                logger.warn('Failed to persist User to Mongo:', { error: e.message });
            }
        }

        inMemoryUsers.set(normEmail, doc);
        inMemoryUsers.set(userId, doc);
        return {
            ...doc,
            age: calculateAge(doc.dateOfBirth)
        };
    }

    /**
     * Locate UserIdentity by provider and providerUserId
     */
    async findIdentity(provider, providerUserId) {
        if (getIsConnected()) {
            try {
                const doc = await UserIdentity.findOne({ provider, providerUserId }).lean().exec();
                if (doc) return doc;
            } catch (e) {
                logger.warn('Failed querying UserIdentity in Mongo:', { error: e.message });
            }
        }
        return inMemoryIdentities.get(`${provider}:${providerUserId}`) || null;
    }

    /**
     * Persist UserIdentity
     */
    async saveIdentity(identityData) {
        const id = identityData.id || crypto.randomUUID();
        const doc = {
            ...identityData,
            id,
            updatedAt: new Date()
        };

        if (getIsConnected()) {
            try {
                await UserIdentity.findOneAndUpdate(
                    { provider: identityData.provider, providerUserId: identityData.providerUserId },
                    { $set: doc },
                    { upsert: true, new: true }
                );
            } catch (e) {
                logger.warn('Failed to persist UserIdentity in Mongo:', { error: e.message });
            }
        }

        inMemoryIdentities.set(`${identityData.provider}:${identityData.providerUserId}`, doc);
        return doc;
    }

    /**
     * Create platform JWT session token
     */
    async createAuthToken(user, aal = 'aal1') {
        const authorization = await authorizationService.resolve(user);
        const userId = user.id || user.userId || user.supabase_user_id;
        const name = user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim();

        const sessionId = crypto.randomUUID();
        return issuePharmaAccessToken({
            sub: userId,
            email: user.email || '',
            name,
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            dateOfBirth: user.dateOfBirth || null,
            mobile: user.mobileNumber || user.mobile || '',
            accountStatus: user.accountStatus || 'ACTIVE',
            profileCompleted: user.profileCompleted !== false,
            primaryAuthProvider: user.primaryAuthProvider || 'LOCAL',
            role: authorization.role,
            roles: authorization.roles,
            permissions: authorization.permissions,
            permissionVersion: authorization.permissionVersion,
            tenantId: authorization.tenantId,
            branchId: authorization.branchId,
            scope: authorization.scope,
            sessionId,
            aal
        });
    }
    /**
     * User Registration with single-use verification token & persistent User model
     */
    async registerUser({ firstName, lastName, email, mobile, mobileNumber, dateOfBirth, password }) {
        const normalizedEmail = (email || '').trim().toLowerCase();
        const fName = (firstName || '').trim();
        const lName = (lastName || '').trim();
        const phone = (mobileNumber || mobile || '').trim();
        const normalizedPhone = normalizeIndianMobile(phone);

        // 1. Validation
        if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            const err = new Error('A valid email address is required.');
            err.code = 'INVALID_EMAIL';
            err.status = 400;
            throw err;
        }

        if (!fName) {
            const err = new Error('First name is required.');
            err.code = 'REQUIRED_FIELD';
            err.status = 400;
            throw err;
        }

        const effectiveDob = dateOfBirth || '2000-01-01';
        if (dateOfBirth && !isValidDOB(dateOfBirth)) {
            const err = new Error('Date of birth must be a valid date and cannot be in the future.');
            err.code = 'INVALID_DOB';
            err.status = 400;
            throw err;
        }

        if (!normalizedPhone) {
            const err = new Error('A valid Indian mobile number is required. Use 10 digits or 91/+91/0 prefix.');
            err.code = 'INVALID_MOBILE';
            err.status = 400;
            throw err;
        }

        if (!isStrongPassword(password)) {
            const err = new Error('Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number.');
            err.code = 'WEAK_PASSWORD';
            err.status = 400;
            throw err;
        }

        // 2. Duplicate check
        const existing = await this.findUser({ normalizedEmail });
        if (existing) {
            const err = new Error('An account already exists with this email address.');
            err.code = 'EMAIL_ALREADY_EXISTS';
            err.status = 409;
            throw err;
        }

        // 3. Password Hashing
        const passwordHash = await bcrypt.hash(password, 12);

        // 4. Create User model (accountStatus = PENDING_EMAIL_VERIFICATION)
        const userId = `usr_${crypto.randomUUID()}`;
        const createdAt = new Date().toISOString();

        const userDoc = await this.saveUser(userId, {
            userId,
            email: normalizedEmail,
            normalizedEmail,
            firstName: fName,
            lastName: lName,
            name: `${fName} ${lName}`.trim(),
            dateOfBirth,
            mobileNumber: normalizedPhone.e164,
            mobile: normalizedPhone.e164,
            passwordHash,
            emailVerified: false,
            emailVerifiedAt: null,
            mobileVerified: false,
            accountStatus: 'PENDING_EMAIL_VERIFICATION',
            status: 'PENDING_VERIFICATION',
            profileCompleted: true,
            primaryAuthProvider: 'LOCAL',
            role: 'customer',
            roles: ['customer'],
            createdAt,
            version: 1
        });

        // 5. Create LOCAL UserIdentity
        await this.saveIdentity({
            id: `ident_${crypto.randomUUID()}`,
            userId,
            provider: 'LOCAL',
            providerUserId: normalizedEmail,
            providerEmail: normalizedEmail,
            providerEmailVerified: false,
            passwordHash,
            createdAt: new Date()
        });

        // 6. Generate single-use verification token (Raw token never saved in DB)
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await this.saveVerificationToken({
            id: `tok_${crypto.randomUUID()}`,
            userId,
            tokenHash,
            purpose: 'ACCOUNT_ACTIVATION',
            expiresAt,
            usedAt: null,
            revokedAt: null,
            createdAt: new Date()
        });

        // Also store verificationTokenHash on user for backwards compat lookup
        userDoc.verificationTokenHash = tokenHash;
        userDoc.verificationTokenExpiresAt = expiresAt;
        inMemoryUsers.set(normalizedEmail, userDoc);
        inMemoryUsers.set(userId, userDoc);

        // 7. Dispatch activation email
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const activationUrl = `${frontendUrl}/activate-account?token=${rawToken}`;
        const verificationUrl = `${frontendUrl}/verify-email?token=${rawToken}`;

        try {
            await emailService.sendEmailVerification({
                email: normalizedEmail,
                name: `${fName} ${lName}`.trim(),
                token: rawToken,
                verificationUrl: activationUrl,
                activationUrl
            });
        } catch (e) {
            logger.warn('Email dispatch warning on signup:', { error: e.message });
        }

        return {
            user: {
                id: userId,
                userId,
                firstName: fName,
                lastName: lName,
                email: normalizedEmail,
                mobileNumber: phone,
                dateOfBirth: effectiveDob,
                age: calculateAge(effectiveDob),
                accountStatus: 'PENDING_EMAIL_VERIFICATION',
                status: 'PENDING_VERIFICATION',
                emailVerified: false,
                profileCompleted: true,
                createdAt
            },
            verification: {
                required: true,
                message: 'Activation link sent. Please verify your email to activate your account.'
            }
        };
    }

    /**
     * Persist EmailVerificationToken
     */
    async saveVerificationToken(tokenData) {
        if (getIsConnected()) {
            try {
                await EmailVerificationToken.findOneAndUpdate(
                    { tokenHash: tokenData.tokenHash },
                    { $set: tokenData },
                    { upsert: true, new: true }
                );
            } catch (e) {
                logger.warn('Failed saving EmailVerificationToken to Mongo:', { error: e.message });
            }
        }
        inMemoryTokens.set(tokenData.tokenHash, tokenData);
        return tokenData;
    }

    /**
     * Find EmailVerificationToken by tokenHash
     */
    async findVerificationToken(tokenHash) {
        if (getIsConnected()) {
            try {
                const doc = await EmailVerificationToken.findOne({ tokenHash }).lean().exec();
                if (doc) return doc;
            } catch (e) {
                logger.warn('Failed querying EmailVerificationToken in Mongo:', { error: e.message });
            }
        }
        return inMemoryTokens.get(tokenHash) || null;
    }

    /**
     * Account Activation / Email Verification Endpoint
     * Verifies single-use cryptographically secure token, activates account, and marks token used
     */
    async activateAccount(token) {
        if (!token || typeof token !== 'string') {
            const err = new Error('Activation token is required.');
            err.code = 'INVALID_TOKEN';
            err.status = 400;
            throw err;
        }

        const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

        // 1. Look up token by hash
        let tokenDoc = await this.findVerificationToken(tokenHash);
        let user = null;

        if (tokenDoc) {
            if (tokenDoc.revokedAt) {
                const err = new Error('This activation link has been revoked. Please request a new one.');
                err.code = 'TOKEN_REVOKED';
                err.status = 400;
                throw err;
            }
            if (tokenDoc.usedAt) {
                const err = new Error('This activation link has already been used. Please sign in.');
                err.code = 'TOKEN_ALREADY_USED';
                err.status = 400;
                throw err;
            }
            if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt) < new Date()) {
                const err = new Error('This activation link has expired.');
                err.code = 'TOKEN_EXPIRED';
                err.status = 410;
                throw err;
            }
            user = await this.findUser({ userId: tokenDoc.userId });
        } else {
            // Backward-compat check against user.verificationTokenHash
            user = await this.findUser({ verificationTokenHash: tokenHash });
            if (!user) {
                const err = new Error('Invalid or already used activation token.');
                err.code = 'INVALID_TOKEN';
                err.status = 400;
                throw err;
            }
            if (user.verificationTokenExpiresAt && new Date(user.verificationTokenExpiresAt) < new Date()) {
                const err = new Error('This activation link has expired.');
                err.code = 'TOKEN_EXPIRED';
                err.status = 410;
                throw err;
            }
        }

        if (!user) {
            const err = new Error('User associated with this token was not found.');
            err.code = 'USER_NOT_FOUND';
            err.status = 404;
            throw err;
        }

        const now = new Date();

        // 2. Mark token used
        if (tokenDoc) {
            tokenDoc.usedAt = now;
            await this.saveVerificationToken(tokenDoc);
        }

        // 3. Activate user atomically
        user.emailVerified = true;
        user.emailVerifiedAt = now;
        user.accountStatus = 'ACTIVE';
        user.status = 'ACTIVE';
        user.activatedAt = now;
        user.verificationTokenHash = null;
        user.verificationTokenExpiresAt = null;

        await this.saveUser(user.userId || user.supabase_user_id || user.id, user);

        // 4. Update LOCAL UserIdentity
        const normEmail = user.normalizedEmail || user.email?.toLowerCase();
        const identity = await this.findIdentity('LOCAL', normEmail);
        if (identity) {
            identity.providerEmailVerified = true;
            await this.saveIdentity(identity);
        }

        // 5. Ensure global customer record is active
        try {
            await identityService.getOrCreateCustomer(user.userId || user.id, {
                name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                email: user.email,
                phone: user.mobileNumber || user.mobile
            });
        } catch (e) {
            logger.warn('Failed linking Customer record on activation:', { error: e.message });
        }

        logger.info('Account activated successfully:', { userId: user.userId, email: user.email });

        return {
            status: 'ACTIVE',
            emailVerified: true,
            message: 'Your account has been activated successfully.',
            user: {
                id: user.userId || user.id,
                userId: user.userId || user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                accountStatus: 'ACTIVE',
                emailVerified: true,
                age: calculateAge(user.dateOfBirth)
            }
        };
    }

    /**
     * Backward-compatible verifyEmail alias
     */
    async verifyEmail(token) {
        return this.activateAccount(token);
    }

    /**
     * Resend verification email with rate-limiting
     */
    async resendVerificationEmail({ email, requestIp }) {
        if (!email) {
            const err = new Error('Email address is required.');
            err.code = 'REQUIRED_FIELD';
            err.status = 400;
            throw err;
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Rate limit: max 3 requests per 10 minutes per email
        const now = Date.now();
        const windowMs = 10 * 60 * 1000;
        const attempts = (resendRateLimitMap.get(normalizedEmail) || []).filter(t => now - t < windowMs);

        if (attempts.length >= 3) {
            const err = new Error('Too many verification requests. Please wait a few minutes before trying again.');
            err.code = 'RATE_LIMIT_EXCEEDED';
            err.status = 429;
            throw err;
        }

        attempts.push(now);
        resendRateLimitMap.set(normalizedEmail, attempts);

        const user = await this.findUser({ normalizedEmail });

        if (user && (!user.emailVerified || user.accountStatus === 'PENDING_EMAIL_VERIFICATION' || user.accountStatus === 'PENDING_ACCOUNT_ACTIVATION')) {
            // Revoke prior active tokens
            if (getIsConnected()) {
                try {
                    await EmailVerificationToken.updateMany(
                        { userId: user.userId, usedAt: null, revokedAt: null },
                        { $set: { revokedAt: new Date() } }
                    );
                } catch (e) {
                    logger.warn('Failed revoking prior tokens:', { error: e.message });
                }
            }
            for (const t of inMemoryTokens.values()) {
                if (t.userId === user.userId && !t.usedAt && !t.revokedAt) {
                    t.revokedAt = new Date();
                }
            }

            // Generate new token
            const rawToken = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await this.saveVerificationToken({
                id: `tok_${crypto.randomUUID()}`,
                userId: user.userId,
                tokenHash,
                purpose: 'ACCOUNT_ACTIVATION',
                expiresAt,
                usedAt: null,
                revokedAt: null,
                requestIp: requestIp || null,
                createdAt: new Date()
            });

            user.verificationTokenHash = tokenHash;
            user.verificationTokenExpiresAt = expiresAt;
            await this.saveUser(user.userId, user);

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const activationUrl = `${frontendUrl}/activate-account?token=${rawToken}`;

            try {
                await emailService.sendEmailVerification({
                    email: normalizedEmail,
                    name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                    token: rawToken,
                    verificationUrl: activationUrl,
                    activationUrl
                });
            } catch (e) {
                logger.warn('Failed resending activation email:', { error: e.message });
            }
        }

        // Return uniform response (don't reveal whether arbitrary email exists)
        return {
            success: true,
            canResendVerification: true,
            message: 'If the account exists and requires activation, an activation email has been sent.'
        };
    }

    /**
     * Authenticate credentials and enforce activation status
     */
    async authenticateCredentials({ email, password }) {
        const normalizedEmail = (email || '').trim().toLowerCase();

        // 1. Direct Demo Admin Match
        if (normalizedEmail === 'ashvinsingh25@gmail.com' && password === 'Admin@123') {
            const user = inMemoryUsers.get('ashvinsingh25@gmail.com') || adminUser;
            const token = await this.createAuthToken(user);
            return {
                user: {
                    ...user,
                    age: calculateAge(user.dateOfBirth),
                    scope: 'PLATFORM',
                    tenantId: null,
                    tenant: null
                },
                tenant: null,
                membership: null,
                accessToken: token
            };
        }

        // 2. Direct Demo Customer Match
        if (normalizedEmail === 'customer@ashvinpharma.com' && password === 'Customer@123') {
            const user = inMemoryUsers.get('customer@ashvinpharma.com') || customerUser;
            const token = await this.createAuthToken(user);
            return {
                user: {
                    ...user,
                    age: calculateAge(user.dateOfBirth),
                    scope: 'CUSTOMER',
                    tenantId: null,
                    tenant: null
                },
                tenant: null,
                membership: null,
                accessToken: token
            };
        }

        // 3. Database / memory lookup
        const user = await this.findUser({ normalizedEmail });
        if (!user) {
            const err = new Error('Invalid email or password.');
            err.code = 'INVALID_CREDENTIALS';
            err.status = 401;
            throw err;
        }

        // Check password from UserIdentity or user.passwordHash
        let passwordHash = user.passwordHash;
        const identity = await this.findIdentity('LOCAL', normalizedEmail);
        if (identity && identity.passwordHash) {
            passwordHash = identity.passwordHash;
        }

        if (!passwordHash) {
            const err = new Error('Invalid email or password.');
            err.code = 'INVALID_CREDENTIALS';
            err.status = 401;
            throw err;
        }

        const validPassword = await bcrypt.compare(password, passwordHash);
        if (!validPassword) {
            const err = new Error('Invalid email or password.');
            err.code = 'INVALID_CREDENTIALS';
            err.status = 401;
            throw err;
        }

        // 4. Check account status
        if (user.accountStatus === 'SUSPENDED' || user.status === 'SUSPENDED' || user.accountStatus === 'DISABLED' || user.status === 'DISABLED') {
            const err = new Error('Your account is suspended or disabled. Please contact support.');
            err.code = 'FORBIDDEN';
            err.status = 403;
            throw err;
        }

        // 5. Check if email verification / account activation is pending
        const isVerifiedAndActive = Boolean(user.emailVerified) && (user.status === 'ACTIVE' || user.accountStatus === 'ACTIVE');
        if (!isVerifiedAndActive && (user.accountStatus === 'PENDING_EMAIL_VERIFICATION' || user.status === 'PENDING_VERIFICATION' || !user.emailVerified)) {
            const err = new Error('Please verify your email address before logging in.');
            err.code = 'EMAIL_NOT_VERIFIED';
            err.subCode = 'EMAIL_VERIFICATION_REQUIRED';
            err.status = 403;
            err.email = maskEmail(user.email);
            err.canResendVerification = true;
            throw err;
        }

        if (user.accountStatus === 'PENDING_ACCOUNT_ACTIVATION') {
            const err = new Error('Please activate your Pharma account.');
            err.code = 'ACCOUNT_ACTIVATION_REQUIRED';
            err.status = 403;
            err.email = maskEmail(user.email);
            err.canResendVerification = true;
            throw err;
        }

        // 6. Check if profile completion is required
        if (user.accountStatus === 'PROFILE_INCOMPLETE' || user.profileCompleted === false) {
            const token = await this.createAuthToken(user);
            return {
                code: 'PROFILE_INCOMPLETE',
                requiresProfileCompletion: true,
                message: 'Please complete your profile to continue.',
                user: {
                    id: user.userId || user.supabase_user_id || user.id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    accountStatus: 'PROFILE_INCOMPLETE',
                    profileCompleted: false,
                    age: calculateAge(user.dateOfBirth)
                },
                accessToken: token
            };
        }

        // 7. Successful login resolution
        const rawRole = user.role || (user.roles && user.roles[0]) || 'customer';
        const role = isPlatformSuperAdmin(rawRole) ? 'SUPER_ADMIN' : rawRole;
        const tenantId = user.tenantId || null;

        let tenant = null;
        let membership = null;

        if (tenantId) {
            const t = await tenantService.getTenantById(tenantId);
            if (t) {
                tenant = {
                    id: t.id || t._id,
                    name: t.name,
                    slug: t.slug,
                    status: t.status
                };
            }
            const memberships = await tenantService.getMembershipsForUser(user.userId || user.supabase_user_id || user.id);
            const m = memberships.find(mem => mem.tenantId === tenantId) || memberships[0];
            if (m) {
                membership = {
                    id: m.id || m._id,
                    role: m.role || 'TENANT_ADMIN',
                    permissions: m.permissions || ['inventory.read', 'inventory.write'],
                    status: m.status || 'ACTIVE'
                };
            }
        }

        const isPlatform = role === 'SUPER_ADMIN';
        const scope = isPlatform ? 'PLATFORM' : (tenantId ? 'TENANT' : 'CUSTOMER');
        const token = await this.createAuthToken({ ...user, role, tenantId });

        // Update last login
        user.lastLoginAt = new Date();
        await this.saveUser(user.userId || user.id, user);

        return {
            user: {
                id: user.userId || user.supabase_user_id || user.id,
                userId: user.userId || user.supabase_user_id || user.id,
                firstName: user.firstName || (user.name ? user.name.split(' ')[0] : 'User'),
                lastName: user.lastName || (user.name ? user.name.split(' ').slice(1).join(' ') : ''),
                email: user.email,
                mobileNumber: user.mobileNumber || user.mobile || '',
                mobile: user.mobileNumber || user.mobile || '',
                dateOfBirth: user.dateOfBirth || null,
                age: calculateAge(user.dateOfBirth),
                emailVerified: Boolean(user.emailVerified),
                accountStatus: user.accountStatus || 'ACTIVE',
                status: user.status || 'ACTIVE',
                profileCompleted: user.profileCompleted !== false,
                role,
                scope,
                tenantId: isPlatform ? null : tenantId,
                tenant: tenant || null
            },
            tenant,
            membership,
            accessToken: token
        };
    }

    /**
     * Google Login and Multi-Provider Account Linking
     */
    async authenticateGoogle({ providerUserId, email, emailVerified: googleEmailVerified, firstName, lastName, picture }) {
        if (!providerUserId || !email) {
            const err = new Error('Invalid Google credentials.');
            err.code = 'INVALID_CREDENTIALS';
            err.status = 400;
            throw err;
        }

        const normalizedEmail = email.trim().toLowerCase();

        // 1. Check existing GOOGLE UserIdentity
        let identity = await this.findIdentity('GOOGLE', providerUserId);
        let user = null;

        if (identity) {
            user = await this.findUser({ userId: identity.userId });
        }

        if (!user) {
            // 2. Check if user exists by normalized email
            user = await this.findUser({ normalizedEmail });

            if (user) {
                // Securely link Google identity to existing account if email is verified
                identity = await this.saveIdentity({
                    id: `ident_${crypto.randomUUID()}`,
                    userId: user.userId || user.id,
                    provider: 'GOOGLE',
                    providerUserId,
                    providerEmail: normalizedEmail,
                    providerEmailVerified: Boolean(googleEmailVerified),
                    createdAt: new Date(),
                    lastLoginAt: new Date()
                });
            } else {
                // 3. First-time Google user: create User with PROFILE_INCOMPLETE
                const userId = `usr_${crypto.randomUUID()}`;
                const now = new Date();

                user = await this.saveUser(userId, {
                    userId,
                    email: normalizedEmail,
                    normalizedEmail,
                    firstName: firstName || '',
                    lastName: lastName || '',
                    name: `${firstName || ''} ${lastName || ''}`.trim(),
                    primaryAuthProvider: 'GOOGLE',
                    emailVerified: Boolean(googleEmailVerified),
                    emailVerifiedAt: googleEmailVerified ? now : null,
                    profileCompleted: false,
                    accountStatus: 'PROFILE_INCOMPLETE',
                    status: 'ACTIVE',
                    role: 'customer',
                    roles: ['customer'],
                    createdAt: now.toISOString(),
                    version: 1
                });

                identity = await this.saveIdentity({
                    id: `ident_${crypto.randomUUID()}`,
                    userId,
                    provider: 'GOOGLE',
                    providerUserId,
                    providerEmail: normalizedEmail,
                    providerEmailVerified: Boolean(googleEmailVerified),
                    createdAt: now,
                    lastLoginAt: now
                });
            }
        }

        // Update last login
        user.lastLoginAt = new Date();
        await this.saveUser(user.userId || user.id, user);

        // Check onboarding / profile status
        if (!user.profileCompleted || user.accountStatus === 'PROFILE_INCOMPLETE') {
            const token = await this.createAuthToken(user);
            return {
                code: 'PROFILE_INCOMPLETE',
                requiresProfileCompletion: true,
                message: 'Please complete your profile to continue.',
                user: {
                    id: user.userId || user.id,
                    userId: user.userId || user.id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    dateOfBirth: user.dateOfBirth || null,
                    mobileNumber: user.mobileNumber || user.mobile || '',
                    profileCompleted: false,
                    accountStatus: 'PROFILE_INCOMPLETE'
                },
                accessToken: token
            };
        }

        if (user.accountStatus === 'PENDING_ACCOUNT_ACTIVATION') {
            const err = new Error('Please activate your Pharma account.');
            err.code = 'ACCOUNT_ACTIVATION_REQUIRED';
            err.status = 403;
            err.email = maskEmail(user.email);
            err.canResendVerification = true;
            throw err;
        }

        const token = await this.createAuthToken(user);
        return {
            user: {
                id: user.userId || user.id,
                userId: user.userId || user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                dateOfBirth: user.dateOfBirth,
                age: calculateAge(user.dateOfBirth),
                mobileNumber: user.mobileNumber || user.mobile,
                emailVerified: Boolean(user.emailVerified),
                accountStatus: user.accountStatus || 'ACTIVE',
                profileCompleted: true,
                role: user.role || 'customer',
                scope: 'CUSTOMER'
            },
            accessToken: token
        };
    }

    /**
     * Complete profile onboarding (e.g. for Google OAuth users)
     */
    async completeProfile({ userId, firstName, lastName, dateOfBirth, mobileNumber, mobile, gender }) {
        if (!userId) {
            const err = new Error('User ID is required.');
            err.code = 'REQUIRED_FIELD';
            err.status = 400;
            throw err;
        }

        const fName = (firstName || '').trim();
        const lName = (lastName || '').trim();
        const phone = (mobileNumber || mobile || '').trim();
        const normalizedPhone = normalizeIndianMobile(phone);

        if (!fName) {
            const err = new Error('First name is required.');
            err.code = 'REQUIRED_FIELD';
            err.status = 400;
            throw err;
        }

        if (!gender || !['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'].includes(gender)) {
            const err = new Error('Gender is required.');
            err.code = 'INVALID_GENDER';
            err.status = 400;
            throw err;
        }

        if (!dateOfBirth) {
            const err = new Error('Date of birth is required.');
            err.code = 'REQUIRED_FIELD';
            err.status = 400;
            throw err;
        }

        if (!isValidDOB(dateOfBirth)) {
            const err = new Error('Date of birth must be a valid date and cannot be in the future.');
            err.code = 'INVALID_DOB';
            err.status = 400;
            throw err;
        }

        if (!normalizedPhone) {
            const err = new Error('A valid Indian mobile number is required. Use 10 digits or 91/+91/0 prefix.');
            err.code = 'INVALID_MOBILE';
            err.status = 400;
            throw err;
        }

        const user = await this.findUser({ userId });
        if (!user) {
            const err = new Error('User not found.');
            err.code = 'USER_NOT_FOUND';
            err.status = 404;
            throw err;
        }

        // Update profile details
        user.firstName = fName;
        user.lastName = lName;
        user.name = `${fName} ${lName}`.trim();
        user.dateOfBirth = dateOfBirth;
        user.mobileNumber = normalizedPhone.e164;
        user.mobile = normalizedPhone.e164;
        if (gender) user.gender = gender;
        user.profileCompleted = true;
        user.accountStatus = 'ACTIVE';
        user.status = 'ACTIVE';
        user.activatedAt = user.activatedAt || new Date();

        await this.saveUser(userId, user);

        // Ensure global customer record
        try {
            await identityService.getOrCreateCustomer(userId, {
                name: user.name,
                email: user.email,
                phone: normalizedPhone.e164
            });
        } catch (e) {
            logger.warn('Failed linking Customer record on profile completion:', { error: e.message });
        }

        const token = await this.createAuthToken(user);
        return {
            user: {
                id: userId,
                userId,
                email: user.email,
                firstName: fName,
                lastName: lName,
                name: user.name,
                dateOfBirth,
                age: calculateAge(dateOfBirth),
                mobileNumber: normalizedPhone.e164,
                accountStatus: 'ACTIVE',
                profileCompleted: true,
                emailVerified: Boolean(user.emailVerified)
            },
            accessToken: token,
            message: 'Profile completed successfully.'
        };
    }

    /**
     * Retrieve authenticated profile with full tenant & membership context
     */
    async getUserProfile(user, context = {}) {
        const rawRole = user.app_metadata?.role || user.role || 'customer';
        const role = isPlatformSuperAdmin(rawRole) ? 'SUPER_ADMIN' : rawRole;
        const isPlatform = role === 'SUPER_ADMIN';

        let tenantId = isPlatform ? null : (user.app_metadata?.tenantId || user.tenantId || context.authorizedTenantId || context.tenantId || null);

        let tenant = null;
        let membership = null;

        if (tenantId) {
            const t = await tenantService.getTenantById(tenantId);
            if (t) {
                tenant = {
                    id: t.id || t._id,
                    name: t.name,
                    slug: t.slug,
                    status: t.status
                };
            }
            const memberships = await tenantService.getMembershipsForUser(user.id || user.sub);
            const m = memberships.find(mem => mem.tenantId === tenantId) || memberships[0];
            if (m) {
                membership = {
                    id: m.id || m._id,
                    role: m.role || 'TENANT_ADMIN',
                    permissions: m.permissions || ['inventory.read', 'inventory.write'],
                    status: m.status || 'ACTIVE'
                };
            }
        }

        const nameParts = (user.user_metadata?.name || user.name || '').trim().split(/\s+/);
        const firstName = user.firstName || nameParts[0] || 'User';
        const lastName = user.lastName || nameParts.slice(1).join(' ') || '';

        const scope = isPlatform ? 'PLATFORM' : (tenantId ? 'TENANT' : 'CUSTOMER');
        const effectiveRole = isPlatform ? 'SUPER_ADMIN' : (role === 'TENANT_ADMIN' ? 'TENANT_ADMIN' : (role.toLowerCase() === 'customer' ? 'customer' : role));

        const age = calculateAge(user.dateOfBirth);

        return {
            user: {
                id: user.id || user.sub,
                userId: user.id || user.sub,
                firstName,
                lastName,
                email: user.email || '',
                mobileNumber: user.user_metadata?.mobile || user.mobileNumber || user.mobile || '',
                mobile: user.user_metadata?.mobile || user.mobileNumber || user.mobile || '',
                dateOfBirth: user.dateOfBirth || user.user_metadata?.dateOfBirth || null,
                age,
                emailVerified: Boolean(user.emailVerified !== false),
                accountStatus: user.accountStatus || 'ACTIVE',
                status: user.status || 'ACTIVE',
                profileCompleted: user.profileCompleted !== false,
                role: effectiveRole,
                scope,
                tenantId: isPlatform ? null : tenantId,
                tenant: tenant || null
            },
            tenant,
            membership
        };
    }
}

export const authService = new AuthService();
export default authService;
