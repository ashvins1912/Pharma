import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SERVICE_AUTH_SECRET = 'test-service-secret-with-more-than-thirty-two-characters';

const [
  { createServiceToken, requireServiceScope },
  { classifyImportError, normalizeImportRow },
  { normalizeItems }
] = await Promise.all([
  import('./src/service-auth.js'),
  import('./src/imports.js'),
  import('./src/inventory.js')
]);

const runMiddleware = (middleware, authorization) => new Promise(resolve => {
  const result = { statusCode: 200, body: null, calledNext: false };
  middleware({
    get: name => name.toLowerCase() === 'authorization' ? authorization : undefined
  }, {
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(body) {
      result.body = body;
      resolve(result);
    }
  }, () => {
    result.calledNext = true;
    resolve(result);
  });
});

test('service JWT scope is limited by authenticated caller identity', async () => {
  const allowedToken = createServiceToken({
    caller: 'order-service',
    scopes: ['inventory.reserve']
  });
  const allowed = await runMiddleware(requireServiceScope('inventory.reserve'), `Bearer ${allowedToken}`);
  assert.equal(allowed.calledNext, true);

  const deniedToken = createServiceToken({
    caller: 'medicine-request-service',
    scopes: ['inventory.read']
  });
  const denied = await runMiddleware(requireServiceScope('inventory.reserve'), `Bearer ${deniedToken}`);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.calledNext, false);
});

test('service JWT issuer rejects callers requesting ungranted scopes', () => {
  assert.throws(() => createServiceToken({
    caller: 'medicine-request-service',
    scopes: ['inventory.adjust']
  }), /not permitted/i);
});

test('inventory import validates SKU, price, stock, and product metadata', () => {
  const normalized = normalizeImportRow({
    SKU: 'med-123',
    'Medicine Name': 'Paracetamol 500mg',
    Price: '45',
    Stock: '10',
    Manufacturer: 'Example Pharma'
  });
  assert.equal(normalized.error, undefined);
  assert.equal(normalized.value.sku, 'MED-123');
  assert.equal(normalized.value.stockQuantity, 10);
  assert.equal(normalized.value.manufacturer, 'Example Pharma');

  const invalid = normalizeImportRow({ SKU: 'BAD', 'Medicine Name': 'Invalid', Price: 'NaN', Stock: -1 });
  assert.equal(invalid.errorType, 'VALIDATION_ERROR');
  assert.match(invalid.error, /price/i);
});

test('inventory import retries only classified transient storage failures', () => {
  assert.equal(classifyImportError({ name: 'MongoNetworkTimeoutError' }).retryable, true);
  assert.equal(classifyImportError({ code: 121 }).retryable, false);
  assert.equal(classifyImportError({ code: 11000 }).errorType, 'DUPLICATE_ERROR');
  assert.equal(classifyImportError({ code: 11000 }).retryable, false);
});

test('reservation input normalizes duplicate product IDs and rejects unsafe totals', () => {
  const productId = 'ABCDEFABCDEFABCDEFABCDEF';
  assert.deepEqual(normalizeItems([
    { productId, quantity: 2 },
    { productId: productId.toLowerCase(), quantity: 3 }
  ]), [{ productId: productId.toLowerCase(), quantity: 5 }]);
  assert.throws(() => normalizeItems([
    { productId, quantity: Number.MAX_SAFE_INTEGER },
    { productId, quantity: 1 }
  ]), /supported range/i);
});
