/**
 * Global Product Catalog, Branch Listings & Inventory Management Service
 */
import crypto from 'node:crypto';
import { domainEvents } from '../../shared/events/DomainEvents.js';
import { logger } from '../../shared/observability/logger.js';
import { InsufficientStockError } from '../../shared/errors/DomainErrors.js';
import { ProductListingStatus, StockStatus, InventorySource } from '../../shared/contracts/index.js';

export class CatalogService {
    constructor() {
        this.products = new Map(); // productId -> Product
        this.listings = new Map(); // `${tenantId}:${branchId}:${productId}` -> BranchProductListing
        this.inventory = new Map(); // `${tenantId}:${branchId}:${productId}` -> BranchInventory
        this.bulkImportJobs = new Map(); // jobId -> BulkImportJob
        this._seedDefaults();
    }

    _seedDefaults() {
        const initialProducts = [
            {
                id: 'prod-pcm-650',
                name: 'Dolo 650mg Tablet',
                genericName: 'Paracetamol',
                composition: 'Paracetamol IP 650mg',
                manufacturer: 'Micro Labs Limited',
                dosageForm: 'Tablet',
                strength: '650mg',
                packSize: 'Strip of 15 Tablets',
                barcode: '8901234567890',
                category: 'Analgesics & Antipyretics',
                requiresPrescription: false,
                status: 'ACTIVE'
            },
            {
                id: 'prod-amox-500',
                name: 'Augmentin 625 Duo Tablet',
                genericName: 'Amoxicillin and Potassium Clavulanate',
                composition: 'Amoxicillin 500mg + Clavulanic Acid 125mg',
                manufacturer: 'GlaxoSmithKline Pharmaceuticals',
                dosageForm: 'Tablet',
                strength: '625mg',
                packSize: 'Strip of 10 Tablets',
                barcode: '8901234567891',
                category: 'Antibiotics',
                requiresPrescription: true,
                status: 'ACTIVE'
            },
            {
                id: 'prod-pantop-40',
                name: 'Pan 40mg Tablet',
                genericName: 'Pantoprazole',
                composition: 'Pantoprazole Gastro-resistant IP 40mg',
                manufacturer: 'Alkem Laboratories',
                dosageForm: 'Tablet',
                strength: '40mg',
                packSize: 'Strip of 15 Tablets',
                barcode: '8901234567892',
                category: 'Gastrointestinal',
                requiresPrescription: false,
                status: 'ACTIVE'
            },
            {
                id: 'prod-mont-10',
                name: 'Montair LC Tablet',
                genericName: 'Montelukast and Levocetirizine',
                composition: 'Montelukast Sodium 10mg + Levocetirizine 5mg',
                manufacturer: 'Cipla Limited',
                dosageForm: 'Tablet',
                strength: '10mg/5mg',
                packSize: 'Strip of 10 Tablets',
                barcode: '8901234567893',
                category: 'Respiratory',
                requiresPrescription: true,
                status: 'ACTIVE'
            },
            {
                id: 'prod-ursocol-300',
                name: 'Ursocol 300mg Tablet',
                genericName: 'Ursodeoxycholic Acid',
                composition: 'Ursodeoxycholic Acid IP 300mg',
                manufacturer: 'Abbott Healthcare',
                dosageForm: 'Tablet',
                strength: '300mg',
                packSize: 'Strip of 10 Tablets',
                barcode: '8901234567894',
                category: 'Hepatology',
                requiresPrescription: true,
                status: 'ACTIVE'
            }
        ];

        initialProducts.forEach(p => this.products.set(p.id, p));

        // Seed Branch Listings and Inventory for Indore Central Branch
        const branchId1 = 'branch-indore-central';
        const tenantId1 = 'tenant-ashvin-main';

        const sampleListingData = [
            { productId: 'prod-pcm-650', mrp: 34.0, sellingPrice: 29.5, qty: 120 },
            { productId: 'prod-amox-500', mrp: 223.5, sellingPrice: 198.0, qty: 45 },
            { productId: 'prod-pantop-40', mrp: 155.0, sellingPrice: 132.0, qty: 80 },
            { productId: 'prod-mont-10', mrp: 180.0, sellingPrice: 158.0, qty: 60 },
            { productId: 'prod-ursocol-300', mrp: 460.0, sellingPrice: 420.0, qty: 0 } // Out of stock to test request flow
        ];

        sampleListingData.forEach(item => {
            const listKey = `${tenantId1}:${branchId1}:${item.productId}`;
            this.listings.set(listKey, {
                id: `list-${crypto.randomUUID().slice(0, 8)}`,
                tenantId: tenantId1,
                branchId: branchId1,
                productId: item.productId,
                mrp: item.mrp,
                sellingPrice: item.sellingPrice,
                status: item.qty > 0 ? ProductListingStatus.ACTIVE : ProductListingStatus.OUT_OF_STOCK,
                updatedAt: new Date().toISOString()
            });

            this.inventory.set(listKey, {
                id: `inv-${crypto.randomUUID().slice(0, 8)}`,
                tenantId: tenantId1,
                branchId: branchId1,
                productId: item.productId,
                availableQuantity: item.qty,
                reservedQuantity: 0,
                batchNumber: `BATCH-2026-${Math.floor(100 + Math.random() * 900)}`,
                expiryDate: '2027-12-31',
                stockStatus: item.qty > 10 ? StockStatus.IN_STOCK : item.qty > 0 ? StockStatus.LOW_STOCK : StockStatus.OUT_OF_STOCK,
                source: InventorySource.ASHVIN,
                lastSyncedAt: new Date().toISOString()
            });
        });

        // Seed Vijay Nagar Branch (Branch 1.2)
        const branchId2 = 'branch-indore-vijaynagar';
        sampleListingData.slice(0, 3).forEach(item => {
            const listKey = `${tenantId1}:${branchId2}:${item.productId}`;
            this.listings.set(listKey, {
                id: `list-${crypto.randomUUID().slice(0, 8)}`,
                tenantId: tenantId1,
                branchId: branchId2,
                productId: item.productId,
                mrp: item.mrp,
                sellingPrice: item.sellingPrice,
                status: ProductListingStatus.ACTIVE,
                updatedAt: new Date().toISOString()
            });
            this.inventory.set(listKey, {
                id: `inv-${crypto.randomUUID().slice(0, 8)}`,
                tenantId: tenantId1,
                branchId: branchId2,
                productId: item.productId,
                availableQuantity: 50,
                reservedQuantity: 0,
                batchNumber: 'BATCH-VN-90',
                expiryDate: '2027-10-31',
                stockStatus: StockStatus.IN_STOCK,
                source: InventorySource.ASHVIN,
                lastSyncedAt: new Date().toISOString()
            });
        });
    }

    async getProductById(productId) {
        return this.products.get(String(productId)) || null;
    }

    async searchProducts(query = '', category = '') {
        const q = String(query).toLowerCase().trim();
        const c = String(category).toLowerCase().trim();
        return Array.from(this.products.values()).filter(p => {
            if (c && p.category.toLowerCase() !== c) return false;
            if (!q) return true;
            return (
                p.name.toLowerCase().includes(q) ||
                p.genericName.toLowerCase().includes(q) ||
                p.composition.toLowerCase().includes(q) ||
                p.manufacturer.toLowerCase().includes(q)
            );
        });
    }

    async getBranchListings(tenantId, branchId, query = '') {
        const q = String(query).toLowerCase().trim();
        const results = [];

        for (const listing of this.listings.values()) {
            if (listing.tenantId !== tenantId || listing.branchId !== branchId) continue;
            const product = this.products.get(listing.productId);
            if (!product) continue;

            if (q) {
                const match =
                    product.name.toLowerCase().includes(q) ||
                    product.genericName.toLowerCase().includes(q) ||
                    product.composition.toLowerCase().includes(q);
                if (!match) continue;
            }

            const invKey = `${tenantId}:${branchId}:${listing.productId}`;
            const inv = this.inventory.get(invKey);
            const netStock = Math.max(0, (inv?.availableQuantity || 0) - (inv?.reservedQuantity || 0));

            results.push({
                listingId: listing.id,
                productId: product.id,
                name: product.name,
                genericName: product.genericName,
                composition: product.composition,
                manufacturer: product.manufacturer,
                dosageForm: product.dosageForm,
                strength: product.strength,
                packSize: product.packSize,
                category: product.category,
                requiresPrescription: product.requiresPrescription,
                mrp: listing.mrp,
                sellingPrice: listing.sellingPrice,
                status: listing.status,
                inStock: netStock > 0,
                availableStock: netStock
            });
        }
        return results;
    }

    async getBranchInventory(tenantId, branchId) {
        const results = [];
        for (const inv of this.inventory.values()) {
            if (inv.tenantId !== tenantId || inv.branchId !== branchId) continue;
            const product = this.products.get(inv.productId);
            results.push({
                ...inv,
                productName: product?.name || 'Unknown',
                genericName: product?.genericName || '',
                netAvailable: Math.max(0, inv.availableQuantity - inv.reservedQuantity)
            });
        }
        return results;
    }

    async adjustInventory(tenantId, branchId, productId, newAvailableQty, actor = null) {
        const key = `${tenantId}:${branchId}:${productId}`;
        let inv = this.inventory.get(key);
        if (!inv) {
            inv = {
                id: `inv-${Date.now()}`,
                tenantId,
                branchId,
                productId,
                availableQuantity: 0,
                reservedQuantity: 0,
                stockStatus: StockStatus.OUT_OF_STOCK,
                source: InventorySource.MANUAL,
                lastSyncedAt: new Date().toISOString()
            };
            this.inventory.set(key, inv);
        }

        const oldQty = inv.availableQuantity;
        inv.availableQuantity = Math.max(0, Number(newAvailableQty) || 0);
        inv.stockStatus = inv.availableQuantity > 10 ? StockStatus.IN_STOCK : inv.availableQuantity > 0 ? StockStatus.LOW_STOCK : StockStatus.OUT_OF_STOCK;
        inv.lastSyncedAt = new Date().toISOString();

        domainEvents.emitDomainEvent('INVENTORY_ADJUSTED', inv.id, {
            productId,
            oldQty,
            newQty: inv.availableQuantity
        }, actor, tenantId, branchId);

        return inv;
    }

    async reserveStock(tenantId, branchId, items = []) {
        // Atomic verification first
        for (const item of items) {
            const key = `${tenantId}:${branchId}:${item.productId}`;
            const inv = this.inventory.get(key);
            const netAvailable = inv ? inv.availableQuantity - inv.reservedQuantity : 0;
            if (netAvailable < item.quantity) {
                const prod = this.products.get(item.productId);
                throw new InsufficientStockError(prod?.name || item.productId, item.quantity, netAvailable);
            }
        }

        // Apply reservations atomically
        for (const item of items) {
            const key = `${tenantId}:${branchId}:${item.productId}`;
            const inv = this.inventory.get(key);
            inv.reservedQuantity += item.quantity;
            domainEvents.emitDomainEvent('INVENTORY_RESERVED', inv.id, {
                productId: item.productId,
                reservedDelta: item.quantity,
                totalReserved: inv.reservedQuantity
            }, null, tenantId, branchId);
        }
        return true;
    }

    async releaseStock(tenantId, branchId, items = []) {
        for (const item of items) {
            const key = `${tenantId}:${branchId}:${item.productId}`;
            const inv = this.inventory.get(key);
            if (inv) {
                inv.reservedQuantity = Math.max(0, inv.reservedQuantity - item.quantity);
                domainEvents.emitDomainEvent('INVENTORY_RELEASED', inv.id, {
                    productId: item.productId,
                    releasedDelta: item.quantity,
                    totalReserved: inv.reservedQuantity
                }, null, tenantId, branchId);
            }
        }
        return true;
    }

    async deductStock(tenantId, branchId, items = []) {
        for (const item of items) {
            const key = `${tenantId}:${branchId}:${item.productId}`;
            const inv = this.inventory.get(key);
            if (inv) {
                inv.availableQuantity = Math.max(0, inv.availableQuantity - item.quantity);
                inv.reservedQuantity = Math.max(0, inv.reservedQuantity - item.quantity);
                inv.stockStatus = inv.availableQuantity > 10 ? StockStatus.IN_STOCK : inv.availableQuantity > 0 ? StockStatus.LOW_STOCK : StockStatus.OUT_OF_STOCK;
            }
        }
        return true;
    }

    // High-Capacity Bulk Inventory Import Engine (>5,000 items, chunking, partial success)
    async startBulkImport(tenantId, branchId, records = [], actor = null) {
        const jobId = `job-imp-${crypto.randomUUID().slice(0, 8)}`;
        const totalRows = records.length;

        const job = {
            jobId,
            tenantId,
            branchId,
            totalRows,
            processedRows: 0,
            successCount: 0,
            failedCount: 0,
            status: 'PROCESSING',
            failures: [],
            createdAt: new Date().toISOString(),
            completedAt: null
        };
        this.bulkImportJobs.set(jobId, job);

        // Process in bounded chunks of 500
        const CHUNK_SIZE = 500;
        let index = 0;

        const processChunk = async () => {
            const chunk = records.slice(index, index + CHUNK_SIZE);
            index += CHUNK_SIZE;

            for (let i = 0; i < chunk.length; i++) {
                const row = chunk[i];
                const rowNum = job.processedRows + 1;
                job.processedRows++;

                try {
                    const name = String(row.name || row.medicineName || '').trim();
                    if (!name) {
                        throw new Error('Medicine name is required.');
                    }
                    const qty = Number(row.quantity ?? row.stock);
                    if (!Number.isFinite(qty) || qty < 0) {
                        throw new Error('Valid non-negative quantity required.');
                    }
                    const mrp = Number(row.mrp || row.price || 0);
                    const sellingPrice = Number(row.sellingPrice || mrp);

                    // Find or create global Product
                    let productId = row.productId;
                    if (!productId || !this.products.has(productId)) {
                        productId = `prod-${name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 24)}`;
                        if (!this.products.has(productId)) {
                            this.products.set(productId, {
                                id: productId,
                                name,
                                genericName: row.genericName || name,
                                composition: row.composition || name,
                                manufacturer: row.manufacturer || 'Pharmaceutical Standard',
                                dosageForm: row.dosageForm || 'Tablet',
                                strength: row.strength || '',
                                packSize: row.packSize || 'Standard Pack',
                                category: row.category || 'General Health',
                                requiresPrescription: Boolean(row.requiresPrescription),
                                status: 'ACTIVE'
                            });
                        }
                    }

                    // Upsert Listing
                    const key = `${tenantId}:${branchId}:${productId}`;
                    this.listings.set(key, {
                        id: `list-${productId}`,
                        tenantId,
                        branchId,
                        productId,
                        mrp,
                        sellingPrice,
                        status: qty > 0 ? ProductListingStatus.ACTIVE : ProductListingStatus.OUT_OF_STOCK,
                        updatedAt: new Date().toISOString()
                    });

                    // Upsert Inventory
                    this.inventory.set(key, {
                        id: `inv-${productId}`,
                        tenantId,
                        branchId,
                        productId,
                        availableQuantity: qty,
                        reservedQuantity: 0,
                        batchNumber: row.batchNumber || `BATCH-IMP-${Date.now().toString().slice(-4)}`,
                        expiryDate: row.expiryDate || '2028-12-31',
                        stockStatus: qty > 10 ? StockStatus.IN_STOCK : qty > 0 ? StockStatus.LOW_STOCK : StockStatus.OUT_OF_STOCK,
                        source: InventorySource.MANUAL,
                        lastSyncedAt: new Date().toISOString()
                    });

                    job.successCount++;
                } catch (err) {
                    job.failedCount++;
                    job.failures.push({
                        row: rowNum,
                        identifier: row.name || row.productId || `Row #${rowNum}`,
                        errorCode: 'VALIDATION_FAILED',
                        reason: err.message
                    });
                }
            }

            if (index < totalRows) {
                setTimeout(processChunk, 0);
            } else {
                job.status = job.failedCount === 0 ? 'COMPLETED' : 'COMPLETED_WITH_ERRORS';
                job.completedAt = new Date().toISOString();
                logger.info(`Bulk inventory import finished: ${job.successCount} succeeded, ${job.failedCount} failed`, { jobId });
            }
        };

        // Start asynchronous batch execution
        setTimeout(processChunk, 0);
        return job;
    }

    async getBulkImportJob(jobId) {
        return this.bulkImportJobs.get(jobId) || null;
    }
}

export const catalogService = new CatalogService();
export default catalogService;
