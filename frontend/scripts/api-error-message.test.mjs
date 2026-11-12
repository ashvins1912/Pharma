import test from 'node:test';
import assert from 'node:assert/strict';
import { getReadableErrorMessage } from '../src/utils/errorMessage.js';

test('prefers a readable message over a machine error code', () => {
  assert.equal(getReadableErrorMessage({ code: 'ORDER_QUERY_FAILED', message: 'Unable to load orders.' }), 'Unable to load orders.');
});

test('unwraps Axios response envelopes containing structured message objects', () => {
  assert.equal(
    getReadableErrorMessage({ response: { data: { code: 'FORBIDDEN', message: { code: 'ACCESS_DENIED', message: 'Access denied.' } } } }),
    'Access denied.'
  );
});

test('unwraps nested API error objects and validation details', () => {
  assert.equal(getReadableErrorMessage({ response: { data: { error: { code: 'BAD_INPUT', message: 'Invalid quantity.' } } } }), 'Invalid quantity.');
  assert.equal(getReadableErrorMessage({ details: { message: 'Branch is required.' } }), 'Branch is required.');
  assert.equal(getReadableErrorMessage({ detail: 'The request is invalid.' }), 'The request is invalid.');
  assert.equal(getReadableErrorMessage({ errors: [{ field: 'name', message: 'Name is required.' }] }), 'Name is required.');
});

test('handles arrays, primitive messages, and code-only errors', () => {
  assert.equal(getReadableErrorMessage({ message: ['First', { message: 'Second' }] }), 'First, Second');
  assert.equal(getReadableErrorMessage({ message: 409 }), '409');
  assert.equal(getReadableErrorMessage({ code: 'ORDER_CONFLICT' }), 'ORDER_CONFLICT');
  assert.equal(getReadableErrorMessage('Plain text failure'), 'Plain text failure');
});

test('handles cyclic payloads, throwing getters, and missing values', () => {
  const cyclic = {}; cyclic.message = cyclic;
  assert.equal(getReadableErrorMessage(cyclic, 'Fallback'), 'Fallback');
  const hostile = Object.defineProperty({}, 'message', { get() { throw new Error('getter failure'); } });
  hostile.code = 'SAFE_CODE';
  assert.equal(getReadableErrorMessage(hostile), 'SAFE_CODE');
  assert.equal(getReadableErrorMessage(null, 'Fallback'), 'Fallback');
  assert.equal(getReadableErrorMessage(undefined, 'Fallback'), 'Fallback');
});
