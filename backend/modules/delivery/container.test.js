import assert from 'node:assert/strict';
import test from 'node:test';
import { deliveryContainer } from './container.js';

test('delivery composition root resolves stable singleton adapters and use cases', () => {
    const container = deliveryContainer.container;
    assert.ok(container, 'composition container should be initialized');
    assert.equal(container.resolve('riderRepository'), deliveryContainer.riderRepository);
    assert.equal(container.resolve('orderRepository'), deliveryContainer.orderRepository);
    assert.equal(container.resolve('assignmentEngine'), deliveryContainer.assignmentEngine);
    assert.equal(container.resolve('registerRiderUseCase'), deliveryContainer.registerRiderUseCase);
    assert.equal(container.resolve('manualAssignOrderUseCase'), deliveryContainer.manualAssignOrderUseCase);
});

test('delivery composition root exposes the same process singleton', async () => {
    const { default: defaultContainer } = await import('./container.js');
    assert.equal(defaultContainer, deliveryContainer);
});
