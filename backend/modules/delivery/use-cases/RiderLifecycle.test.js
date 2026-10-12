import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryRiderRepository } from '../infrastructure/repositories/InMemoryRiderRepository.js';
import { RegisterRiderUseCase } from './RegisterRiderUseCase.js';
import { SetRiderEnabledUseCase } from './SetRiderEnabledUseCase.js';

test('in-memory rider repository starts empty and excludes disabled riders from active listings', async () => {
    const repository = new InMemoryRiderRepository();
    assert.deepEqual(await repository.findAll(), []);

    const registerRider = new RegisterRiderUseCase({
        riderRepository: repository,
        storageService: { upload: async () => ({ publicUrl: 'photo-url' }) }
    });
    const rider = await registerRider.execute({ name: 'Test Rider', mobile: '1234567890' });
    const setRiderEnabled = new SetRiderEnabledUseCase({ riderRepository: repository });
    const disabled = await setRiderEnabled.execute(rider.id, false, 'Suspended', 'Review required.');

    assert.equal(disabled.enabled, false);
    assert.equal(disabled.disabledReason, 'Review required.');
    assert.deepEqual(await repository.findAll(), []);
    assert.equal((await repository.findAll({ includeDisabled: true })).length, 1);
    assert.deepEqual(await repository.findAvailableNearby([77.5946, 12.9716]), []);
});

test('registering a disabled rider with the same mobile re-enables their existing record', async () => {
    const repository = new InMemoryRiderRepository();
    const registerRider = new RegisterRiderUseCase({
        riderRepository: repository,
        storageService: { upload: async () => ({ publicUrl: 'photo-url' }) }
    });
    const original = await registerRider.execute({
        name: 'Returning Rider',
        mobile: '+91 98765 43210'
    });
    await repository.update(original.id, { totalDeliveries: 12 });
    const setRiderEnabled = new SetRiderEnabledUseCase({ riderRepository: repository });
    await setRiderEnabled.execute(original.id, false, 'Removed', 'Contract ended.');

    const reactivated = await registerRider.execute({
        name: 'Returning Rider Updated',
        mobile: '+919876543210'
    });

    assert.equal(reactivated.id, original.id);
    assert.equal(reactivated.name, 'Returning Rider Updated');
    assert.equal(reactivated.enabled, true);
    assert.equal(reactivated.status, 'Available');
    assert.equal(reactivated.disabledAction, null);
    assert.equal(reactivated.disabledReason, null);
    assert.equal(reactivated.totalDeliveries, 12);
    assert.equal((await repository.findAll()).length, 1);
});

test('rider suspension requires a supported action and non-empty remark', async () => {
    const repository = new InMemoryRiderRepository();
    const registerRider = new RegisterRiderUseCase({
        riderRepository: repository,
        storageService: { upload: async () => ({ publicUrl: 'photo-url' }) }
    });
    const rider = await registerRider.execute({ name: 'Test Rider', mobile: '1234567890' });
    const setRiderEnabled = new SetRiderEnabledUseCase({ riderRepository: repository });

    await assert.rejects(
        setRiderEnabled.execute(rider.id, false, 'Suspended', '  '),
        /remark is required/
    );
    await assert.rejects(
        setRiderEnabled.execute(rider.id, false, 'Deleted', 'Invalid action'),
        /must be Suspended or Removed/
    );
});
