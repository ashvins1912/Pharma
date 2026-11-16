import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import test from 'node:test';

const testMongoUri = process.env.INVENTORY_TEST_MONGO_URI;
process.env.SERVICE_AUTH_SECRET = process.env.SERVICE_AUTH_SECRET || 'test-only-inventory-service-secret-1234567890';
process.env.INVENTORY_MONGO_URI = testMongoUri || 'mongodb://127.0.0.1:27017/pharma-inventory-batch-test';

const [{ Product, Inventory, Reservation, Audit }, { lookupInventory, searchInventoryProducts, createProduct, updateProduct, archiveProduct, reserveInventory, transitionReservation }] = await Promise.all([
  import('./src/models.js'),
  import('./src/inventory.js')
]);

test('inventory lookup aggregates active batches and reservation allocates/releases/deducts FEFO across batches', {
  skip: !testMongoUri,
  timeout: 60000
}, async () => {
  const databaseName = `inventory_batches_${randomUUID().replace(/-/g, '')}`;
  const tenantId = `tenant-${randomUUID()}`;
  const branchId = `branch-${randomUUID()}`;
  await mongoose.connect(testMongoUri, { dbName: databaseName, serverSelectionTimeoutMS: 10000 });
  await Promise.all([Product.init(), Inventory.init(), Reservation.init(), Audit.init()]);

  try {
    const product = await Product.create({
      tenantId, sku: 'BATCH-STOCK-001', name: 'Batch Stock Test Medicine', active: true, version: 1, discountPercentage: 10, baseCostPrice: 7, marginTier: 'MID'
    });
    const today = new Date(new Date().toISOString().slice(0, 10));
    const firstExpiry = new Date(today); firstExpiry.setUTCDate(firstExpiry.getUTCDate() + 30);
    const secondExpiry = new Date(today); secondExpiry.setUTCDate(secondExpiry.getUTCDate() + 60);
    const expiredDate = new Date(today); expiredDate.setUTCDate(expiredDate.getUTCDate() - 1);
    await Inventory.create([
      { tenantId, branchId, productId: product._id, sku: product.sku, batchNumber: 'LOT-FEFO-1', stockQuantity: 5, reservedQuantity: 0, price: 10, expiryDate: firstExpiry },
      { tenantId, branchId, productId: product._id, sku: product.sku, batchNumber: 'LOT-FEFO-2', stockQuantity: 10, reservedQuantity: 0, price: 11, expiryDate: secondExpiry },
      { tenantId, branchId, productId: product._id, sku: product.sku, batchNumber: 'LOT-EXPIRED', stockQuantity: 100, reservedQuantity: 0, price: 1, expiryDate: expiredDate },
      { tenantId, branchId: 'different-branch', productId: product._id, sku: product.sku, batchNumber: 'OTHER-BRANCH', stockQuantity: 50, reservedQuantity: 0, price: 2, expiryDate: secondExpiry }
    ]);

    await assert.rejects(() => lookupInventory({ skus: [product.sku] }), error => error.statusCode === 403);
    await assert.rejects(() => searchInventoryProducts({ query: 'Batch Stock Test' }), error => error.statusCode === 403);
    const lookup = await lookupInventory({ skus: [product.sku], tenantId, branchId });
    assert.equal(lookup.length, 1);
    assert.equal(lookup[0].stockQuantity, 15);
    assert.equal(lookup[0].availableQuantity, 15);
    assert.equal(lookup[0].batchCount, 2);
    assert.deepEqual(lookup[0].batchAvailability.map(batch => batch.batchNumber), ['LOT-FEFO-1', 'LOT-FEFO-2']);
    const search = await searchInventoryProducts({ tenantId, branchId, query: 'Batch Stock Test' });
    assert.equal(search.items[0].stockQuantity, 15);
    assert.equal(search.items[0].availableQuantity, 15);
    assert.equal(search.items[0].batchCount, 2);
    assert.equal(search.items[0].basePrice, 10);
    assert.equal(search.items[0].sellingPrice, 9);
    assert.equal(search.items[0].discountPercentage, 10);
    const alertSearch = await searchInventoryProducts({
      tenantId, branchId, query: 'Batch Stock Test', includeOutOfStock: true, includeExpiredBatches: true
    });
    assert.equal(alertSearch.items[0].availableQuantity, 15);
    assert.equal(alertSearch.items[0].expiredStockQuantity, 100);
    assert.deepEqual(alertSearch.items[0].expiredBatchAvailability.map(batch => batch.batchNumber), ['LOT-EXPIRED']);
    const otherBranchLookup = await lookupInventory({ skus: [product.sku], tenantId, branchId: 'different-branch' });
    assert.equal(otherBranchLookup[0].availableQuantity, 50);

    const reservation = await reserveInventory({
      orderId: 'ORD-BATCH-FEFO-1',
      items: [{ productId: String(product._id), quantity: 12 }],
      tenantId, branchId,
      idempotencyKey: 'batch-fefo-reserve-1',
      actor: 'inventory-batch-test'
    });
    assert.equal(reservation.status, 'RESERVED');
    const stored = await Reservation.findOne({ reservationId: reservation.reservationId }).lean();
    assert.deepEqual(stored.items[0].allocations.map(allocation => allocation.quantity), [5, 7]);
    assert.deepEqual(stored.items[0].allocations.map(allocation => allocation.batchNumber), ['LOT-FEFO-1', 'LOT-FEFO-2']);

    let afterReserve = await lookupInventory({ productIds: [String(product._id)], tenantId, branchId });
    assert.equal(afterReserve[0].availableQuantity, 3);
    await transitionReservation(reservation.reservationId, 'RELEASED', { tenantId, branchId, actor: 'inventory-batch-test' });
    let afterRelease = await lookupInventory({ productIds: [String(product._id)], tenantId, branchId });
    assert.equal(afterRelease[0].availableQuantity, 15);

    const secondReservation = await reserveInventory({
      orderId: 'ORD-BATCH-FEFO-2',
      items: [{ productId: String(product._id), quantity: 12 }],
      tenantId, branchId,
      idempotencyKey: 'batch-fefo-reserve-2',
      actor: 'inventory-batch-test'
    });
    await transitionReservation(secondReservation.reservationId, 'DEDUCTED', { tenantId, branchId, actor: 'inventory-batch-test' });
    const afterDeduct = await lookupInventory({ productIds: [String(product._id)], tenantId, branchId });
    assert.equal(afterDeduct[0].stockQuantity, 3);
    assert.equal(afterDeduct[0].reservedQuantity, 0);
    assert.equal(afterDeduct[0].availableQuantity, 3);

    const otherTenantLookup = await lookupInventory({ skus: [product.sku], tenantId: 'different-tenant', branchId });
    assert.equal(otherTenantLookup.length, 0);

    const manuallyCreated = await createProduct({
      tenantId, branchId, actor: 'inventory-batch-test',
      product: {
        name: 'Manual Product Test', sku: 'MANUAL-CREATE-001', brand: 'Test Labs',
        drug: 'Test Ingredient', category: 'General Medicine',
        price: 8, stockQuantity: 2, batchNumber: 'MANUAL-LOT', discountPercentage: 5
      }
    });
    assert.equal(manuallyCreated.sku, 'MANUAL-CREATE-001');
    assert.equal(manuallyCreated.availableQuantity, 2);
    assert.equal(manuallyCreated.discountPercentage, 5);
    const manuallyUpdated = await updateProduct({
      productId: manuallyCreated.productId, tenantId, branchId, actor: 'inventory-batch-test',
      product: { name: 'Manual Product Updated', batchNumber: 'MANUAL-LOT', price: 9, stockQuantity: 4 }
    });
    assert.equal(manuallyUpdated.name, 'Manual Product Updated');
    assert.equal(manuallyUpdated.availableQuantity, 4);
    const archived = await archiveProduct({
      productId: manuallyCreated.productId, tenantId, branchId, actor: 'inventory-batch-test'
    });
    assert.equal(archived.active, false);
    assert.equal((await lookupInventory({ productIds: [manuallyCreated.productId], tenantId, branchId })).length, 0);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});


test('reservation concurrency prevents overselling and scopes idempotency by tenant and branch', {
  skip: !testMongoUri,
  timeout: 60000
}, async () => {
  const databaseName = `inventory_concurrency_${randomUUID().replace(/-/g, '')}`;
  const tenantA = `tenant-a-${randomUUID()}`;
  const tenantB = `tenant-b-${randomUUID()}`;
  const branchId = 'branch-shared-name';
  await mongoose.connect(testMongoUri, { dbName: databaseName, serverSelectionTimeoutMS: 10000 });
  await Promise.all([Product.init(), Inventory.init(), Reservation.init(), Audit.init()]);

  try {
    const [productA, productB] = await Product.create([
      { tenantId: tenantA, sku: 'RACE-001', name: 'Concurrency Test A', active: true, version: 1 },
      { tenantId: tenantB, sku: 'RACE-001', name: 'Concurrency Test B', active: true, version: 1 }
    ]);
    await Inventory.create([
      { tenantId: tenantA, branchId, productId: productA._id, sku: productA.sku, batchNumber: 'A-LOT', stockQuantity: 1, reservedQuantity: 0, price: 10 },
      { tenantId: tenantB, branchId, productId: productB._id, sku: productB.sku, batchNumber: 'B-LOT', stockQuantity: 1, reservedQuantity: 0, price: 10 }
    ]);

    // The same caller-generated key is valid in two distinct tenant scopes.
    const scoped = await Promise.all([
      reserveInventory({ orderId: 'ORD-TENANT-A', items: [{ productId: String(productA._id), quantity: 1 }], tenantId: tenantA, branchId, idempotencyKey: 'same-client-key', actor: 'concurrency-test' }),
      reserveInventory({ orderId: 'ORD-TENANT-B', items: [{ productId: String(productB._id), quantity: 1 }], tenantId: tenantB, branchId, idempotencyKey: 'same-client-key', actor: 'concurrency-test' })
    ]);
    assert.equal(scoped.length, 2);
    assert.notEqual(scoped[0].reservationId, scoped[1].reservationId);

    const raceProduct = await Product.create({
      tenantId: tenantA, sku: 'RACE-002', name: 'Last Unit Race', active: true, version: 1
    });
    await Inventory.create({
      tenantId: tenantA, branchId, productId: raceProduct._id, sku: raceProduct.sku,
      batchNumber: 'ONE-UNIT', stockQuantity: 1, reservedQuantity: 0, price: 5
    });

    const attempts = await Promise.allSettled(Array.from({ length: 2 }, (_, index) => reserveInventory({
      orderId: `ORD-RACE-${index}`,
      items: [{ productId: String(raceProduct._id), quantity: 1 }],
      tenantId: tenantA,
      branchId,
      idempotencyKey: `race-key-${index}`,
      actor: 'concurrency-test'
    })));
    const accepted = attempts.filter(result => result.status === 'fulfilled');
    assert.equal(accepted.length, 1, 'only one reservation may claim the last unit');
    const storedStock = await Inventory.findOne({ tenantId: tenantA, branchId, productId: raceProduct._id }).lean();
    assert.equal(storedStock.reservedQuantity, 1);
    assert.ok(storedStock.reservedQuantity <= storedStock.stockQuantity);
    assert.equal(await Reservation.countDocuments({ tenantId: tenantA, branchId, orderId: /^ORD-RACE-/ }), 1);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
