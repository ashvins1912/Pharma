// Comprehensive in-memory and MongoDB data store layer
import { getIsConnected } from './config/db.js';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import Medicine from './models/Medicine.js';
import { inventoryClient } from './services/inventory-client/InventoryClient.js';
import Order from './models/Order.js';
import Coupon from './models/Coupon.js';
import UserProfile from './models/UserProfile.js';
import UserAddress from './models/UserAddress.js';
import CustomerPointsLedger from './models/CustomerPointsLedger.js';
import Rider from './models/Rider.js';
import Tenant from './models/Tenant.js';
import SurplusSavingsCampaign from './models/SurplusSavingsCampaign.js';
import SurplusSavingsRedemption from './models/SurplusSavingsRedemption.js';
import { calculateSurplusUnitDiscount, roundCurrency } from './services/surplusSavingsPricing.js';
import MedicineRequest from './models/MedicineRequest.js';
import { normalizeWhatsAppNumber, sendWhatsAppMedicineRequestAlert, sendCustomWhatsAppAlert } from './config/whatsapp.js';
import ProfitMarginRewardEngine from './strategies/ProfitMarginRewardEngine.js';
import DefaultProfitRewardStrategy from './strategies/ProfitRewardStrategy.js';
import FixedDeliveryRewardStrategy from './strategies/DeliveryRewardStrategy.js';
import { verifyPrescriptionAgainstItems } from './services/prescription-verification/PrescriptionVerificationService.js';
import { domainEvents } from './shared/events/DomainEvents.js';

const profitMarginRewardEngine = new ProfitMarginRewardEngine({
    strategy: new DefaultProfitRewardStrategy()
});
const deliveryRewardStrategy = new FixedDeliveryRewardStrategy();

const inventoryAlertsCache = new Map();
const inventoryAlertsInflight = new Map();

const awardPointsOnce = async ({ customerId, accountType, points, order, description, session = null }) => {
    if (!getIsConnected() || !customerId || !Number.isSafeInteger(points) || points <= 0) return false;
    const orderId = order._id;
    const entryType = 'EARNED';
    const filter = {
        customerId,
        accountType,
        pointsHistory: { $not: { $elemMatch: { orderId, type: entryType } } }
    };
    try {
        const updated = await CustomerPointsLedger.findOneAndUpdate(filter, {
            $inc: { availablePointsBalance: points },
            $push: {
                pointsHistory: { type: entryType, points, orderId, description }
            }
        }, {
            upsert: true,
            new: true,
            runValidators: true,
            setDefaultsOnInsert: true,
            ...(session ? { session } : {})
        });
        return Boolean(updated);
    } catch (error) {
        if (error.code !== 11000 || session) throw error;
        const ledgerQuery = CustomerPointsLedger.findOne({ customerId, accountType });
        if (session) ledgerQuery.session(session);
        const ledger = await ledgerQuery.lean().exec();
        if (ledger?.pointsHistory?.some(entry =>
            String(entry.orderId) === String(orderId) && entry.type === entryType
        )) return false;
        throw error;
    }
};

const awardDeliveredOrderPoints = async (order, session = null) => {
    const customerPoints = Number(order.rewardPointsEarned || 0);
    const customerCredited = await awardPointsOnce({
        customerId: order.customerId || order.userId,
        accountType: 'CUSTOMER',
        points: customerPoints,
        order,
        description: 'Points earned for a completed medicine order.',
        session
    });
    const riderId = order.rider?.riderId;
    const riderPoints = deliveryRewardStrategy.getPointsForCompletedDelivery(order);
    const riderCredited = await awardPointsOnce({
        customerId: riderId,
        accountType: 'DELIVERY_PERSON',
        points: riderPoints,
        order,
        description: 'Points earned for a completed delivery.',
        session
    });
    return { customerCredited, riderCredited, riderPoints };
};

const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const calculateCompletedOrderFinance = order => {
    const revenue = Math.max(0, Number(order.finalTotal ?? order.totalAmount ?? 0));
    const totalCostPrice = (order.medicineItems || []).reduce(
        (sum, item) => sum + Number(item.baseCostPrice || 0) * Number(item.quantity || 0),
        0
    );
    const netProfit = revenue - totalCostPrice
        - Number(order.deliveryCost || 0)
        - Number(order.paymentProcessingFee || 0);

    return {
        totalRevenue: roundMoney(revenue),
        totalCostPrice: roundMoney(totalCostPrice),
        netProfit: roundMoney(netProfit),
        netMarginPercentage: revenue > 0 ? roundMoney((netProfit / revenue) * 100) : 0
    };
};

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
                const skuCode = `MED-${catGroup.code}-${item.name.replace(/[^A-Za-z0-9]/g, '').substring(0, 4).toUpperCase()}-${String(medCounter).padStart(4, '0')}-${String(vIdx + 1).padStart(2, '0')}`;
                
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
                    stockQuantity: stock,
                    reservedQuantity: 0,
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

let inMemoryMedicineRequests = [
    {
        _id: "req-10024",
        requestNumber: "MR-10024",
        customerId: "demo-customer-id",
        customerName: "Ashvin Singh",
        customerPhone: "+91 95899 16475",
        customerEmail: "customer@ashvinpharma.com",
        requestedItems: [
            {
                requestedName: "Rifaximin 550mg",
                medicineId: null,
                strength: "550mg",
                dosageForm: "Tablet",
                manufacturer: "Sun Pharma",
                quantity: 2,
                originalAvailabilityStatus: "NOT_IN_CATALOG"
            }
        ],
        prescriptionUrl: null,
        productImageUrl: null,
        customerNote: "Need urgently for post-operative regimen. Please verify if distributor can arrange.",
        deliveryAddress: "Flat 402, Greenfield Heights, Richmond Road, Bengaluru - 560025",
        addressDetails: {
            fullName: "Ashvin Singh",
            mobile: "+91 95899 16475",
            addressLine1: "Flat 402, Greenfield Heights, Richmond Road",
            city: "Bengaluru",
            state: "Karnataka",
            pincode: "560025"
        },
        coordinates: { lat: 12.9667, lng: 77.6000 },
        preferredDeliveryPreference: "Evening",
        status: "PROPOSAL_SENT",
        pharmacyProposal: {
            productId: null,
            medicineName: "Rifaximin 550mg (Strip of 10 Tablets)",
            manufacturer: "Sun Pharma (Rifagut)",
            strength: "550mg",
            dosageForm: "Tablet",
            quantity: 2,
            unitPrice: 380,
            approximatePrice: 760,
            finalPrice: 760,
            totalPrice: 760,
            priceType: "FINAL",
            pharmacyNote: "Arranged from verified distributor depot. Batch verified and ready for courier packaging.",
            deliverySlot: {
                date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
                slotType: "EVENING",
                startTime: "18:00",
                endTime: "21:00",
                label: "Tomorrow Evening, 6 PM - 9 PM"
            },
            prescriptionStatus: "Verified",
            alternativeProduct: ""
        },
        customerResponse: {
            respondedAt: null,
            responseNote: ""
        },
        reviewedBy: "Chief Pharmacist",
        reviewedAt: new Date(Date.now() - 3600000),
        proposalSentAt: new Date(Date.now() - 3600000),
        approvedAt: null,
        rejectedAt: null,
        convertedOrderId: null,
        expiresAt: new Date(Date.now() + 48 * 3600000),
        createdAt: new Date(Date.now() - 7200000),
        updatedAt: new Date(Date.now() - 3600000),
        auditTrail: [
            {
                action: "REQUEST_CREATED",
                actorId: "demo-customer-id",
                role: "Customer",
                timestamp: new Date(Date.now() - 7200000),
                notes: "Initial customer request submitted for Rifaximin 550mg"
            },
            {
                action: "REQUEST_REVIEWED",
                actorId: "Chief Pharmacist",
                role: "Pharmacist",
                timestamp: new Date(Date.now() - 4000000),
                notes: "Under pharmacist review; stock confirmed with supplier"
            },
            {
                action: "PROPOSAL_SENT",
                actorId: "Chief Pharmacist",
                role: "Pharmacist",
                timestamp: new Date(Date.now() - 3600000),
                notes: "Final price ₹760 and Evening delivery slot proposed"
            }
        ]
    }
];
let requestSequenceCounter = 10025;

const nextMedicineRequestNumber = async () => {
    if (!getIsConnected()) return `MR-${requestSequenceCounter++}`;

    const counters = mongoose.connection.db.collection('applicationCounters');
    const counterId = 'medicineRequest';
    const [latest] = await MedicineRequest.aggregate([
        { $match: { requestNumber: /^MR-\d+$/ } },
        {
            $project: {
                sequence: {
                    $convert: {
                        input: { $arrayElemAt: [{ $split: ['$requestNumber', '-'] }, 1] },
                        to: 'long',
                        onError: 0,
                        onNull: 0
                    }
                }
            }
        },
        { $group: { _id: null, sequence: { $max: '$sequence' } } }
    ]).exec();
    const highestExistingSequence = Math.max(10024, Number(latest?.sequence) || 0);

    // Repair a stale counter before incrementing it. This also handles records
    // created before the applicationCounters document was introduced.
    try {
        await counters.updateOne(
            { _id: counterId },
            { $max: { sequence: highestExistingSequence } },
            { upsert: true }
        );
    } catch (error) {
        if (error.code !== 11000) throw error;
        await counters.updateOne(
            { _id: counterId },
            { $max: { sequence: highestExistingSequence } }
        );
    }

    const result = await counters.findOneAndUpdate(
        { _id: counterId },
        { $inc: { sequence: 1 } },
        { returnDocument: 'after' }
    );
    const counter = result?.value || result;
    if (!Number.isSafeInteger(Number(counter?.sequence))) {
        throw new Error('Unable to allocate a medicine request number.');
    }
    return `MR-${counter.sequence}`;
};

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

const getPhysicalStock = (medicine) =>
    Number(medicine.stockQuantity ?? medicine.stock ?? medicine.quantity ?? 0);

const getReservedStock = (medicine) => Number(medicine.reservedQuantity || 0);

const inventoryError = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const consumeCouponUsage = async (code, session) => {
    const now = new Date();
    const coupon = await Coupon.findOneAndUpdate({
        code: String(code).trim().toUpperCase(),
        isActive: true,
        $and: [
            { $or: [{ expiryDate: null }, { expiryDate: { $exists: false } }, { expiryDate: { $gt: now } }] },
            {
                $or: [
                    { usageLimit: null },
                    { usageLimit: { $exists: false } },
                    { $expr: { $lt: ['$usageCount', '$usageLimit'] } }
                ]
            }
        ]
    }, { $inc: { usageCount: 1 } }, {
        new: true,
        runValidators: true,
        ...(session ? { session } : {})
    });
    if (!coupon) throw inventoryError('Coupon is expired, inactive, or its usage limit has been reached.', 409);
};

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

const hasValidCoordinates = (coordinates) => {
    if (coordinates?.lat == null || coordinates?.lng == null
        || String(coordinates.lat).trim() === '' || String(coordinates.lng).trim() === '') return false;
    const lat = Number(coordinates?.lat);
    const lng = Number(coordinates?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= -90 && lat <= 90
        && lng >= -180 && lng <= 180;
};

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
        coordinates: address.coordinates || existing.coordinates || null,
        isDefault: Boolean(address.isDefault ?? existing.isDefault)
    };
};

let inMemoryAuditLogs = [];
let inMemoryInventoryAudits = [];

function formatMedicine(med) {
    const obj = med.toObject ? med.toObject() : { ...med };
    const physicalStock = Number(obj.stockQuantity ?? obj.stock ?? obj.quantity ?? 0);
    const reservedStock = Number(obj.reservedQuantity || 0);
    const availableStock = Math.max(0, physicalStock - reservedStock);
    obj.stockQuantity = physicalStock;
    obj.reservedQuantity = reservedStock;
    obj.availableQuantity = availableStock;
    obj.stock = availableStock;
    obj.quantity = availableStock;
    obj.isPrescriptionRequired = Boolean(obj.isPrescriptionRequired ?? obj.requiresPrescription);
    obj.requiresPrescription = obj.isPrescriptionRequired;
    const now = new Date();
    const expiry = new Date(obj.expiryDate);
    const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 3600 * 24));
    
    obj.daysUntilExpiry = daysUntilExpiry;
    obj.isExpired = daysUntilExpiry <= 0;
    obj.isExpiringSoon = daysUntilExpiry > 0 && daysUntilExpiry <= 30;
    obj.isLowStock = availableStock <= 3;
    return obj;
}

const getOrderInventoryItems = (order) => {
    if (order.medicineItems?.length) return order.medicineItems;
    return (order.items || []).map(item => ({
        medicineId: item.medicineId || item.productId || item._id,
        quantity: item.quantity
    }));
};

const orderInventoryWasDeducted = (order) => Boolean(
    order.inventoryDeductedAt
    || order.statusHistory?.some(entry =>
        entry.newStatus === 'Dispatched'
        && entry.notes?.includes('Reserved stock deducted from inventory on dispatch.')
    )
);

const deductMongoOrderInventory = async (order) => {
    if (orderInventoryWasDeducted(order)) return;
    if (order.inventoryReservationId) {
        await inventoryClient.deduct(order.inventoryReservationId, {
            tenantId: order.tenantId, branchId: order.branchId, userId: order.userId || 'backend',
            idempotencyKey: `legacy-order-deduct:${String(order._id)}`
        });
        order.inventoryReservationStatus = 'DEDUCTED';
        order.inventoryDeductedAt = new Date();
        return;
    }
    if (order.source === 'MEDICINE_REQUEST' && !getOrderInventoryItems(order).length) {
        order.inventoryDeductedAt = new Date();
        return;
    }
    throw inventoryError(
        'This legacy order has no Inventory Service reservation reference. Manual reconciliation is required; dispatch will not mutate legacy stock.',
        409
    );
};

const deductInMemoryOrderInventory = (order) => {
    if (orderInventoryWasDeducted(order)) return;
    if (order.source === 'MEDICINE_REQUEST' && !getOrderInventoryItems(order).length) {
        order.inventoryDeductedAt = new Date();
        return;
    }
    throw inventoryError(
        'In-memory legacy orders cannot deduct pharmacy stock. Reconcile and dispatch through Inventory Service.',
        409
    );
};

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

    async getInventoryAudits(page = 1, limit = 10, { tenantId, branchId } = {}) {
        const scopeTenantId = String(tenantId || '').trim();
        const scopeBranchId = String(branchId || '').trim();
        if (!scopeTenantId || !scopeBranchId) throw inventoryError('Tenant and branch are required for inventory audit history.', 400);
        const parsedLimit = Math.min(50, Math.max(1, Number(limit) || 10));
        const parsedPage = Math.max(1, Number(page) || 1);
        const inventoryAudits = [];
        let cursor = 1;
        let pages = 1;
        do {
            const result = await inventoryClient.getAudits({
                tenantId: scopeTenantId, branchId: scopeBranchId,
                page: cursor, limit: 100, userId: 'inventory-audit-history'
            });
            inventoryAudits.push(...(result.items || []));
            pages = Number(result.pages || 1);
            cursor += 1;
        } while (cursor <= pages && cursor <= 50);
        const mappedAudits = inventoryAudits.map(entry => {
            const details = entry.details || {};
            const result = details.result || {};
            return {
                eventType: String(entry.operation || 'INVENTORY').toUpperCase(),
                importId: details.importBatchId || details.batchId || null,
                orderId: details.orderId || null,
                timestamp: entry.createdAt || entry.updatedAt || new Date(),
                sku: entry.sku || result.sku || '—',
                name: details.name || result.name || 'Inventory item',
                quantity: Number(details.quantity ?? result.stockQuantity ?? 0),
                previousStock: details.before?.stockQuantity ?? null,
                newStock: details.after?.stockQuantity ?? result.stockQuantity ?? null,
                previousPrice: details.before?.price ?? null,
                newPrice: details.after?.price ?? result.price ?? null,
                adminId: entry.actor || 'Inventory Service',
                branchId: entry.branchId,
                tenantId: entry.tenantId,
                details
            };
        });
        const deliveredOrders = getIsConnected()
            ? await Order.find({ orderStatus: 'Delivered', tenantId: scopeTenantId, branchId: scopeBranchId })
                .select('_id deliveredAt createdAt customerName statusHistory medicineItems items')
                .sort({ deliveredAt: -1, createdAt: -1 }).lean()
            : [];
        const deliveryAudits = deliveredOrders.flatMap(order => {
            const actor = order.statusHistory?.findLast?.(entry => entry.newStatus === 'Delivered')?.changedBy || 'Delivery';
            return getOrderInventoryItems(order).map(item => ({
                eventType: 'DELIVERY', importId: `ORDER-${String(order._id).slice(-8).toUpperCase()}`,
                orderId: String(order._id), timestamp: order.deliveredAt || order.createdAt,
                sku: item.sku || item.code || '—', name: item.name || item.productName || 'Medicine',
                quantity: Number(item.quantity) || 0, previousStock: null, newStock: null,
                previousPrice: Number(item.price ?? item.unitPrice) || 0,
                newPrice: Number(item.price ?? item.unitPrice) || 0, adminId: actor
            }));
        });
        const allAudits = [...mappedAudits, ...deliveryAudits, ...inMemoryInventoryAudits.filter(audit => String(audit.tenantId || '') === scopeTenantId && String(audit.branchId || '') === scopeBranchId)]
            .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
        const total = allAudits.length;
        const totalPages = Math.ceil(total / parsedLimit) || 1;
        const currentPage = Math.min(parsedPage, totalPages);
        return {
            items: allAudits.slice((currentPage - 1) * parsedLimit, currentPage * parsedLimit),
            page: currentPage, limit: parsedLimit, total, totalPages,
            hasNextPage: currentPage < totalPages, hasPreviousPage: currentPage > 1
        };
    },

    // Medicines: Supports server-side pagination & "out-of-stock only on search" logic
    async getMedicines(search = '', hideRx = false, category = 'All', sort = 'default', page = 1, limit = 16, includeOutOfStock = false, tenantId = null, branchId = null) {
        const scopeTenantId = String(tenantId || '').trim();
        const scopeBranchId = String(branchId || '').trim();
        if (!scopeTenantId || !scopeBranchId) {
            throw inventoryError('Tenant and branch are required for catalogue reads.', 400);
        }
        const result = await inventoryClient.searchProducts({
            tenantId: scopeTenantId,
            branchId: scopeBranchId,
            query: search || '',
            hideRx: hideRx === true || String(hideRx).toLowerCase() === 'true',
            category: category && category !== 'All' ? category : '',
            sort: sort || 'default',
            page: Math.max(1, Number(page) || 1),
            limit: Math.max(1, Math.min(100, Number(limit) || 16)),
            includeOutOfStock: includeOutOfStock === true || String(includeOutOfStock).toLowerCase() === 'true',
            userId: 'backend-catalogue'
        });
        return {
            medicines: result.items || [],
            total: Number(result.total || 0),
            page: Number(result.page || page || 1),
            limit: Number(result.limit || limit || 16),
            totalPages: Number(result.pages || 1),
            isSearching: Boolean(search && String(search).trim()),
            outOfStockHidden: Boolean(result.outOfStockHidden)
        };
    },

    async getInventoryAlerts(lowStockThreshold = 3, expiringThresholdDays = 30, { tenantId, branchId } = {}) {
        const scopeTenantId = String(tenantId || '').trim();
        const scopeBranchId = String(branchId || '').trim();
        if (!scopeTenantId || !scopeBranchId) {
            return {
                expiredCount: 0, expiringSoonCount: 0, lowStockCount: 0, totalAlerts: 0,
                expired: [], expiringSoon: [], lowStock: []
            };
        }

        const cacheKey = `inventory-alerts:${scopeTenantId}:${scopeBranchId}:${lowStockThreshold}:${expiringThresholdDays}`;
        const cached = inventoryAlertsCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) return cached.value;
        if (inventoryAlertsInflight.has(cacheKey)) return inventoryAlertsInflight.get(cacheKey);

        const refresh = (async () => {
            const startedAt = Date.now();
            try {
                const value = await inventoryClient.getAlertSummary({
                    tenantId: scopeTenantId,
                    branchId: scopeBranchId,
                    lowStockThreshold,
                    expiringThresholdDays,
                    userId: 'inventory-alerts'
                });
                const normalized = {
                    expiredCount: Number(value.expiredCount || 0),
                    expiringSoonCount: Number(value.expiringSoonCount || 0),
                    lowStockCount: Number(value.lowStockCount || 0),
                    totalAlerts: Number(value.totalAlerts || 0),
                    expired: Array.isArray(value.expired) ? value.expired.slice(0, 20) : [],
                    expiringSoon: Array.isArray(value.expiringSoon) ? value.expiringSoon.slice(0, 20) : [],
                    lowStock: Array.isArray(value.lowStock) ? value.lowStock.slice(0, 20) : []
                };
                inventoryAlertsCache.set(cacheKey, {
                    value: normalized,
                    expiresAt: Date.now() + 45_000,
                    staleUntil: Date.now() + 5 * 60_000
                });
                if (inventoryAlertsCache.size > 500) inventoryAlertsCache.delete(inventoryAlertsCache.keys().next().value);
                console.info('[InventoryAlerts] aggregation refresh complete', {
                    tenantId: scopeTenantId, branchId: scopeBranchId, totalAlerts: normalized.totalAlerts,
                    durationMs: Date.now() - startedAt
                });
                return normalized;
            } catch (error) {
                console.warn('[InventoryAlerts] Inventory service alert summary failed, attempting local fallback:', error?.message);
                if (cached?.value && cached.staleUntil > Date.now()) {
                    return cached.value;
                }

                try {
                    const now = new Date();
                    const expiringCutoff = new Date(Date.now() + expiringThresholdDays * 86400 * 1000);
                    const filter = {
                        ...(scopeTenantId ? { tenantId: scopeTenantId } : {}),
                        ...(scopeBranchId ? { branchId: scopeBranchId } : {}),
                        isActive: true
                    };
                    const sourceList = getIsConnected()
                        ? await Medicine.find(filter).lean()
                        : inMemoryMedicines.filter(m => (!scopeTenantId || String(m.tenantId) === scopeTenantId) && (!scopeBranchId || String(m.branchId) === scopeBranchId));

                    const expired = [];
                    const expiringSoon = [];
                    const lowStock = [];

                    for (const med of sourceList) {
                        const exp = med.expiryDate ? new Date(med.expiryDate) : null;
                        const physical = Number(med.stockQuantity ?? med.stock ?? med.quantity ?? 0);
                        const available = Math.max(0, physical - Number(med.reservedQuantity || 0));

                        if (exp && exp <= now) {
                            expired.push({ id: String(med._id || med.id), sku: med.sku || '—', name: med.name, batchNumber: med.batchNumber || '', expiryDate: med.expiryDate, availableQuantity: available });
                        } else if (exp && exp <= expiringCutoff) {
                            expiringSoon.push({ id: String(med._id || med.id), sku: med.sku || '—', name: med.name, batchNumber: med.batchNumber || '', expiryDate: med.expiryDate, availableQuantity: available });
                        }
                        if (available <= lowStockThreshold) {
                            lowStock.push({ id: String(med._id || med.id), sku: med.sku || '—', name: med.name, availableQuantity: available });
                        }
                    }

                    const fallbackNormalized = {
                        expiredCount: expired.length,
                        expiringSoonCount: expiringSoon.length,
                        lowStockCount: lowStock.length,
                        totalAlerts: expired.length + expiringSoon.length + lowStock.length,
                        expired: expired.slice(0, 20),
                        expiringSoon: expiringSoon.slice(0, 20),
                        lowStock: lowStock.slice(0, 20)
                    };
                    inventoryAlertsCache.set(cacheKey, {
                        value: fallbackNormalized,
                        expiresAt: Date.now() + 30_000,
                        staleUntil: Date.now() + 5 * 60_000
                    });
                    return fallbackNormalized;
                } catch (fallbackErr) {
                    console.error('[InventoryAlerts] Local database fallback alert calculation failed:', fallbackErr?.message);
                }

                return {
                    expiredCount: 0, expiringSoonCount: 0, lowStockCount: 0, totalAlerts: 0,
                    expired: [], expiringSoon: [], lowStock: []
                };
            }
        })();
        inventoryAlertsInflight.set(cacheKey, refresh);
        try { return await refresh; } finally { inventoryAlertsInflight.delete(cacheKey); }
    },

    async seedMedicines() {
        throw inventoryError(
            'Direct catalogue seeding is disabled. Seed or import products through the tenant- and branch-scoped Inventory Service workflow.',
            410
        );
    },

    async ensureCatalogSeeded() {
        return false;
    },

    async importExcelInventory() {
        throw inventoryError(
            'Legacy Excel stock mutation is disabled. Use the staged Inventory Service import, review and publish workflow.',
            410
        );
    },

    async createOrder(orderData, actor = 'Customer') {
        return this.reserveOrder(orderData, actor);
    },

    async reserveOrder(orderData, actor = 'Customer') {
        const selectedTenantId = String(orderData.tenantId || '').trim();
        const selectedBranchId = String(orderData.branchId || '').trim();
        if (!selectedBranchId) throw inventoryError('Select an active pharmacy branch before placing an order.', 400);
        if (!selectedTenantId) throw inventoryError('Select an active pharmacy before creating an order.', 400);
        if (!orderData.userId) throw inventoryError('An authenticated customer is required to create an order.', 401);
        if (!orderData.deliveryAddress?.trim() || !hasValidCoordinates(orderData.coordinates)) {
            throw inventoryError('A delivery address with a confirmed map pin is required to place an order.');
        }
        const requestedItems = orderData.medicineItems || orderData.items || [];
        if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
            throw inventoryError('Add at least one medicine to the order.');
        }
        const requestedPoints = Number(orderData.pointsToRedeem || 0);
        if (!Number.isSafeInteger(requestedPoints) || requestedPoints < 0) {
            throw inventoryError('Points to redeem must be a non-negative whole number.');
        }
        if (requestedPoints > 0 && !getIsConnected()) {
            throw inventoryError('Points redemption is temporarily unavailable.', 503);
        }

        const quantities = new Map();
        for (const item of requestedItems) {
            const medicineId = String(item.medicineId || item._id || item.id || '');
            const quantity = Number(item.quantity);
            const unitPrice = item.unitPrice == null ? null : Number(item.unitPrice);
            if (!medicineId || !Number.isInteger(quantity) || quantity < 1
                || (unitPrice != null && (!Number.isFinite(unitPrice) || unitPrice < 0))) {
                throw inventoryError('Each order item requires a medicineId, positive whole-number quantity and optional valid unit price.');
            }
            const existing = quantities.get(medicineId) || { quantity: 0, unitPrice: null };
            if (existing.unitPrice != null && unitPrice != null && Math.abs(existing.unitPrice - unitPrice) > 0.01) {
                throw inventoryError('Duplicate order lines for the same medicine have conflicting prices.', 409);
            }
            quantities.set(medicineId, {
                quantity: existing.quantity + quantity,
                unitPrice: unitPrice ?? existing.unitPrice
            });
        }

        const idempotencyKey = String(orderData.idempotencyKey || '').trim();
        if (idempotencyKey && idempotencyKey.length > 200) {
            throw inventoryError('Idempotency-Key must be 200 characters or fewer.', 400);
        }
        const requestFingerprint = idempotencyKey ? createHash('sha256').update(JSON.stringify({
            tenantId: selectedTenantId,
            branchId: selectedBranchId || null,
            items: [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([medicineId, item]) => ({
                medicineId, quantity: item.quantity, unitPrice: item.unitPrice
            })),
            addressId: String(orderData.addressId || ''),
            deliveryAddress: String(orderData.deliveryAddress || ''),
            coordinates: orderData.coordinates || null,
            patientPuid: String(orderData.patientPuid || ''),
            couponCode: String(orderData.couponCode || ''),
            pointsToRedeem: requestedPoints,
            prescriptionId: String(orderData.prescriptionId || ''),
            prescriptionUrl: String(orderData.prescriptionUrl || '')
        })).digest('hex') : null;

        if (idempotencyKey) {
            if (getIsConnected()) {
                const existingOrder = await Order.findOne({
                    userId: String(orderData.userId), tenantId: selectedTenantId, idempotencyKey
                }).lean();
                if (existingOrder) {
                    if (existingOrder.requestFingerprint !== requestFingerprint) {
                        throw inventoryError('This Idempotency-Key was already used for a different order.', 409);
                    }
                    return { ...existingOrder, replayed: true };
                }
            } else {
                const existingOrder = inMemoryOrders.find(order =>
                    String(order.userId) === String(orderData.userId)
                    && String(order.tenantId) === selectedTenantId
                    && order.idempotencyKey === idempotencyKey
                );
                if (existingOrder) {
                    if (existingOrder.requestFingerprint !== requestFingerprint) {
                        throw inventoryError('This Idempotency-Key was already used for a different order.', 409);
                    }
                    return { ...existingOrder, replayed: true };
                }
            }
        }

        if (!getIsConnected()) throw inventoryError('Order persistence is unavailable. No order was created.', 503);
        if (!inventoryClient.isConfigured()) throw inventoryError('Inventory Service is unavailable. No order was created.', 503);
        const productIds = [...quantities.keys()];
        if (productIds.some(id => !mongoose.isValidObjectId(id))) {
            throw inventoryError('Every order item must reference a valid medicine in the selected pharmacy catalogue.', 400);
        }
        const catalog = await inventoryClient.lookup({
            productIds, tenantId: selectedTenantId, branchId: selectedBranchId, userId: orderData.userId
        });
        const productsById = new Map((catalog.items || []).map(item => [String(item.productId), item]));
        if (productsById.size !== productIds.length) {
            throw inventoryError('One or more medicines are not available in the selected pharmacy branch.', 404);
        }
        const medicineItemsForOrder = [];
        const itemSnapshotsForOrder = [];
        let totalAmountForOrder = 0;
        let prescriptionRequiredForOrder = false;
        for (const [medicineId, requested] of quantities) {
            const quantity = requested.quantity;
            const product = productsById.get(medicineId);
            if (!product) throw inventoryError('The selected pharmacy does not have this medicine in its branch catalogue.', 404);
            if (Number(product.availableQuantity || 0) < quantity) {
                throw inventoryError(`Insufficient available stock for ${product.name}.`, 409);
            }
            const requiresPrescription = Boolean(product.requiresPrescription);
            prescriptionRequiredForOrder ||= requiresPrescription;
            if (requiresPrescription && !orderData.prescriptionUrl) {
                throw inventoryError(`A prescription is required for ${product.name}.`);
            }
            const catalogPrice = Number(product.price);
            if (!Number.isFinite(catalogPrice) || catalogPrice < 0) throw inventoryError(`Invalid catalogue price for ${product.name}.`, 409);
            const configuredDiscount = Math.min(100, Math.max(0, Number(product.discountPercentage || 0)));
            const expectedUnitPrice = Math.round(catalogPrice * (1 - configuredDiscount / 100) * 100) / 100;
            if (requested.unitPrice != null && Math.abs(requested.unitPrice - expectedUnitPrice) > 0.01) {
                throw inventoryError('The selected catalogue price has changed. Refresh the fulfilment options before confirming.', 409);
            }
            const basePrice = catalogPrice;
            const salePrice = requested.unitPrice != null ? Number(requested.unitPrice) : expectedUnitPrice;
            const discountPercentage = basePrice > 0 ? Math.round((1 - salePrice / basePrice) * 10000) / 100 : 0;
            const rawCost = Number(product.baseCostPrice);
            const baseCostPrice = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : catalogPrice;
            const marginTier = ['LOW', 'MID', 'HIGH'].includes(product.marginTier) ? product.marginTier : 'LOW';
            const productObjectId = new mongoose.Types.ObjectId(medicineId);
            totalAmountForOrder += salePrice * quantity;
            medicineItemsForOrder.push({
                medicineId: productObjectId, quantity, price: salePrice, basePrice,
                baseCostPrice, discountPercentage, marginTier,
                name: product.name, sku: product.sku || ''
            });
            itemSnapshotsForOrder.push({
                _id: medicineId, medicineId: productObjectId, name: product.name,
                sku: product.sku || '', price: salePrice, basePrice,
                baseCostPrice, discountPercentage, marginTier, quantity,
                stock: Math.max(0, Number(product.availableQuantity || 0) - quantity)
            });
        }
        const orderId = new mongoose.Types.ObjectId();
        const inventoryReservation = await inventoryClient.reserve({
            orderId: orderId.toString(),
            items: medicineItemsForOrder.map(item => ({ productId: String(item.medicineId), quantity: item.quantity })),
            tenantId: selectedTenantId,
            branchId: selectedBranchId,
            userId: orderData.userId,
            idempotencyKey: `legacy-order-reservation:${orderId.toString()}`
        });
        if (inventoryReservation.status !== 'RESERVED' || !inventoryReservation.reservationId) {
            throw inventoryError('Inventory could not reserve the requested medicines. Refresh stock and retry.', 409);
        }

        const now = new Date();
        const statusEntry = {
            previousStatus: null,
            newStatus: 'Pending_Review',
            changedBy: actor,
            timestamp: now,
            notes: 'Stock reserved; order is awaiting pharmacist review.'
        };

        if (getIsConnected()) {
            let session;
            let createdOrder;
            try {
                session = await mongoose.startSession();
                await session.withTransaction(async () => {
                    const activeTenant = await Tenant.findOne({ _id: selectedTenantId, status: 'ACTIVE' }).select('_id settings.allowOfferWithCoupon settings.allowOfferWithRewards').session(session).lean();
                    if (!activeTenant) throw inventoryError('The selected pharmacy is not active.', 404);
                    const medicineItems = medicineItemsForOrder.map(item => ({ ...item }));
                    const itemSnapshots = itemSnapshotsForOrder.map(item => ({ ...item }));
                    let totalAmount = totalAmountForOrder;
                    let prescriptionRequired = prescriptionRequiredForOrder;

                    let surplusDiscountApplied = 0;
                    const appliedSurplusCampaigns = [];
                    const campaignUsage = new Map();
                    const activeCampaigns = await SurplusSavingsCampaign.find({
                        tenantId: selectedTenantId,
                        status: 'ACTIVE',
                        startsAt: { $lte: now },
                        endsAt: { $gt: now },
                        medicineIds: { $in: medicineItems.map(item => item.medicineId) }
                    }).session(session).lean();
                    const priorRedemptions = activeCampaigns.length
                        ? await SurplusSavingsRedemption.find({
                            tenantId: selectedTenantId,
                            campaignId: { $in: activeCampaigns.map(campaign => campaign._id) },
                            customerId: String(orderData.userId)
                        }).session(session).select('campaignId').lean()
                        : [];
                    const alreadyRedeemed = new Set(priorRedemptions.map(item => String(item.campaignId)));
                    for (const item of medicineItems) {
                        const candidates = activeCampaigns.filter(campaign =>
                            campaign.medicineIds.some(id => String(id) === String(item.medicineId))
                            && Number(totalAmount) >= Number(campaign.minOrderAmount || 0)
                            && (campaign.usageLimit == null || Number(campaign.usageCount || 0) < Number(campaign.usageLimit))
                            && !alreadyRedeemed.has(String(campaign._id))
                        ).map(campaign => {
                            const used = campaignUsage.get(String(campaign._id)) || 0;
                            const discount = calculateSurplusUnitDiscount(item.price, campaign, used, item.quantity);
                            return { campaign, discount };
                        }).filter(candidate => candidate.discount > 0)
                          .sort((a, b) => b.discount - a.discount);
                        if (!candidates.length) continue;
                        const { campaign, discount } = candidates[0];
                        const itemSavings = roundCurrency(discount * Number(item.quantity));
                        const campaignId = String(campaign._id);
                        const itemSnapshot = itemSnapshots.find(snapshot => String(snapshot.medicineId) === String(item.medicineId));
                        item.price = Math.max(0, Math.round((Number(item.price) - discount) * 100) / 100);
                        item.surplusSavingsCampaignId = campaign._id;
                        item.surplusSavingsDiscount = itemSavings;
                        if (itemSnapshot) {
                            itemSnapshot.price = item.price;
                            itemSnapshot.surplusSavingsCampaignId = campaign._id;
                            itemSnapshot.surplusSavingsDiscount = itemSavings;
                            itemSnapshot.originalPrice = Number(itemSnapshot.originalPrice || (item.price + discount));
                        }
                        surplusDiscountApplied += itemSavings;
                        campaignUsage.set(campaignId, (campaignUsage.get(campaignId) || 0) + itemSavings);
                    }
                    for (const [campaignId, discountAmount] of campaignUsage.entries()) {
                        const campaign = activeCampaigns.find(item => String(item._id) === campaignId);
                        if (!campaign) continue;
                        const claimed = await SurplusSavingsCampaign.findOneAndUpdate({
                            _id: campaign._id,
                            tenantId: selectedTenantId,
                            status: 'ACTIVE',
                            startsAt: { $lte: now },
                            endsAt: { $gt: now },
                            $or: [{ usageLimit: null }, { $expr: { $lt: ['$usageCount', '$usageLimit'] } }]
                        }, { $inc: { usageCount: 1 } }, { new: true, session });
                        if (!claimed) throw inventoryError('A selected surplus offer has just reached its usage limit. Please retry checkout.', 409);
                        appliedSurplusCampaigns.push({
                            campaignId: campaign._id,
                            name: campaign.name,
                            discountAmount
                        });
                    }
                    const couponBaseTotal = Math.max(0, totalAmount - surplusDiscountApplied);
                    const coupon = await this.validateCoupon(orderData.couponCode || '', couponBaseTotal, { customerId: orderData.userId, tenantId: selectedTenantId });
                    if (!coupon.valid) throw inventoryError(coupon.message || 'Coupon is invalid.');
                    if (surplusDiscountApplied > 0 && coupon.code) {
                        if (activeTenant?.settings?.allowOfferWithCoupon !== true) {
                            throw inventoryError('This pharmacy does not allow surplus savings to be combined with coupons.', 409);
                        }
                    }
                    const couponDiscountApplied = Number(coupon.discountAmount
                        ?? (couponBaseTotal * (coupon.discountPercentage || 0) / 100));
                    const discountApplied = surplusDiscountApplied + couponDiscountApplied;
                    const couponRate = couponBaseTotal > 0 ? couponDiscountApplied / couponBaseTotal : 0;
                    const rewardItems = medicineItems.map(item => ({
                        currentPrice: item.price * (1 - couponRate),
                        baseCostPrice: item.baseCostPrice,
                        marginTier: item.marginTier,
                        quantity: item.quantity,
                        isDiscounted: couponRate > 0 || Number(item.discountPercentage || 0) > 0 || Number(item.surplusSavingsDiscount || 0) > 0
                    }));
                    const earnedPoints = profitMarginRewardEngine.calculateEarnedPoints(rewardItems);
                    let allowedPoints = 0;
                    let pointsDiscount = 0;
                    let redemptionWarning = null;
                    if (surplusDiscountApplied > 0 && requestedPoints > 0 && activeTenant?.settings?.allowOfferWithRewards !== true) {
                        throw inventoryError('This pharmacy does not allow Surplus Savings to be combined with reward points.', 409);
                    }
                    if (requestedPoints > 0) {
                        const ledger = await CustomerPointsLedger.findOne({
                            customerId: orderData.userId,
                            accountType: 'CUSTOMER'
                        }).session(session);
                        const availablePoints = ledger?.availablePointsBalance || 0;
                        const redemption = profitMarginRewardEngine.validateRedemptionEligibility(
                            rewardItems,
                            requestedPoints,
                            availablePoints
                        );
                        if (redemption.eligible) {
                            allowedPoints = redemption.allowedPoints;
                            pointsDiscount = redemption.allowedDiscountAmount;
                            redemptionWarning = redemption.reason;
                            if (allowedPoints > 0) {
                                const updatedLedger = await CustomerPointsLedger.findOneAndUpdate({
                                    _id: ledger._id,
                                    availablePointsBalance: { $gte: allowedPoints }
                                }, {
                                    $inc: { availablePointsBalance: -allowedPoints },
                                    $push: {
                                        pointsHistory: {
                                            type: 'REDEEMED',
                                            points: allowedPoints,
                                            orderId,
                                            description: 'Points redeemed at checkout.'
                                        }
                                    }
                                }, { new: true, session, runValidators: true });
                                if (!updatedLedger) {
                                    throw inventoryError('Points balance changed during checkout. Please retry.', 409);
                                }
                            }
                        } else {
                            redemptionWarning = redemption.reason;
                        }
                    }
                    const finalTotal = Math.max(
                        0,
                        Math.round((totalAmount - discountApplied - pointsDiscount) * 10) / 10
                    );

                    if (coupon.code) {
                        await consumeCouponUsage(coupon.code, session);
                    }
                    if (appliedSurplusCampaigns.length) {
                        await SurplusSavingsRedemption.create(appliedSurplusCampaigns.map(campaign => ({
                            campaignId: campaign.campaignId,
                            tenantId: selectedTenantId,
                            customerId: String(orderData.userId),
                            orderId,
                            discountAmount: campaign.discountAmount
                        })), { session });
                    }
                    const [order] = await Order.create([{
                        _id: orderId,
                        userId: orderData.userId,
                        customerId: orderData.userId,
                        tenantId: selectedTenantId,
                        branchId: orderData.branchId || null,
                        inventoryReservationId: inventoryReservation.reservationId,
                        inventoryReservationStatus: 'RESERVED',
                        addressId: orderData.addressId || null,
                        customerName: orderData.customerName,
                        orderedByName: orderData.customerName || 'Valued Customer',
                        orderedForName: orderData.orderedForName || orderData.customerName || 'Valued Customer',
                        orderedForRelationship: orderData.orderedForRelationship || 'SELF',
                        patientPuid: orderData.patientPuid || null,
                        customerMobile: orderData.customerMobile || orderData.addressDetails?.mobile || orderData.addressDetails?.phone || '',
                        medicineItems,
                        items: itemSnapshots,
                        prescriptionUrl: orderData.prescriptionUrl || null,
                        prescriptionId: orderData.prescriptionId || null,
                        prescriptionRequired,
                        couponCode: coupon.code || orderData.couponCode || null,
                        subtotal: totalAmount,
                        discountApplied,
                        surplusSavingsDiscountApplied: surplusDiscountApplied,
                        surplusSavings: {
                            campaignIds: appliedSurplusCampaigns.map(campaign => campaign.campaignId),
                            campaigns: appliedSurplusCampaigns,
                            discountAmount: surplusDiscountApplied
                        },
                        pointsRedeemed: allowedPoints,
                        rewardPointsEarned: earnedPoints.pointsToAssign,
                        pointsDiscountApplied: pointsDiscount,
                        rewardMetrics: {
                            totalRevenue: earnedPoints.totalRevenue,
                            totalCostPrice: earnedPoints.totalCostPrice,
                            netProfit: earnedPoints.netProfit - pointsDiscount,
                            netMarginPercentage: earnedPoints.totalRevenue > 0
                                ? ((earnedPoints.netProfit - pointsDiscount) / earnedPoints.totalRevenue) * 100
                                : 0
                        },
                        totalAmount: finalTotal,
                        finalTotal,
                        deliveryAddress: orderData.deliveryAddress,
                        addressDetails: orderData.addressDetails || {},
                        coordinates: orderData.coordinates,
                        paymentMethod: orderData.paymentMethod || 'Cash on Delivery (COD)',
                        source: orderData.source || 'DIRECT',
                        medicineRequestId: orderData.medicineRequestId ? String(orderData.medicineRequestId) : null,
                        fulfillmentCaseId: orderData.fulfillmentCaseId ? String(orderData.fulfillmentCaseId) : null,
                        parentOrderId: orderData.parentOrderId ? String(orderData.parentOrderId) : null,
                        fulfillmentState: orderData.fulfillmentState || (orderData.fulfillmentCaseId ? 'PARTIAL' : 'FULL'),
                        idempotencyKey: idempotencyKey || null,
                        requestFingerprint: requestFingerprint || null,
                        fulfillmentConfirmationId: orderData.fulfillmentConfirmationId || undefined,
                        orderStatus: 'Pending_Review',
                        statusHistory: [statusEntry]
                    }], { session });
                    createdOrder = order.toObject({ virtuals: true });
                    createdOrder.rewardNotice = redemptionWarning;
                });
            } catch (error) {
                try {
                    await inventoryClient.release(inventoryReservation.reservationId, {
                        tenantId: selectedTenantId, branchId: selectedBranchId, userId: orderData.userId,
                        idempotencyKey: `legacy-order-release-after-create-failure:${orderId.toString()}`
                    });
                } catch (releaseError) {
                    console.error('Order creation failed and Inventory reservation release also failed:', {
                        orderId: orderId.toString(), reservationId: inventoryReservation.reservationId,
                        error: releaseError.message
                    });
                }
                throw error;
            } finally {
                if (session) await session.endSession();
            }

            this.logAudit(actor, 'ORDER_CREATED', 'ORDER', createdOrder._id.toString(), {
                totalAmount: createdOrder.totalAmount,
                itemCount: createdOrder.medicineItems.length,
                inventoryAction: 'RESERVED'
            });
            domainEvents.emitDomainEvent('ORDER_CREATED', createdOrder._id.toString(), {
                orderNumber: createdOrder.orderNumber || createdOrder._id.toString(),
                customerUserId: createdOrder.userId || orderData.userId || null,
                customerId: createdOrder.customerId || orderData.customerId || null,
                totalAmount: createdOrder.totalAmount,
                status: createdOrder.orderStatus || 'Pending_Review'
            }, actor, createdOrder.tenantId || orderData.tenantId || null, createdOrder.branchId || orderData.branchId || null);
            return createdOrder;
        }

        const reservedMedicines = [];
        try {
            const medicineItems = [];
            const itemSnapshots = [];
            let totalAmount = 0;
            let prescriptionRequired = false;

            for (const [medicineId, requested] of quantities) {
                const quantity = requested.quantity;
                const medicine = inMemoryMedicines.find(item => String(item._id) === medicineId
                    && String(item.tenantId || '') === selectedTenantId
                    && (orderData.branchScopeExplicit ? String(item.branchId || '') === String(selectedBranchId || '') : (!selectedBranchId || String(item.branchId || '') === selectedBranchId)));
                if (!medicine) throw inventoryError(`Medicine ${medicineId} was not found.`, 404);
                if (medicine.expiryDate && new Date(medicine.expiryDate) <= now) {
                    throw inventoryError(`${medicine.name} is expired and cannot be ordered.`);
                }
                const medicineRequiresPrescription = Boolean(medicine.isPrescriptionRequired ?? medicine.requiresPrescription);
                prescriptionRequired ||= medicineRequiresPrescription;
                if (medicineRequiresPrescription && !orderData.prescriptionUrl) {
                    throw inventoryError(`A prescription is required for ${medicine.name}.`);
                }

                const physicalStock = getPhysicalStock(medicine);
                const currentReserved = getReservedStock(medicine);
                const available = physicalStock - currentReserved;
                if (available < quantity) {
                    throw inventoryError(`Insufficient available stock for ${medicine.name}.`, 409);
                }

                medicine.stockQuantity = physicalStock;
                medicine.reservedQuantity = currentReserved + quantity;
                reservedMedicines.push({ medicine, quantity });
                const catalogPrice = Number(medicine.price);
                const basePrice = Math.max(catalogPrice, Number(medicine.basePrice ?? catalogPrice));
                const discountPercentage = basePrice > catalogPrice
                    ? roundCurrency((1 - catalogPrice / basePrice) * 100)
                    : Math.min(100, Math.max(0, Number(medicine.discountPercentage || 0)));
                if (requested.unitPrice != null && Math.abs(requested.unitPrice - catalogPrice) > 0.01) {
                    throw inventoryError('The selected catalogue price has changed. Refresh the fulfilment options before confirming.', 409);
                }
                const price = requested.unitPrice == null ? catalogPrice : catalogPrice;
                totalAmount += price * quantity;
                medicineItems.push({
                    medicineId,
                    quantity,
                    price,
                    basePrice,
                    baseCostPrice: Number(medicine.baseCostPrice ?? price),
                    discountPercentage,
                    marginTier: ['LOW', 'MID', 'HIGH'].includes(medicine.marginTier) ? medicine.marginTier : 'LOW',
                    name: medicine.name,
                    sku: medicine.sku || medicine.code || ''
                });
                itemSnapshots.push({
                    _id: medicineId,
                    medicineId,
                    name: medicine.name,
                    sku: medicine.sku || medicine.code || '',
                    price,
                    basePrice,
                    baseCostPrice: Number(medicine.baseCostPrice ?? price),
                    discountPercentage,
                    marginTier: ['LOW', 'MID', 'HIGH'].includes(medicine.marginTier) ? medicine.marginTier : 'LOW',
                    quantity,
                    stock: available - quantity
                });
            }

            const coupon = await this.validateCoupon(orderData.couponCode || '', totalAmount, { customerId: orderData.userId, tenantId: orderData.tenantId });
            if (!coupon.valid) throw inventoryError(coupon.message || 'Coupon is invalid.');
            const discountApplied = Number(coupon.discountAmount
                ?? (totalAmount * (coupon.discountPercentage || 0) / 100));
            const finalTotal = Math.max(0, Math.round((totalAmount - discountApplied) * 10) / 10);

            const order = {
                _id: new mongoose.Types.ObjectId().toString(),
                userId: orderData.userId,
                customerId: orderData.userId,
                tenantId: selectedTenantId,
                branchId: orderData.branchId || null,
                customerName: orderData.customerName,
                orderedByName: orderData.customerName || 'Valued Customer',
                orderedForName: orderData.orderedForName || orderData.customerName || 'Valued Customer',
                patientPuid: orderData.patientPuid || null,
                customerMobile: orderData.customerMobile || orderData.addressDetails?.mobile || orderData.addressDetails?.phone || '',
                medicineItems,
                items: itemSnapshots,
                prescriptionUrl: orderData.prescriptionUrl || null,
                prescriptionRequired,
                couponCode: coupon.code || orderData.couponCode || null,
                subtotal: totalAmount,
                discountApplied,
                totalAmount: finalTotal,
                finalTotal,
                deliveryAddress: orderData.deliveryAddress,
                addressDetails: orderData.addressDetails || {},
                coordinates: orderData.coordinates,
                paymentMethod: orderData.paymentMethod || 'Cash on Delivery (COD)',
                source: orderData.source || 'DIRECT',
                medicineRequestId: orderData.medicineRequestId ? String(orderData.medicineRequestId) : null,
                fulfillmentCaseId: orderData.fulfillmentCaseId ? String(orderData.fulfillmentCaseId) : null,
                parentOrderId: orderData.parentOrderId ? String(orderData.parentOrderId) : null,
                fulfillmentState: orderData.fulfillmentState || (orderData.fulfillmentCaseId ? 'PARTIAL' : 'FULL'),
                idempotencyKey: idempotencyKey || null,
                requestFingerprint: requestFingerprint || null,
                fulfillmentConfirmationId: orderData.fulfillmentConfirmationId || null,
                orderStatus: 'Pending_Review',
                statusHistory: [statusEntry],
                createdAt: now,
                updatedAt: now
            };
            if (coupon.code) {
                const couponRecord = inMemoryCoupons.find(record =>
                    record.code === String(coupon.code).trim().toUpperCase() && record.isActive
                );
                if (couponRecord?.usageLimit != null
                    && Number(couponRecord.usageCount || 0) >= Number(couponRecord.usageLimit)) {
                    throw inventoryError('Coupon usage limit has been reached.', 409);
                }
                if (couponRecord) couponRecord.usageCount = Number(couponRecord.usageCount || 0) + 1;
            }
            inMemoryOrders.unshift(order);
            this.logAudit(actor, 'ORDER_CREATED', 'ORDER', order._id, {
                totalAmount,
                itemCount: medicineItems.length,
                inventoryAction: 'RESERVED'
            });
            domainEvents.emitDomainEvent('ORDER_CREATED', String(order._id), {
                orderNumber: order.orderNumber || String(order._id),
                customerUserId: order.userId || orderData.userId || null,
                customerId: order.customerId || orderData.customerId || null,
                totalAmount: order.totalAmount,
                status: order.orderStatus || 'Pending_Review'
            }, actor, order.tenantId || orderData.tenantId || null, order.branchId || orderData.branchId || null);
            return order;
        } catch (error) {
            for (const { medicine, quantity } of reservedMedicines) {
                medicine.reservedQuantity = Math.max(0, getReservedStock(medicine) - quantity);
            }
            throw error;
        }
    },

    async reviewOrder(orderId, decision, actor = 'Admin') {
        const status = decision === 'approve' ? 'Approved' : 'Rejected';
        if (getIsConnected()) {
            if (!mongoose.isValidObjectId(orderId)) throw inventoryError('Invalid order ID.');
            const session = await mongoose.startSession();
            let reviewedOrder;
            try {
                await session.withTransaction(async () => {
                    const order = await Order.findById(orderId).session(session);
                    if (!order) throw inventoryError('Order not found.', 404);
                    if (order.orderStatus !== 'Pending_Review') {
                        throw inventoryError(`Only Pending_Review orders can be reviewed. Current status: ${order.orderStatus}`, 409);
                    }
                    if (status === 'Approved' && order.prescriptionRequired && !order.prescriptionUrl) {
                        throw inventoryError('This order requires an attached prescription before approval.', 409);
                    }

                    if (status === 'Rejected' && order.inventoryReservationId) {
                        await inventoryClient.release(order.inventoryReservationId, {
                            tenantId: order.tenantId, branchId: order.branchId, userId: order.userId || 'backend',
                            idempotencyKey: `legacy-order-release-rejected:${String(order._id)}`
                        });
                        order.inventoryReservationStatus = 'RELEASED';
                    } else if (status === 'Rejected') {
                        throw inventoryError(
                            'This legacy order has no Inventory Service reservation reference. Manual reconciliation is required; legacy stock will not be changed.',
                            409
                        );
                    }

                    order.orderStatus = status;
                    order.statusHistory.push({
                        previousStatus: 'Pending_Review',
                        newStatus: status,
                        changedBy: actor,
                        timestamp: new Date(),
                        notes: status === 'Rejected' ? 'Prescription rejected; reserved inventory released.' : 'Prescription reviewed and approved.'
                    });
                    await order.save({ session });
                    reviewedOrder = order.toObject({ virtuals: true });
                });
            } finally {
                await session.endSession();
            }
            return reviewedOrder;
        }

        const order = inMemoryOrders.find(item => String(item._id) === String(orderId));
        if (!order) throw inventoryError('Order not found.', 404);
        if (order.orderStatus !== 'Pending_Review') {
            throw inventoryError(`Only Pending_Review orders can be reviewed. Current status: ${order.orderStatus}`, 409);
        }
        if (status === 'Approved' && order.prescriptionRequired && !order.prescriptionUrl) {
            throw inventoryError('This order requires an attached prescription before approval.', 409);
        }
        if (status === 'Rejected') {
            throw inventoryError(
                'Legacy in-memory orders cannot change pharmacy stock. Reconcile the order through Inventory Service.',
                409
            );
        }
        order.orderStatus = status;
        order.statusHistory.push({
            previousStatus: 'Pending_Review',
            newStatus: status,
            changedBy: actor,
            timestamp: new Date(),
            notes: status === 'Rejected' ? 'Prescription rejected; reserved inventory released.' : 'Prescription reviewed and approved.'
        });
        return order;
    },

    async updateCustomerOrder(orderId, customerId) {
        if (!customerId) throw inventoryError('Customer authentication is required.', 401);
        if (getIsConnected()) {
            if (!mongoose.isValidObjectId(orderId)) throw inventoryError('Invalid order ID.');
            const order = await Order.findById(orderId).lean();
            if (!order) throw inventoryError('Order not found.', 404);
            if (order.userId !== customerId && order.customerId !== customerId) {
                throw inventoryError('You are not authorized to modify this order.', 403);
            }
            throw inventoryError('Placed orders cannot be modified. Cancel the order and place a new one if needed.', 409);
        }

        const order = inMemoryOrders.find(item => String(item._id) === String(orderId));
        if (!order) throw inventoryError('Order not found.', 404);
        if (order.userId !== customerId && order.customerId !== customerId) {
            throw inventoryError('You are not authorized to modify this order.', 403);
        }
        throw inventoryError('Placed orders cannot be modified. Cancel the order and place a new one if needed.', 409);
    },

    async cancelOrder(orderId, actor = 'Customer', customerId = null) {
        if (getIsConnected()) {
            if (!mongoose.isValidObjectId(orderId)) throw inventoryError('Invalid order ID.');
            const session = await mongoose.startSession();
            let cancelledOrder;
            try {
                await session.withTransaction(async () => {
                    const order = await Order.findById(orderId).session(session);
                    if (!order) throw inventoryError('Order not found.', 404);
                    if (!customerId || (order.userId !== customerId && order.customerId !== customerId)) {
                        throw inventoryError('You are not authorized to cancel this order.', 403);
                    }
                    if (!['Pending_Review', 'Approved', 'Processing Order', 'Ready to Dispatch'].includes(order.orderStatus)) {
                        throw inventoryError('Only orders that have not been dispatched can be cancelled.', 409);
                    }

                    if (!order.inventoryReservationId) {
                        throw inventoryError(
                            'This legacy order has no Inventory Service reservation reference. Manual reconciliation is required; cancellation will not mutate legacy stock.',
                            409
                        );
                    }
                    await inventoryClient.release(order.inventoryReservationId, {
                        tenantId: order.tenantId, branchId: order.branchId, userId: order.userId || 'backend',
                        idempotencyKey: `legacy-order-release-cancel:${String(order._id)}`
                    });
                    order.inventoryReservationStatus = 'RELEASED';

                    order.orderStatus = 'Cancelled';
                    order.statusHistory.push({
                        previousStatus: order.statusHistory.at(-1)?.newStatus || 'Pending_Review',
                        newStatus: 'Cancelled',
                        changedBy: actor,
                        timestamp: new Date(),
                        notes: 'Order cancelled; Inventory Service reservation released.'
                    });
                    await order.save({ session });
                    cancelledOrder = order.toObject({ virtuals: true });
                });
            } finally {
                await session.endSession();
            }
            return cancelledOrder;
        }

        const order = inMemoryOrders.find(item => String(item._id) === String(orderId));
        if (!order) throw inventoryError('Order not found.', 404);
        if (!customerId || (order.userId !== customerId && order.customerId !== customerId)) {
            throw inventoryError('You are not authorized to cancel this order.', 403);
        }
        if (!['Pending_Review', 'Approved', 'Processing Order', 'Ready to Dispatch'].includes(order.orderStatus)) {
            throw inventoryError('Only orders that have not been dispatched can be cancelled.', 409);
        }
        throw inventoryError(
            'Legacy in-memory orders cannot change pharmacy stock. Reconcile the order through Inventory Service.',
            409
        );
    },

    async dispatchOrder(orderId, actor = 'Admin', riderInfo = null) {
        if (getIsConnected()) {
            if (!mongoose.isValidObjectId(orderId)) throw inventoryError('Invalid order ID.');
            const session = await mongoose.startSession();
            let dispatchedOrder;
            try {
                await session.withTransaction(async () => {
                    const order = await Order.findById(orderId).session(session);
                    if (!order) throw inventoryError('Order not found.', 404);
                    if (order.orderStatus !== 'Approved') {
                        throw inventoryError(`Only Approved orders can be dispatched. Current status: ${order.orderStatus}`, 409);
                    }

                    await deductMongoOrderInventory(order, session);

                    const transitionAt = new Date();
                    if (riderInfo) {
                        order.rider = {
                            riderId: riderInfo.riderId || `r-${Date.now()}`,
                            riderName: riderInfo.riderName || 'Assigned Courier',
                            riderMobile: riderInfo.riderMobile || '',
                            assignedAt: transitionAt
                        };
                        order.deliveryPersonMobile = riderInfo.riderMobile || '';
                    }
                    order.orderStatus = 'Dispatched';
                    order.outForDeliveryAt = transitionAt;
                    order.statusHistory.push({
                        previousStatus: 'Approved',
                        newStatus: 'Dispatched',
                        changedBy: actor,
                        timestamp: transitionAt,
                        notes: 'Reserved stock deducted from inventory on dispatch.'
                    });
                    await order.save({ session });
                    dispatchedOrder = order.toObject({ virtuals: true });
                });
            } finally {
                await session.endSession();
            }
            return dispatchedOrder;
        }

        const order = inMemoryOrders.find(item => String(item._id) === String(orderId));
        if (!order) throw inventoryError('Order not found.', 404);
        if (order.orderStatus !== 'Approved') {
            throw inventoryError(`Only Approved orders can be dispatched. Current status: ${order.orderStatus}`, 409);
        }
        deductInMemoryOrderInventory(order);
        const transitionAt = new Date();
        if (riderInfo) {
            order.rider = {
                riderId: riderInfo.riderId || `r-${Date.now()}`,
                riderName: riderInfo.riderName || 'Assigned Courier',
                riderMobile: riderInfo.riderMobile || '',
                assignedAt: transitionAt
            };
            order.deliveryPersonMobile = riderInfo.riderMobile || '';
        }
        order.orderStatus = 'Dispatched';
        order.outForDeliveryAt = transitionAt;
        order.statusHistory.push({
            previousStatus: 'Approved',
            newStatus: 'Dispatched',
            changedBy: actor,
            timestamp: transitionAt,
            notes: 'Reserved stock deducted from inventory on dispatch.'
        });
        return order;
    },

    async getAllOrders(options = {}) {
        const criteria = typeof options === 'string' ? { orderStatus: options } : (options || {});
        const filter = {};
        for (const key of ['tenantId', 'branchId', 'userId', 'customerId', 'orderStatus', 'assignmentType']) {
            if (criteria[key] !== undefined && criteria[key] !== null && criteria[key] !== '') {
                filter[key] = String(criteria[key]);
            }
        }
        if (criteria.assignedRiderId) filter['rider.riderId'] = String(criteria.assignedRiderId);
        if (criteria.from || criteria.to) {
            const from = criteria.from ? new Date(criteria.from) : null;
            const to = criteria.to ? new Date(criteria.to) : null;
            if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))) {
                throw new Error('Invalid order date range.');
            }
            filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
        }
        const limit = Number.isFinite(Number(criteria.limit)) && Number(criteria.limit) > 0
            ? Math.min(500, Math.floor(Number(criteria.limit))) : null;
        const skip = Number.isFinite(Number(criteria.skip)) && Number(criteria.skip) > 0
            ? Math.floor(Number(criteria.skip)) : 0;
        if (getIsConnected()) {
            let query = Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip);
            if (limit) query = query.limit(limit);
            if (criteria.select) query = query.select(criteria.select);
            return query.lean();
        }
        let orders = inMemoryOrders.filter(order =>
            Object.entries(filter).every(([key, value]) => {
                if (key === 'rider.riderId') return String(order.rider?.riderId || '') === value;
                if (key === 'createdAt') {
                    const createdAt = new Date(order.createdAt);
                    return (!value.$gte || createdAt >= value.$gte) && (!value.$lte || createdAt <= value.$lte);
                }
                return String(order[key] ?? '') === value;
            })
        ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)
            || String(b._id || b.id).localeCompare(String(a._id || a.id)));
        if (skip) orders = orders.slice(skip);
        if (limit) orders = orders.slice(0, limit);
        return orders;
    },

    async getDeliveredOrdersPage(page = 1, limit = 10, { startDate = null, endDate = null, tenantId = null } = {}) {
        const deliveredStatuses = [
            'Delivered', 'delivered', 'DELIVERED',
            'Completed', 'completed', 'COMPLETED',
            'Delivered_Order', 'delivered_order', 'DELIVERED_ORDER'
        ];
        const deliveredStatusSet = new Set(deliveredStatuses.map(status => status.toLowerCase()));
        const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
        const requestedPage = Math.max(1, Number(page) || 1);
        const statusMissing = {
            $or: [
                { orderStatus: { $exists: false } },
                { orderStatus: null },
                { orderStatus: '' }
            ]
        };
        let filter = {
            $or: [
                { orderStatus: { $in: deliveredStatuses } },
                { $and: [statusMissing, { status: { $in: deliveredStatuses } }] }
            ]
        };

        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;
        const hasValidStart = start && Number.isFinite(start.getTime());
        const hasValidEnd = end && Number.isFinite(end.getTime());
        if (hasValidStart || hasValidEnd) {
            filter.createdAt = {
                ...(hasValidStart ? { $gte: start } : {}),
                ...(hasValidEnd ? { $lt: end } : {})
            };
        }

        if (getIsConnected()) {
            if (tenantId) filter = { $and: [filter, { tenantId: String(tenantId) }] };
            const total = await Order.countDocuments(filter);
            const safePage = Math.min(requestedPage, Math.max(Math.ceil(total / safeLimit), 1));
            const items = await Order.find(filter)
                .sort({ createdAt: -1, _id: -1 })
                .skip((safePage - 1) * safeLimit)
                .limit(safeLimit)
                .lean();
            return { items, total, page: safePage };
        }

        const delivered = inMemoryOrders
            .filter(order => {
                if (tenantId && String(order.tenantId || '') !== String(tenantId)) return false;
                const rawStatus = order.orderStatus == null || String(order.orderStatus).trim() === ''
                    ? order.status
                    : order.orderStatus;
                if (!deliveredStatusSet.has(String(rawStatus || '').trim().toLowerCase())) return false;
                const createdAt = new Date(order.createdAt);
                if (hasValidStart && (!Number.isFinite(createdAt.getTime()) || createdAt < start)) return false;
                if (hasValidEnd && (!Number.isFinite(createdAt.getTime()) || createdAt >= end)) return false;
                return true;
            })
            .sort((a, b) => {
                const createdAtDelta = new Date(b.createdAt) - new Date(a.createdAt);
                return createdAtDelta || String(b._id || '').localeCompare(String(a._id || ''));
            });
        const total = delivered.length;
        const safePage = Math.min(requestedPage, Math.max(Math.ceil(total / safeLimit), 1));
        return {
            items: delivered.slice((safePage - 1) * safeLimit, safePage * safeLimit),
            total,
            page: safePage
        };
    },

    async getCancelledOrdersPage(page = 1, limit = 10, { tenantId = null } = {}) {
        const cancelledStatuses = [
            'Cancelled', 'cancelled', 'CANCELLED',
            'Cancelled_Order', 'cancelled_order', 'CANCELLED_ORDER'
        ];
        const cancelledStatusSet = new Set(cancelledStatuses.map(status => status.toLowerCase()));
        const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
        const requestedPage = Math.max(1, Number(page) || 1);
        const statusMissing = {
            $or: [
                { orderStatus: { $exists: false } },
                { orderStatus: null },
                { orderStatus: '' }
            ]
        };
        let filter = {
            $or: [
                { orderStatus: { $in: cancelledStatuses } },
                { $and: [statusMissing, { status: { $in: cancelledStatuses } }] }
            ]
        };

        if (getIsConnected()) {
            if (tenantId) filter = { $and: [filter, { tenantId: String(tenantId) }] };
            const total = await Order.countDocuments(filter);
            const safePage = Math.min(requestedPage, Math.max(Math.ceil(total / safeLimit), 1));
            const items = await Order.find(filter)
                .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
                .skip((safePage - 1) * safeLimit)
                .limit(safeLimit)
                .lean();
            return { items, total, page: safePage };
        }

        const cancelled = inMemoryOrders
            .filter(order => {
                if (tenantId && String(order.tenantId || '') !== String(tenantId)) return false;
                const rawStatus = order.orderStatus == null || String(order.orderStatus).trim() === ''
                    ? order.status
                    : order.orderStatus;
                return cancelledStatusSet.has(String(rawStatus || '').trim().toLowerCase());
            })
            .sort((a, b) => {
                const updatedAtDelta = new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
                return updatedAtDelta || String(b._id || '').localeCompare(String(a._id || ''));
            });
        const total = cancelled.length;
        const safePage = Math.min(requestedPage, Math.max(Math.ceil(total / safeLimit), 1));
        return {
            items: cancelled.slice((safePage - 1) * safeLimit, safePage * safeLimit),
            total,
            page: safePage
        };
    },

    async getFulfillmentSnapshot(page = 1, limit = 10, tenantId = null, { startDate = null, endDate = null } = {}) {
        const activeStatuses = ['Pending_Review', 'pending', 'Pending', 'Approved', 'accepted', 'approved',
            'Processing Order', 'processing', 'Processing', 'Processing_Order', 'ProcessingOrder',
            'Ready to Dispatch', 'ready_to_dispatch', 'Ready_To_Dispatch', 'ready', 'Ready',
            'Dispatched', 'dispatched', 'Out for Delivery', 'out_for_delivery',
            'VERIFICATION_NEEDED', 'PACKING', 'WAITING_FOR_STOCK', 'PARTIALLY_FULFILLED'];
        const deliveredStatuses = ['Delivered', 'delivered', 'DELIVERED', 'Delivered_Order', 'delivered_order', 'DELIVEREDORDER', 'DELIVERED_ORDER'];
        const missingStatus = { $or: [{ orderStatus: { $exists: false } }, { orderStatus: null }, { orderStatus: '' }] };
        const statusFilter = values => ({
            $or: [{ orderStatus: { $in: values } }, { $and: [missingStatus, { status: { $in: values } }] }]
        });
        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;
        if ((startDate && !Number.isFinite(start?.getTime())) || (endDate && !Number.isFinite(end?.getTime())) || (start && end && start >= end)) {
            throw Object.assign(new Error('Invalid date range.'), { statusCode: 400 });
        }
        const dateFilter = (start || end) ? { createdAt: { ...(start ? { $gte: start } : {}), ...(end ? { $lt: end } : {}) } } : {};
        const scope = { ...(tenantId ? { tenantId: String(tenantId) } : {}), ...dateFilter };
        const activeFilter = { $and: [scope, statusFilter(activeStatuses)] };
        const deliveredFilter = { $and: [scope, statusFilter(deliveredStatuses)] };
        const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
        const requestedPage = Math.max(1, Number(page) || 1);
        if (getIsConnected()) {
            const [activeTotal, total, deliveredCount, recentOrders] = await Promise.all([
                Order.countDocuments(activeFilter),
                Order.countDocuments(scope),
                Order.countDocuments(deliveredFilter),
                Order.find(scope).sort({ createdAt: -1, _id: -1 }).limit(6).lean()
            ]);
            const totalPages = Math.max(1, Math.ceil(activeTotal / safeLimit));
            const currentPage = Math.min(requestedPage, totalPages);
            const items = await Order.find(activeFilter).sort({ createdAt: -1, _id: -1 })
                .skip((currentPage - 1) * safeLimit).limit(safeLimit).lean();
            return { items, total, activeTotal, deliveredCount, recentOrders,
                pagination: { page: currentPage, limit: safeLimit, total: activeTotal, totalPages,
                    hasNextPage: currentPage < totalPages, hasPreviousPage: currentPage > 1 } };
        }
        const activeSet = new Set(activeStatuses.map(v => v.toLowerCase()));
        const deliveredSet = new Set(deliveredStatuses.map(v => v.toLowerCase()));
        const allOrders = inMemoryOrders.filter(order => {
            if (tenantId && String(order.tenantId || '') !== String(tenantId)) return false;
            const timestamp = new Date(order.createdAt).getTime();
            return (!start || timestamp >= start.getTime()) && (!end || timestamp < end.getTime());
        }).sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
        const getStatus = order => String(order.orderStatus || order.status || '').trim().toLowerCase();
        const active = allOrders.filter(order => activeSet.has(getStatus(order)));
        const totalPages = Math.max(1, Math.ceil(active.length / safeLimit));
        const currentPage = Math.min(requestedPage, totalPages);
        return { items: active.slice((currentPage - 1) * safeLimit, currentPage * safeLimit),
            total: allOrders.length, activeTotal: active.length,
            deliveredCount: allOrders.filter(order => deliveredSet.has(getStatus(order))).length,
            recentOrders: allOrders.slice(0, 6),
            pagination: { page: currentPage, limit: safeLimit, total: active.length, totalPages,
                hasNextPage: currentPage < totalPages, hasPreviousPage: currentPage > 1 } };
    },

    async searchOrders({ type, value, page = 1, limit = 5, tenantId = null }) {
        let filter;
        if (type === 'orderId') {
            const term = String(value.raw || value.orderNumber || value.objectId || '').trim();
            if (getIsConnected()) {
                const orConditions = [
                    { orderNumber: { $regex: term, $options: 'i' } }
                ];
                if (value.objectId && mongoose.isValidObjectId(value.objectId)) {
                    orConditions.push({ _id: new mongoose.Types.ObjectId(value.objectId) });
                } else if (/^[a-fA-F0-9]{24}$/i.test(term) && mongoose.isValidObjectId(term)) {
                    orConditions.push({ _id: new mongoose.Types.ObjectId(term) });
                }
                if (value.hexSuffix || /^[a-fA-F0-9]{4,12}$/i.test(term)) {
                    const hex = (value.hexSuffix || term).toLowerCase();
                    orConditions.push({ $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: `${hex}$`, options: 'i' } } });
                }
                filter = { $or: orConditions };
            }
        } else if (type === 'mobile') {
            const normalized = normalizeWhatsAppNumber(value.digits);
            const candidates = [...new Set([value.digits, normalized, normalized.startsWith('91') ? normalized.slice(2) : normalized])];
            filter = {
                $or: [
                    { customerMobileNormalized: { $in: candidates } },
                    { customerMobile: value.raw }
                ]
            };
        } else if (type === 'email') {
            if (!getIsConnected()) throw Object.assign(new Error('Email search requires the customer profile database.'), { statusCode: 503 });
            const profiles = await UserProfile.find({ email: value }).select('supabase_user_id supabaseId userId').lean();
            const userIds = [...new Set(profiles.flatMap(profile => [profile.supabase_user_id, profile.supabaseId, profile.userId]).filter(Boolean))];
            if (userIds.length === 0) return { items: [], total: 0 };
            filter = { $or: [{ customerId: { $in: userIds } }, { userId: { $in: userIds } }] };
        } else {
            return { items: [], total: 0 };
        }

        if (getIsConnected()) {
            if (tenantId) filter = { $and: [filter, { tenantId: String(tenantId) }] };
            const total = await Order.countDocuments(filter);
            const safePage = Math.min(page, Math.max(Math.ceil(total / limit), 1));
            const items = await Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip((safePage - 1) * limit).limit(limit).lean();
            return { items, total, page: safePage };
        }

        const matches = inMemoryOrders.filter(order => {
            if (tenantId && String(order.tenantId) !== String(tenantId)) return false;
            if (type === 'orderId') {
                const term = String(value.raw || value.orderNumber || value.objectId || '').trim().toLowerCase();
                const ordNum = String(order.orderNumber || '').toLowerCase();
                const ordId = String(order._id || order.id || '').toLowerCase();
                return ordNum === term
                    || ordId === term
                    || ordNum.includes(term)
                    || ordId.includes(term)
                    || ordId.endsWith(term);
            }
            if (type === 'mobile') {
                return [...new Set([value.digits, normalizeWhatsAppNumber(value.digits), normalizeWhatsAppNumber(value.digits).replace(/^91(?=\d{10}$)/, '')])].includes(String(order.customerMobile || '').replace(/\D/g, ''))
                    || String(order.customerMobile || '') === value.raw;
            }
            return false;
        }).sort((a, b) => {
            const createdAtDelta = new Date(b.createdAt) - new Date(a.createdAt);
            return createdAtDelta || String(b._id || '').localeCompare(String(a._id || ''));
        });
        const safePage = Math.min(page, Math.max(Math.ceil(matches.length / limit), 1));
        return { items: matches.slice((safePage - 1) * limit, safePage * limit), total: matches.length, page: safePage };
    },

    async getUserOrders(userId) {
        if (getIsConnected()) {
            return Order.find({ $or: [{ userId }, { customerId: userId }] }).sort({ createdAt: -1 }).lean();
        }
        return inMemoryOrders.filter(o => o.userId === userId || o.customerId === userId)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    async getOrders(userId) {
        if (userId) return this.getUserOrders(userId);
        return this.getAllOrders();
    },

    async getOrder(orderId, { tenantId = null, branchId = null } = {}) {
        if (getIsConnected()) {
            const filter = { _id: orderId };
            if (tenantId) filter.tenantId = String(tenantId);
            if (branchId) filter.branchId = String(branchId);
            return Order.findOne(filter).lean();
        }
        return inMemoryOrders.find(item =>
            String(item._id) === String(orderId)
            && (!tenantId || String(item.tenantId || '') === String(tenantId))
            && (!branchId || String(item.branchId || '') === String(branchId))
        ) || null;
    },

    async getOrderById(orderId, scope = {}) {
        return this.getOrder(orderId, scope);
    },

    async updateOrderForTenant(orderId, tenantId, updateData = {}) {
        if (!tenantId) return null;
        const safeUpdates = { ...updateData };
        delete safeUpdates.tenantId;
        delete safeUpdates.rider;
        delete safeUpdates.assignmentDetails;
        if (getIsConnected()) {
            const order = await Order.findOne({ _id: orderId, tenantId: String(tenantId) });
            if (!order) return null;
            Object.assign(order, safeUpdates);
            if (updateData.rider) {
                order.rider = { ...(order.rider?.toObject?.() || order.rider || {}), ...updateData.rider };
                order.deliveryPersonMobile = updateData.rider.riderMobile || order.deliveryPersonMobile || '';
            }
            if (updateData.assignmentDetails) {
                order.assignmentDetails = { ...(order.assignmentDetails || {}), ...updateData.assignmentDetails };
            }
            order.updatedAt = new Date();
            await order.save();
            return order.toObject({ virtuals: true });
        }
        const order = inMemoryOrders.find(item =>
            String(item._id || item.id) === String(orderId)
            && String(item.tenantId || '') === String(tenantId)
        );
        if (!order) return null;
        Object.assign(order, safeUpdates);
        if (updateData.rider) {
            order.rider = { ...order.rider, ...updateData.rider };
            order.deliveryPersonMobile = updateData.rider.riderMobile || order.deliveryPersonMobile || '';
        }
        if (updateData.assignmentDetails) {
            order.assignmentDetails = { ...order.assignmentDetails, ...updateData.assignmentDetails };
        }
        order.updatedAt = new Date();
        return order;
    },

    async transitionOrderStatus(orderId, newStatus, actor = 'Pharmacist', riderInfo = null, cashCollectionStatus = null, deliveryOtpVerified = false) {
        const validTransitions = {
            'Processing Order': ['Ready to Dispatch', 'Cancelled'],
            'Ready to Dispatch': ['Dispatched', 'Processing Order', 'Cancelled'],
            'Dispatched': ['Delivered', 'Ready to Dispatch'],
            'Delivered': []
        };
        const completeOrder = async (order, session = null) => {
            if (order.orderStatus === 'Delivered' && newStatus === 'Delivered') {
                const isCod = /cash|cod/i.test(String(order.paymentMethod || ''));
                if (isCod && cashCollectionStatus) {
                    if (cashCollectionStatus === 'CASH_RECEIVED') {
                        order.cashCollectionStatus = 'CASH_RECEIVED';
                        order.paymentStatus = 'PAID';
                        order.amountPaid = Number(order.finalTotal ?? order.totalAmount ?? 0);
                    } else if (cashCollectionStatus === 'CASH_NOT_RECEIVED') {
                        order.cashCollectionStatus = 'CASH_NOT_RECEIVED';
                        order.paymentStatus = order.paymentStatus === 'PAID' ? order.paymentStatus : 'PENDING';
                        order.amountPaid = 0;
                    }
                    if (session) await order.save({ session });
                    else if (order.save) await order.save();
                }
                if (!orderInventoryWasDeducted(order)) {
                    if (session) await deductMongoOrderInventory(order, session);
                    else deductInMemoryOrderInventory(order);
                    if (session) await order.save({ session });
                    else if (order.save) await order.save();
                }
                return {
                    order: order.toObject ? order.toObject({ virtuals: true }) : { ...order },
                    deliveryRewards: null,
                    previousStatus: 'Delivered'
                };
            }

            if (newStatus === 'Delivered' && !deliveryOtpVerified) {
                throw inventoryError('A valid customer delivery OTP is required to complete this order.', 409);
            }

            const allowed = validTransitions[order.orderStatus] || [];
            if (
                order.prescriptionRequired
                && ['Processing Order', 'Ready to Dispatch', 'Dispatched'].includes(newStatus)
                && order.prescriptionVerification?.status !== 'MATCHED'
            ) {
                throw inventoryError(
                    `Prescription verification is not ready. Current status: ${order.prescriptionVerification?.status || 'PENDING'}.`,
                    409
                );
            }
            if (!allowed.includes(newStatus)) {
                throw inventoryError(
                    `Invalid state transition: Cannot change order from '${order.orderStatus}' to '${newStatus}'`,
                    409
                );
            }

            const transitionAt = new Date();
            const previousStatus = order.orderStatus;
            if (newStatus === 'Dispatched') {
                if (session) await deductMongoOrderInventory(order, session);
                else deductInMemoryOrderInventory(order);
            }
            if (newStatus === 'Delivered' && !orderInventoryWasDeducted(order)) {
                if (session) await deductMongoOrderInventory(order, session);
                else deductInMemoryOrderInventory(order);
            }
            order.orderStatus = newStatus;

            if (riderInfo) {
                order.rider = {
                    riderId: riderInfo.riderId || `r-${Date.now()}`,
                    riderName: riderInfo.riderName || 'Assigned Courier',
                    riderMobile: riderInfo.riderMobile || '',
                    assignedAt: transitionAt
                };
                order.deliveryPersonMobile = riderInfo.riderMobile || '';
            }

            if (newStatus === 'Dispatched') {
                order.outForDeliveryAt = transitionAt;
                order.deliveredAt = null;
            }

            let deliveryRewards = null;
            if (newStatus === 'Delivered') {
                order.deliveredAt = transitionAt;
                const outForDeliveryAt = order.outForDeliveryAt
                    ? new Date(order.outForDeliveryAt).getTime()
                    : NaN;
                const elapsedMilliseconds = transitionAt.getTime() - outForDeliveryAt;
                const deliveryMinutes = Number.isFinite(outForDeliveryAt) && elapsedMilliseconds >= 0
                    ? elapsedMilliseconds / 60_000
                    : null;
                const onTime = deliveryMinutes !== null && deliveryMinutes <= 45;
                const finance = calculateCompletedOrderFinance(order);

                order.deliveryMinutes = deliveryMinutes;
                order.systemRating = onTime ? 5 : null;
                order.ratingPromptPending = !order.customerRating;
                if (onTime) order.postTime = Number(order.postTime || 0) - 1;
                order.rewardMetrics = finance;
                order.netProfit = finance.netProfit;
                order.netMarginPercentage = finance.netMarginPercentage;

                // Explicit cash collection status handling for COD orders
                const isCod = /cash|cod/i.test(String(order.paymentMethod || ''));
                if (isCod) {
                    if (cashCollectionStatus === 'CASH_RECEIVED') {
                        order.cashCollectionStatus = 'CASH_RECEIVED';
                        order.paymentStatus = 'PAID';
                        order.amountPaid = Number(order.finalTotal ?? order.totalAmount ?? 0);
                    } else if (cashCollectionStatus === 'CASH_NOT_RECEIVED') {
                        order.cashCollectionStatus = 'CASH_NOT_RECEIVED';
                        order.paymentStatus = order.paymentStatus === 'PAID' ? order.paymentStatus : 'PENDING';
                        order.amountPaid = 0;
                    } else {
                        // Preserve existing or default to uncollected; never assume paid automatically
                        order.cashCollectionStatus = order.cashCollectionStatus || 'CASH_NOT_RECEIVED';
                        if (order.cashCollectionStatus !== 'CASH_RECEIVED') {
                            order.paymentStatus = order.paymentStatus || 'PENDING';
                        }
                    }
                } else {
                    order.cashCollectionStatus = 'NOT_APPLICABLE';
                }

                if (session && order.rider?.riderId) {
                    if (!mongoose.isValidObjectId(order.rider.riderId)) {
                        throw inventoryError('The assigned rider record is invalid; delivery completion was not saved.', 409);
                    }
                    const rider = await Rider.findById(order.rider.riderId).session(session);
                    if (!rider) {
                        throw inventoryError('The assigned rider record was not found; delivery completion was not saved.', 409);
                    }
                    rider.totalDeliveries = Number(rider.totalDeliveries || 0) + 1;
                    rider.activeOrderIds = (rider.activeOrderIds || [])
                        .filter(activeOrderId => String(activeOrderId) !== String(order._id));
                    if (rider.activeOrderIds.length === 0 && rider.status !== 'Off-duty') {
                        rider.status = 'Available';
                    }
                    await rider.save({ session });
                }

                deliveryRewards = await awardDeliveredOrderPoints(order, session);
            }

            if (!order.statusHistory) order.statusHistory = [];
            const isCod = /cash|cod/i.test(String(order.paymentMethod || ''));
            const statusNote = newStatus === 'Dispatched'
                ? 'Reserved stock deducted from inventory on dispatch.'
                : newStatus === 'Delivered'
                    ? (isCod ? `Delivery completed. Cash collection: ${order.cashCollectionStatus}.` : 'Delivery completed.')
                    : riderInfo ? `Rider assigned: ${riderInfo.riderName} (${riderInfo.riderMobile})` : '';
            order.statusHistory.push({
                previousStatus,
                newStatus,
                changedBy: actor,
                timestamp: transitionAt,
                notes: statusNote
            });
            if (session) await order.save({ session });
            else if (order.save) await order.save();

            return {
                order: order.toObject ? order.toObject({ virtuals: true }) : order,
                deliveryRewards,
                previousStatus
            };
        };

        let transitionResult;
        if (getIsConnected()) {
            if (!mongoose.isValidObjectId(orderId)) throw inventoryError('Invalid order ID.');
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    const order = await Order.findById(orderId).session(session);
                    if (!order) throw inventoryError('Order not found.', 404);
                    transitionResult = await completeOrder(order, session);
                });
            } finally {
                await session.endSession();
            }
        } else {
            const order = inMemoryOrders.find(item => String(item._id) === String(orderId));
            if (!order) throw inventoryError('Order not found.', 404);
            transitionResult = await completeOrder(order);
        }

        if (transitionResult.previousStatus === 'Delivered' && newStatus === 'Delivered') {
            return transitionResult.order;
        }
        this.logAudit(actor, 'ORDER_STATUS_CHANGED', 'ORDER', orderId, {
            previousStatus: transitionResult.previousStatus,
            newStatus,
            rider: transitionResult.order.rider
        });
        domainEvents.emitDomainEvent('ORDER_STATUS_CHANGED', String(orderId), {
            orderNumber: transitionResult.order.orderNumber || String(orderId),
            customerUserId: transitionResult.order.userId || null,
            customerId: transitionResult.order.customerId || null,
            previousStatus: transitionResult.previousStatus,
            newStatus,
            rider: transitionResult.order.rider || null
        }, actor, transitionResult.order.tenantId || null, transitionResult.order.branchId || null);
        return {
            ...transitionResult.order,
            ...(transitionResult.deliveryRewards ? { deliveryRewards: transitionResult.deliveryRewards } : {})
        };
    },

    async saveCustomerRating(orderId, customerId, rating, comment = '') {
        if (getIsConnected()) {
            if (!mongoose.isValidObjectId(orderId)) throw inventoryError('Invalid order ID.');
            const order = await Order.findOneAndUpdate({
                _id: orderId,
                userId: customerId,
                orderStatus: 'Delivered',
                customerRating: { $exists: false }
            }, {
                $set: {
                    customerRating: rating,
                    customerComment: comment,
                    ratingPromptPending: false
                }
            }, { new: true, runValidators: true });
            if (order) return order.toObject({ virtuals: true });

            const existing = await Order.findOne({ _id: orderId, userId: customerId }).lean();
            if (!existing) throw inventoryError('Order not found.', 404);
            if (existing.orderStatus !== 'Delivered') throw inventoryError('You can rate an order after delivery.', 409);
            throw inventoryError('Feedback has already been submitted for this delivery.', 409);
        }

        const order = inMemoryOrders.find(item => String(item._id) === String(orderId));
        if (!order || order.userId !== customerId) throw inventoryError('Order not found.', 404);
        if (order.orderStatus !== 'Delivered') throw inventoryError('You can rate an order after delivery.', 409);
        if (order.customerRating !== undefined) throw inventoryError('Feedback has already been submitted for this delivery.', 409);
        order.customerRating = rating;
        order.customerComment = comment;
        order.ratingPromptPending = false;
        return order;
    },

    async createMedicine() {
        throw inventoryError('Legacy dataStore product creation is disabled. Use the tenant- and branch-scoped Inventory Service product API.', 410);
    },

    async updateMedicine() {
        throw inventoryError('Legacy dataStore product updates are disabled. Use the tenant- and branch-scoped Inventory Service product API.', 410);
    },

    async deleteMedicine() {
        throw inventoryError('Legacy dataStore product archival is disabled. Use the tenant- and branch-scoped Inventory Service product API.', 410);
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

    async clubDeliveryRoute(riderName, riderMobile, radiusKm = 5, startLat = 12.9716, startLng = 77.5946, tenantId) {
        if (!tenantId) throw inventoryError('A pharmacy tenant is required to optimize delivery routes.', 403);
        const eligibleOrders = getIsConnected()
            ? await Order.find({ tenantId: String(tenantId), orderStatus: 'Ready to Dispatch' }).sort({ createdAt: 1 }).lean()
            : inMemoryOrders.filter(o => String(o.tenantId || '') === String(tenantId) && o.orderStatus === 'Ready to Dispatch');
        const radius = Number(radiusKm) || 5;

        const matchingOrders = [];
        for (const order of eligibleOrders) {
            const oLat = order.coordinates?.lat ?? order.location?.coordinates?.[1] ?? startLat;
            const oLng = order.coordinates?.lng ?? order.location?.coordinates?.[0] ?? startLng;
            const distance = this.calculateDistanceInKm(startLat, startLng, oLat, oLng);
            if (distance <= radius) {
                matchingOrders.push({
                    ...order,
                    coordinates: { lat: oLat, lng: oLng },
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
        if (getIsConnected()) {
            await Coupon.findOneAndUpdate({ code: uppercase }, {
                $set: {
                    discountPercentage: Number(discountPercentage),
                    discountType: 'percentage',
                    discountValue: Number(discountPercentage),
                    minOrderAmount: Number(minOrderValue) || 0,
                    minOrderValue: Number(minOrderValue) || 0,
                    isActive: true
                }
            }, { upsert: true, new: true, setDefaultsOnInsert: true });
        }
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
                discountType: 'percentage',
                discountValue: Number(discountPercentage),
                minOrderValue: Number(minOrderValue) || 0,
                usageCount: 0,
                isActive: true
            });
        }
        this.logAudit('Admin', 'COUPON_CREATED', 'COUPON', uppercase, { discountPercentage, minOrderValue });
    },

    async validateCoupon(code, orderTotal = 0, context = {}) {
        const uppercase = (code || '').toUpperCase().trim();
        let c = null;
        if (getIsConnected()) {
            if (uppercase) {
                c = await Coupon.findOne({ code: uppercase, isActive: true }).lean();
            } else if (context.customerId) {
                const filter = {
                    customerId: String(context.customerId),
                    isActive: true,
                    autoApply: true,
                    ...(context.tenantId ? { tenantId: String(context.tenantId) } : {})
                };
                const candidates = await Coupon.find(filter).sort({ createdAt: -1 }).lean();
                c = candidates
                    .filter(item => !item.expiryDate || new Date(item.expiryDate) > new Date())
                    .filter(item => item.usageLimit == null || Number(item.usageCount || 0) < Number(item.usageLimit))
                    .sort((a, b) => {
                        const amount = item => item.discountType === 'fixed'
                            ? Math.min(Number(item.discountValue || 0), Number(orderTotal) || 0)
                            : (Number(orderTotal) * Number(item.discountValue ?? item.discountPercentage ?? 0) / 100);
                        return amount(b) - amount(a);
                    })[0] || null;
            }
        } else {
            c = uppercase
                ? inMemoryCoupons.find(x => x.code === uppercase && x.isActive)
                : null;
        }
        if (!c) return uppercase ? { valid: false, message: "Invalid or expired promo code" } : { valid: true, discountPercentage: 0, discountType: 'percentage', discountValue: 0, discountAmount: 0, code: null };
        if (c.customerId && String(c.customerId) !== String(context.customerId || '')) {
            return { valid: false, message: 'This coupon is assigned to another customer.' };
        }
        if (c.tenantId && String(c.tenantId) !== String(context.tenantId || '')) {
            return { valid: false, message: 'This coupon is not valid for the current pharmacy.' };
        }
        if (c.expiryDate && new Date(c.expiryDate) <= new Date()) {
            return { valid: false, message: 'Coupon has expired.' };
        }
        if (c.usageLimit != null && Number(c.usageCount || 0) >= Number(c.usageLimit)) {
            return { valid: false, message: 'Coupon usage limit has been reached.' };
        }
        const minimum = Number(c.minOrderAmount ?? c.minOrderValue ?? 0);
        if (orderTotal < minimum) {
            return { valid: false, message: `Minimum order amount of ₹${minimum} required for this coupon.` };
        }
        const discountType = c.discountType || 'percentage';
        const discountValue = Number(c.discountValue ?? c.discountPercentage ?? 0);
        const discountAmount = discountType === 'fixed'
            ? Math.min(discountValue, Number(orderTotal) || 0)
            : Math.round((Number(orderTotal) * discountValue / 100 + Number.EPSILON) * 100) / 100;
        return {
            valid: true,
            discountPercentage: discountType === 'percentage' ? discountValue : 0,
            discountType,
            discountValue,
            discountAmount,
            code: c.code
        };
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
        if (!hasValidCoordinates(address.coordinates)) {
            throw inventoryError('Select a valid delivery pin on the map before saving this address.');
        }
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
        if (!hasValidCoordinates(address.coordinates)) {
            throw inventoryError('Select a valid delivery pin on the map before saving this address.');
        }
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
    },

    // Medicine Request & Proposal Lifecycle
    async createMedicineRequest(payload, user) {
        const customerId = user.sub || user.id;
        const customerName = user.user_metadata?.name || user.email?.split('@')[0] || 'Valued Customer';
        const customerPhone = user.user_metadata?.mobile || payload.customerPhone || '';
        const customerEmail = user.email || '';

        const requestedItems = (payload.requestedItems || []).map(item => ({
            requestedName: String(item.requestedName || item.name || '').trim(),
            medicineId: item.medicineId || null,
            productId: item.productId || null,
            strength: String(item.strength || '').trim(),
            composition: String(item.composition || item.saltComposition || item.salt || '').trim(),
            dosageForm: String(item.dosageForm || '').trim(),
            manufacturer: String(item.manufacturer || '').trim(),
            quantity: Math.max(1, Number(item.quantity) || 1),
            originalAvailabilityStatus: item.originalAvailabilityStatus === 'OUT_OF_STOCK'
                ? 'OUT_OF_STOCK'
                : 'NOT_IN_CATALOG',
            source: ['MANUAL', 'PRESCRIPTION_EXTRACTED', 'PRESCRIPTION_MATCHED'].includes(item.source)
                ? item.source
                : 'MANUAL',
            dose: item.dose || null,
            frequency: item.frequency || null,
            duration: item.duration || null,
            course: item.course || null,
            instructions: item.instructions || null,
            prescriptionMedicineIndex: Number.isInteger(Number(item.prescriptionMedicineIndex))
                ? Number(item.prescriptionMedicineIndex)
                : null,
            validationStatus: ['MANUAL', 'EXTRACTED', 'MATCHED', 'PARTIAL_MATCH', 'NOT_FOUND', 'REVIEW_REQUIRED'].includes(item.validationStatus)
                ? item.validationStatus
                : 'MANUAL'
        }));

        if (!requestedItems.some(item => item.requestedName) && !payload.prescriptionId && !payload.prescriptionUrl) {
            throw inventoryError('Add at least one manual medicine or upload a prescription.');
        }

        const deliveryAddress = String(
            payload.deliveryAddress
            || payload.address
            || (user && typeof user === 'object' && (user.address || user.deliveryAddress))
            || 'Customer Registered Address'
        ).trim();

        if (!deliveryAddress) {
            throw inventoryError('A delivery address is required for your medicine request.');
        }

        if (!payload.addressId) {
            throw inventoryError('A delivery address is required for your medicine request.');
        }

        const validDeliveryPreferences = ['Morning', 'Evening', 'Next Day', 'Flexible'];
        const preferredDeliveryPreference = validDeliveryPreferences.includes(payload.preferredDeliveryPreference)
            ? payload.preferredDeliveryPreference
            : 'Flexible';

        const reqNum = await nextMedicineRequestNumber();
        const initialAudit = {
            action: 'REQUEST_CREATED',
            actorId: customerId,
            role: 'Customer',
            timestamp: new Date(),
            notes: requestedItems.some(item => item.requestedName)
                ? `Requested ${requestedItems.filter(item => item.requestedName)[0].requestedName} (x${requestedItems.filter(item => item.requestedName)[0].quantity})`
                : 'Prescription uploaded without manual medicine entry'
        };

        const requestDoc = {
            requestNumber: reqNum,
            customerId,
            tenantId: payload.tenantId || user.tenantId || user.app_metadata?.tenantId || null,
            branchId: payload.branchId || user.branchId || user.app_metadata?.branchId || null,
            customerName,
            customerPhone,
            customerEmail,
            addressId: payload.addressId || null,
            requestedItems,
            prescriptionUrl: payload.prescriptionUrl || null,
            prescriptionId: payload.prescriptionId || null,
            patientPuid: payload.patientPuid || null,
            prescriptionVerification: payload.prescriptionVerification || {
                status: payload.prescriptionId ? 'PROCESSING' : 'NOT_REQUIRED',
                prescriptionId: payload.prescriptionId || null,
                patientPuid: payload.patientPuid || null,
                overallConfidence: 0,
                lastCheckedAt: payload.prescriptionId ? new Date() : null,
                source: payload.prescriptionId ? 'PYTHON_PRESCRIPTION_SERVICE' : 'MANUAL',
                medicines: [],
                issues: []
            },
            productImageUrl: payload.productImageUrl || null,
            customerNote: String(payload.customerNote || '').trim(),
            deliveryAddress: deliveryAddress,
            addressDetails: payload.addressDetails || {},
            coordinates: payload.coordinates || null,
            urgencyLevel: ['Normal', 'Urgent (Same Day)', 'Critical / Life-Saving'].includes(payload.urgencyLevel)
                ? payload.urgencyLevel
                : 'Normal',
            preferredDeliveryPreference,
            status: 'REQUESTED',
            pharmacyProposal: null,
            customerResponse: null,
            reviewedBy: null,
            reviewedAt: null,
            proposalSentAt: null,
            approvedAt: null,
            rejectedAt: null,
            convertedOrderId: null,
            expiresAt: null,
            auditTrail: [initialAudit]
        };

        if (getIsConnected()) {
            let created;
            // A rolling deploy or an older instance can still race the request
            // counter. Retry only requestNumber unique-index collisions; never
            // replay the rest of the request flow or swallow unrelated DB errors.
            for (let attempt = 0; attempt < 5; attempt += 1) {
                try {
                    created = await MedicineRequest.create(requestDoc);
                    break;
                } catch (error) {
                    const duplicateRequestNumber = error?.code === 11000
                        && (error?.keyPattern?.requestNumber
                            || error?.keyValue?.requestNumber
                            || String(error?.message || '').includes('requestNumber_1'));
                    if (!duplicateRequestNumber || attempt === 4) throw error;
                    requestDoc.requestNumber = await nextMedicineRequestNumber();
                }
            }
            if (!created) throw new Error('Unable to persist medicine request after allocating a unique request number.');
            const plain = created.toObject();
            try {
                await sendWhatsAppMedicineRequestAlert(plain, 'MedicineRequestCreated');
            } catch (err) {
                console.warn('[WhatsApp] Alert failed for request creation:', err.message);
            }
            return plain;
        }

        const created = {
            ...requestDoc,
            _id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        inMemoryMedicineRequests.unshift(created);
        try {
            await sendWhatsAppMedicineRequestAlert(created, 'MedicineRequestCreated');
        } catch (err) {
            console.warn('[WhatsApp] Alert failed for request creation:', err.message);
        }
        return created;
    },

    async getMedicineRequests(filter = {}, user = null) {
        const role = user?.app_metadata?.role || user?.role;
        const normalizedRole = String(role || '').toUpperCase();
        const isStaff = Boolean(user) && [
            'ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'PHARMACY',
            'TENANT_ADMIN', 'TENANT_OWNER', 'PHARMACIST', 'PHARMACY_STAFF',
            'ORDER_MANAGER', 'INVENTORY_MANAGER', 'DISPATCHER', 'BRANCH_ADMIN'
        ].includes(normalizedRole);
        const isPlatformStaff = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(normalizedRole);
        const actorTenantId = user?.tenantId || user?.app_metadata?.tenantId || null;

        if (getIsConnected()) {
            const now = new Date();
            // Expiry maintenance is scoped to the caller's own customer/tenant
            // records; only explicitly privileged platform staff run it globally.
            const expiryScope = isStaff
                ? (isPlatformStaff ? {} : (actorTenantId ? { tenantId: String(actorTenantId) } : { tenantId: '__NO_TENANT_ACCESS__' }))
                : (user ? { customerId: user.sub || user.id } : { customerId: '__NO_CUSTOMER_ACCESS__' });
            await MedicineRequest.updateMany(
                { ...expiryScope, status: 'PROPOSAL_SENT', expiresAt: { $lt: now } },
                {
                    $set: { status: 'EXPIRED' },
                    $push: {
                        auditTrail: {
                            action: 'REQUEST_EXPIRED',
                            actorId: 'System',
                            role: 'System',
                            timestamp: now,
                            notes: 'Proposal expired past configured validity period'
                        }
                    }
                }
            );

            const query = {};
            if (!isStaff) {
                query.customerId = user ? user.sub : 'unauthenticated';
            } else {
                if (!isPlatformStaff) {
                    if (!actorTenantId) throw inventoryError('An active pharmacy tenant is required.', 403);
                    query.tenantId = String(actorTenantId);
                }
                if (filter.customerId) query.customerId = filter.customerId;
            }

            if (filter.status && filter.status !== 'ALL') {
                query.status = filter.status;
            }

            if (filter.search?.trim()) {
                const s = filter.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                query.$or = [
                    { requestNumber: { $regex: s, $options: 'i' } },
                    { customerName: { $regex: s, $options: 'i' } },
                    { 'requestedItems.requestedName': { $regex: s, $options: 'i' } }
                ];
            }

            return MedicineRequest.find(query).sort({ createdAt: -1 }).lean();
        }

        const now = new Date();
        // Auto expire in-memory proposals
        for (const req of inMemoryMedicineRequests) {
            if (req.status === 'PROPOSAL_SENT' && req.expiresAt && now > new Date(req.expiresAt)) {
                req.status = 'EXPIRED';
                req.auditTrail.push({
                    action: 'REQUEST_EXPIRED',
                    actorId: 'System',
                    role: 'System',
                    timestamp: now,
                    notes: 'Proposal expired past configured validity period'
                });
            }
        }

        let list = [...inMemoryMedicineRequests];
        if (!isStaff) {
            const customerId = user ? (user.sub || user.id) : 'unauthenticated';
            list = list.filter(r =>
                r.customerId === customerId
                || (customerId?.startsWith('demo-customer') && String(r.customerId)?.startsWith('demo-customer'))
                || (user?.email && r.customerEmail === user.email)
            );
        } else {
            if (!isPlatformStaff) {
                if (!actorTenantId) throw inventoryError('An active pharmacy tenant is required.', 403);
                list = list.filter(r => String(r.tenantId || '') === String(actorTenantId));
            }
            if (filter.customerId) list = list.filter(r => r.customerId === filter.customerId);
        }

        if (filter.status && filter.status !== 'ALL') {
            list = list.filter(r => r.status === filter.status);
        }

        if (filter.search?.trim()) {
            const s = filter.search.trim().toLowerCase();
            list = list.filter(r =>
                r.requestNumber?.toLowerCase().includes(s)
                || r.customerName?.toLowerCase().includes(s)
                || (r.requestedItems || []).some(item => item.requestedName?.toLowerCase().includes(s))
            );
        }

        return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },


    async getMedicineRequestsPage(filter = {}, user = null, page = 1, limit = 8) {
        const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
        const safeLimit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 8));
        const role = user?.app_metadata?.role || user?.role;
        const normalizedRole = String(role || '').toUpperCase();
        const isStaff = Boolean(user) && [
            'ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'PHARMACY',
            'TENANT_ADMIN', 'TENANT_OWNER', 'PHARMACIST', 'PHARMACY_STAFF',
            'ORDER_MANAGER', 'INVENTORY_MANAGER', 'DISPATCHER', 'BRANCH_ADMIN'
        ].includes(normalizedRole);
        const isPlatformStaff = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(normalizedRole);
        const actorTenantId = user?.tenantId || user?.app_metadata?.tenantId || null;

        if (getIsConnected()) {
            const query = {};
            if (!isStaff) {
                query.customerId = user ? user.sub : 'unauthenticated';
            } else {
                if (!isPlatformStaff) {
                    if (!actorTenantId) throw inventoryError('An active pharmacy tenant is required.', 403);
                    query.tenantId = String(actorTenantId);
                }
                if (filter.customerId) query.customerId = filter.customerId;
            }
            if (filter.status && filter.status !== 'ALL') query.status = filter.status;
            if (filter.startDate || filter.endDate) {
                const start = filter.startDate ? new Date(filter.startDate) : null;
                const end = filter.endDate ? new Date(filter.endDate) : null;
                if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime())) || (start && end && start >= end)) {
                    throw inventoryError('Invalid medicine request date range.', 400);
                }
                query.createdAt = { ...(start ? { $gte: start } : {}), ...(end ? { $lt: end } : {}) };
            }
            if (filter.search?.trim()) {
                const s = filter.search.trim();
                query.$or = [
                    { requestNumber: { $regex: s, $options: 'i' } },
                    { customerName: { $regex: s, $options: 'i' } },
                    { 'requestedItems.requestedName': { $regex: s, $options: 'i' } }
                ];
            }
            const total = await MedicineRequest.countDocuments(query);
            const totalPages = Math.max(1, Math.ceil(total / safeLimit));
            const currentPage = Math.min(safePage, totalPages);
            const requests = await MedicineRequest.find(query)
                .sort({ createdAt: -1, _id: -1 })
                .skip((currentPage - 1) * safeLimit)
                .limit(safeLimit)
                .lean();
            return {
                requests,
                pagination: {
                    page: currentPage,
                    pageSize: safeLimit,
                    total,
                    totalPages,
                    hasNextPage: currentPage < totalPages,
                    hasPreviousPage: currentPage > 1
                }
            };
        }

        const all = await this.getMedicineRequests(filter, user);
        const total = all.length;
        const totalPages = Math.max(1, Math.ceil(total / safeLimit));
        const currentPage = Math.min(safePage, totalPages);
        return {
            requests: all.slice((currentPage - 1) * safeLimit, currentPage * safeLimit),
            pagination: {
                page: currentPage,
                pageSize: safeLimit,
                total,
                totalPages,
                hasNextPage: currentPage < totalPages,
                hasPreviousPage: currentPage > 1
            }
        };
    },

    async getMedicineRequestById(id, user = null) {
        let request = null;
        const role = user?.app_metadata?.role || user?.role;
        const normalizedRole = String(role || '').toUpperCase();
        const isStaff = Boolean(user) && [
            'ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'PHARMACY',
            'TENANT_ADMIN', 'TENANT_OWNER', 'PHARMACIST', 'PHARMACY_STAFF',
            'ORDER_MANAGER', 'INVENTORY_MANAGER', 'DISPATCHER', 'BRANCH_ADMIN'
        ].includes(normalizedRole);
        const isPlatformStaff = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(normalizedRole);
        const actorTenantId = user?.tenantId || user?.app_metadata?.tenantId || null;
        const ownerScope = user && !isStaff ? { customerId: user.sub || user.id } : {};
        const tenantScope = user && isStaff && !isPlatformStaff
            ? (actorTenantId ? { tenantId: String(actorTenantId) } : { tenantId: '__NO_TENANT_ACCESS__' })
            : {};
        const idScope = mongoose.isValidObjectId(id)
            ? { _id: new mongoose.Types.ObjectId(id) }
            : { $or: [{ _id: id }, { requestNumber: id }] };
        if (getIsConnected()) {
            request = await MedicineRequest.findOne({ $and: [idScope, ownerScope, tenantScope] }).lean();
        } else {
            request = inMemoryMedicineRequests.find(r =>
                String(r._id) === String(id) || r.requestNumber === id
            ) || null;
        }

        if (!request) return null;

        if (user && !isStaff && request.customerId !== (user.sub || user.id)) return null;
        if (user && isStaff && !isPlatformStaff && (!actorTenantId || String(request.tenantId || '') !== String(actorTenantId))) return null;

        // Auto expire check
        if (request.status === 'PROPOSAL_SENT' && request.expiresAt && new Date() > new Date(request.expiresAt)) {
            request.status = 'EXPIRED';
            const expireAudit = {
                action: 'REQUEST_EXPIRED',
                actorId: 'System',
                role: 'System',
                timestamp: new Date(),
                notes: 'Proposal expired'
            };
            if (getIsConnected()) {
                await MedicineRequest.updateOne(
                    { _id: request._id },
                    { $set: { status: 'EXPIRED' }, $push: { auditTrail: expireAudit } }
                );
            } else {
                request.auditTrail.push(expireAudit);
            }
        }

        return request;
    },

    async getPendingMedicineRequestCount(tenantId = null) {
        const filter = { status: { $in: ['REQUESTED', 'UNDER_REVIEW'] }, ...(tenantId ? { tenantId: String(tenantId) } : {}) };
        if (getIsConnected()) return MedicineRequest.countDocuments(filter);
        return inMemoryMedicineRequests.filter(r =>
            ['REQUESTED', 'UNDER_REVIEW'].includes(r.status)
            && (!tenantId || String(r.tenantId || '') === String(tenantId))
        ).length;
    },

    async reviewMedicineRequest(id, actor = 'Pharmacist', actorRole = 'Pharmacist') {
        const actorName = typeof actor === 'object'
            ? (actor?.user_metadata?.name || actor?.email?.split('@')[0] || 'Pharmacist')
            : (actor || 'Pharmacist');
        const role = typeof actor === 'object'
            ? (actor?.app_metadata?.role || actor?.role || 'Pharmacist')
            : actorRole;

        const request = await this.getMedicineRequestById(id);
        if (!request) throw inventoryError('Medicine request not found.', 404);

        if (request.status === 'REQUESTED') {
            const now = new Date();
            const audit = {
                action: 'REQUEST_REVIEWED',
                actorId: actorName,
                role: role,
                timestamp: now,
                notes: 'Pharmacist commenced review and supplier availability assessment'
            };

            if (getIsConnected()) {
                const updated = await MedicineRequest.findByIdAndUpdate(
                    request._id,
                    {
                        $set: {
                            status: 'UNDER_REVIEW',
                            reviewedBy: actorName,
                            reviewedAt: now
                        },
                        $push: { auditTrail: audit }
                    },
                    { new: true }
                ).lean();
                return updated;
            }

            request.status = 'UNDER_REVIEW';
            request.reviewedBy = actorName;
            request.reviewedAt = now;
            request.auditTrail.push(audit);
        }
        return request;
    },

    async createOrUpdateProposal(id, proposalData, actorName = 'Pharmacist', actorRole = 'Pharmacist') {
        const request = await this.getMedicineRequestById(id);
        if (!request) throw inventoryError('Medicine request not found.', 404);

        if (['CUSTOMER_APPROVED', 'CONVERTED_TO_ORDER'].includes(request.status)) {
            throw inventoryError('Cannot alter proposal after customer approval or order conversion.', 400);
        }

        const medicineName = String(proposalData.medicineName || proposalData.proposedMedicineName || request.requestedItems?.[0]?.requestedName || '').trim();
        if (!medicineName) throw inventoryError('Medicine name is required in proposal.');

        const quantity = Math.max(1, Number(proposalData.quantity ?? proposalData.proposedQuantity) || 1);
        const unitPrice = Number(proposalData.unitPrice ?? 0);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
            throw inventoryError('Unit price must be a valid non-negative amount.');
        }
        const priceType = proposalData.priceType === 'FINAL'
            || (!proposalData.priceType && proposalData.finalPrice != null)
            ? 'FINAL'
            : 'APPROXIMATE';

        const approximatePrice = Number(
            proposalData.approximatePrice
            ?? proposalData.totalPrice
            ?? (unitPrice * quantity)
        );
        if (priceType === 'APPROXIMATE' && (!Number.isFinite(approximatePrice) || approximatePrice <= 0)) {
            throw inventoryError('Approximate total must be greater than zero.');
        }

        let finalPrice = null;
        if (priceType === 'FINAL') {
            finalPrice = Number(proposalData.finalPrice ?? proposalData.totalPrice ?? approximatePrice);
            if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
                throw inventoryError('A valid final price must be specified when priceType is FINAL.');
            }
        }

        const totalPrice = finalPrice != null ? finalPrice : approximatePrice;

        const slot = proposalData.deliverySlot || {};
        const validSlotTypes = ['MORNING', 'EVENING', 'NEXT_DAY', 'FLEXIBLE', 'CUSTOM'];
        const slotType = validSlotTypes.includes(slot.slotType) ? slot.slotType : 'FLEXIBLE';

        const deliverySlot = {
            date: slot.date || new Date(Date.now() + 86400000).toISOString().split('T')[0],
            slotType,
            startTime: slot.startTime || (slotType === 'MORNING' ? '09:00' : slotType === 'EVENING' ? '18:00' : '10:00'),
            endTime: slot.endTime || (slotType === 'MORNING' ? '13:00' : slotType === 'EVENING' ? '21:00' : '18:00'),
            label: slot.label || `${slotType.replace('_', ' ')} Delivery (${slot.date || 'Available slot'})`
        };

        const rxState = request.prescriptionVerification?.status
            || (request.prescriptionId || request.prescriptionUrl ? 'PROCESSING' : 'NOT_REQUIRED');
        const prescriptionStatus = rxState === 'MATCHED'
            ? 'Verified'
            : ['REJECTED', 'INACTIVE', 'MISMATCH'].includes(rxState)
                ? 'Rejected'
                : rxState === 'NOT_REQUIRED'
                    ? 'Not Required'
                    : 'Pending Verification';

        // Expiration: custom date or 48 hours default
        let expiresAt = proposalData.expiresAt ? new Date(proposalData.expiresAt) : new Date(Date.now() + 48 * 3600000);
        if (isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
            expiresAt = new Date(Date.now() + 48 * 3600000);
        }

        const requestedIdentity = request.requestedItems?.[0] || {};
        const alternativeIds = [...new Set((Array.isArray(proposalData.alternativeOffers) ? proposalData.alternativeOffers : [])
            .map(offer => String(offer?.productId || '').trim()).filter(id => mongoose.isValidObjectId(id)))].slice(0, 5);
        let alternativeOffers = [];
        if (alternativeIds.length && getIsConnected() && request.tenantId && request.branchId) {
            const inventoryResponse = await inventoryClient.lookup({
                productIds: alternativeIds,
                tenantId: String(request.tenantId),
                branchId: String(request.branchId),
                userId: actor?.userId || actor?.sub || 'pharmacy-admin'
            });
            const candidates = inventoryResponse.items || [];
            const norm = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
            alternativeOffers = candidates.flatMap(candidate => {
                const composition = candidate.composition || candidate.genericName;
                const sameComposition = requestedIdentity.composition && norm(composition) === norm(requestedIdentity.composition);
                const sameStrength = requestedIdentity.strength && norm(candidate.strength) === norm(requestedIdentity.strength);
                const sameForm = requestedIdentity.dosageForm && norm(candidate.dosageForm || candidate.form) === norm(requestedIdentity.dosageForm);
                if (!sameComposition || !sameStrength || !sameForm || String(candidate.productId) === String(proposalData.productId || '')) return [];
                const availableQuantity = Math.max(0, Number(candidate.availableQuantity || 0));
                if (availableQuantity < quantity) return [];
                const unitPrice = Number(candidate.price || 0);
                if (!Number.isFinite(unitPrice) || unitPrice < 0) return [];
                const discountPercentage = Math.min(100, Math.max(0, Number(candidate.discountPercentage || 0)));
                const discountedUnitPrice = Math.round(unitPrice * (1 - discountPercentage / 100) * 100) / 100;
                return [{
                    productId: String(candidate.productId),
                    medicineName: candidate.name,
                    manufacturer: candidate.manufacturer || candidate.brand || '',
                    composition,
                    strength: candidate.strength || '',
                    dosageForm: candidate.dosageForm || candidate.form || '',
                    quantity,
                    unitPrice,
                    discountPercentage,
                    discountedUnitPrice,
                    availableQuantity,
                    requiresPrescription: Boolean(candidate.requiresPrescription),
                    requiresPharmacistApproval: Boolean(request.prescriptionId || request.prescriptionUrl || candidate.requiresPrescription),
                    customerConsentRequired: true
                }];
            }).sort((a, b) => a.discountedUnitPrice - b.discountedUnitPrice);
        }

        const proposal = {
            productId: proposalData.productId || null,
            medicineName,
            manufacturer: String(proposalData.manufacturer || proposalData.proposedManufacturer || request.requestedItems?.[0]?.manufacturer || '').trim(),
            strength: String(proposalData.strength || request.requestedItems?.[0]?.strength || '').trim(),
            dosageForm: String(proposalData.dosageForm || request.requestedItems?.[0]?.dosageForm || '').trim(),
            quantity,
            unitPrice,
            approximatePrice,
            finalPrice,
            totalPrice,
            priceType,
            pharmacyNote: String(proposalData.pharmacyNote || proposalData.pharmacyNotes || '').trim(),
            deliverySlot,
            prescriptionStatus,
            alternativeProduct: String(proposalData.alternativeProduct || '').trim(),
            alternativeOffers,
            prescriptionItems: request.prescriptionVerification?.medicines || []
        };

        const now = new Date();
        const isUpdate = request.status === 'PROPOSAL_SENT';
        const audit = {
            action: isUpdate ? 'PROPOSAL_UPDATED' : 'PROPOSAL_SENT',
            actorId: actorName,
            role: actorRole,
            timestamp: now,
            notes: `${isUpdate ? 'Updated' : 'Formulated'} proposal: ${medicineName} (${priceType} ₹${totalPrice})`
        };

        if (getIsConnected()) {
            const updated = await MedicineRequest.findByIdAndUpdate(
                request._id,
                {
                    $set: {
                        status: 'PROPOSAL_SENT',
                        pharmacyProposal: proposal,
                        proposalSentAt: now,
                        expiresAt,
                        reviewedBy: actorName,
                        reviewedAt: now
                    },
                    $push: { auditTrail: audit }
                },
                { new: true }
            ).lean();

            try {
                await sendWhatsAppMedicineRequestAlert(updated, 'MedicineProposalReady');
            } catch (err) {
                console.warn('[WhatsApp] Alert failed for proposal ready:', err.message);
            }
            return updated;
        }

        request.status = 'PROPOSAL_SENT';
        request.pharmacyProposal = proposal;
        request.proposalSentAt = now;
        request.expiresAt = expiresAt;
        request.reviewedBy = actorName;
        request.reviewedAt = now;
        request.auditTrail.push(audit);

        try {
            await sendWhatsAppMedicineRequestAlert(request, 'MedicineProposalReady');
        } catch (err) {
            console.warn('[WhatsApp] Alert failed for proposal ready:', err.message);
        }
        return request;
    },

    async rejectMedicineRequestByPharmacy(id, arg2 = '', arg3 = 'Pharmacist', arg4 = 'Pharmacist') {
        let reason = '';
        let actorName = 'Pharmacist';
        let actorRole = 'Pharmacist';

        if (arg2 && typeof arg2 === 'object') {
            actorName = arg2.user_metadata?.name || arg2.email?.split('@')[0] || arg2.sub || 'Pharmacist';
            actorRole = arg2.app_metadata?.role || 'Pharmacist';
            reason = typeof arg3 === 'string' ? arg3 : (arg3?.reason || '');
        } else {
            reason = typeof arg2 === 'string' ? arg2 : (arg2?.reason || '');
            if (arg3 && typeof arg3 === 'object') {
                actorName = arg3.user_metadata?.name || arg3.email?.split('@')[0] || arg3.sub || 'Pharmacist';
                actorRole = arg3.app_metadata?.role || 'Pharmacist';
            } else if (typeof arg3 === 'string') {
                actorName = arg3;
                actorRole = arg4 || 'Pharmacist';
            }
        }

        const request = await this.getMedicineRequestById(id);
        if (!request) throw inventoryError('Medicine request not found.', 404);

        if (['CUSTOMER_APPROVED', 'CONVERTED_TO_ORDER'].includes(request.status)) {
            throw inventoryError('Cannot reject request after customer approval or order conversion.', 400);
        }

        const now = new Date();
        const audit = {
            action: 'PHARMACY_REJECTED',
            actorId: actorName,
            role: actorRole,
            timestamp: now,
            notes: reason || 'Pharmacy unable to procure requested medicine from supplier network.'
        };

        if (getIsConnected()) {
            const updated = await MedicineRequest.findByIdAndUpdate(
                request._id,
                {
                    $set: {
                        status: 'PHARMACY_REJECTED',
                        rejectedAt: now,
                        pharmacyRejectionReason: reason || 'Pharmacy unable to procure requested medicine'
                    },
                    $push: { auditTrail: audit }
                },
                { new: true }
            ).lean();

            try {
                await sendWhatsAppMedicineRequestAlert(updated, 'MedicineRequestRejected');
            } catch (err) {
                console.warn('[WhatsApp] Alert failed for pharmacy reject:', err.message);
            }
            if (updated) {
                updated.pharmacyRejectionReason = reason;
            }
            return updated;
        }

        request.status = 'PHARMACY_REJECTED';
        request.rejectedAt = now;
        request.pharmacyRejectionReason = reason;
        request.auditTrail.push(audit);

        try {
            await sendWhatsAppMedicineRequestAlert(request, 'MedicineRequestRejected');
        } catch (err) {
            console.warn('[WhatsApp] Alert failed for pharmacy reject:', err.message);
        }
        return request;
    },

    async rejectMedicineProposalByCustomer(id, arg2 = '', arg3) {
        let reason = '';
        let user = null;
        if (arg2 && typeof arg2 === 'object' && (arg2.sub || arg2.id || arg2.email)) {
            user = arg2;
            reason = typeof arg3 === 'string' ? arg3 : (arg3?.reason || '');
        } else {
            reason = typeof arg2 === 'string' ? arg2 : (arg2?.reason || '');
            user = arg3;
        }

        if (!user) {
            throw inventoryError('User context required for proposal rejection.', 401);
        }

        const role = user.app_metadata?.role || user.role || 'customer';
        if (role === 'admin' || role === 'pharmacy') {
            throw inventoryError('Administrators cannot reject proposals on behalf of a customer.', 403);
        }

        const customerId = user.sub || user.id;
        const request = await this.getMedicineRequestById(id, user);
        if (!request || request.customerId !== customerId) {
            throw inventoryError('Medicine request not found.', 404);
        }

        if (request.status !== 'PROPOSAL_SENT') {
            throw inventoryError(`Cannot reject proposal in '${request.status}' status.`, 400);
        }

        const now = new Date();
        const audit = {
            action: 'CUSTOMER_REJECTED',
            actorId: customerId,
            role: 'Customer',
            timestamp: now,
            notes: reason || 'Customer declined the proposed pricing or delivery schedule.'
        };

        if (getIsConnected()) {
            const updated = await MedicineRequest.findByIdAndUpdate(
                request._id,
                {
                    $set: {
                        status: 'CUSTOMER_REJECTED',
                        rejectedAt: now,
                        customerRejectionReason: reason || 'Declined proposal',
                        customerResponse: {
                            respondedAt: now,
                            responseNote: reason || 'Declined proposal'
                        }
                    },
                    $push: { auditTrail: audit }
                },
                { new: true }
            ).lean();

            try {
                await sendWhatsAppMedicineRequestAlert(updated, 'MedicineRequestRejected');
            } catch (err) {
                console.warn('[WhatsApp] Alert failed for customer reject:', err.message);
            }
            if (updated) {
                updated.customerRejectionReason = reason;
            }
            return updated;
        }

        request.status = 'CUSTOMER_REJECTED';
        request.rejectedAt = now;
        request.customerRejectionReason = reason;
        request.customerResponse = {
            respondedAt: now,
            responseNote: reason || 'Declined proposal'
        };
        request.auditTrail.push(audit);

        try {
            await sendWhatsAppMedicineRequestAlert(request, 'MedicineRequestRejected');
        } catch (err) {
            console.warn('[WhatsApp] Alert failed for customer reject:', err.message);
        }
        return request;
    },

    async rejectProposalByCustomer(id, arg2, arg3) {
        return this.rejectMedicineProposalByCustomer(id, arg2, arg3);
    },

    async cancelMedicineRequestByCustomer(id, arg2 = '', arg3) {
        let reason = '';
        let user = null;
        if (arg2 && typeof arg2 === 'object' && (arg2.sub || arg2.id || arg2.email)) {
            user = arg2;
            reason = typeof arg3 === 'string' ? arg3 : (arg3?.reason || '');
        } else {
            reason = typeof arg2 === 'string' ? arg2 : (arg2?.reason || '');
            user = arg3;
        }

        if (!user) {
            throw inventoryError('User context required for request cancellation.', 401);
        }

        const customerId = user.sub || user.id || user._id || user.userId;
        const request = await this.getMedicineRequestById(id, user);
        if (!request || (request.customerId && customerId && String(request.customerId) !== String(customerId))) {
            throw inventoryError('Medicine request not found.', 404);
        }

        if (['CUSTOMER_APPROVED', 'CONVERTED_TO_ORDER'].includes(request.status)) {
            throw inventoryError('Cannot cancel a request that has already been converted to an order.', 400);
        }

        if (request.status === 'CANCELLED') {
            return request;
        }

        const now = new Date();
        const audit = {
            action: 'CUSTOMER_CANCELLED',
            actorId: customerId || 'Customer',
            role: 'Customer',
            timestamp: now,
            notes: reason || 'Customer cancelled the medicine request.'
        };

        if (getIsConnected()) {
            return MedicineRequest.findByIdAndUpdate(
                request._id,
                {
                    $set: {
                        status: 'CANCELLED',
                        customerResponse: {
                            respondedAt: now,
                            responseNote: reason || 'Cancelled by customer'
                        }
                    },
                    $push: { auditTrail: audit }
                },
                { new: true }
            ).lean();
        }

        request.status = 'CANCELLED';
        request.customerResponse = {
            respondedAt: now,
            responseNote: reason || 'Cancelled by customer'
        };
        request.auditTrail.push(audit);
        return request;
    },

    // CRITICAL IDEMPOTENT ORDER CONVERSION
    async approveMedicineProposalAndConvertToOrder(id, arg2 = '', arg3, selectedProductIdArg = null) {
        let approvalNote = '';
        let user = null;
        if (arg2 && typeof arg2 === 'object' && (arg2.sub || arg2.id || arg2.email)) {
            user = arg2;
            approvalNote = typeof arg3 === 'string' ? arg3 : (arg3?.customerResponseNote || arg3?.note || '');
        } else {
            approvalNote = typeof arg2 === 'string' ? arg2 : (arg2?.customerResponseNote || arg2?.note || '');
            user = arg3;
        }
        if (!user) {
            throw inventoryError('User context is required for proposal approval.', 401);
        }
        const role = user.app_metadata?.role || user.role || 'customer';
        if (role === 'admin' || role === 'pharmacy') {
            throw inventoryError('Administrators cannot approve proposals on behalf of a customer.', 403);
        }
        const customerId = user.sub || user.id;
        const request = await this.getMedicineRequestById(id, user);
        if (!request || request.customerId !== customerId) {
            throw inventoryError('Medicine request not found.', 404);
        }

        // 1. Idempotency Check: if already converted, return existing order
        if (request.convertedOrderId || request.status === 'CONVERTED_TO_ORDER') {
            const existingOrder = await this.getOrder(request.convertedOrderId);
            return {
                success: true,
                order: existingOrder,
                request,
                alreadyConverted: true,
                message: 'Proposal was already approved and converted into an order.'
            };
        }

        if (request.status === 'CUSTOMER_REJECTED' || request.status === 'PHARMACY_REJECTED') {
            throw inventoryError('A rejected proposal cannot later be approved.', 400);
        }

        // 2. Check expiration
        if (request.expiresAt && new Date() > new Date(request.expiresAt)) {
            if (getIsConnected()) {
                await MedicineRequest.updateOne({ _id: request._id }, { $set: { status: 'EXPIRED' } });
            } else {
                request.status = 'EXPIRED';
            }
            throw inventoryError('This proposal has expired and can no longer be approved.', 400);
        }

        // 3. Status Check: must be PROPOSAL_SENT
        if (request.status !== 'PROPOSAL_SENT') {
            throw inventoryError(`Cannot approve proposal in '${request.status}' status.`, 400);
        }

        const proposal = request.pharmacyProposal;
        if (!proposal || !proposal.totalPrice || proposal.totalPrice <= 0) {
            throw inventoryError('The pharmacy proposal is missing valid pricing.', 400);
        }
        const selectedProductId = String(selectedProductIdArg || proposal.productId || '').trim() || null;
        const selectedAlternative = selectedProductId && selectedProductId !== String(proposal.productId || '')
            ? (proposal.alternativeOffers || []).find(offer => String(offer.productId) === selectedProductId)
            : null;
        if (selectedProductId && selectedProductId !== String(proposal.productId || '') && !selectedAlternative) {
            throw inventoryError('The selected alternative is not part of this pharmacy proposal.', 400);
        }
        const chosenName = selectedAlternative?.medicineName || proposal.medicineName;
        const chosenManufacturer = selectedAlternative?.manufacturer || proposal.manufacturer || '';
        const chosenStrength = selectedAlternative?.strength || proposal.strength || '';
        const chosenForm = selectedAlternative?.dosageForm || proposal.dosageForm || '';
        const chosenQuantity = Number(selectedAlternative?.quantity || proposal.quantity);
        const chosenUnitPrice = Number(selectedAlternative?.discountedUnitPrice ?? proposal.unitPrice ?? 0);
        const orderTotal = selectedAlternative
            ? Math.round(chosenUnitPrice * chosenQuantity * 100) / 100
            : Math.max(0, Math.round(Number(proposal.totalPrice) * 100) / 100);
        if (!Number.isSafeInteger(chosenQuantity) || chosenQuantity < 1 || !Number.isFinite(chosenUnitPrice) || chosenUnitPrice < 0 || orderTotal <= 0) {
            throw inventoryError('The selected product offer has invalid quantity or pricing.', 400);
        }

        let prescriptionVerification = {
            status: request.prescriptionId || request.prescriptionUrl ? 'REVIEW_REQUIRED' : 'NOT_REQUIRED',
            prescriptionId: request.prescriptionId || null,
            patientPuid: request.patientPuid || null,
            overallConfidence: Number(request.prescriptionVerification?.overallConfidence || 0),
            lastCheckedAt: new Date(),
            medicines: request.prescriptionVerification?.medicines || [],
            issues: request.prescriptionId
                ? ['Prescription verification result is not available yet.']
                : request.prescriptionUrl
                    ? ['Legacy prescription is not linked to the Python Prescription Service.']
                    : []
        };

        if (request.prescriptionId) {
            try {
                prescriptionVerification = await verifyPrescriptionAgainstItems({
                    prescriptionId: request.prescriptionId,
                    patientPuid: request.patientPuid || null,
                    items: [{
                        productId: selectedProductId,
                        name: chosenName || '',
                        productName: chosenName || '',
                        strength: chosenStrength,
                        form: chosenForm,
                        quantity: chosenQuantity
                    }],
                    userId: customerId,
                    tenantId: request.tenantId || user?.tenantId || null,
                    branchId: request.branchId || user?.branchId || null
                });
            } catch (verificationError) {
                prescriptionVerification = {
                    status: 'PROCESSING',
                    prescriptionId: request.prescriptionId,
                    patientPuid: request.patientPuid || null,
                    overallConfidence: 0,
                    lastCheckedAt: new Date(),
                    medicines: [],
                    issues: [verificationError.message || 'Prescription verification service is temporarily unavailable.']
                };
            }
        }

        if (['REJECTED', 'INACTIVE', 'MISMATCH'].includes(prescriptionVerification.status)) {
            throw inventoryError(
                `Prescription verification failed for the proposed medicine: ${prescriptionVerification.issues?.[0] || prescriptionVerification.status}.`,
                409
            );
        }

        if ((request.prescriptionId || request.prescriptionUrl) && prescriptionVerification.status !== 'MATCHED') {
            throw inventoryError(
                `Prescription verification is not complete for the proposed medicine. Current status: ${prescriptionVerification.status}.`,
                409
            );
        }

        const orderId = getIsConnected()
            ? new mongoose.Types.ObjectId()
            : `ord-mr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        const unitPrice = chosenUnitPrice || Math.round((orderTotal / chosenQuantity) * 100) / 100;
        const itemName = chosenName && chosenStrength && !chosenName.toLowerCase().includes(chosenStrength.toLowerCase())
            ? `${chosenName} ${chosenStrength}`
            : chosenName;
        let selectedMedicine = null;
        let inventoryReservation = null;
        let reservedMedicineItems = [];
        if (selectedProductId) {
            if (!getIsConnected()) throw inventoryError('Order persistence is unavailable. This catalogue product cannot be reserved.', 503);
            const tenantId = String(request.tenantId || '').trim();
            const branchId = String(request.branchId || user?.branchId || '').trim();
            if (!tenantId || !branchId || !mongoose.isValidObjectId(selectedProductId)) {
                throw inventoryError('The selected catalogue product requires a valid pharmacy tenant and branch.', 400);
            }
            const catalog = await inventoryClient.lookup({
                productIds: [String(selectedProductId)], tenantId, branchId, userId: customerId
            });
            selectedMedicine = catalog.items?.[0] || null;
            if (!selectedMedicine || Number(selectedMedicine.availableQuantity || 0) < chosenQuantity) {
                throw inventoryError('The selected catalogue product is no longer available in the required quantity from this branch.', 409);
            }
            if (selectedAlternative) {
                const currentDiscount = Math.min(100, Math.max(0, Number(selectedMedicine.discountPercentage || 0)));
                const currentOfferPrice = Math.round(Number(selectedMedicine.price || 0) * (1 - currentDiscount / 100) * 100) / 100;
                if (Math.abs(currentOfferPrice - Number(selectedAlternative.discountedUnitPrice || 0)) > 0.01
                    || Math.abs(Number(selectedMedicine.price || 0) - Number(selectedAlternative.unitPrice || 0)) > 0.01) {
                    throw inventoryError('The alternative offer price changed. Ask the pharmacy to refresh the proposal before approving.', 409);
                }
            }
            if (Boolean(selectedMedicine.requiresPrescription) && !request.prescriptionUrl && !request.prescriptionId) {
                throw inventoryError('A valid prescription is required for the selected product.', 409);
            }
            const basePrice = Number(selectedMedicine.price || unitPrice);
            if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > basePrice + 0.01) {
                throw inventoryError('The proposed price must be valid and cannot exceed the current Inventory Service catalogue price.', 409);
            }
            const baseCostPrice = Number(selectedMedicine.baseCostPrice) > 0 ? Number(selectedMedicine.baseCostPrice) : basePrice;
            reservedMedicineItems = [{
                medicineId: new mongoose.Types.ObjectId(String(selectedMedicine.productId)),
                quantity: chosenQuantity,
                price: unitPrice,
                basePrice,
                baseCostPrice,
                discountPercentage: basePrice > unitPrice ? roundCurrency((1 - unitPrice / basePrice) * 100) : 0,
                marginTier: ['LOW', 'MID', 'HIGH'].includes(selectedMedicine.marginTier) ? selectedMedicine.marginTier : 'LOW',
                name: selectedMedicine.name || chosenName,
                sku: selectedMedicine.sku || ''
            }];
            inventoryReservation = await inventoryClient.reserve({
                orderId: String(orderId),
                items: [{ productId: String(selectedMedicine.productId), quantity: chosenQuantity }],
                tenantId, branchId, userId: customerId,
                idempotencyKey: `medicine-request-order:${String(orderId)}`
            });
            if (inventoryReservation.status !== 'RESERVED' || !inventoryReservation.reservationId) {
                throw inventoryError('Inventory could not reserve the selected proposal product. Refresh the proposal and retry.', 409);
            }
        }

        const orderItems = [
            {
                name: itemName,
                productName: chosenName,
                productId: selectedProductId,
                medicineId: selectedProductId || null,
                sku: selectedMedicine?.sku || (selectedProductId ? 'CATALOGUE' : 'MR-ARRANGED'),
                quantity: chosenQuantity,
                unitPrice: unitPrice,
                price: unitPrice,
                totalPrice: orderTotal
            }
        ];

        const now = new Date();
        const orderData = {
            _id: orderId,
            userId: customerId,
            customerId,
            customerName: request.customerName,
            customerMobile: request.customerPhone || '',
            items: orderItems,
            medicineItems: reservedMedicineItems,
            tenantId: request.tenantId || null,
            branchId: request.branchId || user?.branchId || null,
            inventoryReservationId: inventoryReservation?.reservationId || null,
            inventoryReservationStatus: inventoryReservation ? 'RESERVED' : null,
            prescriptionUrl: request.prescriptionUrl || null,
            prescriptionId: request.prescriptionId || null,
            patientPuid: request.patientPuid || null,
            prescriptionRequired: Boolean(request.prescriptionId || request.prescriptionUrl || selectedMedicine?.requiresPrescription || selectedMedicine?.isPrescriptionRequired),
            prescriptionVerification,
            subtotal: orderTotal,
            totalAmount: orderTotal,
            finalTotal: orderTotal,
            deliveryAddress: request.deliveryAddress,
            addressDetails: request.addressDetails || {},
            coordinates: request.coordinates || null,
            paymentMethod: 'Cash on Delivery (COD)',
            orderStatus: 'Processing Order',
            status: 'accepted',
            source: 'MEDICINE_REQUEST',
            medicineRequestId: String(request._id),
            deliverySlot: proposal.deliverySlot || null,
            statusHistory: [
                {
                    previousStatus: null,
                    newStatus: 'Processing Order',
                    changedBy: 'Pharmacist Proposal Approval',
                    timestamp: now,
                    notes: `Created from approved medicine request #${request.requestNumber}. Proposed slot: ${proposal.deliverySlot?.label || 'Standard'}`
                }
            ]
        };

        let createdOrder = null;

        if (getIsConnected()) {
            let session;
            let updatedRequest;
            try {
                session = await mongoose.startSession();
                await session.withTransaction(async () => {
                    const [created] = await Order.create([orderData], { session });
                    createdOrder = created.toObject();
                    updatedRequest = await MedicineRequest.findOneAndUpdate(
                        { _id: request._id, status: 'PROPOSAL_SENT', convertedOrderId: null },
                        {
                            $set: {
                                status: 'CONVERTED_TO_ORDER',
                                approvedAt: now,
                                convertedOrderId: createdOrder._id.toString(),
                                customerResponse: {
                                    respondedAt: now,
                                    responseNote: approvalNote || 'Customer approved pharmacy proposal'
                                }
                            },
                            $push: {
                                auditTrail: [
                                    {
                                        action: 'CUSTOMER_APPROVED',
                                        actorId: customerId,
                                        role: 'Customer',
                                        timestamp: now,
                                        notes: selectedAlternative ? 'Customer accepted an explicitly selected alternative product.' : 'Customer approved pharmacy proposal.'
                                    },
                                    {
                                        action: 'REQUEST_CONVERTED_TO_ORDER',
                                        actorId: customerId,
                                        role: 'Customer',
                                        timestamp: now,
                                        notes: `Converted to active Order #${createdOrder._id.toString()}`
                                    }
                                ]
                            }
                        },
                        { new: true, session }
                    ).lean();
                    if (!updatedRequest) throw inventoryError('This medicine request was already processed. Refresh your requests and orders.', 409);
                });
            } catch (error) {
                if (inventoryReservation?.reservationId) {
                    try {
                        await inventoryClient.release(inventoryReservation.reservationId, {
                            tenantId: request.tenantId, branchId: request.branchId || user?.branchId,
                            userId: customerId,
                            idempotencyKey: `medicine-request-release-after-failure:${String(request._id)}`
                        });
                    } catch (releaseError) {
                        console.error('Medicine request conversion failed and inventory release also failed:', releaseError.message);
                    }
                }
                throw error;
            } finally {
                if (session) await session.endSession();
            }

            this.logAudit(customerId, 'CONVERT_REQUEST_TO_ORDER', 'ORDER', createdOrder._id.toString(), {
                requestNumber: request.requestNumber,
                finalTotal: orderTotal
            });

            // Trigger Notifications
            try {
                await sendWhatsAppMedicineRequestAlert(updatedRequest, 'MedicineRequestApproved');
                await sendCustomWhatsAppAlert(createdOrder, 'Placed');
            } catch (err) {
                console.warn('[WhatsApp] Alerts failed during order conversion:', err.message);
            }

            return {
                order: createdOrder,
                request: updatedRequest,
                alreadyConverted: false,
                message: `🎉 Proposal approved! Order #${String(createdOrder._id).slice(-6).toUpperCase()} registered for fulfillment.`
            };
        }

        // In-memory branch
        createdOrder = {
            ...orderData,
            createdAt: now,
            updatedAt: now
        };
        inMemoryOrders.unshift(createdOrder);

        request.status = 'CONVERTED_TO_ORDER';
        request.approvedAt = now;
        request.convertedOrderId = String(createdOrder._id);
        request.customerResponse = {
            respondedAt: now,
            responseNote: approvalNote || 'Customer approved pharmacy proposal'
        };
        request.auditTrail.push(
            {
                action: 'CUSTOMER_APPROVED',
                actorId: customerId,
                role: 'Customer',
                timestamp: now,
                notes: 'Customer approved proposal'
            },
            {
                action: 'REQUEST_CONVERTED_TO_ORDER',
                actorId: customerId,
                role: 'Customer',
                timestamp: now,
                notes: `Converted to active Order #${String(createdOrder._id)}`
            }
        );

        this.logAudit(customerId, 'CONVERT_REQUEST_TO_ORDER', 'ORDER', String(createdOrder._id), {
            requestNumber: request.requestNumber,
            finalTotal: orderTotal
        });

        // Trigger Notifications
        try {
            await sendWhatsAppMedicineRequestAlert(request, 'MedicineRequestApproved');
            await sendCustomWhatsAppAlert(createdOrder, 'Placed');
        } catch (err) {
            console.warn('[WhatsApp] Alerts failed during order conversion:', err.message);
        }

        return {
            success: true,
            order: createdOrder,
            request,
            alreadyConverted: false,
            message: `🎉 Proposal approved! Order #${String(createdOrder._id).slice(-6).toUpperCase()} registered for fulfillment.`
        };
    },

    async approveProposalAndConvertToOrder(id, param2, param3) {
        return this.approveMedicineProposalAndConvertToOrder(id, param2, param3);
    },

    async getMedicineRequestMetrics(user = null) {
        const actor = user || { app_metadata: { role: 'admin' } };
        const requests = await this.getMedicineRequests({}, actor);

        const total = requests.length;
        const requested = requests.filter(r => r.status === 'REQUESTED').length;
        const underReview = requests.filter(r => r.status === 'UNDER_REVIEW').length;
        const proposalSent = requests.filter(r => r.status === 'PROPOSAL_SENT').length;
        const converted = requests.filter(r => ['CUSTOMER_APPROVED', 'CONVERTED_TO_ORDER'].includes(r.status)).length;
        const customerRejected = requests.filter(r => r.status === 'CUSTOMER_REJECTED').length;
        const pharmacyRejected = requests.filter(r => r.status === 'PHARMACY_REJECTED').length;
        const expired = requests.filter(r => r.status === 'EXPIRED').length;

        const resolved = converted + customerRejected;
        const acceptanceRate = resolved > 0 ? Math.round((converted / resolved) * 100) : 0;

        return {
            totalRequests: total,
            pendingReviewCount: requested,
            underReviewCount: underReview,
            proposalsSentCount: proposalSent,
            convertedCount: converted,
            customerRejectedCount: customerRejected,
            pharmacyRejectedCount: pharmacyRejected,
            expiredCount: expired,
            proposalAcceptanceRate: acceptanceRate
        };
    }
};

export default dataStore;
