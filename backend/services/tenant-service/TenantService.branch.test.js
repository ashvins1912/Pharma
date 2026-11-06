import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantService } from './TenantService.js';
import { getIsConnected } from '../../config/db.js';

const validBranch = (code = 'BLR-SAR-01') => ({
    name: 'Sarjapur Main Branch',
    code,
    phone: '+91 9876543210',
    email: 'sarjapur@example.com',
    address: {
        street: 'Sarjapur Main Road, Carmelaram',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560035'
    }
});

test('new branch remains pending until explicit activation', { skip: getIsConnected() }, async () => {
    const service = new TenantService();
    const created = await service.createBranch('tenant-ashvin-main', validBranch());
    assert.equal(created.status, 'PENDING');
    assert.equal((await service.getBranches('tenant-ashvin-main', { status: 'ACTIVE' })).some(item => item.id === created.id), false);

    const activated = await service.activateBranch(created.id, 'tenant-ashvin-main');
    assert.equal(activated.status, 'ACTIVE');
    assert.equal((await service.getBranches('tenant-ashvin-main', { status: 'ACTIVE' })).some(item => item.id === created.id), true);
});

test('requested default branch is applied only after activation', { skip: getIsConnected() }, async () => {
    const service = new TenantService();
    const created = await service.createBranch('tenant-ashvin-main', { ...validBranch('BLR-SAR-04'), isDefault: true });
    assert.equal(created.status, 'PENDING');
    assert.equal(created.isDefault, false);
    assert.equal(created.makeDefaultOnActivation, true);

    const activated = await service.activateBranch(created.id, 'tenant-ashvin-main');
    assert.equal(activated.status, 'ACTIVE');
    assert.equal(activated.isDefault, true);
    assert.equal(activated.makeDefaultOnActivation, false);
});

test('branch activation rejects a different tenant', { skip: getIsConnected() }, async () => {
    const service = new TenantService();
    const created = await service.createBranch('tenant-ashvin-main', validBranch('BLR-SAR-02'));
    await assert.rejects(
        () => service.activateBranch(created.id, 'tenant-medplus-partner'),
        error => error.statusCode === 404 && error.code === 'BRANCH_NOT_FOUND'
    );
    assert.equal((await service.getBranchById(created.id)).status, 'PENDING');
});

test('branch setup validates required contact and address details', { skip: getIsConnected() }, async () => {
    const service = new TenantService();
    await assert.rejects(
        () => service.createBranch('tenant-ashvin-main', { ...validBranch(), email: '', address: { city: 'Bengaluru' } }),
        error => error.statusCode === 400 && error.code === 'BRANCH_VALIDATION_FAILED'
    );
});

test('generic branch updates cannot change tenant ownership or activation state', { skip: getIsConnected() }, async () => {
    const service = new TenantService();
    const created = await service.createBranch('tenant-ashvin-main', validBranch('BLR-SAR-03'));
    const updated = await service.updateBranch(created.id, {
        tenantId: 'tenant-medplus-partner',
        status: 'ACTIVE',
        name: 'Updated Sarjapur Branch'
    });
    assert.equal(updated.tenantId, 'tenant-ashvin-main');
    assert.equal(updated.status, 'PENDING');
    assert.equal(updated.name, 'Updated Sarjapur Branch');
});


test('tenant creation normalizes optional geolocation without referencing undefined values', { skip: getIsConnected() }, async () => {
    const service = new TenantService();
    const created = await service.createTenant({ name: 'Geolocation Regression Pharmacy' });
    assert.deepEqual(created.geolocation, { latitude: null, longitude: null });

    const located = await service.createTenant({
        name: 'Located Regression Pharmacy',
        geolocation: { latitude: 12.91, longitude: 77.64 }
    });
    assert.deepEqual(located.geolocation, { latitude: 12.91, longitude: 77.64 });
});
