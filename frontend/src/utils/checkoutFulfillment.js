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
