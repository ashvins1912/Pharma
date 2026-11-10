import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckoutWaitlistRequest, buildFulfillmentQuoteItems, getCheckoutQuoteEffectAction } from './checkoutFulfillment.js';

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

test('waiting-only fulfilment produces an empty payable quote basket', () => {
  const waitingOnlyPlan = {
    customerDecisionRequired: true,
    lines: [{ productId: 'medicine-out', fulfilNowQuantity: 0, waitingQuantity: 5, alternatives: [] }]
  };
  assert.deepEqual(buildFulfillmentQuoteItems(waitingOnlyPlan, {}), []);
});


test('partial-stock checkout sends the selected wait window and required idempotency header', () => {
  const request = buildCheckoutWaitlistRequest({
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    sourceType: 'CHECKOUT',
    items: [{ productId: 'medicine-a', requestedQuantity: 2 }],
    waitDays: 4
  }, 'waitlist-attempt-1');

  assert.equal(request.body.waitDays, 4);
  assert.deepEqual(request.body.items, [{ productId: 'medicine-a', requestedQuantity: 2 }]);
  assert.equal(request.config.headers['Idempotency-Key'], 'waitlist-attempt-1');
});

test('checkout waitlist request rejects a missing wait window or idempotency key', () => {
  assert.throws(() => buildCheckoutWaitlistRequest({ waitDays: undefined }, 'wait-key'), /1 to 5 days/);
  assert.throws(() => buildCheckoutWaitlistRequest({ waitDays: 3 }, ''), /idempotency key/);
});


test('treats timeout, abort, network loss and server errors as ambiguous checkout outcomes', async () => {
  const { isCheckoutOutcomeAmbiguous } = await import('./checkoutFulfillment.js');
  assert.equal(isCheckoutOutcomeAmbiguous({ code: 'ECONNABORTED' }), true);
  assert.equal(isCheckoutOutcomeAmbiguous({ code: 'ERR_CANCELED' }), true);
  assert.equal(isCheckoutOutcomeAmbiguous({ code: 'ERR_NETWORK' }), true);
  assert.equal(isCheckoutOutcomeAmbiguous({ response: { status: 504 } }), true);
  assert.equal(isCheckoutOutcomeAmbiguous({ response: { status: 408 } }), true);
});

test('treats explicit client validation responses as definite checkout failures', async () => {
  const { isCheckoutOutcomeAmbiguous } = await import('./checkoutFulfillment.js');
  assert.equal(isCheckoutOutcomeAmbiguous({ response: { status: 400 } }), false);
  assert.equal(isCheckoutOutcomeAmbiguous({ response: { status: 409 } }), false);
});
