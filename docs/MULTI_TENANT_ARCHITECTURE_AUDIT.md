# Multi-Tenant Pharmacy Platform & Branch Architecture — Audit

**Document Version:** 1.0.0  
**Repository:** ashvins1912/Pharma  
**Target Branch:** new-architecture  
**Auditor:** Principal Software Architect & Senior Engineering Team  

---

## 1. Executive Summary

This document performs an exhaustive architectural and code-level audit of the Ashvin Pharmacy repository prior to introducing multi-tenancy, branch architecture, global customer identity with tenant-scoped profiles, and optional C-Square / POS integration.

The existing application is a functioning, full-stack digital pharmacy built on Node.js/Express, Vite/React, Tailwind CSS, Supabase Authentication (with MFA Step-Up), and a dual-layer data store (MongoDB with an in-memory eager-loaded fallback).

### Key Architectural Finding
The original codebase operated under a single-tenant mental model:
- All medicines belonged to a single global catalog where product details, pricing, and physical stock were coupled in a single entity (`Medicine`).
- Orders did not carry a `tenantId` or `branchId` discriminator.
- Customers were treated either as authenticated Supabase users or demo users, directly linked to orders without a tenant-scoped relationship.
- Riders and delivery strategies operated globally across all orders.
- Medicine requests and proposals operated within a single pharmacy review loop.

The transformation must decouple global product definitions from branch-level inventory and listings, introduce multi-branch operations, establish global customer identity with tenant profiles, implement server-side centralized pricing with discount stacking, provide branch-level rider fleet management with radius-based serviceability, and provide a clean provider abstraction for C-Square / third-party POS sync.

---

## 2. Inventory & Catalog Decoupling Audit

### Current State
- `backend/models/Medicine.js` and `backend/dataStore.js` conflate:
  1. Universal drug specifications (Name, Composition, Manufacturer, Dosage Form, Strength, Pack Size).
  2. Commercial listing attributes (MRP, Discounted Price, Active Status).
  3. Physical warehouse/store stock (Stock count, Expiry Date, Batch Number, Reserved Stock).
- Bulk inventory uploads (`xlsx` import) write directly to the single catalog.

### Target Architecture
1. **Product (Global Master Catalog):**
   - Pure pharmaceutical identity: Generic Name, Composition, Manufacturer, Dosage Form, Strength, Barcode.
2. **BranchProductListing:**
   - Commercial offering of a branch: `tenantId`, `branchId`, `productId`, `mrp`, `sellingPrice`, `status` (`DRAFT`, `ACTIVE`, `INACTIVE`, `OUT_OF_STOCK`).
3. **BranchInventory:**
   - Physical stock ledger: `tenantId`, `branchId`, `productId`, `availableQuantity`, `reservedQuantity`, `batchNumber`, `expiryDate`, `source` (`ASHVIN`, `CSQUARE`, `MANUAL`).

---

## 3. Customer Ownership Model Audit

### Mandatory Architectural Decision
- **Customer is NOT tenant-owned.**
- Customer is a global Ashvin identity. A single human customer may purchase medications from multiple pharmacy tenants or branches (e.g., Tenant A for routine chronic medicines, Tenant B for specialized hospital dispensary).
- A customer must never be duplicated across tenants.
- **Tenant-Scoped Relationship (`CustomerTenantProfile`):**
  - Tracks tenant customer code, orders with that tenant, total amount spent, tenant loyalty points, notes, and tenant-specific status.
- **Addresses & Orders:**
  - Saved customer addresses belong to the global customer.
  - When an order is placed, an immutable `deliveryAddressSnapshot` is recorded with the order so future address updates never rewrite history.

---

## 4. Tenant & Branch Isolation Audit

### Tenant Hierarchy
```text
Ashvin Platform
  ├── Tenant (Legal entity / Pharmacy chain)
  │     ├── Branch 1 (Store / Warehouse / Dispensary)
  │     │     ├── Branch Listings
  │     │     ├── Branch Inventory
  │     │     ├── Branch Orders & Fulfillment
  │     │     ├── Branch Riders & Delivery Jobs
  │     │     └── Branch Integrations (e.g., C-Square)
  │     └── Branch 2 ...
  └── Tenant B ...
```

### Authorization & RequestContext
- A centralized `RequestContext` object must be constructed on incoming API requests:
  `{ requestId, userId, customerId, tenantId, branchId, roles, permissions, isPlatformUser }`
- Platform roles: `PLATFORM_SUPER_ADMIN`, `PLATFORM_OPERATIONS`, `PLATFORM_SUPPORT`, `PLATFORM_FINANCE`, `PLATFORM_FULFILLMENT_ADMIN`.
- Tenant roles: `TENANT_OWNER`, `TENANT_ADMIN`, `PHARMACIST`, `PHARMACY_STAFF`, `ORDER_MANAGER`, `INVENTORY_MANAGER`, `DISPATCHER`, `TENANT_RIDER`.
- Customer role: `CUSTOMER`.
- Every repository query must enforce tenant and branch scopes. Unscoped `findById` calls without tenant criteria are strictly disallowed for tenant-owned data.

---

## 5. Pricing & Commercial Rules Audit

### Current State
Pricing was calculated in multiple places (cart total calculation in frontend, server-side dynamic order service, and reward strategy).

### Target Architecture
A unified server-side **Authoritative Pricing Engine**:
1. Price tiers:
   - `MRP`: Maximum Retail Price printed on packaging.
   - `Source Selling Price`: Base price from inventory / supplier / POS.
   - `Ashvin Customer Price`: Base listing price before promotions.
   - `Offer`: Promotional discounts (percentage, fixed amount, category-wide).
   - `Coupon`: Tenant or customer-scoped promotional codes.
   - `Rewards`: Tenant-scoped loyalty point redemption.
   - `Final Payable Price`: Payable amount after validating discount stacking rules.
2. Discount Stacking Policy:
   - Configurable rules (e.g., `allowOfferWithCoupon: false`, `allowCouponWithRewards: true`, `allowOfferWithRewards: false`).
3. Historical Price Snapshots:
   - Order items snapshot `mrp`, `sourceSellingPrice`, `customerPrice`, `discount`, `finalUnitPrice`, `subtotal` at checkout.

---

## 6. Pharmacy / C-Square Integration Audit

### Current State
No external POS or ERP integration exists. The application relies entirely on internal MongoDB / in-memory catalog data.

### Target Architecture
- C-Square is an **optional provider integration**, not a core dependency.
- The core services (Catalog, Inventory, Order, Tenant) must never import or call C-Square directly.
- **Pharmacy Integration Service & Provider Adapter Pattern:**
  - Defines `PharmacyAdapter` interface: `getBranches()`, `syncProducts()`, `syncInventory()`, `syncPricing()`, `checkAvailability()`, `createOrder()`, `getOrderStatus()`, `cancelOrder()`, `getInvoice()`.
  - Concrete `CSquareAdapter` handles C-Square specifics (mock/stub with realistic contracts, configuration validation).
  - Branch-level configuration (`BranchIntegration`): Provider, API URL, Client ID, API Key, Store ID, capability toggles (`productSync`, `stockSync`, etc.), credentials encryption/masking, connection test, sync health, and sync history logs.
  - Idempotency guarantees for external order transmission to prevent duplicate bookings during network retries.

---

## 7. Delivery & Serviceability Audit

### Current State
- Delivery assignment engine (`OrderAssignmentEngine.js`, `ClosestRiderStrategy.js`, `DroneDeliveryStrategy.js`, `OrderClubbingStrategy.js`) operated on global rider pools.
- Riders had status and coordinates, but no tenant or branch affiliation.

### Target Architecture
- Riders belong to a specific Tenant and Branch (`tenantId`, `branchId`).
- Serviceability checks verify customer delivery coordinates against the branch latitude/longitude and `serviceRadiusKm`.
- Orders outside the branch's service radius cannot be placed for that branch.
- Delivery jobs are dispatched exclusively to riders affiliated with the fulfilling branch or authorized tenant fleet.

---

## 8. Migration Requirement Analysis

**Requirement:**
> Migration: NOT IMPLEMENTED — intentionally excluded by requirement.

As specified by the project brief, this is an early-stage system where legacy migration scripts, backfills, dual writes, and temporary compatibility collections are intentionally excluded. The new multi-tenant architecture is implemented cleanly and directly.

---

## 9. Implementation Roadmap

1. **Contracts & Shared Layer:**
   - Define TypeScript/JSDoc domain schemas for Tenant, Branch, Membership, Customer, CustomerTenantProfile, Product, Listing, Inventory, Pricing, Offers, Coupons, Rewards, Order, Fulfillment, Delivery, Medicine Request, and Branch Integration.
2. **Context & Scoped Authorization Middleware:**
   - Implement `RequestContext` extraction, role resolution, and tenant/branch isolation guards.
3. **Domain Services:**
   - Tenant & Branch Service.
   - Global Customer & CustomerTenantProfile Service.
   - Catalog & Branch Inventory Service with stock reservation.
   - High-capacity Bulk Inventory Import (>5,000 items, streaming, batching, partial failure report).
   - Server-Side Pricing Engine with stacking rules.
   - Multi-Tenant Order & Fulfillment Service.
   - Delivery & Branch Radius Serviceability Service.
   - Multi-Tenant Medicine Request & Proposal Service.
   - Pharmacy Integration Service & C-Square Adapter.
   - Centralized Notification & Domain Event Service.
4. **API Gateway (`/api/v1/*`):**
   - Standardized routing, centralized CORS, request IDs, and structured error responses.
   - Legacy `/api/*` compatibility preservation.
5. **Frontend Integration:**
   - Branch selection for customers.
   - Multi-tenant admin dashboard with branch switching and C-Square integration configuration.
6. **Documentation & Validation:**
   - Complete technical documentation suite and comprehensive automated test suite.
