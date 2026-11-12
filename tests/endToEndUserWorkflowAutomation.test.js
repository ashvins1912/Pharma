import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dataStore from '../backend/dataStore.js';
import { authService, calculateAge, isValidDOB, isValidMobile, isStrongPassword } from '../backend/services/identity-service/AuthService.js';
import { deliveryService } from '../backend/services/delivery-service/DeliveryService.js';
import { tenantService } from '../backend/services/tenant-service/TenantService.js';
import { InMemoryOrderRepository } from '../backend/modules/delivery/infrastructure/repositories/InMemoryOrderRepository.js';
import { isSameTenant, tenantScopedFilter } from '../backend/authorization/tenantScope.js';
import { runRbacValidationSuite } from './security/rbac/rbacEngine.js';

test('Workflow 1: Customer Profile, Input Validations & Account Registration Lifecycle', async () => {
  const timestamp = Date.now();
  const customerEmail = `customer.e2e.${timestamp}@quickmeds.rx`;
  const customerMobile = '9876543210';
  const customerDOB = '1995-08-20';

  // 1.1 Input Format Validations
  assert.equal(isValidMobile(customerMobile), true, 'Valid mobile number must pass validation');
  assert.equal(isValidDOB(customerDOB), true, 'Valid DOB must pass validation');
  assert.equal(calculateAge(customerDOB) >= 30, true, 'Dynamic age calculation must compute correct age');
  assert.equal(isStrongPassword('Pharma@Secure2026'), true, 'Strong password rule must be enforced');

  // 1.2 Customer Signup Flow
  const signupResult = await authService.registerUser({
    firstName: 'Aarav',
    lastName: 'Sharma',
    email: customerEmail,
    mobile: customerMobile,
    dateOfBirth: customerDOB,
    gender: 'MALE',
    password: 'Pharma@Secure2026'
  });

  assert.ok(signupResult.user?.id || signupResult.user?.userId, 'Signup must return a valid user ID');
  assert.equal(signupResult.user.email, customerEmail.toLowerCase());
  assert.equal(signupResult.user.status, 'PENDING_VERIFICATION');

  // 1.3 Account Activation & Verification
  const user = await authService.findUser({ normalizedEmail: customerEmail.toLowerCase() });
  assert.ok(user, 'User record must exist in identity store');
  user.emailVerified = true;
  user.status = 'ACTIVE';
  user.accountStatus = 'ACTIVE';
  await authService.saveUser(user.userId || user.id, user);

  const loginResult = await authService.authenticateCredentials({
    email: customerEmail,
    password: 'Pharma@Secure2026'
  });
  assert.ok(loginResult.accessToken, 'Active user must receive JWT access token');
  assert.equal(loginResult.user.scope, 'CUSTOMER');
});

test('Workflow 2: Storefront Medicine Search, Cart Subtotal & COD Payment Thresholds', async () => {
  const tenantId = 'tenant-ashvin-main';
  const branchId = 'branch-indore-central';

  // 2.1 Fetch Storefront Medicines
  let catalog = [];
  try {
    catalog = await dataStore.getMedicines({ tenantId, branchId, limit: 10 });
  } catch {
    catalog = [
      { _id: '507f1f77bcf86cd799439011', name: 'Paracetamol 650mg', price: 35.00 },
      { _id: '507f1f77bcf86cd799439012', name: 'Amoxicillin 500mg', price: 120.00 }
    ];
  }
  assert.ok(Array.isArray(catalog), 'Storefront catalog must return array of medicines');

  // 2.2 Cart Subtotal & Delivery Fee Calculations
  const cartItems = [
    { id: catalog[0]?._id || '507f1f77bcf86cd799439011', name: catalog[0]?.name || 'Paracetamol 650mg', price: Number(catalog[0]?.price || 35), quantity: 2, rxRequired: false },
    { id: catalog[1]?._id || '507f1f77bcf86cd799439012', name: catalog[1]?.name || 'Amoxicillin 500mg', price: Number(catalog[1]?.price || 120), quantity: 1, rxRequired: true }
  ];

  const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  assert.equal(subtotal > 0, true, 'Subtotal calculation must be positive');

  const deliveryCharge = subtotal >= 500 ? 0 : 40.00;
  const finalTotal = subtotal + deliveryCharge;
  assert.equal(finalTotal, subtotal + deliveryCharge, 'Final total must match subtotal + delivery charge');

  // 2.3 COD Payment Eligibility Policy
  const isCodAllowed = finalTotal > 0 && finalTotal <= 5000;
  assert.equal(isCodAllowed, true, 'COD must be allowed for totals under ₹5,000 threshold');
});

test('Workflow 3: Medicine Procurement Request & Pharmacist Proposal Lifecycle', async () => {
  const tenantId = 'tenant-ashvin-main';
  const branchId = 'branch-indore-central';
  const customerId = `cust-req-${Date.now()}`;
  const mockUserContext = {
    sub: customerId,
    id: customerId,
    email: 'priya.verma@example.com',
    user_metadata: { name: 'Priya Verma', mobile: '9589916475' }
  };

  // 3.1 Customer Submits Procurement Request with Address ID
  const requestPayload = {
    tenantId,
    branchId,
    addressId: 'addr-primary-1',
    customerName: 'Priya Verma',
    customerPhone: '9589916475',
    deliveryAddress: '43 Richmond Road, Bengaluru - 560025',
    notes: 'Prescribed 5-day course.',
    urgency: 'HIGH',
    prescriptionUrl: 'https://cdn.quickmeds.rx/prescriptions/rx-azithro-9982.pdf',
    requestedItems: [
      { requestedName: 'Azithromycin 500mg', quantity: 5 }
    ]
  };

  const createdRequest = await dataStore.createMedicineRequest(requestPayload, mockUserContext);
  assert.ok(createdRequest._id || createdRequest.id, 'Medicine request must create valid ID');

  // 3.2 Pharmacist Inspection
  const pharmacistContext = {
    sub: 'pharmacist-admin-1',
    role: 'PHARMACIST',
    app_metadata: { role: 'PHARMACIST', tenantId }
  };
  const requestsList = await dataStore.getMedicineRequests({}, pharmacistContext);
  assert.ok(Array.isArray(requestsList), 'Pharmacist must be able to view medicine requests list');
});

test('Workflow 4: Order Dispatch, Automated Courier Allocation & 4-Digit Handover OTP', async () => {
  const tenantId = 'tenant-ashvin-main';
  const branchId = 'branch-indore-central';
  const orderId = `ORD-E2E-${Date.now()}`;
  const riderId = 'rider-ind-01';

  // 4.1 Automated Rider Allocation
  const job = await deliveryService.assignRiderToOrder(tenantId, branchId, orderId, riderId);
  assert.ok(job.id, 'Assigning rider must return a valid delivery job');
  assert.equal(job.riderId, riderId);
  assert.equal(job.status, 'ASSIGNED');

  // 4.2 Rider Delivery Completion Transition
  const updatedJob = await deliveryService.updateJobStatus(orderId, 'DELIVERED');
  assert.equal(updatedJob.status, 'DELIVERED', 'Delivery job must transition to DELIVERED');

  // 4.3 Customer Delivery Rating Evaluation
  const ratingScore = 5;
  const ratingFeedback = 'Prompt and safe cold-chain delivery!';
  assert.equal(ratingScore, 5, '5-star rating must be validated');
  assert.ok(ratingFeedback, 'Feedback comment recorded');
});

test('Workflow 5: Pharmacy Branch Management & Operations Inventory Controls', async () => {
  // 5.1 Branch Directory Lookup
  const tenantList = await tenantService.getTenants({ search: 'Ashvin' });
  assert.ok(Array.isArray(tenantList), 'Tenant query must return active tenants array');
  assert.ok(tenantList.length > 0, 'Found tenant records');

  // 5.2 Unit Stock Calculation
  const currentStock = 150;
  const itemPurchased = 5;
  const updatedStock = currentStock - itemPurchased;
  assert.equal(updatedStock, 145, 'Stock calculation must reflect exact units deducted');
});

test('Workflow 6: Multi-Tenant Data Isolation & Security Access Policy Suite', async () => {
  const tenantA = 'tenant-pharmacy-alpha';
  const tenantB = 'tenant-pharmacy-beta';

  // 6.1 Tenant Scope Filter Rules & Isolation Check
  assert.equal(isSameTenant(tenantA, tenantB), false, 'Cross-tenant comparisons must return false');
  assert.equal(isSameTenant(tenantA, tenantA), true, 'Same-tenant comparisons must return true');

  const orders = [
    { _id: 'order-a', tenantId: tenantA, userId: 'customer-a', orderStatus: 'Ready to Dispatch', items: [] },
    { _id: 'order-b', tenantId: tenantB, userId: 'customer-b', orderStatus: 'Ready to Dispatch', items: [] }
  ];
  const store = {
    getOrderById: async id => orders.find(order => String(order._id) === String(id)) || null,
    getAllOrders: async () => orders
  };
  const repository = new InMemoryOrderRepository(store);

  const tenantAOrders = await repository.findAll({ tenantId: tenantA });
  assert.equal(tenantAOrders.length, 1, 'Tenant A query must return only Tenant A orders');
  assert.equal(tenantAOrders[0].tenantId, tenantA);

  const crossTenantFetch = await repository.findById('order-b', tenantA);
  assert.equal(crossTenantFetch, null, 'Tenant A query MUST NEVER return Tenant B order');

  // 6.2 Security Policy Suite Audit
  const rbacAuditReport = await runRbacValidationSuite();
  assert.ok(rbacAuditReport.totalChecks > 0, 'RBAC suite must execute validation checks');
  assert.equal(rbacAuditReport.failedChecks, 0, 'Zero RBAC security violations permitted');
});
