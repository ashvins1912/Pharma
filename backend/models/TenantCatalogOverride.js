import mongoose from 'mongoose';

const tenantCatalogOverrideSchema = new mongoose.Schema({
    tenantId: { type: String, required: true, index: true },
    branchId: { type: String, default: null, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogProduct', required: true, index: true },

    tenantSku: { type: String, trim: true, uppercase: true },
    customName: { type: String, trim: true, default: null },
    
    mrp: { type: Number, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, min: 0 },
    discountPercentage: { type: Number, min: 0, max: 100, default: 0 },

    stockQuantity: { type: Number, required: true, min: 0, default: 0 },
    reservedQuantity: { type: Number, min: 0, default: 0 },
    reorderPoint: { type: Number, min: 0, default: 5 },
    aisleLocation: { type: String, default: 'Aisle-1', trim: true },

    isAvailable: { type: Boolean, default: true, index: true },
    isCustomPrice: { type: Boolean, default: false },
    notes: { type: String, default: '', trim: true }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

tenantCatalogOverrideSchema.virtual('availableQuantity').get(function () {
    return Math.max(0, (this.stockQuantity || 0) - (this.reservedQuantity || 0));
});

tenantCatalogOverrideSchema.index({ tenantId: 1, productId: 1 }, { unique: true });
tenantCatalogOverrideSchema.index({ tenantId: 1, branchId: 1, isAvailable: 1 });

const TenantCatalogOverride = mongoose.models.TenantCatalogOverride || mongoose.model('TenantCatalogOverride', tenantCatalogOverrideSchema);
export default TenantCatalogOverride;
