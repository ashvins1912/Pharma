# Multi-Tenant Pharmacy Platform & Branch Architecture

**Platform:** Ashvin Multi-Tenant Pharmacy Commerce & Fulfillment Platform  
**Architecture Version:** 2.0.0  
**Target Branch:** new-architecture  

---

## 1. Architectural Philosophy

The Ashvin Platform is architected around six core tenets:
1. **Identity is Not Ownership:** A human customer has a single global Ashvin identity. They can purchase from multiple pharmacy tenants without account duplication.
2. **Strict Tenant & Branch Isolation:** All operational and commercial data (inventory, orders, pricing, medicine requests, riders) is strictly isolated by `tenantId` and `branchId`.
3. **Product vs. Listing vs. Inventory:** Global pharmaceutical identity (`Product`) is distinct from a branch's commercial offering (`BranchProductListing`), which is distinct from warehouse physical stock (`BranchInventory`).
4. **Authoritative Server-Side Pricing:** One central pricing engine computes MRP, discounts, offers, coupons, and loyalty rewards, enforcing strict stacking rules and capturing immutable price snapshots.
5. **Clean Provider Abstraction for Integrations:** Third-party POS/ERP systems (such as C-Square) are optional adapters attached to branch integrations. Core services never depend directly on specific vendors.
6. **Extensible Fulfillment & Branch-Radius Delivery:** Orders are converted into fulfillments and dispatched to branch-scoped rider fleets using radius-based serviceability.

---

## 2. High-Level System Architecture

```text
                               +----------------------------------+
                               |     Ashvin Global Customer       |
                               | (Single Auth, Profile, Addresses)|
                               +-----------------+----------------+
                                                 |
                                                 v
                               +----------------------------------+
                               |       API Gateway (/api/v1)      |
                               | (CORS, RequestContext, Auth/RBAC)|
                               +-----------------+----------------+
                                                 |
         +--------------------+------------------+------------------+---------------------+
         |                    |                  |                  |                     |
         v                    v                  v                  v                     v
+-----------------+  +-----------------+  +----------------+  +------------------+  +-------------------+
| Tenant Service  |  | Catalog Service |  | Pricing Engine |  |  Order Service   |  | Integration Svc   |
| (Tenants,       |  | (Global Catalog,|  | (MRP, Offers,  |  |  (Fulfillment,   |  | (Provider Adapter,|
|  Branches,      |  |  Branch Listings|  |  Coupons,      |  |   Delivery Jobs, |  |  C-Square Stub,   |
|  Memberships)   |  |  Branch Stock)  |  |  Stacking)     |  |   Stock Reserve) |  |  Branch Sync)     |
+-----------------+  +-----------------+  +----------------+  +------------------+  +-------------------+
```

---

## 3. Customer Ownership Model

A customer is modeled globally:
```ts
Customer {
  id: string;               // Global Ashvin Customer ID (e.g., cust-001)
  userId: string;           // Associated Auth User ID (e.g., Supabase sub)
  name: string;
  phone: string;
  email: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
}
```

The customer's commercial relationship with each pharmacy is isolated via `CustomerTenantProfile`:
```ts
CustomerTenantProfile {
  id: string;
  customerId: string;       // References Global Customer
  tenantId: string;         // Isolated Pharmacy Tenant
  customerCode?: string;    // Tenant-specific CRM/POS Code
  totalOrders: number;
  totalSpent: number;
  loyaltyPointsBalance: number;
  status: 'ACTIVE' | 'BLOCKED';
  firstOrderAt?: string;
  lastOrderAt?: string;
}
```

**Privacy Guarantee:** Tenant A cannot see the customer's orders, loyalty points, or notes at Tenant B.

---

## 4. Catalog, Listing, and Inventory Separation

### 1. Global Product Master
```ts
Product {
  id: string;
  name: string;
  genericName: string;
  composition: string;
  manufacturer: string;
  dosageForm: 'Tablet' | 'Capsule' | 'Syrup' | 'Injection' | 'Ointment' | 'Drops';
  strength: string;
  packSize: string;
  barcode?: string;
  requiresPrescription: boolean;
}
```

### 2. Branch Product Listing
```ts
BranchProductListing {
  id: string;
  tenantId: string;
  branchId: string;
  productId: string;
  mrp: number;
  sellingPrice: number;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK';
}
```

### 3. Branch Inventory
```ts
BranchInventory {
  id: string;
  tenantId: string;
  branchId: string;
  productId: string;
  availableQuantity: number;
  reservedQuantity: number;
  batchNumber?: string;
  expiryDate?: string;
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  source: 'ASHVIN' | 'CSQUARE' | 'MANUAL';
  lastSyncedAt?: string;
}
```

---

## 5. Pricing Engine & Stacking Rules

Calculates final customer prices on the server. Never trusts frontend pricing calculations.

### Pricing Pipeline
1. **Base Price:** `BranchProductListing.sellingPrice` (bounded by `mrp`).
2. **Promotional Offers:** Branch/Tenant level percentage or fixed discounts.
3. **Coupons:** Tenant, branch, or customer-targeted promotional codes with minimum order value and maximum discount limits.
4. **Reward Points:** Tenant loyalty point redemption (e.g., 100 points = ₹10 off).
5. **Stacking Rule Enforcement:**
   ```json
   {
     "allowOfferWithCoupon": false,
     "allowCouponWithRewards": true,
     "allowOfferWithRewards": false
   }
   ```
6. **Snapshotting:** Price breakdown is captured immutably inside each `OrderItem`.

---

## 6. Optional Pharmacy & C-Square Integration Architecture

- Built using the **Provider Adapter Pattern**:
```text
Order / Inventory Service
           |
           v
Pharmacy Integration Service
           |
     PharmacyAdapter
      /          \
CSquareAdapter   GenericPOSAdapter
```

- **Branch Integration Model:**
```ts
BranchIntegration {
  id: string;
  tenantId: string;
  branchId: string;
  provider: 'CSQUARE' | 'MANUAL' | 'OTHER_POS';
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  capabilities: {
    productSync: boolean;
    stockSync: boolean;
    priceSync: boolean;
    orderSync: boolean;
    invoiceSync: boolean;
  };
  syncSettings: {
    apiUrl: string;
    clientId: string;
    storeId: string;
    syncIntervalMinutes: number;
  };
  lastSuccessfulSyncAt?: string;
  lastFailedSyncAt?: string;
}
```
- API Keys / Passwords are never returned over public GET endpoints.
- When C-Square is not configured, the branch defaults to Ashvin Managed Inventory.

---

## 7. Migration Note

> `Migration: NOT IMPLEMENTED — intentionally excluded by requirement.`
