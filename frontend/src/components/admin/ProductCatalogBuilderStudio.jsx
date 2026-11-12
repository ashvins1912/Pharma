import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import VoiceSearchButton from '../common/VoiceSearchButton';
import { getPharmaPlaceholderImage, PHARMA_PLACEHOLDER_IMAGES } from '../../utils/pharmaImagePlaceholders';

export default function ProductCatalogBuilderStudio() {
    const [activeTab, setActiveTab] = useState('explorer'); // 'explorer' | 'master_catalog' | 'add_product' | 'bulk_import' | 'categories'
    const [loading, setLoading] = useState(false);
    const [statusMsg, setStatusMsg] = useState(null);

    // Explorer State
    const [products, setProducts] = useState([]);
    const [totalProducts, setTotalProducts] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [categories, setCategories] = useState([]);
    const [page, setPage] = useState(1);

    // Master Catalog Quick-Link State
    const [masterProducts, setMasterProducts] = useState([]);
    const [masterSearch, setMasterSearch] = useState('');
    const [selectedMasterItem, setSelectedMasterItem] = useState(null);
    const [linkForm, setLinkForm] = useState({ sellingPrice: 100, mrp: 120, stockQuantity: 50, aisleLocation: 'Aisle-1' });

    // Inline Quick Update State
    const [editingItem, setEditingItem] = useState(null);
    const [editForm, setEditForm] = useState({ sellingPrice: 0, mrp: 0, stockQuantity: 0 });

    // Add Product Form State
    const [form, setForm] = useState({
        name: '',
        brand: '',
        manufacturer: 'Pharma Labs',
        category: 'Pain & Fever',
        subCategory: 'Analgesics',
        composition: '',
        strength: '500 mg',
        dosageForm: 'Tablet',
        basePrice: 120,
        mrp: 140,
        costPrice: 80,
        stockQuantity: 50,
        prescriptionRequired: false,
        storageCondition: 'Room Temperature',
        description: '',
        imageUrl: PHARMA_PLACEHOLDER_IMAGES.tablet,
        packSizes: ['Strip of 10 Tablets', 'Pack of 30 Tablets']
    });

    // Similarity Check State
    const [dupChecking, setDupChecking] = useState(false);
    const [dupResult, setDupResult] = useState(null);
    const [generatedVariants, setGeneratedVariants] = useState([]);

    // Bulk Import State
    const [bulkCsvText, setBulkCsvText] = useState('');
    const [bulkParsedRows, setBulkParsedRows] = useState([]);
    const [bulkImportResult, setBulkImportResult] = useState(null);

    // Load Catalog Data
    const loadCatalog = async () => {
        setLoading(true);
        try {
            const res = await apiClient.get('/api/catalog/products', {
                params: { search: searchQuery, category: selectedCategory, page, limit: 12 }
            });
            setProducts(res.data.products || []);
            setTotalProducts(res.data.total || 0);
        } catch (err) {
            console.error('[CatalogBuilder] Load error:', err);
        } finally {
            setLoading(false);
        }
    };

    // Load Master Catalog Data
    const loadMasterCatalog = async () => {
        try {
            const res = await apiClient.get('/api/catalog/master-products', {
                params: { search: masterSearch, category: selectedCategory }
            });
            setMasterProducts(res.data.masterProducts || []);
        } catch (err) {
            console.error('[CatalogBuilder] Master load error:', err);
        }
    };

    // Load Categories
    const loadCategories = async () => {
        try {
            const res = await apiClient.get('/api/catalog/categories');
            setCategories(res.data || []);
        } catch (err) {
            console.error('[CatalogBuilder] Categories error:', err);
        }
    };

    useEffect(() => {
        loadCatalog();
        loadCategories();
    }, [searchQuery, selectedCategory, page]);

    useEffect(() => {
        if (activeTab === 'master_catalog') {
            loadMasterCatalog();
        }
    }, [activeTab, masterSearch, selectedCategory]);

    // Algorithmic Similarity Check on Product Name Change
    useEffect(() => {
        if (!form.name || form.name.trim().length < 3) {
            setDupResult(null);
            return;
        }

        const timer = setTimeout(async () => {
            setDupChecking(true);
            try {
                const res = await apiClient.post('/api/catalog/similarity-check', {
                    name: form.name,
                    brand: form.brand,
                    strength: form.strength
                });
                setDupResult(res.data);
            } catch (err) {
                console.warn('[CatalogBuilder] Similarity check failed:', err);
            } finally {
                setDupChecking(false);
            }
        }, 400);

        return () => clearTimeout(timer);
    }, [form.name, form.brand, form.strength]);

    // Automatically assign image when dosageForm or category changes
    useEffect(() => {
        const autoImg = getPharmaPlaceholderImage(form.dosageForm, form.category);
        if (autoImg) {
            setForm(prev => ({ ...prev, imageUrl: autoImg }));
        }
    }, [form.dosageForm, form.category]);

    // Algorithm Variant Matrix Generation
    const handleGenerateVariants = async () => {
        try {
            const res = await apiClient.post('/api/catalog/variant-matrix', {
                baseSKU: form.sku || `SKU-${form.name.substring(0, 4).toUpperCase()}`,
                baseName: form.name || 'Medicine Product',
                basePrice: form.basePrice,
                options: {
                    packSizes: form.packSizes,
                    strengths: [form.strength]
                }
            });
            setGeneratedVariants(res.data.variants || []);
        } catch (err) {
            console.error('[CatalogBuilder] Variant error:', err);
        }
    };

    // Submit Custom Product
    const handleSaveProduct = async (forceSave = false) => {
        if (!form.name || !form.brand) {
            setStatusMsg({ type: 'error', text: 'Product name and brand are required.' });
            return;
        }
        setLoading(true);
        setStatusMsg(null);
        try {
            const payload = { ...form, variants: generatedVariants, forceSave };
            await apiClient.post('/api/catalog/products', payload);
            setStatusMsg({ type: 'success', text: `Product "${form.name}" added to catalog successfully!` });
            setForm({
                name: '', brand: '', manufacturer: 'Pharma Labs', category: 'Pain & Fever',
                subCategory: 'Analgesics', composition: '', strength: '500 mg', dosageForm: 'Tablet',
                basePrice: 120, mrp: 140, costPrice: 80, stockQuantity: 50, prescriptionRequired: false,
                storageCondition: 'Room Temperature', description: '',
                imageUrl: PHARMA_PLACEHOLDER_IMAGES.tablet,
                packSizes: ['Strip of 10 Tablets', 'Pack of 30 Tablets']
            });
            setDupResult(null);
            setGeneratedVariants([]);
            loadCatalog();
        } catch (err) {
            if (err.response?.status === 409) {
                setDupResult({
                    hasPotentialDuplicates: true,
                    highestMatchScore: 0.95,
                    matches: err.response.data.duplicates || []
                });
                setStatusMsg({ type: 'warning', text: 'Potential duplicates found. Review matches below or click Force Save.' });
            } else {
                setStatusMsg({ type: 'error', text: err.response?.data?.message || 'Failed to save product.' });
            }
        } finally {
            setLoading(false);
        }
    };

    // 1-Click Link Master Product Handler
    const handleLinkMasterProduct = async () => {
        if (!selectedMasterItem) return;
        setLoading(true);
        try {
            await apiClient.post(`/api/catalog/products/${selectedMasterItem._id}/link-tenant`, linkForm);
            setStatusMsg({ type: 'success', text: `⚡ "${selectedMasterItem.name}" linked to your store catalog!` });
            setSelectedMasterItem(null);
            loadCatalog();
        } catch (err) {
            setStatusMsg({ type: 'error', text: err.response?.data?.message || 'Failed to link master product.' });
        } finally {
            setLoading(false);
        }
    };

    // Quick Inline Update Handler
    const handleQuickUpdateSubmit = async () => {
        if (!editingItem) return;
        setLoading(true);
        try {
            await apiClient.patch(`/api/catalog/products/${editingItem._id}/quick-update`, editForm);
            setStatusMsg({ type: 'success', text: `Updated stock and price for "${editingItem.name}"!` });
            setEditingItem(null);
            loadCatalog();
        } catch (err) {
            setStatusMsg({ type: 'error', text: err.response?.data?.message || 'Failed to update item.' });
        } finally {
            setLoading(false);
        }
    };

    // Parse CSV helper for Bulk Import Builder
    const handleParseCsv = (text) => {
        setBulkCsvText(text);
        if (!text.trim()) {
            setBulkParsedRows([]);
            return;
        }

        const lines = text.trim().split('\n');
        if (lines.length < 2) return;

        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const parsed = [];

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const row = {};
            headers.forEach((h, idx) => {
                row[h] = values[idx] || '';
            });
            parsed.push(row);
        }
        setBulkParsedRows(parsed);
    };

    // Execute Bulk Catalog Builder Import
    const handleRunBulkImport = async () => {
        if (bulkParsedRows.length === 0) return;
        setLoading(true);
        try {
            const res = await apiClient.post('/api/catalog/builder/bulk-import', {
                items: bulkParsedRows,
                fileName: 'bulk_catalog_upload.csv'
            });
            setBulkImportResult(res.data);
            loadCatalog();
        } catch (err) {
            console.error('[CatalogBuilder] Bulk import error:', err);
            setStatusMsg({ type: 'error', text: 'Bulk import failed to process.' });
        } finally {
            setLoading(false);
        }
    };

    // Load Sample CSV Demo Data
    const loadSampleCsv = () => {
        const sample = `name,brand,category,composition,strength,dosageForm,basePrice,mrp,stockQuantity,prescriptionRequired
Dolo 650,Micro Labs,Pain & Fever,Paracetamol 650mg,650mg,Tablet,34,40,100,false
Augmentin 625 Duo,GlaxoSmithKline,Antibiotics,Amoxicillin 500mg + Clavulanate 125mg,625mg,Tablet,205,230,45,true
Montair-LC,Cipla,Allergy & Cold,Montelukast 10mg + Levocetirizine 5mg,10mg,Tablet,180,200,60,true
Pan-40,Alkem,Digestion & Acidity,Pantoprazole Sodium 40mg,40mg,Tablet,98,115,80,true`;
        handleParseCsv(sample);
    };

    return (
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="p-2 bg-indigo-50 border border-indigo-100 rounded-xl text-xl">🧪</span>
                        <div>
                            <h2 className="text-lg font-black text-slate-900 tracking-tight">Product Catalog Builder Studio</h2>
                            <p className="text-xs text-slate-500 font-medium">Enterprise Multi-Tenant Catalog Architecture & Master Repository Linking</p>
                        </div>
                    </div>
                </div>

                {/* Navigation Tabs */}
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-2xl overflow-x-auto shrink-0">
                    <button
                        onClick={() => setActiveTab('explorer')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-xl transition cursor-pointer ${activeTab === 'explorer' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                        📦 Store Catalog ({totalProducts})
                    </button>
                    <button
                        onClick={() => setActiveTab('master_catalog')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-xl transition cursor-pointer ${activeTab === 'master_catalog' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                        ⚡ Master Catalog Quick-Link
                    </button>
                    <button
                        onClick={() => setActiveTab('add_product')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-xl transition cursor-pointer ${activeTab === 'add_product' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                        ➕ Add Custom Item
                    </button>
                    <button
                        onClick={() => setActiveTab('bulk_import')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-xl transition cursor-pointer ${activeTab === 'bulk_import' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                        📁 CSV Import
                    </button>
                </div>
            </div>

            {/* Status Notification Messages */}
            {statusMsg && (
                <div className={`p-3 rounded-2xl text-xs font-bold flex items-center justify-between ${
                    statusMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                    statusMsg.type === 'warning' ? 'bg-amber-50 text-amber-900 border border-amber-200' :
                    'bg-rose-50 text-rose-800 border border-rose-200'
                }`}>
                    <span>{statusMsg.text}</span>
                    <button onClick={() => setStatusMsg(null)} className="text-slate-400 hover:text-slate-700 font-bold">✕</button>
                </div>
            )}

            {/* TAB 1: STORE CATALOG EXPLORER */}
            {activeTab === 'explorer' && (
                <div className="space-y-4">
                    {/* Filters */}
                    <div className="flex flex-col sm:flex-row items-center gap-3">
                        <div className="relative flex-1 w-full flex items-center gap-1.5">
                            <div className="relative flex-1 min-w-0">
                                <span className="absolute left-3 top-2.5 text-slate-400 text-xs">🔍</span>
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search by name, brand, SKU, or active salt composition..."
                                    className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                            <VoiceSearchButton
                                onTranscript={(text) => setSearchQuery(text)}
                                currentQuery={searchQuery}
                            />
                        </div>
                        <select
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="w-full sm:w-48 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none"
                        >
                            <option value="All">All Categories</option>
                            {categories.map(c => (
                                <option key={c._id} value={c.name}>{c.icon || '💊'} {c.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Products Grid / Table */}
                    {loading ? (
                        <div className="text-center py-12 text-slate-400 text-xs font-medium animate-pulse">
                            Loading catalog products from pharmacy tenant database...
                        </div>
                    ) : products.length === 0 ? (
                        <div className="text-center py-12 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50 space-y-3">
                            <p className="text-sm font-bold text-slate-700">No products in this pharmacy's store catalog</p>
                            <p className="text-xs text-slate-400">Add products via Master Catalog Quick-Link or Create Custom Items</p>
                            <div className="flex items-center justify-center gap-2">
                                <button
                                    onClick={() => setActiveTab('master_catalog')}
                                    className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition cursor-pointer"
                                >
                                    ⚡ Browse Master Catalog
                                </button>
                                <button
                                    onClick={() => setActiveTab('add_product')}
                                    className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-900 transition cursor-pointer"
                                >
                                    + Add Custom Product
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider">
                                    <tr>
                                        <th className="p-3">Product Info</th>
                                        <th className="p-3">Category</th>
                                        <th className="p-3">Composition</th>
                                        <th className="p-3">Price (MRP / Base)</th>
                                        <th className="p-3">Stock & Aisle</th>
                                        <th className="p-3">Status</th>
                                        <th className="p-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-700">
                                    {products.map((p) => (
                                        <tr key={p._id} className="hover:bg-slate-50/70 transition">
                                            <td className="p-3">
                                                <div className="flex items-center gap-2.5">
                                                    <img src={p.imageUrl} alt={p.name} className="w-9 h-9 rounded-xl object-cover border border-slate-200 shrink-0" />
                                                    <div>
                                                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                                            {p.name}
                                                            {p.prescriptionRequired && (
                                                                <span className="px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[9px] font-black rounded-md uppercase">Rx</span>
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 font-mono">{p.sku} • {p.brand}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-3">
                                                <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded-lg text-[10px] font-bold">
                                                    {p.category}
                                                </span>
                                            </td>
                                            <td className="p-3 max-w-xs truncate text-[11px] text-slate-600">
                                                {p.composition || 'Active Compound'}
                                            </td>
                                            <td className="p-3 font-bold text-slate-900">
                                                ₹{p.effectivePrice ?? p.basePrice}
                                                <span className="text-[10px] text-slate-400 line-through ml-1">₹{p.effectiveMrp ?? p.mrp}</span>
                                            </td>
                                            <td className="p-3">
                                                <div className="font-extrabold text-slate-800">{p.stockQuantity} units</div>
                                                <div className="text-[10px] text-slate-400">{p.aisleLocation}</div>
                                            </td>
                                            <td className="p-3">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                                    p.status === 'published' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                                                }`}>
                                                    {p.status || 'published'}
                                                </span>
                                            </td>
                                            <td className="p-3 text-right">
                                                <button
                                                    onClick={() => {
                                                        setEditingItem(p);
                                                        setEditForm({
                                                            sellingPrice: p.effectivePrice ?? p.basePrice,
                                                            mrp: p.effectiveMrp ?? p.mrp,
                                                            stockQuantity: p.stockQuantity || 50
                                                        });
                                                    }}
                                                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[10px] font-extrabold rounded-lg transition cursor-pointer"
                                                >
                                                    ⚡ Quick Edit
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* TAB 2: MASTER CATALOG QUICK-LINK TAB */}
            {activeTab === 'master_catalog' && (
                <div className="space-y-4">
                    <div className="p-3.5 bg-indigo-50/70 border border-indigo-100 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div>
                            <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wider">⚡ Master Pharmaceutical Catalog Repository</h4>
                            <p className="text-[11px] text-indigo-800 mt-0.5">
                                Select pre-verified master medicines to instantly link to your store with tenant-isolated pricing & stock overrides.
                            </p>
                        </div>
                        <div className="w-full sm:w-64">
                            <input
                                type="text"
                                value={masterSearch}
                                onChange={(e) => setMasterSearch(e.target.value)}
                                placeholder="Search master catalog..."
                                className="w-full px-3 py-1.5 bg-white border border-indigo-200 rounded-xl text-xs"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        {masterProducts.map((m) => (
                            <div key={m._id} className="p-3.5 border border-slate-200 rounded-2xl bg-white hover:border-indigo-300 transition shadow-xs flex flex-col justify-between space-y-3">
                                <div className="flex items-start gap-3">
                                    <img src={m.imageUrl} alt={m.name} className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0" />
                                    <div>
                                        <h5 className="text-xs font-bold text-slate-900 leading-snug">{m.name}</h5>
                                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">{m.brand} • {m.category}</p>
                                        <p className="text-[10px] text-slate-600 line-clamp-1 mt-1">{m.composition || 'Active Compound'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                                    <div>
                                        <span className="text-xs font-black text-slate-900">₹{m.basePrice}</span>
                                        <span className="text-[10px] text-slate-400 line-through ml-1">₹{m.mrp}</span>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setSelectedMasterItem(m);
                                            setLinkForm({
                                                sellingPrice: m.basePrice,
                                                mrp: m.mrp,
                                                stockQuantity: 50,
                                                aisleLocation: 'Aisle-1'
                                            });
                                        }}
                                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-extrabold rounded-xl transition cursor-pointer shadow-xs"
                                    >
                                        ⚡ Link to Store
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* TAB 3: ADD CUSTOM PRODUCT (WITH REAL-TIME SIMILARITY ALGORITHM) */}
            {activeTab === 'add_product' && (
                <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Left Column: Basic Details */}
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">Product Title / Medicine Name *</label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder="e.g. Paracetamol 500mg Tablet"
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                />
                                {dupChecking && (
                                    <p className="text-[10px] text-indigo-600 font-bold mt-1 animate-pulse">
                                        ⚡ Running Jaro-Winkler similarity algorithm across tenant catalog...
                                    </p>
                                )}
                            </div>

                            {/* Similarity Check Alert Box */}
                            {dupResult && dupResult.hasPotentialDuplicates && (
                                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-extrabold text-amber-900 flex items-center gap-1">
                                            ⚠️ Potential Duplicates Detected ({Math.round(dupResult.highestMatchScore * 100)}% Match)
                                        </span>
                                        <span className="text-[10px] font-bold bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded-md">
                                            Algorithmic Flag
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-amber-800 leading-snug">
                                        The catalog engine detected existing products with high similarity. Check matches to prevent catalog noise:
                                    </p>
                                    <div className="space-y-1">
                                        {dupResult.matches.map((m) => (
                                            <div key={m.productId} className="flex items-center justify-between text-[10px] bg-white p-2 rounded-lg border border-amber-100">
                                                <div>
                                                    <span className="font-bold text-slate-900">{m.name}</span>
                                                    <span className="text-slate-400 ml-1.5">({m.brand} • {m.sku})</span>
                                                </div>
                                                <span className="font-black text-amber-700">{Math.round(m.similarityScore * 100)}% Match</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Brand Name *</label>
                                    <input
                                        type="text"
                                        value={form.brand}
                                        onChange={(e) => setForm({ ...form, brand: e.target.value })}
                                        placeholder="e.g. Calpol / Dolo / Cipla"
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Manufacturer</label>
                                    <input
                                        type="text"
                                        value={form.manufacturer}
                                        onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                                        placeholder="e.g. Micro Labs / GSK"
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
                                    <select
                                        value={form.category}
                                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                                    >
                                        <option value="Pain & Fever">Pain & Fever</option>
                                        <option value="Antibiotics">Antibiotics</option>
                                        <option value="Allergy & Cold">Allergy & Cold</option>
                                        <option value="Vitamins & Supplements">Vitamins & Supplements</option>
                                        <option value="Digestion & Acidity">Digestion & Acidity</option>
                                        <option value="Wellness & First Aid">Wellness & First Aid</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Dosage Form</label>
                                    <select
                                        value={form.dosageForm}
                                        onChange={(e) => setForm({ ...form, dosageForm: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                                    >
                                        <option value="Tablet">Tablet</option>
                                        <option value="Capsule">Capsule</option>
                                        <option value="Syrup">Syrup</option>
                                        <option value="Injection">Injection</option>
                                        <option value="Ointment">Ointment / Cream</option>
                                        <option value="Drops">Oral Drops</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">Active Ingredient / Composition (Salt)</label>
                                <input
                                    type="text"
                                    value={form.composition}
                                    onChange={(e) => setForm({ ...form, composition: e.target.value })}
                                    placeholder="e.g. Paracetamol IP 650mg"
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                />
                            </div>

                            {/* Professional Placeholder Image Selector */}
                            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                                <label className="block text-xs font-bold text-slate-800">
                                    📸 Product Image Asset (Professional Studio Generated)
                                </label>
                                <div className="grid grid-cols-4 gap-2">
                                    {Object.entries(PHARMA_PLACEHOLDER_IMAGES).map(([key, url]) => (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => setForm({ ...form, imageUrl: url })}
                                            className={`relative rounded-xl overflow-hidden border-2 transition ${
                                                form.imageUrl === url ? 'border-indigo-600 ring-2 ring-indigo-500/40' : 'border-slate-200 hover:border-slate-300'
                                            }`}
                                        >
                                            <img src={url} alt={key} className="w-full h-12 object-cover" />
                                            <span className="absolute bottom-0 inset-x-0 bg-slate-900/80 text-white text-[8px] font-black uppercase text-center py-0.5 truncate px-0.5">
                                                {key}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Right Column: Pricing, Inventory & Variant Generator */}
                        <div className="space-y-3">
                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Base Price (₹) *</label>
                                    <input
                                        type="number"
                                        value={form.basePrice}
                                        onChange={(e) => setForm({ ...form, basePrice: Number(e.target.value) })}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">MRP (₹)</label>
                                    <input
                                        type="number"
                                        value={form.mrp}
                                        onChange={(e) => setForm({ ...form, mrp: Number(e.target.value) })}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Stock Qty *</label>
                                    <input
                                        type="number"
                                        value={form.stockQuantity}
                                        onChange={(e) => setForm({ ...form, stockQuantity: Number(e.target.value) })}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                                <input
                                    type="checkbox"
                                    id="rxCheck"
                                    checked={form.prescriptionRequired}
                                    onChange={(e) => setForm({ ...form, prescriptionRequired: e.target.checked })}
                                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                                />
                                <label htmlFor="rxCheck" className="text-xs font-bold text-slate-800 cursor-pointer">
                                    Prescription Required (Schedule H / H1 Drug)
                                </label>
                            </div>

                            {/* Variant Generator Tool */}
                            <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-extrabold text-indigo-900">🧩 Variant Permutation Generator</span>
                                    <button
                                        type="button"
                                        onClick={handleGenerateVariants}
                                        className="px-2.5 py-1 bg-indigo-600 text-white text-[10px] font-extrabold rounded-lg hover:bg-indigo-700 transition"
                                    >
                                        Generate SKUs
                                    </button>
                                </div>
                                <p className="text-[10px] text-indigo-800">
                                    Automatically computes Cartesian product matrix for packaging sizes & SKUs.
                                </p>

                                {generatedVariants.length > 0 && (
                                    <div className="space-y-1 mt-2 max-h-32 overflow-y-auto">
                                        {generatedVariants.map((v, i) => (
                                            <div key={i} className="flex items-center justify-between text-[10px] bg-white p-1.5 rounded-md border border-indigo-100">
                                                <span className="font-bold text-slate-800">{v.name}</span>
                                                <span className="font-mono text-slate-500">{v.variantSku} • ₹{v.sellingPrice}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="pt-2 flex items-center justify-end gap-2">
                                {dupResult?.hasPotentialDuplicates && (
                                    <button
                                        type="button"
                                        onClick={() => handleSaveProduct(true)}
                                        disabled={loading}
                                        className="px-4 py-2 bg-amber-600 text-white rounded-xl text-xs font-bold hover:bg-amber-700 transition"
                                    >
                                        Force Save (Override Flag)
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => handleSaveProduct(false)}
                                    disabled={loading}
                                    className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-extrabold hover:bg-indigo-700 transition shadow-xs cursor-pointer"
                                >
                                    {loading ? 'Saving...' : 'Publish Product to Catalog'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 4: BULK CATALOG BUILDER (CSV INGESTION) */}
            {activeTab === 'bulk_import' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <div>
                            <h4 className="text-xs font-bold text-slate-900">CSV Bulk Catalog Ingestion Engine</h4>
                            <p className="text-[11px] text-slate-500">Paste or drag CSV data to build and seed tenant product catalogs in batch</p>
                        </div>
                        <button
                            onClick={loadSampleCsv}
                            className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-100 transition"
                        >
                            Load Sample CSV
                        </button>
                    </div>

                    <div>
                        <textarea
                            rows={6}
                            value={bulkCsvText}
                            onChange={(e) => handleParseCsv(e.target.value)}
                            placeholder="Paste CSV headers: name,brand,category,composition,basePrice,mrp,stockQuantity..."
                            className="w-full p-3 font-mono text-xs bg-slate-900 text-slate-100 rounded-xl focus:outline-none"
                        />
                    </div>

                    {bulkParsedRows.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-800">
                                    Dry-Run Validation Preview ({bulkParsedRows.length} rows parsed)
                                </span>
                                <button
                                    onClick={handleRunBulkImport}
                                    disabled={loading}
                                    className="px-5 py-2 bg-emerald-600 text-white text-xs font-extrabold rounded-xl hover:bg-emerald-700 transition shadow-xs"
                                >
                                    {loading ? 'Processing Batch...' : `Run Bulk Catalog Import (${bulkParsedRows.length} Items)`}
                                </button>
                            </div>

                            <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-48">
                                <table className="w-full text-left text-[11px]">
                                    <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-[9px]">
                                        <tr>
                                            <th className="p-2">#</th>
                                            <th className="p-2">Name</th>
                                            <th className="p-2">Brand</th>
                                            <th className="p-2">Category</th>
                                            <th className="p-2">Price</th>
                                            <th className="p-2">Stock</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {bulkParsedRows.map((r, i) => (
                                            <tr key={i} className="hover:bg-slate-50">
                                                <td className="p-2 font-mono text-slate-400">{i + 1}</td>
                                                <td className="p-2 font-bold text-slate-900">{r.name || '—'}</td>
                                                <td className="p-2">{r.brand || '—'}</td>
                                                <td className="p-2">{r.category || 'General'}</td>
                                                <td className="p-2 font-bold">₹{r.basePrice || r.price || '0'}</td>
                                                <td className="p-2">{r.stockQuantity || r.stock || '50'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {bulkImportResult && (
                        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-black text-emerald-900">
                                    Import Batch Completed: {bulkImportResult.batchId}
                                </span>
                                <span className="text-[10px] font-bold bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded-md">
                                    {bulkImportResult.status}
                                </span>
                            </div>
                            <div className="text-xs text-emerald-800 flex gap-4 font-bold">
                                <span>Total: {bulkImportResult.totalRows}</span>
                                <span>Success: {bulkImportResult.successCount}</span>
                                <span>Errors: {bulkImportResult.errorCount}</span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* MASTER PRODUCT LINK MODAL */}
            {selectedMasterItem && (
                <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="bg-white border border-slate-200 rounded-3xl p-5 max-w-md w-full shadow-2xl space-y-4 animate-fade-in">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                            <h4 className="text-sm font-black text-slate-900">⚡ Link Master Product to Store</h4>
                            <button onClick={() => setSelectedMasterItem(null)} className="text-slate-400 hover:text-slate-700">✕</button>
                        </div>
                        <div className="flex items-center gap-3 bg-indigo-50 p-3 rounded-2xl">
                            <img src={selectedMasterItem.imageUrl} alt={selectedMasterItem.name} className="w-12 h-12 rounded-xl object-cover" />
                            <div>
                                <h5 className="text-xs font-bold text-indigo-950">{selectedMasterItem.name}</h5>
                                <p className="text-[10px] text-indigo-800 font-mono">{selectedMasterItem.brand} • {selectedMasterItem.sku}</p>
                            </div>
                        </div>
                        <div className="space-y-3 text-xs">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-bold text-slate-700 mb-1">My Store Selling Price (₹)</label>
                                    <input
                                        type="number"
                                        value={linkForm.sellingPrice}
                                        onChange={(e) => setLinkForm({ ...linkForm, sellingPrice: Number(e.target.value) })}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold text-slate-700 mb-1">MRP (₹)</label>
                                    <input
                                        type="number"
                                        value={linkForm.mrp}
                                        onChange={(e) => setLinkForm({ ...linkForm, mrp: Number(e.target.value) })}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-bold text-slate-700 mb-1">Initial Stock Qty</label>
                                    <input
                                        type="number"
                                        value={linkForm.stockQuantity}
                                        onChange={(e) => setLinkForm({ ...linkForm, stockQuantity: Number(e.target.value) })}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold text-slate-700 mb-1">Aisle Location</label>
                                    <input
                                        type="text"
                                        value={linkForm.aisleLocation}
                                        onChange={(e) => setLinkForm({ ...linkForm, aisleLocation: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="pt-2 flex justify-end gap-2">
                            <button onClick={() => setSelectedMasterItem(null)} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Cancel</button>
                            <button onClick={handleLinkMasterProduct} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs cursor-pointer">
                                Confirm & Link to Store
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* QUICK EDIT MODAL */}
            {editingItem && (
                <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="bg-white border border-slate-200 rounded-3xl p-5 max-w-sm w-full shadow-2xl space-y-4 animate-fade-in">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                            <h4 className="text-sm font-black text-slate-900">⚡ Quick Update Price & Stock</h4>
                            <button onClick={() => setEditingItem(null)} className="text-slate-400 hover:text-slate-700">✕</button>
                        </div>
                        <p className="text-xs font-bold text-slate-800">{editingItem.name}</p>
                        <div className="space-y-3 text-xs">
                            <div>
                                <label className="block font-bold text-slate-700 mb-1">Selling Price (₹)</label>
                                <input
                                    type="number"
                                    value={editForm.sellingPrice}
                                    onChange={(e) => setEditForm({ ...editForm, sellingPrice: Number(e.target.value) })}
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                                />
                            </div>
                            <div>
                                <label className="block font-bold text-slate-700 mb-1">Stock Quantity</label>
                                <input
                                    type="number"
                                    value={editForm.stockQuantity}
                                    onChange={(e) => setEditForm({ ...editForm, stockQuantity: Number(e.target.value) })}
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                                />
                            </div>
                        </div>
                        <div className="pt-2 flex justify-end gap-2">
                            <button onClick={() => setEditingItem(null)} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Cancel</button>
                            <button onClick={handleQuickUpdateSubmit} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs cursor-pointer">
                                Save Quick Update
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
