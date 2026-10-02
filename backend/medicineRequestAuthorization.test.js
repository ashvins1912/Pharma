import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { SignJWT } from 'jose';

process.env.NODE_ENV = 'test';

const { default: medicineRequestRoutes } = await import('./routes/medicineRequestRoutes.js');

const createToken = async role => {
    const secret = process.env.DEMO_ADMIN_JWT_SECRET
        || process.env.ENCRYPTION_SECRET_KEY
        || 'ashvin-pharmacy-demo-admin-jwt-secret-key-32chars!';
    return new SignJWT({ app_metadata: { role } })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(`test-${role}`)
        .sign(new TextEncoder().encode(secret));
};

const start = async () => {
    const app = express();
    app.use('/api/medicine-requests', medicineRequestRoutes);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        })
    };
};

test('authenticated customers can access their medicine request list', async () => {
    const server = await start();
    try {
        const token = await createToken('authenticated');
        const response = await fetch(`${server.url}/api/medicine-requests`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        assert.notEqual(response.status, 401);
        assert.notEqual(response.status, 403);
        assert.ok([200, 503].includes(response.status));
    } finally {
        await server.close();
    }
});

test('medicine request APIs reject staff and non-customer roles', async () => {
    const server = await start();
    try {
        for (const role of ['admin', 'pharmacy', 'rider']) {
            const token = await createToken(role);
            const response = await fetch(`${server.url}/api/medicine-requests`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            assert.equal(response.status, 403, `${role} should not access customer requests`);
        }
    } finally {
        await server.close();
    }
});
