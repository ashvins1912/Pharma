/**
 * Vendor & Tenant Onboarding Domain Service
 * Manages vendor invitations, cryptographic single-use token lifecycle,
 * and transactional Tenant + Tenant Admin User creation.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import Vendor from '../../models/Vendor.js';
import Tenant from '../../models/Tenant.js';
import TenantMembership from '../../models/TenantMembership.js';
import UserProfile from '../../models/UserProfile.js';
import { getIsConnected } from '../../config/db.js';
import { emailService } from '../email-service/EmailService.js';
import { tenantService } from '../tenant-service/TenantService.js';
import { logger } from '../../shared/observability/logger.js';
import { domainEvents } from '../../shared/events/DomainEvents.js';

export const inMemoryVendors = new Map();

class VendorService {
    /**
     * Create/Invite a Vendor
     */
    async createVendor(vendorData, actor = null) {
        const email = (vendorData.email || '').trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            const err = new Error('A valid email address is required.');
            err.code = 'INVALID_EMAIL';
            err.status = 400;
            throw err;
        }

        const name = (vendorData.name || '').trim();
        const companyName = (vendorData.companyName || vendorData.name || '').trim();
        if (!companyName) {
            const err = new Error('Company name is required.');
            err.code = 'COMPANY_NAME_REQUIRED';
            err.status = 400;
            throw err;
        }

        const vendorId = vendorData.id || `vnd_${crypto.randomUUID().slice(0, 12)}`;

        // Generate 256-bit cryptographically secure token
        const rawToken = crypto.randomBytes(32).toString('hex');
        const onboardingTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const onboardingTokenExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h

        const doc = {
            _id: vendorId,
            id: vendorId,
            name: name || companyName,
            companyName,
            email,
            normalizedEmail: email,
            mobile: (vendorData.mobile || '').trim(),
            address: {
                street: vendorData.address?.street || vendorData.address?.line1 || '',
                city: vendorData.address?.city || '',
                state: vendorData.address?.state || '',
                pincode: vendorData.address?.pincode || ''
            },
            gstNumber: (vendorData.gstNumber || '').trim().toUpperCase(),
            drugLicenseNumber: (vendorData.drugLicenseNumber || '').trim().toUpperCase(),
            status: 'INVITED',
            onboardingStatus: 'PENDING',
            onboardingTokenHash,
            onboardingTokenExpiresAt,
            onboardingCompletedAt: null,
            invitedBy: actor?.userId || actor?.sub || 'platform-super-admin',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        if (getIsConnected()) {
            try {
                await Vendor.findByIdAndUpdate(vendorId, { $set: doc }, { upsert: true, new: true });
            } catch (err) {
                logger.error('Failed to save Vendor in MongoDB:', { error: err.message });
            }
        }

        inMemoryVendors.set(vendorId, doc);
        inMemoryVendors.set(onboardingTokenHash, doc);

        // Dispatch Vendor Onboarding Email via Centralized Email Service
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const onboardingUrl = `${frontendUrl}/vendor-onboarding?token=${rawToken}`;

        try {
            await emailService.sendVendorOnboardingEmail({
                vendor: doc,
                token: rawToken,
                onboardingUrl
            });
        } catch (emailErr) {
            logger.warn('Vendor email dispatch issue (will continue invitation):', { error: emailErr.message });
        }

        logger.info('VENDOR_INVITATION_CREATED', {
            vendorId,
            email,
            companyName,
            expiresAt: onboardingTokenExpiresAt
        });

        return {
            vendor: doc,
            rawToken,
            onboardingUrl
        };
    }

    /**
     * Resend Onboarding Invitation
     */
    async resendOnboardingInvite(vendorId, actor = null) {
        const vendor = await this.getVendorById(vendorId);
        if (!vendor) {
            const err = new Error('Vendor not found.');
            err.code = 'VENDOR_NOT_FOUND';
            err.status = 404;
            throw err;
        }

        if (vendor.onboardingStatus === 'COMPLETED') {
            const err = new Error('Vendor onboarding has already been completed.');
            err.code = 'ONBOARDING_ALREADY_COMPLETED';
            err.status = 409;
            throw err;
        }

        // Invalidate previous token and generate new secure token
        const rawToken = crypto.randomBytes(32).toString('hex');
        const onboardingTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const onboardingTokenExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

        vendor.onboardingTokenHash = onboardingTokenHash;
        vendor.onboardingTokenExpiresAt = onboardingTokenExpiresAt;
        vendor.status = 'INVITED';
        vendor.onboardingStatus = 'PENDING';
        vendor.updatedAt = new Date();

        if (getIsConnected()) {
            try {
                await Vendor.findByIdAndUpdate(vendor._id || vendor.id, {
                    $set: {
                        onboardingTokenHash,
                        onboardingTokenExpiresAt,
                        status: 'INVITED',
                        onboardingStatus: 'PENDING',
                        updatedAt: new Date()
                    }
                });
            } catch (err) {
                logger.error('Failed to update Vendor token in MongoDB:', { error: err.message });
            }
        }

        inMemoryVendors.set(vendor._id || vendor.id, vendor);
        inMemoryVendors.set(onboardingTokenHash, vendor);

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const onboardingUrl = `${frontendUrl}/vendor-onboarding?token=${rawToken}`;

        await emailService.sendVendorOnboardingEmail({
            vendor,
            token: rawToken,
            onboardingUrl
        });

        logger.info('VENDOR_ONBOARDING_RESENT', { vendorId, email: vendor.email });

        return {
            vendorId: vendor._id || vendor.id,
            invitationStatus: 'SENT',
            expiresAt: onboardingTokenExpiresAt.toISOString()
        };
    }

    /**
     * Get vendor by ID
     */
    async getVendorById(vendorId) {
        if (getIsConnected()) {
            try {
                const found = await Vendor.findById(vendorId).lean();
                if (found) return found;
            } catch (err) {
                logger.warn('Failed to query Vendor by ID:', { error: err.message });
            }
        }
        return inMemoryVendors.get(vendorId) || null;
    }

    /**
     * List all vendors (with optional status filter)
     */
    async getVendors(filter = {}) {
        if (getIsConnected()) {
            try {
                const query = {};
                if (filter.status) query.status = filter.status;
                if (filter.onboardingStatus) query.onboardingStatus = filter.onboardingStatus;
                return await Vendor.find(query).sort({ createdAt: -1 }).lean();
            } catch (err) {
                logger.warn('Failed to query Vendors list:', { error: err.message });
            }
        }
        let list = Array.from(inMemoryVendors.values()).filter(v => v._id && v._id.startsWith('vnd_'));
        if (filter.status) list = list.filter(v => v.status === filter.status);
        if (filter.onboardingStatus) list = list.filter(v => v.onboardingStatus === filter.onboardingStatus);
        return list;
    }

    /**
     * Fetch onboarding details using raw token
     * Validates hash and expiry, returns only safe required fields
     */
    async getOnboardingDetails(rawToken) {
        if (!rawToken || typeof rawToken !== 'string') {
            const err = new Error('The onboarding link is invalid or has expired.');
            err.code = 'INVALID_ONBOARDING_TOKEN';
            err.status = 401;
            throw err;
        }

        const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');

        let vendor = null;
        if (getIsConnected()) {
            try {
                vendor = await Vendor.findOne({ onboardingTokenHash: tokenHash }).lean();
            } catch (err) {
                logger.warn('Failed to find vendor by token hash in Mongo:', { error: err.message });
            }
        }

        if (!vendor) {
            vendor = inMemoryVendors.get(tokenHash) || null;
        }

        if (!vendor) {
            const err = new Error('The onboarding link is invalid or has expired.');
            err.code = 'INVALID_ONBOARDING_TOKEN';
            err.status = 401;
            throw err;
        }

        if (vendor.onboardingStatus === 'COMPLETED') {
            const err = new Error('Vendor onboarding has already been completed.');
            err.code = 'ONBOARDING_ALREADY_COMPLETED';
            err.status = 409;
            throw err;
        }

        if (vendor.onboardingTokenExpiresAt && new Date(vendor.onboardingTokenExpiresAt) < new Date()) {
            const err = new Error('The onboarding link is invalid or has expired.');
            err.code = 'INVALID_ONBOARDING_TOKEN';
            err.status = 401;
            throw err;
        }

        return {
            onboarding: {
                status: vendor.onboardingStatus,
                expiresAt: vendor.onboardingTokenExpiresAt ? new Date(vendor.onboardingTokenExpiresAt).toISOString() : null
            },
            vendor: {
                name: vendor.name,
                companyName: vendor.companyName,
                email: vendor.email,
                mobile: vendor.mobile || null,
                gstNumber: vendor.gstNumber || null,
                address: {
                    line1: vendor.address?.street || null,
                    line2: null,
                    city: vendor.address?.city || null,
                    state: vendor.address?.state || null,
                    pincode: vendor.address?.pincode || null
                }
            },
            requiredFields: [
                'firstName',
                'lastName',
                'mobile',
                'password',
                'companyName',
                'address'
            ]
        };
    }

    /**
     * Complete Vendor Onboarding
     * Transactionally creates Tenant, User, TenantMembership, and marks Onboarding COMPLETED
     */
    async completeOnboarding(rawToken, submission) {
        if (!rawToken || typeof rawToken !== 'string') {
            const err = new Error('The onboarding link is invalid or has expired.');
            err.code = 'INVALID_ONBOARDING_TOKEN';
            err.status = 401;
            throw err;
        }

        const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');

        let vendor = null;
        if (getIsConnected()) {
            try {
                vendor = await Vendor.findOne({ onboardingTokenHash: tokenHash });
            } catch (err) {
                logger.warn('Failed to query vendor for completion in Mongo:', { error: err.message });
            }
        }
        if (!vendor) {
            vendor = inMemoryVendors.get(tokenHash) || null;
        }

        if (!vendor) {
            const err = new Error('The onboarding link is invalid or has expired.');
            err.code = 'INVALID_ONBOARDING_TOKEN';
            err.status = 401;
            throw err;
        }

        if (vendor.onboardingStatus === 'COMPLETED') {
            const err = new Error('Vendor onboarding has already been completed.');
            err.code = 'ONBOARDING_ALREADY_COMPLETED';
            err.status = 409;
            throw err;
        }

        if (vendor.onboardingTokenExpiresAt && new Date(vendor.onboardingTokenExpiresAt) < new Date()) {
            const err = new Error('The onboarding link is invalid or has expired.');
            err.code = 'INVALID_ONBOARDING_TOKEN';
            err.status = 401;
            throw err;
        }

        // Validate submission inputs
        const validationDetails = [];
        const firstName = (submission.firstName || '').trim();
        const lastName = (submission.lastName || '').trim();
        const mobile = (submission.mobile || vendor.mobile || '').trim();
        const password = submission.password || '';

        if (!firstName) {
            validationDetails.push({ field: 'firstName', code: 'REQUIRED', message: 'First name is required.' });
        }
        if (!lastName) {
            validationDetails.push({ field: 'lastName', code: 'REQUIRED', message: 'Last name is required.' });
        }
        if (!mobile || mobile.replace(/\D/g, '').length < 10) {
            validationDetails.push({ field: 'mobile', code: 'INVALID_MOBILE', message: 'Enter a valid mobile number.' });
        }
        if (!password || password.length < 8) {
            validationDetails.push({ field: 'password', code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters long.' });
        } else if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
            validationDetails.push({ field: 'password', code: 'WEAK_PASSWORD', message: 'Password must meet security requirements (uppercase, lowercase, number).' });
        }

        const companyName = (submission.company?.companyName || submission.companyName || vendor.companyName || '').trim();
        if (!companyName) {
            validationDetails.push({ field: 'companyName', code: 'REQUIRED', message: 'Company name is required.' });
        }

        if (validationDetails.length > 0) {
            const err = new Error('Please correct the highlighted fields.');
            err.code = 'VALIDATION_ERROR';
            err.status = 400;
            err.details = validationDetails;
            throw err;
        }

        // Begin Onboarding Completion Transaction
        const vendorEmail = vendor.email.toLowerCase().trim();
        const fullName = `${firstName} ${lastName}`.trim();
        const passwordHash = await bcrypt.hash(password, 12);

        // 1. Create or link Tenant
        const baseSlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pharmacy';
        let tenantSlug = baseSlug;
        const tenantId = `tenant_${crypto.randomUUID().slice(0, 10)}`;

        // Verify slug uniqueness
        const existingTenant = await tenantService.getTenantBySlug(tenantSlug);
        if (existingTenant) {
            tenantSlug = `${baseSlug}-${crypto.randomUUID().slice(0, 5)}`;
        }

        const tenantDoc = {
            _id: tenantId,
            id: tenantId,
            name: companyName,
            slug: tenantSlug,
            legalName: companyName,
            code: (companyName.replace(/[^a-zA-Z]/g, '').slice(0, 6) || 'PHARM').toUpperCase(),
            status: 'ACTIVE',
            contactEmail: vendorEmail,
            contactPhone: mobile,
            timezone: 'Asia/Kolkata',
            currency: 'INR',
            settings: {
                allowOfferWithCoupon: false,
                allowCouponWithRewards: true,
                allowOfferWithRewards: false
            }
        };

        // 2. Create or link User
        const userId = `usr_${crypto.randomUUID()}`;
        const userDoc = {
            supabase_user_id: userId,
            userId,
            name: fullName,
            firstName,
            lastName,
            email: vendorEmail,
            normalizedEmail: vendorEmail,
            mobile,
            passwordHash,
            emailVerified: true,
            status: 'ACTIVE',
            role: 'TENANT_ADMIN',
            roles: ['TENANT_ADMIN'],
            tenantId
        };

        // 3. Create Tenant Membership
        const membershipId = `mem_${crypto.randomUUID()}`;
        const membershipDoc = {
            _id: membershipId,
            id: membershipId,
            userId,
            tenantId,
            branchId: null,
            role: 'TENANT_ADMIN',
            permissions: [
                'inventory.read',
                'inventory.write',
                'orders.read',
                'orders.write',
                'admin.all'
            ],
            status: 'ACTIVE'
        };

        // Commit records to MongoDB
        if (getIsConnected()) {
            const session = await mongoose.startSession().catch(() => null);
            try {
                if (session) {
                    session.startTransaction();
                    await Tenant.create([tenantDoc], { session });
                    await UserProfile.findOneAndUpdate(
                        { normalizedEmail: vendorEmail },
                        { $set: userDoc },
                        { upsert: true, new: true, session }
                    );
                    await TenantMembership.create([membershipDoc], { session });
                    await Vendor.findByIdAndUpdate(vendor._id || vendor.id, {
                        $set: {
                            tenantId,
                            userId,
                            status: 'ACTIVE',
                            onboardingStatus: 'COMPLETED',
                            onboardingCompletedAt: new Date(),
                            onboardingTokenHash: null,
                            onboardingTokenExpiresAt: null,
                            updatedAt: new Date()
                        }
                    }, { session });
                    await session.commitTransaction();
                } else {
                    // Fallback to sequential updates
                    await Tenant.create(tenantDoc);
                    await UserProfile.findOneAndUpdate(
                        { normalizedEmail: vendorEmail },
                        { $set: userDoc },
                        { upsert: true, new: true }
                    );
                    await TenantMembership.create(membershipDoc);
                    await Vendor.findByIdAndUpdate(vendor._id || vendor.id, {
                        $set: {
                            tenantId,
                            userId,
                            status: 'ACTIVE',
                            onboardingStatus: 'COMPLETED',
                            onboardingCompletedAt: new Date(),
                            onboardingTokenHash: null,
                            onboardingTokenExpiresAt: null,
                            updatedAt: new Date()
                        }
                    });
                }
            } catch (txErr) {
                if (session) await session.abortTransaction().catch(() => {});
                logger.error('Transaction failed during vendor onboarding completion:', { error: txErr.message });
                const err = new Error('This onboarding request could not be completed because the account has already been processed or encountered a conflict.');
                err.code = 'ONBOARDING_CONFLICT';
                err.status = 409;
                throw err;
            } finally {
                if (session) session.endSession();
            }
        }

        // Update in-memory collections
        vendor.tenantId = tenantId;
        vendor.userId = userId;
        vendor.status = 'ACTIVE';
        vendor.onboardingStatus = 'COMPLETED';
        vendor.onboardingCompletedAt = new Date();
        vendor.onboardingTokenHash = null;
        vendor.onboardingTokenExpiresAt = null;

        inMemoryVendors.set(vendor._id || vendor.id, vendor);
        inMemoryVendors.delete(tokenHash);

        // Register in TenantService
        await tenantService.createTenant(tenantDoc);
        await tenantService.assignMembership(userId, tenantId, null, 'TENANT_ADMIN', membershipDoc.permissions);

        const completedAtIso = new Date().toISOString();

        // Dispatch post-transaction success email (failure must not rollback tenant)
        try {
            await emailService._dispatchEmail({
                to: vendorEmail,
                subject: 'Vendor Onboarding Completed - Ashvin Pharmacy',
                html: `
                <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
                  <h2 style="color: #0d9488;">🎉 Vendor Onboarding Completed</h2>
                  <p>Hello ${fullName},</p>
                  <p>Your pharmacy vendor onboarding for <strong>${companyName}</strong> has been successfully completed!</p>
                  <p>Your tenant account is now <strong>ACTIVE</strong>. You can now log into your Tenant Admin Dashboard.</p>
                  <div style="margin: 20px 0;">
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" style="background: #0d9488; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold;">Log in to Dashboard</a>
                  </div>
                  <p style="font-size: 12px; color: #64748b;">Ashvin Pharmacy Multi-Tenant Architecture</p>
                </div>
                `,
                eventType: 'VENDOR_ONBOARDING_COMPLETED',
                meta: { email: vendorEmail, tenantId }
            });
        } catch (emailErr) {
            logger.warn('Post-onboarding confirmation email note (tenant safely created):', { error: emailErr.message });
        }

        domainEvents.emitDomainEvent('VENDOR_ONBOARDING_COMPLETED', vendor._id || vendor.id, { tenantId, userId }, null, tenantId);
        logger.info('VENDOR_ONBOARDING_SUCCESS', { vendorId: vendor._id || vendor.id, tenantId, userId });

        return {
            onboarding: {
                status: 'COMPLETED',
                completedAt: completedAtIso
            },
            tenant: {
                id: tenantId,
                name: companyName,
                slug: tenantSlug,
                status: 'ACTIVE'
            },
            user: {
                id: userId,
                firstName,
                lastName,
                email: vendorEmail,
                emailVerified: true,
                status: 'ACTIVE'
            },
            membership: {
                id: membershipId,
                role: 'TENANT_ADMIN',
                status: 'ACTIVE'
            }
        };
    }
}

export const vendorService = new VendorService();
export default vendorService;
