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
  const scopeTenantId = typeof tenantId === 'string' ? tenantId.trim() : '';
  const scopeBranchId = typeof branchId === 'string' ? branchId.trim() : '';
  if (!scopeTenantId || !scopeBranchId) {
    const error = new Error('Verified tenantId and branchId are required for inventory lookup.');
    error.statusCode = 403;
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
  productFilter.tenantId = scopeTenantId;
  const products = await Product.find(productFilter).lean();
  const inventoryFilter = { productId: { $in: products.map(product => product._id) } };
  inventoryFilter.tenantId = scopeTenantId;
  inventoryFilter.branchId = scopeBranchId;
  const inventories = await Inventory.find(inventoryFilter).lean();
  const today = new Date(new Date().toISOString().slice(0, 10));
  const byProductId = new Map();
  for (const row of inventories) {
    const key = String(row.productId);
    if (row.expiryDate && new Date(row.expiryDate) < today) {
      if (includeExpiredBatches === true || String(includeExpiredBatches).toLowerCase() === 'true') {
        if (!expiredByProductId.has(key)) expiredByProductId.set(key, []);
        expiredByProductId.get(key).push(row);
      }
      continue;
    }
    if (!byProductId.has(key)) byProductId.set(key, []);
    byProductId.get(key).push(row);
  }
  return products.map(product => {
    const batches = byProductId.get(String(product._id)) || [];
    const expiredBatches = expiredByProductId.get(String(product._id)) || [];
    batches.sort((a, b) => {
      const ae = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
      const be = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
      return ae - be || String(a._id).localeCompare(String(b._id));
    });
    const stockQuantity = batches.reduce((sum, row) => sum + Number(row.stockQuantity || 0), 0);
    const reservedQuantity = batches.reduce((sum, row) => sum + Number(row.reservedQuantity || 0), 0);
    const availableQuantity = batches.reduce((sum, row) => sum + Math.max(0, Number(row.stockQuantity || 0) - Number(row.reservedQuantity || 0)), 0);
    const priceBatch = batches.find(row => Number(row.stockQuantity || 0) > Number(row.reservedQuantity || 0)) || batches[0];
    const listingBatch = batches[0];
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
      baseCostPrice: product.baseCostPrice || 0, discountPercentage: product.discountPercentage || 0, marginTier: product.marginTier || 'LOW',
      price: priceBatch?.price ?? null,
      stockQuantity,
      reservedQuantity,
      availableQuantity,
      batchCount: batches.length,
      expiredStockQuantity: expiredBatches.reduce((sum, row) => sum + Number(row.stockQuantity || 0), 0),
      expiredBatchAvailability: expiredBatches.map(row => ({
        batchNumber: row.batchNumber || '', expiryDate: row.expiryDate || null,
        stockQuantity: row.stockQuantity, reservedQuantity: row.reservedQuantity,
        availableQuantity: Math.max(0, Number(row.stockQuantity || 0) - Number(row.reservedQuantity || 0)),
        price: row.price
      })),
      batchAvailability: batches.map(row => ({
        batchNumber: row.batchNumber || '',
        expiryDate: row.expiryDate || null,
        stockQuantity: row.stockQuantity,
        reservedQuantity: row.reservedQuantity,
        availableQuantity: Math.max(0, Number(row.stockQuantity || 0) - Number(row.reservedQuantity || 0)),
        price: row.price
      })),
      listingId: listingBatch ? `${listingBatch.tenantId}:${listingBatch.branchId}:${String(product._id)}` : null,
      batchNumber: listingBatch?.batchNumber || '',
      expiryDate: listingBatch?.expiryDate || null,
      tenantId: listingBatch?.tenantId || scopeTenantId,
      branchId: listingBatch?.branchId || scopeBranchId
    };
  });
}

export async function searchInventoryProducts({
  tenantId = null, branchId = null, query = '', category = '', hideRx = false,
  includeOutOfStock = false, includeExpiredBatches = false, sort = 'default', page = 1, limit = 50
} = {}) {
  const scopeTenantId = typeof tenantId === 'string' ? tenantId.trim() : '';
  const scopeBranchId = typeof branchId === 'string' ? branchId.trim() : '';
  if (!scopeTenantId || !scopeBranchId) {
    const error = new Error('Verified tenantId and branchId are required for inventory catalogue search.');
    error.statusCode = 403;
    throw error;
  }
  const normalizedPage = Math.max(1, Math.floor(Number(page) || 1));
  const normalizedLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 50)));
  const normalizedQuery = String(query || '').trim();
  const isSearching = Boolean(normalizedQuery);
  const showOutOfStock = includeOutOfStock === true || String(includeOutOfStock).toLowerCase() === 'true';
  const filter = { active: true };
  filter.tenantId = scopeTenantId;
  if (category && category !== 'All') filter.category = String(category).trim();
  if (hideRx === true || String(hideRx).toLowerCase() === 'true') filter.requiresPrescription = false;
  if (isSearching) {
    const escapedQuery = normalizedQuery.replace(/[.*+?^()|[\]{}\\]/g, '\\$&');
    const pattern = new RegExp(escapedQuery, 'i');
    filter.$or = [{ sku: pattern }, { name: pattern }, { genericName: pattern }, { manufacturer: pattern }, { category: pattern }, { strength: pattern }, { form: pattern }];
  }
  const products = await Product.find(filter).lean();
  const productIds = products.map(product => product._id);
  const inventoryFilter = { productId: { $in: productIds } };
  inventoryFilter.tenantId = scopeTenantId;
  inventoryFilter.branchId = scopeBranchId;
  const inventories = productIds.length ? await Inventory.find(inventoryFilter).lean() : [];
  const byProductId = new Map();
  const expiredByProductId = new Map();
  const today = new Date(new Date().toISOString().slice(0, 10));
  for (const row of inventories) {
    if (row.expiryDate && new Date(row.expiryDate) < today) continue;
    const key = String(row.productId);
    if (!byProductId.has(key)) byProductId.set(key, []);
    byProductId.get(key).push(row);
  }
  const allItems = products.map(product => {
    const batches = byProductId.get(String(product._id)) || [];
    batches.sort((a, b) => {
      const ae = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
      const be = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
      return ae - be || String(a._id).localeCompare(String(b._id));
    });
    const stockQuantity = batches.reduce((sum, row) => sum + Number(row.stockQuantity || 0), 0);
    const reservedQuantity = batches.reduce((sum, row) => sum + Number(row.reservedQuantity || 0), 0);
    const availableQuantity = batches.reduce((sum, row) => sum + Math.max(0, Number(row.stockQuantity || 0) - Number(row.reservedQuantity || 0)), 0);
    const priceBatch = batches.find(row => Number(row.stockQuantity || 0) > Number(row.reservedQuantity || 0)) || batches[0];
    const listingBatch = batches[0];
    const price = priceBatch?.price ?? null;
    return {
      listingId: listingBatch ? String(listingBatch.tenantId) + ':' + String(listingBatch.branchId) + ':' + String(product._id) : null,
      _id: String(product._id), productId: String(product._id), productVersion: product.version, sku: product.sku,
      name: product.name, genericName: product.genericName, composition: product.genericName, drug: product.genericName, activeSalt: product.genericName,
      description: product.description || '', imageUrl: product.imageUrl || '', hsnSac: product.hsnSac || '',
      manufacturer: product.manufacturer, brand: product.manufacturer, strength: product.strength, dosage: product.strength, dosageForm: product.form, form: product.form,
      category: product.category, requiresPrescription: product.requiresPrescription, isPrescriptionRequired: product.requiresPrescription,
      baseCostPrice: product.baseCostPrice || 0, discountPercentage: product.discountPercentage || 0, marginTier: product.marginTier || 'LOW',
      mrp: price, basePrice: price,
      sellingPrice: Math.round(Number(price || 0) * (1 - Math.min(100, Math.max(0, Number(product.discountPercentage || 0))) / 100) * 100) / 100,
      price, stockQuantity, reservedQuantity, availableQuantity,
      stock: stockQuantity, quantity: availableQuantity,
      stockStatus: availableQuantity > 10 ? 'IN_STOCK' : availableQuantity > 0 ? 'LOW_STOCK' : 'OUT_OF_STOCK',
      batchNumber: listingBatch?.batchNumber || '', expiryDate: listingBatch?.expiryDate || null,
      batchCount: batches.length,
      batchAvailability: batches.map(row => ({
        batchNumber: row.batchNumber || '', expiryDate: row.expiryDate || null,
        stockQuantity: row.stockQuantity, reservedQuantity: row.reservedQuantity,
        availableQuantity: Math.max(0, Number(row.stockQuantity || 0) - Number(row.reservedQuantity || 0)),
        price: row.price
      })),
      tenantId: listingBatch?.tenantId || scopeTenantId,
      branchId: listingBatch?.branchId || scopeBranchId
    };
  });
  const visibleItems = !isSearching && !showOutOfStock
    ? allItems.filter(item => item.availableQuantity > 0)
    : allItems;
  const comparators = {
    'price-asc': (a, b) => (a.sellingPrice ?? a.price ?? Number.MAX_SAFE_INTEGER) - (b.sellingPrice ?? b.price ?? Number.MAX_SAFE_INTEGER),
    'price-desc': (a, b) => (b.sellingPrice ?? b.price ?? -1) - (a.sellingPrice ?? a.price ?? -1),
    'name-asc': (a, b) => String(a.name).localeCompare(String(b.name)),
    'stock-asc': (a, b) => a.availableQuantity - b.availableQuantity
  };
  visibleItems.sort(comparators[sort] || comparators['name-asc']);
  const total = visibleItems.length;
  const items = visibleItems.slice((normalizedPage - 1) * normalizedLimit, normalizedPage * normalizedLimit);
  return {
    items, total, page: normalizedPage, limit: normalizedLimit,
    pages: Math.ceil(total / normalizedLimit) || 1,
    isSearching,
    outOfStockHidden: !isSearching && !showOutOfStock
  };
}

const normalizeProductFields = input => ({
  name: String(input.name || '').trim(),
  genericName: String(input.genericName ?? input.drug ?? input.activeSalt ?? '').trim(),
  strength: String(input.strength ?? input.dosage ?? '').trim(),
  form: String(input.form ?? input.dosageForm ?? '').trim(),
  manufacturer: String(input.manufacturer ?? input.brand ?? '').trim(),
  category: String(input.category || 'General Medicine').trim(),
  description: String(input.description || '').trim(),
  imageUrl: String(input.imageUrl || '').trim(),
  hsnSac: String(input.hsnSac || '').trim(),
  baseCostPrice: Number(input.baseCostPrice || 0),
  discountPercentage: Number(input.discountPercentage || 0),
  marginTier: ['LOW', 'MID', 'HIGH'].includes(input.marginTier) ? input.marginTier : 'LOW',
  requiresPrescription: input.requiresPrescription === true || input.isPrescriptionRequired === true
});

export async function createProduct({ product: input = {}, tenantId, branchId, actor, requestId, correlationId } = {}) {
  const scopeTenantId = typeof tenantId === 'string' ? tenantId.trim() : '';
  const scopeBranchId = typeof branchId === 'string' ? branchId.trim() : '';
  const fields = normalizeProductFields(input);
  const sku = String(input.sku || ('MED-' + randomUUID().replace(/-/g, '').slice(0, 10))).trim().toUpperCase();
  const stockQuantity = Number(input.stockQuantity ?? input.stock ?? input.quantity ?? 0);
  const price = Number(input.sellingPrice ?? input.price ?? 0);
  const batchNumber = String(input.batchNumber || '').trim();
  const expiryDate = input.expiryDate ? new Date(input.expiryDate) : null;
  if (!scopeTenantId || !scopeBranchId) {
    const error = new Error('Verified tenantId and branchId are required to create a product.');
    error.statusCode = 403;
    throw error;
  }
  if (!fields.name || !sku || !Number.isSafeInteger(stockQuantity) || stockQuantity < 0
    || !Number.isFinite(price) || price < 0 || !Number.isFinite(fields.baseCostPrice) || fields.baseCostPrice < 0
    || !Number.isFinite(fields.discountPercentage) || fields.discountPercentage < 0 || fields.discountPercentage > 100
    || (expiryDate && !Number.isFinite(expiryDate.getTime()))) {
    const error = new Error('A product name, valid SKU, non-negative integer stock, and non-negative price are required.');
    error.statusCode = 400;
    throw error;
  }
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const [created] = await Product.create([{
        tenantId: scopeTenantId, sku, ...fields, version: 1, active: true
      }], { session });
      const [inventory] = await Inventory.create([{
        tenantId: scopeTenantId, branchId: scopeBranchId, productId: created._id, sku,
        stockQuantity, reservedQuantity: 0, price, batchNumber, expiryDate
      }], { session });
      result = {
        _id: String(created._id), productId: String(created._id), sku, ...fields,
        price, stockQuantity, reservedQuantity: 0, availableQuantity: stockQuantity,
        batchNumber, expiryDate: inventory.expiryDate || null, tenantId: scopeTenantId, branchId: scopeBranchId
      };
      await Audit.create([{
        tenantId: scopeTenantId, branchId: scopeBranchId, actor: actor || 'system',
        operation: 'create_product', requestId, correlationId,
        productId: created._id, sku, details: { result }
      }], { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const conflict = new Error('This SKU already exists in the selected tenant.');
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  } finally { await session.endSession(); }
  return result;
}

export async function updateProduct({ productId, product: input = {}, tenantId, branchId, actor, requestId, correlationId } = {}) {
  const scopeTenantId = typeof tenantId === 'string' ? tenantId.trim() : '';
  const scopeBranchId = typeof branchId === 'string' ? branchId.trim() : '';
  if (!scopeTenantId || !scopeBranchId || !mongoose.isValidObjectId(productId)) {
    const error = new Error('Verified tenantId, branchId and a valid productId are required.');
    error.statusCode = 400;
    throw error;
  }
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const product = await Product.findOne({ _id: productId, tenantId: scopeTenantId }).session(session);
      if (!product) {
        const error = new Error('Product was not found in this tenant.');
        error.statusCode = 404;
        throw error;
      }
      const fields = normalizeProductFields(input);
      if (!Number.isFinite(fields.baseCostPrice) || fields.baseCostPrice < 0
        || !Number.isFinite(fields.discountPercentage) || fields.discountPercentage < 0 || fields.discountPercentage > 100) {
        const error = new Error('Base cost must be non-negative and discount percentage must be between 0 and 100.');
        error.statusCode = 400;
        throw error;
      }
      const editableFields = ['name', 'genericName', 'strength', 'form', 'manufacturer', 'category', 'description', 'imageUrl', 'hsnSac', 'baseCostPrice', 'discountPercentage', 'marginTier', 'requiresPrescription'];
      for (const field of editableFields) {
        if (Object.prototype.hasOwnProperty.call(input, field)
          || (field === 'genericName' && ('drug' in input || 'activeSalt' in input))
          || (field === 'strength' && 'dosage' in input)
          || (field === 'form' && 'dosageForm' in input)
          || (field === 'manufacturer' && 'brand' in input)
          || (field === 'requiresPrescription' && 'isPrescriptionRequired' in input)) {
          product[field] = fields[field];
        }
      }
      product.version = Number(product.version || 1) + 1;
      await product.save({ session });

      const hasStock = input.stockQuantity !== undefined || input.stock !== undefined || input.quantity !== undefined;
      const hasPrice = input.price !== undefined || input.sellingPrice !== undefined;
      let inventory = null;
      if (hasStock || hasPrice || input.expiryDate !== undefined || input.batchNumber !== undefined) {
        const batches = await Inventory.find({
          tenantId: scopeTenantId, branchId: scopeBranchId, productId: product._id
        }).session(session);
        const requestedBatch = input.batchNumber === undefined ? null : String(input.batchNumber || '').trim();
        if (requestedBatch === null && batches.length > 1) {
          const error = new Error('Select a batch number before changing stock for a multi-batch product.');
          error.statusCode = 409;
          throw error;
        }
        inventory = requestedBatch === null ? batches[0] || null
          : batches.find(row => String(row.batchNumber || '') === requestedBatch) || null;
        if (!inventory) {
          const batchNumber = requestedBatch ?? '';
          inventory = new Inventory({
            tenantId: scopeTenantId, branchId: scopeBranchId, productId: product._id,
            sku: product.sku, batchNumber, reservedQuantity: 0, stockQuantity: 0,
            price: Number(input.sellingPrice ?? input.price ?? 0)
          });
        }
        if (hasStock) {
          const nextStock = Number(input.stockQuantity ?? input.stock ?? input.quantity);
          if (!Number.isSafeInteger(nextStock) || nextStock < Number(inventory.reservedQuantity || 0)) {
            const error = new Error('Stock must be a non-negative integer and cannot be lower than reserved stock.');
            error.statusCode = 409;
            throw error;
          }
          inventory.stockQuantity = nextStock;
        }
        if (hasPrice) {
          const nextPrice = Number(input.sellingPrice ?? input.price);
          if (!Number.isFinite(nextPrice) || nextPrice < 0) {
            const error = new Error('Price must be a non-negative number.');
            error.statusCode = 400;
            throw error;
          }
          inventory.price = nextPrice;
        }
        if (input.expiryDate) {
          const expiry = new Date(input.expiryDate);
          if (!Number.isFinite(expiry.getTime())) {
            const error = new Error('Expiry date is invalid.');
            error.statusCode = 400;
            throw error;
          }
          inventory.expiryDate = expiry;
        }
        inventory.sku = product.sku;
        await inventory.save({ session });
      }
      result = {
        _id: String(product._id), productId: String(product._id), sku: product.sku,
        ...normalizeProductFields(product.toObject()),
        ...(inventory ? {
          price: inventory.price, stockQuantity: inventory.stockQuantity,
          reservedQuantity: inventory.reservedQuantity,
          availableQuantity: Math.max(0, inventory.stockQuantity - inventory.reservedQuantity),
          batchNumber: inventory.batchNumber, expiryDate: inventory.expiryDate || null
        } : {}),
        tenantId: scopeTenantId, branchId: scopeBranchId
      };
      await Audit.create([{
        tenantId: scopeTenantId, branchId: scopeBranchId, actor: actor || 'system',
        operation: 'update_product', requestId, correlationId,
        productId: product._id, sku: product.sku, details: { result }
      }], { session });
    });
  } finally { await session.endSession(); }
  return result;
}

export async function archiveProduct({ productId, tenantId, branchId, actor, requestId, correlationId } = {}) {
  const scopeTenantId = typeof tenantId === 'string' ? tenantId.trim() : '';
  const scopeBranchId = typeof branchId === 'string' ? branchId.trim() : '';
  if (!scopeTenantId || !scopeBranchId || !mongoose.isValidObjectId(productId)) {
    const error = new Error('Verified tenantId, branchId and a valid productId are required.');
    error.statusCode = 400;
    throw error;
  }
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const product = await Product.findOne({ _id: productId, tenantId: scopeTenantId }).session(session);
      if (!product) {
        const error = new Error('Product was not found in this tenant.');
        error.statusCode = 404;
        throw error;
      }
      product.active = false;
      product.version = Number(product.version || 1) + 1;
      await product.save({ session });
      result = { productId: String(product._id), sku: product.sku, active: false };
      await Audit.create([{
        tenantId: scopeTenantId, branchId: scopeBranchId, actor: actor || 'system',
        operation: 'archive_product', requestId, correlationId,
        productId: product._id, sku: product.sku, details: { result }
      }], { session });
    });
  } finally { await session.endSession(); }
  return result;
}

export async function reserveInventory({ orderId, items, idempotencyKey, actor, requestId, correlationId, tenantId = null, branchId = null }) {
  const normalizedOrderId = typeof orderId === 'string' ? orderId.trim() : '';
  const normalizedIdempotencyKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
  const normalizedTenantId = typeof tenantId === 'string' ? tenantId.trim() : '';
  const normalizedBranchId = typeof branchId === 'string' ? branchId.trim() : '';
  if (!normalizedOrderId || !normalizedIdempotencyKey || normalizedIdempotencyKey.length > 200
    || !normalizedTenantId || !normalizedBranchId) {
    const error = new Error('orderId, idempotencyKey, verified tenantId and branchId are required.');
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
  const reservationFilter = { idempotencyKey: normalizedIdempotencyKey, tenantId: normalizedTenantId, branchId: normalizedBranchId };
  const existing = await Reservation.findOne(reservationFilter).lean();
  if (existing) return replayExisting(existing);
  const session = await mongoose.startSession();
  const reservationId = `RES-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + (config.reservationTTLHours || 24) * 3600_000);
  const today = new Date(new Date().toISOString().slice(0, 10));
  try {
    await session.withTransaction(async () => {
      const productIds = normalized.map(item => new mongoose.Types.ObjectId(item.productId));
      const products = await Product.find({
        _id: { $in: productIds }, tenantId: normalizedTenantId, active: true
      }).session(session).lean();
      const productById = new Map(products.map(product => [String(product._id), product]));
      const reservedItems = [];
      for (const item of normalized) {
        const product = productById.get(item.productId);
        if (!product) {
          const error = new Error(`Product ${item.productId} is unavailable in this tenant.`);
          error.statusCode = 409;
          throw error;
        }
        const candidates = await Inventory.find({
          productId: product._id,
          tenantId: normalizedTenantId,
          branchId: normalizedBranchId,
          $expr: { $gt: ['$stockQuantity', '$reservedQuantity'] },
          $or: [{ expiryDate: null }, { expiryDate: { $gte: today } }]
        }).session(session).lean();
        candidates.sort((a, b) => {
          const ae = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
          const be = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
          return ae - be || String(a._id).localeCompare(String(b._id));
        });
        let remaining = item.quantity;
        const allocations = [];
        for (const candidate of candidates) {
          if (remaining <= 0) break;
          const available = Math.max(0, Number(candidate.stockQuantity || 0) - Number(candidate.reservedQuantity || 0));
          const take = Math.min(remaining, available);
          if (!take) continue;
          const changed = await Inventory.updateOne({
            _id: candidate._id,
            tenantId: normalizedTenantId,
            branchId: normalizedBranchId,
            $expr: { $gte: [{ $subtract: ['$stockQuantity', '$reservedQuantity'] }, take] },
            $or: [{ expiryDate: null }, { expiryDate: { $gte: today } }]
          }, { $inc: { reservedQuantity: take } }, { session });
          if (changed.modifiedCount !== 1) {
            const conflict = new Error(`Inventory changed concurrently for SKU ${product.sku}; retry the reservation.`);
            conflict.statusCode = 409;
            throw conflict;
          }
          allocations.push({ inventoryId: candidate._id, batchNumber: candidate.batchNumber || '', quantity: take });
          remaining -= take;
        }
        if (remaining > 0) {
          const error = new Error(`Insufficient available inventory for SKU ${product.sku}; ${remaining} more required.`);
          error.statusCode = 409;
          error.code = 'INSUFFICIENT_INVENTORY';
          throw error;
        }
        reservedItems.push({ productId: product._id, sku: product.sku, quantity: item.quantity, allocations });
      }
      await Reservation.create([{
        reservationId, tenantId: normalizedTenantId, branchId: normalizedBranchId,
        idempotencyKey: normalizedIdempotencyKey, orderId: normalizedOrderId,
        status: 'RESERVED', expiresAt, items: reservedItems
      }], { session });
      await Audit.create([{
        tenantId: normalizedTenantId, branchId: normalizedBranchId, actor: actor || 'system',
        operation: 'reserve', requestId, correlationId,
        details: { orderId: normalizedOrderId, reservationId, expiresAt, items: reservedItems }
      }], { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const repeated = await Reservation.findOne(reservationFilter).lean();
      if (repeated) return replayExisting(repeated);
    }
    throw error;
  } finally { await session.endSession(); }
  return { reservationId, status: 'RESERVED', items: normalized, expiresAt };
}

export async function transitionReservation(reservationId, targetStatus, { actor, requestId, correlationId, tenantId = null, branchId = null } = {}) {
  if (!tenantId || !branchId) {
    const error = new Error('Verified tenantId and branchId are required to transition a reservation.');
    error.statusCode = 403;
    throw error;
  }
  if (!['RELEASED', 'DEDUCTED'].includes(targetStatus)) {
    const error = new Error('Unsupported reservation transition.');
    error.statusCode = 400;
    throw error;
  }
  const reservationFilter = { reservationId };
  if (tenantId) reservationFilter.tenantId = String(tenantId).trim();
  if (branchId) reservationFilter.branchId = String(branchId).trim();
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const reservation = await Reservation.findOne(reservationFilter).session(session);
      if (!reservation) {
        const error = new Error('Reservation was not found in this tenant and branch.');
        error.statusCode = 404;
        throw error;
      }
      if (reservation.status === targetStatus) { result = reservation; return; }
      if (reservation.status !== 'RESERVED') {
        const error = new Error(`Cannot change a ${reservation.status.toLowerCase()} reservation.`);
        error.statusCode = 409;
        throw error;
      }
      for (const item of reservation.items) {
        const allocations = Array.isArray(item.allocations) && item.allocations.length
          ? item.allocations
          : [{ inventoryId: null, quantity: item.quantity }];
        let remaining = item.quantity;
        for (const allocation of allocations) {
          const quantity = Number(allocation.quantity || 0);
          if (!Number.isSafeInteger(quantity) || quantity < 1) continue;
          const condition = {
            tenantId: reservation.tenantId, branchId: reservation.branchId,
            productId: item.productId, reservedQuantity: { $gte: quantity }
          };
          if (allocation.inventoryId) condition._id = allocation.inventoryId;
          if (targetStatus === 'DEDUCTED') condition.stockQuantity = { $gte: quantity };
          const update = targetStatus === 'RELEASED'
            ? { $inc: { reservedQuantity: -quantity } }
            : { $inc: { stockQuantity: -quantity, reservedQuantity: -quantity } };
          const changed = await Inventory.updateOne(condition, update, { session });
          if (changed.modifiedCount !== 1) {
            const error = new Error(`Inventory allocation changed unexpectedly for SKU ${item.sku}.`);
            error.statusCode = 409;
            throw error;
          }
          remaining -= quantity;
        }
        if (remaining !== 0) {
          const error = new Error(`Reservation allocations are incomplete for SKU ${item.sku}.`);
          error.statusCode = 409;
          throw error;
        }
      }
      reservation.status = targetStatus;
      await reservation.save({ session });
      await Audit.create([{
        tenantId: reservation.tenantId, branchId: reservation.branchId,
        actor: actor || 'system', operation: targetStatus.toLowerCase(),
        requestId, correlationId, details: { reservationId, orderId: reservation.orderId }
      }], { session });
      result = reservation;
    });
  } finally { await session.endSession(); }
  return { reservationId: result.reservationId, status: result.status };
}

export async function adjustInventory({ sku, stockQuantity, price, batchNumber, expiryDate, actor, requestId, correlationId, operationKey, tenantId = null, branchId = null }) {
  const normalizedSku = typeof sku === 'string' ? sku.trim().toUpperCase() : '';
  const normalizedOperationKey = typeof operationKey === 'string' ? operationKey.trim() : '';
  const normalizedTenantId = typeof tenantId === 'string' ? tenantId.trim() : '';
  const normalizedBranchId = typeof branchId === 'string' ? branchId.trim() : '';
  const normalizedBatchNumber = typeof batchNumber === 'string' ? batchNumber.trim() : '';
  const normalizedExpiry = expiryDate ? new Date(expiryDate) : null;
  if (!normalizedSku || !Number.isSafeInteger(stockQuantity) || stockQuantity < 0
    || !Number.isFinite(price) || price < 0 || !normalizedOperationKey || normalizedOperationKey.length > 200
    || !normalizedTenantId || !normalizedBranchId
    || (normalizedExpiry && !Number.isFinite(normalizedExpiry.getTime()))) {
    const error = new Error('sku, non-negative stockQuantity, non-negative price, operationKey, tenantId and branchId are required.');
    error.statusCode = 400;
    throw error;
  }
  const request = { sku: normalizedSku, stockQuantity, price, batchNumber: normalizedBatchNumber, expiryDate: normalizedExpiry?.toISOString() || null, tenantId: normalizedTenantId, branchId: normalizedBranchId };
  const replayExisting = prior => {
    if (JSON.stringify(prior.details.request) !== JSON.stringify(request)) {
      const error = new Error('Idempotency key has already been used for a different adjustment.');
      error.statusCode = 409;
      throw error;
    }
    return prior.details.result;
  };
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const prior = await Audit.findOne({ operationKey: normalizedOperationKey, operation: 'adjust', tenantId: normalizedTenantId, branchId: normalizedBranchId }).session(session).lean();
      if (prior) { result = replayExisting(prior); return; }
      const product = await Product.findOne({ sku: normalizedSku, tenantId: normalizedTenantId, active: true }).session(session);
      if (!product) {
        const error = new Error('Product SKU was not found in this tenant.');
        error.statusCode = 404;
        throw error;
      }
      let inventory = await Inventory.findOne({
        tenantId: normalizedTenantId, branchId: normalizedBranchId,
        productId: product._id, batchNumber: normalizedBatchNumber
      }).session(session);
      if (inventory && Number(inventory.reservedQuantity || 0) > stockQuantity) {
        const error = new Error('Stock adjustment would reduce stock below reserved quantity.');
        error.statusCode = 409;
        throw error;
      }
      if (!inventory) inventory = new Inventory({
        tenantId: normalizedTenantId, branchId: normalizedBranchId,
        productId: product._id, sku: normalizedSku, batchNumber: normalizedBatchNumber,
        reservedQuantity: 0, warehouse: 'default'
      });
      Object.assign(inventory, { stockQuantity, price, batchNumber: normalizedBatchNumber, ...(normalizedExpiry ? { expiryDate: normalizedExpiry } : {}) });
      await inventory.save({ session });
      result = {
        productId: String(product._id), sku: normalizedSku, batchNumber: normalizedBatchNumber,
        stockQuantity: inventory.stockQuantity, reservedQuantity: inventory.reservedQuantity,
        availableQuantity: Math.max(0, inventory.stockQuantity - inventory.reservedQuantity), price: inventory.price
      };
      await Audit.create([{
        tenantId: normalizedTenantId, branchId: normalizedBranchId,
        actor: actor || 'system', operation: 'adjust', operationKey: normalizedOperationKey,
        requestId, correlationId, productId: product._id, sku: normalizedSku,
        details: { request, result }
      }], { session });
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const repeated = await Audit.findOne({ operationKey: normalizedOperationKey, operation: 'adjust', tenantId: normalizedTenantId, branchId: normalizedBranchId }).lean();
    if (repeated) return replayExisting(repeated);
    throw error;
  } finally { await session.endSession(); }
  return result;
}

export { normalizeItems };
