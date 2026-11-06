/**
 * Tenant & Branch Management Domain Service
 */
import crypto from 'node:crypto';
import { domainEvents } from '../../shared/events/DomainEvents.js';
import { logger } from '../../shared/observability/logger.js';
import { registerMembership } from '../../middleware/context.js';
import { TenantRoles, PlatformRoles } from '../../shared/contracts/index.js';
import Tenant from '../../models/Tenant.js';
import TenantBranch from '../../models/TenantBranch.js';
import TenantMembership from '../../models/TenantMembership.js';
import { getIsConnected } from '../../config/db.js';

export class TenantService {
    constructor() {
        this.tenants = new Map();
        this.branches = new Map();
        this.memberships = new Map();
        this._seedDefaults();
    }

    _seedDefaults() {
        // Tenant 1: Ashvin Central Pharmacy
        const tenant1 = {
            id: 'tenant-ashvin-main',
            name: 'Ashvin Central Pharmacy',
            slug: 'ashvin-central',
            legalName: 'Ashvin Healthcare Private Limited',
            code: 'ASHVIN-HQ',
            phone: '+91 95899 16475',
            email: 'care@ashvinpharmacy.com',
            contactEmail: 'care@ashvinpharmacy.com',
            contactPhone: '+91 95899 16475',
            status: 'ACTIVE',
            timezone: 'Asia/Kolkata',
            currency: 'INR',
            settings: {
                allowOfferWithCoupon: false,
                allowCouponWithRewards: true,
                allowOfferWithRewards: false
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.tenants.set(tenant1.id, tenant1);

        // Branch 1.1: Indore Central (Palasia)
        const branch1_1 = {
            id: 'branch-indore-central',
            tenantId: tenant1.id,
            name: 'Indore Central (Old Palasia)',
            code: 'IND-01',
            phone: '+91 95899 16475',
            email: 'palasia@ashvinpharmacy.com',
            address: {
                street: '14/2 South Tukoganj, Old Palasia',
                city: 'Indore',
                state: 'Madhya Pradesh',
                pincode: '452001',
                coordinates: { lat: 22.7196, lng: 75.8577 }
            },
            serviceRadiusKm: 12.0,
            deliveryMode: 'OWN_RIDER',
            minimumOrderValue: 149,
            freeDeliveryAbove: 499,
            deliveryFee: 30,
            operatingHours: { open: '08:00', close: '23:00' },
            status: 'ACTIVE',
            createdAt: new Date().toISOString()
        };
        this.branches.set(branch1_1.id, branch1_1);

        // Branch 1.2: Vijay Nagar Express
        const branch1_2 = {
            id: 'branch-indore-vijaynagar',
            tenantId: tenant1.id,
            name: 'Vijay Nagar Express Dispensary',
            code: 'IND-02',
            phone: '+91 98260 12345',
            email: 'vijaynagar@ashvinpharmacy.com',
            address: {
                street: 'Plot 42, Scheme 54, PU-4 Commercial, Vijay Nagar',
                city: 'Indore',
                state: 'Madhya Pradesh',
                pincode: '452010',
                coordinates: { lat: 22.7533, lng: 75.8937 }
            },
            serviceRadiusKm: 8.0,
            deliveryMode: 'OWN_RIDER',
            minimumOrderValue: 199,
            freeDeliveryAbove: 599,
            deliveryFee: 35,
            operatingHours: { open: '09:00', close: '22:00' },
            status: 'ACTIVE',
            createdAt: new Date().toISOString()
        };
        this.branches.set(branch1_2.id, branch1_2);

        // Tenant 2: MedPlus Partner Pharmacy (Demonstrating multi-tenancy)
        const tenant2 = {
            id: 'tenant-medplus-partner',
            name: 'MedPlus Express Pharmacy',
            slug: 'medplus-express',
            legalName: 'MedPlus Healthcare MP LLP',
            code: 'MEDPLUS-MP',
            phone: '+91 75524 56789',
            email: 'support@medplus-partner.in',
            contactEmail: 'support@medplus-partner.in',
            contactPhone: '+91 75524 56789',
            status: 'ACTIVE',
            timezone: 'Asia/Kolkata',
            currency: 'INR',
            settings: {
                allowOfferWithCoupon: true,
                allowCouponWithRewards: false,
                allowOfferWithRewards: false
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.tenants.set(tenant2.id, tenant2);

        const branch2_1 = {
            id: 'branch-bhopal-mpnagar',
            tenantId: tenant2.id,
            name: 'Bhopal MP Nagar Branch',
            code: 'BPL-01',
            phone: '+91 75524 56789',
            email: 'bhopal.mpnagar@medplus-partner.in',
            address: {
                street: 'Zone II, Maharana Pratap Nagar',
                city: 'Bhopal',
                state: 'Madhya Pradesh',
                pincode: '462011',
                coordinates: { lat: 23.2332, lng: 77.4343 }
            },
            serviceRadiusKm: 10.0,
            deliveryMode: 'OWN_RIDER',
            minimumOrderValue: 199,
            freeDeliveryAbove: 499,
            deliveryFee: 40,
            operatingHours: { open: '08:30', close: '22:30' },
            status: 'ACTIVE',
            createdAt: new Date().toISOString()
        };
        this.branches.set(branch2_1.id, branch2_1);

        // Seed demo admin memberships
        const demoAdminUserId = 'demo-admin-id';
        const m1 = {
            id: 'mem-admin-ashvin',
            userId: demoAdminUserId,
            tenantId: tenant1.id,
            branchId: null, // Full tenant admin
            role: TenantRoles.TENANT_OWNER,
            permissions: ['*'],
            status: 'ACTIVE',
            createdAt: new Date().toISOString()
        };
        this.memberships.set(`${demoAdminUserId}:${tenant1.id}`, m1);
        registerMembership(m1);

        const m2 = {
            id: 'mem-admin-medplus',
            userId: demoAdminUserId,
            tenantId: tenant2.id,
            branchId: null,
            role: TenantRoles.TENANT_ADMIN,
            permissions: ['*'],
            status: 'ACTIVE',
            createdAt: new Date().toISOString()
        };
        this.memberships.set(`${demoAdminUserId}:${tenant2.id}`, m2);
        registerMembership(m2);
    }

    async getTenants(filter = {}) {
        const search = String(filter.search || '').trim();
        if (search && search.length < 2) {
            const error = new Error('Enter at least 2 characters to search tenants.');
            error.statusCode = 400;
            throw error;
        }
        const limit = filter.limit == null ? null : Math.min(50, Math.max(1, Number(filter.limit) || 5));
        const sortRecent = filter.sort === 'recent' || filter.sort === 'createdAt';
        const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (getIsConnected()) {
            const query = {};
            if (filter.status) query.status = filter.status;
            if (search) {
                const pattern = new RegExp(escapeRegex(search), 'i');
                const fields = [
                    { name: pattern }, { legalName: pattern }, { slug: pattern },
                    { code: pattern }, { contactEmail: pattern }, { contactPhone: pattern }
                ];
                const idMatch = { _id: new RegExp(escapeRegex(search), 'i') };
                query.$or = [...fields, idMatch];
            }
            let cursor = Tenant.find(query);
            if (sortRecent) cursor = cursor.sort({ createdAt: -1, _id: -1 });
            if (limit) cursor = cursor.limit(limit);
            const dbTenants = await cursor.lean();
            return dbTenants.map(t => ({ id: String(t._id), ...t }));
        }
        let list = Array.from(this.tenants.values());
        if (filter.status) list = list.filter(t => t.status === filter.status);
        if (search) {
            const needle = search.toLowerCase();
            list = list.filter(t => [t.name, t.legalName, t.slug, t.code, t.contactEmail, t.contactPhone, t.id]
                .some(value => String(value || '').toLowerCase().includes(needle)));
        }
        if (sortRecent) list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        if (limit) list = list.slice(0, limit);
        return list;
    }

    async getTenantById(tenantId) {
        if (!tenantId) return null;
        if (getIsConnected()) {
            const dbTenant = await Tenant.findById(String(tenantId)).lean();
            return dbTenant ? { id: String(dbTenant._id), ...dbTenant } : null;
        }
        return this.tenants.get(String(tenantId)) || null;
    }

    async getTenantBySlug(slug) {
        if (!slug) return null;
        const normalizedSlug = String(slug).trim().toLowerCase();
        if (getIsConnected()) {
            try {
                const dbTenant = await Tenant.findOne({ slug: normalizedSlug }).lean();
                if (dbTenant) return { id: dbTenant._id, ...dbTenant };
            } catch (err) {
                logger.warn('Failed to fetch Tenant by slug from MongoDB', { error: err.message });
            }
        }
        return Array.from(this.tenants.values()).find(t => t.slug === normalizedSlug) || null;
    }

    async createTenant(data, actor = null) {
        if (!data?.name) {
            throw new Error('Tenant name is required.');
        }

        const id = data.id || `tenant-${Date.now()}`;
        const slug = (data.slug || data.name)
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        if (!slug) {
            throw new Error('A valid alphanumeric slug is required.');
        }

        // Verify slug uniqueness
        const existing = await this.getTenantBySlug(slug);
        if (existing && existing.id !== id) {
            throw new Error(`Tenant slug "${slug}" is already in use.`);
        }

        const newTenant = {
            id,
            name: data.name.trim(),
            slug,
            legalName: data.legalName || data.name,
            code: (data.code || data.name.toUpperCase().replace(/[^A-Z0-9]/g, '')).slice(0, 12),
            phone: data.contactPhone || data.phone || '',
            email: data.contactEmail || data.email || '',
            contactEmail: data.contactEmail || data.email || '',
            contactPhone: data.contactPhone || data.phone || '',
            usesTenantAsBranch: data.usesTenantAsBranch === true,
            geolocation: { latitude, longitude },
            status: data.status || 'ACTIVE',
            timezone: data.timezone || 'Asia/Kolkata',
            currency: data.currency || 'INR',
            settings: {
                allowOfferWithCoupon: Boolean(data.settings?.allowOfferWithCoupon),
                allowCouponWithRewards: data.settings?.allowCouponWithRewards !== false,
                allowOfferWithRewards: Boolean(data.settings?.allowOfferWithRewards),
                ...(data.settings || {})
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        if (getIsConnected()) {
            try {
                await Tenant.create({
                    _id: id,
                    name: newTenant.name,
                    slug: newTenant.slug,
                    legalName: newTenant.legalName,
                    code: newTenant.code,
                    contactEmail: newTenant.contactEmail,
                    contactPhone: newTenant.contactPhone,
                    usesTenantAsBranch: newTenant.usesTenantAsBranch,
                    geolocation: newTenant.geolocation,
                    status: newTenant.status,
                    timezone: newTenant.timezone,
                    currency: newTenant.currency,
                    settings: newTenant.settings
                });
            } catch (err) {
                logger.warn('Could not persist Tenant to MongoDB, retained in memory', { error: err.message });
            }
        }

        this.tenants.set(id, newTenant);
        domainEvents.emitDomainEvent('TENANT_CREATED', id, newTenant, actor, id);
        logger.info(`New tenant onboarded: ${newTenant.name}`, { tenantId: id, slug });
        return newTenant;
    }

    async updateTenant(tenantId, updates, actor = null) {
        const tenant = await this.getTenantById(tenantId);
        if (!tenant) throw new Error('Tenant not found');

        let newSlug = tenant.slug;
        if (updates.slug && updates.slug !== tenant.slug) {
            newSlug = updates.slug.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            const existingSlug = await this.getTenantBySlug(newSlug);
            if (existingSlug && existingSlug.id !== tenantId) {
                throw new Error(`Tenant slug "${newSlug}" is already in use.`);
            }
        }

        const updated = {
            ...tenant,
            ...updates,
            slug: newSlug,
            name: updates.name ? updates.name.trim() : tenant.name,
            contactEmail: updates.contactEmail !== undefined ? updates.contactEmail : tenant.contactEmail,
            contactPhone: updates.contactPhone !== undefined ? updates.contactPhone : tenant.contactPhone,
            geolocation: updates.geolocation !== undefined ? updates.geolocation : tenant.geolocation,
            usesTenantAsBranch: updates.usesTenantAsBranch !== undefined ? updates.usesTenantAsBranch : tenant.usesTenantAsBranch,
            settings: { ...tenant.settings, ...(updates.settings || {}) },
            updatedAt: new Date().toISOString()
        };

        if (getIsConnected()) {
            try {
                await Tenant.findByIdAndUpdate(tenantId, {
                    name: updated.name,
                    slug: updated.slug,
                    legalName: updated.legalName,
                    code: updated.code,
                    status: updated.status,
                    contactEmail: updated.contactEmail,
                    contactPhone: updated.contactPhone,
                    geolocation: updated.geolocation,
                    usesTenantAsBranch: updated.usesTenantAsBranch,
                    timezone: updated.timezone,
                    currency: updated.currency,
                    settings: updated.settings
                });
            } catch (err) {
                logger.warn('Could not update Tenant in MongoDB', { error: err.message });
            }
        }

        this.tenants.set(tenantId, updated);
        domainEvents.emitDomainEvent('TENANT_UPDATED', tenantId, updated, actor, tenantId);
        return updated;
    }

    async suspendTenant(tenantId, actor = null) {
        return this.updateTenant(tenantId, { status: 'SUSPENDED' }, actor);
    }

    async activateTenant(tenantId, actor = null) {
        return this.updateTenant(tenantId, { status: 'ACTIVE' }, actor);
    }

    async getBranches(tenantId, filter = {}) {
        const normalizedTenantId = String(tenantId || '').trim();
        if (!normalizedTenantId) return [];

        // In production, the database is the source of truth. The in-memory
        // seed map is only for disconnected local/demo mode and must never
        // leak demo branches into a real tenant's branch selector.
        if (getIsConnected()) {
            const query = { tenantId: normalizedTenantId };
            if (filter.status) query.status = filter.status;
            const persisted = await TenantBranch.find(query).lean();
            return persisted.map(branch => ({
                ...branch,
                id: String(branch._id)
            }));
        }

        let list = Array.from(this.branches.values())
            .filter(branch => branch.tenantId === normalizedTenantId);
        if (filter.status) list = list.filter(branch => branch.status === filter.status);
        return list;
    }

    async getAllActiveBranches() {
        // Production branch discovery must read the persisted directory, not
        // the in-memory demo seed map. Otherwise real tenants created in MongoDB
        // appear to have no branches on the public sign-in/storefront screen.
        if (getIsConnected()) {
            const persisted = await TenantBranch.find({ status: 'ACTIVE' })
                .sort({ tenantId: 1, name: 1, _id: 1 })
                .lean();
            return persisted.map(branch => ({
                ...branch,
                id: String(branch._id)
            }));
        }

        return Array.from(this.branches.values())
            .filter(branch => branch.status === 'ACTIVE');
    }

    async getBranchById(branchId) {
        const id = String(branchId || '').trim();
        if (!id) return null;
        if (getIsConnected()) {
            const persisted = await TenantBranch.findById(id).lean();
            if (persisted) {
                const branch = { ...persisted, id: persisted._id };
                this.branches.set(id, branch);
                return branch;
            }
            const seeded = this.branches.get(id);
            if (!seeded) return null;
            const branchData = { ...seeded };
            delete branchData.id;
            delete branchData._id;
            const created = await TenantBranch.findOneAndUpdate(
                { _id: id },
                { $setOnInsert: { ...branchData, tenantId: String(seeded.tenantId) } },
                { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
            ).lean();
            const branch = { ...created, id: created._id };
            this.branches.set(id, branch);
            return branch;
        }
        return this.branches.get(id) || null;
    }

    async createBranch(tenantId, data, actor = null) {
        const tenant = await this.getTenantById(tenantId);
        if (!tenant) throw new Error('Tenant not found');

        const name = String(data.name || '').trim();
        const code = String(data.code || '').trim().toUpperCase();
        const phone = String(data.phone || '').trim();
        const email = String(data.email || '').trim().toLowerCase();
        const latitude = data.geolocation?.latitude === '' || data.geolocation?.latitude == null ? null : Number(data.geolocation.latitude);
        const longitude = data.geolocation?.longitude === '' || data.geolocation?.longitude == null ? null : Number(data.geolocation.longitude);
        if (name.length < 2 || name.length > 120) {
            const error = new Error('Branch name must be between 2 and 120 characters.'); error.statusCode = 400; error.code = 'BRANCH_VALIDATION_FAILED'; throw error;
        }
        if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code)) {
            const error = new Error('Branch code must be 2-20 characters using letters, numbers, hyphens or underscores.'); error.statusCode = 400; error.code = 'BRANCH_VALIDATION_FAILED'; throw error;
        }
        if (phone && (!/^\+?[0-9 ()-]{7,20}$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15)) {
            const error = new Error('Enter a valid branch contact number.'); error.statusCode = 400; error.code = 'BRANCH_VALIDATION_FAILED'; throw error;
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            const error = new Error('Enter a valid branch contact email.'); error.statusCode = 400; error.code = 'BRANCH_VALIDATION_FAILED'; throw error;
        }
        if ((latitude == null) !== (longitude == null)
            || (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
            || (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
            const error = new Error('Provide both valid branch latitude and longitude coordinates.'); error.statusCode = 400; error.code = 'BRANCH_VALIDATION_FAILED'; throw error;
        }
        const existing = getIsConnected()
            ? await TenantBranch.findOne({ tenantId: String(tenantId), code }).select('_id').lean()
            : Array.from(this.branches.values()).find(item => String(item.tenantId) === String(tenantId) && String(item.code).toUpperCase() === code);
        if (existing) {
            const error = new Error('This branch code is already used by your pharmacy.'); error.statusCode = 409; error.code = 'BRANCH_CODE_EXISTS'; throw error;
        }
        const id = data.id || `branch-${crypto.randomUUID()}`;
        const newBranch = {
            id,
            tenantId: String(tenantId),
            name,
            code,
            phone: phone || tenant.phone,
            email: email || tenant.email,
            geolocation: { latitude, longitude },
            address: {
                street: data.address?.street || '',
                city: data.address?.city || '',
                state: data.address?.state || '',
                pincode: data.address?.pincode || '',
                ...(data.address?.coordinates ? { coordinates: data.address.coordinates } : {})
            },
            serviceRadiusKm: Number.isFinite(Number(data.serviceRadiusKm)) && Number(data.serviceRadiusKm) >= 0 ? Number(data.serviceRadiusKm) : 10.0,
            deliveryMode: data.deliveryMode || 'OWN_RIDER',
            minimumOrderValue: Number.isFinite(Number(data.minimumOrderValue)) && Number(data.minimumOrderValue) >= 0 ? Number(data.minimumOrderValue) : 149,
            freeDeliveryAbove: Number.isFinite(Number(data.freeDeliveryAbove)) && Number(data.freeDeliveryAbove) >= 0 ? Number(data.freeDeliveryAbove) : 499,
            deliveryFee: Number.isFinite(Number(data.deliveryFee)) && Number(data.deliveryFee) >= 0 ? Number(data.deliveryFee) : 30,
            operatingHours: data.operatingHours || { open: '08:00', close: '22:00' },
            status: 'PENDING',
            activatedAt: null,
            makeDefaultOnActivation: Boolean(data.isDefault),
            isDefault: false,
            isTenantLocation: Boolean(data.isTenantLocation),
            createdAt: new Date().toISOString()
        };
        if (getIsConnected()) {
            const persisted = await TenantBranch.create({ _id: id, ...newBranch });
            Object.assign(newBranch, persisted.toObject(), { id });
        }
        this.branches.set(id, newBranch);
        domainEvents.emitDomainEvent('BRANCH_CREATED', id, newBranch, actor, tenantId, id);
        return newBranch;
    }

    async activateBranch(branchId, tenantId, actor = null) {
        const branch = await this.getBranchById(branchId);
        if (!branch || String(branch.tenantId) !== String(tenantId)) {
            const error = new Error('Branch not found for this pharmacy.');
            error.statusCode = 404;
            error.code = 'BRANCH_NOT_FOUND';
            throw error;
        }
        if (branch.status === 'ACTIVE') return branch;
        if (branch.status !== 'PENDING') {
            const error = new Error('Only a pending branch can be activated.');
            error.statusCode = 409;
            error.code = 'BRANCH_NOT_PENDING';
            throw error;
        }
        const activatedAt = new Date();
        let updated = { ...branch, status: 'ACTIVE', activatedAt, updatedAt: activatedAt };
        if (getIsConnected()) {
            const persisted = await TenantBranch.findOneAndUpdate(
                { _id: String(branchId), tenantId: String(tenantId), status: 'PENDING' },
                { $set: { status: 'ACTIVE', activatedAt, updatedAt: activatedAt } },
                { new: true, runValidators: true }
            ).lean();
            if (!persisted) {
                const error = new Error('Branch activation conflict. Refresh and try again.');
                error.statusCode = 409;
                error.code = 'BRANCH_ACTIVATION_CONFLICT';
                throw error;
            }
            updated = { ...persisted, id: String(persisted._id) };
        }
        this.branches.set(String(branchId), updated);
        domainEvents.emitDomainEvent('BRANCH_ACTIVATED', String(branchId), { status: 'ACTIVE' }, actor, String(tenantId), String(branchId));
        return updated;
    }

    async updateBranch(branchId, updates, actor = null) {
        const branch = await this.getBranchById(branchId);
        if (!branch) throw new Error('Branch not found');

        const safeUpdates = { ...(updates || {}) };
        delete safeUpdates.id;
        delete safeUpdates._id;
        delete safeUpdates.tenantId;
        delete safeUpdates.status;
        const updated = {
            ...branch,
            ...safeUpdates,
            tenantId: branch.tenantId,
            status: branch.status,
            address: { ...branch.address, ...(safeUpdates.address || {}) },
            geolocation: safeUpdates.geolocation !== undefined ? safeUpdates.geolocation : branch.geolocation,
            updatedAt: new Date().toISOString()
        };
        if (getIsConnected()) {
            const persistedFields = { ...updated };
            delete persistedFields.id;
            delete persistedFields._id;
            const persisted = await TenantBranch.findOneAndUpdate(
                { _id: String(branchId), tenantId: String(branch.tenantId) },
                { $set: persistedFields },
                { new: true, runValidators: true }
            ).lean();
            if (!persisted) throw new Error('Branch not found in the persistent tenant registry.');
            Object.assign(updated, persisted, { id: persisted._id });
        }
        this.branches.set(String(branchId), updated);
        domainEvents.emitDomainEvent('BRANCH_SETTINGS_UPDATED', branchId, updated, actor, branch.tenantId, branchId);
        return updated;
    }

    async getMembershipsForUser(userId) {
        if (getIsConnected()) {
            try {
                const dbMemberships = await TenantMembership.find({ userId, status: 'ACTIVE' }).lean();
                return dbMemberships.map(m => ({ id: m._id, ...m }));
            } catch (err) {
                logger.warn('Failed to query TenantMembership from MongoDB', { error: err.message });
            }
        }
        return Array.from(this.memberships.values()).filter(m => m.userId === userId && m.status === 'ACTIVE');
    }

    async getMembershipsForTenant(tenantId) {
        if (getIsConnected()) {
            const dbMemberships = await TenantMembership.find({ tenantId: String(tenantId) }).lean();
            return dbMemberships.map(m => ({ id: String(m._id), ...m }));
        }
        return Array.from(this.memberships.values()).filter(m => m.tenantId === String(tenantId));
    }

    async assignMembership(userId, tenantId, branchId, role, permissions = [], actor = null) {
        const key = `${userId}:${tenantId}`;
        const membership = {
            id: `mem-${Date.now()}`,
            userId,
            tenantId,
            branchId: branchId || null,
            role: role || TenantRoles.TENANT_ADMIN,
            permissions: Array.isArray(permissions) ? permissions : [],
            status: 'ACTIVE',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        if (getIsConnected()) {
            try {
                await TenantMembership.findOneAndUpdate(
                    { userId, tenantId },
                    {
                        branchId: membership.branchId,
                        role: membership.role,
                        permissions: membership.permissions,
                        status: 'ACTIVE'
                    },
                    { upsert: true, new: true }
                );
            } catch (err) {
                logger.warn('Failed to persist TenantMembership to MongoDB', { error: err.message });
            }
        }

        this.memberships.set(key, membership);
        registerMembership(membership);
        return membership;
    }

    async inviteTenantAdmin(tenantId, inviteData, actor = null) {
        const tenant = await this.getTenantById(tenantId);
        if (!tenant) throw new Error('Tenant not found');

        const email = inviteData.email?.trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new Error('Valid invitation email address is required.');
        }

        const invitationToken = `inv_${crypto.randomUUID()}`;
        const inviteRecord = {
            id: `invite-${Date.now()}`,
            userId: inviteData.userId || `pending-${crypto.randomUUID().slice(0, 8)}`,
            email,
            name: inviteData.name || '',
            tenantId,
            branchId: inviteData.branchId || null,
            role: TenantRoles.TENANT_ADMIN,
            permissions: Array.isArray(inviteData.permissions) ? inviteData.permissions : [],
            status: 'INVITED',
            invitationToken,
            invitedBy: actor?.userId || 'platform-super-admin',
            createdAt: new Date().toISOString()
        };

        const key = `${inviteRecord.userId}:${tenantId}`;
        this.memberships.set(key, inviteRecord);
        registerMembership(inviteRecord);

        if (getIsConnected()) {
            try {
                await TenantMembership.create({
                    userId: inviteRecord.userId,
                    tenantId,
                    branchId: inviteRecord.branchId,
                    role: inviteRecord.role,
                    permissions: inviteRecord.permissions,
                    status: 'INVITED',
                    invitedBy: inviteRecord.invitedBy,
                    invitationToken
                });
            } catch (err) {
                logger.warn('Failed to save invitation to MongoDB', { error: err.message });
            }
        }

        domainEvents.emitDomainEvent('TENANT_ADMIN_INVITED', tenantId, inviteRecord, actor, tenantId);
        logger.info(`Tenant admin invited: ${email} for tenant ${tenant.name}`, { tenantId, email });
        return inviteRecord;
    }
}

export const tenantService = new TenantService();
export default tenantService;
