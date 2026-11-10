const physicalStock = medicine => Number(medicine?.stockQuantity ?? medicine?.stock ?? medicine?.quantity ?? 0);
const reservedStock = medicine => Number(medicine?.reservedQuantity || 0);
const availableStock = medicine => {
  const explicitAvailable = medicine?.availableQuantity ?? medicine?.stockAvailable;
  if (explicitAvailable != null && Number.isFinite(Number(explicitAvailable))) {
    return Math.max(0, Number(explicitAvailable));
  }
  return Math.max(0, physicalStock(medicine) - reservedStock(medicine));
};
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
  // Inventory Service's price is the current selling price when it is below
  // basePrice. In that case the effective discount is already reflected in
  // price and must not be applied a second time. Only apply a configured
  // discount when no reduced selling price is present.
  const hasDiscountedSellingPrice = listPrice > price;
  const discountPercentage = hasDiscountedSellingPrice ? derivedDiscount : configuredDiscount;
  const discountedUnitPrice = hasDiscountedSellingPrice
    ? roundMoney(price)
    : roundMoney(price * (1 - discountPercentage / 100));
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
  // Inventory Service bulk lookup returns productId; older planner fixtures
  // and catalogue search results may expose _id. Normalize both identifiers.
  const inventoryById = new Map((inventory || []).map(item => [
    String(item.productId || item._id || item.medicineId || ''),
    item
  ]).filter(([id]) => id));
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


const validCoordinates = point => {
  const lat = Number(point?.latitude ?? point?.lat);
  const lng = Number(point?.longitude ?? point?.lng ?? point?.long);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
};

export function calculateRouteDistanceKm(origin, destination) {
  if (!validCoordinates(origin) || !validCoordinates(destination)) return null;
  const toRadians = degrees => degrees * Math.PI / 180;
  const lat1 = Number(origin.latitude ?? origin.lat);
  const lon1 = Number(origin.longitude ?? origin.lng ?? origin.long);
  const lat2 = Number(destination.latitude ?? destination.lat);
  const lon2 = Number(destination.longitude ?? destination.lng ?? destination.long);
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
}

/**
 * Select one active branch for a single-order checkout. The allocator maximizes
 * fulfillable quantity first, then fully-filled lines, then proximity and fee.
 * It deliberately does not split one order across branches: the current order
 * and reservation contracts are branch-scoped. Partial quantities remain on
 * the existing customer-consent waitlist path.
 */
export function buildDynamicFulfillmentRoute({
  requestedItems, branchCandidates, destination, preferredBranchId = null, now = new Date()
}) {
  const candidates = (Array.isArray(branchCandidates) ? branchCandidates : [])
    .filter(branch => branch?.branchId && Array.isArray(branch.inventory));
  if (!candidates.length) {
    throw Object.assign(new Error('No active branch has a verifiable inventory snapshot.'), { statusCode: 409 });
  }
  const hasDestination = validCoordinates(destination);
  const scored = candidates.map(branch => {
    const distanceKm = calculateRouteDistanceKm(branch.geolocation, destination);
    const radiusKm = Math.max(0, Number(branch.serviceRadiusKm ?? 10));
    const hasBranchCoordinates = validCoordinates(branch.geolocation);
    const withinServiceRadius = hasDestination && hasBranchCoordinates
      ? distanceKm <= radiusKm
      : String(branch.branchId) === String(preferredBranchId || '');
    const plan = buildIntelligentFulfillmentPlan({
      requestedItems, inventory: branch.inventory, catalog: branch.catalog || [], now
    });
    const requested = Number(plan.summary.quantityRequested || 0);
    const allocated = Number(plan.summary.quantityAvailableNow || 0);
    const fulfillmentRatio = requested > 0 ? allocated / requested : 0;
    const fullyFilledLines = plan.lines.filter(line => line.waitingQuantity === 0).length;
    return {
      branch, plan, distanceKm, radiusKm, withinServiceRadius,
      fulfillmentRatio, fullyFilledLines,
      deliveryFee: Math.max(0, Number(branch.deliveryFee || 0))
    };
  }).filter(item => item.withinServiceRadius);

  if (!scored.length) {
    throw Object.assign(new Error('No active pharmacy branch serves the selected delivery location.'), {
      statusCode: 409, code: 'NO_BRANCH_WITHIN_DELIVERY_RADIUS'
    });
  }
  scored.sort((a, b) =>
    b.fulfillmentRatio - a.fulfillmentRatio
    || b.fullyFilledLines - a.fullyFilledLines
    || (a.distanceKm ?? Number.MAX_SAFE_INTEGER) - (b.distanceKm ?? Number.MAX_SAFE_INTEGER)
    || a.deliveryFee - b.deliveryFee
    || (Number(String(b.branch.branchId) === String(preferredBranchId)) - Number(String(a.branch.branchId) === String(preferredBranchId)))
    || String(a.branch.branchId).localeCompare(String(b.branch.branchId))
  );
  const selected = scored[0];
  return {
    ...selected.plan,
    branchId: String(selected.branch.branchId),
    routing: {
      strategy: 'MAXIMUM_FILL_THEN_NEAREST_BRANCH',
      selectedBranchId: String(selected.branch.branchId),
      selectedBranchName: String(selected.branch.name || 'Pharmacy branch'),
      distanceKm: selected.distanceKm,
      serviceRadiusKm: selected.radiusKm,
      deliveryFee: selected.deliveryFee,
      fulfillmentPercentage: Math.round(selected.fulfillmentRatio * 10000) / 100,
      evaluatedBranches: scored.length,
      alternatives: scored.map(item => ({
        branchId: String(item.branch.branchId),
        branchName: String(item.branch.name || 'Pharmacy branch'),
        distanceKm: item.distanceKm,
        fulfillmentPercentage: Math.round(item.fulfillmentRatio * 10000) / 100,
        quantityAvailableNow: item.plan.summary.quantityAvailableNow,
        quantityWaiting: item.plan.summary.quantityWaiting,
        selected: item === selected
      }))
    },
    safety: {
      ...selected.plan.safety,
      inventoryIsReadOnlyDuringRouting: true,
      reservationOccursOnlyAtCheckout: true,
      oneOrderUsesOneBranch: true
    }
  };
}
