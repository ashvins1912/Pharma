/**
 * Automated Test Suite for Ashvin API Gateway (/api/v1/*)
 */
process.env.NODE_ENV = 'test';
process.env.DEMO_ADMIN_JWT_SECRET = 'test-demo-admin-secret-key-32-chars-long';
import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../backend/server.js';
import http from 'node:http';

let server;
let baseUrl;

test.before(async () => {
    await new Promise((resolve) => {
        server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });
});

test.after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('Gateway: GET /api/v1/health returns system status and requestId', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.status, 'UP');
    assert.ok(body.requestId);
});

test('Gateway: GET /api/v1/tenants lists active pharmacy tenants', async () => {
    const res = await fetch(`${baseUrl}/api/v1/tenants`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.some(t => t.id === 'tenant-ashvin-main'));
});

test('Gateway: GET /api/v1/catalog/listings returns branch-scoped listings', async () => {
    const res = await fetch(`${baseUrl}/api/v1/catalog/listings?branchId=branch-indore-central`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.branch.id, 'branch-indore-central');
    assert.ok(Array.isArray(body.data.listings));
    assert.ok(body.data.listings.length > 0);
});

test('Gateway: POST /api/v1/delivery/check-serviceability validates location distance', async () => {
    const res = await fetch(`${baseUrl}/api/v1/delivery/check-serviceability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            branchId: 'branch-indore-central',
            coordinates: { lat: 22.7210, lng: 75.8600 }
        })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.serviceable, true);
});

test('Gateway: POST /api/v1/pricing/calculate computes authoritative line items', async () => {
    const res = await fetch(`${baseUrl}/api/v1/pricing/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tenantId: 'tenant-ashvin-main',
            branchId: 'branch-indore-central',
            items: [{ productId: 'prod-pcm-650', quantity: 2 }]
        })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.subtotal, 59.0);
    assert.equal(body.data.finalTotal, 89.0);
});

test('Gateway: Standard Error Envelope on invalid coupon code', async () => {
    const res = await fetch(`${baseUrl}/api/v1/pricing/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tenantId: 'tenant-ashvin-main',
            branchId: 'branch-indore-central',
            items: [{ productId: 'prod-pcm-650', quantity: 1 }],
            couponCode: 'INVALID_NONEXISTENT_CODE'
        })
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'INVALID_COUPON');
    assert.ok(body.error.requestId);
});

test('Gateway: Bulk Import: POST /api/v1/inventory/imports enforces authentication', async () => {
    const res = await fetch(`${baseUrl}/api/v1/inventory/imports`, {
        method: 'POST'
    });
    assert.equal(res.status, 401);
});

test('Gateway: Bulk Import: POST /api/v1/inventory/imports enforces tenant scope', async () => {
    const { issueDemoAdminToken } = await import('../backend/config/demoAdmin.js');
    const adminToken = await issueDemoAdminToken(true);

    const res = await fetch(`${baseUrl}/api/v1/inventory/imports`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${adminToken}`
        }
    });
    // Missing x-tenant-id should return 400
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error?.code, 'TENANT_REQUIRED');
});

test('Gateway: Bulk Import: GET /api/v1/inventory/imports/:jobId validates objectId and tenant isolation', async () => {
    const { issueDemoAdminToken } = await import('../backend/config/demoAdmin.js');
    const adminToken = await issueDemoAdminToken(true);

    // Invalid ObjectId returns 404
    const invalidIdRes = await fetch(`${baseUrl}/api/v1/inventory/imports/not-a-valid-id`, {
        headers: {
            Authorization: `Bearer ${adminToken}`,
            'x-tenant-id': 'tenant-ashvin-main',
            'x-branch-id': 'branch-indore-central'
        }
    });
    assert.equal(invalidIdRes.status, 404);

    // Nonexistent valid ObjectId returns 404
    const nonExistentRes = await fetch(`${baseUrl}/api/v1/inventory/imports/507f1f77bcf86cd799439011`, {
        headers: {
            Authorization: `Bearer ${adminToken}`,
            'x-tenant-id': 'tenant-ashvin-main',
            'x-branch-id': 'branch-indore-central'
        }
    });
    assert.equal(nonExistentRes.status, 404);
});

test('Gateway: Prescription Service: POST /api/v1/prescriptions/upload enforces authentication', async () => {
    const res = await fetch(`${baseUrl}/api/v1/prescriptions/upload`, {
        method: 'POST'
    });
    assert.equal(res.status, 401);
});

test('Gateway: Prescription Service: End-to-end upload, retrieval, removal, and response contracts', async () => {
    const { issueDemoCustomerToken } = await import('../backend/config/demoCustomer.js');
    const customerToken = await issueDemoCustomerToken();

    // 1. Upload
    const uploadRes = await fetch(`${baseUrl}/api/v1/prescriptions/upload`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${customerToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            notes: 'Need urgent allergy medicine',
            patientName: 'Rohan Mehra',
            doctorName: 'Dr. S. K. Gupta'
        })
    });

    assert.equal(uploadRes.status, 201);
    const uploadBody = await uploadRes.json();
    assert.equal(uploadBody.success, true);
    assert.ok(uploadBody.data.prescriptionId);
    assert.equal(uploadBody.data.status, 'COMPLETED');
    assert.ok(uploadBody.requestId);

    const prescId = uploadBody.data.prescriptionId;

    // 2. Retrieve details
    const getRes = await fetch(`${baseUrl}/api/v1/prescriptions/${prescId}`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.success, true);
    assert.equal(getBody.data.prescriptionId, prescId);
    assert.ok(getBody.data.patient);
    assert.ok(Array.isArray(getBody.data.medicines));

    // Security check: No secret leakage
    const rawResponse = JSON.stringify(getBody);
    assert.equal(rawResponse.includes('password'), false);
    assert.equal(rawResponse.includes('passwordHash'), false);
    assert.equal(rawResponse.includes('rawToken'), false);
    assert.equal(rawResponse.includes('encryptionKey'), false);

    // 3. Customer Data Removal
    const removeRes = await fetch(`${baseUrl}/api/v1/prescriptions/${prescId}/remove`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${customerToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: 'User requested removal' })
    });
    assert.equal(removeRes.status, 200);
    const removeBody = await removeRes.json();
    assert.equal(removeBody.success, true);
    assert.equal(removeBody.data.status, 'INACTIVE');
    assert.ok(removeBody.data.inactiveAt);
});


