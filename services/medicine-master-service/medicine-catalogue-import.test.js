import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SERVICE_AUTH_SECRET = 'test-service-secret-with-more-than-thirty-two-characters';

const { detectMedicineDataset, normalizeMedicineRecord, consolidate, assessMedicineQuality, parseJsonArrayRecords, scoreMedicineMatch, mergeStagedMedicine, collectCatalogueCandidates, fuzzyCandidatePrefixes } = await import('./src/medicine-catalogue-import-routes.js');
const { requireServiceScope } = await import('./src/service-auth.js');
const jwt = (await import('jsonwebtoken')).default;

test('candidate pagination retrieves every matching master row beyond the former 5,000-row cap', async () => {
  const rows = Array.from({ length: 6123 }, (_, index) => ({ _id: index + 1, medicineId: `MASTER-${index + 1}` }));
  const requestedCursors = [];
  const result = await collectCatalogueCandidates(async ({ after, limit }) => {
    requestedCursors.push(after);
    return rows.filter(row => after === null || row._id > after).slice(0, limit);
  }, 750);

  assert.equal(result.length, rows.length);
  assert.equal(result[0].medicineId, 'MASTER-1');
  assert.equal(result.at(-1).medicineId, 'MASTER-6123');
  assert.ok(requestedCursors.length > 1);
});

test('candidate pagination fails closed if a full page cannot advance its cursor', async () => {
  await assert.rejects(
    collectCatalogueCandidates(async () => [{ _id: 'same' }, { _id: 'same' }], 2),
    /pagination did not advance/i
  );
});

test('fuzzy candidate prefix collection does not truncate imports after 120 prefixes', () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const prefixes = Array.from({ length: 140 }, (_, index) => {
    const first = alphabet[Math.floor(index / alphabet.length)];
    const second = alphabet[index % alphabet.length];
    return { brandName: `${first}${second} medicine` };
  });
  assert.equal(fuzzyCandidatePrefixes(prefixes).length, 140);
});

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
    substanceIdentifier: ['ING-1'], substanceName: ['Paracetamol'],
    casNumber: ['103-90-2'], unii: ['2G9X7K1TFT'], substanceDescription: ['Analgesic ingredient'],
    molecularFormula: ['C8H9NO2'], inChl: ['InChI=1S/C8H9NO2'], iupacName: ['N-(4-hydroxyphenyl)acetamide'],
    molecularWeight: ['151.16'], smile: ['CC(=O)NC1=CC=C(O)C=C1'], toxity: ['Avoid overdose'],
    drugFormIdentifier: 'FORM-1', routeOfAdministrationIdentifier: ['ROUTE-1'], licenseStatus: 'UNKNOWN',
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
  assert.equal(result.ingredientDetails[0].casNumber, '103-90-2');
  assert.equal(result.ingredientDetails[0].unii, '2G9X7K1TFT');
  assert.equal(result.ingredientDetails[0].molecularFormula, 'C8H9NO2');
  assert.equal(result.ingredientDetails[0].molecularWeight, '151.16');
  assert.equal(result.sourceLicenseStatusValue, 'UNKNOWN');
  assert.equal(result.drugFormId, 'FORM-1');
  assert.deepEqual(result.routeIds, ['ROUTE-1']);
  assert.deepEqual(result.toxicology, ['Avoid overdose']);
  assert.deepEqual(result.ingredients, ['Paracetamol']);
  assert.deepEqual(result.routes, ['Oral']);
  assert.deepEqual(result.alternatives, [{ medicineId: '', brandName: 'Brand B', source: 'SUGGESTED_NAME', verification: 'UNVERIFIED' }]);
  assert.equal(result.prescriptionVerification, 'UNVERIFIED');
  assert.equal('price' in result, false);
  assert.equal('expiryDate' in result, false);
  assert.equal('manufacturingDate' in result, false);
});

test('structured alternative medicines retain source identifiers and remove self references', () => {
  const result = normalizeMedicineRecord({
    brandIdentifier: 'B-100', brandName: 'Medicine A 10mg tablet',
    genericIdentifier: 'G-1', genericName: 'Ingredient A 10mg tablet',
    substanceIdentifier: ['I-1'], substanceName: ['Ingredient A'],
    doseForm: 'Tablet', routeOfAdministrationName: ['Oral route'],
    alternativeDrugs: [
      { brandIdentifier: 'B-100', brandName: 'Medicine A 10mg tablet' },
      { brandIdentifier: 'B-200', brandName: 'Medicine B 10mg tablet' },
      { brandIdentifier: 'B-200', brandName: 'Medicine B 10mg tablet' }
    ]
  }, 'INDIAN_MEDICINE_DATA');
  assert.deepEqual(result.alternatives, [{
    medicineId: 'B-200', brandName: 'Medicine B 10mg tablet',
    source: 'SOURCE_LINK', verification: 'UNVERIFIED'
  }]);
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

test('quality scoring is transparent, bounded and never upgrades unverified clinical facts', () => {
  const complete = normalizeMedicineRecord({
    brandIdentifier: 'B-QUALITY-1', brandName: 'Quality Example 500mg Tablet',
    genericIdentifier: 'G-QUALITY-1', genericName: 'Example ingredient',
    supplierIdentifier: 'SUP-1', supplierName: 'Example manufacturer',
    substanceIdentifier: ['ING-1'], substanceName: ['Example ingredient'],
    casNumber: ['123-45-6'], doseForm: 'Tablet', strength: '500 mg',
    routeOfAdministrationName: ['Oral'], indication: 'Source-provided use'
  }, 'INDIAN_MEDICINE_DATA');
  const scored = assessMedicineQuality(complete);
  assert.equal(scored.qualityScore, 100);
  assert.equal(scored.qualityGrade, 'EXCELLENT');
  assert.ok(scored.qualityIssues.includes('SOURCE_LICENCE_STATUS_UNVERIFIED') === false);
  assert.equal(complete.prescriptionVerification, 'UNVERIFIED');

  const sparse = normalizeMedicineRecord({ id: 'sparse-1', name: 'Example medicine' }, 'MEDICINES_PART_1');
  const sparseScore = assessMedicineQuality(sparse);
  assert.ok(sparseScore.qualityScore >= 0 && sparseScore.qualityScore <= 100);
  assert.ok(sparseScore.qualityIssues.includes('MISSING_COMPOSITION'));
  assert.ok(sparseScore.qualityIssues.includes('MISSING_MANUFACTURER'));
  assert.equal(sparse.prescriptionVerification, 'UNVERIFIED');
});

test('consolidation uses the supplied dataset without cloning or annotating source rows', () => {
  const raw = {
    brandIdentifier: 'B-NO-CLONE-1', brandName: 'Example Tablet',
    genericName: 'Example ingredient', substanceName: ['Example ingredient'], doseForm: 'Tablet'
  };
  const result = consolidate([raw], 'INDIAN_MEDICINE_DATA');
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].medicineId, 'B-NO-CLONE-1');
  assert.equal(Object.hasOwn(raw, '__dataset'), false);
});

test('consolidation attaches quality grades and scores to every accepted record', () => {
  const result = consolidate([{
    brandIdentifier: 'B-QUALITY-2', brandName: 'Example Tablet',
    genericName: 'Example ingredient', substanceName: ['Example ingredient'],
    doseForm: 'Tablet', __dataset: 'INDIAN_MEDICINE_DATA'
  }], 'INDIAN_MEDICINE_DATA');
  assert.equal(result.records.length, 1);
  assert.ok(result.records[0].qualityScore >= 0 && result.records[0].qualityScore <= 100);
  assert.ok(['EXCELLENT', 'GOOD', 'PARTIAL', 'NEEDS_REVIEW'].includes(result.records[0].qualityGrade));
  assert.ok(Array.isArray(result.records[0].qualityIssues));
});

test('fuzzy medicine matching auto-merges only when composition, strength and form agree', () => {
  const incoming = { brandName: 'Atorvastatin 10mg Tablets', composition: 'Atorvastatin', strength: '10 mg', dosageForm: 'Tablet', genericName: 'Atorvastatin' };
  const existing = { medicineId: 'MASTER-1', brandName: 'Atorvastatin 10 mg Tablet', composition: 'Atorvastatin', strength: '10 mg', dosageForm: 'Tablet', genericName: 'Atorvastatin' };
  const match = scoreMedicineMatch(incoming, existing);
  assert.equal(match.decision, 'AUTO_MERGE');
  assert.ok(match.score >= 96);
});

test('fuzzy medicine matching blocks strength, dosage-form and composition conflicts', () => {
  const incoming = { brandName: 'Atorvastatin 10mg Tablet', composition: 'Atorvastatin', strength: '10 mg', dosageForm: 'Tablet' };
  const wrongStrength = scoreMedicineMatch(incoming, { brandName: 'Atorvastatin 10mg Tablet', composition: 'Atorvastatin', strength: '20 mg', dosageForm: 'Tablet' });
  const wrongForm = scoreMedicineMatch(incoming, { brandName: 'Atorvastatin 10mg Tablet', composition: 'Atorvastatin', strength: '10 mg', dosageForm: 'Capsule' });
  const wrongComposition = scoreMedicineMatch(incoming, { brandName: 'Atorvastatin 10mg Tablet', composition: 'Clopidogrel', strength: '10 mg', dosageForm: 'Tablet' });
  assert.equal(wrongStrength.decision, 'BLOCKED_CONFLICT');
  assert.ok(wrongStrength.warnings.includes('STRENGTH_CONFLICT'));
  assert.equal(wrongForm.decision, 'BLOCKED_CONFLICT');
  assert.ok(wrongForm.warnings.includes('DOSAGE_FORM_CONFLICT'));
  assert.equal(wrongComposition.decision, 'BLOCKED_CONFLICT');
  assert.ok(wrongComposition.warnings.includes('COMPOSITION_CONFLICT'));
});

test('fuzzy medicine matching sends name-only matches to manual review', () => {
  const match = scoreMedicineMatch(
    { brandName: 'Metformin 500mg Tablet', composition: '', strength: '500 mg', dosageForm: 'Tablet' },
    { brandName: 'Metformin 500 mg Tablets', composition: '', strength: '500 mg', dosageForm: 'Tablet' }
  );
  assert.equal(match.decision, 'MANUAL_REVIEW');
  assert.ok(match.warnings.includes('COMPOSITION_MISSING_REVIEW_REQUIRED'));
});

test('record linkage normalizes equivalent mass units before medicine identity scoring', () => {
  const match = scoreMedicineMatch(
    { brandName: 'Example Tablet', composition: 'Example ingredient', strength: '1 g', dosageForm: 'Tablets', genericName: 'Example ingredient' },
    { brandName: 'Example Tablet', composition: 'Example ingredient', strength: '1000 mg', dosageForm: 'Tablet', genericName: 'Example ingredient' }
  );
  assert.equal(match.decision, 'AUTO_MERGE');
  assert.equal(match.score, 100);
});

test('record linkage sends a conflicting generic ingredient to manual review despite a similar brand name', () => {
  const match = scoreMedicineMatch(
    { brandName: 'Example 10mg Tablet', composition: 'Example ingredient', strength: '10 mg', dosageForm: 'Tablet', genericName: 'Atorvastatin' },
    { brandName: 'Example 10mg Tablet', composition: 'Example ingredient', strength: '10 mg', dosageForm: 'Tablet', genericName: 'Clopidogrel' }
  );
  assert.equal(match.decision, 'MANUAL_REVIEW');
  assert.ok(match.warnings.includes('GENERIC_INGREDIENT_CONFLICT'));
});

test('character n-gram linkage retains typo candidates for review but does not auto-merge weak evidence', () => {
  const match = scoreMedicineMatch(
    { brandName: 'Atorvastatin 10mg Tablet', composition: 'Atorvastatin', strength: '10 mg', dosageForm: 'Tablet' },
    { brandName: 'Atorvastatin 10mg Tablett', composition: 'Atorvastatin', strength: '10 mg', dosageForm: 'Tablet' }
  );
  assert.ok(match.ngramNameScore > 0);
  assert.ok(Number.isFinite(match.tfIdfNameScore));
  assert.ok(['AUTO_MERGE', 'MANUAL_REVIEW', 'NO_MATCH'].includes(match.decision));
  assert.notEqual(match.decision, 'BLOCKED_CONFLICT');
});

test('multi-batch record merge preserves source provenance and enriches missing fields', () => {
  const left = {
    medicineId: 'BRAND-1', brandName: 'Example 10mg Tablet', composition: 'Example ingredient',
    strength: '10 mg', dosageForm: 'Tablet', genericName: 'Example ingredient', manufacturer: '',
    sourcePriority: 1, sourceDataset: 'INDIAN_MEDICINE_DATA', sourceRecordId: 'BRAND-1',
    sourceRecordIds: ['BRAND-1'], sourceDatasets: ['INDIAN_MEDICINE_DATA'],
    ingredients: ['Example ingredient'], uses: [], sideEffects: [], qualityScore: 50
  };
  const right = {
    medicineId: 'MED-2', brandName: 'Example 10 mg Tablets', composition: 'Example ingredient',
    strength: '10mg', dosageForm: 'Tablet', genericName: 'Example ingredient', manufacturer: 'Example Pharma',
    sourcePriority: 3, sourceDataset: 'INDIA_MEDICINES_INFO', sourceRecordId: 'MED-2',
    sourceRecordIds: ['MED-2'], sourceDatasets: ['INDIA_MEDICINES_INFO'],
    ingredients: ['Example ingredient'], uses: ['Source supplied use'], sideEffects: ['Source supplied side effect'], qualityScore: 40
  };
  const merged = mergeStagedMedicine(left, right);
  assert.equal(merged.medicineId, 'BRAND-1');
  assert.equal(merged.manufacturer, 'Example Pharma');
  assert.deepEqual(merged.uses, ['Source supplied use']);
  assert.deepEqual(merged.sourceDatasets.sort(), ['INDIAN_MEDICINE_DATA', 'INDIA_MEDICINES_INFO'].sort());
  assert.deepEqual(merged.sourceRecordIds.sort(), ['BRAND-1', 'MED-2']);
  assert.deepEqual(merged.legacyMedicineIds, ['MED-2']);
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
    audience: 'medicine-master-service',
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
