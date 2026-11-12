import mongoose from 'mongoose';

const catalogCategorySchema = new mongoose.Schema({
    tenantId: { type: String, default: null, index: true }, // null = system global category
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, default: '', trim: true },
    
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogCategory', default: null, index: true },
    ancestors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CatalogCategory' }],
    
    sortOrder: { type: Number, default: 0 },
    icon: { type: String, default: '💊', trim: true },
    isActive: { type: Boolean, default: true, index: true }
}, {
    timestamps: true
});

catalogCategorySchema.index({ tenantId: 1, slug: 1 }, { unique: true });
catalogCategorySchema.index({ tenantId: 1, parentId: 1, sortOrder: 1 });

const CatalogCategory = mongoose.models.CatalogCategory || mongoose.model('CatalogCategory', catalogCategorySchema);
export default CatalogCategory;
