import assert from 'node:assert/strict';
import test from 'node:test';
import { autoAssignOrder, manualAssignOrder } from './orderAssignmentController.js';

const invokeInvalid = async (controller, orderId) => {
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await controller({ params: { orderId }, requestId: 'assignment-test' }, response);
  return response;
};

test('auto assignment rejects absent and invalid order identifiers before the assignment service', async () => {
  for (const orderId of [undefined, null, '', 'undefined', 'null', 'not-an-object-id']) {
    const response = await invokeInvalid(autoAssignOrder, orderId);
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error.code, 'INVALID_ORDER_ID');
    assert.equal(response.body.error.message, 'A valid order ID is required.');
  }
});

test('manual assignment rejects absent and invalid order identifiers before the use case', async () => {
  for (const orderId of [undefined, null, '', 'undefined', 'null', 'not-an-object-id']) {
    const response = await invokeInvalid(manualAssignOrder, orderId);
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error.code, 'INVALID_ORDER_ID');
  }
});
