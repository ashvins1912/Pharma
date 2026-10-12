/**
 * Global Customer & Tenant-Scoped Profile Service
 * Mandatory Rule: Customer is NOT tenant-owned; Customer is a global Ashvin identity.
 */
import crypto from 'node:crypto';
import { logger } from '../../shared/observability/logger.js';

export class IdentityService {
    constructor() {
        this.customers = new Map(); // key: customerId -> Customer
        this.userToCustomer = new Map(); // key: userId -> customerId
        this.tenantProfiles = new Map(); // key: `${customerId}:${tenantId}` -> CustomerTenantProfile
        this._seedDefaults();
    }

    _seedDefaults() {
        // Seed demo customer
        const demoUserId = 'demo-customer-id';
        const customer = {
            id: 'cust-demo-ashvin',
            userId: demoUserId,
            name: 'Ashvin Singh',
            email: 'customer@ashvinpharma.com',
            phone: '+91 95899 16475',
            status: 'ACTIVE',
            savedAddresses: [
                {
                    id: 'addr-home-1',
                    label: 'Home',
                    addressLine1: 'B-102, Silver Springs, AB Road',
                    city: 'Indore',
                    state: 'Madhya Pradesh',
                    pincode: '452001',
                    coordinates: { lat: 22.7210, lng: 75.8600 },
                    isDefault: true
                },
                {
                    id: 'addr-office-2',
                    label: 'Office',
                    addressLine1: '404 Crystal IT Park, Ring Road',
                    city: 'Indore',
                    state: 'Madhya Pradesh',
                    pincode: '452014',
                    coordinates: { lat: 22.6950, lng: 75.8750 },
                    isDefault: false
                }
            ],
            createdAt: new Date().toISOString()
        };
        this.customers.set(customer.id, customer);
        this.userToCustomer.set(demoUserId, customer.id);

        // Profile at Tenant 1 (Ashvin Central Pharmacy)
        const p1 = {
            id: 'ctp-demo-ashvin',
            customerId: customer.id,
            tenantId: 'tenant-ashvin-main',
            customerCode: 'ASH-CUST-1001',
            totalOrders: 3,
            totalSpent: 2840,
            loyaltyPointsBalance: 240,
            status: 'ACTIVE',
            firstOrderAt: '2026-08-10T10:00:00Z',
            lastOrderAt: '2026-09-28T14:30:00Z',
            createdAt: new Date().toISOString()
        };
        this.tenantProfiles.set(`${customer.id}:tenant-ashvin-main`, p1);

        // Profile at Tenant 2 (MedPlus Partner) - isolated relationship!
        const p2 = {
            id: 'ctp-demo-medplus',
            customerId: customer.id,
            tenantId: 'tenant-medplus-partner',
            customerCode: 'MED-CUST-804',
            totalOrders: 1,
            totalSpent: 650,
            loyaltyPointsBalance: 50,
            status: 'ACTIVE',
            firstOrderAt: '2026-09-15T11:20:00Z',
            lastOrderAt: '2026-09-15T11:20:00Z',
            createdAt: new Date().toISOString()
        };
        this.tenantProfiles.set(`${customer.id}:tenant-medplus-partner`, p2);
    }

    async getOrCreateCustomer(userId, data = {}) {
        let customerId = this.userToCustomer.get(userId);
        if (customerId && this.customers.has(customerId)) {
            const existing = this.customers.get(customerId);
            if (data.name && !existing.name) existing.name = data.name;
            if (data.phone && !existing.phone) existing.phone = data.phone;
            return existing;
        }

        customerId = `cust-${crypto.randomUUID().slice(0, 8)}`;
        const customer = {
            id: customerId,
            userId,
            name: data.name || data.fullName || 'Valued Customer',
            email: data.email || '',
            phone: data.phone || data.mobile || '',
            status: 'ACTIVE',
            savedAddresses: [],
            createdAt: new Date().toISOString()
        };
        this.customers.set(customerId, customer);
        this.userToCustomer.set(userId, customerId);
        logger.info(`New global customer registered: ${customer.name}`, { customerId, userId });
        return customer;
    }

    async getCustomerById(customerId) {
        return this.customers.get(customerId) || null;
    }

    async getCustomerByUserId(userId) {
        const customerId = this.userToCustomer.get(userId);
        if (!customerId) return null;
        return this.customers.get(customerId) || null;
    }

    async getOrCreateTenantProfile(customerId, tenantId) {
        const key = `${customerId}:${tenantId}`;
        let profile = this.tenantProfiles.get(key);
        if (profile) return profile;

        profile = {
            id: `ctp-${crypto.randomUUID().slice(0, 8)}`,
            customerId,
            tenantId,
            customerCode: `CRM-${Math.floor(1000 + Math.random() * 9000)}`,
            totalOrders: 0,
            totalSpent: 0,
            loyaltyPointsBalance: 0,
            status: 'ACTIVE',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.tenantProfiles.set(key, profile);
        return profile;
    }

    async getTenantProfile(customerId, tenantId) {
        return this.tenantProfiles.get(`${customerId}:${tenantId}`) || null;
    }

    async getCustomerTenantProfiles(customerId) {
        return Array.from(this.tenantProfiles.values()).filter(p => p.customerId === customerId);
    }

    async recordOrderCompletion(customerId, tenantId, orderTotal, pointsEarned = 0, pointsRedeemed = 0) {
        const profile = await this.getOrCreateTenantProfile(customerId, tenantId);
        profile.totalOrders += 1;
        profile.totalSpent += Math.max(0, Number(orderTotal) || 0);
        profile.loyaltyPointsBalance = Math.max(0, profile.loyaltyPointsBalance + pointsEarned - pointsRedeemed);
        profile.lastOrderAt = new Date().toISOString();
        if (!profile.firstOrderAt) profile.firstOrderAt = profile.lastOrderAt;
        profile.updatedAt = new Date().toISOString();
        return profile;
    }

    async addCustomerAddress(customerId, addressData) {
        const customer = this.customers.get(customerId);
        if (!customer) throw new Error('Customer not found');

        const id = `addr-${Date.now()}`;
        const newAddress = {
            id,
            label: addressData.label || 'Delivery Address',
            addressLine1: addressData.addressLine1 || addressData.street || '',
            city: addressData.city || 'Indore',
            state: addressData.state || 'Madhya Pradesh',
            pincode: addressData.pincode || '',
            coordinates: {
                lat: Number(addressData.coordinates?.lat || 22.7196),
                lng: Number(addressData.coordinates?.lng || 75.8577)
            },
            isDefault: Boolean(addressData.isDefault) || customer.savedAddresses.length === 0
        };

        if (newAddress.isDefault) {
            customer.savedAddresses.forEach(a => { a.isDefault = false; });
        }
        customer.savedAddresses.push(newAddress);
        return newAddress;
    }

    async getCustomerAddresses(customerId) {
        const customer = this.customers.get(customerId);
        return customer?.savedAddresses || [];
    }
}

export const identityService = new IdentityService();
export default identityService;
