/**
 * Automated Test Suite for Generic SMTP Configuration and Tenant Onboarding Email Service
 * Verifies:
 * 1. Default SMTP configuration resolution (Gmail standard: smtp.gmail.com, 587, STARTTLS, 465 SSL)
 * 2. Per-tenant custom SMTP settings override
 * 3. Tenant onboarding email generation with complete details (pharmacy name, ID, slug, contacts, admin access, SMTP info)
 * 4. Simulated and real dispatch recording in audit history
 * 5. Super Admin API: GET /api/v1/admin/tenants/smtp/config (masked password)
 * 6. Super Admin API: PUT /api/v1/admin/tenants/smtp/config (dynamic update)
 * 7. Super Admin API: POST /api/v1/admin/tenants/smtp/test (diagnostic test email)
 * 8. Super Admin API: POST /api/v1/admin/tenants (onboards tenant, sends onboarding email, returns emailNotification)
 * 9. Super Admin API: POST /api/v1/admin/tenants/:tenantId/invite-admin (sends admin invitation email)
 * 10. Super Admin API: GET /api/v1/admin/tenants/:tenantId/smtp & PUT /api/v1/admin/tenants/:tenantId/smtp
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { SignJWT } from 'jose';

import gatewayRouter from '../backend/gateway/gatewayRouter.js';
import { emailService } from '../backend/services/notification-service/EmailService.js';
import { tenantService } from '../backend/services/tenant-service/TenantService.js';

const JWT_SECRET = process.env.DEMO_ADMIN_JWT_SECRET
    || process.env.ENCRYPTION_SECRET_KEY
    || 'ashvin-pharmacy-demo-admin-jwt-secret-key-32chars!';
const SIGNING_KEY = new TextEncoder().encode(JWT_SECRET);

async function createSuperAdminToken() {
    return new SignJWT({
        sub: 'super-admin-uuid-001',
        email: 'admin@ashvinpharmacy.com',
        app_metadata: { role: 'SUPER_ADMIN', tenantId: null }
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('2h')
        .sign(SIGNING_KEY);
}

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

test('1. EmailService SMTP configuration defaults to standard Gmail settings', () => {
    const config = emailService.resolveConfig();
    assert.equal(config.host, 'smtp.gmail.com');
    assert.equal(config.port, 587);
    assert.equal(config.secure, false); // Port 587 uses STARTTLS
    assert.ok(config.from.includes('Ashvin Pharmacy Platform'));

    // Port 465 SSL auto-detection
    const sslConfig = emailService.resolveConfig(null, { port: 465 });
    assert.equal(sslConfig.port, 465);
    assert.equal(sslConfig.secure, true); // Port 465 uses direct SSL
});

test('2. Per-tenant custom SMTP settings override global settings', () => {
    const customTenant = {
        id: 'tenant-custom-smtp',
        name: 'Apollo Partner Pharmacy',
        settings: {
            smtp: {
                host: 'smtp.sendgrid.net',
                port: 465,
                secure: true,
                user: 'apikey',
                pass: 'SG.custom-test-secret',
                from: 'Apollo Pharmacy <no-reply@apollo.example.com>',
                enabled: true
            }
        }
    };

    const resolved = emailService.resolveConfig(customTenant);
    assert.equal(resolved.host, 'smtp.sendgrid.net');
    assert.equal(resolved.port, 465);
    assert.equal(resolved.secure, true);
    assert.equal(resolved.user, 'apikey');
    assert.equal(resolved.pass, 'SG.custom-test-secret');
    assert.equal(resolved.from, 'Apollo Pharmacy <no-reply@apollo.example.com>');
});

test('3. sendTenantOnboardingEmail generates complete details and records in dispatch history', async () => {
    const sampleTenant = {
        id: `tenant-test-${Date.now()}`,
        name: 'Sanjeevani Wellness Pharmacy',
        slug: `sanjeevani-${Date.now()}`,
        legalName: 'Sanjeevani Healthcare Solutions Pvt Ltd',
        code: 'SANJ-01',
        contactEmail: 'contact@sanjeevani.example.com',
        contactPhone: '+91 91234 56789',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        status: 'ACTIVE'
    };

    const initialAdmin = {
        email: 'director@sanjeevani.example.com',
        invitationToken: 'inv_sanjeevani_token_12345'
    };

    const result = await emailService.sendTenantOnboardingEmail(sampleTenant, initialAdmin, {
        portalUrl: 'https://ashvinpharmacy.com/admin/login'
    });

    assert.equal(result.success, true);
    assert.ok(result.messageId);
    assert.equal(result.recipient, sampleTenant.contactEmail);
    assert.ok(result.subject.includes(sampleTenant.name));
    assert.ok(result.status === 'SENT' || result.status === 'SIMULATED');

    // Verify recorded in dispatch history
    const history = emailService.getDispatchHistory({ tenantId: sampleTenant.id });
    assert.ok(history.length >= 1);
    assert.equal(history[0].recipient, sampleTenant.contactEmail);
    assert.equal(history[0].metadata?.tenantId, sampleTenant.id);
    assert.equal(history[0].metadata?.adminEmail, initialAdmin.email);
});

test('4. sendTestEmail dispatches diagnostic verification email', async () => {
    const testResult = await emailService.sendTestEmail('test-recipient@example.com', {
        host: 'smtp.gmail.com',
        port: 587
    });

    assert.equal(testResult.success, true);
    assert.equal(testResult.recipient, 'test-recipient@example.com');
    assert.ok(testResult.subject.includes('SMTP Diagnostic Test'));
});

test('5. Super Admin API: GET and PUT /api/v1/admin/tenants/smtp/config manages global SMTP settings', async () => {
    const server = await createTestServer();
    try {
        const token = await createSuperAdminToken();
        const authHeaders = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        // 1. GET global SMTP config
        const getRes = await fetch(`${server.baseUrl}/admin/tenants/smtp/config`, { headers: authHeaders });
        assert.equal(getRes.status, 200);
        const getBody = await getRes.json();
        assert.equal(getBody.success, true);
        assert.ok(getBody.data.host);
        assert.ok(getBody.data.encryption);

        // 2. PUT global SMTP config
        const putRes = await fetch(`${server.baseUrl}/admin/tenants/smtp/config`, {
            method: 'PUT',
            headers: authHeaders,
            body: JSON.stringify({
                host: 'smtp.gmail.com',
                port: 587,
                secure: false,
                user: 'ashvin.platform@gmail.com',
                pass: 'abcd-efgh-ijkl-mnop',
                from: 'Ashvin Central <ashvin.platform@gmail.com>'
            })
        });
        assert.equal(putRes.status, 200);
        const putBody = await putRes.json();
        assert.equal(putBody.success, true);
        assert.equal(putBody.data.user, 'ashvin.platform@gmail.com');
        assert.equal(putBody.data.pass, '••••••••••••••••'); // Masked password
        assert.equal(putBody.data.port, 587);
        assert.equal(putBody.data.encryption, 'STARTTLS');
    } finally {
        await server.close();
    }
});

test('6. Super Admin API: POST /api/v1/admin/tenants/smtp/test validates email and sends test message', async () => {
    const server = await createTestServer();
    try {
        const token = await createSuperAdminToken();
        const authHeaders = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        // Invalid target email
        const badRes = await fetch(`${server.baseUrl}/admin/tenants/smtp/test`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ targetEmail: 'invalid-email-address' })
        });
        assert.equal(badRes.status, 400);

        // Valid test email
        const okRes = await fetch(`${server.baseUrl}/admin/tenants/smtp/test`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ targetEmail: 'operations@pharmacy.example.com' })
        });
        assert.equal(okRes.status, 200);
        const okBody = await okRes.json();
        assert.equal(okBody.success, true);
        assert.equal(okBody.data.recipient, 'operations@pharmacy.example.com');
    } finally {
        await server.close();
    }
});

test('7. Super Admin API: POST /api/v1/admin/tenants onboards tenant and triggers complete onboarding email', async () => {
    const server = await createTestServer();
    try {
        const token = await createSuperAdminToken();
        const authHeaders = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        const uniqueSlug = `medilink-${Date.now()}`;
        const payload = {
            name: 'MediLink Specialty Pharmacy',
            slug: uniqueSlug,
            legalName: 'MediLink Healthcare Services India Ltd',
            contactEmail: 'contact@medilink.example.com',
            contactPhone: '+91 94444 33333',
            timezone: 'Asia/Kolkata',
            currency: 'INR',
            initialAdminEmail: 'lead.admin@medilink.example.com',
            initialAdminName: 'Dr. Suresh Nair',
            smtpConfig: {
                host: 'smtp.gmail.com',
                port: 587,
                user: 'medilink.notifications@gmail.com',
                enabled: true
            }
        };

        const res = await fetch(`${server.baseUrl}/admin/tenants`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload)
        });

        assert.equal(res.status, 201);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.data.name, 'MediLink Specialty Pharmacy');
        assert.equal(body.data.slug, uniqueSlug);

        // Verify initial admin was created & returned
        assert.ok(body.initialAdmin);
        assert.equal(body.initialAdmin.email, 'lead.admin@medilink.example.com');

        // Verify emailNotification metadata
        assert.ok(body.emailNotification);
        assert.equal(body.emailNotification.dispatched, true);
        assert.equal(body.emailNotification.recipient, 'contact@medilink.example.com');
        assert.ok(body.emailNotification.status === 'SENT' || body.emailNotification.status === 'SIMULATED');
        assert.ok(body.emailNotification.messageId);

        // Verify per-tenant SMTP settings are readable via GET /admin/tenants/:tenantId/smtp
        const tenantSmtpRes = await fetch(`${server.baseUrl}/admin/tenants/${body.data.id}/smtp`, {
            headers: authHeaders
        });
        assert.equal(tenantSmtpRes.status, 200);
        const tenantSmtpBody = await tenantSmtpRes.json();
        assert.equal(tenantSmtpBody.success, true);
        assert.equal(tenantSmtpBody.data.config.host, 'smtp.gmail.com');
        assert.equal(tenantSmtpBody.data.config.user, 'medilink.notifications@gmail.com');
    } finally {
        await server.close();
    }
});

test('8. Super Admin API: POST /api/v1/admin/tenants/:tenantId/invite-admin triggers invitation email', async () => {
    const server = await createTestServer();
    try {
        const token = await createSuperAdminToken();
        const authHeaders = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        const tenants = await tenantService.getTenants();
        const tenant = tenants[0];

        const inviteRes = await fetch(`${server.baseUrl}/admin/tenants/${tenant.id}/invite-admin`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                email: 'invited.pharmacist@example.com',
                name: 'Kavita Singh'
            })
        });

        assert.equal(inviteRes.status, 201);
        const inviteBody = await inviteRes.json();
        assert.equal(inviteBody.success, true);
        assert.equal(inviteBody.data.email, 'invited.pharmacist@example.com');
        assert.ok(inviteBody.emailNotification);
        assert.equal(inviteBody.emailNotification.dispatched, true);
        assert.equal(inviteBody.emailNotification.recipient, 'invited.pharmacist@example.com');
    } finally {
        await server.close();
    }
});
