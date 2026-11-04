import FulfillmentCase from '../../models/FulfillmentCase.js';
import Medicine from '../../models/Medicine.js';
import MedicineRequest from '../../models/MedicineRequest.js';
import Order from '../../models/Order.js';
import { getIsConnected } from '../../config/db.js';
import { domainEvents } from '../../shared/events/DomainEvents.js';

const available = medicine => Math.max(0,
  Number(medicine?.stockQuantity ?? medicine?.stock ?? medicine?.quantity ?? 0)
  - Number(medicine?.reservedQuantity || 0));

export async function refreshStockWaitlistCases({ limit = 250, now = new Date() } = {}) {
  if (!getIsConnected()) return { scanned: 0, ready: 0, expired: 0 };
  const cases = await FulfillmentCase.find({
    status: { $in: ['WAITING_FOR_STOCK', 'PARTIALLY_FULFILLED', 'READY_FOR_CONFIRMATION', 'CONFIRMING'] }
  }).sort({ updatedAt: 1 }).limit(Math.max(1, Math.min(1000, Number(limit) || 250))).lean();
  let ready = 0;
  let expired = 0;
  for (const entry of cases) {
    if (entry.status === 'CONFIRMING' && entry.confirmingAt && new Date(entry.confirmingAt).getTime() < now.getTime() - 10 * 60 * 1000) {
      const recoveredOrder = entry.confirmationId ? await Order.findOne({ fulfillmentConfirmationId: entry.confirmationId }).lean() : null;
      if (recoveredOrder) {
        const confirmationLines = entry.confirmationLines || [];
        const remainingLines = (entry.lines || []).map(line => {
          const confirmed = confirmationLines.find(item => String(item.productId) === String(line.productId));
          const quantity = Math.min(Number(confirmed?.allocatedQuantity || 0), Number(line.waitingQuantity || 0));
          return { ...line, requestedQuantity: Math.max(0, Number(line.waitingQuantity || 0) - quantity), allocatedQuantity: 0, waitingQuantity: Math.max(0, Number(line.waitingQuantity || 0) - quantity), notifiedAvailableQuantity: 0 };
        }).filter(line => line.requestedQuantity > 0);
        await FulfillmentCase.updateOne({ _id: entry._id, status: 'CONFIRMING', confirmationId: entry.confirmationId }, {
          $set: { lines: remainingLines, status: remainingLines.length ? 'WAITING_FOR_STOCK' : 'FULFILLED', parentOrderId: String(recoveredOrder._id), confirmationId: null, confirmingAt: null, confirmationPreviousStatus: null, confirmationLines: [] },
          $push: { auditTrail: { action: 'CONFIRMATION_RECOVERED', at: now, actorId: 'system', details: { orderId: String(recoveredOrder._id) } } }
        });
        if (entry.parentOrderId) await Order.updateOne({ _id: entry.parentOrderId, tenantId: entry.tenantId }, { $set: { fulfillmentState: remainingLines.length ? 'PARTIAL' : 'COMPLETE' } });
        if (entry.sourceType === 'MEDICINE_REQUEST' && entry.sourceId) await MedicineRequest.updateOne({ _id: entry.sourceId, fulfillmentCaseId: String(entry._id) }, { $set: { status: remainingLines.length ? 'WAITING_FOR_STOCK' : 'CONVERTED_TO_ORDER', convertedOrderId: String(recoveredOrder._id) } });
      } else {
        await FulfillmentCase.updateOne({ _id: entry._id, status: 'CONFIRMING', confirmationId: entry.confirmationId }, {
          $set: { status: entry.confirmationPreviousStatus || 'WAITING_FOR_STOCK', confirmationId: null, confirmingAt: null, confirmationPreviousStatus: null, confirmationLines: [], lastAvailabilityCheckAt: null },
          $push: { auditTrail: { action: 'CONFIRMATION_CLAIM_RECOVERED', at: now, actorId: 'system' } }
        });
      }
      continue;
    }
    if (entry.status === 'CONFIRMING') continue;
    const oldCheck = entry.lastAvailabilityCheckAt || null;
    if (entry.waitUntil && new Date(entry.waitUntil) <= now) {
      const result = await FulfillmentCase.updateOne({
        _id: entry._id, status: entry.status, lastAvailabilityCheckAt: oldCheck
      }, {
        $set: { status: 'EXPIRED', lastAvailabilityCheckAt: now },
        $push: { auditTrail: { action: 'WAITLIST_EXPIRED', at: now, actorId: 'system' } }
      });
      if (result.modifiedCount) {
        expired += 1;
        if (entry.sourceType === 'MEDICINE_REQUEST' && entry.sourceId) {
          await MedicineRequest.updateOne({ _id: entry.sourceId, fulfillmentCaseId: String(entry._id), status: { $in: ['WAITING_FOR_STOCK', 'READY_FOR_CONFIRMATION'] } }, { $set: { status: 'EXPIRED' }, $push: { auditTrail: { action: 'WAITLIST_EXPIRED', actorId: 'System', role: 'System', timestamp: now, notes: 'The selected stock wait window expired.' } } });
        }
        domainEvents.emitDomainEvent('FULFILLMENT_WAITLIST_EXPIRED', entry.caseNumber, {
          recipientUserId: entry.customerId, caseNumber: entry.caseNumber
        }, 'system', entry.tenantId, entry.branchId);
      }
      continue;
    }
    const ids = [...new Set((entry.lines || []).map(line => String(line.productId || '')).filter(Boolean))];
    const products = ids.length ? await Medicine.find({
      _id: { $in: ids }, tenantId: entry.tenantId
    }).select('_id name composition strength dosageForm manufacturer stockQuantity stock quantity reservedQuantity expiryDate isActive').lean() : [];
    const byId = new Map(products.map(product => [String(product._id), product]));
    let anyAvailable = false;
    let allAvailable = true;
    let newlyAvailable = false;
    const lines = await Promise.all((entry.lines || []).map(async line => {
      let product = line.productId ? byId.get(String(line.productId)) : null;
      if (!product && line.composition && line.strength) {
        const matches = await Medicine.find({
          tenantId: entry.tenantId, isActive: { $ne: false },
          composition: line.composition, strength: line.strength,
          ...(line.dosageForm ? { dosageForm: line.dosageForm } : {}),
          ...(line.manufacturer ? { manufacturer: line.manufacturer } : {})
        }).select('_id name composition strength dosageForm manufacturer stockQuantity stock quantity reservedQuantity expiryDate isActive').limit(2).lean();
        // Never guess between multiple catalog matches. Keep the request pending for pharmacist review.
        if (matches.length === 1) product = matches[0];
      }
      const sellable = product && product.isActive !== false
        && (!product.expiryDate || new Date(product.expiryDate) > now);
      const quantity = sellable ? Math.min(Number(line.waitingQuantity || 0), available(product)) : 0;
      const previousNotified = Number(line.notifiedAvailableQuantity || 0);
      if (quantity > 0) anyAvailable = true;
      if (quantity < Number(line.waitingQuantity || 0)) allAvailable = false;
      if (quantity > previousNotified) newlyAvailable = true;
      return { ...line, ...(product?._id ? { productId: String(product._id), name: product.name || line.name } : {}), allocatedQuantity: quantity, notifiedAvailableQuantity: Math.max(previousNotified, quantity) };
    }));
    const nextStatus = allAvailable ? 'READY_FOR_CONFIRMATION' : anyAvailable ? 'PARTIALLY_FULFILLED' : 'WAITING_FOR_STOCK';
    const result = await FulfillmentCase.updateOne({
      _id: entry._id, status: entry.status, lastAvailabilityCheckAt: oldCheck
    }, {
      $set: { lines, status: nextStatus, lastAvailabilityCheckAt: now },
      ...(newlyAvailable ? { $push: { auditTrail: { action: 'STOCK_AVAILABILITY_UPDATED', at: now, actorId: 'system', details: { status: nextStatus } } } } : {})
    });
    if (result.modifiedCount && newlyAvailable) {
      ready += 1;
      if (entry.sourceType === 'MEDICINE_REQUEST' && entry.sourceId) {
        const requestStatus = allAvailable ? 'READY_FOR_CONFIRMATION' : 'WAITING_FOR_STOCK';
        await MedicineRequest.updateOne({ _id: entry.sourceId, fulfillmentCaseId: String(entry._id), status: { $in: ['WAITING_FOR_STOCK', 'READY_FOR_CONFIRMATION'] } }, { $set: { status: requestStatus }, $push: { auditTrail: { action: allAvailable ? 'STOCK_AVAILABLE' : 'STOCK_AVAILABILITY_CHANGED', actorId: 'System', role: 'System', timestamp: now, notes: allAvailable ? 'Requested stock is available for customer confirmation.' : 'Available quantity changed; customer confirmation is required.' } } });
      }
      domainEvents.emitDomainEvent('FULFILLMENT_STOCK_AVAILABLE', entry.caseNumber, {
        recipientUserId: entry.customerId,
        caseNumber: entry.caseNumber,
        status: nextStatus,
        lines: lines.map(line => ({
          name: line.name,
          requestedQuantity: line.waitingQuantity,
          availableToConfirm: line.allocatedQuantity
        }))
      }, 'system', entry.tenantId, entry.branchId);
    }
  }
  return { scanned: cases.length, ready, expired };
}
