// Comprehensive in-memory and MongoDB data store layer
import { getIsConnected } from './config/db.js';
import mongoose from 'mongoose';
import Medicine from './models/Medicine.js';
import Order from './models/Order.js';
import Coupon from './models/Coupon.js';
import UserProfile from './models/UserProfile.js';
import UserAddress from './models/UserAddress.js';
import CustomerPointsLedger from './models/CustomerPointsLedger.js';
import Rider from './models/Rider.js';
import MedicineRequest from './models/MedicineRequest.js';
import { normalizeWhatsAppNumber, sendWhatsAppMedicineRequestAlert, sendCustomWhatsAppAlert } from './config/whatsapp.js';
import ProfitMarginRewardEngine from './strategies/ProfitMarginRewardEngine.js';
import DefaultProfitRewardStrategy from './strategies/ProfitRewardStrategy.js';
import FixedDeliveryRewardStrategy from './strategies/DeliveryRewardStrategy.js';
import { verifyPrescriptionAgainstItems } from './services/prescription-verification/PrescriptionVerificationService.js';

const profitMarginRewardEngine = new ProfitMarginRewardEngine({
    strategy: new DefaultProfitRewardStrategy()
});
const deliveryRewardStrategy = new FixedDeliveryRewardStrategy();

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
        { $match: { requestNumber: /^MR-\\d+$/ } },
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

const deductMongoOrderInventory = async (order, session) => {
    if (orderInventoryWasDeducted(order)) return;
    const items = getOrderInventoryItems(order);
    if (!items.length) {
        if (order.source === 'MEDICINE_REQUEST') {
            order.inventoryDeductedAt = new Date();
            return;
        }
        throw inventoryError('Order has no inventory records to deduct.', 409);
    }
    for (const item of items) {
        const medicineId = item.medicineId;
        const quantity = Number(item.quantity);
        if (!mongoose.isValidObjectId(medicineId) || !Number.isInteger(quantity) || quantity < 1) {
            if (order.source === 'MEDICINE_REQUEST') {
                continue; // Procured externally, no catalog deduction needed
            }
            throw inventoryError('Could not safely deduct stock for this order.', 409);
        }
        const medExists = await Medicine.findById(medicineId).session(session);
        if (!medExists && order.source === 'MEDICINE_REQUEST') {
            continue;
        }
        const result = await Medicine.collection.updateOne({
            _id: new mongoose.Types.ObjectId(medicineId),
            $expr: {
                $and: [
                    { $gte: [{ $ifNull: ['$reservedQuantity', 0] }, quantity] },
                    { $gte: [{ $ifNull: ['$stockQuantity', { $ifNull: ['$stock', '$quantity'] }] }, quantity] }
                ]
            }
        }, [{
            $set: {
                stockQuantity: {
                    $subtract: [{ $ifNull: ['$stockQuantity', { $ifNull: ['$stock', '$quantity'] }] }, quantity]
                },
                stock: {
                    $subtract: [{ $ifNull: ['$stockQuantity', { $ifNull: ['$stock', '$quantity'] }] }, quantity]
                },
                quantity: {
                    $subtract: [{ $ifNull: ['$stockQuantity', { $ifNull: ['$stock', '$quantity'] }] }, quantity]
                },
                reservedQuantity: {
                    $subtract: [{ $ifNull: ['$reservedQuantity', 0] }, quantity]
                }
            }
        }], { session });
        if (result.modifiedCount !== 1) {
            if (order.source === 'MEDICINE_REQUEST') continue;
            throw inventoryError('Reserved stock is no longer available for dispatch.', 409);
        }
    }
    order.inventoryDeductedAt = new Date();
};

const deductInMemoryOrderInventory = (order) => {
    if (orderInventoryWasDeducted(order)) return;
    const items = getOrderInventoryItems(order);
    if (!items.length) {
        if (order.source === 'MEDICINE_REQUEST') {
            order.inventoryDeductedAt = new Date();
            return;
        }
        throw inventoryError('Order has no inventory records to deduct.', 409);
    }
    const medicineItems = [];
    for (const item of items) {
        const medicineId = item.medicineId;
        const quantity = Number(item.quantity);
        const medicine = inMemoryMedicines.find(entry => String(entry._id) === String(medicineId));
        if (!medicine) {
            if (order.source === 'MEDICINE_REQUEST') continue;
            throw inventoryError('Reserved stock is no longer available for dispatch.', 409);
        }
        if (!Number.isInteger(quantity) || quantity < 1
            || getReservedStock(medicine) < quantity || getPhysicalStock(medicine) < quantity) {
            if (order.source === 'MEDICINE_REQUEST') continue;
            throw inventoryError('Reserved stock is no longer available for dispatch.', 409);
        }
        medicineItems.push({ medicine, quantity });
    }
    for (const { medicine, quantity } of medicineItems) {
        const remainingStock = getPhysicalStock(medicine) - quantity;
        medicine.stockQuantity = remainingStock;
        medicine.stock = remainingStock;
        medicine.quantity = remainingStock;
        medicine.reservedQuantity = getReservedStock(medicine) - quantity;
    }
    order.inventoryDeductedAt = new Date();
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

    async getInventoryAudits(page = 1, limit = 10) {
        const parsedLimit = Math.min(50, Math.max(1, Number(limit) || 10));
        const parsedPage = Math.max(1, Number(page) || 1);
        const deliveredOrders = getIsConnected()
            ? await Order.find({ orderStatus: 'Delivered' })
                .select('_id deliveredAt createdAt customerName statusHistory medicineItems items')
                .sort({ deliveredAt: -1, createdAt: -1 })
                .lean()
            : inMemoryOrders.filter(order => order.orderStatus === 'Delivered')
                .sort((a, b) => new Date(b.deliveredAt || b.createdAt) - new Date(a.deliveredAt || a.createdAt));
        const deliveryAudits = deliveredOrders.flatMap(order => {
            const actor = order.statusHistory?.findLast?.(entry => entry.newStatus === 'Delivered')?.changedBy || 'Delivery';
            return getOrderInventoryItems(order).map(item => ({
                eventType: 'DELIVERY',
                importId: `ORDER-${String(order._id).slice(-8).toUpperCase()}`,
                orderId: String(order._id),
                timestamp: order.deliveredAt || order.createdAt,
                sku: item.sku || item.code || '—',
                name: item.name || item.productName || 'Medicine',
                quantity: Number(item.quantity) || 0,
                previousStock: null,
                newStock: null,
                previousPrice: Number(item.price ?? item.unitPrice) || 0,
                newPrice: Number(item.price ?? item.unitPrice) || 0,
                adminId: actor
            }));
        });
        const allAudits = [...inMemoryInventoryAudits, ...deliveryAudits].sort(
            (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
        );
        const total = allAudits.length;
        const totalPages = Math.ceil(total / parsedLimit) || 1;
        const currentPage = Math.min(parsedPage, totalPages);
        return {
            items: allAudits.slice((currentPage - 1) * parsedLimit, currentPage * parsedLimit),
            page: currentPage,
            limit: parsedLimit,
            total,
            totalPages,
            hasNextPage: currentPage < totalPages,
            hasPreviousPage: currentPage > 1
        };
    },

    // Medicines: Supports server-side pagination & "out-of-stock only on search" logic
    async getMedicines(search = '', hideRx = false, category = 'All', sort = 'default', page = 1, limit = 16, includeOutOfStock = false) {
        const isSearching = Boolean(search && search.toString().trim() !== '');
        const parsedPage = Math.max(1, Number(page) || 1);
        const parsedLimit = Math.max(1, Number(limit) || 16);

        if (getIsConnected()) {
            const filter = {};
            filter.isActive = { $ne: false };
            if (isSearching) {
                const escapedSearch = search.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                filter.$or = [
                    { name: { $regex: escapedSearch, $options: 'i' } },
                    { brand: { $regex: escapedSearch, $options: 'i' } },
                    { composition: { $regex: escapedSearch, $options: 'i' } },
                    { sku: { $regex: escapedSearch, $options: 'i' } }
                ];
            } else if (!includeOutOfStock) {
                filter.expiryDate = { $gt: new Date() };
                filter.$expr = {
                    $gt: [
                        {
                            $subtract: [
                                { $ifNull: ['$stockQuantity', { $ifNull: ['$stock', '$quantity'] }] },
                                { $ifNull: ['$reservedQuantity', 0] }
                            ]
                        },
                        0
                    ]
                };
            }
            if (hideRx === 'true' || hideRx === true) {
                filter.$nor = [{ isPrescriptionRequired: true }, { requiresPrescription: true }];
            }
            if (category && category !== 'All') filter.category = category;

            const sortOptions = {
                'price-asc': { price: 1 },
                'price-desc': { price: -1 },
                'name-asc': { name: 1 },
                'stock-asc': { stockQuantity: 1 },
                default: { name: 1 }
            };
            const [total, medicines] = await Promise.all([
                Medicine.countDocuments(filter),
                Medicine.find(filter)
                    .sort(sortOptions[sort] || sortOptions.default)
                    .skip((parsedPage - 1) * parsedLimit)
                    .limit(parsedLimit)
            ]);
            return {
                medicines: medicines.map(formatMedicine),
                total,
                page: parsedPage,
                limit: parsedLimit,
                totalPages: Math.ceil(total / parsedLimit) || 1,
                isSearching,
                outOfStockHidden: !isSearching && !includeOutOfStock
            };
        }

        let filtered = inMemoryMedicines;

        // RULE: If search query is provided, out-of-stock items can display (with SOLD OUT badge).
        // If not searching, out-of-stock items are hidden from general browsing!
        if (!isSearching && !includeOutOfStock) {
            filtered = filtered.filter(m => {
                if (m.isActive === false) return false;
                const stock = getPhysicalStock(m) - getReservedStock(m);
                return stock > 0 && !m.isExpired;
            });
        } else {
            filtered = filtered.filter(m => m.isActive !== false);
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
            filtered = [...filtered].sort((a, b) =>
                (getPhysicalStock(a) - getReservedStock(a)) - (getPhysicalStock(b) - getReservedStock(b)));
        }

        // Pagination Calculations
        const total = filtered.length;
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
        const inventory = getIsConnected() ? await Medicine.find() : inMemoryMedicines;
        const allMeds = inventory.map(formatMedicine);
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
        if (getIsConnected() && await Medicine.countDocuments() === 0) {
            const mongoCatalog = inMemoryMedicines.map(({ _id, ...medicine }) => ({
                ...medicine,
                code: medicine.sku,
                stockQuantity: getPhysicalStock(medicine),
                reservedQuantity: 0,
                isPrescriptionRequired: Boolean(medicine.requiresPrescription)
            }));
            await Medicine.insertMany(mongoCatalog, { ordered: false });
        }
        this.logAudit('Admin', 'SEED_MEDICINES', 'INVENTORY', 'ALL', { count: inMemoryMedicines.length });
        return inMemoryMedicines;
    },

    async ensureCatalogSeeded() {
        if (!getIsConnected() || await Medicine.countDocuments() > 0) return;
        const mongoCatalog = defaultMedicines.map(({ _id, ...medicine }) => ({
            ...medicine,
            code: medicine.sku,
            stockQuantity: getPhysicalStock(medicine),
            reservedQuantity: 0,
            isPrescriptionRequired: Boolean(medicine.requiresPrescription)
        }));
        await Medicine.insertMany(mongoCatalog, { ordered: false });
        console.log(`Initialized MongoDB medicine catalog with ${mongoCatalog.length} medicines.`);
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
            const subCategory = (row['Sub-category'] || row.SubCategory || row.subCategory || 'Unclassified').toString().trim();
            const description = (row.Description || row.description || '').toString().trim();
            const brand = (row.Brand || row.brand || row.Manufacturer || 'Generic').toString().trim();
            const manufacturer = (row.Manufacturer || row.manufacturer || brand).toString().trim();
            const price = Number(row.Price || row.price) || 50;
            const rawBaseCostPrice = row['Base Cost Price'] ?? row.baseCostPrice;
            const baseCostPrice = rawBaseCostPrice === undefined || rawBaseCostPrice === ''
                ? price
                : Number(rawBaseCostPrice);
            if (!Number.isFinite(baseCostPrice) || baseCostPrice < 0) {
                throw inventoryError(`Invalid base cost price for ${name}.`);
            }
            const requestedMarginTier = String(row['Margin Tier'] || row.marginTier || 'LOW').trim().toUpperCase();
            if (!['LOW', 'MID', 'HIGH'].includes(requestedMarginTier)) {
                throw inventoryError(`Invalid margin tier for ${name}.`);
            }
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
                prev.stockQuantity = prev.stock;
                prev.price = price;
                prev.baseCostPrice = baseCostPrice;
                prev.marginTier = requestedMarginTier;
                prev.expiryDate = expiryDate;
                prev.batchNumber = batchNumber;
                prev.category = category;
                prev.subCategory = subCategory;
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
                    subCategory,
                    description,
                    composition: "Active Formulation",
                    price,
                    baseCostPrice,
                    marginTier: requestedMarginTier,
                    quantity: stock,
                    stock,
                    stockQuantity: stock,
                    reservedQuantity: 0,
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

            if (getIsConnected()) {
                const existingMedicine = await Medicine.findOne({
                    $or: [{ sku }, { name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }]
                });
                if (existingMedicine) {
                    await Medicine.collection.updateOne({ _id: existingMedicine._id }, [{
                        $set: {
                            stockQuantity: {
                                $add: [{ $ifNull: ['$stockQuantity', { $ifNull: ['$stock', '$quantity'] }] }, stock]
                            },
                            stock: {
                                $add: [{ $ifNull: ['$stockQuantity', { $ifNull: ['$stock', '$quantity'] }] }, stock]
                            },
                            quantity: {
                                $add: [{ $ifNull: ['$stockQuantity', { $ifNull: ['$stock', '$quantity'] }] }, stock]
                            },
                            price,
                            baseCostPrice,
                            marginTier: requestedMarginTier,
                            expiryDate,
                            batchNumber,
                            category,
                            subCategory,
                            description: description || existingMedicine.description,
                            imageUrl,
                            isPrescriptionRequired: requiresPrescription,
                            requiresPrescription
                        }
                    }]);
                } else {
                    await Medicine.create({
                        sku,
                        code: sku,
                        name,
                        brand,
                        category,
                        subCategory,
                        description,
                        composition: 'Active Formulation',
                        price,
                        baseCostPrice,
                        marginTier: requestedMarginTier,
                        stockQuantity: stock,
                        reservedQuantity: 0,
                        stock,
                        quantity: stock,
                        batchNumber,
                        expiryDate,
                        isPrescriptionRequired: requiresPrescription,
                        requiresPrescription,
                        imageUrl,
                        manufacturer
                    });
                }
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
        return this.reserveOrder(orderData, actor);
    },

    async reserveOrder(orderData, actor = 'Customer') {
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
            if (!medicineId || !Number.isInteger(quantity) || quantity < 1) {
                throw inventoryError('Each order item requires a medicineId and a positive whole-number quantity.');
            }
            quantities.set(medicineId, (quantities.get(medicineId) || 0) + quantity);
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
            const session = await mongoose.startSession();
            let createdOrder;
            try {
                await session.withTransaction(async () => {
                    const medicineItems = [];
                    const itemSnapshots = [];
                    let totalAmount = 0;
                    let prescriptionRequired = false;

                    for (const [medicineId, quantity] of quantities) {
                        if (!mongoose.isValidObjectId(medicineId)) {
                            throw inventoryError(`Invalid medicine ID: ${medicineId}`);
                        }
                        const medicine = await Medicine.findById(medicineId).session(session);
                        if (!medicine) throw inventoryError(`Medicine ${medicineId} was not found.`, 404);
                        if (medicine.expiryDate && new Date(medicine.expiryDate) <= now) {
                            throw inventoryError(`${medicine.name} is expired and cannot be ordered.`);
                        }
                        const medicineRequiresPrescription = Boolean(medicine.isPrescriptionRequired ?? medicine.requiresPrescription);
                        prescriptionRequired ||= medicineRequiresPrescription;
                        if (medicineRequiresPrescription && !orderData.prescriptionUrl) {
                            throw inventoryError(`A prescription is required for ${medicine.name}.`);
                        }

                        const reserved = await Medicine.findOneAndUpdate({
                            _id: medicine._id,
                            expiryDate: { $gt: now },
                            $expr: {
                                $gte: [
                                    {
                                        $subtract: [
                                            { $ifNull: ['$stockQuantity', { $ifNull: ['$stock', '$quantity'] }] },
                                            { $ifNull: ['$reservedQuantity', 0] }
                                        ]
                                    },
                                    quantity
                                ]
                            }
                        }, {
                            $inc: { reservedQuantity: quantity }
                        }, { new: true, session });

                        if (!reserved) {
                            throw inventoryError(`Insufficient available stock for ${medicine.name}.`, 409);
                        }

                        const price = Number(medicine.price);
                        totalAmount += price * quantity;
                        medicineItems.push({
                            medicineId: medicine._id,
                            quantity,
                            price,
                            baseCostPrice: Number(medicine.baseCostPrice ?? price),
                            discountPercentage: Number(medicine.discountPercentage || 0),
                            marginTier: ['LOW', 'MID', 'HIGH'].includes(medicine.marginTier)
                                ? medicine.marginTier
                                : 'LOW',
                            name: medicine.name,
                            sku: medicine.sku || medicine.code || ''
                        });
                        itemSnapshots.push({
                            _id: medicine._id.toString(),
                            medicineId: medicine._id,
                            name: medicine.name,
                            sku: medicine.sku || medicine.code || '',
                            price,
                            baseCostPrice: Number(medicine.baseCostPrice ?? price),
                            discountPercentage: Number(medicine.discountPercentage || 0),
                            marginTier: ['LOW', 'MID', 'HIGH'].includes(medicine.marginTier)
                                ? medicine.marginTier
                                : 'LOW',
                            quantity,
                            stock: Math.max(0, getPhysicalStock(medicine) - getReservedStock(medicine) - quantity)
                        });
                    }

                    const coupon = await this.validateCoupon(orderData.couponCode || '', totalAmount, { customerId: orderData.userId, tenantId: orderData.tenantId });
                    if (!coupon.valid) throw inventoryError(coupon.message || 'Coupon is invalid.');
                    const discountApplied = Number(coupon.discountAmount
                        ?? (totalAmount * (coupon.discountPercentage || 0) / 100));
                    const couponRate = totalAmount > 0 ? discountApplied / totalAmount : 0;
                    const rewardItems = medicineItems.map(item => ({
                        currentPrice: item.price * (1 - couponRate),
                        baseCostPrice: item.baseCostPrice,
                        marginTier: item.marginTier,
                        quantity: item.quantity,
                        isDiscounted: couponRate > 0 || Number(item.discountPercentage || 0) > 0
                    }));
                    const earnedPoints = profitMarginRewardEngine.calculateEarnedPoints(rewardItems);
                    const orderId = new mongoose.Types.ObjectId();
                    let allowedPoints = 0;
                    let pointsDiscount = 0;
                    let redemptionWarning = null;
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
                    const [order] = await Order.create([{
                        _id: orderId,
                        userId: orderData.userId,
                        customerId: orderData.userId,
                        tenantId: orderData.tenantId || null,
                        branchId: orderData.branchId || null,
                        addressId: orderData.addressId || null,
                        customerName: orderData.customerName,
                        orderedByName: orderData.customerName || 'Valued Customer',
                        orderedForName: orderData.orderedForName || orderData.customerName || 'Valued Customer',
                        orderedForRelationship: orderData.orderedForRelationship || 'SELF',
                        patientPuid: orderData.patientPuid || null,
                        customerMobile: orderData.customerMobile || '',
                        medicineItems,
                        items: itemSnapshots,
                        prescriptionUrl: orderData.prescriptionUrl || null,
                        prescriptionId: orderData.prescriptionId || null,
                        prescriptionRequired,
                        couponCode: coupon.code || orderData.couponCode || null,
                        subtotal: totalAmount,
                        discountApplied,
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
                        orderStatus: 'Pending_Review',
                        statusHistory: [statusEntry]
                    }], { session });
                    createdOrder = order.toObject({ virtuals: true });
                    createdOrder.rewardNotice = redemptionWarning;
                });
            } finally {
                await session.endSession();
            }

            this.logAudit(actor, 'ORDER_CREATED', 'ORDER', createdOrder._id.toString(), {
                totalAmount: createdOrder.totalAmount,
                itemCount: createdOrder.medicineItems.length,
                inventoryAction: 'RESERVED'
            });
            return createdOrder;
        }

        const reservedMedicines = [];
        try {
            const medicineItems = [];
            const itemSnapshots = [];
            let totalAmount = 0;
            let prescriptionRequired = false;

            for (const [medicineId, quantity] of quantities) {
                const medicine = inMemoryMedicines.find(item => String(item._id) === medicineId);
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
                const price = Number(medicine.price);
                totalAmount += price * quantity;
                medicineItems.push({
                    medicineId,
                    quantity,
                    price,
                    name: medicine.name,
                    sku: medicine.sku || medicine.code || ''
                });
                itemSnapshots.push({
                    _id: medicineId,
                    medicineId,
                    name: medicine.name,
                    sku: medicine.sku || medicine.code || '',
                    price,
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
                customerName: orderData.customerName,
                orderedByName: orderData.customerName || 'Valued Customer',
                orderedForName: orderData.orderedForName || orderData.customerName || 'Valued Customer',
                patientPuid: orderData.patientPuid || null,
                customerMobile: orderData.customerMobile || '',
                medicineItems,
                items: itemSnapshots,
                prescriptionUrl: orderData.prescriptionUrl || null,
                prescriptionRequired,
                couponCode: coupon.code || orderData.couponCode || null,
                tenantId: orderData.tenantId || null,
                subtotal: totalAmount,
                discountApplied,
                totalAmount: finalTotal,
                finalTotal,
                deliveryAddress: orderData.deliveryAddress,
                addressDetails: orderData.addressDetails || {},
                coordinates: orderData.coordinates,
                paymentMethod: orderData.paymentMethod || 'Cash on Delivery (COD)',
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

                    if (status === 'Rejected') {
                        for (const item of order.medicineItems) {
                            const quantity = Number(item.quantity);
                            const result = await Medicine.updateOne({
                                _id: item.medicineId,
                                $expr: { $gte: [{ $ifNull: ['$reservedQuantity', 0] }, quantity] }
                            }, { $inc: { reservedQuantity: -quantity } }, { session });
                            if (result.modifiedCount !== 1) {
                                throw inventoryError('Could not safely release reserved medicine stock.', 409);
                            }
                        }
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
            for (const item of order.medicineItems || []) {
                const medicine = inMemoryMedicines.find(entry => String(entry._id) === String(item.medicineId));
                if (!medicine || getReservedStock(medicine) < item.quantity) {
                    throw inventoryError('Could not safely release reserved medicine stock.', 409);
                }
            }
            for (const item of order.medicineItems || []) {
                const medicine = inMemoryMedicines.find(entry => String(entry._id) === String(item.medicineId));
                medicine.reservedQuantity -= item.quantity;
            }
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

                    const legacyStockRestored = !order.medicineItems?.length;
                    if (order.medicineItems?.length) {
                        for (const item of order.medicineItems) {
                            const quantity = Number(item.quantity);
                            const result = await Medicine.updateOne({
                                _id: item.medicineId,
                                $expr: { $gte: [{ $ifNull: ['$reservedQuantity', 0] }, quantity] }
                            }, { $inc: { reservedQuantity: -quantity } }, { session });
                            if (result.modifiedCount !== 1) {
                                throw inventoryError('Could not safely release reserved medicine stock.', 409);
                            }
                        }
                    } else {
                        if (!order.items?.length) throw inventoryError('Order has no inventory records to release.', 409);
                        for (const item of order.items) {
                            const medicineId = item.medicineId || item._id;
                            const quantity = Number(item.quantity);
                            if (!mongoose.isValidObjectId(medicineId) || !Number.isInteger(quantity) || quantity < 1) {
                                throw inventoryError('Could not safely restore stock for this legacy order.', 409);
                            }
                            const result = await Medicine.collection.updateOne({ _id: new mongoose.Types.ObjectId(medicineId) }, [{
                                $set: {
                                    stockQuantity: {
                                        $add: [{ $ifNull: ['$stockQuantity', { $ifNull: ['$stock', '$quantity'] }] }, quantity]
                                    },
                                    stock: {
                                        $add: [{ $ifNull: ['$stockQuantity', { $ifNull: ['$stock', '$quantity'] }] }, quantity]
                                    },
                                    quantity: {
                                        $add: [{ $ifNull: ['$stockQuantity', { $ifNull: ['$stock', '$quantity'] }] }, quantity]
                                    }
                                }
                            }], { session });
                            if (result.modifiedCount !== 1) throw inventoryError('Could not safely restore legacy order stock.', 409);
                        }
                    }

                    order.orderStatus = 'Cancelled';
                    order.statusHistory.push({
                        previousStatus: order.statusHistory.at(-1)?.newStatus || 'Pending_Review',
                        newStatus: 'Cancelled',
                        changedBy: actor,
                        timestamp: new Date(),
                        notes: legacyStockRestored
                            ? 'Order cancelled; stock restored to inventory.'
                            : 'Order cancelled; reserved inventory released.'
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
        const legacyStockRestored = !order.medicineItems?.length;
        if (order.medicineItems?.length) {
            for (const item of order.medicineItems) {
                const medicine = inMemoryMedicines.find(entry => String(entry._id) === String(item.medicineId));
                if (!medicine || getReservedStock(medicine) < item.quantity) {
                    throw inventoryError('Could not safely release reserved medicine stock.', 409);
                }
            }
            for (const item of order.medicineItems) {
                const medicine = inMemoryMedicines.find(entry => String(entry._id) === String(item.medicineId));
                medicine.reservedQuantity -= item.quantity;
            }
        } else {
            if (!order.items?.length) throw inventoryError('Order has no inventory records to release.', 409);
            for (const item of order.items) {
                const medicineId = item.medicineId || item._id;
                const quantity = Number(item.quantity);
                const medicine = inMemoryMedicines.find(entry => String(entry._id) === String(medicineId));
                if (!medicine || !Number.isInteger(quantity) || quantity < 1) {
                    throw inventoryError('Could not safely restore stock for this legacy order.', 409);
                }
            }
            for (const item of order.items) {
                const medicine = inMemoryMedicines.find(entry => String(entry._id) === String(item.medicineId || item._id));
                const restoredStock = getPhysicalStock(medicine) + Number(item.quantity);
                medicine.stockQuantity = restoredStock;
                medicine.stock = restoredStock;
                medicine.quantity = restoredStock;
            }
        }
        const previousStatus = order.orderStatus;
        order.orderStatus = 'Cancelled';
        order.statusHistory.push({
            previousStatus,
            newStatus: 'Cancelled',
            changedBy: actor,
            timestamp: new Date(),
            notes: legacyStockRestored
                ? 'Order cancelled; stock restored to inventory.'
                : 'Order cancelled; reserved inventory released.'
        });
        return order;
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

    async getAllOrders() {
        if (getIsConnected()) {
            return Order.find().sort({ createdAt: -1 }).lean();
        }
        return [...inMemoryOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    async getDeliveredOrdersPage(page = 1, limit = 5) {
        const filter = { orderStatus: 'Delivered' };
        if (getIsConnected()) {
            const total = await Order.countDocuments(filter);
            const safePage = Math.min(page, Math.max(Math.ceil(total / limit), 1));
            const items = await Order.find(filter)
                .sort({ createdAt: -1, _id: -1 })
                .skip((safePage - 1) * limit)
                .limit(limit)
                .lean();
            return { items, total, page: safePage };
        }
        const delivered = inMemoryOrders
            .filter(order => order.orderStatus === 'Delivered')
            .sort((a, b) => {
                const createdAtDelta = new Date(b.createdAt) - new Date(a.createdAt);
                return createdAtDelta || String(b._id || '').localeCompare(String(a._id || ''));
            });
        return {
            items: delivered.slice((Math.min(page, Math.max(Math.ceil(delivered.length / limit), 1)) - 1) * limit, Math.min(page, Math.max(Math.ceil(delivered.length / limit), 1)) * limit),
            total: delivered.length,
            page: Math.min(page, Math.max(Math.ceil(delivered.length / limit), 1))
        };
    },

    async getFulfillmentSnapshot(page = 1, limit = 10) {
        const activeFilter = { orderStatus: { $nin: ['Delivered', 'delivered'] } };
        const parsedLimit = Math.min(50, Math.max(1, Number(limit) || 10));
        const parsedPage = Math.max(1, Number(page) || 1);
        if (getIsConnected()) {
            const [activeTotal, total, deliveredCount, items, recentOrders] = await Promise.all([
                Order.countDocuments(activeFilter),
                Order.countDocuments({}),
                Order.countDocuments({ orderStatus: 'Delivered' }),
                Order.find(activeFilter).sort({ createdAt: -1, _id: -1 }).skip((parsedPage - 1) * parsedLimit).limit(parsedLimit).lean(),
                Order.find().sort({ createdAt: -1, _id: -1 }).limit(6).lean()
            ]);
            const totalPages = Math.ceil(activeTotal / parsedLimit) || 1;
            const currentPage = Math.min(parsedPage, totalPages);
            return {
                items, total, activeTotal, deliveredCount, recentOrders,
                pagination: { page: currentPage, limit: parsedLimit, total: activeTotal, totalPages, hasNextPage: currentPage < totalPages, hasPreviousPage: currentPage > 1 }
            };
        }
        const allOrders = [...inMemoryOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const activeOrders = allOrders.filter(order => !['Delivered', 'delivered'].includes(order.orderStatus));
        const activeTotal = activeOrders.length;
        const totalPages = Math.ceil(activeTotal / parsedLimit) || 1;
        const currentPage = Math.min(parsedPage, totalPages);
        return {
            items: activeOrders.slice((currentPage - 1) * parsedLimit, currentPage * parsedLimit),
            total: allOrders.length,
            activeTotal,
            deliveredCount: allOrders.filter(order => order.orderStatus === 'Delivered').length,
            recentOrders: allOrders.slice(0, 6),
            pagination: { page: currentPage, limit: parsedLimit, total: activeTotal, totalPages, hasNextPage: currentPage < totalPages, hasPreviousPage: currentPage > 1 }
        };
    },

    async searchOrders({ type, value, page = 1, limit = 5 }) {
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
            const total = await Order.countDocuments(filter);
            const safePage = Math.min(page, Math.max(Math.ceil(total / limit), 1));
            const items = await Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip((safePage - 1) * limit).limit(limit).lean();
            return { items, total, page: safePage };
        }

        const matches = inMemoryOrders.filter(order => {
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
            return Order.find({ userId }).sort({ createdAt: -1 }).lean();
        }
        return inMemoryOrders.filter(o => o.userId === userId)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    async getOrders(userId) {
        if (userId) return this.getUserOrders(userId);
        return this.getAllOrders();
    },

    async getOrder(orderId) {
        if (getIsConnected()) {
            return Order.findById(orderId).lean();
        }
        return inMemoryOrders.find(item => String(item._id) === String(orderId)) || null;
    },

    async getOrderById(orderId) {
        return this.getOrder(orderId);
    },

    async transitionOrderStatus(orderId, newStatus, actor = 'Pharmacist', riderInfo = null, cashCollectionStatus = null) {
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
                order.ratingPromptPending = onTime;
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

    async createMedicine(medicineData) {
        const stockQuantity = Number(medicineData.stockQuantity ?? medicineData.quantity ?? medicineData.stock ?? 0);
        const baseCostPrice = Number(medicineData.baseCostPrice ?? medicineData.price);
        const discountPercentage = Number(medicineData.discountPercentage ?? 0);
        const marginTier = medicineData.marginTier || 'LOW';
        if (!medicineData.name?.trim() || !medicineData.brand?.trim()
            || !Number.isFinite(Number(medicineData.price)) || Number(medicineData.price) < 0
            || !Number.isFinite(baseCostPrice) || baseCostPrice < 0
            || !Number.isFinite(discountPercentage) || discountPercentage < 0 || discountPercentage > 100
            || !['LOW', 'MID', 'HIGH'].includes(marginTier)
            || !Number.isFinite(stockQuantity) || !Number.isInteger(stockQuantity) || stockQuantity < 0
            || !medicineData.expiryDate || Number.isNaN(new Date(medicineData.expiryDate).getTime())) {
            throw inventoryError('Name, brand, valid price/cost/discount, stock, margin tier, and expiry date are required.');
        }
        const normalizedSku = String(medicineData.sku || medicineData.code || '').trim().toUpperCase();
        const values = {
            name: medicineData.name.trim(),
            brand: medicineData.brand.trim(),
            sku: normalizedSku || undefined,
            code: normalizedSku || undefined,
            description: medicineData.description || '',
            composition: medicineData.composition || '',
            category: medicineData.category || 'General Medicine',
            subCategory: medicineData.subCategory || 'Unclassified',
            price: Number(medicineData.price),
            baseCostPrice,
            basePrice: medicineData.basePrice === undefined ? undefined : Number(medicineData.basePrice),
            discountPercentage,
            marginTier,
            stockQuantity,
            stock: stockQuantity,
            quantity: stockQuantity,
            reservedQuantity: 0,
            expiryDate: new Date(medicineData.expiryDate),
            isPrescriptionRequired: Boolean(medicineData.isPrescriptionRequired ?? medicineData.requiresPrescription),
            requiresPrescription: Boolean(medicineData.isPrescriptionRequired ?? medicineData.requiresPrescription),
            imageUrl: medicineData.imageUrl,
            manufacturer: medicineData.manufacturer,
            isActive: true
        };

        if (getIsConnected()) {
            try {
                return (await Medicine.create(values)).toObject({ virtuals: true });
            } catch (error) {
                if (error.code === 11000) throw inventoryError('A medicine with this SKU already exists.', 409);
                throw error;
            }
        }
        if (normalizedSku && inMemoryMedicines.some(medicine => medicine.sku?.toUpperCase() === normalizedSku)) {
            throw inventoryError('A medicine with this SKU already exists.', 409);
        }
        const medicine = { _id: new mongoose.Types.ObjectId().toString(), ...values };
        inMemoryMedicines.unshift(medicine);
        return formatMedicine(medicine);
    },

    async updateMedicine(medicineId, updates) {
        const allowedFields = [
            'name', 'brand', 'sku', 'code', 'description', 'composition', 'category', 'subCategory',
            'price', 'basePrice', 'baseCostPrice', 'discountPercentage', 'marginTier',
            'expiryDate', 'isPrescriptionRequired', 'requiresPrescription',
            'imageUrl', 'manufacturer', 'batchNumber'
        ];
        const values = {};
        for (const field of allowedFields) {
            if (updates[field] !== undefined) values[field] = updates[field];
        }
        const requestedStock = updates.stockQuantity ?? updates.stock ?? updates.quantity;
        if (requestedStock !== undefined) {
            const stock = Number(requestedStock);
            if (!Number.isInteger(stock) || stock < 0) {
                throw inventoryError('Stock quantity must be a non-negative whole number.');
            }
            values.stockQuantity = stock;
            values.stock = stock;
            values.quantity = stock;
        }
        if (values.name !== undefined && !String(values.name).trim()) {
            throw inventoryError('Medicine name cannot be empty.');
        }
        if (values.price !== undefined && (!Number.isFinite(Number(values.price)) || Number(values.price) < 0)) {
            throw inventoryError('Medicine price must be a non-negative number.');
        }
        if (values.price !== undefined) values.price = Number(values.price);
        if (values.basePrice !== undefined) {
            if (!Number.isFinite(Number(values.basePrice)) || Number(values.basePrice) < 0) {
                throw inventoryError('Base price must be a non-negative number.');
            }
            values.basePrice = Number(values.basePrice);
        }
        if (values.baseCostPrice !== undefined) {
            if (!Number.isFinite(Number(values.baseCostPrice)) || Number(values.baseCostPrice) < 0) {
                throw inventoryError('Base cost price must be a non-negative number.');
            }
            values.baseCostPrice = Number(values.baseCostPrice);
        }
        if (values.discountPercentage !== undefined) {
            if (!Number.isFinite(Number(values.discountPercentage))
                || Number(values.discountPercentage) < 0 || Number(values.discountPercentage) > 100) {
                throw inventoryError('Discount percentage must be between 0 and 100.');
            }
            values.discountPercentage = Number(values.discountPercentage);
        }
        if (values.marginTier !== undefined && !['LOW', 'MID', 'HIGH'].includes(values.marginTier)) {
            throw inventoryError('Margin tier must be LOW, MID, or HIGH.');
        }
        if (values.expiryDate !== undefined) {
            const expiryDate = new Date(values.expiryDate);
            if (Number.isNaN(expiryDate.getTime())) throw inventoryError('A valid expiry date is required.');
            values.expiryDate = expiryDate;
        }
        if (values.sku !== undefined || values.code !== undefined) {
            const sku = String(values.sku ?? values.code ?? '').trim().toUpperCase();
            values.sku = sku || undefined;
            values.code = sku || undefined;
        }
        if (values.isPrescriptionRequired !== undefined || values.requiresPrescription !== undefined) {
            const required = Boolean(values.isPrescriptionRequired ?? values.requiresPrescription);
            values.isPrescriptionRequired = required;
            values.requiresPrescription = required;
        }
        if (Object.keys(values).length === 0) throw inventoryError('No valid medicine fields were provided.');

        if (getIsConnected()) {
            if (!mongoose.isValidObjectId(medicineId)) throw inventoryError('Invalid medicine ID.');
            try {
                const medicine = await Medicine.findOneAndUpdate({
                    _id: medicineId,
                    isActive: { $ne: false },
                    ...(values.stockQuantity !== undefined
                        ? { $expr: { $lte: [{ $ifNull: ['$reservedQuantity', 0] }, values.stockQuantity] } }
                        : {})
                }, { $set: values }, { new: true, runValidators: true });
                if (!medicine) {
                    const exists = await Medicine.exists({ _id: medicineId, isActive: { $ne: false } });
                    if (!exists) throw inventoryError('Medicine not found.', 404);
                    throw inventoryError('Physical stock cannot be lower than currently reserved stock.', 409);
                }
                return medicine.toObject({ virtuals: true });
            } catch (error) {
                if (error.code === 11000) throw inventoryError('A medicine with this SKU already exists.', 409);
                throw error;
            }
        }
        const medicine = inMemoryMedicines.find(entry => String(entry._id) === String(medicineId) && entry.isActive !== false);
        if (!medicine) throw inventoryError('Medicine not found.', 404);
        if (values.stockQuantity !== undefined && values.stockQuantity < getReservedStock(medicine)) {
            throw inventoryError('Physical stock cannot be lower than currently reserved stock.', 409);
        }
        if (values.sku && inMemoryMedicines.some(entry =>
            String(entry._id) !== String(medicineId) && entry.sku?.toUpperCase() === values.sku
        )) {
            throw inventoryError('A medicine with this SKU already exists.', 409);
        }
        Object.assign(medicine, values);
        return formatMedicine(medicine);
    },

    async deleteMedicine(medicineId) {
        if (getIsConnected()) {
            if (!mongoose.isValidObjectId(medicineId)) throw inventoryError('Invalid medicine ID.');
            const medicine = await Medicine.findOneAndUpdate({
                _id: medicineId,
                isActive: { $ne: false },
                $expr: { $eq: [{ $ifNull: ['$reservedQuantity', 0] }, 0] }
            }, { $set: { isActive: false } }, { new: true });
            if (medicine) return { _id: medicine._id, deleted: true };
            const exists = await Medicine.exists({ _id: medicineId, isActive: { $ne: false } });
            if (!exists) throw inventoryError('Medicine not found.', 404);
            throw inventoryError('Medicine with reserved inventory cannot be deleted.', 409);
        }
        const medicine = inMemoryMedicines.find(entry => String(entry._id) === String(medicineId) && entry.isActive !== false);
        if (!medicine) throw inventoryError('Medicine not found.', 404);
        if (getReservedStock(medicine) > 0) throw inventoryError('Medicine with reserved inventory cannot be deleted.', 409);
        medicine.isActive = false;
        return { _id: medicine._id, deleted: true };
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
        const eligibleOrders = getIsConnected()
            ? await Order.find({ orderStatus: 'Ready to Dispatch' }).sort({ createdAt: 1 }).lean()
            : inMemoryOrders.filter(o => o.orderStatus === 'Ready to Dispatch');
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
            const created = await MedicineRequest.create(requestDoc);
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
        const isStaff = user && [
            'admin', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN',
            'pharmacy', 'TENANT_ADMIN', 'TENANT_OWNER', 'PHARMACIST', 'PHARMACY_STAFF'
        ].includes(role);

        if (getIsConnected()) {
            const now = new Date();
            // Auto expire past proposals
            await MedicineRequest.updateMany(
                { status: 'PROPOSAL_SENT', expiresAt: { $lt: now } },
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
            } else if (filter.customerId) {
                query.customerId = filter.customerId;
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
        } else if (filter.customerId) {
            list = list.filter(r => r.customerId === filter.customerId);
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
        const isStaff = user && [
            'admin', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN',
            'pharmacy', 'TENANT_ADMIN', 'TENANT_OWNER', 'PHARMACIST', 'PHARMACY_STAFF'
        ].includes(role);

        if (getIsConnected()) {
            const query = {};
            if (!isStaff) {
                query.customerId = user ? user.sub : 'unauthenticated';
            } else if (filter.customerId) {
                query.customerId = filter.customerId;
            }
            if (filter.status && filter.status !== 'ALL') query.status = filter.status;
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
        if (getIsConnected()) {
            request = mongoose.isValidObjectId(id)
                ? await MedicineRequest.findById(id).lean()
                : await MedicineRequest.findOne({ $or: [{ _id: id }, { requestNumber: id }] }).lean();
        } else {
            request = inMemoryMedicineRequests.find(r =>
                String(r._id) === String(id) || r.requestNumber === id
            ) || null;
        }

        if (!request) return null;

        const role = user?.app_metadata?.role || user?.role;
        const isStaff = user && [
            'admin', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN',
            'pharmacy', 'TENANT_ADMIN', 'TENANT_OWNER', 'PHARMACIST',
            'PHARMACY_STAFF', 'ORDER_MANAGER'
        ].includes(role);

        if (user && !isStaff && request.customerId !== (user.sub || user.id)) {
            return null;
        }

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

    async getPendingMedicineRequestCount() {
        if (getIsConnected()) {
            return MedicineRequest.countDocuments({ status: { $in: ['REQUESTED', 'UNDER_REVIEW'] } });
        }
        return inMemoryMedicineRequests.filter(r => ['REQUESTED', 'UNDER_REVIEW'].includes(r.status)).length;
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
    async approveMedicineProposalAndConvertToOrder(id, arg2 = '', arg3) {
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
                        productId: proposal.productId || null,
                        name: proposal.medicineName || '',
                        productName: proposal.medicineName || '',
                        strength: proposal.strength || '',
                        form: proposal.dosageForm || '',
                        quantity: proposal.quantity
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

        const orderTotal = Math.max(0, Math.round(Number(proposal.totalPrice) * 100) / 100);

        const unitPrice = proposal.unitPrice || Math.round((orderTotal / proposal.quantity) * 100) / 100;
        const itemName = proposal.medicineName && proposal.strength && !proposal.medicineName.toLowerCase().includes(proposal.strength.toLowerCase())
            ? `${proposal.medicineName} ${proposal.strength}`
            : proposal.medicineName;

        const orderItems = [
            {
                name: itemName,
                productName: proposal.medicineName,
                sku: 'MR-ARRANGED',
                quantity: proposal.quantity,
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
            medicineItems: [],
            prescriptionUrl: request.prescriptionUrl || null,
            prescriptionId: request.prescriptionId || null,
            patientPuid: request.patientPuid || null,
            prescriptionRequired: Boolean(request.prescriptionId || request.prescriptionUrl),
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
            const [created] = await Order.create([orderData]);
            createdOrder = created.toObject();

            const updatedRequest = await MedicineRequest.findOneAndUpdate(
                { _id: request._id, status: 'PROPOSAL_SENT' },
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
                                notes: 'Customer approved proposal'
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
                { new: true }
            ).lean();

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

    async getMedicineRequestMetrics() {
        const requests = await this.getMedicineRequests({}, { app_metadata: { role: 'admin' } });

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
