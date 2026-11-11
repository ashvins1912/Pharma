import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeApiError } from './apiErrors.js';

test('normalizes customer API status codes to safe messages', () => {
  const cases = [401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504];
  for (const status of cases) {
    const error = normalizeApiError({ response: { status, data: { message: 'MongoServerError: secret details', code: 'INTERNAL_ERROR' }, headers: {} } });
    assert.equal(error.status, status);
    assert.equal(error.message.includes('MongoServerError'), false);
    assert.equal(error.message.includes('secret details'), false);
    assert.ok(error.message.length > 0);
  }
});

test('normalizes network, timeout, and HTML service route failures', () => {
  assert.equal(normalizeApiError({ code: 'ECONNABORTED' }).code, 'TIMEOUT');
  assert.match(normalizeApiError({ request: {} }).message, /Unable to connect/);
  const missingService = normalizeApiError({ response: { status: 404, data: '<!doctype html><html>Cannot GET /api/missing</html>', headers: { 'content-type': 'text/html' } } });
  assert.equal(missingService.status, 503);
  assert.equal(missingService.retryable, true);
});

test('keeps structured resource 404 distinct from unavailable service', () => {
  const error = normalizeApiError({ response: { status: 404, data: { error: { code: 'NOT_FOUND' } }, headers: { 'content-type': 'application/json' } } });
  assert.equal(error.status, 404);
  assert.equal(error.code, 'NOT_FOUND');
  assert.equal(error.retryable, false);
});
