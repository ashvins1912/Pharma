import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { errorHandler } from './errorHandler.js';

const start = async error => {
    const app = express();
    app.get('/failure', (req, _res, next) => {
        req.requestId = 'error-test-request';
        next(error);
    });
    app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    };
};

test('database failures become explicit 503 errors, never success-shaped fallbacks', async () => {
    const server = await start(Object.assign(new Error('private database endpoint'), {
        name: 'MongoNetworkError'
    }));
    try {
        const response = await fetch(`${server.url}/failure`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
            success: false,
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'A required database service is unavailable.'
            },
            requestId: 'error-test-request'
        });
    } finally {
        await server.close();
    }
});

test('unexpected server errors do not expose implementation details', async () => {
    const server = await start(new Error('secret connection string'));
    try {
        const response = await fetch(`${server.url}/failure`);
        assert.equal(response.status, 500);
        const body = await response.json();
        assert.equal(body.error.message, 'Internal server error.');
        assert.equal(JSON.stringify(body).includes('secret connection string'), false);
    } finally {
        await server.close();
    }
});
