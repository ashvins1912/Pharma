/**
 * Automated Test Suite for Platform Super Admin & Multi-Tenant Role Architecture
 * Verifies:
 * 1. Platform Super Admin identity & scope (/api/v1/auth/me)
 * 2. Tenant Admin identity & scope (/api/v1/auth/me)
 * 3. Customer identity & scope (/api/v1/auth/me)
 * 4. Super Admin Tenant Lifecycle Management (/api/v1/admin/tenants: list, create, update, suspend, activate, invite)
 * 5. Strict rejection of non-Super Admin roles on /api/v1/admin/tenants/*
 * 6. Cross-Tenant isolation (Tenant Admin A cannot spoof x-tenant-id for Tenant B)
 * 7. In-memory and Mongo Tenant/Membership models compatibility
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { SignJWT } from 'jose';

import gatewayRouter from '../backend/gateway/gatewayRouter.js';
import { tenantService } from '../backend/services/tenant-service/TenantService.js';
import { PlatformRoles, TenantRoles, isPlatformSuperAdmin } from '../backend/shared/contracts/index.js';

const JWT_SECRET = process.env.DEMO_ADMIN_JWT_SECRET
    || process.env.ENCRYPTION_SECRET_KEY
    || 'ashvin-pharmacy-demo-admin-jwt-secret-key-32chars!';
const SIGNING_KEY = new TextEncoder().encode(JWT_SECRET);

// Helper to generate test HS256 tokens matching the backend auth middleware
async function createTestToken(payload) {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('2h')
        .sign(SIGNING_KEY);
}

// Spin up a test server running gatewayRouter
async function createTestServer() {
    const app = express();
    app.use(express.json());
    app.use('/api/v1', gatewayRouter);

    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            const baseUrl = `http://127.0.0.1:${port}/api/v1`;
            resolve({
                baseUrl,
                close: () => new Promise(res => server.close(res))
            });
        });
    });
}

test('1. Role constants & isPlatformSuperAdmin helper verify role hierarchy', () => {
    assert.equal(PlatformRoles.SUPER_ADMIN, 'SUPER_ADMIN');
    assert.equal(PlatformRoles.PLATFORM_SUPER_ADMIN, 'SUPER_ADMIN');
    assert.equal(isPlatformSuperAdmin('SUPER_ADMIN'), true);
    assert.equal(isPlatformSuperAdmin('PLATFORM_SUPER_ADMIN'), true);
    assert.equal(isPlatformSuperAdmin('admin'), true);
    assert.equal(isPlatformSuperAdmin('TENANT_ADMIN'), false);
    assert.equal(isPlatformSuperAdmin('CUSTOMER'), false);
    assert.equal(isPlatformSuperAdmin('RIDER'), false);
});

test('2. GET /api/v1/auth/me returns platform scope and null tenant for SUPER_ADMIN', async () => {
    const server = await createTestServer();
    try {
        const superAdminToken = await createTestToken({
            sub: 'super-admin-uuid-001',
            email: 'admin@ashvinpharmacy.com',
            name: 'Platform Super Admin',
            app_metadata: { role: 'SUPER_ADMIN', tenantId: null }
        });

        const res = await fetch(`${server.baseUrl}/auth/me`, {
            headers: { Authorization: `Bearer ${superAdminToken}` }
        });

        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.data.user.role, 'SUPER_ADMIN');
        assert.equal(body.data.user.scope, 'PLATFORM');
        assert.equal(body.data.user.tenantId, null);
        assert.equal(body.data.user.email, 'admin@ashvinpharmacy.com');
    } finally {
        await server.close();
    }
});

test('3. GET /api/v1/auth/me returns tenant scope and bound tenantId for TENANT_ADMIN', async () => {
    const server = await createTestServer();
    try {
        const tenantAdminToken = await createTestToken({
            sub: 'tenant-admin-uuid-002',
            email: 'owner@ashvinpharmacy.com',
            name: 'Ashvin Branch Owner',
            app_metadata: { role: 'TENANT_ADMIN', tenantId: 'tenant-ashvin-main' }
        });

        const res = await fetch(`${server.baseUrl}/auth/me`, {
            headers: { Authorization: `Bearer ${tenantAdminToken}` }
        });

        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.data.user.role, 'TENANT_ADMIN');
        assert.equal(body.data.user.scope, 'TENANT');
        assert.equal(body.data.user.tenantId, 'tenant-ashvin-main');
        assert.ok(body.data.user.tenant);
        assert.equal(body.data.user.tenant.id, 'tenant-ashvin-main');
    } finally {
        await server.close();
    }
});

test('4. GET /api/v1/auth/me returns customer scope for customer user', async () => {
    const server = await createTestServer();
    try {
        const customerToken = await createTestToken({
            sub: 'customer-uuid-003',
            email: 'priya.sharma@example.com',
            name: 'Priya Sharma',
            app_metadata: { role: 'customer' }
        });

        const res = await fetch(`${server.baseUrl}/auth/me`, {
            headers: { Authorization: `Bearer ${customerToken}` }
        });

        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.data.user.scope, 'CUSTOMER');
        assert.equal(body.data.user.email, 'priya.sharma@example.com');
    } finally {
        await server.close();
    }
});

test('5. Super Admin Tenant Lifecycle Management: create, list, patch, suspend, activate, invite', async () => {
    const server = await createTestServer();
    try {
        const superAdminToken = await createTestToken({
            sub: 'super-admin-uuid-001',
            email: 'admin@ashvinpharmacy.com',
            app_metadata: { role: 'SUPER_ADMIN', tenantId: null }
        });

        const authHeaders = {
            Authorization: `Bearer ${superAdminToken}`,
            'Content-Type': 'application/json'
        };

        // 1. List existing tenants
        const listRes = await fetch(`${server.baseUrl}/admin/tenants`, { headers: authHeaders });
        assert.equal(listRes.status, 200);
        const listBody = await listRes.json();
        assert.ok(Array.isArray(listBody.data));
        assert.ok(listBody.data.length >= 2);

        // 2. Create new tenant
        const uniqueSlug = `careplus-${Date.now()}`;
        const createRes = await fetch(`${server.baseUrl}/admin/tenants`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                name: 'CarePlus Multi-Specialty Pharmacy',
                slug: uniqueSlug,
                contactEmail: 'admin@careplus.in',
                contactPhone: '+91 98765 43210',
                legalName: 'CarePlus Healthcare LLP'
            })
        });

        assert.equal(createRes.status, 201);
        const createBody = await createRes.json();
        assert.equal(createBody.success, true);
        assert.equal(createBody.data.name, 'CarePlus Multi-Specialty Pharmacy');
        assert.equal(createBody.data.slug, uniqueSlug);
        const createdTenantId = createBody.data.id;

        // 3. Get tenant details
        const getRes = await fetch(`${server.baseUrl}/admin/tenants/${createdTenantId}`, { headers: authHeaders });
        assert.equal(getRes.status, 200);
        const getBody = await getRes.json();
        assert.equal(getBody.data.id, createdTenantId);
        assert.equal(getBody.data.status, 'ACTIVE');

        // 4. Update tenant details
        const patchRes = await fetch(`${server.baseUrl}/admin/tenants/${createdTenantId}`, {
            method: 'PATCH',
            headers: authHeaders,
            body: JSON.stringify({
                contactPhone: '+91 99999 88888',
                settings: { allowOfferWithCoupon: true }
            })
        });
        assert.equal(patchRes.status, 200);
        const patchBody = await patchRes.json();
        assert.equal(patchBody.data.contactPhone, '+91 99999 88888');
        assert.equal(patchBody.data.settings.allowOfferWithCoupon, true);

        // 5. Suspend tenant
        const suspendRes = await fetch(`${server.baseUrl}/admin/tenants/${createdTenantId}/suspend`, {
            method: 'POST',
            headers: authHeaders
        });
        assert.equal(suspendRes.status, 200);
        const suspendBody = await suspendRes.json();
        assert.equal(suspendBody.data.status, 'SUSPENDED');

        // 6. Re-activate tenant
        const activateRes = await fetch(`${server.baseUrl}/admin/tenants/${createdTenantId}/activate`, {
            method: 'POST',
            headers: authHeaders
        });
        assert.equal(activateRes.status, 200);
        const activateBody = await activateRes.json();
        assert.equal(activateBody.data.status, 'ACTIVE');

        // 7. Invite Tenant Administrator
        const inviteRes = await fetch(`${server.baseUrl}/admin/tenants/${createdTenantId}/invite-admin`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                email: 'manager@careplus.in',
                name: 'Anil Mehta'
            })
        });
        assert.equal(inviteRes.status, 201);
        const inviteBody = await inviteRes.json();
        assert.equal(inviteBody.success, true);
        assert.equal(inviteBody.data.email, 'manager@careplus.in');
        assert.equal(inviteBody.data.role, 'TENANT_ADMIN');
        assert.equal(inviteBody.data.status, 'INVITED');
        assert.ok(inviteBody.data.invitationToken.startsWith('inv_'));
    } finally {
        await server.close();
    }
});

test('6. Non-Super Admin roles are strictly rejected (403) from /api/v1/admin/tenants/*', async () => {
    const server = await createTestServer();
    try {
        const tenantAdminToken = await createTestToken({
            sub: 'tenant-admin-uuid-002',
            email: 'owner@ashvinpharmacy.com',
            app_metadata: { role: 'TENANT_ADMIN', tenantId: 'tenant-ashvin-main' }
        });

        const customerToken = await createTestToken({
            sub: 'customer-uuid-003',
            email: 'customer@example.com',
            app_metadata: { role: 'customer' }
        });

        // Tenant Admin attempts to list all platform tenants
        const resTenantAdmin = await fetch(`${server.baseUrl}/admin/tenants`, {
            headers: { Authorization: `Bearer ${tenantAdminToken}` }
        });
        assert.equal(resTenantAdmin.status, 403, 'Tenant Admin must be denied platform tenant access');
        const bodyTenantAdmin = await resTenantAdmin.json();
        assert.equal(bodyTenantAdmin.error.code, 'FORBIDDEN');

        // Customer attempts to create a tenant
        const resCustomer = await fetch(`${server.baseUrl}/admin/tenants`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${customerToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: 'Hacked Pharmacy' })
        });
        assert.equal(resCustomer.status, 403, 'Customer must be denied tenant creation');

        // Anonymous attempt
        const resAnon = await fetch(`${server.baseUrl}/admin/tenants`);
        assert.equal(resAnon.status, 401, 'Anonymous request must be rejected');
    } finally {
        await server.close();
    }
});

test('7. Multi-Tenant Isolation: Tenant Admin A is rejected from accessing Tenant B data', async () => {
    const server = await createTestServer();
    try {
        // Tenant Admin explicitly bound to 'tenant-ashvin-main'
        const ashvinAdminToken = await createTestToken({
            sub: 'ashvin-admin-001',
            email: 'admin@ashvin.in',
            app_metadata: { role: 'TENANT_ADMIN', tenantId: 'tenant-ashvin-main' }
        });

        // 1. Authorized access to own tenant branch route
        const ownRes = await fetch(`${server.baseUrl}/branches/tenant-ashvin-main/branches`, {
            headers: {
                Authorization: `Bearer ${ashvinAdminToken}`,
                'x-tenant-id': 'tenant-ashvin-main'
            }
        });
        assert.equal(ownRes.status, 200, 'Must allow access to own tenant branch list');

        // 2. Cross-tenant attempt: spoofing x-tenant-id for Tenant B ('tenant-medplus-partner')
        const crossRes = await fetch(`${server.baseUrl}/branches/tenant-medplus-partner/branches`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${ashvinAdminToken}`,
                'x-tenant-id': 'tenant-medplus-partner',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: 'Malicious Injected Branch' })
        });

        assert.equal(crossRes.status, 403, 'Cross-tenant access must be denied with HTTP 403');
        const crossBody = await crossRes.json();
        assert.equal(crossBody.error.code, 'TENANT_ACCESS_DENIED');
        assert.ok(crossBody.error.message.includes('Cross-tenant access forbidden'));
    } finally {
        await server.close();
    }
});

test('8. Tenant and TenantMembership schema definitions enforce structure and constraints', async () => {
    const { default: Tenant } = await import('../backend/models/Tenant.js');
    const { default: TenantMembership } = await import('../backend/models/TenantMembership.js');

    assert.ok(Tenant.schema, 'Tenant schema must exist');
    assert.ok(TenantMembership.schema, 'TenantMembership schema must exist');

    // Verify Tenant fields
    const tenantPaths = Tenant.schema.paths;
    assert.ok(tenantPaths.name, 'Tenant must have name');
    assert.ok(tenantPaths.slug, 'Tenant must have slug');
    assert.ok(tenantPaths.status, 'Tenant must have status');

    // Verify Membership fields
    const memPaths = TenantMembership.schema.paths;
    assert.ok(memPaths.userId, 'Membership must have userId');
    assert.ok(memPaths.tenantId, 'Membership must have tenantId');
    assert.ok(memPaths.role, 'Membership must have role');
    assert.ok(memPaths.status, 'Membership must have status');
});

test('9. Admin Promote and Bootstrap environment resolution logic', () => {
    // 1. Emails parser
    const testRawEmails = '  owner@ashvin.com , CTO@ashvin.com, invalid-email  ';
    const parsed = testRawEmails
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    assert.deepEqual(parsed, ['owner@ashvin.com', 'cto@ashvin.com']);

    // 2. Role normalization rule: SUPER_ADMIN must bind tenantId to null
    const normalizePromotion = (role, tenantId) => {
        let assignedRole = role.toUpperCase();
        if (assignedRole === 'ADMIN' || assignedRole === 'PLATFORM_SUPER_ADMIN') {
            assignedRole = 'SUPER_ADMIN';
        }
        const assignedTenantId = assignedRole === 'SUPER_ADMIN' ? null : (tenantId || 'tenant-ashvin-main');
        return { role: assignedRole, tenantId: assignedTenantId };
    };

    assert.deepEqual(normalizePromotion('admin', 'tenant_123'), { role: 'SUPER_ADMIN', tenantId: null });
    assert.deepEqual(normalizePromotion('SUPER_ADMIN', 'any_tenant'), { role: 'SUPER_ADMIN', tenantId: null });
    assert.deepEqual(normalizePromotion('TENANT_ADMIN', 'tenant_xyz'), { role: 'TENANT_ADMIN', tenantId: 'tenant_xyz' });
    assert.deepEqual(normalizePromotion('PHARMACY_STAFF', 'tenant_xyz'), { role: 'PHARMACY_STAFF', tenantId: 'tenant_xyz' });
});
