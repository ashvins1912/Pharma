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
      medicine({ _id: 'alternative-good', name: 'Generic equivalent', stockQuantity: 8, reservedQuantity: 0, price: 80, discountPercentage: 10 }),
      medicine({ _id: 'alternative-wrong-strength', strength: '250 mg' }),
      medicine({ _id: 'alternative-wrong-composition', composition: 'different salt' }),
      medicine({ _id: 'alternative-expired', expiryDate: new Date('2026-01-01T00:00:00.000Z') })
    ],
    now
  });
  assert.deepEqual(plan.lines[0].alternatives.map(item => item.productId), ['alternative-good']);
  assert.equal(plan.lines[0].alternatives[0].discountedUnitPrice, 72);
  assert.equal(plan.lines[0].alternatives[0].substitutionRequiresCustomerConsent, true);
});

test('does not treat expired or inactive stock as sellable', () => {
  const plan = buildIntelligentFulfillmentPlan({
    requestedItems: [{ medicineId: 'medicine-1', quantity: 1 }],
    inventory: [medicine({ isActive: false })],
    now
  });
  assert.equal(plan.lines[0].availableQuantity, 0);
  assert.equal(plan.lines[0].availability, 'UNSELLABLE');
});

test('validates customer wait windows from one to five days', () => {
  for (const days of [1, 2, 3, 4, 5]) assert.equal(validateWaitWindow(days).waitDays, days);
  for (const days of [0, 6, 1.5, 'tomorrow']) {
    assert.throws(() => validateWaitWindow(days), /1 to 5 days/);
  }
});

test('rejects invalid cart lines and empty plans', () => {
  assert.throws(() => buildIntelligentFulfillmentPlan({ requestedItems: [], inventory: [] }), /At least one order item/);
  assert.throws(() => buildIntelligentFulfillmentPlan({ requestedItems: [{ medicineId: 'x', quantity: 0 }], inventory: [] }), /positive whole-number/);
});
