import mongoose from 'mongoose';

const attributeSchema = new mongoose.Schema({
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    unit: { type: String, default: '', trim: true }
}, { _id: false });

const variantSchema = new mongoose.Schema({
    variantSku: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    packSize: { type: String, required: true, trim: true },
    strength: { type: String, default: '', trim: true },
    mrp: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, min: 0, default: 0 },
    stockQuantity: { type: Number, required: true, min: 0, default: 0 },
    isDefault: { type: Boolean, default: false },
    barcode: { type: String, default: '', trim: true }
}, { _id: true });

const catalogProductSchema = new mongoose.Schema({
    // Tenant Isolation: null = Global Master Catalog, String/ObjectId = Tenant Custom Product
    tenantId: { type: String, default: null, index: true },
    branchId: { type: String, default: null, index: true },

    sku: { type: String, required: true, trim: true, uppercase: true },
    gtin: { type: String, default: '', trim: true, index: true },
    barcode: { type: String, default: '', trim: true },

    name: { type: String, required: true, trim: true, index: true },
    normalizedName: { type: String, required: true, trim: true, lowercase: true, index: true },

    brand: { type: String, required: true, trim: true, index: true },
    manufacturer: { type: String, default: 'Generic Labs', trim: true },
    
    category: { type: String, required: true, trim: true, index: true },
    subCategory: { type: String, default: 'General', trim: true },
    
    composition: { type: String, default: '', trim: true }, // Active ingredients
    activeIngredients: [{ type: String, trim: true }],
    dosageForm: { type: String, default: 'Tablet', trim: true, index: true },
    strength: { type: String, default: '', trim: true },

    mrp: { type: Number, required: true, min: 0 },
    basePrice: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, min: 0, default: 0 },
    taxPercentage: { type: Number, min: 0, max: 100, default: 0 },

    prescriptionRequired: { type: Boolean, default: false, index: true },
    storageCondition: { type: String, default: 'Room Temperature', trim: true },
    description: { type: String, default: '', trim: true },

    imageUrl: { type: String, default: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80' },
    imageAssetId: { type: String, default: null },

    attributes: [attributeSchema],
    variants: [variantSchema],
    tags: [{ type: String, trim: true, lowercase: true }],

    isPublished: { type: Boolean, default: true, index: true },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published', index: true },
    createdSource: { type: String, enum: ['master_catalog', 'tenant_custom', 'csv_builder'], default: 'tenant_custom' },

    similarityHash: { type: String, default: '', index: true }, // Algorithmic hash for duplicate detection
    searchTokens: [{ type: String, lowercase: true }]
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Tenant-Isolated Unique Indexes
catalogProductSchema.index({ tenantId: 1, sku: 1 }, { unique: true });
catalogProductSchema.index({ tenantId: 1, normalizedName: 1, brand: 1, strength: 1 });
catalogProductSchema.index({ tenantId: 1, isPublished: 1, category: 1, status: 1 });
catalogProductSchema.index({ name: 'text', brand: 'text', composition: 'text', searchTokens: 'text' });

const CatalogProduct = mongoose.models.CatalogProduct || mongoose.model('CatalogProduct', catalogProductSchema);
export default CatalogProduct;
