import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SERVICE_AUTH_SECRET = 'test-service-secret-with-more-than-thirty-two-characters';

const { detectMedicineDataset, normalizeMedicineRecord, consolidate, parseJsonArrayRecords } = await import('./src/medicine-catalogue-import-routes.js');
const { requireServiceScope } = await import('./src/service-auth.js');
const jwt = (await import('jsonwebtoken')).default;

test('streams JSON arrays one object at a time and preserves escaped/nested content', () => {
  const input = Buffer.from('[{\"id\":\"1\",\"name\":\"A \\\"quoted\\\" tablet\",\"nested\":[{\"x\":1}]},{\"id\":\"2\",\"name\":\"B tablet\"}]');
  const rows = [...parseJsonArrayRecords(input)];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'A \"quoted\" tablet');
  assert.equal(rows[0].nested[0].x, 1);
});

test('detects all three supported medicine dataset structures', () => {
  assert.equal(detectMedicineDataset({ count: 1, drugDetails: [{ brandIdentifier: 'B-1' }] }), 'INDIAN_MEDICINE_DATA');
  assert.equal(detectMedicineDataset([{ 'Medicine Name': 'Test', 'Product Name': 'Test Tablet' }]), 'INDIA_MEDICINES_INFO');
  assert.equal(detectMedicineDataset([{ id: '1', name: 'Example 10mg Tablet', sideEffect0: 'Nausea', use0: 'Example use' }]), 'MEDICINES_PART_1');
  assert.throws(() => detectMedicineDataset({ records: [] }), /unsupported json/i);
});

test('Indian Medicine Dataset preserves brandIdentifier and structured master fields', () => {
  const result = normalizeMedicineRecord({
    brandIdentifier: 'BRAND-EXACT-001',
    brandName: 'Paracetamol 500',
    genericIdentifier: 'GEN-1',
    genericName: 'Paracetamol',
    productIdentifier: 'PROD-1',
    productName: 'Paracetamol 500 mg Tablet',
    supplierIdentifier: 'SUP-1',
    supplierName: 'Example Pharma',
    substanceIdentifier: 'ING-1',
    substanceName: 'Paracetamol',
    doseForm: 'Tablet',
    routeOfAdministrationName: 'Oral',
    alternativeDrugs: ['Brand B'],
    indication: 'Fever',
    contraIndication: 'Severe allergy',
    interactionWithDrugs: '',
    Price: '₹45',
    MRP: '₹50',
    expiryDate: '2030-01-01',
    manufacturingDate: '2026-01-01'
  }, 'INDIAN_MEDICINE_DATA');

  assert.equal(result.medicineId, 'BRAND-EXACT-001');
  assert.equal(result.genericName, 'Paracetamol');
  assert.equal(result.manufacturer, 'Example Pharma');
  assert.deepEqual(result.ingredientIds, ['ING-1']);
  assert.deepEqual(result.ingredients, ['Paracetamol']);
  assert.deepEqual(result.routes, ['Oral']);
  assert.deepEqual(result.alternatives, ['Brand B']);
  assert.equal(result.prescriptionVerification, 'UNVERIFIED');
  assert.equal('price' in result, false);
  assert.equal('expiryDate' in result, false);
  assert.equal('manufacturingDate' in result, false);
});

test('retail-style dataset strips scraped price text and marks prescription metadata unverified', () => {
  const result = normalizeMedicineRecord({
    'Medicine Name': 'Examplecin 500mg',
    'Product Name': 'Examplecin 500mg Tablet (10 tablets) - MRP ₹45.00',
    'Image URL': 'https://images.example.test/product.png',
    'Price': '₹45',
    'Is Prescription Required?': true,
    'Type of Medicine': 'Tablets',
    'Composition': 'Examplecin 500mg + Vitamin C 10mg',
    'Expiry Date': '2030-01-01',
    'Mfg Date': '2026-01-01'
  }, 'INDIA_MEDICINES_INFO');

  assert.equal(result.brandName, 'Examplecin 500mg');
  assert.equal(result.productName, 'Examplecin 500mg Tablet (10 tablets)');
  assert.equal(result.packSize, '10 tablets');
  assert.equal(result.dosageForm, 'Tablet');
  assert.equal(result.medicineType, 'Tablets');
  assert.equal(result.requiresPrescription, true);
  assert.equal(result.prescriptionVerification, 'UNVERIFIED');
  assert.deepEqual(result.ingredients, ['Examplecin 500mg', 'Vitamin C 10mg']);
  assert.equal(result.sourceImageUrl, 'https://images.example.test/product.png');
  assert.equal('price' in result, false);
  assert.equal('expiryDate' in result, false);
  assert.equal('manufacturingDate' in result, false);
});


test('Medicines Part 1 preserves clinical detail, source identity and avoids invented composition', () => {
  const result = normalizeMedicineRecord({
    id: '682',
    name: 'a-ret 0.025% gel',
    substitute0: 'Tronin 0.025% Gel',
    substitute1: 'Renol 0.025% Gel',
    sideEffect0: 'Erythema (skin redness)',
    sideEffect1: 'Skin irritation',
    sideEffect2: '',
    use0: 'Treatment of Acne',
    use1: 'Acute promyelocytic leukaemia',
    'Chemical Class': 'Retinoids',
    'Habit Forming': 'No',
    'Therapeutic Class': 'DERMA',
    'Action Class': 'Retinoids- First generation'
  }, 'MEDICINES_PART_1');

  assert.equal(result.medicineId, 'MEDINFO-682');
  assert.equal(result.sourceRecordId, '682');
  assert.equal(result.brandName, 'a-ret 0.025% gel');
  assert.equal(result.strength, '0.025%');
  assert.equal(result.dosageForm, 'Gel');
  assert.deepEqual(result.sideEffects, ['Erythema (skin redness)', 'Skin irritation']);
  assert.deepEqual(result.uses, ['Treatment of Acne', 'Acute promyelocytic leukaemia']);
  assert.deepEqual(result.suggestedAlternatives, ['Tronin 0.025% Gel', 'Renol 0.025% Gel']);
  assert.equal(result.chemicalClass, 'Retinoids');
  assert.equal(result.habitForming, 'NO');
  assert.equal(result.therapeuticClass, 'DERMA');
  assert.equal(result.actionClass, 'Retinoids- First generation');
  assert.equal(result.composition, '');
  assert.equal(result.manufacturer, '');
  assert.equal(result.sourceImageUrl, '');
  assert.equal(result.dataQualityStatus, 'PARTIAL');
  assert.equal('price' in result, false);
  assert.equal('expiryDate' in result, false);
  assert.equal('manufacturingDate' in result, false);
});

test('Medicines Part 1 removes placeholder metadata and deduplicates only exact matching rows', () => {
  const first = {
    id: '1', name: 'Brand 10mg Tablet', substitute0: 'Brand B Tablet',
    sideEffect0: 'Nausea', use0: 'Treatment A', 'Chemical Class': 'NA',
    'Habit Forming': 'No', 'Therapeutic Class': 'CARDIAC', 'Action Class': 'NA'
  };
  const duplicate = { ...first, id: '2' };
  const conflict = { ...first, id: '3', sideEffect0: 'Headache' };
  const result = consolidate([first, duplicate, conflict].map(item => ({ ...item, __dataset: 'MEDICINES_PART_1' })), 'MEDICINES_PART_1');

  assert.equal(result.records.length, 2);
  assert.equal(result.duplicatesRemoved, 1);
  assert.deepEqual(result.records[0].sourceRecordIds, ['1', '2']);
  assert.equal(result.records[0].chemicalClass, '');
  assert.equal(result.records[1].sideEffects[0], 'Headache');
});

test('catalogue import scope is valid without a tenant or branch identity', async () => {
  const token = jwt.sign({
    scope: 'inventory.catalogue.import',
    userId: 'platform-admin-1',
    userRole: 'SUPER_ADMIN',
    isPlatformUser: true
  }, process.env.SERVICE_AUTH_SECRET, {
    algorithm: 'HS256',
    subject: 'api-gateway',
    issuer: 'ashvin-pharmacy',
    audience: 'inventory-service',
    expiresIn: 60
  });
  const result = await new Promise(resolve => {
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; resolve(this); } };
    requireServiceScope('inventory.catalogue.import')({
      get: name => name.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined
    }, response, () => resolve({ calledNext: true }));
  });
  assert.equal(result.calledNext, true);
});
