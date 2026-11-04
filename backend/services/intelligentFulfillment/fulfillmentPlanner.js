const physicalStock = medicine => Number(medicine?.stockQuantity ?? medicine?.stock ?? medicine?.quantity ?? 0);
const reservedStock = medicine => Number(medicine?.reservedQuantity || 0);
const availableStock = medicine => Math.max(0, physicalStock(medicine) - reservedStock(medicine));
const roundMoney = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const normalized = value => String(value || '').trim().toLowerCase().replace(/\\s+/g, ' ');

const isSellable = (medicine, now) => medicine
  && medicine.isActive !== false
  && (!medicine.expiryDate || new Date(medicine.expiryDate) > now)
  && availableStock(medicine) > 0;

const scoreAlternative = (requested, candidate) => {
  const requestedComposition = normalized(requested.composition || requested.genericName);
  const unknownCompositions = new Set(['active compound', 'unknown', 'not specified', 'n/a', 'na']);
  if (!requestedComposition || unknownCompositions.has(requestedComposition)) return null;
  const candidateComposition = normalized(candidate.composition || candidate.genericName);
  const requestedStrength = normalized(requested.strength);
  const candidateStrength = normalized(candidate.strength);
  const requestedForm = normalized(requested.dosageForm || requested.form);
  const candidateForm = normalized(candidate.dosageForm || candidate.form);
  // Clinical equivalence is deliberately conservative: composition and strength
  // must be known and identical. Missing metadata is never treated as a match.
  if (!candidateComposition || unknownCompositions.has(candidateComposition) || requestedComposition !== candidateComposition) return null;
  if (!requestedStrength || !candidateStrength || requestedStrength !== candidateStrength) return null;
  if (!requestedForm || !candidateForm || requestedForm !== candidateForm) return null;
  if (Boolean(requested.requiresPrescription) !== Boolean(candidate.requiresPrescription ?? candidate.isPrescriptionRequired)) return null;
  const price = Number(candidate.price || 0);
  if (!Number.isFinite(price) || price < 0) return null;
  return {
    productId: String(candidate._id),
    name: candidate.name,
    brand: candidate.brand || candidate.manufacturer || '',
    composition: candidate.composition || candidate.genericName || '',
    strength: candidate.strength || '',
    dosageForm: candidate.dosageForm || candidate.form || '',
    unitPrice: price,
    availableQuantity: availableStock(candidate),
    discountPercentage: Math.min(100, Math.max(0, Number(candidate.discountPercentage || 0))),
    discountedUnitPrice: roundMoney(price * (1 - Math.min(100, Math.max(0, Number(candidate.discountPercentage || 0))) / 100)),
    requiresPharmacistApproval: Boolean(requested.requiresPrescription || candidate.requiresPrescription || candidate.isPrescriptionRequired),
    substitutionRequiresCustomerConsent: true
  };
};

export function buildIntelligentFulfillmentPlan({ requestedItems, inventory, catalog = [], now = new Date() }) {
  if (!Array.isArray(requestedItems) || !requestedItems.length) {
    throw Object.assign(new Error('At least one order item is required.'), { statusCode: 400 });
  }
  const inventoryById = new Map((inventory || []).map(item => [String(item._id), item]));
  const seen = new Map();
  for (const item of requestedItems) {
    const productId = String(item.medicineId || item.productId || item._id || '');
    const quantity = Number(item.quantity);
    if (!productId || !Number.isSafeInteger(quantity) || quantity < 1) {
      throw Object.assign(new Error('Every item needs a product ID and a positive whole-number quantity.'), { statusCode: 400 });
    }
    seen.set(productId, (seen.get(productId) || 0) + quantity);
  }
  const lines = [];
  for (const [productId, requestedQuantity] of seen) {
    const medicine = inventoryById.get(productId);
    if (!medicine) {
      lines.push({ productId, requestedQuantity, availableQuantity: 0, fulfilNowQuantity: 0, waitingQuantity: requestedQuantity, availability: 'NOT_FOUND', alternatives: [] });
      continue;
    }
    const sellable = isSellable(medicine, now);
    const available = sellable ? availableStock(medicine) : 0;
    const fulfilNowQuantity = Math.min(requestedQuantity, available);
    const waitingQuantity = requestedQuantity - fulfilNowQuantity;
    const alternatives = waitingQuantity > 0
      ? (catalog || [])
          .filter(candidate => String(candidate._id) !== productId && isSellable(candidate, now))
          .map(candidate => scoreAlternative(medicine, candidate))
          .filter(Boolean)
          .sort((a, b) => a.discountedUnitPrice - b.discountedUnitPrice || b.availableQuantity - a.availableQuantity)
          .slice(0, 5)
      : [];
    lines.push({
      productId,
      name: medicine.name,
      sku: medicine.sku || medicine.code || '',
      requestedQuantity,
      availableQuantity: available,
      fulfilNowQuantity,
      waitingQuantity,
      availability: waitingQuantity === 0 ? 'AVAILABLE' : fulfilNowQuantity > 0 ? 'PARTIAL' : sellable ? 'OUT_OF_STOCK' : 'UNSELLABLE',
      unitPrice: Number(medicine.price || 0),
      alternatives
    });
  }
  const immediateLines = lines.filter(line => line.fulfilNowQuantity > 0);
  const waitingLines = lines.filter(line => line.waitingQuantity > 0);
  return {
    version: 1,
    generatedAt: now.toISOString(),
    strategy: 'AVAILABLE_FIRST_WITH_CUSTOMER_CONSENT',
    canPlacePartialOrder: immediateLines.length > 0,
    lines,
    summary: {
      totalDistinctProducts: lines.length,
      fullyAvailable: lines.filter(line => line.availability === 'AVAILABLE').length,
      partiallyAvailable: lines.filter(line => line.availability === 'PARTIAL').length,
      unavailable: lines.filter(line => line.waitingQuantity > 0).length,
      quantityRequested: lines.reduce((sum, line) => sum + line.requestedQuantity, 0),
      quantityAvailableNow: lines.reduce((sum, line) => sum + line.fulfilNowQuantity, 0),
      quantityWaiting: lines.reduce((sum, line) => sum + line.waitingQuantity, 0)
    },
    customerDecisionRequired: waitingLines.length > 0,
    safety: {
      stockIsNotReservedByPreview: true,
      alternativesRequireExplicitCustomerConsent: true,
      prescriptionSubstitutionsRequirePharmacistApproval: true
    }
  };
}

export function validateWaitWindow(days) {
  const value = Number(days);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw Object.assign(new Error('Choose a stock wait period from 1 to 5 days.'), { statusCode: 400 });
  }
  const waitUntil = new Date(Date.now() + value * 24 * 60 * 60 * 1000);
  return { waitDays: value, waitUntil };
}
