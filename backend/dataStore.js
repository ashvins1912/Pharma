// Comprehensive in-memory and MongoDB data store layer
import { getIsConnected } from './config/db.js';
import mongoose from 'mongoose';
import Medicine from './models/Medicine.js';
import Order from './models/Order.js';
import Coupon from './models/Coupon.js';
import UserProfile from './models/UserProfile.js';
import UserAddress from './models/UserAddress.js';

// Generator to eagerly load 1,000+ realistic pharmaceutical items at startup
function generateEager1000Catalog() {
    const categoriesData = [
        {
            category: "Pain & Fever",
            code: "PNF",
            items: [
                { name: "Paracetamol", salt: "Paracetamol IP 650mg", brand: "Calpol", mfg: "GlaxoSmithKline", basePrice: 32, rx: false },
                { name: "Dolo 650mg", salt: "Paracetamol IP 650mg", brand: "Dolo", mfg: "Micro Labs", basePrice: 34, rx: false },
                { name: "Ibuprofen 400mg", salt: "Ibuprofen IP 400mg", brand: "Brufen", mfg: "Abbott India", basePrice: 45, rx: false },
                { name: "Aceclofenac + Paracetamol", salt: "Aceclofenac 100mg + Paracetamol 325mg", brand: "Zerodol-P", mfg: "Ipca Laboratories", basePrice: 68, rx: true },
                { name: "Diclofenac Sodium 50mg", salt: "Diclofenac Sodium 50mg", brand: "Voveran", mfg: "Novartis", basePrice: 52, rx: true },
                { name: "Mefenamic Acid 500mg", salt: "Mefenamic Acid 500mg", brand: "Meftal-Spas", mfg: "Blue Cross", basePrice: 58, rx: true },
                { name: "Naproxen Sodium 250mg", salt: "Naproxen Sodium 250mg", brand: "Naprosyn", mfg: "RPG Life Sciences", basePrice: 72, rx: true },
                { name: "Tramadol + Paracetamol", salt: "Tramadol 37.5mg + Paracetamol 325mg", brand: "Ultracet", mfg: "Janssen", basePrice: 145, rx: true }
            ]
        },
        {
            category: "Antibiotics",
            code: "ATB",
            items: [
                { name: "Amoxicillin 500mg", salt: "Amoxicillin Trihydrate 500mg", brand: "Novamox", mfg: "Cipla", basePrice: 115, rx: true },
                { name: "Augmentin 625 Duo", salt: "Amoxicillin 500mg + Clavulanate 125mg", brand: "Augmentin", mfg: "GlaxoSmithKline", basePrice: 205, rx: true },
                { name: "Azithromycin 500mg", salt: "Azithromycin Dihydrate 500mg", brand: "Azee", mfg: "Cipla", basePrice: 128, rx: true },
                { name: "Ciprofloxacin 500mg", salt: "Ciprofloxacin 500mg", brand: "Ciplox", mfg: "Cipla", basePrice: 48, rx: true },
                { name: "Cefixime 200mg", salt: "Cefixime 200mg", brand: "Zifi", mfg: "FDC Ltd", basePrice: 110, rx: true },
                { name: "Ofloxacin + Ornidazole", salt: "Ofloxacin 200mg + Ornidazole 500mg", brand: "O2", mfg: "Medley", basePrice: 138, rx: true },
                { name: "Doxycycline 100mg", salt: "Doxycycline Hcl 100mg", brand: "Doxicip", mfg: "Cipla", basePrice: 65, rx: true },
                { name: "Clarithromycin 500mg", salt: "Clarithromycin 500mg", brand: "Claribid", mfg: "Kremers Urban", basePrice: 290, rx: true }
            ]
        },
        {
            category: "Allergy & Cold",
            code: "ALC",
            items: [
                { name: "Cetirizine 10mg", salt: "Cetirizine Hcl 10mg", brand: "Zyrtec", mfg: "Dr. Reddy's", basePrice: 26, rx: false },
                { name: "Levocetirizine 5mg", salt: "Levocetirizine Dihydrochloride 5mg", brand: "Vozet", mfg: "Glenmark", basePrice: 50, rx: false },
                { name: "Montelukast + Levocetirizine", salt: "Montelukast 10mg + Levocetirizine 5mg", brand: "Montair-LC", mfg: "Cipla", basePrice: 180, rx: true },
                { name: "Allegra 120mg", salt: "Fexofenadine Hydrochloride 120mg", brand: "Allegra", mfg: "Sanofi India", basePrice: 190, rx: false },
                { name: "Chlorpheniramine 4mg", salt: "CPM 4mg", brand: "Cadistin", mfg: "Zydus", basePrice: 18, rx: false },
                { name: "Ascoril-D Cough Syrup", salt: "Dextromethorphan + Phenylephrine", brand: "Ascoril", mfg: "Glenmark", basePrice: 98, rx: false },
                { name: "Otrivin Nasal Spray", salt: "Xylometazoline 0.1%", brand: "Otrivin", mfg: "Haleon", basePrice: 108, rx: false },
                { name: "Benadryl Cough Formula", salt: "Diphenhydramine Hcl", brand: "Benadryl", mfg: "Johnson & Johnson", basePrice: 122, rx: false }
            ]
        },
        {
            category: "Vitamins & Supplements",
            code: "VTS",
            items: [
                { name: "Vitamin C Chewable 500mg", salt: "Ascorbic Acid IP 500mg", brand: "Limcee", mfg: "Abbott", basePrice: 24, rx: false },
                { name: "Vitamin D3 60K Granules", salt: "Cholecalciferol 60,000 IU", brand: "Calcirol", mfg: "Cadila", basePrice: 52, rx: false },
                { name: "Becosules Z B-Complex", salt: "B-Complex with Zinc & Vitamin C", brand: "Becosules", mfg: "Pfizer India", basePrice: 48, rx: false },
                { name: "Shelcal 500 Calcium", salt: "Calcium Carbonate 500mg + Vit D3", brand: "Shelcal", mfg: "Torrent Pharma", basePrice: 120, rx: false },
                { name: "Omega 3 Fish Oil 1000mg", salt: "EPA 180mg + DHA 120mg", brand: "Seven Seas", mfg: "Merck", basePrice: 275, rx: false },
                { name: "Nurokind-OD B12", salt: "Methylcobalamin 1500mcg", brand: "Nurokind", mfg: "Mankind", basePrice: 98, rx: false },
                { name: "Zincovit Multivitamin", salt: "Multivitamins with Minerals", brand: "Zincovit", mfg: "Apex Labs", basePrice: 110, rx: false },
                { name: "Orofer-XT Iron", salt: "Ferrous Ascorbate + Folic Acid", brand: "Orofer", mfg: "Emcure", basePrice: 168, rx: false }
            ]
        },
        {
            category: "Digestion & Acidity",
            code: "DGA",
            items: [
                { name: "Pantoprazole 40mg", salt: "Pantoprazole Sodium 40mg", brand: "Pan-40", mfg: "Alkem", basePrice: 98, rx: true },
                { name: "Omez 20mg", salt: "Omeprazole Gastro-resistant 20mg", brand: "Omez", mfg: "Dr. Reddy's", basePrice: 62, rx: false },
                { name: "Rabeprazole + Domperidone", salt: "Rabeprazole 20mg + Domperidone 30mg", brand: "Rablet-D", mfg: "Lupin", basePrice: 190, rx: true },
                { name: "Gelusil MPS Antacid", salt: "Magaldrate + Simethicone Gel", brand: "Gelusil", mfg: "Pfizer", basePrice: 128, rx: false },
                { name: "Digene Chewable Tablets", salt: "Aluminium Hydroxide + Magnesium", brand: "Digene", mfg: "Abbott", basePrice: 24, rx: false },
                { name: "Emeset 4mg", salt: "Ondansetron 4mg MD", brand: "Emeset", mfg: "Cipla", basePrice: 44, rx: true },
                { name: "Duphalac Oral Solution", salt: "Lactulose 10g / 15ml", brand: "Duphalac", mfg: "Abbott", basePrice: 235, rx: false },
                { name: "Sporlac Probiotic", salt: "Lactic Acid Bacillus 60M Spores", brand: "Sporlac", mfg: "Sanzyme", basePrice: 88, rx: false }
            ]
        },
        {
            category: "Wellness & First Aid",
            code: "WFA",
            items: [
                { name: "Electral ORS 21.8g", salt: "Oral Rehydration Salts WHO Formula", brand: "Electral", mfg: "FDC Ltd", basePrice: 22, rx: false },
                { name: "Betadine Ointment 20g", salt: "Povidone Iodine IP 5%", brand: "Betadine", mfg: "Win-Medicare", basePrice: 68, rx: false },
                { name: "Dettol Antiseptic 250ml", salt: "Chloroxylenol Antiseptic", brand: "Dettol", mfg: "Reckitt Benckiser", basePrice: 138, rx: false },
                { name: "Volini Pain Spray 55g", salt: "Diclofenac + Methyl Salicylate", brand: "Volini", mfg: "Sun Pharma", basePrice: 148, rx: false },
                { name: "Band-Aid Washproof 20s", salt: "Medicated Gauze Pad with Antiseptic", brand: "Band-Aid", mfg: "Johnson & Johnson", basePrice: 52, rx: false },
                { name: "Dr. Morepen Thermometer", salt: "Digital Sensor High Accuracy", brand: "Dr. Morepen", mfg: "Morepen Labs", basePrice: 185, rx: false },
                { name: "Flamingo Crepe Bandage", salt: "Elastic Compression Cotton Bandage", brand: "Flamingo", mfg: "Flamingo Health", basePrice: 145, rx: false },
                { name: "Glucon-D Orange 500g", salt: "Dextrose Monohydrate with Vit C", brand: "Glucon-D", mfg: "Zydus Wellness", basePrice: 94, rx: false }
            ]
        },
        {
            category: "Cardiac & Hypertension",
            code: "CDH",
            items: [
                { name: "Telma 40mg", salt: "Telmisartan IP 40mg", brand: "Telma", mfg: "Glenmark", basePrice: 128, rx: true },
                { name: "Amlong 5mg", salt: "Amlodipine Besylate 5mg", brand: "Amlong", mfg: "Micro Labs", basePrice: 40, rx: true },
                { name: "Atorva 10mg", salt: "Atorvastatin Calcium 10mg", brand: "Atorva", mfg: "Zydus", basePrice: 98, rx: true },
                { name: "Rosuvas 10mg", salt: "Rosuvastatin IP 10mg", brand: "Rosuvas", mfg: "Sun Pharma", basePrice: 168, rx: true },
                { name: "Telma-AM", salt: "Telmisartan 40mg + Amlodipine 5mg", brand: "Telma-AM", mfg: "Glenmark", basePrice: 178, rx: true },
                { name: "Betaloc 25mg", salt: "Metoprolol Succinate 25mg PR", brand: "Betaloc", mfg: "AstraZeneca", basePrice: 88, rx: true },
                { name: "Deplatt 75mg", salt: "Clopidogrel 75mg", brand: "Deplatt", mfg: "Torrent", basePrice: 114, rx: true },
                { name: "Losacar 50mg", salt: "Losartan Potassium 50mg", brand: "Losacar", mfg: "Zydus", basePrice: 82, rx: true }
            ]
        },
        {
            category: "Diabetes & Endocrine",
            code: "DBE",
            items: [
                { name: "Glycomet 500mg SR", salt: "Metformin Hcl 500mg SR", brand: "Glycomet", mfg: "USV Ltd", basePrice: 44, rx: true },
                { name: "Amaryl 1mg", salt: "Glimepiride IP 1mg", brand: "Amaryl", mfg: "Sanofi", basePrice: 88, rx: true },
                { name: "Glimestar-M2", salt: "Glimepiride 2mg + Metformin 500mg SR", brand: "Glimestar", mfg: "Mankind", basePrice: 102, rx: true },
                { name: "Ziten 20mg", salt: "Teneligliptin 20mg", brand: "Ziten", mfg: "Glenmark", basePrice: 148, rx: true },
                { name: "Forxiga 10mg", salt: "Dapagliflozin 10mg", brand: "Forxiga", mfg: "AstraZeneca", basePrice: 290, rx: true },
                { name: "Volibo 0.2mg MD", salt: "Voglibose 0.2mg Mouth Dissolving", brand: "Volibo", mfg: "Sun Pharma", basePrice: 78, rx: true },
                { name: "Thyronorm 50mcg", salt: "Thyroxine Sodium 50mcg", brand: "Thyronorm", mfg: "Abbott", basePrice: 138, rx: true },
                { name: "Eltroxin 100mcg", salt: "Thyroxine Sodium 100mcg", brand: "Eltroxin", mfg: "GSK", basePrice: 168, rx: true }
            ]
        }
    ];

    const packageVariations = [
        { label: "Strip of 10 Tablets", mult: 1, stockMod: 45 },
        { label: "Strip of 15 Tablets", mult: 1.45, stockMod: 60 },
        { label: "Pack of 30 Tablets", mult: 2.8, stockMod: 30 },
        { label: "Blister Pack of 10", mult: 1.05, stockMod: 75 },
        { label: "Mouth Dissolving 10s", mult: 1.1, stockMod: 50 },
        { label: "Capsules (Pack of 10)", mult: 1.15, stockMod: 40 },
        { label: "Bottle of 60ml Syrup", mult: 1.25, stockMod: 35 },
        { label: "Bottle of 100ml Syrup", mult: 1.6, stockMod: 25 },
        { label: "Forte Strips of 10", mult: 1.5, stockMod: 55 },
        { label: "Extended Release 10s", mult: 1.35, stockMod: 20 },
        { label: "Oral Drops 15ml", mult: 1.1, stockMod: 15 },
        { label: "Effervescent Pack of 10", mult: 1.7, stockMod: 40 },
        { label: "Economy Twin Pack", mult: 1.9, stockMod: 25 },
        { label: "Rapid Action Formulation", mult: 1.3, stockMod: 35 },
        { label: "Micro-Coated 10 Tablets", mult: 1.2, stockMod: 60 },
        { label: "Clinical Strength Pack", mult: 1.8, stockMod: 50 }
    ];

    const cdnImages = [
        "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80",
        "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=500&q=80",
        "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=500&q=80",
        "https://images.unsplash.com/photo-1550572017-edd951aa8f72?w=500&q=80",
        "https://images.unsplash.com/photo-1584365685547-9a5fb6f3a70c?w=500&q=80",
        "https://images.unsplash.com/photo-1577401239170-897942555fb3?w=500&q=80",
        "https://images.unsplash.com/photo-1585435557343-3b092031a831?w=500&q=80",
        "https://images.unsplash.com/photo-1607613009820-a29f7bb81c04?w=500&q=80"
    ];

    const catalog = [];
    let medCounter = 1;

    for (const catGroup of categoriesData) {
        for (const item of catGroup.items) {
            for (let vIdx = 0; vIdx < packageVariations.length; vIdx++) {
                const variant = packageVariations[vIdx];
                const skuCode = `MED-${catGroup.code}-${item.name.replace(/[^A-Za-z0-9]/g, '').substring(0, 4).toUpperCase()}-${String(vIdx + 1).padStart(2, '0')}`;
                
                // Set stock: exactly every 11th item has stock = 0 to test out-of-stock search-only visibility
                const isOutOfStock = medCounter % 11 === 0;
                const stock = isOutOfStock ? 0 : Math.max(2, (variant.stockMod + (medCounter % 60)));

                const price = Math.round(item.basePrice * variant.mult);
                const expiryDate = new Date(Date.now() + (180 + (medCounter % 700)) * 86400000);

                catalog.push({
                    _id: `med-${medCounter}`,
                    sku: skuCode,
                    name: `${item.name} (${variant.label})`,
                    brand: item.brand,
                    category: catGroup.category,
                    description: `Certified pharmaceutical grade ${item.name} formulation by ${item.mfg}.`,
                    composition: item.salt,
                    price,
                    quantity: stock,
                    stock,
                    batchNumber: `BTH-${catGroup.code}-${2400 + (medCounter % 500)}`,
                    expiryDate,
                    requiresPrescription: item.rx,
                    imageUrl: cdnImages[medCounter % cdnImages.length],
                    manufacturer: item.mfg
                });

                medCounter++;
            }
        }
    }

    console.log(`🚀 [Eager Loading] Generated ${catalog.length} pharmaceutical items into in-memory master catalog.`);
    return catalog;
}

// Eagerly pre-populate 1,024 medicines
const defaultMedicines = generateEager1000Catalog();
let inMemoryMedicines = [...defaultMedicines];

let inMemoryCoupons = [
    { _id: "c-1", code: "FREEMED20", discountPercentage: 20, isActive: true, minOrderValue: 100 },
    { _id: "c-2", code: "WELCOME10", discountPercentage: 10, isActive: true, minOrderValue: 50 },
    { _id: "c-3", code: "HEALTH50", discountPercentage: 50, isActive: true, minOrderValue: 200 }
];

let inMemoryOrders = [
    {
        _id: "ord-1021",
        userId: "demo-customer-id",
        customerName: "Ashvin Singh",
        customerMobile: "+91 95899 16475",
        items: [
            { _id: "med-1", sku: "MED-PNF-PARA-01", name: "Paracetamol (Strip of 10 Tablets)", price: 32, quantity: 2, stock: 45 }
        ],
        subtotal: 64,
        discountApplied: 0,
        deliveryFee: 0,
        finalTotal: 64,
        paymentMethod: "Cash on Delivery (COD)",
        deliveryAddress: "Flat 402, Greenfield Heights, Richmond Road, Bengaluru - 560025",
        coordinates: { lat: 12.9667, lng: 77.6000 },
        orderStatus: "Ready to Dispatch",
        rider: null,
        deliveryPersonMobile: null,
        createdAt: new Date(Date.now() - 3600000),
        statusHistory: [
            { previousStatus: null, newStatus: 'Processing Order', changedBy: 'System', timestamp: new Date(Date.now() - 3600000) },
            { previousStatus: 'Processing Order', newStatus: 'Ready to Dispatch', changedBy: 'Pharmacist', timestamp: new Date(Date.now() - 1800000) }
        ]
    },
    {
        _id: "ord-1022",
        userId: "demo-customer-id",
        customerName: "Dr. Ananya Roy",
        customerMobile: "+91 98450 11223",
        items: [
            { _id: "med-2", sku: "MED-ATB-AMOX-01", name: "Amoxicillin 500mg", price: 115, quantity: 1, stock: 40 }
        ],
        subtotal: 115,
        discountApplied: 0,
        deliveryFee: 0,
        finalTotal: 115,
        paymentMethod: "Cash on Delivery (COD)",
        deliveryAddress: "Apollo Clinic Quarter, Shanthala Nagar, Bengaluru - 560025",
        coordinates: { lat: 12.9716, lng: 77.5946 },
        orderStatus: "Processing Order",
        rider: null,
        deliveryPersonMobile: null,
        createdAt: new Date(Date.now() - 7200000),
        statusHistory: [
            { previousStatus: null, newStatus: 'Processing Order', changedBy: 'System', timestamp: new Date(Date.now() - 7200000) }
        ]
    }
];

let inMemoryProfiles = new Map();
inMemoryProfiles.set("demo-customer-id", {
    userId: "demo-customer-id",
    name: "Ashvin Singh",
    email: "customer@ashvinpharma.com",
    mobile: "+91 95899 16475"
});
let inMemoryAddresses = new Map([["demo-customer-id", [{
    _id: "addr-1",
    userId: "demo-customer-id",
    label: "Home",
    fullName: "Ashvin Singh",
    mobile: "+91 95899 16475",
    addressLine1: "Flat 402, Greenfield Heights, Richmond Road",
    addressLine2: "Shanthala Nagar",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560025",
    landmark: "Near Richmond Circle",
    addressLine: "Flat 402, Greenfield Heights, Richmond Road, Bengaluru - 560025",
    coordinates: { lat: 12.9667, lng: 77.6000 },
    isDefault: true
}]]]);

const normalizeAddress = (address, userId, existing = {}) => {
    const addressLine1 = address.addressLine1 || address.addressLine || existing.addressLine1 || '';
    const addressLine2 = address.addressLine2 ?? existing.addressLine2 ?? '';
    const city = address.city || existing.city || 'Bengaluru';
    const state = address.state || existing.state || 'Karnataka';
    const pincode = address.pincode || existing.pincode || '560025';
    return {
        userId,
        label: address.label || existing.label || 'Home',
        fullName: address.fullName ?? existing.fullName ?? '',
        mobile: address.mobile ?? existing.mobile ?? '',
        addressLine1,
        addressLine2,
        city,
        state,
        pincode,
        landmark: address.landmark ?? existing.landmark ?? '',
        addressLine: address.addressLine ||
            `${addressLine1} ${addressLine2 ? `, ${addressLine2}` : ''}, ${city}, ${state} - ${pincode}`,
        coordinates: address.coordinates || existing.coordinates || { lat: 12.9716, lng: 77.5946 },
        isDefault: Boolean(address.isDefault ?? existing.isDefault)
    };
};

let inMemoryAuditLogs = [];
let inMemoryInventoryAudits = [];

function formatMedicine(med) {
    const obj = med.toObject ? med.toObject() : { ...med };
    obj.stock = obj.stock !== undefined ? obj.stock : (obj.quantity || 0);
    const now = new Date();
    const expiry = new Date(obj.expiryDate);
    const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 3600 * 24));
    
    obj.daysUntilExpiry = daysUntilExpiry;
    obj.isExpired = daysUntilExpiry <= 0;
    obj.isExpiringSoon = daysUntilExpiry > 0 && daysUntilExpiry <= 30;
    obj.isLowStock = obj.stock <= 3;
    return obj;
}

export const dataStore = {
    // Audit Logging
    logAudit(actorId, action, resourceType, resourceId, details = {}) {
        const auditRecord = {
            id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            actorId: actorId || 'System',
            action,
            resourceType,
            resourceId,
            details,
            timestamp: new Date().toISOString()
        };
        inMemoryAuditLogs.unshift(auditRecord);
        return auditRecord;
    },

    getAuditLogs() {
        return inMemoryAuditLogs.slice(0, 50);
    },

    getInventoryAudits() {
        return inMemoryInventoryAudits.slice(0, 50);
    },

    // Medicines: Supports server-side pagination & "out-of-stock only on search" logic
    async getMedicines(search = '', hideRx = false, category = 'All', sort = 'default', page = 1, limit = 16, includeOutOfStock = false) {
        let filtered = inMemoryMedicines;

        // RULE: If search query is provided, out-of-stock items can display (with SOLD OUT badge).
        // If not searching, out-of-stock items are hidden from general browsing!
        const isSearching = Boolean(search && search.toString().trim() !== '');

        if (!isSearching && !includeOutOfStock) {
            filtered = filtered.filter(m => {
                const stock = m.stock !== undefined ? m.stock : m.quantity;
                return stock > 0 && !m.isExpired;
            });
        }

        if (isSearching) {
            const s = search.toString().toLowerCase().trim();
            filtered = filtered.filter(m =>
                m.name.toLowerCase().includes(s) ||
                m.brand.toLowerCase().includes(s) ||
                (m.composition && m.composition.toLowerCase().includes(s)) ||
                (m.sku && m.sku.toLowerCase().includes(s))
            );
        }

        if (hideRx === 'true' || hideRx === true) {
            filtered = filtered.filter(m => !m.requiresPrescription);
        }

        if (category && category !== 'All') {
            filtered = filtered.filter(m => m.category === category);
        }

        // Sorting
        if (sort === 'price-asc') {
            filtered = [...filtered].sort((a, b) => a.price - b.price);
        } else if (sort === 'price-desc') {
            filtered = [...filtered].sort((a, b) => b.price - a.price);
        } else if (sort === 'name-asc') {
            filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
        } else if (sort === 'stock-asc') {
            filtered = [...filtered].sort((a, b) => a.stock - b.stock);
        }

        // Pagination Calculations
        const total = filtered.length;
        const parsedPage = Math.max(1, Number(page) || 1);
        const parsedLimit = Math.max(1, Number(limit) || 16);
        const totalPages = Math.ceil(total / parsedLimit) || 1;
        const startIndex = (parsedPage - 1) * parsedLimit;
        const paginatedMedicines = filtered.slice(startIndex, startIndex + parsedLimit).map(formatMedicine);

        return {
            medicines: paginatedMedicines,
            total,
            page: parsedPage,
            limit: parsedLimit,
            totalPages,
            isSearching,
            outOfStockHidden: !isSearching && !includeOutOfStock
        };
    },

    async getInventoryAlerts(lowStockThreshold = 3, expiringThresholdDays = 30) {
        // Inspect all medicines including out of stock for admin alerts
        const allMeds = inMemoryMedicines.map(formatMedicine);
        const now = new Date();

        const expired = [];
        const expiringSoon = [];
        const lowStock = [];

        for (const med of allMeds) {
            const exp = new Date(med.expiryDate);
            const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 3600 * 24));

            if (daysLeft <= 0) {
                expired.push({ ...med, daysLeft });
            } else if (daysLeft <= expiringThresholdDays) {
                expiringSoon.push({ ...med, daysLeft });
            }

            if (med.stock <= lowStockThreshold) {
                lowStock.push(med);
            }
        }

        return {
            expiredCount: expired.length,
            expiringSoonCount: expiringSoon.length,
            lowStockCount: lowStock.length,
            totalAlerts: expired.length + expiringSoon.length + lowStock.length,
            expired: expired.slice(0, 20),
            expiringSoon: expiringSoon.slice(0, 20),
            lowStock: lowStock.slice(0, 20)
        };
    },

    async seedMedicines() {
        inMemoryMedicines = generateEager1000Catalog();
        this.logAudit('Admin', 'SEED_MEDICINES', 'INVENTORY', 'ALL', { count: inMemoryMedicines.length });
        return inMemoryMedicines;
    },

    async importExcelInventory(rows, adminId = 'Admin') {
        const importId = `imp-${Date.now()}`;
        const auditEntries = [];
        let importedCount = 0;
        let updatedCount = 0;

        for (const row of rows) {
            const sku = (row.SKU || row.sku || `SKU-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`).toString().trim();
            const name = (row['Medicine Name'] || row.name || row.Name || '').toString().trim();
            if (!name) continue;

            const category = (row.Category || row.category || 'General Medicine').toString().trim();
            const description = (row.Description || row.description || '').toString().trim();
            const brand = (row.Brand || row.brand || row.Manufacturer || 'Generic').toString().trim();
            const manufacturer = (row.Manufacturer || row.manufacturer || brand).toString().trim();
            const price = Number(row.Price || row.price) || 50;
            const stock = Number(row.Stock || row.stock || row.Quantity || row.quantity) || 10;
            const batchNumber = (row['Batch Number'] || row.batchNumber || 'BATCH-NEW').toString().trim();
            const requiresPrescription = String(row['Requires Prescription'] || row.requiresPrescription || '').toLowerCase() === 'true';
            
            let imageUrl = (row['Cloudinary Image URL'] || row.imageUrl || '').toString().trim();
            if (!imageUrl || !imageUrl.startsWith('http')) {
                imageUrl = "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80";
            }

            let expiryDate = new Date();
            if (row['Expiry Date'] || row.expiryDate) {
                const parsed = new Date(row['Expiry Date'] || row.expiryDate);
                if (!isNaN(parsed.getTime())) expiryDate = parsed;
                else expiryDate = new Date(Date.now() + 365 * 86400000);
            } else {
                expiryDate = new Date(Date.now() + 365 * 86400000);
            }

            const existingIdx = inMemoryMedicines.findIndex(m =>
                (m.sku && m.sku.toLowerCase() === sku.toLowerCase()) ||
                m.name.toLowerCase() === name.toLowerCase()
            );

            if (existingIdx >= 0) {
                const prev = inMemoryMedicines[existingIdx];
                const auditRecord = {
                    importId,
                    adminId,
                    timestamp: new Date().toISOString(),
                    sku,
                    name,
                    previousStock: prev.stock || prev.quantity || 0,
                    newStock: (prev.stock || prev.quantity || 0) + stock,
                    previousPrice: prev.price,
                    newPrice: price,
                    previousExpiry: prev.expiryDate,
                    newExpiry: expiryDate
                };

                prev.stock = (prev.stock || prev.quantity || 0) + stock;
                prev.quantity = prev.stock;
                prev.price = price;
                prev.expiryDate = expiryDate;
                prev.batchNumber = batchNumber;
                prev.category = category;
                prev.description = description || prev.description;
                if (imageUrl) prev.imageUrl = imageUrl;

                auditEntries.push(auditRecord);
                inMemoryInventoryAudits.unshift(auditRecord);
                updatedCount++;
            } else {
                const newMed = {
                    _id: `med-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                    sku,
                    name,
                    brand,
                    category,
                    description,
                    composition: "Active Formulation",
                    price,
                    quantity: stock,
                    stock,
                    batchNumber,
                    expiryDate,
                    requiresPrescription,
                    imageUrl,
                    manufacturer
                };
                inMemoryMedicines.push(newMed);
                const auditRecord = {
                    importId,
                    adminId,
                    timestamp: new Date().toISOString(),
                    sku,
                    name,
                    previousStock: 0,
                    newStock: stock,
                    previousPrice: 0,
                    newPrice: price,
                    previousExpiry: null,
                    newExpiry: expiryDate
                };
                auditEntries.push(auditRecord);
                inMemoryInventoryAudits.unshift(auditRecord);
                importedCount++;
            }
        }

        this.logAudit(adminId, 'BULK_IMPORT_EXCEL', 'INVENTORY', importId, {
            totalRows: rows.length,
            importedCount,
            updatedCount
        });

        return {
            importId,
            totalRows: rows.length,
            importedCount,
            updatedCount,
            auditEntries
        };
    },

    // Orders
    async createOrder(orderData, actor = 'Customer') {
        const now = new Date();
        const invalidItems = [];

        for (const item of (orderData.items || [])) {
            const med = inMemoryMedicines.find(m => m._id === item._id || m.sku === item.sku || m.name === item.name);
            if (med) {
                if (new Date(med.expiryDate) <= now) {
                    invalidItems.push(`${med.name} (Expired on ${new Date(med.expiryDate).toLocaleDateString()})`);
                }
                const availableStock = med.stock !== undefined ? med.stock : med.quantity;
                if (item.quantity > availableStock) {
                    invalidItems.push(`${med.name} (Insufficient stock: requested ${item.quantity}, available ${availableStock})`);
                }
            }
        }

        if (invalidItems.length > 0) {
            throw new Error(`Order checkout rejected due to inventory validation: ${invalidItems.join('; ')}`);
        }

        const orderDataWithStatus = {
            ...orderData,
            orderStatus: 'Processing Order',
            paymentMethod: orderData.paymentMethod || "Cash on Delivery (COD)",
            statusHistory: [
                {
                    previousStatus: null,
                    newStatus: 'Processing Order',
                    changedBy: actor,
                    timestamp: new Date(),
                    notes: 'Order confirmed and registered in dispensary system.'
                }
            ]
        };

        const orderObj = getIsConnected()
            ? (await Order.create(orderDataWithStatus)).toObject()
            : { _id: `ord-${Date.now().toString().slice(-4)}`, ...orderDataWithStatus, createdAt: new Date() };
        if (!getIsConnected()) inMemoryOrders.unshift(orderObj);

        // Deduct inventory atomically
        for (const item of (orderData.items || [])) {
            const med = inMemoryMedicines.find(m => m._id === item._id || m.sku === item.sku || m.name === item.name);
            if (med) {
                med.stock = Math.max(0, (med.stock || med.quantity || 0) - (Number(item.quantity) || 1));
                med.quantity = med.stock;
            }
        }

        this.logAudit(actor, 'ORDER_CREATED', 'ORDER', orderObj._id.toString(), {
            finalTotal: orderData.finalTotal,
            itemCount: orderData.items?.length
        });

        return orderObj;
    },

    async getAllOrders() {
        if (getIsConnected()) {
            return Order.find().sort({ createdAt: -1 }).lean();
        }
        return [...inMemoryOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    async getUserOrders(userId) {
        if (getIsConnected()) {
            return Order.find({ userId }).sort({ createdAt: -1 }).lean();
        }
        return inMemoryOrders.filter(o => o.userId === userId)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    async transitionOrderStatus(orderId, newStatus, actor = 'Pharmacist', riderInfo = null) {
        let order = inMemoryOrders.find(o => o._id.toString() === orderId);
        if (!order && getIsConnected() && mongoose.isValidObjectId(orderId)) {
            order = await Order.findById(orderId);
        }
        if (!order) throw new Error("Order not found");

        const validTransitions = {
            'Processing Order': ['Ready to Dispatch', 'Cancelled'],
            'Ready to Dispatch': ['Dispatched', 'Processing Order', 'Cancelled'],
            'Dispatched': ['Delivered', 'Ready to Dispatch'],
            'Delivered': []
        };

        const allowed = validTransitions[order.orderStatus] || [];
        if (!allowed.includes(newStatus)) {
            throw new Error(`Invalid state transition: Cannot change order from '${order.orderStatus}' to '${newStatus}'`);
        }

        const transitionAt = new Date();
        const prevStatus = order.orderStatus;
        order.orderStatus = newStatus;

        if (riderInfo) {
            order.rider = {
                riderId: riderInfo.riderId || `r-${Date.now()}`,
                riderName: riderInfo.riderName || 'Assigned Courier',
                riderMobile: riderInfo.riderMobile || '',
                assignedAt: new Date()
            };
            order.deliveryPersonMobile = riderInfo.riderMobile;
        }

        if (newStatus === 'Dispatched') {
            order.outForDeliveryAt = transitionAt;
            order.deliveredAt = null;
        }
        if (newStatus === 'Delivered') {
            order.deliveredAt = transitionAt;
        }

        if (!order.statusHistory) order.statusHistory = [];
        order.statusHistory.push({
            previousStatus: prevStatus,
            newStatus,
            changedBy: actor,
            timestamp: transitionAt,
            notes: riderInfo ? `Rider assigned: ${riderInfo.riderName} (${riderInfo.riderMobile})` : ''
        });
        if (order.save) await order.save();

        this.logAudit(actor, 'ORDER_STATUS_CHANGED', 'ORDER', orderId, {
            previousStatus: prevStatus,
            newStatus,
            rider: order.rider
        });

        return order;
    },

    calculateDistanceInKm(lat1, lon1, lat2, lon2) {
        if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    },

    async clubDeliveryRoute(riderName, riderMobile, radiusKm = 5, startLat = 12.9716, startLng = 77.5946) {
        const eligibleOrders = inMemoryOrders.filter(o => o.orderStatus === 'Ready to Dispatch');
        const radius = Number(radiusKm) || 5;

        const matchingOrders = [];
        for (const order of eligibleOrders) {
            const oLat = order.coordinates?.lat || startLat;
            const oLng = order.coordinates?.lng || startLng;
            const distance = this.calculateDistanceInKm(startLat, startLng, oLat, oLng);
            if (distance <= radius) {
                matchingOrders.push({
                    ...order,
                    distanceKm: Math.round(distance * 10) / 10
                });
            }
        }

        matchingOrders.sort((a, b) => a.distanceKm - b.distanceKm);

        let googleMapsUrl = "";
        if (matchingOrders.length > 0) {
            const originStr = `${startLat},${startLng}`;
            const destOrder = matchingOrders[matchingOrders.length - 1];
            const destStr = `${destOrder.coordinates?.lat || startLat},${destOrder.coordinates?.lng || startLng}`;
            
            const waypoints = matchingOrders.slice(0, matchingOrders.length - 1)
                .map(o => `${o.coordinates?.lat || startLat},${o.coordinates?.lng || startLng}`)
                .join('|');

            googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${originStr}&destination=${destStr}${waypoints ? `&waypoints=${waypoints}` : ''}`;
        }

        return {
            riderName: riderName || "Assigned Courier",
            riderMobile: riderMobile || "",
            configuredRadiusKm: radius,
            startCoordinates: { lat: startLat, lng: startLng },
            ordersFound: matchingOrders.length,
            orders: matchingOrders,
            googleMapsUrl
        };
    },

    async createCoupon(code, discountPercentage, minOrderValue = 0) {
        const uppercase = code.toUpperCase().trim();
        const existing = inMemoryCoupons.find(c => c.code === uppercase);
        if (existing) {
            existing.discountPercentage = Number(discountPercentage);
            existing.minOrderValue = Number(minOrderValue) || 0;
            existing.isActive = true;
        } else {
            inMemoryCoupons.push({
                _id: `c-${Date.now()}`,
                code: uppercase,
                discountPercentage: Number(discountPercentage),
                minOrderValue: Number(minOrderValue) || 0,
                isActive: true
            });
        }
        this.logAudit('Admin', 'COUPON_CREATED', 'COUPON', uppercase, { discountPercentage, minOrderValue });
    },

    async validateCoupon(code, orderTotal = 0) {
        const uppercase = (code || '').toUpperCase().trim();
        const c = inMemoryCoupons.find(x => x.code === uppercase && x.isActive);
        if (!c) return { valid: false, message: "Invalid or expired promo code" };
        if (orderTotal < (c.minOrderValue || 0)) {
            return { valid: false, message: `Minimum order amount of ₹${c.minOrderValue} required for this coupon.` };
        }
        return { valid: true, discountPercentage: c.discountPercentage, code: c.code };
    },

    async getUserProfile(userId) {
        if (getIsConnected()) {
            const profile = await UserProfile.collection.findOne({ userId });
            return profile || {
                userId,
                name: "Customer",
                email: "customer@ashvinpharma.com",
                mobile: "+91 95899 16475"
            };
        }
        return inMemoryProfiles.get(userId) || {
            userId,
            name: "Customer",
            email: "customer@ashvinpharma.com",
            mobile: "+91 95899 16475"
        };
    },

    async saveUserProfile(userId, data) {
        const profileData = {
            userId,
            name: data.name || '',
            email: data.email || '',
            mobile: data.mobile || ''
        };
        if (getIsConnected()) {
            await UserProfile.collection.updateOne(
                { userId },
                { $set: profileData, $unset: { addresses: '' } },
                { upsert: true }
            );
            return UserProfile.collection.findOne({ userId });
        }
        const updated = { ...inMemoryProfiles.get(userId), ...profileData };
        inMemoryProfiles.set(userId, updated);
        return updated;
    },

    async getUserAddresses(userId) {
        if (getIsConnected()) {
            const addresses = await UserAddress.find({ userId }).sort({ isDefault: -1, createdAt: 1 }).lean();
            if (addresses.length) return addresses;

            const profile = await UserProfile.collection.findOne({ userId });
            if (profile?.addresses?.length) {
                const legacyAddresses = profile.addresses.map((address, index) =>
                    normalizeAddress(address, userId, { isDefault: index === 0 })
                );
                const migrated = await UserAddress.insertMany(legacyAddresses);
                try {
                    await UserProfile.collection.updateOne({ userId }, { $unset: { addresses: '' } });
                } catch (error) {
                    await UserAddress.deleteMany({ userId });
                    throw error;
                }
                return migrated.map(address => address.toObject());
            }
            return [];
        }

        const addresses = inMemoryAddresses.get(userId) || [];
        if (addresses.length) return addresses;
        const legacyAddresses = inMemoryProfiles.get(userId)?.addresses;
        if (!legacyAddresses?.length) return [];
        const migrated = legacyAddresses.map((address, index) =>
            normalizeAddress(address, userId, { isDefault: index === 0 })
        );
        inMemoryAddresses.set(userId, migrated);
        const { addresses: _legacyAddresses, ...profile } = inMemoryProfiles.get(userId);
        inMemoryProfiles.set(userId, profile);
        return migrated;
    },

    async getUserAddress(userId, addressId) {
        if (!addressId) return null;
        if (getIsConnected()) {
            return UserAddress.findOne({ _id: addressId, userId }).lean();
        }
        return (await this.getUserAddresses(userId)).find(address => address._id.toString() === addressId) || null;
    },

    async createUserAddress(userId, address) {
        const existingAddresses = await this.getUserAddresses(userId);
        const normalized = normalizeAddress(address, userId, {
            isDefault: address.isDefault || existingAddresses.length === 0
        });
        if (getIsConnected()) {
            if (normalized.isDefault) {
                await UserAddress.updateMany({ userId }, { $set: { isDefault: false } });
            }
            const created = await UserAddress.create(normalized);
            return created.toObject();
        }
        const created = { ...normalized, _id: `addr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
        const updatedAddresses = normalized.isDefault
            ? existingAddresses.map(item => ({ ...item, isDefault: false }))
            : existingAddresses;
        inMemoryAddresses.set(userId, [...updatedAddresses, created]);
        return created;
    },

    async updateUserAddress(userId, addressId, address) {
        const existing = await this.getUserAddress(userId, addressId);
        if (!existing) return null;
        const normalized = normalizeAddress(address, userId, existing);
        const addresses = await this.getUserAddresses(userId);
        const shouldBeDefault = normalized.isDefault || existing.isDefault || addresses.length === 1;
        normalized.isDefault = shouldBeDefault;

        if (getIsConnected()) {
            if (shouldBeDefault) {
                await UserAddress.updateMany({ userId }, { $set: { isDefault: false } });
            }
            const updated = await UserAddress.findOneAndUpdate(
                { _id: addressId, userId },
                { $set: normalized },
                { new: true, runValidators: true }
            );
            return updated?.toObject() || null;
        }
        const updatedAddresses = addresses.map(item => {
            if (item._id.toString() === addressId) return { ...normalized, _id: item._id };
            return shouldBeDefault ? { ...item, isDefault: false } : item;
        });
        inMemoryAddresses.set(userId, updatedAddresses);
        return updatedAddresses.find(item => item._id.toString() === addressId);
    },

    async deleteUserAddress(userId, addressId) {
        const existing = await this.getUserAddress(userId, addressId);
        if (!existing) return false;
        if (getIsConnected()) {
            const deleted = await UserAddress.findOneAndDelete({ _id: addressId, userId });
            if (!deleted) return false;
            if (deleted.isDefault) {
                const nextAddress = await UserAddress.findOne({ userId }).sort({ createdAt: 1 });
                if (nextAddress) {
                    nextAddress.isDefault = true;
                    await nextAddress.save();
                }
            }
            return true;
        }
        const remaining = (await this.getUserAddresses(userId))
            .filter(address => address._id.toString() !== addressId);
        if (existing.isDefault && remaining.length) remaining[0].isDefault = true;
        inMemoryAddresses.set(userId, remaining);
        return true;
    }
};

export default dataStore;
