/**
 * Dedicated Service-Level Authentication & Security Engine
 * Isolates cryptographic hashing, user credential verification,
 * identity lifecycle management, and session token generation.
 * Consumed by API Gateway routers.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import UserProfile from '../../models/UserProfile.js';
import { getIsConnected } from '../../config/db.js';
import { emailService } from '../email-service/EmailService.js';
import { tenantService } from '../tenant-service/TenantService.js';
import { isPlatformSuperAdmin } from '../../shared/contracts/index.js';
import { logger } from '../../shared/observability/logger.js';

const JWT_SECRET = process.env.DEMO_ADMIN_JWT_SECRET
    || process.env.ENCRYPTION_SECRET_KEY
    || 'ashvin-pharmacy-demo-admin-jwt-secret-key-32chars!';
const SIGNING_KEY = new TextEncoder().encode(JWT_SECRET);

// In-memory fallback shadow store
export const inMemoryUsers = new Map();

// Pre-seed demo users in memory
const defaultAdminHash = bcrypt.hashSync('Admin@123', 10);
inMemoryUsers.set('ashvinsingh25@gmail.com', {
    id: 'admin',
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
    status: 'ACTIVE'
});

const defaultCustomerHash = bcrypt.hashSync('Customer@123', 10);
inMemoryUsers.set('customer@ashvinpharma.com', {
    id: 'demo-customer-id',
    userId: 'demo-customer-id',
    name: 'Ashvin Singh',
    firstName: 'Ashvin',
    lastName: 'Singh',
    email: 'customer@ashvinpharma.com',
    normalizedEmail: 'customer@ashvinpharma.com',
    role: 'customer',
    roles: ['customer'],
    passwordHash: defaultCustomerHash,
    emailVerified: true,
    status: 'ACTIVE'
});

export class AuthService {
    /**
     * Locate user by query (MongoDB with in-memory fallback)
     */
    async findUser(query) {
        if (getIsConnected()) {
            try {
                const doc = await UserProfile.findOne(query).lean().exec();
                if (doc) return doc;
            } catch (err) {
                logger.warn('Failed querying UserProfile in Mongo:', { error: err.message });
            }
        }

        if (query.normalizedEmail) {
            return inMemoryUsers.get(query.normalizedEmail.toLowerCase()) || null;
        }
        if (query.userId || query.supabase_user_id || query.id) {
            const uid = query.userId || query.supabase_user_id || query.id;
            for (const u of inMemoryUsers.values()) {
                if (u.id === uid || u.userId === uid || u.supabase_user_id === uid) return u;
            }
        }
        if (query.verificationTokenHash) {
            for (const u of inMemoryUsers.values()) {
                if (u.verificationTokenHash === query.verificationTokenHash) return u;
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
            supabase_user_id: userData.supabase_user_id || userId,
            email: userData.email || normEmail,
            normalizedEmail: normEmail
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

        inMemoryUsers.set(normEmail, doc);
        inMemoryUsers.set(userId, doc);
        return doc;
    }

    /**
     * Create platform JWT session token
     */
    async createAuthToken(user, aal = 'aal1') {
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
     * Verify user credentials and resolve full tenant/membership context
     */
    async authenticateCredentials({ email, password }) {
        const normalizedEmail = (email || '').trim().toLowerCase();

        // 1. Direct Demo Admin Match
        if (normalizedEmail === 'ashvinsingh25@gmail.com' && password === 'Admin@123') {
            const user = {
                id: 'admin',
                userId: 'admin',
                name: 'Ashvin Singh (Admin)',
                firstName: 'Ashvin',
                lastName: 'Singh',
                email: 'ashvinsingh25@gmail.com',
                role: 'SUPER_ADMIN',
                roles: ['SUPER_ADMIN', 'admin'],
                emailVerified: true,
                status: 'ACTIVE'
            };
            const token = await this.createAuthToken(user);
            return {
                user: {
                    ...user,
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
            const user = {
                id: 'demo-customer-id',
                userId: 'demo-customer-id',
                name: 'Ashvin Singh',
                firstName: 'Ashvin',
                lastName: 'Singh',
                email: 'customer@ashvinpharma.com',
                mobile: '+91 95899 16475',
                role: 'customer',
                roles: ['customer'],
                emailVerified: true,
                status: 'ACTIVE'
            };
            const token = await this.createAuthToken(user);
            return {
                user: {
                    ...user,
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
        if (!user || !user.passwordHash) {
            const err = new Error('Invalid email or password.');
            err.code = 'INVALID_CREDENTIALS';
            err.status = 401;
            throw err;
        }

        const validPassword = await bcrypt.compare(password, user.passwordHash);
        if (!validPassword) {
            const err = new Error('Invalid email or password.');
            err.code = 'INVALID_CREDENTIALS';
            err.status = 401;
            throw err;
        }

        if (user.status === 'SUSPENDED' || user.status === 'DISABLED') {
            const err = new Error('Your account is suspended or disabled. Please contact support.');
            err.code = 'FORBIDDEN';
            err.status = 403;
            throw err;
        }

        if (user.emailVerified === false && user.status === 'PENDING_VERIFICATION') {
            const err = new Error('Please verify your email address before logging in.');
            err.code = 'EMAIL_NOT_VERIFIED';
            err.status = 403;
            throw err;
        }

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

        return {
            user: {
                id: user.userId || user.supabase_user_id || user.id,
                firstName: user.firstName || (user.name ? user.name.split(' ')[0] : 'User'),
                lastName: user.lastName || (user.name ? user.name.split(' ').slice(1).join(' ') : ''),
                email: user.email,
                mobile: user.mobile || '',
                emailVerified: Boolean(user.emailVerified),
                status: user.status || 'ACTIVE',
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
     * User Registration with single-use verification token
     */
    async registerUser({ firstName, lastName, email, mobile, password }) {
        const normalizedEmail = email.trim().toLowerCase();
        const existing = await this.findUser({ normalizedEmail });
        if (existing) {
            const err = new Error('An account already exists with this email.');
            err.code = 'EMAIL_ALREADY_EXISTS';
            err.status = 409;
            throw err;
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const rawToken = crypto.randomBytes(32).toString('hex');
        const verificationTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const userId = `usr_${crypto.randomUUID()}`;
        const createdAt = new Date().toISOString();

        await this.saveUser(userId, {
            firstName,
            lastName,
            email: normalizedEmail,
            mobile,
            passwordHash,
            emailVerified: false,
            verificationTokenHash,
            verificationTokenExpiresAt,
            status: 'PENDING_VERIFICATION',
            role: 'customer',
            roles: ['customer'],
            createdAt
        });

        // Dispatch verification email
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const verificationUrl = `${frontendUrl}/verify-email?token=${rawToken}`;

        try {
            await emailService.sendEmailVerification({
                email: normalizedEmail,
                name: `${firstName} ${lastName}`.trim(),
                token: rawToken,
                verificationUrl
            });
        } catch (e) {
            logger.warn('Email dispatch warning on signup:', { error: e.message });
        }

        return {
            user: {
                id: userId,
                firstName,
                lastName,
                email: normalizedEmail,
                mobile,
                emailVerified: false,
                status: 'PENDING_VERIFICATION',
                createdAt
            },
            verification: {
                required: true
            }
        };
    }

    /**
     * Verify email with token
     */
    async verifyEmail(token) {
        if (!token || typeof token !== 'string') {
            const err = new Error('Verification token is required.');
            err.code = 'INVALID_TOKEN';
            err.status = 400;
            throw err;
        }

        const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
        const user = await this.findUser({ verificationTokenHash: tokenHash });

        if (!user) {
            const err = new Error('Invalid or already used email verification token.');
            err.code = 'INVALID_TOKEN';
            err.status = 400;
            throw err;
        }

        if (user.verificationTokenExpiresAt && new Date(user.verificationTokenExpiresAt) < new Date()) {
            const err = new Error('This verification link has expired.');
            err.code = 'TOKEN_EXPIRED';
            err.status = 410;
            throw err;
        }

        user.emailVerified = true;
        user.status = 'ACTIVE';
        user.verificationTokenHash = null;
        user.verificationTokenExpiresAt = null;

        await this.saveUser(user.userId || user.supabase_user_id || user.id, user);

        return {
            id: user.userId || user.supabase_user_id || user.id,
            email: user.email,
            emailVerified: true,
            status: 'ACTIVE'
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

        return {
            user: {
                id: user.id || user.sub,
                firstName,
                lastName,
                email: user.email || '',
                mobile: user.user_metadata?.mobile || user.mobile || '',
                emailVerified: true,
                status: 'ACTIVE',
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
