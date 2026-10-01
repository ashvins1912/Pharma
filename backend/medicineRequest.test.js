import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DEMO_ADMIN_ENABLED = 'true';
process.env.DEMO_CUSTOMER_ENABLED = 'true';

const { default: dataStore } = await import('./dataStore.js');
const { buildWhatsAppMedicineRequestBody } = await import('./config/whatsapp.js');

test('WhatsApp medicine request message builder handles all event types', () => {
    const mockRequest = {
        requestNumber: 'MR-9901',
        customerName: 'Aarav Sharma',
        customerPhone: '+919876500000',
        deliveryAddress: 'Flat 402, Lotus Apts, Mumbai',
        requestedItems: [{ requestedName: 'Special Inhaler 50mcg', quantity: 2 }],
        pharmacyProposal: {
            proposedMedicineName: 'Special Inhaler Pro 50mcg',
            finalPrice: 650,
            deliverySlot: {
                label: 'Tomorrow Morning',
                timeRange: '9:00 AM - 12:00 PM'
            }
        }
    };

    const newReqMsg = buildWhatsAppMedicineRequestBody(mockRequest, 'NEW_REQUEST');
    assert.match(newReqMsg, /NEW MEDICINE REQUEST RECEIVED/);
    assert.match(newReqMsg, /Special Inhaler 50mcg/);

    const proposalMsg = buildWhatsAppMedicineRequestBody(mockRequest, 'PROPOSAL_SENT');
    assert.match(proposalMsg, /PHARMACY PROPOSAL READY/);
    assert.match(proposalMsg, /Special Inhaler Pro 50mcg/);
    assert.match(proposalMsg, /₹650/);
    assert.match(proposalMsg, /Tomorrow Morning/);

    const approvedMsg = buildWhatsAppMedicineRequestBody(mockRequest, 'CUSTOMER_APPROVED');
    assert.match(approvedMsg, /PROPOSAL APPROVED & ORDER CREATED/);
});

test('Complete Medicine Request -> Proposal -> Customer Approval -> Order Conversion workflow', async () => {
    const testUser = {
        sub: 'user-test-procurement-101',
        email: 'patient101@example.com',
        user_metadata: { name: 'Patient Test User', mobile: '+919988776655' }
    };
    const otherCustomer = {
        sub: 'user-test-procurement-102',
        email: 'patient102@example.com',
        user_metadata: { name: 'Other Patient' }
    };

    // 1. Customer creates a special medicine request
    const createPayload = {
        requestedItems: [
            {
                requestedName: 'Ursocol 300mg Tablet',
                quantity: 3,
                dosageForm: 'Tablet',
                strength: '300mg',
                manufacturer: 'Abbott',
                customerNote: 'Need urgent delivery for chronic prescription.'
            }
        ],
        customerNote: 'Please confirm earliest delivery slot.',
        deliveryPreference: 'Urgent',
        addressId: 'saved-address-101',
        deliveryAddress: '123 Health Ave, Koramangala, Bengaluru - 560034',
        addressDetails: {
            fullName: 'Patient Test User',
            mobile: '+919988776655',
            city: 'Bengaluru',
            pincode: '560034'
        }
    };

    const createdReq = await dataStore.createMedicineRequest(createPayload, testUser);
    assert.ok(createdReq, 'Request should be created');
    assert.ok(createdReq._id, 'Request must have an ID');
    assert.equal(createdReq.status, 'REQUESTED');
    assert.equal(createdReq.requestedItems[0].requestedName, 'Ursocol 300mg Tablet');
    assert.equal(createdReq.customerId, testUser.sub);
    assert.equal(createdReq.addressId, createPayload.addressId);
    assert.equal(await dataStore.getPendingMedicineRequestCount(), 1);
    assert.equal(
        (await dataStore.getMedicineRequestById(createdReq._id, otherCustomer)),
        null,
        'Another customer must not retrieve this request by its ID'
    );
    assert.equal(
        (await dataStore.getMedicineRequests({}, testUser)).some(request => request._id === createdReq._id),
        true,
        'The owner must see their own request'
    );
    assert.equal(
        (await dataStore.getMedicineRequests({}, otherCustomer)).some(request => request._id === createdReq._id),
        false,
        'Another customer must not see this request in their list'
    );
    assert.equal(
        (await dataStore.getMedicineRequests({}, {
            sub: 'admin-1',
            app_metadata: { role: 'admin' }
        })).some(request => request._id === createdReq._id),
        true,
        'Authorized administrators must see customer requests'
    );
    await assert.rejects(
        dataStore.createMedicineRequest({
            requestedItems: [{ requestedName: 'No address medicine' }]
        }, otherCustomer),
        error => error.statusCode === 400
    );

    // 2. Pharmacy/Admin reviews the request
    const adminUser = {
        sub: 'admin-1',
        email: 'pharmacist@ashvinpharmacy.com',
        app_metadata: { role: 'admin' },
        user_metadata: { name: 'Lead Pharmacist' }
    };

    const reviewRes = await dataStore.reviewMedicineRequest(createdReq._id, adminUser, 'Checking distributor stock.');
    assert.equal(reviewRes.status, 'UNDER_REVIEW');
    assert.equal(await dataStore.getPendingMedicineRequestCount(), 1, 'Requests under review remain pending');

    // 3. Pharmacist creates a proposal with pricing and delivery slot
    const proposalPayload = {
        proposedMedicineName: 'Ursocol 300mg (Strip of 10 Tablets)',
        proposedManufacturer: 'Abbott Healthcare',
        proposedQuantity: 3,
        priceType: 'FINAL',
        unitPrice: 420,
        totalPrice: 1260,
        finalPrice: 1260,
        currency: 'INR',
        availabilityConfirmed: true,
        deliverySlot: {
            slotId: 'slot-tmrw-eve',
            date: 'Tomorrow',
            timeRange: '5:00 PM - 8:00 PM',
            label: 'Tomorrow Evening (5:00 PM - 8:00 PM)'
        },
        estimatedDays: 1,
        pharmacyNotes: 'Sourced directly from certified Abbott distributor batch #AB9012.',
        expiryHours: 48
    };

    const proposedReq = await dataStore.createOrUpdateProposal(createdReq._id, proposalPayload, adminUser);
    assert.equal(proposedReq.status, 'PROPOSAL_SENT');
    assert.ok(proposedReq.pharmacyProposal, 'Proposal must be attached');
    assert.equal(proposedReq.pharmacyProposal.finalPrice, 1260);
    assert.equal(proposedReq.pharmacyProposal.deliverySlot.label, 'Tomorrow Evening (5:00 PM - 8:00 PM)');
    assert.equal(await dataStore.getPendingMedicineRequestCount(), 0, 'Sent proposals are no longer pending pharmacy action');

    // 4. Customer approves the proposal -> Automatically converted to order
    await assert.rejects(
        dataStore.approveProposalAndConvertToOrder(createdReq._id, adminUser),
        error => error.statusCode === 403,
        'Administrators cannot approve proposals on behalf of a customer'
    );
    await assert.rejects(
        dataStore.approveProposalAndConvertToOrder(createdReq._id, otherCustomer),
        error => error.statusCode === 404,
        'Another customer cannot approve this proposal'
    );
    await assert.rejects(
        dataStore.rejectProposalByCustomer(createdReq._id, otherCustomer, 'Not mine'),
        error => error.statusCode === 404,
        'Another customer cannot reject this proposal'
    );
    await assert.rejects(
        dataStore.rejectProposalByCustomer(createdReq._id, adminUser, 'Admin rejection'),
        error => error.statusCode === 403,
        'Administrators cannot reject proposals on behalf of a customer'
    );
    await assert.rejects(
        dataStore.approveProposalAndConvertToOrder(createdReq._id, otherCustomer),
        error => error.statusCode === 404
    );
    const approvalResult = await dataStore.approveProposalAndConvertToOrder(
        createdReq._id,
        testUser,
        { customerResponseNote: 'Thank you, approved. Please proceed with delivery.' }
    );

    assert.ok(approvalResult.success, 'Approval should succeed');
    assert.ok(approvalResult.order, 'An Order must be created');
    assert.equal(approvalResult.request.status, 'CONVERTED_TO_ORDER');
    assert.equal(approvalResult.order.source, 'MEDICINE_REQUEST');
    assert.equal(approvalResult.order.finalTotal, 1260);
    assert.equal(approvalResult.order.orderStatus, 'Processing Order');
    assert.equal(approvalResult.order.deliverySlot.label, 'Tomorrow Evening (5:00 PM - 8:00 PM)');
    assert.equal(approvalResult.order.items[0].name, 'Ursocol 300mg (Strip of 10 Tablets)');
    assert.equal(approvalResult.order.items[0].quantity, 3);
    assert.equal(approvalResult.order.items[0].price, 420);
    assert.equal(approvalResult.order.items[0].manufacturer, 'Abbott Healthcare');
    assert.equal(approvalResult.order.items[0].totalPrice, 1260);
    assert.equal(approvalResult.order.items[0].snapshotAt instanceof Date, true);
    const duplicateApproval = await dataStore.approveProposalAndConvertToOrder(createdReq._id, testUser);
    assert.equal(duplicateApproval.alreadyConverted, true);
    assert.equal((await dataStore.getUserOrders(testUser.sub)).filter(order =>
        String(order.medicineRequestId) === String(createdReq._id)
    ).length, 1, 'Repeated approval must not create a second order');

    // Verify order is retrievable by customer
    const userOrders = await dataStore.getOrders(testUser.sub);
    const convertedOrderInList = userOrders.find(o => String(o._id) === String(approvalResult.order._id));
    assert.ok(convertedOrderInList, 'Converted order must be present in customer orders list');

    // 5. Customer declining proposal scenario
    const secondReqPayload = {
        requestedItems: [{ requestedName: 'Rare Tablet XYZ 100mg', quantity: 1 }],
        addressId: 'saved-address-101',
        deliveryAddress: 'Somewhere 123'
    };
    const secondReq = await dataStore.createMedicineRequest(secondReqPayload, testUser);
    assert.equal(await dataStore.getPendingMedicineRequestCount(), 1);
    await dataStore.reviewMedicineRequest(secondReq._id, adminUser);
    await dataStore.createOrUpdateProposal(secondReq._id, {
        proposedMedicineName: 'Alternative ABC',
        finalPrice: 900
    }, adminUser);
    assert.equal(await dataStore.getPendingMedicineRequestCount(), 0);

    const rejectRes = await dataStore.rejectProposalByCustomer(secondReq._id, testUser, 'Price is too high for alternative');
    assert.equal(rejectRes.status, 'CUSTOMER_REJECTED');
    assert.equal(rejectRes.customerRejectionReason, 'Price is too high for alternative');
    await assert.rejects(
        dataStore.approveProposalAndConvertToOrder(secondReq._id, testUser),
        error => error.statusCode === 400,
        'A rejected proposal cannot later be approved'
    );

    // 6. Pharmacy rejecting unavailable request
    const thirdReq = await dataStore.createMedicineRequest({
        requestedItems: [{ requestedName: 'Discontinued Salt Med', quantity: 1 }],
        addressId: 'saved-address-101'
    }, testUser);
    assert.equal(await dataStore.getPendingMedicineRequestCount(), 1);
    await dataStore.reviewMedicineRequest(thirdReq._id, adminUser);
    const pharmacyReject = await dataStore.rejectMedicineRequestByPharmacy(thirdReq._id, adminUser, 'Salt discontinued by FDA');
    assert.equal(pharmacyReject.status, 'PHARMACY_REJECTED');
    assert.equal(pharmacyReject.pharmacyRejectionReason, 'Salt discontinued by FDA');
    assert.equal(await dataStore.getPendingMedicineRequestCount(), 0);
});
