import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { Audit, Inventory, Product, Reservation } from './models.js';
import { config } from './config.js';

const asPositiveQuantity = value => Number.isSafeInteger(value) && value > 0;
const normalizeItems = items => {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    const error = new Error('items must contain between 1 and 100 entries.');
    error.statusCode = 400;
    throw error;
  }
  const aggregated = new Map();
  for (const item of items) {
    if (typeof item?.productId !== 'string' || !mongoose.isValidObjectId(item.productId) || !asPositiveQuantity(item.quantity)) {
      const error = new Error('Each item requires a valid productId and positive integer quantity.');
      error.statusCode = 400;
      throw error;
    }
    const productId = item.productId.toLowerCase();
    const quantity = (aggregated.get(productId) || 0) + item.quantity;
    if (!asPositiveQuantity(quantity)) {
      const error = new Error('Combined product quantity exceeds the supported range.');
      error.statusCode = 400;
      throw error;
    }
    aggregated.set(productId, quantity);
  }
  return [...aggregated].map(([productId, quantity]) => ({ productId, quantity }));
};

export async function lookupInventory({ productIds = [], skus = [], tenantId = null, branchId = null }) {
  if (!Array.isArray(productIds) || !Array.isArray(skus) || productIds.length + skus.length > 100) {
    const error = new Error('Lookup accepts at most 100 product IDs or SKUs.');
    error.statusCode = 400;
    throw error;
  }
  if (productIds.some(id => typeof id !== 'string' || !mongoose.isValidObjectId(id))
    || skus.some(sku => typeof sku !== 'string' || !sku.trim())) {
    const error = new Error('Lookup product IDs and SKUs must be valid non-empty strings.');
    error.statusCode = 400;
    throw error;
  }
  const filters = [];
  if (productIds.length) filters.push({ _id: { $in: productIds.map(id => id.toLowerCase()) } });
  if (skus.length) filters.push({ sku: { $in: skus.map(sku => String(sku).trim().toUpperCase()) } });
  if (!filters.length) return [];
  const productFilter = { $or: filters, active: true };
  if (tenantId) productFilter.tenantId = String(tenantId).trim();
  const products = await Product.find(productFilter).lean();
  const inventoryFilter = { productId: { $in: products.map(product => product._id) } };
  if (tenantId) inventoryFilter.tenantId = String(tenantId).trim();
  if (branchId) inventoryFilter.branchId = String(branchId).trim();
  const inventories = await Inventory.find(inventoryFilter).lean();
  const inventoryByProductId = new Map(inventories.map(item => [String(item.productId), item]));
  return products.map(product => {
    const inventory = inventoryByProductId.get(String(product._id));
    return {
      productId: String(product._id),
      productVersion: product.version,
      sku: product.sku,
      name: product.name,
      genericName: product.genericName,
      strength: product.strength,
      form: product.form,
      manufacturer: product.manufacturer,
      category: product.category,
      requiresPrescription: product.requiresPrescription,
      price: inventory?.price ?? null,
      stockQuantity: inventory?.stockQuantity ?? 0,
      reservedQuantity: inventory?.reservedQuantity ?? 0,
      availableQuantity: inventory ? Math.max(0, inventory.stockQuantity - inventory.reservedQuantity) : 0
    };
  });
}

export async function searchInventoryProducts({
  tenantId = null,
  branchId = null,
  query = '',
  category = '',
  page = 1,
  limit = 50
} = {}) {
  const normalizedPage = Math.max(1, Math.floor(Number(page) || 1));
  const normalizedLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 50)));
  const normalizedQuery = String(query || '').trim();
  const filter = { active: true };
  if (tenantId) filter.tenantId = String(tenantId).trim();
  if (category) filter.category = String(category).trim();

  if (normalizedQuery) {
    const pattern = new RegExp(normalizedQuery.replace(/[.*+?^()|[\]{}\\]/g, '\\$&'), 'i');
    filter.$or = [
      { sku: pattern },
      { name: pattern },
      { genericName: pattern },
      { manufacturer: pattern },
      { category: pattern }
    ];
  }

  const products = await Product.find(filter)
    .sort({ name: 1 })
    .skip((normalizedPage - 1) * normalizedLimit)
    .limit(normalizedLimit)
    .lean();

  const productIds = products.map(product => product._id);
  const inventoryFilter = productIds.length
    ? { productId: { $in: productIds } }
    : { productId: { $in: [] } };
  if (tenantId) inventoryFilter.tenantId = String(tenantId).trim();
  if (branchId) inventoryFilter.branchId = String(branchId).trim();

  const [inventories, total] = await Promise.all([
    Inventory.find(inventoryFilter).lean(),
    Product.countDocuments(filter)
  ]);

  const byProductId = new Map(inventories.map(item => [String(item.productId), item]));
  const items = products.map(product => {
    const inventory = byProductId.get(String(product._id));
    const price = inventory?.price ?? null;
    const availableQuantity = inventory
      ? Math.max(0, inventory.stockQuantity - inventory.reservedQuantity)
      : 0;
    return {
      listingId: inventory ? `${inventory.tenantId}:${inventory.branchId}:${String(product._id)}` : null,
      productId: String(product._id),
      productVersion: product.version,
      sku: product.sku,
      name: product.name,
      genericName: product.genericName,
      composition: product.genericName,
      manufacturer: product.manufacturer,
      strength: product.strength,
      dosageForm: product.form,
      form: product.form,
      category: product.category,
      requiresPrescription: product.requiresPrescription,
      mrp: price,
      sellingPrice: price,
      price,
      stockQuantity: inventory?.stockQuantity ?? 0,
      reservedQuantity: inventory?.reservedQuantity ?? 0,
      availableQuantity,
      stockStatus: availableQuantity > 10 ? 'IN_STOCK' : availableQuantity > 0 ? 'LOW_STOCK' : 'OUT_OF_STOCK',
      batchNumber: inventory?.batchNumber || '',
      expiryDate: inventory?.expiryDate || null,
      tenantId: inventory?.tenantId || tenantId || product.tenantId,
      branchId: inventory?.branchId || branchId || null
    };
  });

  return {
    items,
    total,
    page: normalizedPage,
    limit: normalizedLimit,
    pages: Math.ceil(total / normalizedLimit)
  };
}

export async function reserveInventory({ orderId, items, idempotencyKey, actor, requestId, correlationId }) {
  const normalizedOrderId = typeof orderId === 'string' ? orderId.trim() : '';
  const normalizedIdempotencyKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
  if (!normalizedOrderId || !normalizedIdempotencyKey
    || normalizedIdempotencyKey.length > 200) {
    const error = new Error('orderId and idempotencyKey are required.');
    error.statusCode = 400;
    throw error;
  }
  const normalized = normalizeItems(items);
  const replayExisting = existing => {
    if (existing.orderId !== normalizedOrderId || JSON.stringify(existing.items.map(item => [String(item.productId), item.quantity]).sort())
      !== JSON.stringify(normalized.map(item => [item.productId, item.quantity]).sort())) {
      const error = new Error('Idempotency key has already been used for a different reservation.');
      error.statusCode = 409;
      throw error;
    }
    return { reservationId: existing.reservationId, status: existing.status, items: existing.items, expiresAt: existing.expiresAt || null };
  };
  const existing = await Reservation.findOne({ idempotencyKey: normalizedIdempotencyKey }).lean();
  if (existing) return replayExisting(existing);

  const session = await mongoose.startSession();
  const reservationId = `RES-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + (config.reservationTTLHours || 24) * 3600_000);
  try {
    await session.withTransaction(async () => {
      const productIds = normalized.map(item => new mongoose.Types.ObjectId(item.productId));
      const products = await Product.find({ _id: { $in: productIds }, active: true }).session(session).lean();
      const productById = new Map(products.map(product => [String(product._id), product]));
      const reservedItems = [];
      for (const item of normalized) {
        const product = productById.get(item.productId);
        if (!product) {
          const error = new Error(`Product ${item.productId} is unavailable.`);
          error.statusCode = 409;
          throw error;
        }
        const result = await Inventory.updateOne({
          productId: product._id,
          $expr: { $gte: [{ $subtract: ['$stockQuantity', '$reservedQuantity'] }, item.quantity] }
        }, { $inc: { reservedQuantity: item.quantity } }, { session });
        if (result.modifiedCount !== 1) {
          const error = new Error(`Insufficient available inventory for SKU ${product.sku}.`);
          error.statusCode = 409;
          throw error;
        }
        reservedItems.push({ productId: product._id, sku: product.sku, quantity: item.quantity });
      }
      await Reservation.create([{
        reservationId,
        idempotencyKey: normalizedIdempotencyKey,
        orderId: normalizedOrderId,
        status: 'RESERVED',
        expiresAt,
        items: reservedItems
      }], { session });
      await Audit.create([{
        actor,
        operation: 'reserve',
        requestId,
        correlationId,
        details: { orderId: normalizedOrderId, reservationId, expiresAt }
      }], { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const repeatedReservation = await Reservation.findOne({ idempotencyKey: normalizedIdempotencyKey }).lean();
      if (repeatedReservation) return replayExisting(repeatedReservation);
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return { reservationId, status: 'RESERVED', items: normalized, expiresAt };
}

export async function transitionReservation(reservationId, targetStatus, { actor, requestId, correlationId }) {
  if (!['RELEASED', 'DEDUCTED'].includes(targetStatus)) {
    const error = new Error('Unsupported reservation transition.');
    error.statusCode = 400;
    throw error;
  }
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const reservation = await Reservation.findOne({ reservationId }).session(session);
      if (!reservation) {
        const error = new Error('Reservation was not found.');
        error.statusCode = 404;
        throw error;
      }
      if (reservation.status === targetStatus) {
        result = reservation;
        return;
      }
      if (reservation.status !== 'RESERVED') {
        const error = new Error(`Cannot change a ${reservation.status.toLowerCase()} reservation.`);
        error.statusCode = 409;
        throw error;
      }
      for (const item of reservation.items) {
        const update = targetStatus === 'RELEASED'
          ? { $inc: { reservedQuantity: -item.quantity } }
          : {
              $inc: {
                stockQuantity: -item.quantity,
                reservedQuantity: -item.quantity
              }
            };
        const condition = { productId: item.productId, reservedQuantity: { $gte: item.quantity } };
        if (targetStatus === 'DEDUCTED') condition.stockQuantity = { $gte: item.quantity };
        const changed = await Inventory.updateOne(condition, update, { session });
        if (changed.modifiedCount !== 1) {
          const error = new Error(`Inventory changed unexpectedly for SKU ${item.sku}.`);
          error.statusCode = 409;
          throw error;
        }
      }
      reservation.status = targetStatus;
      await reservation.save({ session });
      await Audit.create([{
        actor,
        operation: targetStatus.toLowerCase(),
        requestId,
        correlationId,
        details: { reservationId }
      }], { session });
      result = reservation;
    });
  } finally {
    await session.endSession();
  }
  return { reservationId: result.reservationId, status: result.status };
}

export async function adjustInventory({ sku, stockQuantity, price, batchNumber, expiryDate, actor, requestId, correlationId, operationKey }) {
  const normalizedSku = typeof sku === 'string' ? sku.trim().toUpperCase() : '';
  const normalizedOperationKey = typeof operationKey === 'string' ? operationKey.trim() : '';
  const normalizedExpiry = expiryDate ? new Date(expiryDate) : null;
  if (!normalizedSku || !Number.isSafeInteger(stockQuantity) || stockQuantity < 0
    || !Number.isFinite(price) || price < 0 || !normalizedOperationKey
    || normalizedOperationKey.length > 200
    || (normalizedExpiry && !Number.isFinite(normalizedExpiry.getTime()))) {
    const error = new Error('sku, non-negative stockQuantity, non-negative price, and operationKey are required.');
    error.statusCode = 400;
    throw error;
  }
  const request = {
    sku: normalizedSku,
    stockQuantity,
    price,
    batchNumber: batchNumber || '',
    expiryDate: normalizedExpiry?.toISOString() || null
  };
  const replayExisting = priorOperation => {
    const priorRequest = priorOperation.details.request;
    if (JSON.stringify(priorRequest) !== JSON.stringify(request)) {
      const error = new Error('Idempotency key has already been used for a different adjustment.');
      error.statusCode = 409;
      throw error;
    }
    return priorOperation.details.result;
  };
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const priorOperation = await Audit.findOne({ operationKey: normalizedOperationKey, operation: 'adjust' }).session(session).lean();
      if (priorOperation) {
        result = replayExisting(priorOperation);
        return;
      }
      const product = await Product.findOne({ sku: normalizedSku, active: true }).session(session);
      if (!product) {
        const error = new Error('Product SKU was not found.');
        error.statusCode = 404;
        throw error;
      }
      const inventory = await Inventory.findOneAndUpdate({
        productId: product._id,
        reservedQuantity: { $lte: stockQuantity },
      }, {
        $set: {
          stockQuantity,
          price,
          ...(typeof batchNumber === 'string' ? { batchNumber } : {}),
          ...(normalizedExpiry ? { expiryDate: normalizedExpiry } : {})
        },
      }, { new: true, session });
      if (!inventory) {
        const error = new Error('Stock adjustment would reduce stock below reserved quantity.');
        error.statusCode = 409;
        throw error;
      }
      result = {
        productId: String(product._id),
        sku: normalizedSku,
        stockQuantity: inventory.stockQuantity,
        reservedQuantity: inventory.reservedQuantity,
        price: inventory.price
      };
      await Audit.create([{
        actor,
        operation: 'adjust',
        operationKey: normalizedOperationKey,
        requestId,
        correlationId,
        productId: product._id,
        sku: normalizedSku,
        details: { request, result }
      }], { session });
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const repeatedOperation = await Audit.findOne({ operationKey: normalizedOperationKey, operation: 'adjust' }).lean();
    if (repeatedOperation) return replayExisting(repeatedOperation);
    throw error;
  } finally {
    await session.endSession();
  }
  return result;
}

export { normalizeItems };
