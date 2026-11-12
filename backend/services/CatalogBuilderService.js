import CatalogProduct from '../models/CatalogProduct.js';
import TenantCatalogOverride from '../models/TenantCatalogOverride.js';
import CatalogCategory from '../models/CatalogCategory.js';
import CatalogImportBatch from '../models/CatalogImportBatch.js';
import Medicine from '../models/Medicine.js';
import { getIsConnected } from '../config/db.js';

/**
 * Technical Algorithm Helper: Canonical Text Normalization
 * Standardizes medicine/product titles, strengths, and dosage forms.
 */
export function normalizeText(text) {
    if (!text) return '';
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/gi, '')
        .replace(/\b(tab|tbl|tabs|tablets)\b/gi, 'tablet')
        .replace(/\b(cap|caps|capsules)\b/gi, 'capsule')
        .replace(/\b(syr|syrup)\b/gi, 'syrup')
        .replace(/\b(inj|injection)\b/gi, 'injection')
        .replace(/\b(\d+)\s*(mg|g|ml|mcg|iu)\b/gi, '$1$2')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Technical Algorithm Helper: Jaro-Winkler Similarity Distance (0.0 to 1.0)
 * Evaluates duplicate probability between product entries.
 */
export function calculateJaroWinklerSimilarity(s1, s2) {
    const a = normalizeText(s1);
    const b = normalizeText(s2);
    if (a === b) return 1.0;
    if (!a || !b) return 0.0;

    const len1 = a.length;
    const len2 = b.length;
    const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;

    const aMatches = new Array(len1).fill(false);
    const bMatches = new Array(len2).fill(false);

    let matches = 0;
    let transpositions = 0;

    for (let i = 0; i < len1; i++) {
        const start = Math.max(0, i - matchDistance);
        const end = Math.min(i + matchDistance + 1, len2);

        for (let j = start; j < end; j++) {
            if (bMatches[j]) continue;
            if (a[i] !== b[j]) continue;
            aMatches[i] = true;
            bMatches[j] = true;
            matches++;
            break;
        }
    }

    if (matches === 0) return 0.0;

    let k = 0;
    for (let i = 0; i < len1; i++) {
        if (!aMatches[i]) continue;
        while (!bMatches[k]) k++;
        if (a[i] !== b[k]) transpositions++;
        k++;
    }

    const m = matches;
    const jaro = (m / len1 + m / len2 + (m - transpositions / 2) / m) / 3;

    // Winkler prefix adjustment (up to 4 chars)
    let p = 0.1;
    let l = 0;
    while (l < 4 && a[l] === b[l]) l++;

    return jaro + l * p * (1 - jaro);
}

export class CatalogBuilderService {
    /**
     * Technical Algorithm: Duplicate Detection & Similarity Check
     * Flags existing items with >85% match confidence.
     */
    static async checkProductSimilarity(tenantId, newProduct) {
        const normName = normalizeText(newProduct.name);
        const targetBrand = normalizeText(newProduct.brand || '');
        const targetStrength = normalizeText(newProduct.strength || '');

        let existingProducts = [];
        if (getIsConnected()) {
            existingProducts = await CatalogProduct.find({
                $or: [
                    { tenantId: tenantId },
                    { tenantId: null } // Include global master catalog
                ]
            }).lean();
        }

        const candidates = [];
        for (const item of existingProducts) {
            const nameScore = calculateJaroWinklerSimilarity(normName, item.normalizedName || item.name);
            const brandScore = targetBrand ? calculateJaroWinklerSimilarity(targetBrand, item.brand) : 0.8;
            const strengthMatch = targetStrength && item.strength
                ? normalizeText(item.strength) === targetStrength ? 1.0 : 0.5
                : 0.8;

            const compositeScore = (nameScore * 0.6) + (brandScore * 0.25) + (strengthMatch * 0.15);

            if (compositeScore >= 0.70) {
                candidates.push({
                    productId: item._id,
                    sku: item.sku,
                    name: item.name,
                    brand: item.brand,
                    strength: item.strength,
                    category: item.category,
                    similarityScore: Math.round(compositeScore * 100) / 100,
                    isExactMatch: compositeScore >= 0.95,
                    tenantId: item.tenantId
                });
            }
        }

        candidates.sort((a, b) => b.similarityScore - a.similarityScore);

        return {
            queryName: newProduct.name,
            hasPotentialDuplicates: candidates.length > 0,
            highestMatchScore: candidates[0]?.similarityScore || 0,
            matches: candidates.slice(0, 5)
        };
    }

    /**
     * Technical Algorithm: Variant Matrix Permutation Generator
     * Computes Cartesian combinations for strengths, pack sizes, and prices.
     */
    static generateVariantMatrix(baseSKU, baseName, basePrice, options = {}) {
        const packSizes = options.packSizes && options.packSizes.length > 0
            ? options.packSizes
            : ['Strip of 10 Tablets', 'Pack of 30 Tablets', 'Bottle of 100ml'];

        const strengths = options.strengths && options.strengths.length > 0
            ? options.strengths
            : ['Standard'];

        const variants = [];
        let index = 1;

        for (const strength of strengths) {
            for (const pack of packSizes) {
                const mult = pack.includes('30') ? 2.7 : pack.includes('100') ? 1.5 : 1.0;
                const price = Math.round(basePrice * mult);
                const strTag = strength === 'Standard' ? '' : `-${strength.replace(/\s+/g, '').toUpperCase()}`;
                const packTag = pack.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
                
                const variantSku = `${baseSKU}${strTag}-${packTag}-${index++}`;

                variants.push({
                    variantSku,
                    name: `${baseName} ${strength !== 'Standard' ? strength : ''} (${pack})`.trim(),
                    packSize: pack,
                    strength: strength === 'Standard' ? '' : strength,
                    mrp: Math.round(price * 1.15),
                    sellingPrice: price,
                    costPrice: Math.round(price * 0.7),
                    stockQuantity: 50,
                    isDefault: index === 2,
                    barcode: `BC-${Date.now().toString().slice(-6)}-${index}`
                });
            }
        }
        return variants;
    }

    /**
     * Add Custom Product to Tenant Catalog
     */
    static async createProduct(tenantId, payload, options = {}) {
        const { forceSave = false } = options;

        if (!forceSave) {
            const dupCheck = await this.checkProductSimilarity(tenantId, payload);
            if (dupCheck.hasPotentialDuplicates && dupCheck.highestMatchScore >= 0.90) {
                const error = new Error(`Potential duplicate product detected with ${Math.round(dupCheck.highestMatchScore * 100)}% similarity.`);
                error.statusCode = 409;
                error.duplicates = dupCheck.matches;
                throw error;
            }
        }

        const sku = (payload.sku || `SKU-${tenantId.substring(0, 4).toUpperCase()}-${Date.now().toString().slice(-6)}`).toUpperCase();
        const normalizedName = normalizeText(payload.name);
        
        // Algorithmic variant matrix generation if variants not explicitly passed
        const variants = payload.variants && payload.variants.length > 0
            ? payload.variants
            : this.generateVariantMatrix(sku, payload.name, Number(payload.basePrice || payload.sellingPrice || 100), {
                packSizes: payload.packSizes,
                strengths: payload.strengths ? [payload.strength] : []
            });

        const productData = {
            tenantId: tenantId || 'tenant-ashvin-main',
            branchId: payload.branchId || 'branch-indore-central',
            sku,
            gtin: payload.gtin || payload.barcode || '',
            barcode: payload.barcode || '',
            name: payload.name.trim(),
            normalizedName,
            brand: payload.brand.trim(),
            manufacturer: payload.manufacturer || 'Pharma Labs',
            category: payload.category || 'General Medicine',
            subCategory: payload.subCategory || 'General',
            composition: payload.composition || payload.salt || '',
            activeIngredients: payload.activeIngredients || (payload.composition ? [payload.composition] : []),
            dosageForm: payload.dosageForm || 'Tablet',
            strength: payload.strength || '',
            mrp: Number(payload.mrp || payload.basePrice * 1.15 || 120),
            basePrice: Number(payload.basePrice || payload.sellingPrice || 100),
            costPrice: Number(payload.costPrice || 70),
            prescriptionRequired: Boolean(payload.prescriptionRequired || payload.requiresPrescription),
            storageCondition: payload.storageCondition || 'Room Temperature',
            description: payload.description || '',
            imageUrl: payload.imageUrl || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80',
            attributes: payload.attributes || [],
            variants,
            tags: payload.tags || [payload.category, payload.dosageForm].filter(Boolean),
            isPublished: payload.isPublished !== false,
            status: payload.status || 'published',
            createdSource: 'tenant_custom',
            searchTokens: [normalizedName, normalizeText(payload.brand), normalizeText(payload.category)].filter(Boolean)
        };

        let product;
        if (getIsConnected()) {
            product = await CatalogProduct.create(productData);

            // Create local tenant stock & price override
            await TenantCatalogOverride.create({
                tenantId: tenantId || 'tenant-ashvin-main',
                branchId: payload.branchId || 'branch-indore-central',
                productId: product._id,
                tenantSku: sku,
                mrp: productData.mrp,
                sellingPrice: productData.basePrice,
                costPrice: productData.costPrice,
                stockQuantity: Number(payload.stockQuantity || payload.stock || 50),
                aisleLocation: payload.aisleLocation || 'Aisle-1',
                reorderPoint: Number(payload.reorderPoint || 10),
                isAvailable: true
            });

            // Sync legacy Medicine collection for backwards compatibility
            try {
                await Medicine.create({
                    tenantId: productData.tenantId,
                    branchId: productData.branchId,
                    sku: productData.sku,
                    name: productData.name,
                    brand: productData.brand,
                    category: productData.category,
                    subCategory: productData.subCategory,
                    description: productData.description,
                    composition: productData.composition,
                    strength: productData.strength,
                    dosageForm: productData.dosageForm,
                    price: productData.basePrice,
                    basePrice: productData.basePrice,
                    stockQuantity: Number(payload.stockQuantity || 50),
                    stock: Number(payload.stockQuantity || 50),
                    expiryDate: new Date(Date.now() + 365 * 86400000),
                    requiresPrescription: productData.prescriptionRequired,
                    imageUrl: productData.imageUrl,
                    manufacturer: productData.manufacturer
                });
            } catch (err) {
                console.warn('[CatalogBuilder] Legacy Medicine sync notice:', err.message);
            }
        } else {
            product = { _id: `cat-${Date.now()}`, ...productData };
        }

        return product;
    }

    /**
     * Tenant-Isolated Catalog Query & Aggregation Engine
     */
    static async getTenantCatalog(tenantId, params = {}) {
        const { search = '', category = '', status = '', page = 1, limit = 20 } = params;
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

        if (!getIsConnected()) {
            return {
                products: [],
                total: 0,
                page: pageNum,
                totalPages: 0,
                tenantId
            };
        }

        const filter = {
            $or: [
                { tenantId: tenantId },
                { tenantId: null }
            ],
            status: status ? status : { $ne: 'archived' }
        };

        if (category && category !== 'All') {
            filter.category = category;
        }

        if (search) {
            const norm = normalizeText(search);
            filter.$or = [
                { name: new RegExp(search, 'i') },
                { normalizedName: new RegExp(norm, 'i') },
                { brand: new RegExp(search, 'i') },
                { sku: new RegExp(search, 'i') },
                { composition: new RegExp(search, 'i') }
            ];
        }

        const [products, total] = await Promise.all([
            CatalogProduct.find(filter)
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            CatalogProduct.countDocuments(filter)
        ]);

        // Attach tenant stock/price overrides
        const productIds = products.map(p => p._id);
        const overrides = await TenantCatalogOverride.find({
            tenantId,
            productId: { $in: productIds }
        }).lean();

        const overrideMap = new Map(overrides.map(o => [String(o.productId), o]));

        const enrichedProducts = products.map(product => {
            const override = overrideMap.get(String(product._id));
            return {
                ...product,
                effectivePrice: override ? override.sellingPrice : product.basePrice,
                effectiveMrp: override ? override.mrp : product.mrp,
                stockQuantity: override ? override.stockQuantity : (product.variants?.[0]?.stockQuantity || 0),
                aisleLocation: override ? override.aisleLocation : 'Aisle-1',
                isTenantCustom: String(product.tenantId) === String(tenantId),
                override
            };
        });

        return {
            products: enrichedProducts,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum) || 1,
            tenantId
        };
    }

    /**
     * Technical Algorithm: Bulk Catalog Builder CSV/JSON Ingestion Pipeline
     * Dry-run validation, batch creation, error audit, atomic upsert.
     */
    static async processBulkCatalogImport(tenantId, items, fileName = 'catalog_import.csv', executedBy = 'Tenant Admin') {
        const batchId = `BATCH-${tenantId.substring(0, 4).toUpperCase()}-${Date.now()}`;
        const totalRows = items.length;
        const errors = [];
        let successCount = 0;
        let skippedCount = 0;

        let batchRecord = null;
        if (getIsConnected()) {
            batchRecord = await CatalogImportBatch.create({
                tenantId,
                batchId,
                fileName,
                totalRows,
                status: 'processing',
                executedBy
            });
        }

        for (let idx = 0; idx < items.length; idx++) {
            const rowNumber = idx + 1;
            const item = items[idx];

            if (!item.name || !String(item.name).trim()) {
                errors.push({
                    rowNumber,
                    sku: item.sku || '',
                    productName: '',
                    field: 'name',
                    message: 'Product name is required.',
                    rawData: item
                });
                continue;
            }

            if (!item.basePrice && !item.price && !item.sellingPrice) {
                errors.push({
                    rowNumber,
                    sku: item.sku || '',
                    productName: item.name,
                    field: 'price',
                    message: 'Base price or selling price is required.',
                    rawData: item
                });
                continue;
            }

            try {
                await this.createProduct(tenantId, {
                    ...item,
                    basePrice: Number(item.basePrice || item.price || item.sellingPrice),
                    brand: item.brand || 'Generic',
                    category: item.category || 'General Medicine',
                    stockQuantity: Number(item.stockQuantity || item.stock || 50)
                }, { forceSave: true });

                successCount++;
            } catch (err) {
                errors.push({
                    rowNumber,
                    sku: item.sku || '',
                    productName: item.name,
                    field: 'system',
                    message: err.message,
                    rawData: item
                });
            }
        }

        const errorCount = errors.length;
        const finalStatus = errorCount === 0 ? 'completed' : successCount > 0 ? 'completed_with_errors' : 'failed';

        if (getIsConnected() && batchRecord) {
            await CatalogImportBatch.updateOne(
                { _id: batchRecord._id },
                {
                    $set: {
                        successCount,
                        errorCount,
                        skippedCount,
                        status: finalStatus,
                        errors
                    }
                }
            );
        }

        return {
            batchId,
            fileName,
            totalRows,
            successCount,
            errorCount,
            skippedCount,
            status: finalStatus,
            errors
        };
    }

    /**
     * Fetch Global Master Catalog items for 1-click store linking
     */
    static async getMasterCatalog(params = {}) {
        const { search = '', category = '', page = 1, limit = 20 } = params;
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

        if (!getIsConnected()) {
            return { masterProducts: [], total: 0, page: pageNum, totalPages: 0 };
        }

        const filter = {
            tenantId: null,
            status: 'published'
        };

        if (category && category !== 'All') {
            filter.category = category;
        }

        if (search) {
            filter.$or = [
                { name: new RegExp(search, 'i') },
                { brand: new RegExp(search, 'i') },
                { composition: new RegExp(search, 'i') }
            ];
        }

        const [masterProducts, total] = await Promise.all([
            CatalogProduct.find(filter)
                .sort({ name: 1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            CatalogProduct.countDocuments(filter)
        ]);

        return {
            masterProducts,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum) || 1
        };
    }

    /**
     * 1-Click Link Master Product to Tenant Pharmacy Catalog
     */
    static async linkMasterProductToTenant(tenantId, productId, overrideData = {}) {
        if (!getIsConnected()) {
            return { message: 'Linked in memory mode' };
        }

        const product = await CatalogProduct.findById(productId).lean();
        if (!product) {
            const error = new Error('Master catalog product not found.');
            error.statusCode = 404;
            throw error;
        }

        const sellingPrice = Number(overrideData.sellingPrice || product.basePrice || 100);
        const mrp = Number(overrideData.mrp || product.mrp || 120);
        const stockQuantity = Number(overrideData.stockQuantity || 50);

        const override = await TenantCatalogOverride.findOneAndUpdate(
            { tenantId, productId },
            {
                $set: {
                    tenantId,
                    productId,
                    tenantSku: overrideData.tenantSku || product.sku,
                    sellingPrice,
                    mrp,
                    stockQuantity,
                    aisleLocation: overrideData.aisleLocation || 'Aisle-1',
                    isAvailable: true,
                    isCustomPrice: sellingPrice !== product.basePrice
                }
            },
            { upsert: true, new: true, runValidators: true }
        );

        // Also ensure Medicine entry exists for legacy compatibility
        try {
            await Medicine.updateOne(
                { tenantId, sku: product.sku },
                {
                    $set: {
                        tenantId,
                        sku: product.sku,
                        name: product.name,
                        brand: product.brand,
                        category: product.category,
                        price: sellingPrice,
                        stockQuantity,
                        stock: stockQuantity,
                        requiresPrescription: product.prescriptionRequired,
                        imageUrl: product.imageUrl,
                        manufacturer: product.manufacturer
                    }
                },
                { upsert: true }
            );
        } catch (err) {
            console.warn('[CatalogBuilder] Legacy sync error on link:', err.message);
        }

        return { message: `Product "${product.name}" linked to pharmacy store successfully!`, override };
    }

    /**
     * Quick inline price, stock, and availability updater
     */
    static async quickUpdateTenantProduct(tenantId, productId, updateData = {}) {
        if (!getIsConnected()) {
            return { message: 'Updated in memory mode' };
        }

        const { sellingPrice, mrp, stockQuantity, status } = updateData;

        if (status) {
            await CatalogProduct.updateOne({ _id: productId }, { $set: { status } });
        }

        const updateFields = {};
        if (sellingPrice !== undefined) updateFields.sellingPrice = Number(sellingPrice);
        if (mrp !== undefined) updateFields.mrp = Number(mrp);
        if (stockQuantity !== undefined) updateFields.stockQuantity = Number(stockQuantity);

        if (Object.keys(updateFields).length > 0) {
            await TenantCatalogOverride.updateOne(
                { tenantId, productId },
                { $set: updateFields },
                { upsert: true }
            );

            // Also update Medicine collection
            const prod = await CatalogProduct.findById(productId).lean();
            if (prod) {
                const medFields = {};
                if (sellingPrice !== undefined) medFields.price = Number(sellingPrice);
                if (stockQuantity !== undefined) {
                    medFields.stockQuantity = Number(stockQuantity);
                    medFields.stock = Number(stockQuantity);
                }
                await Medicine.updateOne({ tenantId, sku: prod.sku }, { $set: medFields });
            }
        }

        return { message: 'Product quick updated successfully!' };
    }
}
