import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntelligentFulfillmentPlan, validateWaitWindow } from './services/intelligentFulfillment/fulfillmentPlanner.js';

const now = new Date('2026-11-05T10:00:00.000Z');
const medicine = (overrides = {}) => ({
  _id: 'medicine-1', name: 'Example 500 mg', composition: 'example salt', strength: '500 mg',
  dosageForm: 'tablet', price: 100, stockQuantity: 10, reservedQuantity: 2,
  expiryDate: new Date('2027-12-31T00:00:00.000Z'), isActive: true,
  requiresPrescription: false, ...overrides
});

test('splits requested quantity into available and waiting quantities without reserving stock', () => {
  const plan = buildIntelligentFulfillmentPlan({
    requestedItems: [{ medicineId: 'medicine-1', quantity: 12 }],
    inventory: [medicine()],
    now
  });
  assert.equal(plan.lines[0].availableQuantity, 8);
  assert.equal(plan.lines[0].fulfilNowQuantity, 8);
  assert.equal(plan.lines[0].waitingQuantity, 4);
  assert.equal(plan.lines[0].availability, 'PARTIAL');
  assert.equal(plan.safety.stockIsNotReservedByPreview, true);
});

test('matches Inventory Service lookup rows keyed by productId', () => {
  const lookupRow = {
    productId: 'medicine-1', name: 'Example 500 mg', composition: 'example salt',
    strength: '500 mg', form: 'tablet', price: 100,
    stockQuantity: 1, reservedQuantity: 0, availableQuantity: 1,
    expiryDate: new Date('2027-12-31T00:00:00.000Z')
  };
  const plan = buildIntelligentFulfillmentPlan({
    requestedItems: [{ medicineId: 'medicine-1', quantity: 1 }],
    inventory: [lookupRow],
    now
  });
  assert.equal(plan.lines[0].isListed, true);
  assert.equal(plan.lines[0].availableQuantity, 1);
  assert.equal(plan.lines[0].fulfilNowQuantity, 1);
  assert.equal(plan.lines[0].waitingQuantity, 0);
});

test('respects explicit availableQuantity over physicalStock when stock is in waiting', () => {
  const zeroAvailable = {
    productId: 'medicine-zero', name: 'Zero Stock Med', composition: 'salt a',
    strength: '500 mg', form: 'tablet', price: 100,
    stockQuantity: 5, reservedQuantity: 0, availableQuantity: 0,
    expiryDate: new Date('2027-12-31T00:00:00.000Z')
  };
  const partialAvailable = {
    productId: 'medicine-partial', name: 'Partial Stock Med', composition: 'salt b',
    strength: '250 mg', form: 'capsule', price: 50,
    stockQuantity: 10, reservedQuantity: 0, availableQuantity: 2,
    expiryDate: new Date('2027-12-31T00:00:00.000Z')
  };
  const plan = buildIntelligentFulfillmentPlan({
    requestedItems: [
      { medicineId: 'medicine-zero', quantity: 3 },
      { medicineId: 'medicine-partial', quantity: 5 }
    ],
    inventory: [zeroAvailable, partialAvailable],
    now
  });
  const zeroLine = plan.lines.find(l => l.productId === 'medicine-zero');
  assert.equal(zeroLine.availableQuantity, 0);
  assert.equal(zeroLine.fulfilNowQuantity, 0);
  assert.equal(zeroLine.waitingQuantity, 3);
  assert.equal(zeroLine.availability, 'OUT_OF_STOCK');

  const partialLine = plan.lines.find(l => l.productId === 'medicine-partial');
  assert.equal(partialLine.availableQuantity, 2);
  assert.equal(partialLine.fulfilNowQuantity, 2);
  assert.equal(partialLine.waitingQuantity, 3);
  assert.equal(partialLine.availability, 'PARTIAL');
});

test('aggregates duplicate cart lines before calculating availability', () => {
  const plan = buildIntelligentFulfillmentPlan({
    requestedItems: [
      { medicineId: 'medicine-1', quantity: 3 },
      { medicineId: 'medicine-1', quantity: 4 }
    ],
    inventory: [medicine({ stockQuantity: 5, reservedQuantity: 1 })],
    now
  });
  assert.equal(plan.lines.length, 1);
  assert.equal(plan.lines[0].requestedQuantity, 7);
  assert.equal(plan.lines[0].fulfilNowQuantity, 4);
  assert.equal(plan.lines[0].waitingQuantity, 3);
});

test('only proposes alternatives with matching composition, strength and compatible form', () => {
  const plan = buildIntelligentFulfillmentPlan({
    requestedItems: [{ medicineId: 'medicine-1', quantity: 2 }],
    inventory: [medicine({ stockQuantity: 0 })],
    catalog: [
      medicine({ _id: 'alternative-good', name: 'Generic equivalent', stockQuantity: 8, reservedQuantity: 0, price: 80, basePrice: 100, discountPercentage: 10 }),
      medicine({ _id: 'alternative-wrong-strength', strength: '250 mg' }),
      medicine({ _id: 'alternative-wrong-composition', composition: 'different salt' }),
      medicine({ _id: 'alternative-expired', expiryDate: new Date('2026-01-01T00:00:00.000Z') })
    ],
    now
  });
  assert.deepEqual(plan.lines[0].alternatives.map(item => item.productId), ['alternative-good']);
  assert.equal(plan.lines[0].alternatives[0].discountedUnitPrice, 80);
  assert.equal(plan.lines[0].alternatives[0].listPrice, 100);
  assert.equal(plan.lines[0].alternatives[0].discountPercentage, 20);
  assert.equal(plan.lines[0].alternatives[0].substitutionRequiresCustomerConsent, true);
});

test('applies a configured discount once when the candidate price is not already reduced', () => {
  const plan = buildIntelligentFulfillmentPlan({
    requestedItems: [{ medicineId: 'medicine-1', quantity: 1 }],
    inventory: [medicine({ stockQuantity: 0 })],
    catalog: [
      medicine({
        _id: 'configured-discount',
        stockQuantity: 5,
        reservedQuantity: 0,
        price: 100,
        basePrice: 100,
        discountPercentage: 10
      })
    ],
    now
  });
  const alternative = plan.lines[0].alternatives[0];
  assert.equal(alternative.listPrice, 100);
  assert.equal(alternative.discountPercentage, 10);
  assert.equal(alternative.discountedUnitPrice, 90);
});

test('does not treat expired or inactive stock as sellable', () => {
  const plan = buildIntelligentFulfillmentPlan({
    requestedItems: [{ medicineId: 'medicine-1', quantity: 1 }],
    inventory: [medicine({ isActive: false })],
    now
  });
  assert.equal(plan.lines[0].availableQuantity, 0);
  assert.equal(plan.lines[0].availability, 'OUT_OF_STOCK');
});

test('validates customer wait windows from one to five days', () => {
  for (const days of [1, 2, 3, 4, 5]) assert.equal(validateWaitWindow(days).waitDays, days);
  for (const days of [0, 6, 1.5, 'tomorrow']) {
    assert.throws(() => validateWaitWindow(days), /1 to 5 days/);
  }
});


test('supports unlisted medicine requests and offers only metadata-matched listed alternatives', () => {
  const plan = buildIntelligentFulfillmentPlan({
    requestedItems: [{
      requestedName: 'Requested generic tablet', composition: 'example salt',
      strength: '500 mg', dosageForm: 'tablet', quantity: 3
    }],
    inventory: [],
    catalog: [
      medicine({ _id: 'listed-equivalent', name: 'Listed equivalent', stockQuantity: 5, reservedQuantity: 0 }),
      medicine({ _id: 'wrong-form', dosageForm: 'capsule', stockQuantity: 5, reservedQuantity: 0 })
    ],
    now
  });
  assert.equal(plan.lines[0].availability, 'NOT_LISTED');
  assert.equal(plan.lines[0].waitingQuantity, 3);
  assert.deepEqual(plan.lines[0].alternatives.map(item => item.productId), ['listed-equivalent']);
});

test('does not propose alternatives when requested composition is a placeholder', () => {
  const plan = buildIntelligentFulfillmentPlan({
    requestedItems: [{
      medicineId: 'medicine-1', quantity: 1,
    }],
    inventory: [medicine({ stockQuantity: 0, composition: 'Active Compound' })],
    catalog: [medicine({ _id: 'other', stockQuantity: 5, reservedQuantity: 0 })],
    now
  });
  assert.equal(plan.lines[0].alternatives.length, 0);
});

test('rejects invalid cart lines and empty plans', () => {
  assert.throws(() => buildIntelligentFulfillmentPlan({ requestedItems: [], inventory: [] }), /At least one order item/);
  assert.throws(() => buildIntelligentFulfillmentPlan({ requestedItems: [{ medicineId: 'x', quantity: 0 }], inventory: [] }), /positive whole-number/);
});
