/**
 * Dedicated Service-Level Authentication & Security Engine
 * Isolates cryptographic hashing, user credential verification,
 * identity lifecycle management, multi-provider identities, single-use activation tokens,
 * and session token generation.
 * Consumed by API Gateway routers.
 */
import crypto from 'node:crypto';
import bcrypt from '../../security/hasher.js';
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
import { issuePharmaAccessToken, verifyPharmaAccessToken } from '../../security/pharmaToken.js';
import { authorizationService } from '../../authorization/AuthorizationService.js';
import { generateTotpSecret, verifyTotpCode, buildOtpauthUri, generateQrCodeDataUrl } from '../../security/totp.js';
import { encryptPII, decryptPII } from '../../security/cryptoVault.js';

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
const passwordResetRateLimitMap = new Map();
const pendingMfaEnrollments = new Map();

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
            accountStatus: userData.accountStatus || (userData.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING_EMAIL_VERIFICATION'),
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
    async registerUser({ firstName, lastName, email, mobile, mobileNumber, dateOfBirth, gender, password }) {
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

        const effectiveDob = dateOfBirth && isValidDOB(dateOfBirth) ? dateOfBirth : null;
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
            dateOfBirth: effectiveDob,
            gender,
            mobileNumber: normalizedPhone?.e164 || '',
            mobile: normalizedPhone?.e164 || '',
            passwordHash,
            emailVerified: false,
            emailVerifiedAt: null,
            mobileVerified: false,
            accountStatus: 'PENDING_EMAIL_VERIFICATION',
            status: 'PENDING_VERIFICATION',
            profileCompleted: false,
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

        // 6. Generate both a secure link token and a short-lived 6-digit email code.
        // The raw values are never persisted; only SHA-256 hashes are stored.
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const verificationCode = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const codeHash = crypto.createHash('sha256').update(verificationCode).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await this.saveVerificationToken({
            id: `tok_${crypto.randomUUID()}`,
            userId,
            tokenHash: codeHash,
            purpose: 'EMAIL_VERIFICATION',
            expiresAt,
            usedAt: null,
            revokedAt: null,
            requestIp: null,
            createdAt: new Date()
        });

        // Keep the link hash only for backwards-compatible activation links.
        userDoc.verificationTokenHash = tokenHash;
        userDoc.verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        inMemoryUsers.set(normalizedEmail, userDoc);
        inMemoryUsers.set(userId, userDoc);

        // 7. Dispatch verification email with the 6-digit code.
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const activationUrl = `${frontendUrl}/activate-account?token=${rawToken}`;

        try {
            await emailService.sendEmailVerification({
                email: normalizedEmail,
                name: `${fName} ${lName}`.trim(),
                token: rawToken,
                code: verificationCode,
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
                gender,
                age: calculateAge(effectiveDob),
                accountStatus: 'PENDING_EMAIL_VERIFICATION',
                status: 'PENDING_VERIFICATION',
                emailVerified: false,
                profileCompleted: true,
                createdAt
            },
            verification: {
                required: true,
                message: 'A 6-digit verification code has been sent to your email. It expires in 10 minutes.'
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
                    { userId: tokenData.userId, purpose: tokenData.purpose || 'ACCOUNT_ACTIVATION' },
                    { $set: tokenData },
                    { upsert: true, new: true }
                );
            } catch (e) {
                logger.warn('Failed saving EmailVerificationToken to Mongo:', { error: e.message });
            }
        }
        for (const [key, existing] of inMemoryTokens.entries()) {
            if (existing?.userId === tokenData.userId && existing?.purpose === tokenData.purpose) {
                inMemoryTokens.delete(key);
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
        user.accountStatus = 'PROFILE_INCOMPLETE';
        user.status = 'ACTIVE';
        user.profileCompleted = false;
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
            status: 'PROFILE_INCOMPLETE',
            emailVerified: true,
            requiresProfileCompletion: true,
            message: 'Email verified. Please complete your Pharma profile.',
            user: {
                id: user.userId || user.id,
                userId: user.userId || user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                accountStatus: 'PROFILE_INCOMPLETE',
                profileCompleted: false,
                emailVerified: true,
                age: calculateAge(user.dateOfBirth)
            }
        };
    }

    /**
     * Verify the 6-digit email verification code.
     * Successful verification moves the account to PROFILE_INCOMPLETE and
     * returns the restricted onboarding token. No normal session is issued.
     */
    async verifyEmailCode({ email, code }) {
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const normalizedCode = String(code || '').replace(/\D/g, '');

        if (!normalizedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
            const err = new Error('A valid email address is required.');
            err.code = 'INVALID_EMAIL';
            err.status = 400;
            throw err;
        }
        if (!/^\d{6}$/.test(normalizedCode)) {
            const err = new Error('Enter the 6-digit verification code.');
            err.code = 'INVALID_VERIFICATION_CODE';
            err.status = 400;
            throw err;
        }

        const user = await this.findUser({ normalizedEmail });
        if (!user) {
            const err = new Error('Invalid verification code.');
            err.code = 'INVALID_VERIFICATION_CODE';
            err.status = 400;
            throw err;
        }
        if (user.emailVerified && user.accountStatus === 'PROFILE_INCOMPLETE') {
            const token = await this.createOnboardingToken(user);
            return {
                code: 'PROFILE_INCOMPLETE',
                requiresProfileCompletion: true,
                emailVerified: true,
                user: {
                    id: user.userId || user.id,
                    userId: user.userId || user.id,
                    email: user.email,
                    firstName: user.firstName || '',
                    lastName: user.lastName || '',
                    accountStatus: 'PROFILE_INCOMPLETE',
                    profileCompleted: false
                },
                accessToken: token
            };
        }

        const codeHash = crypto.createHash('sha256').update(normalizedCode).digest('hex');
        let verification = null;
        if (getIsConnected()) {
            verification = await EmailVerificationToken.findOne({
                userId: user.userId || user.id,
                purpose: 'EMAIL_VERIFICATION'
            }).lean().exec().catch(() => null);
        }
        if (!verification) {
            for (const candidate of inMemoryTokens.values()) {
                if (candidate.userId === (user.userId || user.id) && candidate.purpose === 'EMAIL_VERIFICATION') {
                    verification = candidate;
                    break;
                }
            }
        }

        if (!verification || verification.revokedAt || verification.usedAt ||
            !verification.expiresAt || new Date(verification.expiresAt) < new Date() ||
            verification.tokenHash !== codeHash) {
            const err = new Error('Invalid or expired verification code.');
            err.code = 'INVALID_VERIFICATION_CODE';
            err.status = 400;
            throw err;
        }

        const now = new Date();
        if (getIsConnected()) {
            await EmailVerificationToken.updateOne(
                { userId: user.userId || user.id, purpose: 'EMAIL_VERIFICATION', usedAt: null },
                { $set: { usedAt: now } }
            ).catch(() => {});
        }
        verification.usedAt = now;
        inMemoryTokens.set(verification.tokenHash, verification);

        user.emailVerified = true;
        user.emailVerifiedAt = now;
        user.accountStatus = 'PROFILE_INCOMPLETE';
        user.status = 'ACTIVE';
        user.profileCompleted = false;
        user.verificationTokenHash = null;
        user.verificationTokenExpiresAt = null;
        await this.saveUser(user.userId || user.id, user);

        const token = await this.createOnboardingToken(user);
        return {
            code: 'PROFILE_INCOMPLETE',
            requiresProfileCompletion: true,
            emailVerified: true,
            message: 'Email verified. Please complete your Pharma profile.',
            user: {
                id: user.userId || user.id,
                userId: user.userId || user.id,
                email: user.email,
                firstName: user.firstName || '',
                lastName: user.lastName || '',
                dateOfBirth: user.dateOfBirth || null,
                mobileNumber: user.mobileNumber || user.mobile || '',
                gender: user.gender || '',
                accountStatus: 'PROFILE_INCOMPLETE',
                profileCompleted: false
            },
            accessToken: token
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

            // Generate a new short-lived 6-digit verification code.
            const rawToken = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
            const verificationCode = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
            const codeHash = crypto.createHash('sha256').update(verificationCode).digest('hex');
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

            await this.saveVerificationToken({
                id: `tok_${crypto.randomUUID()}`,
                userId: user.userId,
                tokenHash: codeHash,
                purpose: 'EMAIL_VERIFICATION',
                expiresAt,
                usedAt: null,
                revokedAt: null,
                requestIp: requestIp || null,
                createdAt: new Date()
            });

            user.verificationTokenHash = tokenHash;
            user.verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await this.saveUser(user.userId, user);

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const activationUrl = `${frontendUrl}/activate-account?token=${rawToken}`;

            try {
                await emailService.sendEmailVerification({
                    email: normalizedEmail,
                    name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                    token: rawToken,
                    code: verificationCode,
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
            message: 'If the account exists and requires verification, a new 6-digit verification code has been sent.'
        };
    }

    assertAccountState(user, { allowProfileIncomplete = false } = {}) {
        const status = user?.accountStatus || user?.status || 'ACTIVE';
        if (['SUSPENDED', 'DISABLED', 'DELETED'].includes(status)) {
            const err = new Error('Your account is suspended or disabled. Please contact support.');
            err.code = status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_DISABLED';
            err.status = 403;
            throw err;
        }
        if (status === 'PENDING_EMAIL_VERIFICATION' || user?.emailVerified === false) {
            const err = new Error('Please verify your email address before logging in.');
            err.code = 'EMAIL_VERIFICATION_REQUIRED';
            err.status = 403;
            err.email = maskEmail(user?.email);
            err.canResendVerification = true;
            throw err;
        }
        if (status === 'PENDING_ACCOUNT_ACTIVATION') {
            const err = new Error('Please activate your Pharma account.');
            err.code = 'ACCOUNT_ACTIVATION_REQUIRED';
            err.status = 403;
            err.email = maskEmail(user?.email);
            err.canResendVerification = true;
            throw err;
        }
        if (status === 'PROFILE_INCOMPLETE' && !allowProfileIncomplete) {
            const err = new Error('Please complete your profile to continue.');
            err.code = 'PROFILE_INCOMPLETE';
            err.status = 403;
            throw err;
        }
        return user;
    }

    async createOnboardingToken(user) {
        const authorization = await authorizationService.resolve({
            ...user,
            tokenType: 'ONBOARDING',
            permissions: ['profile.complete']
        });
        return issuePharmaAccessToken({
            sub: user.id || user.userId,
            email: user.email || '',
            name: user.name || '',
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            accountStatus: 'PROFILE_INCOMPLETE',
            profileCompleted: false,
            role: 'ONBOARDING',
            roles: ['ONBOARDING'],
            permissions: ['profile.complete'],
            permissionVersion: authorization.permissionVersion,
            tenantId: null,
            branchId: null,
            scope: 'ONBOARDING',
            token_type: 'pharma_onboarding',
            expiresIn: '10m'
        });
    }

    async createMfaChallengeToken(user, factorId) {
        return issuePharmaAccessToken({
            sub: user.id || user.userId,
            email: user.email || '',
            role: 'MFA_CHALLENGE',
            roles: ['MFA_CHALLENGE'],
            permissions: ['mfa.verify'],
            scope: 'MFA',
            accountStatus: 'ACTIVE',
            factorId,
            token_type: 'pharma_mfa_challenge',
            expiresIn: '5m'
        });
    }

    async verifyMfaChallenge(challengeToken, code) {
        if (!challengeToken || !code) {
            const err = new Error('MFA challenge token and code are required.');
            err.code = 'CHALLENGE_TOKEN_REQUIRED';
            err.status = 400;
            throw err;
        }
        let payload;
        try {
            ({ payload } = await verifyPharmaAccessToken(challengeToken));
        } catch {
            const err = new Error('MFA challenge expired or invalid. Please sign in again.');
            err.code = 'MFA_EXPIRED';
            err.status = 401;
            throw err;
        }
        if (payload.token_type !== 'pharma_mfa_challenge') {
            const err = new Error('Invalid MFA challenge.');
            err.code = 'MFA_INVALID_CHALLENGE';
            err.status = 401;
            throw err;
        }
        const user = await this.findUser({ userId: payload.sub });
        this.assertAccountState(user);
        const secret = user?.mfaSecretEncrypted ? decryptPII(user.mfaSecretEncrypted) : null;
        if (!secret || !verifyTotpCode(secret, code)) {
            const err = new Error('Invalid 6-digit authenticator code.');
            err.code = 'INVALID_TOTP_CODE';
            err.status = 401;
            throw err;
        }
        const token = await this.createAuthToken(user, 'aal2');
        return { user, accessToken: token };
    }

    async enrollMfa(user) {
        this.assertAccountState(user);
        const secret = generateTotpSecret(20);
        const otpauthUri = buildOtpauthUri({
            issuer: 'Ashvin Pharmacy',
            accountName: user.email,
            secret
        });
        const qrCode = await generateQrCodeDataUrl(otpauthUri);
        pendingMfaEnrollments.set(user.id || user.sub || user.userId, { secret, createdAt: Date.now() });
        return { secret, qrCode, otpauthUri, accountName: user.email, issuer: 'Ashvin Pharmacy' };
    }

    async confirmMfaEnrollment(user, code) {
        const userId = user.id || user.sub || user.userId;
        const storedUser = await this.findUser({ userId });
        this.assertAccountState(storedUser);
        const pending = pendingMfaEnrollments.get(userId);
        if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
            const err = new Error('MFA enrollment session expired. Please start enrollment again.');
            err.code = 'MFA_ENROLLMENT_EXPIRED';
            err.status = 400;
            throw err;
        }
        if (!verifyTotpCode(pending.secret, code)) {
            const err = new Error('Invalid 6-digit code.');
            err.code = 'INVALID_TOTP_CODE';
            err.status = 400;
            throw err;
        }
        await this.saveUser(userId, {
            ...storedUser,
            mfaEnabled: true,
            mfaSecretEncrypted: encryptPII(pending.secret),
            mfaEnrolledAt: new Date()
        });
        pendingMfaEnrollments.delete(userId);
        return { success: true };
    }

    async disableMfa(user) {
        const userId = user.id || user.sub || user.userId;
        const storedUser = await this.findUser({ userId });
        this.assertAccountState(storedUser);
        await this.saveUser(userId, { ...storedUser, mfaEnabled: false, mfaSecretEncrypted: null, mfaEnrolledAt: null });
        return { success: true };
    }

    /**
     * Authenticate credentials and enforce activation status
     */
    async authenticateCredentials({ email, password }) {
        const normalizedEmail = (email || '').trim().toLowerCase();

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

        // 4. One provider-independent account state policy
        this.assertAccountState(user, { allowProfileIncomplete: true });

        // 5. Verification/activation checks are part of assertAccountState.
        // 6. Check if profile completion is required
        if (user.accountStatus === 'PROFILE_INCOMPLETE' || user.profileCompleted === false) {
            const token = await this.createOnboardingToken(user);
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
        if (user.mfaEnabled) {
            return {
                mfaRequired: true,
                factorId: 'local-totp-factor',
                challengeToken: await this.createMfaChallengeToken({ id: user.userId || user.id, email: user.email }, 'local-totp-factor'),
                email: user.email,
                user: { id: user.userId || user.id, email: user.email, role, name: user.name || '' }
            };
        }
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

        if (!googleEmailVerified) {
            const err = new Error('Google email verification is required.');
            err.code = 'INVALID_GOOGLE_IDENTITY';
            err.status = 401;
            throw err;
        }

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
                // Apply account state policy before linking any new identity.
                this.assertAccountState(user, { allowProfileIncomplete: true });
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

        // Every provider uses the same account-state policy before issuing a session.
        this.assertAccountState(user, { allowProfileIncomplete: true });

        // Update last login
        user.lastLoginAt = new Date();
        await this.saveUser(user.userId || user.id, user);

        // Check onboarding / profile status
        if (!user.profileCompleted || user.accountStatus === 'PROFILE_INCOMPLETE') {
            const token = await this.createOnboardingToken(user);
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

        if (user.mfaEnabled) {
            return {
                mfaRequired: true,
                factorId: 'local-totp-factor',
                challengeToken: await this.createMfaChallengeToken({ id: user.userId || user.id, email: user.email }, 'local-totp-factor'),
                email: user.email,
                user: { id: user.userId || user.id, email: user.email, role: user.role || 'customer', name: user.name || '' }
            };
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

        const user = await this.findUser({ userId });
        if (!user) {
            const err = new Error('User not found.');
            err.code = 'USER_NOT_FOUND';
            err.status = 404;
            throw err;
        }

        this.assertAccountState(user, { allowProfileIncomplete: true });

        // Update profile details
        user.firstName = fName;
        user.lastName = lName;
        user.name = `${fName} ${lName}`.trim();
        user.dateOfBirth = dateOfBirth;
        if (normalizedPhone) {
            user.mobileNumber = normalizedPhone.e164;
            user.mobile = normalizedPhone.e164;
        }
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
                mobileNumber: normalizedPhone?.e164 || user.mobileNumber || user.mobile || '',
                accountStatus: 'ACTIVE',
                profileCompleted: true,
                emailVerified: Boolean(user.emailVerified)
            },
            accessToken: token,
            message: 'Profile completed successfully.'
        };
    }

    async requestPasswordReset({ email, requestIp }) {
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const key = normalizedEmail || 'unknown';
        const now = Date.now();
        const attempts = (passwordResetRateLimitMap.get(key) || []).filter(t => now - t < 10 * 60 * 1000);
        if (attempts.length >= 3) {
            const err = new Error('Too many password reset requests. Please try again later.');
            err.code = 'RATE_LIMIT_EXCEEDED';
            err.status = 429;
            throw err;
        }
        attempts.push(now);
        passwordResetRateLimitMap.set(key, attempts);

        const user = normalizedEmail ? await this.findUser({ normalizedEmail }) : null;
        if (user && user.accountStatus === 'ACTIVE' && user.emailVerified) {
            if (getIsConnected()) {
                await EmailVerificationToken.updateMany(
                    { userId: user.userId || user.id, purpose: 'PASSWORD_RESET', usedAt: null, revokedAt: null },
                    { $set: { revokedAt: new Date() } }
                ).catch(() => {});
            }
            for (const t of inMemoryTokens.values()) {
                if (t.userId === (user.userId || user.id) && t.purpose === 'PASSWORD_RESET' && !t.usedAt && !t.revokedAt) {
                    t.revokedAt = new Date();
                }
            }
            const rawToken = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
            await this.saveVerificationToken({
                id: `tok_${crypto.randomUUID()}`,
                userId: user.userId || user.id,
                tokenHash,
                purpose: 'PASSWORD_RESET',
                expiresAt,
                usedAt: null,
                revokedAt: null,
                requestIp: requestIp || null,
                createdAt: new Date()
            });
            if (process.env.NODE_ENV === 'test') {
                const testToken = inMemoryTokens.get(tokenHash);
                if (testToken) testToken.__qaRawToken = rawToken;
            }
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            await emailService.sendPasswordResetEmail({
                email: normalizedEmail,
                name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                token: rawToken,
                resetUrl: `${frontendUrl}/reset-password?token=${encodeURIComponent(rawToken)}`
            });
        }
        return {
            success: true,
            message: 'If an active account exists for this email, a password reset link has been sent.'
        };
    }

    async resetPassword({ token, password }) {
        if (!token || !isStrongPassword(password)) {
            const err = new Error('A valid reset token and strong password are required.');
            err.code = 'INVALID_RESET_REQUEST';
            err.status = 400;
            throw err;
        }
        const tokenHash = crypto.createHash('sha256').update(String(token).trim()).digest('hex');
        const tokenDoc = await this.findVerificationToken(tokenHash);
        if (!tokenDoc || tokenDoc.purpose !== 'PASSWORD_RESET' || tokenDoc.revokedAt || tokenDoc.usedAt) {
            const err = new Error('Invalid or expired password reset token.');
            err.code = 'INVALID_RESET_TOKEN';
            err.status = 400;
            throw err;
        }
        if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt) < new Date()) {
            const err = new Error('Invalid or expired password reset token.');
            err.code = 'RESET_TOKEN_EXPIRED';
            err.status = 410;
            throw err;
        }
        const user = await this.findUser({ userId: tokenDoc.userId });
        if (!user) {
            const err = new Error('Invalid or expired password reset token.');
            err.code = 'INVALID_RESET_TOKEN';
            err.status = 400;
            throw err;
        }
        this.assertAccountState(user, { allowProfileIncomplete: false });
        const passwordHash = await bcrypt.hash(password, 12);
        user.passwordHash = passwordHash;
        user.lastLoginAt = new Date();
        await this.saveUser(user.userId || user.id, user);
        const identity = await this.findIdentity('LOCAL', user.normalizedEmail || user.email?.toLowerCase());
        if (identity) {
            identity.passwordHash = passwordHash;
            await this.saveIdentity(identity);
        }
        tokenDoc.usedAt = new Date();
        await this.saveVerificationToken(tokenDoc);
        const accessToken = await this.createAuthToken(user);
        return {
            success: true,
            user: {
                id: user.userId || user.id,
                userId: user.userId || user.id,
                email: user.email,
                firstName: user.firstName || '',
                lastName: user.lastName || '',
                accountStatus: user.accountStatus || 'ACTIVE',
                profileCompleted: user.profileCompleted !== false,
                role: user.role || 'customer'
            },
            accessToken
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