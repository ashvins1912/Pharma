import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SERVICE_AUTH_SECRET = 'test-service-secret-with-more-than-thirty-two-characters';

const { detectMedicineDataset, normalizeMedicineRecord } = await import('./src/medicine-catalogue-import-routes.js');
const { requireServiceScope } = await import('./src/service-auth.js');
const jwt = (await import('jsonwebtoken')).default;

test('detects the two supported medicine dataset structures', () => {
  assert.equal(detectMedicineDataset({ count: 1, drugDetails: [{ brandIdentifier: 'B-1' }] }), 'INDIAN_MEDICINE_DATA');
  assert.equal(detectMedicineDataset([{ 'Medicine Name': 'Test', 'Product Name': 'Test Tablet' }]), 'INDIA_MEDICINES_INFO');
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
