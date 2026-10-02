/**
 * Automated Test Suite for Ashvin API Gateway (/api/v1/*)
 */
process.env.NODE_ENV = 'test';
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
