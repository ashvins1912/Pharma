import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import test from 'node:test';

const testMongoUri = process.env.INVENTORY_TEST_MONGO_URI;
process.env.SERVICE_AUTH_SECRET = process.env.SERVICE_AUTH_SECRET || 'test-only-inventory-service-secret-1234567890';
process.env.INVENTORY_MONGO_URI = testMongoUri || 'mongodb://127.0.0.1:27017/pharma-inventory-batch-test';

const [{ Product, Inventory, Reservation, Audit }, { lookupInventory, reserveInventory, transitionReservation }] = await Promise.all([
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
      tenantId, sku: 'BATCH-STOCK-001', name: 'Batch Stock Test Medicine', active: true, version: 1
    });
    const today = new Date(new Date().toISOString().slice(0, 10));
    const firstExpiry = new Date(today); firstExpiry.setUTCDate(firstExpiry.getUTCDate() + 30);
    const secondExpiry = new Date(today); secondExpiry.setUTCDate(secondExpiry.getUTCDate() + 60);
    const expiredDate = new Date(today); expiredDate.setUTCDate(expiredDate.getUTCDate() - 1);
    await Inventory.create([
      { tenantId, branchId, productId: product._id, sku: product.sku, batchNumber: 'LOT-FEFO-1', stockQuantity: 5, reservedQuantity: 0, price: 10, expiryDate: firstExpiry },
      { tenantId, branchId, productId: product._id, sku: product.sku, batchNumber: 'LOT-FEFO-2', stockQuantity: 10, reservedQuantity: 0, price: 11, expiryDate: secondExpiry },
      { tenantId, branchId, productId: product._id, sku: product.sku, batchNumber: 'LOT-EXPIRED', stockQuantity: 100, reservedQuantity: 0, price: 1, expiryDate: expiredDate }
      { tenantId, branchId: 'different-branch', productId: product._id, sku: product.sku, batchNumber: 'OTHER-BRANCH', stockQuantity: 50, reservedQuantity: 0, price: 2, expiryDate: secondExpiry }
    ]);

    const lookup = await lookupInventory({ skus: [product.sku], tenantId, branchId });
    assert.equal(lookup.length, 1);
    assert.equal(lookup[0].stockQuantity, 15);
    assert.equal(lookup[0].availableQuantity, 15);
    assert.equal(lookup[0].batchCount, 2);
    assert.deepEqual(lookup[0].batchAvailability.map(batch => batch.batchNumber), ['LOT-FEFO-1', 'LOT-FEFO-2']);

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
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
