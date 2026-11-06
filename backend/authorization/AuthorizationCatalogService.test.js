import test from 'node:test';
import assert from 'node:assert/strict';
import { getRolePermissions } from './AuthorizationCatalogService.js';
import { getIsConnected } from '../config/db.js';

test('tenant owner and admin receive scoped branch capabilities without inventory import by default', { skip: getIsConnected() }, async () => {
    for (const role of ['TENANT_OWNER', 'TENANT_ADMIN']) {
        const permissions = await getRolePermissions(role);
        assert.ok(permissions.includes('tenant.branches.read'));
        assert.ok(permissions.includes('tenant.branches.manage'));
        assert.ok(permissions.includes('tenant.profile.read'));
        assert.equal(permissions.includes('inventory.import'), false);
    }
});

test('pharmacist and inventory manager do not receive inventory import by default', { skip: getIsConnected() }, async () => {
    for (const role of ['PHARMACIST', 'INVENTORY_MANAGER']) {
        const permissions = await getRolePermissions(role);
        assert.equal(permissions.includes('inventory.import'), false);
    }
});
