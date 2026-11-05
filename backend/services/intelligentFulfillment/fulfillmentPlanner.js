const physicalStock = medicine => Number(medicine?.stockQuantity ?? medicine?.stock ?? medicine?.quantity ?? 0);
const reservedStock = medicine => Number(medicine?.reservedQuantity || 0);
const availableStock = medicine => Math.max(0, physicalStock(medicine) - reservedStock(medicine));
const roundMoney = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const normalized = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

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
  if (Boolean(requested.requiresPrescription || requested.isPrescriptionRequired) !== Boolean(candidate.requiresPrescription || candidate.isPrescriptionRequired)) return null;
  const price = Number(candidate.price || 0);
  if (!Number.isFinite(price) || price < 0) return null;
  const listPrice = Math.max(price, Number(candidate.basePrice ?? price));
  const configuredDiscount = Math.min(100, Math.max(0, Number(candidate.discountPercentage || 0)));
  const derivedDiscount = listPrice > price
    ? Math.round((1 - price / listPrice) * 10000) / 100
    : 0;
  const discountPercentage = configuredDiscount > 0 ? configuredDiscount : derivedDiscount;
  const discountedUnitPrice = roundMoney(price * (1 - discountPercentage / 100));
  return {
    productId: String(candidate._id),
    name: candidate.name,
    brand: candidate.brand || candidate.manufacturer || '',
    composition: candidate.composition || candidate.genericName || '',
    strength: candidate.strength || '',
    dosageForm: candidate.dosageForm || candidate.form || '',
    unitPrice: price,
    availableQuantity: availableStock(candidate),
    listPrice,
    discountPercentage,
    discountedUnitPrice,
    requiresPharmacistApproval: Boolean(requested.requiresPrescription || requested.isPrescriptionRequired || candidate.requiresPrescription || candidate.isPrescriptionRequired),
    substitutionRequiresCustomerConsent: true
  };
};

export function buildIntelligentFulfillmentPlan({ requestedItems, inventory, catalog = [], now = new Date() }) {
  if (!Array.isArray(requestedItems) || !requestedItems.length) {
    throw Object.assign(new Error('At least one order item is required.'), { statusCode: 400 });
  }
  const inventoryById = new Map((inventory || []).map(item => [String(item._id), item]));
  const seen = new Map();
  const descriptorsById = new Map();
  for (const [itemIndex, item] of requestedItems.entries()) {
    const productId = String(item.medicineId || item.productId || item._id || (item.requestedName ? `request-line-${itemIndex + 1}` : ''));
    const quantity = Number(item.quantity);
    if (!productId || !Number.isSafeInteger(quantity) || quantity < 1) {
      throw Object.assign(new Error('Every item needs a product ID and a positive whole-number quantity.'), { statusCode: 400 });
    }
    if (!descriptorsById.has(productId)) descriptorsById.set(productId, item);
    seen.set(productId, (seen.get(productId) || 0) + quantity);
  }
  const lines = [];
  for (const [productId, requestedQuantity] of seen) {
    const descriptor = descriptorsById.get(productId) || {};
    const medicine = inventoryById.get(productId) || {
      _id: productId,
      name: descriptor.requestedName || descriptor.name || 'Requested medicine',
      composition: descriptor.composition || '',
      genericName: descriptor.genericName || '',
      strength: descriptor.strength || '',
      dosageForm: descriptor.dosageForm || descriptor.form || '',
      requiresPrescription: Boolean(descriptor.requiresPrescription || descriptor.isPrescriptionRequired),
      price: 0
    };
    const isListed = inventoryById.has(productId);
    const sellable = isListed && isSellable(medicine, now);
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
      availability: waitingQuantity === 0 ? 'AVAILABLE' : fulfilNowQuantity > 0 ? 'PARTIAL' : isListed ? 'OUT_OF_STOCK' : 'NOT_LISTED',
      unitPrice: Number(medicine.price || 0),
      composition: medicine.composition || medicine.genericName || '',
      strength: medicine.strength || '',
      dosageForm: medicine.dosageForm || medicine.form || '',
      isListed,
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
