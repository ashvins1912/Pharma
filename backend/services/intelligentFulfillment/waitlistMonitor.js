import mongoose from 'mongoose';
import FulfillmentCase from '../../models/FulfillmentCase.js';
import { inventoryClient } from '../inventory-client/InventoryClient.js';
import MedicineRequest from '../../models/MedicineRequest.js';
import Order from '../../models/Order.js';
import { getIsConnected } from '../../config/db.js';
import { domainEvents } from '../../shared/events/DomainEvents.js';

const roundPrice = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const available = medicine => Math.max(0,
  Number(medicine?.stockQuantity ?? medicine?.stock ?? medicine?.quantity ?? 0)
  - Number(medicine?.reservedQuantity || 0));

export async function recoverStaleMedicineRequestConfirmations({ limit = 100, now = new Date(), customerId = null } = {}) {
  if (!getIsConnected()) return { scanned: 0, recovered: 0 };
  let recoveredCount = 0;
  // Recover medicine-request confirmations if the process stopped after the
  // order transaction committed but before the request record was finalized.
  const staleRequests = await MedicineRequest.find({
    ...(customerId ? { customerId: String(customerId) } : {}),
    status: 'FULFILLMENT_PROCESSING',
    updatedAt: { $lt: new Date(now.getTime() - 10 * 60 * 1000) }
  }).limit(Math.max(1, Math.min(500, Number(limit) || 100))).lean();
  for (const request of staleRequests) {
    const order = await Order.findOne({ medicineRequestId: String(request._id), userId: String(request.customerId), tenantId: String(request.tenantId || '') }).lean();
    const waitlist = await FulfillmentCase.findOne({
      sourceType: 'MEDICINE_REQUEST', sourceId: String(request._id), customerId: String(request.customerId), tenantId: String(request.tenantId || ''),
      status: { $nin: ['CANCELLED', 'EXPIRED', 'FULFILLED'] }
    }).lean();
    if (order) {
      if (waitlist) {
        await FulfillmentCase.updateOne({ _id: waitlist._id }, { $set: { parentOrderId: String(order._id) } });
        await Order.updateOne({ _id: order._id, tenantId: request.tenantId }, {
          $set: { fulfillmentCaseId: String(waitlist._id), fulfillmentState: 'PARTIAL' }
        });
      }
      await MedicineRequest.updateOne({ _id: request._id, status: 'FULFILLMENT_PROCESSING' }, {
        $set: {
          status: 'CONVERTED_TO_ORDER',
          convertedOrderId: String(order._id),
          fulfillmentCaseId: waitlist?._id || null,
          fulfillmentProcessingAt: null
        },
        $push: { auditTrail: { action: 'FULFILLMENT_CONFIRMATION_RECOVERED', actorId: 'System', role: 'System', timestamp: now, notes: 'Recovered committed order after an interrupted confirmation.' } }
      });
    } else if (waitlist) {
      await MedicineRequest.updateOne({ _id: request._id, status: 'FULFILLMENT_PROCESSING' }, {
        $set: { status: 'WAITING_FOR_STOCK', fulfillmentCaseId: waitlist._id, fulfillmentProcessingAt: null },
        $push: { auditTrail: { action: 'WAITLIST_CONFIRMATION_RECOVERED', actorId: 'System', role: 'System', timestamp: now, notes: 'Recovered the pending stock waitlist after an interrupted confirmation.' } }
      });
    } else {
      await MedicineRequest.updateOne({ _id: request._id, status: 'FULFILLMENT_PROCESSING' }, {
        $set: { status: 'PROPOSAL_SENT', fulfillmentProcessingAt: null },
        $push: { auditTrail: { action: 'FULFILLMENT_CONFIRMATION_RESET', actorId: 'System', role: 'System', timestamp: now, notes: 'No committed order or waitlist was found; the proposal can be retried.' } }
      });
    }
  }
  recoveredCount = staleRequests.length;
  return { scanned: staleRequests.length, recovered: recoveredCount };
}

export async function refreshStockWaitlistCases({ limit = 250, now = new Date(), customerId = null } = {}) {
  if (!getIsConnected()) return { scanned: 0, ready: 0, expired: 0 };
  const cases = await FulfillmentCase.find({
    ...(customerId ? { customerId: String(customerId) } : {}),
    status: { $in: ['WAITING_FOR_STOCK', 'PARTIALLY_FULFILLED', 'READY_FOR_CONFIRMATION', 'CONFIRMING'] }
  }).sort({ updatedAt: 1 }).limit(Math.max(1, Math.min(1000, Number(limit) || 250))).lean();
  let ready = 0;
  let expired = 0;
  await recoverStaleMedicineRequestConfirmations({ limit: 100, now, customerId });



  for (const entry of cases) {
    if (!entry.tenantId) continue;
    if (!entry.parentOrderId) {
      const linkedOrder = await Order.findOne({
        fulfillmentCaseId: String(entry._id),
        userId: String(entry.customerId),
        tenantId: String(entry.tenantId)
      }).select('_id').lean();
      if (linkedOrder) {
        entry.parentOrderId = String(linkedOrder._id);
        await FulfillmentCase.updateOne({ _id: entry._id, parentOrderId: null }, {
          $set: { parentOrderId: String(linkedOrder._id) },
          $push: { auditTrail: { action: 'PARTIAL_ORDER_LINK_RECOVERED', at: now, actorId: 'system', orderId: String(linkedOrder._id) } }
        });
      }
    }
    const confirmingTimestamp = new Date(entry.confirmingAt || entry.updatedAt || entry.createdAt || 0).getTime();
    const staleConfirmation = !Number.isFinite(confirmingTimestamp)
      || confirmingTimestamp <= now.getTime() - 10 * 60 * 1000;
    if (entry.status === 'CONFIRMING' && staleConfirmation) {
      const recoveredOrder = entry.confirmationId ? await Order.findOne({ fulfillmentConfirmationId: entry.confirmationId }).lean() : null;
      if (recoveredOrder) {
        const confirmationLines = entry.confirmationLines || [];
        const remainingLines = (entry.lines || []).map(line => {
          const confirmed = confirmationLines.find(item => String(item.productId) === String(line.productId));
          const quantity = Math.min(Number(confirmed?.allocatedQuantity || 0), Number(line.waitingQuantity || 0));
          return { ...line, requestedQuantity: Math.max(0, Number(line.waitingQuantity || 0) - quantity), allocatedQuantity: 0, waitingQuantity: Math.max(0, Number(line.waitingQuantity || 0) - quantity), notifiedAvailableQuantity: 0 };
        }).filter(line => line.requestedQuantity > 0);
        let rootOrderId = String(entry.parentOrderId || recoveredOrder._id);
        let isChildOrder = rootOrderId !== String(recoveredOrder._id);
        let parentUpdate = await Order.updateOne(
          { _id: rootOrderId, tenantId: entry.tenantId },
          {
            $set: { fulfillmentState: remainingLines.length ? 'PARTIAL' : 'COMPLETE' },
            ...(isChildOrder ? { $addToSet: { childOrderIds: String(recoveredOrder._id) } } : {})
          }
        );
        if (!parentUpdate.matchedCount && isChildOrder) {
          // The original parent may have been removed; promote the committed
          // child order so this confirmation can still be finalized.
          rootOrderId = String(recoveredOrder._id);
          isChildOrder = false;
          parentUpdate = await Order.updateOne(
            { _id: rootOrderId, tenantId: entry.tenantId },
            { $set: { fulfillmentState: remainingLines.length ? 'PARTIAL' : 'COMPLETE' } }
          );
        }
        if (!parentUpdate.matchedCount) {
          // Keep the claim for a later recovery pass; never discard the committed order link.
          continue;
        }
        const recoveryUpdate = {
          $set: { lines: remainingLines, status: remainingLines.length ? 'WAITING_FOR_STOCK' : 'FULFILLED', parentOrderId: rootOrderId, confirmationId: null, confirmingAt: null, confirmationPreviousStatus: null, confirmationLines: [] },
          $push: { auditTrail: { action: 'CONFIRMATION_RECOVERED', at: now, actorId: 'system', details: { orderId: String(recoveredOrder._id), rootOrderId } } }
        };
        if (isChildOrder) recoveryUpdate.$addToSet = { childOrderIds: String(recoveredOrder._id) };
        await FulfillmentCase.updateOne({ _id: entry._id, status: 'CONFIRMING', confirmationId: entry.confirmationId }, recoveryUpdate);
        if (entry.sourceType === 'MEDICINE_REQUEST' && entry.sourceId) await MedicineRequest.updateOne({ _id: entry.sourceId, fulfillmentCaseId: String(entry._id) }, { $set: { status: remainingLines.length ? 'WAITING_FOR_STOCK' : 'CONVERTED_TO_ORDER', convertedOrderId: rootOrderId } });
      } else {
        await FulfillmentCase.updateOne({ _id: entry._id, status: 'CONFIRMING', confirmationId: entry.confirmationId || null }, {
          $set: { status: entry.confirmationPreviousStatus || 'WAITING_FOR_STOCK', confirmationId: null, confirmingAt: null, confirmationPreviousStatus: null, confirmationLines: [], lastAvailabilityCheckAt: null },
          $push: { auditTrail: { action: 'CONFIRMATION_CLAIM_RECOVERED', at: now, actorId: 'system' } }
        });
      }
      continue;
    }
    if (entry.status === 'CONFIRMING') continue;
    // Confirmation recovery is tenant-scoped and does not require a branch.
    // Stock refresh itself still requires an explicitly resolved branch.
    if (!entry.branchId) continue;
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
        if (entry.parentOrderId) await Order.updateOne({ _id: entry.parentOrderId, tenantId: entry.tenantId }, { $set: { fulfillmentState: 'EXPIRED_REMAINDER' } });
        if (entry.sourceType === 'MEDICINE_REQUEST' && entry.sourceId) {
          await MedicineRequest.updateOne({ _id: entry.sourceId, fulfillmentCaseId: String(entry._id), status: { $in: ['WAITING_FOR_STOCK', 'READY_FOR_CONFIRMATION'] } }, { $set: { status: 'EXPIRED' }, $push: { auditTrail: { action: 'WAITLIST_EXPIRED', actorId: 'System', role: 'System', timestamp: now, notes: 'The selected stock wait window expired.' } } });
        }
        domainEvents.emitDomainEvent('FULFILLMENT_WAITLIST_EXPIRED', entry.caseNumber, {
          recipientUserId: entry.customerId, caseNumber: entry.caseNumber
        }, 'system', entry.tenantId, entry.branchId);
      }
      continue;
    }
    const ids = [...new Set((entry.lines || []).map(line => String(line.productId || '')).filter(id => mongoose.isValidObjectId(id)))];
    const lookup = ids.length ? await inventoryClient.lookup({
      productIds: ids, tenantId: entry.tenantId, branchId: entry.branchId, userId: 'inventory-waitlist-monitor'
    }) : { items: [] };
    const byId = new Map((lookup.items || []).map(product => [String(product.productId), product]));
    let anyAvailable = false;
    let allAvailable = true;
    let newlyAvailable = false;
    const alternativeCatalogs = new Map();
    const lines = await Promise.all((entry.lines || []).map(async line => {
      let product = line.productId ? byId.get(String(line.productId)) : null;
      if (!product && line.composition && line.strength) {
        const key = `${String(line.composition).trim().toLowerCase()}|${String(line.strength).trim().toLowerCase()}|${String(line.dosageForm || '').trim().toLowerCase()}`;
        if (!alternativeCatalogs.has(key)) {
          const result = await inventoryClient.searchProducts({
            tenantId: entry.tenantId, branchId: entry.branchId,
            query: String(line.composition).trim(), includeOutOfStock: true, limit: 100,
            userId: 'inventory-waitlist-monitor'
          });
          const matches = (result.items || []).filter(item =>
            String(item.genericName || item.composition || '').trim().toLowerCase() === String(line.composition).trim().toLowerCase()
            && String(item.strength || '').trim().toLowerCase() === String(line.strength).trim().toLowerCase()
            && (!line.dosageForm || String(item.dosageForm || item.form || '').trim().toLowerCase() === String(line.dosageForm).trim().toLowerCase())
          );
          alternativeCatalogs.set(key, matches);
        }
        const matches = alternativeCatalogs.get(key) || [];
        const manufacturerMatches = line.manufacturer
          ? matches.filter(item => String(item.manufacturer || '').trim().toLowerCase() === String(line.manufacturer).trim().toLowerCase())
          : [];
        if (manufacturerMatches.length === 1) product = manufacturerMatches[0];
        else if (matches.length === 1) product = matches[0];
      }
      if (!product && !line.composition && !line.strength && line.requestedName) {
        const result = await inventoryClient.searchProducts({
          tenantId: entry.tenantId, branchId: entry.branchId,
          query: String(line.requestedName).trim(), includeOutOfStock: true, limit: 20,
          userId: 'inventory-waitlist-monitor'
        });
        const matches = (result.items || []).filter(item =>
          String(item.name || '').trim().toLowerCase() === String(line.requestedName).trim().toLowerCase()
        );
        if (matches.length === 1) product = matches[0];
      }
      const sellable = product && Number(product.availableQuantity || 0) >= 0;
      const quantity = sellable ? Math.min(Number(line.waitingQuantity || 0), Number(product.availableQuantity || 0)) : 0;
      const previousNotified = Number(line.notifiedAvailableQuantity || 0);
      if (quantity > 0) anyAvailable = true;
      if (quantity < Number(line.waitingQuantity || 0)) allAvailable = false;
      if (quantity > previousNotified) newlyAvailable = true;
      const listPrice = Number(product?.price ?? line.listPrice ?? line.unitPrice ?? 0);
      const discountPercentage = Math.min(100, Math.max(0, Number(product?.discountPercentage || 0)));
      const unitPrice = listPrice * (1 - discountPercentage / 100);
      return {
        ...line,
        ...(product?.productId ? { productId: String(product.productId), name: product.name || line.name } : {}),
        allocatedQuantity: quantity,
        notifiedAvailableQuantity: quantity,
        unitPrice: roundPrice(unitPrice),
        listPrice: roundPrice(listPrice),
        discountPercentage
      };
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
