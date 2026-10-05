/**
 * Product Domain Service with Dual-Source Mapping & Ingestion
 *
 * Source 1: Master Pharmaceutical Catalog / External Supplier POS Feed (CSquare / Reference)
 * Source 2: MongoDB Branch Operational Database (Medicine / Inventory collections)
 *
 * Harmonizes, maps, and synchronizes product metadata, stock availability,
 * and branch-level pricing across tenants and physical branches.
 */
import mongoose from 'mongoose';
import Medicine from '../../models/Medicine.js';
import { catalogService } from './CatalogService.js';
import { getIsConnected } from '../../config/db.js';
import { logger } from '../../shared/observability/logger.js';

export class ProductService {
    constructor({ masterCatalog = catalogService, model = Medicine } = {}) {
        this.masterCatalog = masterCatalog;
        this.model = model;
    }

    /**
     * Source 1: Fetch from Central Master Catalog / Supplier Feed
     */
    async fetchFromMasterSource(query = '') {
        try {
            return await this.masterCatalog.searchProducts(query);
        } catch (err) {
            logger.warn('Master catalog query issue:', { error: err.message });
            return [];
        }
    }

    /**
     * Source 2: Fetch from Branch MongoDB Database
     */
    async fetchFromMongoSource(tenantId, branchId, query = {}) {
        if (!getIsConnected()) {
            return [];
        }

        const filter = {
            isActive: true
        };
        if (tenantId) filter.tenantId = tenantId;
        if (branchId) filter.branchId = branchId;

        if (query.category) {
            filter.category = query.category;
        }

        if (query.search) {
            const regex = new RegExp(query.search.trim(), 'i');
            filter.$or = [
                { name: regex },
                { genericName: regex },
                { sku: regex },
                { brand: regex },
                { composition: regex }
            ];
        }

        try {
            return await this.model.find(filter).lean().exec();
        } catch (err) {
            logger.warn('Failed querying Mongo for products:', { error: err.message });
            return [];
        }
    }

    /**
     * Dual-Source Harmonizer & Mapper
     * Maps authoritative pharmaceutical data from Master with local branch stock and pricing from Mongo
     */
    mapAndHarmonize(masterItem = null, mongoItem = null, tenantId = 'tenant-ashvin-main', branchId = 'branch-indore-central') {
        const id = mongoItem?._id?.toString() || mongoItem?.id || masterItem?.id || `prod_${Date.now()}`;
        const sku = (mongoItem?.sku || masterItem?.barcode || masterItem?.id || '').toUpperCase();
        const name = mongoItem?.name || masterItem?.name || 'Pharmaceutical Item';
        const genericName = mongoItem?.genericName || masterItem?.genericName || '';
        const composition = mongoItem?.composition || masterItem?.composition || '';
        const manufacturer = mongoItem?.manufacturer || masterItem?.manufacturer || 'Pharma Labs';
        const category = mongoItem?.category || masterItem?.category || 'General Medicine';
        const dosageForm = masterItem?.dosageForm || mongoItem?.dosageForm || 'Tablet';

        // Pricing: Mongo branch price takes precedence, fallback to Master catalog mrp
        const mrp = Number(mongoItem?.basePrice || masterItem?.mrp || mongoItem?.price || 0);
        const price = Number(mongoItem?.price || masterItem?.sellingPrice || mrp || 0);
        const discountPercentage = Number(mongoItem?.discountPercentage || (mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0));

        // Stock & Inventory
        const physicalStock = Number(mongoItem?.stockQuantity ?? mongoItem?.stock ?? mongoItem?.quantity ?? (masterItem ? 50 : 0));
        const reservedQuantity = Number(mongoItem?.reservedQuantity || 0);
        const availableQuantity = Math.max(0, physicalStock - reservedQuantity);

        const requiresPrescription = Boolean(
            mongoItem?.requiresPrescription ||
            mongoItem?.isPrescriptionRequired ||
            masterItem?.requiresPrescription
        );

        const imageUrl = mongoItem?.imageUrl || masterItem?.imageUrl || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80';

        let source = 'HYBRID';
        if (masterItem && !mongoItem) source = 'MASTER_ONLY';
        if (!masterItem && mongoItem) source = 'MONGO_ONLY';

        return {
            id,
            sku,
            code: sku,
            name,
            genericName,
            brand: mongoItem?.brand || masterItem?.name?.split(' ')[0] || 'Pharma',
            composition,
            manufacturer,
            category,
            subCategory: mongoItem?.subCategory || 'General',
            dosageForm,
            price,
            basePrice: mrp,
            mrp,
            discountPercentage,
            marginTier: mongoItem?.marginTier || 'LOW',
            stockQuantity: physicalStock,
            reservedQuantity,
            availableQuantity,
            stock: availableQuantity,
            quantity: availableQuantity,
            stockStatus: availableQuantity > 10 ? 'IN_STOCK' : (availableQuantity > 0 ? 'LOW_STOCK' : 'OUT_OF_STOCK'),
            batchNumber: mongoItem?.batchNumber || 'BATCH-STD-01',
            expiryDate: mongoItem?.expiryDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            requiresPrescription,
            isPrescriptionRequired: requiresPrescription,
            imageUrl,
            tenantId: mongoItem?.tenantId || tenantId,
            branchId: mongoItem?.branchId || branchId,
            source,
            updatedAt: mongoItem?.updatedAt || new Date().toISOString()
        };
    }

    /**
     * Map and Sync an External or Master Product into Mongo
     */
    async syncProductToMongo(productData, tenantId = 'tenant-ashvin-main', branchId = 'branch-indore-central') {
        const sku = (productData.sku || productData.barcode || productData.code || '').trim().toUpperCase();
        if (!sku) {
            throw new Error('Product SKU or barcode is required for MongoDB sync.');
        }

        const price = Number(productData.price || productData.sellingPrice || 10);
        const basePrice = Number(productData.basePrice || productData.mrp || price);
        const physicalStock = Number(productData.stockQuantity ?? productData.stock ?? productData.quantity ?? 100);

        const doc = {
            tenantId,
            branchId,
            sku,
            code: sku,
            name: productData.name,
            brand: productData.brand || productData.name.split(' ')[0],
            category: productData.category || 'General Medicine',
            subCategory: productData.subCategory || 'General',
            composition: productData.composition || 'Active Pharmaceutical Ingredient',
            price,
            basePrice,
            discountPercentage: Number(productData.discountPercentage || (basePrice > price ? Math.round(((basePrice - price) / basePrice) * 100) : 0)),
            stockQuantity: physicalStock,
            reservedQuantity: Number(productData.reservedQuantity || 0),
            quantity: physicalStock,
            stock: physicalStock,
            batchNumber: productData.batchNumber || `BATCH-${Date.now().toString().slice(-6)}`,
            expiryDate: productData.expiryDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            requiresPrescription: Boolean(productData.requiresPrescription || productData.isPrescriptionRequired),
            isPrescriptionRequired: Boolean(productData.requiresPrescription || productData.isPrescriptionRequired),
            imageUrl: productData.imageUrl || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80',
            manufacturer: productData.manufacturer || 'Pharma Labs',
            isActive: true
        };

        if (getIsConnected()) {
            try {
                return await this.model.findOneAndUpdate(
                    { tenantId, branchId, sku },
                    { $set: doc },
                    { upsert: true, new: true, runValidators: true }
                );
            } catch (err) {
                logger.error('Failed to sync product into MongoDB:', { error: err.message, sku, tenantId, branchId });
            }
        }

        return doc;
    }

    /**
     * Get Unified Product Listings for a Branch with Two-Source Harmonization
     */
    async getProducts({ tenantId = 'tenant-ashvin-main', branchId = 'branch-indore-central', category, search, page = 1, limit = 50 } = {}) {
        // Source 1: Master products
        const masterList = await this.fetchFromMasterSource(search || '');
        const masterMap = new Map();
        for (const item of masterList) {
            const key = (item.barcode || item.id || '').toUpperCase();
            if (key) masterMap.set(key, item);
            if (item.name) masterMap.set(item.name.toLowerCase().trim(), item);
        }

        // Source 2: MongoDB records
        const mongoList = await this.fetchFromMongoSource(tenantId, branchId, { category, search });
        const processedSkus = new Set();
        const harmonized = [];

        // Harmonize Mongo records with matching Master entries
        for (const mongoItem of mongoList) {
            const skuKey = (mongoItem.sku || '').toUpperCase();
            const nameKey = (mongoItem.name || '').toLowerCase().trim();
            const master = masterMap.get(skuKey) || masterMap.get(nameKey) || null;
            if (skuKey) processedSkus.add(skuKey);

            harmonized.push(this.mapAndHarmonize(master, mongoItem, tenantId, branchId));
        }

        // If Mongo had fewer results, supplement with relevant Master catalog entries
        if (harmonized.length < limit) {
            for (const master of masterList) {
                const skuKey = (master.barcode || master.id || '').toUpperCase();
                if (!processedSkus.has(skuKey)) {
                    if (category && master.category !== category) continue;
                    harmonized.push(this.mapAndHarmonize(master, null, tenantId, branchId));
                    processedSkus.add(skuKey);
                    if (harmonized.length >= limit) break;
                }
            }
        }

        return {
            items: harmonized,
            total: harmonized.length,
            tenantId,
            branchId
        };
    }

    /**
     * Get Single Product by SKU with Dual-Source Lookup
     */
    async getProductBySku(sku, tenantId = 'tenant-ashvin-main', branchId = 'branch-indore-central') {
        const cleanSku = (sku || '').trim().toUpperCase();
        let mongoItem = null;

        if (getIsConnected()) {
            try {
                mongoItem = await this.model.findOne({ tenantId, branchId, sku: cleanSku }).lean().exec();
            } catch (err) {
                logger.warn('Failed Mongo lookup for SKU:', { sku: cleanSku, error: err.message });
            }
        }

        const masterList = await this.fetchFromMasterSource(cleanSku);
        const masterItem = masterList.find(m => (m.barcode || m.id || '').toUpperCase() === cleanSku) || masterList[0] || null;

        if (!mongoItem && !masterItem) {
            return null;
        }

        return this.mapAndHarmonize(masterItem, mongoItem, tenantId, branchId);
    }
}

export const productService = new ProductService();
export default productService;
