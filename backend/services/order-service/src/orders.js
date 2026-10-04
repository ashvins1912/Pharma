import { createHash, randomUUID } from 'node:crypto';
import axios from 'axios';
import mongoose from 'mongoose';
import { config } from './config.js';
import { Order, OrderEvent } from './models.js';
import { createInventoryToken } from './service-auth.js';

const allowedSources = new Set(['WEB', 'MOBILE', 'ADMIN', 'POS', 'ERP', 'PARTNER', 'API', 'MEDICINE_REQUEST']);
const allowedStatuses = new Set([
  'Pending_Review', 'Approved', 'Rejected', 'Processing Order', 'Ready to Dispatch',
  'Dispatched', 'Delivered', 'Cancelled'
]);

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const serializeOrder = order => ({
  orderId: order.orderNumber,
  source: order.source,
  externalReference: order.externalReference,
  status: order.orderStatus,
  items: order.items.map(item => ({
    productId: item.sku,
    sku: item.sku,
    name: item.name,
    genericName: item.genericName,
    strength: item.strength,
    form: item.form,
    manufacturer: item.manufacturer,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    tax: item.tax,
    discount: item.discount,
    totalPrice: item.totalPrice,
    snapshotAt: item.snapshotAt
  })),
  subtotal: order.subtotal,
  discountApplied: order.discountApplied,
  totalAmount: order.totalAmount,
  finalTotal: order.finalTotal,
  paymentMethod: order.paymentMethod,
  deliveryAddress: order.deliveryAddress,
  addressDetails: order.addressDetails || {},
  coordinates: order.coordinates,
  rider: order.rider || null,
  statusHistory: order.statusHistory || [],
  createdAt: order.createdAt,
  updatedAt: order.updatedAt
});

export function normalizeCreateRequest(body, userId) {
  body = body || {};
  const source = body?.source || 'API';
  const externalReference = typeof body?.externalReference === 'string' ? body.externalReference.trim() : '';
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!allowedSources.has(source)) throw fail(400, 'source must identify a supported order channel.');
  if (!externalReference && !idempotencyKey) throw fail(400, 'Provide an externalReference or Idempotency-Key.');
  if (externalReference.length > 200 || idempotencyKey.length > 200) {
    throw fail(400, 'Order idempotency values must not exceed 200 characters.');
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100
    || body.items.some(item => !item || typeof item !== 'object'
      || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1
      || !String(item.productId || item.sku || '').trim())) {
    throw fail(400, 'items must contain 1 to 100 product IDs or SKUs with positive integer quantities.');
  }
  if (typeof body.deliveryAddress !== 'string' || !body.deliveryAddress.trim()) {
    throw fail(400, 'deliveryAddress is required.');
  }
  const itemsBySku = new Map();
  for (const item of body.items) {
    const sku = String(item.sku || item.productId).trim().toUpperCase();
    const quantity = (itemsBySku.get(sku) || 0) + Number(item.quantity);
    if (!Number.isSafeInteger(quantity)) throw fail(400, 'Combined product quantity exceeds the supported range.');
    itemsBySku.set(sku, quantity);
  }
  const request = {
    source,
    externalReference: externalReference || null,
    idempotencyKey: idempotencyKey || null,
    userId,
    items: [...itemsBySku].sort(([left], [right]) => left.localeCompare(right)),
    deliveryAddress: body.deliveryAddress.trim(),
    addressDetails: body.addressDetails || {},
    coordinates: body.coordinates || null,
    paymentMethod: body.paymentMethod || 'Cash on Delivery (COD)',
    prescriptionUrl: body.prescriptionUrl || null
  };
  const requestFingerprint = createHash('sha256')
    .update(JSON.stringify({
      source: request.source,
      userId: request.userId,
      externalReference: request.externalReference,
      idempotencyKey: request.idempotencyKey,
      items: request.items,
      deliveryAddress: request.deliveryAddress,
      addressDetails: request.addressDetails,
      coordinates: request.coordinates,
      paymentMethod: request.paymentMethod,
      prescriptionUrl: request.prescriptionUrl
    }))
    .digest('hex');
  return { ...request, requestFingerprint };
}

const findExistingOrder = async request => {
  const references = [
    ...(request.externalReference ? [{ externalReference: request.externalReference }] : []),
    ...(request.idempotencyKey ? [{ idempotencyKey: request.idempotencyKey }] : [])
  ];
  return references.length
    ? Order.findOne({ source: request.source, $or: references }).lean()
    : null;
};

const checkReplay = (existing, request) => {
  if (existing.userId !== request.userId || existing.requestFingerprint !== request.requestFingerprint) {
    throw fail(409, 'Order idempotency reference was reused with a different order.');
  }
  return { order: serializeOrder(existing), replayed: true };
};

const inventoryRequest = async (path, data, idempotencyKey) => {
  if (!config.inventoryServiceUrl) throw fail(503, 'Inventory Service is not configured.');
  const token = createInventoryToken(
    path === '/reservations'
      ? ['inventory.reserve']
      : path.endsWith('/release')
        ? ['inventory.release']
        : path.endsWith('/deduct')
          ? ['inventory.deduct']
        : ['inventory.read'],
    'order-service'
  );
  try {
    const response = await axios.post(`${config.inventoryServiceUrl}/api/v1/inventory${path}`, data, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      timeout: 10_000
    });
    return response.data;
  } catch (error) {
    if (error.response?.status) {
      throw fail(error.response.status === 409 ? 409 : 502, error.response.data?.message || 'Inventory operation failed.');
    }
    throw fail(error.code === 'ECONNABORTED' ? 504 : 503, 'Inventory Service is unavailable.');
  }
};

const writeEvent = async (session, order, event) => {
  const occurredAt = order.updatedAt || new Date();
  const eventKey = `${order.orderNumber}:${event}:${new Date(occurredAt).toISOString()}`;
  await OrderEvent.updateOne({ eventKey }, {
    $setOnInsert: {
      eventId: randomUUID(),
      eventKey,
      event,
      orderId: order.orderNumber,
      occurredAt,
      payload: { order: serializeOrder(order) }
    }
  }, { upsert: true, session });
};

export async function createOrder(body, user) {
  const request = normalizeCreateRequest(body, user.userId);
  const existing = await findExistingOrder(request);
  if (existing) return checkReplay(existing, request);
  const skus = request.items.map(([sku]) => sku);
  const catalog = await inventoryRequest('/bulk/lookup', { skus });
  const products = new Map((catalog.items || []).map(item => [String(item.sku).toUpperCase(), item]));
  const snapshotAt = new Date();
  const items = request.items.map(([sku, quantity]) => {
    const product = products.get(sku);
    if (!product || product.price == null) throw fail(409, `Product ${sku} is unavailable.`);
    const unitPrice = Number(product.price);
    const totalPrice = unitPrice * quantity;
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(totalPrice)) {
      throw fail(409, `Product ${sku} has invalid pricing.`);
    }
    return {
      productId: String(product.productId),
      productVersion: Number(product.productVersion) || 1,
      sku: product.sku,
      name: product.name,
      genericName: product.genericName || '',
      strength: product.strength || '',
      form: product.form || '',
      manufacturer: product.manufacturer || '',
      quantity,
      unitPrice,
      tax: 0,
      discount: 0,
      totalPrice,
      snapshotAt
    };
  });
  const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
  if (!Number.isFinite(subtotal)) throw fail(400, 'Order total exceeds the supported range.');

  const reservationIdentity = request.externalReference || request.idempotencyKey;
  const stableOrderId = createHash('sha256')
    .update(`${request.source}:${reservationIdentity}`)
    .digest('hex')
    .slice(0, 32)
    .toUpperCase();
  const orderNumber = `ORD-${stableOrderId}`;
  const reservation = await inventoryRequest('/reservations', {
    orderId: orderNumber,
    items: items.map(item => ({ productId: item.productId, quantity: item.quantity })),
    idempotencyKey: `order-reservation:${orderNumber}`
  }, `order-reservation:${orderNumber}`);
  if (reservation.status !== 'RESERVED') {
    throw fail(409, `Inventory reservation is ${String(reservation.status || 'unavailable').toLowerCase()}.`);
  }

  let session;
  try {
    session = await mongoose.startSession();
    let order;
    await session.withTransaction(async () => {
      [order] = await Order.create([{
        orderNumber,
        userId: request.userId,
        customerName: user.customerName || user.email || 'Customer',
        customerMobile: user.customerMobile || '',
        source: request.source,
        externalReference: request.externalReference,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint: request.requestFingerprint,
        items,
        subtotal,
        discountApplied: 0,
        totalAmount: subtotal,
        finalTotal: subtotal,
        paymentMethod: request.paymentMethod,
        deliveryAddress: request.deliveryAddress,
        addressDetails: request.addressDetails,
        coordinates: request.coordinates,
        prescriptionUrl: request.prescriptionUrl,
        reservationId: reservation.reservationId,
        orderStatus: 'Pending_Review',
        statusHistory: [{
          newStatus: 'Pending_Review',
          changedBy: user.userId,
          timestamp: snapshotAt
        }]
      }], { session });
      await writeEvent(session, order, 'OrderCreated');
      await writeEvent(session, order, 'OrderInventoryReserved');
    });
    return { order: serializeOrder(order), replayed: false };
  } catch (error) {
    let idempotencyConflict = false;
    if (error.code === 11000) {
      const repeated = await findExistingOrder(request);
      if (repeated) {
        if (repeated.userId === request.userId && repeated.requestFingerprint === request.requestFingerprint) {
          return { order: serializeOrder(repeated), replayed: true };
        }
        idempotencyConflict = true;
      }
    }
    try {
      await inventoryRequest(`/reservations/${encodeURIComponent(reservation.reservationId)}/release`, {});
    } catch (releaseError) {
      console.error('Order creation failed and its Inventory reservation could not be released:', {
        orderNumber,
        reservationId: reservation.reservationId,
        error: releaseError.message
      });
    }
    if (idempotencyConflict || error.code === 11000) {
      throw fail(409, 'Order idempotency reference is already in use.');
    }
    throw error;
  } finally {
    await session?.endSession();
  }
}

export async function listOrders({ userId, admin, query }) {
  const filter = {};
  if (!admin) filter.userId = userId;
  if (admin && query.source) {
    if (!allowedSources.has(query.source)) throw fail(400, 'source is not supported.');
    filter.source = query.source;
  }
  if (admin && query.customerId) filter.userId = query.customerId;
  if (query.status) {
    if (!allowedStatuses.has(query.status)) throw fail(400, 'status is not supported.');
    filter.orderStatus = query.status;
  }
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))) {
    throw fail(400, 'from and to must be valid dates.');
  }
  if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(filter)
  ]);
  return { orders: orders.map(serializeOrder), page, limit, total };
}

export async function getOrder(orderNumber, userId, admin) {
  const filter = { orderNumber };
  if (!admin) filter.userId = userId;
  const order = await Order.findOne(filter).lean();
  return order ? serializeOrder(order) : null;
}

export async function transitionOrder(orderNumber, newStatus, user) {
  if (!allowedStatuses.has(newStatus)) throw fail(400, 'newStatus is not supported.');
  const order = await Order.findOne({ orderNumber });
  if (!order) return null;
  const previousStatus = order.orderStatus;
  if (previousStatus === newStatus) return serializeOrder(order);
  const transitions = {
    Pending_Review: new Set(['Approved', 'Rejected', 'Cancelled']),
    Approved: new Set(['Processing Order', 'Ready to Dispatch', 'Cancelled']),
    'Processing Order': new Set(['Ready to Dispatch', 'Cancelled']),
    'Ready to Dispatch': new Set(['Dispatched', 'Cancelled']),
    Dispatched: new Set(['Delivered']),
    Rejected: new Set(),
    Delivered: new Set(),
    Cancelled: new Set()
  };
  if (!transitions[previousStatus]?.has(newStatus)) {
    throw fail(409, `Cannot transition an order from ${previousStatus} to ${newStatus}.`);
  }
  let inventoryEvent = null;
  if (newStatus === 'Cancelled' || newStatus === 'Rejected') {
    await inventoryRequest(`/reservations/${encodeURIComponent(order.reservationId)}/release`, {});
    inventoryEvent = 'OrderInventoryReleased';
  } else if (newStatus === 'Dispatched') {
    await inventoryRequest(`/reservations/${encodeURIComponent(order.reservationId)}/deduct`, {});
    inventoryEvent = 'OrderInventoryDeducted';
  }
  order.orderStatus = newStatus;
  order.statusHistory.push({
    previousStatus,
    newStatus,
    changedBy: user.userId,
    timestamp: new Date()
  });
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await order.save({ session });
      const event = {
        Pending_Review: 'OrderCreated',
        Approved: 'OrderApproved',
        Rejected: 'OrderRejected',
        'Processing Order': 'OrderProcessing',
        'Ready to Dispatch': 'OrderReadyForDispatch',
        Dispatched: 'OrderDispatched',
        Delivered: 'OrderDelivered',
        Cancelled: 'OrderCancelled'
      }[newStatus];
      await writeEvent(session, order, event);
      if (inventoryEvent) await writeEvent(session, order, inventoryEvent);
    });
    return serializeOrder(order);
  } finally {
    await session.endSession();
  }
}

export { allowedStatuses, serializeOrder };
