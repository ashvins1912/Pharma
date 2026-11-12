import test from 'node:test';
import assert from 'node:assert/strict';
import { getReadableErrorMessage } from '../src/utils/errorMessage.js';

test('prefers readable message over API error code', () => {
  assert.equal(getReadableErrorMessage({ code: 'ORDER_QUERY_FAILED', message: 'Unable to load orders.' }), 'Unable to load orders.');
});
test('unwraps Axios response error envelopes', () => {
  assert.equal(getReadableErrorMessage({ response: { data: { code: 'FORBIDDEN', message: 'Access denied.' } } }), 'Access denied.');
});
test('handles nested messages, arrays, primitives and cycles', () => {
  assert.equal(getReadableErrorMessage({ message: { message: 'Nested failure' } }), 'Nested failure');
  assert.equal(getReadableErrorMessage({ message: ['First', 'Second'] }), 'First, Second');
  assert.equal(getReadableErrorMessage({ code: 'BAD_REQUEST' }), 'BAD_REQUEST');
  const cyclic = {}; cyclic.message = cyclic;
  assert.equal(getReadableErrorMessage(cyclic, 'Fallback'), 'Fallback');
  assert.equal(getReadableErrorMessage(null, 'Fallback'), 'Fallback');
});
