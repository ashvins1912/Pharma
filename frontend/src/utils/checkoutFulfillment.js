export function getCheckoutQuoteEffectAction({ isOpen, cartLength, fulfillmentPlan, fulfillmentConfirmed }) {
  if (!isOpen || cartLength === 0) return 'clear';
  if (fulfillmentPlan?.customerDecisionRequired && fulfillmentConfirmed) return 'preserve';
  return 'refresh';
}

export function buildFulfillmentQuoteItems(plan, choices = {}) {
  const items = [];
  for (const line of plan?.lines || []) {
    if (Number(line.fulfilNowQuantity) > 0) {
      items.push({ medicineId: String(line.productId), quantity: Number(line.fulfilNowQuantity) });
    }
    if (Number(line.waitingQuantity) > 0) {
      const choice = choices[line.productId];
      const alternative = line.alternatives?.find(item => String(item.productId) === String(choice));
      if (choice && choice !== 'REMOVE' && alternative
        && !alternative.requiresPharmacistApproval
        && Number(alternative.availableQuantity) >= Number(line.waitingQuantity)) {
        items.push({ medicineId: String(alternative.productId), quantity: Number(line.waitingQuantity) });
      }
    }
  }
  return items;
}

export function buildCheckoutWaitlistRequest(payload, idempotencyKey) {
  const waitDays = Number(payload?.waitDays);
  if (!Number.isInteger(waitDays) || waitDays < 1 || waitDays > 5) {
    throw new Error('Choose a stock wait period from 1 to 5 days.');
  }
  const key = String(idempotencyKey || '').trim();
  if (!key || key.length > 128) {
    throw new Error('A valid stock waitlist idempotency key is required.');
  }
  return {
    body: { ...payload, waitDays },
    config: { headers: { 'Idempotency-Key': key } }
  };
}


/**
 * A timeout, network failure, abort, gateway timeout, or server error does not
 * prove checkout failed: the server may have committed before its response was
 * lost. Preserve idempotency keys and any pre-created waitlist in those cases.
 */
export function isCheckoutOutcomeAmbiguous(error) {
  const status = Number(error?.response?.status || 0);
  if (status === 408 || status === 425 || status >= 500) return true;
  if (!error?.response) return true;
  return ['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED', 'ERR_NETWORK'].includes(String(error?.code || '').toUpperCase());
}
