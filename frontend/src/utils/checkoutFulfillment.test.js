import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFulfillmentQuoteItems, getCheckoutQuoteEffectAction } from './checkoutFulfillment.js';

const plan = {
  customerDecisionRequired: true,
  lines: [
    { productId: 'medicine-a', fulfilNowQuantity: 2, waitingQuantity: 3, alternatives: [
      { productId: 'alternative-a', availableQuantity: 3, requiresPharmacistApproval: false },
      { productId: 'alternative-rx', availableQuantity: 3, requiresPharmacistApproval: true }
    ] },
    { productId: 'medicine-b', fulfilNowQuantity: 0, waitingQuantity: 4, alternatives: [] }
  ]
};

test('confirmed split fulfilment preserves its quote instead of clearing it with the original cart quote', () => {
  assert.equal(getCheckoutQuoteEffectAction({
    isOpen: true, cartLength: 2, fulfillmentPlan: plan, fulfillmentConfirmed: true
  }), 'preserve');
});

test('ordinary checkout quote refreshes before split choices are confirmed', () => {
  assert.equal(getCheckoutQuoteEffectAction({
    isOpen: true, cartLength: 2, fulfillmentPlan: plan, fulfillmentConfirmed: false
  }), 'refresh');
});

test('checkout quote clears only when the modal closes or the cart becomes empty', () => {
  assert.equal(getCheckoutQuoteEffectAction({
    isOpen: false, cartLength: 2, fulfillmentPlan: plan, fulfillmentConfirmed: true
  }), 'clear');
  assert.equal(getCheckoutQuoteEffectAction({
    isOpen: true, cartLength: 0, fulfillmentPlan: plan, fulfillmentConfirmed: true
  }), 'clear');
});

test('quote includes available quantities and explicitly selected alternatives only', () => {
  assert.deepEqual(buildFulfillmentQuoteItems(plan, { 'medicine-a': 'alternative-a' }), [
    { medicineId: 'medicine-a', quantity: 2 },
    { medicineId: 'alternative-a', quantity: 3 }
  ]);
});

test('wait-original and remove choices do not add unavailable stock to the payable quote', () => {
  assert.deepEqual(buildFulfillmentQuoteItems(plan, { 'medicine-a': 'REMOVE' }), [
    { medicineId: 'medicine-a', quantity: 2 }
  ]);
  assert.deepEqual(buildFulfillmentQuoteItems(plan, {}), [
    { medicineId: 'medicine-a', quantity: 2 }
  ]);
});

test('pharmacist-approval alternatives are excluded from customer checkout quotes', () => {
  assert.deepEqual(buildFulfillmentQuoteItems(plan, { 'medicine-a': 'alternative-rx' }), [
    { medicineId: 'medicine-a', quantity: 2 }
  ]);
});
