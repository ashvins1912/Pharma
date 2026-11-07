import test from 'node:test';
import assert from 'node:assert/strict';
import assignmentRoutes from './assignmentRoutes.js';
import { requirePlatformSuperAdmin } from '../../../middleware/auth.js';

const routeFor = path => assignmentRoutes.stack.find(layer => layer.route?.path === path)?.route;

test('assignment engine telemetry route is protected by platform Super Admin middleware', () => {
    const route = routeFor('/engine-status');
    assert.ok(route, 'engine-status route must be registered');
    assert.equal(route.stack[0]?.handle, requirePlatformSuperAdmin);
});

test('tenant dispatch actions remain available through their existing permission-gated routes', () => {
    for (const path of ['/orders/:orderId/auto-assign', '/orders/:orderId/manual-assign']) {
        const route = routeFor(path);
        assert.ok(route, `${path} route must be registered`);
        assert.equal(
            route.stack.some(layer => layer.handle === requirePlatformSuperAdmin),
            false,
            `${path} must not be made platform-Super-Admin-only`
        );
        assert.ok(route.stack.length >= 2, `${path} must retain its permission middleware and controller`);
    }
});
