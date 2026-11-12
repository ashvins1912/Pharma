import test from 'node:test';
import assert from 'node:assert/strict';
import authRouter from './auth.js';

const routes = authRouter.stack
    .filter(layer => layer.route)
    .map(layer => ({
        path: layer.route.path,
        methods: layer.route.methods
    }));

test('signup routes expose every supported registration and onboarding step', () => {
    for (const path of ['/signup', '/verify-email-code', '/resend-verification', '/google', '/complete-profile']) {
        assert.ok(routes.some(route => route.path === path), `Expected POST/PUT ${path} route to be registered`);
    }

    assert.ok(routes.find(route => route.path === '/signup').methods.post);
    assert.ok(routes.find(route => route.path === '/verify-email-code').methods.post);
    assert.ok(routes.find(route => route.path === '/google').methods.post);
    assert.ok(routes.find(route => route.path === '/complete-profile').methods.put);
});
