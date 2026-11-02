import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryRiderRepository } from '../backend/modules/delivery/infrastructure/repositories/InMemoryRiderRepository.js';
import { RegisterRiderUseCase } from '../backend/modules/delivery/use-cases/RegisterRiderUseCase.js';
import { ManualAssignOrderUseCase } from '../backend/modules/delivery/use-cases/ManualAssignOrderUseCase.js';
import { isSameTenant, tenantScopedFilter } from '../backend/authorization/tenantScope.js';
import { isAssignedRiderForOrder, isRiderOwnedByOrderTenant } from '../backend/authorization/deliveryScope.js';

const storageService = { upload: async () => ({ publicUrl: 'https://example.invalid/rider.png' }) };

test('tenant ownership checks fail closed for missing and cross-tenant identifiers', () => {
    assert.equal(isSameTenant('tenant-a', 'tenant-a'), true);
    assert.equal(isSameTenant('tenant-a', 'tenant-b'), false);
    assert.equal(isSameTenant('tenant-a', null), false);
    assert.equal(isSameTenant(null, 'tenant-a'), false);
    assert.equal(tenantScopedFilter(null, { enabled: true }), null);
    assert.deepEqual(tenantScopedFilter('tenant-a', { enabled: true }), {
        enabled: true, tenantId: 'tenant-a'
    });
    assert.deepEqual(tenantScopedFilter('tenant-a', { tenantId: 'tenant-b' }), { tenantId: 'tenant-a' });
});

test('rider list, lookup, nearby search and updates cannot cross tenant boundaries', async () => {
    const repository = new InMemoryRiderRepository();
    const register = new RegisterRiderUseCase({ riderRepository: repository, storageService });
    const riderA = await register.execute({ tenantId: 'tenant-a', name: 'A Courier', mobile: '+91 9876543210' });
    const riderB = await register.execute({ tenantId: 'tenant-b', name: 'B Courier', mobile: '+91 9876543210' });

    assert.notEqual(riderA.id, riderB.id);
    assert.equal((await repository.findAll({ tenantId: 'tenant-a' })).length, 1);
    assert.equal((await repository.findAll({ tenantId: 'tenant-b' })).length, 1);
    assert.equal(await repository.findById(riderB.id, 'tenant-a'), null);
    assert.equal((await repository.findById(riderB.id, 'tenant-b')).tenantId, 'tenant-b');
    assert.equal((await repository.findByMobile('+919876543210', 'tenant-a')).id, riderA.id);
    assert.equal(await repository.update(riderB.id, { name: 'Hijacked' }, 'tenant-a'), null);
    const attemptedTenantMove = await repository.update(riderA.id, { tenantId: 'tenant-b' }, 'tenant-a');
    assert.equal(attemptedTenantMove.tenantId, 'tenant-a');

    const nearbyA = await repository.findAvailableNearby([77.5946, 12.9716], 20000, 5, 'tenant-a');
    assert.deepEqual(nearbyA.map(item => item.rider.id), [riderA.id]);
    assert.deepEqual(await repository.findAll(), []);
});

test('manual assignment rejects a rider owned by another tenant before mutating either record', async () => {
    const riderRepository = new InMemoryRiderRepository();
    const register = new RegisterRiderUseCase({ riderRepository, storageService });
    const foreignRider = await register.execute({
        tenantId: 'tenant-b', name: 'Foreign Courier', mobile: '9000000000'
    });
    const order = {
        id: 'order-a',
        tenantId: 'tenant-a',
        location: { distanceInKm: () => 1 },
        assignToRider() { throw new Error('Must not mutate a foreign rider assignment.'); }
    };
    const orderRepository = {
        findById: async (id, tenantId) => id === order.id && tenantId === order.tenantId ? order : null,
        update: async () => { throw new Error('Order must not be updated.'); }
    };
    const useCase = new ManualAssignOrderUseCase({ riderRepository, orderRepository });

    await assert.rejects(
        useCase.execute('order-a', foreignRider.id, 'Cross-tenant attempt', 'tenant-a'),
        /Rider #.* not found/
    );
    assert.equal((await riderRepository.findById(foreignRider.id, 'tenant-b')).activeOrderIds.length, 0);
});

test('rider registration requires an explicit tenant', async () => {
    const repository = new InMemoryRiderRepository();
    const register = new RegisterRiderUseCase({ riderRepository: repository, storageService });
    await assert.rejects(
        register.execute({ name: 'Unscoped Courier', mobile: '9111111111' }),
        /authenticated tenant is required/
    );
});

test('delivery verification requires the assigned rider and the order tenant to match', () => {
    const order = { tenantId: 'tenant-a', rider: { riderId: 'rider-a' } };
    assert.equal(isRiderOwnedByOrderTenant({ id: 'rider-a', tenantId: 'tenant-a' }, order), true);
    assert.equal(isAssignedRiderForOrder({ id: 'rider-a', tenantId: 'tenant-a' }, order), true);
    assert.equal(isAssignedRiderForOrder({ id: 'rider-b', tenantId: 'tenant-a' }, order), false);
    assert.equal(isAssignedRiderForOrder({ id: 'rider-a', tenantId: 'tenant-b' }, order), false);
    assert.equal(isAssignedRiderForOrder({ id: 'rider-a' }, order), false);
});
