# Ashvin Pharmacy — Complete System Architecture & Dependency Map

**Platform:** Ashvin Multi-Tenant Pharmacy Commerce, Fulfillment & Logistics Engine  
**Architecture Target:** Modular Service Ownership with Centralized API Gateway  
**Document:** `docs/AI_SYSTEM_MAP.md`  
**Generated At:** 2026-10-03  

---

## 1. Top-Level Architectural Hierarchy

The Ashvin Platform enforces strict separation of concerns across clients, gateway routing, independent domain services, and database persistence layers:

```text
                               +--------------------------------------------+
                               |                  CLIENTS                   |
                               |   Web (React/Vite) | Admin | Mobile/POS    |
                               +---------------------+----------------------+
                                                     |
                                                     v (HTTPS / REST)
                               +--------------------------------------------+
                               |           API GATEWAY (/api/v1/*)          |
                               |  - RequestContext Injection (x-request-id) |
                               |  - CORS Security Policy & Headers          |
                               |  - Authentication Verification (Supabase)  |
                               |  - Role-Based Access Control (RBAC)        |
                               |  - Tenant & Branch Scope Resolution        |
                               |  - Error Normalization & Rate Limiting     |
                               +---------------------+----------------------+
                                                     |
         +--------------------+----------------------+--------------------+--------------------+
         |                    |                      |                    |                    |
         v                    v                      v                    v                    v
+-----------------+  +-----------------+    +-----------------+  +-----------------+  +-----------------+
| Identity Service|  | Tenant Service  |    | Catalog Service |  | Pricing Engine  |  |  Order Service  |
| - Global Auth   |  | - Tenants       |    | - Global Master |  | - Authoritative |  | - Order Records |
| - Customer CRM  |  | - Branches      |    | - Branch Listing|  |   MRP Calculation| - Status FSM   |
| - TenantProfiles|  | - Memberships   |    | - Shelf Stock   |  | - Coupon Rules  |  | - Fulfillments  |
| - Saved Addr    |  | - Radius Config |    | - Bulk Imports  |  | - Stacking Guard|  | - Idempotency   |
+--------+--------+  +--------+--------+    +--------+--------+  +--------+--------+  +--------+--------+
         |                    |                      |                    |                    |
         +--------------------+----------------------+--------------------+--------------------+
                                                     |
         +--------------------+----------------------+--------------------+
         |                                           |                    |
         v                                           v                    v
+-----------------+                         +-----------------+  +-----------------+
| Delivery Service|                         | Integration Svc |  |Notification Svc |
| - Rider Fleets  |                         | - POS Adapters  |  | - WhatsApp API  |
| - Haversine Calc|                         | - C-Square Sync |  | - In-App Alerts |
| - Dispatch Jobs |                         | - Inventory Pull|  | - Domain Events |
+--------+--------+                         +--------+--------+  +--------+--------+
         |                                           |                    |
         v                                           v                    v
+----------------------------------------------------------------------------------+
|                              PERSISTENCE & STORAGE                               |
|   MongoDB Collections (Tenant-Scoped) | Resilient In-Memory Fallback DataStore   |
|   Supabase Storage (Prescriptions)    | Local Storage Driver Mock Fallback       |
+----------------------------------------------------------------------------------+
```

---

## 2. Domain Service Boundaries & Ownership

### 2.1 Identity Service (`backend/services/identity-service/IdentityService.js`)
* **Core Philosophy:** "Identity is Not Ownership." A human customer has a single global identity across all pharmacies.
* **Owned Entities:**
  * `Customer`: Global unique customer entity bound to Supabase `userId` / `sub`.
  * `CustomerTenantProfile`: Isolated commercial relationship per tenant (`tenantId`, `totalOrders`, `loyaltyPointsBalance`, `customerCode`).
  * `UserAddress`: Customer delivery addresses with validated geospatial coordinates.
* **Inbound Callers:** API Gateway (`/api/v1/customers`), Order Service (checkout & rewards), Medicine Request Service.
* **Failure Mode:** Falls back to verified session metadata or in-memory customer cache if database is unreachable.

### 2.2 Tenant & Branch Service (`backend/services/tenant-service/TenantService.js`)
* **Core Philosophy:** Pharmacy vendors operate as isolated Tenants. Each tenant can operate multiple physical Branches.
* **Owned Entities:**
  * `Tenant`: Business name, legal entity, status, stacking settings.
  * `Branch`: Physical dispensary, coordinates, service radius (km), minimum order value, delivery fee.
  * `TenantMembership`: Staff role (`TENANT_OWNER`, `TENANT_ADMIN`, `PHARMACIST`, `ORDER_MANAGER`, `DISPATCHER`), assigned branch.
* **Inbound Callers:** Gateway context middleware (`contextMiddleware`), all tenant-scoped routers.
* **Failure Mode:** Cached tenant and branch records ensure storefront availability during database reconnections.

### 2.3 Catalog & Inventory Service (`backend/services/catalog-service/CatalogService.js`)
* **Core Philosophy:** Global Product identity is strictly decoupled from physical branch stock.
* **Owned Entities:**
  * `Product`: Universal pharmaceutical master (name, composition, dosage form, pack size, prescription requirement).
  * `BranchProductListing`: Branch commercial offer (selling price, MRP, status).
  * `BranchInventory`: Physical shelf stock (`availableQuantity`, `reservedQuantity`, `batchNumber`, `expiryDate`).
  * `BulkImportJob`: Multi-thousand row chunked import tracking (`totalRows`, `processedRows`, `failures`).
* **Inbound Callers:** Storefront listings, Order Service (reservation & deduction), Pharmacist management.
* **Failure Mode:** Atomic reservation rollback prevents ghost inventory deductions if pricing or order creation aborts.

### 2.4 Pricing Engine (`backend/services/pricing-service/PricingEngine.js`)
* **Core Philosophy:** Authoritative server-side pricing. Client-provided prices are never trusted.
* **Owned Entities:**
  * `Coupon`: Tenant/branch scoped promo codes with minimum order limits and maximum discount caps.
  * `Offer`: Automatic cart threshold discounts (e.g. 5% off above ₹500).
  * `StackingRules`: Stacking matrix (`allowOfferWithCoupon`, `allowCouponWithRewards`, `allowOfferWithRewards`).
* **Inbound Callers:** Gateway (`POST /api/v1/pricing/calculate`), Order Service checkout.
* **Failure Mode:** Fails closed with typed DomainErrors (`InvalidCouponError`, `StackingRuleViolationError`).

### 2.5 Order Service (`backend/services/order-service/OrderService.js`)
* **Core Philosophy:** Authoritative owner of Order state, pricing snapshots, and fulfillment lifecycle.
* **Owned Entities:**
  * `Order`: Immutable item price snapshots, status history, idempotency keys, delivery address snapshot.
  * `FulfillmentOrder`: Branch dispatch and packaging record (`ASHVIN_FULFILLMENT`, `VENDOR_FULFILLMENT`).
* **Inbound Callers:** Gateway (`/api/v1/orders`), Medicine Request approval conversion.
* **Side Effects:** Triggers inventory deduction, loyalty points accrual, and emits `ORDER_CREATED` / `ORDER_DELIVERED` domain events.
* **Failure Mode:** Idempotency index deduplicates accidental retries; stock reservations are rolled back on unexpected errors.

### 2.6 Delivery Service (`backend/services/delivery-service/DeliveryService.js`)
* **Core Philosophy:** Radius-based dispatch to branch-specific rider fleets.
* **Owned Entities:**
  * `Rider`: Branch-assigned delivery partner, GPS location, vehicle type, active order load, status (`AVAILABLE`, `ASSIGNED`, `SUSPENDED`).
  * `DeliveryJob`: Rider-to-order delivery binding, dispatch timestamp, delivery proof.
* **Calculations:** Haversine great-circle formula computes distance between branch dispensary and customer pin. Throws `OutOfServiceRadiusError` (HTTP 422) if outside `branch.serviceRadiusKm`.

### 2.7 Medicine Request Service (`backend/services/medicine-request-service/MedicineRequestService.js`)
* **Core Philosophy:** Medicine Request != Order. Proposal != Order. Only customer approval converts to Order.
* **Owned Entities:**
  * `MedicineRequest`: Customer unlisted medicine inquiry, prescription attachment, timing preference.
  * `PharmacyProposal`: Pharmacist formulation with verified price, batch availability, and delivery slot.
* **Inbound Callers:** Customer portal, Pharmacist dashboard.
* **Failure Mode:** Customer approval is strictly idempotent (`idemp-prop-conv-<id>`). Subsequent clicks return the existing Order without re-conversion.

### 2.8 Pharmacy Integration Service (`backend/services/pharmacy-integration-service/PharmacyIntegrationService.js`)
* **Core Philosophy:** Provider Adapter pattern decouples core domain from external vendor POS/ERP APIs.
* **Owned Adapters:**
  * `CSquareAdapter`: Real-time stock sync, ping health checks, external order push with idempotency keys.
* **Security:** API keys and credentials are encrypted at rest and masked (`••••••••abcd`) in responses.

### 2.9 Notification Service (`backend/services/notification-service/NotificationService.js`)
* **Core Philosophy:** Event-driven notification fanout across In-App, WhatsApp, SMS, and Email.
* **Listeners:** Subscribed to `ORDER_CREATED`, `ORDER_ACCEPTED`, `RIDER_ASSIGNED`, `ORDER_DELIVERED`, `PROPOSAL_CREATED`.
* **Failure Mode:** Notification failures are logged and isolated; they never fail the primary business database transaction.

---

## 3. End-to-End Runtime Execution Flows

### Flow A: Storefront Order Placement
```text
1. Customer Browser selects Branch (Indore Central)
   ↓
2. GET /api/v1/catalog/listings?branchId=branch-indore-central
   ↓ CatalogService returns active listings with verified stock
3. Customer adds items to cart & inputs delivery address
   ↓
4. POST /api/v1/pricing/calculate (Server computes line items, applies coupon, verifies stacking)
   ↓
5. POST /api/v1/orders (with Idempotency-Key header)
   ├─ Gateway contextMiddleware authenticates user & sets RequestContext
   ├─ DeliveryService validates Haversine distance <= branch.serviceRadiusKm
   ├─ CatalogService atomically reserves stock (shelf quantity)
   ├─ PricingEngine locks authoritative prices into immutable item snapshots
   ├─ OrderService creates Order (#ASH-1001) & Fulfillment record
   ├─ DomainEvents emits ORDER_CREATED
   └─ NotificationService queues In-App & WhatsApp confirmation
   ↓
6. Customer receives HTTP 201 Created with order payload & orderNumber
```

### Flow B: Medicine Request & Proposal Approval
```text
1. Customer submits unlisted medicine request: POST /api/v1/medicine-requests
   ↓ Status: REQUESTED (assigned requestNumber: #MR-5001)
2. Pharmacist reviews request: GET /api/v1/medicine-requests?tenantId=...
   ↓ Pharmacist checks depot availability & formulates proposal
3. Pharmacist submits proposal: POST /api/v1/medicine-requests/:id/proposal
   ├─ Verified by requireTenantScope & requireTenantStaff
   ├─ Status transitions to PROPOSAL_SENT
   └─ DomainEvents emits PROPOSAL_CREATED -> Customer notified
   ↓
4. Customer reviews proposal on mobile/web portal
   ↓
5. Customer approves: POST /api/v1/medicine-requests/:id/approve
   ├─ Verified that caller is genuine request customer (IDOR protection)
   ├─ MedicineRequestService calls OrderService.createOrder with idempotency key
   ├─ Order created (#ASH-1002) & request status transitions to CONVERTED_TO_ORDER
   └─ Repeat approvals return existing order idempotently
```
