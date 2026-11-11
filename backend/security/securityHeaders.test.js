import assert from 'node:assert/strict';
import test from 'node:test';
import { applySecurityHeaders } from './securityHeaders.js';

function run(production) {
  const headers = {};
  let nextCalled = false;
  applySecurityHeaders({}, { setHeader: (name, value) => { headers[name.toLowerCase()] = value; } }, () => { nextCalled = true; }, { production });
  return { headers, nextCalled };
}

test('production gateway applies HSTS and browser hardening headers', () => {
  const { headers, nextCalled } = run(true);
  assert.equal(nextCalled, true);
  assert.equal(headers['strict-transport-security'], 'max-age=31536000');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(headers['permissions-policy'], /geolocation=\(self\)/);
});

test('development does not pin localhost to HTTPS', () => {
  const { headers } = run(false);
  assert.equal(headers['strict-transport-security'], undefined);
});
