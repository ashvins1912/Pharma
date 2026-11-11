import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

process.env.NODE_ENV = 'test';

const { default: apiRoutes } = await import('./apiRoutes.js');

const start = async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', apiRoutes);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    };
};

test('central API router preserves auth and user-profile compatibility paths', async () => {
    const server = await start();
    try {
        const csrf = await fetch(`${server.url}/api/auth/csrf`);
        assert.equal(csrf.status, 200);
        assert.equal(typeof (await csrf.json()).csrfToken, 'string');

        const demoLogin = await fetch(`${server.url}/api/auth/demo-admin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'wrong@example.com', password: 'invalid' })
        });
        assert.equal(demoLogin.status, 401);

        const profile = await fetch(`${server.url}/api/user/profile`);
        assert.equal(profile.status, 401);
        assert.equal((await profile.json()).code, 'SESSION_REQUIRED');

    } finally {
        await server.close();
    }
});

test('central API router applies admin authorization to audit routes', async () => {
    const server = await start();
    try {
        const response = await fetch(`${server.url}/api/admin/audit-logs`);
        assert.equal(response.status, 401);
    } finally {
        await server.close();
    }
});
