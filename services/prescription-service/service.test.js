import assert from 'node:assert/strict';
import test from 'node:test';
import {
    PrescriptionService,
    PrescriptionState,
    VALID_TRANSITIONS
} from '../../backend/services/prescription-service/PrescriptionService.js';

test('1. Prescription State Machine: strict valid transitions and terminal INACTIVE state', () => {
    const service = new PrescriptionService();

    // Valid transitions
    assert.equal(service.canTransition(PrescriptionState.UPLOADED, PrescriptionState.QUEUED), true);
    assert.equal(service.canTransition(PrescriptionState.QUEUED, PrescriptionState.PROCESSING), true);
    assert.equal(service.canTransition(PrescriptionState.PROCESSING, PrescriptionState.REVIEW_REQUIRED), true);
    assert.equal(service.canTransition(PrescriptionState.PROCESSING, PrescriptionState.COMPLETED), true);
    assert.equal(service.canTransition(PrescriptionState.REVIEW_REQUIRED, PrescriptionState.COMPLETED), true);
    assert.equal(service.canTransition(PrescriptionState.COMPLETED, PrescriptionState.INACTIVE), true);

    // Invalid backwards or illegal transitions
    assert.equal(service.canTransition(PrescriptionState.COMPLETED, PrescriptionState.UPLOADED), false);
    assert.equal(service.canTransition(PrescriptionState.COMPLETED, PrescriptionState.QUEUED), false);

    // Terminal INACTIVE state: NO transitions allowed
    assert.equal(service.canTransition(PrescriptionState.INACTIVE, PrescriptionState.UPLOADED), false);
    assert.equal(service.canTransition(PrescriptionState.INACTIVE, PrescriptionState.QUEUED), false);
    assert.equal(service.canTransition(PrescriptionState.INACTIVE, PrescriptionState.PROCESSING), false);
    assert.equal(service.canTransition(PrescriptionState.INACTIVE, PrescriptionState.COMPLETED), false);
    assert.equal(VALID_TRANSITIONS[PrescriptionState.INACTIVE].size, 0);
});

test('2. Upload Prescription with clinical extraction and idempotency protection', async () => {
    const service = new PrescriptionService();
    const idempKey = 'idemp-presc-upload-unique-9988';

    const result1 = await service.uploadPrescription({
        file: {
            buffer: Buffer.from('simulated-prescription-image-bytes'),
            mimetype: 'image/png',
            originalname: 'prescription-test.png'
        },
        customerId: 'cust_priya_101',
        tenantId: 'tenant_careplus_01',
        branchId: 'branch_indore_01',
        notes: 'Chronic allergy prescription',
        metadata: {
            patientName: 'Priya Sharma',
            doctorName: 'Dr. A. Verma'
        },
        idempotencyKey: idempKey
    });

    assert.ok(result1.prescriptionId);
    assert.equal(result1.status, PrescriptionState.COMPLETED);

    // Idempotent duplicate call must return same prescriptionId
    const result2 = await service.uploadPrescription({
        file: null,
        customerId: 'cust_priya_101',
        tenantId: 'tenant_careplus_01',
        idempotencyKey: idempKey
    });

    assert.equal(result2.prescriptionId, result1.prescriptionId);
});

test('3. Optimistic Concurrency Control: version check prevents stale reviews', async () => {
    const service = new PrescriptionService();
    const created = await service.uploadPrescription({
        customerId: 'cust_priya_101',
        tenantId: 'tenant_careplus_01',
        notes: 'Review test'
    });

    const prescId = created.prescriptionId;

    // Review with correct expectedVersion (starts at 1)
    const reviewResult = await service.reviewPrescription(prescId, { isPlatformUser: true, userId: 'pharm_1' }, {
        medicines: [{ rawName: 'Cetirizine 10mg', normalizedName: 'Cetirizine 10mg Tablet' }],
        expectedVersion: 1
    });

    assert.equal(reviewResult.version, 2);
    assert.equal(reviewResult.status, PrescriptionState.COMPLETED);

    // Stale worker/user attempts update with outdated version 1 -> Must throw 409 CONCURRENCY_CONFLICT
    await assert.rejects(
        async () => {
            await service.reviewPrescription(prescId, { isPlatformUser: true, userId: 'pharm_2' }, {
                medicines: [{ rawName: 'Old Med' }],
                expectedVersion: 1 // Stale!
            });
        },
        err => {
            assert.equal(err.status, 409);
            assert.equal(err.code, 'CONCURRENCY_CONFLICT');
            return true;
        }
    );
});

test('4. Customer Data Removal: marks INACTIVE, redacts PII, and forbids post-removal updates', async () => {
    const service = new PrescriptionService();
    const created = await service.uploadPrescription({
        customerId: 'cust_ananya_202',
        tenantId: 'tenant_careplus_01',
        metadata: { patientName: 'Ananya Roy' }
    });

    const prescId = created.prescriptionId;

    // Customer initiates removal
    const removalResult = await service.removePrescription(prescId, {
        customerId: 'cust_ananya_202',
        tenantId: 'tenant_careplus_01'
    }, 'Customer requested data erasure');

    assert.equal(removalResult.status, PrescriptionState.INACTIVE);
    assert.ok(removalResult.inactiveAt);
    assert.ok(removalResult.removalRequestedAt);

    // Retrieve deactivated record: sensitive PII is redacted
    const fetched = await service.getPrescriptionById(prescId, {
        customerId: 'cust_ananya_202',
        tenantId: 'tenant_careplus_01'
    });
    assert.equal(fetched.status, PrescriptionState.INACTIVE);
    assert.equal(fetched.patient?.name, undefined); // Excluded/redacted in inactive shell

    // Attempting post-removal updates must be rejected immediately (409 PRESCRIPTION_INACTIVE)
    await assert.rejects(
        async () => {
            await service.reviewPrescription(prescId, { isPlatformUser: true, userId: 'pharm_1' }, {
                expectedVersion: 1
            });
        },
        err => {
            assert.equal(err.status, 409);
            assert.equal(err.code, 'PRESCRIPTION_INACTIVE');
            return true;
        }
    );

    // Normal list query must strictly exclude INACTIVE records
    const list = await service.listPrescriptions({ customerId: 'cust_ananya_202' });
    const found = list.items.find(item => item.prescriptionId === prescId);
    assert.equal(found, undefined);
});

test('5. Multi-Tenant & Customer Isolation: cross-tenant access denied', async () => {
    const service = new PrescriptionService();
    const created = await service.uploadPrescription({
        customerId: 'cust_tenantA_1',
        tenantId: 'tenant_alpha',
        metadata: { patientName: 'Alpha Patient' }
    });

    const prescId = created.prescriptionId;

    // Cross-tenant access from tenant_beta must throw 403
    await assert.rejects(
        async () => {
            await service.getPrescriptionById(prescId, {
                isPlatformUser: false,
                tenantId: 'tenant_beta',
                customerId: 'cust_tenantB_9'
            });
        },
        err => {
            assert.equal(err.status, 403);
            return true;
        }
    );

    // Cross-customer access within same tenant must throw 403
    await assert.rejects(
        async () => {
            await service.getPrescriptionById(prescId, {
                isPlatformUser: false,
                customerId: 'cust_other_user'
            });
        },
        err => {
            assert.equal(err.status, 403);
            return true;
        }
    );
});

test('6. Hospital Deduplication: prevents redundant hospital entities', async () => {
    const service = new PrescriptionService();

    const hosp1 = await service.getOrMatchHospital({
        name: 'Apollo Spectra Hospitals',
        address: { city: 'Indore', state: 'Madhya Pradesh' },
        phone: '+91 731 4001122'
    }, { isPlatformUser: true });

    const hosp2 = await service.getOrMatchHospital({
        name: '  apollo spectra hospitals  ',
        address: { city: 'indore', state: 'madhya pradesh' },
        phone: '+91 731 4001122'
    }, { isPlatformUser: true });

    assert.equal(hosp1.hospitalId, hosp2.hospitalId);
});

test('7. Analytics Summary: excludes INACTIVE records and tallies top medicines', async () => {
    const service = new PrescriptionService();

    // Create 2 active prescriptions
    await service.uploadPrescription({
        customerId: 'cust_analytics_1',
        tenantId: 'tenant_analytics_test'
    });
    const pres2 = await service.uploadPrescription({
        customerId: 'cust_analytics_2',
        tenantId: 'tenant_analytics_test'
    });

    // Remove 1 prescription
    await service.removePrescription(pres2.prescriptionId, { isPlatformUser: true });

    const summary = await service.getAnalyticsSummary({
        isPlatformUser: false,
        tenantId: 'tenant_analytics_test'
    });

    // INACTIVE record is not counted
    assert.equal(summary.totalPrescriptions, 1);
    assert.equal(summary.processedPrescriptions, 1);
    assert.ok(Array.isArray(summary.topMedicines));
});
