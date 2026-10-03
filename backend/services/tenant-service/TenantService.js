/**
 * Tenant & Branch Management Domain Service
 */
import { domainEvents } from '../../shared/events/DomainEvents.js';
import { logger } from '../../shared/observability/logger.js';
import { registerMembership } from '../../middleware/context.js';
import { TenantRoles, PlatformRoles } from '../../shared/contracts/index.js';

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
            legalName: 'Ashvin Healthcare Private Limited',
            code: 'ASHVIN-HQ',
            phone: '+91 95899 16475',
            email: 'care@ashvinpharmacy.com',
            status: 'ACTIVE',
            timezone: 'Asia/Kolkata',
            currency: 'INR',
            settings: {
                allowOfferWithCoupon: false,
                allowCouponWithRewards: true,
                allowOfferWithRewards: false
            },
            createdAt: new Date().toISOString()
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
            legalName: 'MedPlus Healthcare MP LLP',
            code: 'MEDPLUS-MP',
            phone: '+91 75524 56789',
            email: 'support@medplus-partner.in',
            status: 'ACTIVE',
            timezone: 'Asia/Kolkata',
            currency: 'INR',
            settings: {
                allowOfferWithCoupon: true,
                allowCouponWithRewards: false,
                allowOfferWithRewards: false
            },
            createdAt: new Date().toISOString()
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
        let list = Array.from(this.tenants.values());
        if (filter.status) list = list.filter(t => t.status === filter.status);
        return list;
    }

    async getTenantById(tenantId) {
        return this.tenants.get(String(tenantId)) || null;
    }

    async createTenant(data, actor = null) {
        const id = data.id || `tenant-${Date.now()}`;
        const newTenant = {
            id,
            name: data.name,
            legalName: data.legalName || data.name,
            code: (data.code || data.name.toUpperCase().replace(/[^A-Z0-9]/g, '')).slice(0, 12),
            phone: data.phone || '',
            email: data.email || '',
            status: 'ACTIVE',
            timezone: data.timezone || 'Asia/Kolkata',
            currency: data.currency || 'INR',
            settings: {
                allowOfferWithCoupon: Boolean(data.settings?.allowOfferWithCoupon),
                allowCouponWithRewards: data.settings?.allowCouponWithRewards !== false,
                allowOfferWithRewards: Boolean(data.settings?.allowOfferWithRewards)
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.tenants.set(id, newTenant);
        domainEvents.emitDomainEvent('TENANT_CREATED', id, newTenant, actor, id);
        logger.info(`New tenant onboarded: ${newTenant.name}`, { tenantId: id });
        return newTenant;
    }

    async getBranches(tenantId, filter = {}) {
        let list = Array.from(this.branches.values()).filter(b => b.tenantId === String(tenantId));
        if (filter.status) list = list.filter(b => b.status === filter.status);
        return list;
    }

    async getAllActiveBranches() {
        return Array.from(this.branches.values()).filter(b => b.status === 'ACTIVE');
    }

    async getBranchById(branchId) {
        return this.branches.get(String(branchId)) || null;
    }

    async createBranch(tenantId, data, actor = null) {
        const tenant = await this.getTenantById(tenantId);
        if (!tenant) throw new Error('Tenant not found');

        const id = data.id || `branch-${Date.now()}`;
        const newBranch = {
            id,
            tenantId,
            name: data.name,
            code: data.code || `BR-${this.branches.size + 1}`,
            phone: data.phone || tenant.phone,
            email: data.email || tenant.email,
            address: {
                street: data.address?.street || '',
                city: data.address?.city || 'Indore',
                state: data.address?.state || 'Madhya Pradesh',
                pincode: data.address?.pincode || '',
                coordinates: {
                    lat: Number(data.address?.coordinates?.lat || 22.7196),
                    lng: Number(data.address?.coordinates?.lng || 75.8577)
                }
            },
            serviceRadiusKm: Number(data.serviceRadiusKm) || 10.0,
            deliveryMode: data.deliveryMode || 'OWN_RIDER',
            minimumOrderValue: Number(data.minimumOrderValue) || 149,
            freeDeliveryAbove: Number(data.freeDeliveryAbove) || 499,
            deliveryFee: Number(data.deliveryFee) || 30,
            operatingHours: data.operatingHours || { open: '08:00', close: '22:00' },
            status: 'ACTIVE',
            createdAt: new Date().toISOString()
        };
        this.branches.set(id, newBranch);
        domainEvents.emitDomainEvent('BRANCH_CREATED', id, newBranch, actor, tenantId, id);
        return newBranch;
    }

    async updateBranch(branchId, updates, actor = null) {
        const branch = this.branches.get(branchId);
        if (!branch) throw new Error('Branch not found');

        const updated = {
            ...branch,
            ...updates,
            address: { ...branch.address, ...(updates.address || {}) },
            updatedAt: new Date().toISOString()
        };
        this.branches.set(branchId, updated);
        domainEvents.emitDomainEvent('BRANCH_SETTINGS_UPDATED', branchId, updated, actor, branch.tenantId, branchId);
        return updated;
    }

    async getMembershipsForUser(userId) {
        return Array.from(this.memberships.values()).filter(m => m.userId === userId && m.status === 'ACTIVE');
    }

    async assignMembership(userId, tenantId, branchId, role, permissions = [], actor = null) {
        const key = `${userId}:${tenantId}`;
        const membership = {
            id: `mem-${Date.now()}`,
            userId,
            tenantId,
            branchId: branchId || null,
            role,
            permissions: permissions.length ? permissions : ['READ_WRITE'],
            status: 'ACTIVE',
            createdAt: new Date().toISOString()
        };
        this.memberships.set(key, membership);
        registerMembership(membership);
        return membership;
    }
}

export const tenantService = new TenantService();
export default tenantService;
