import assert from 'node:assert/strict';
import test from 'node:test';
import { enforceBrowserRequestSecurity } from './browserRequestSecurity.js';

const config = { allowedOrigins: ['https://pharma-ui.onrender.com'] };

function run(headers = {}, method = 'POST') {
  const req = {
    method,
    get(name) {
      return headers[name] || headers[name.toLowerCase()] || '';
    }
  };
  let result = null;
  const res = {
    status(code) {
      result = { status: code };
      return this;
    },
    json(body) {
      result.body = body;
      return result;
    }
  };
  let nextCalled = false;
  enforceBrowserRequestSecurity(req, res, () => { nextCalled = true; }, config);
  return { result, nextCalled };
}

test('browser security allows same-origin authenticated mutation with valid double-submit token', () => {
  const outcome = run({
    origin: 'https://pharma-ui.onrender.com',
    'sec-fetch-site': 'same-origin',
    cookie: 'access_token=opaque-session; XSRF-TOKEN=csrf-123',
    'x-xsrf-token': 'csrf-123'
  });
  assert.equal(outcome.nextCalled, true);
  assert.equal(outcome.result, null);
});

test('browser security rejects authenticated mutation without CSRF proof', () => {
  const outcome = run({
    origin: 'https://pharma-ui.onrender.com',
    'sec-fetch-site': 'same-origin',
    cookie: 'access_token=opaque-session; XSRF-TOKEN=csrf-123'
  });
  assert.equal(outcome.nextCalled, false);
  assert.equal(outcome.result.status, 403);
  assert.equal(outcome.result.body.error.code, 'CSRF_INVALID');
});

test('browser security rejects cross-site authenticated mutation before authentication forwarding', () => {
  const outcome = run({
    origin: 'https://evil.example',
    'sec-fetch-site': 'cross-site',
    cookie: 'access_token=opaque-session; XSRF-TOKEN=csrf-123',
    'x-xsrf-token': 'csrf-123'
  });
  assert.equal(outcome.nextCalled, false);
  assert.equal(outcome.result.status, 403);
  assert.equal(outcome.result.body.error.code, 'CSRF_CROSS_SITE_BLOCKED');
});

test('browser security blocks login CSRF from an untrusted origin even without a session', () => {
  const outcome = run({
    origin: 'https://evil.example',
    'sec-fetch-site': 'cross-site'
  });
  assert.equal(outcome.nextCalled, false);
  assert.equal(outcome.result.status, 403);
});

test('browser security allows anonymous login from the configured application origin', () => {
  const outcome = run({
    origin: 'https://pharma-ui.onrender.com',
    'sec-fetch-site': 'same-origin'
  });
  assert.equal(outcome.nextCalled, true);
  assert.equal(outcome.result, null);
});

test('browser security allows trusted cross-origin SPA authentication exchange', () => {
  const outcome = run({
    origin: 'https://pharma-ui.onrender.com',
    'sec-fetch-site': 'cross-site'
  });
  assert.equal(outcome.nextCalled, true);
  assert.equal(outcome.result, null);
});

test('trusted cross-origin authenticated mutation still requires the CSRF proof', () => {
  const outcome = run({
    origin: 'https://pharma-ui.onrender.com',
    'sec-fetch-site': 'cross-site',
    cookie: 'access_token=opaque-session; XSRF-TOKEN=csrf-123',
    'x-xsrf-token': 'csrf-123'
  });
  assert.equal(outcome.nextCalled, true);
  assert.equal(outcome.result, null);
});

test('safe catalog reads do not require browser CSRF metadata', () => {
  const outcome = run({}, 'GET');
  assert.equal(outcome.nextCalled, true);
  assert.equal(outcome.result, null);
});
