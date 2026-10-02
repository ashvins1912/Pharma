# Data Model & Entity Specifications

**Target Architecture:** Multi-Tenant Pharmacy Platform & Branch Architecture  
**Database:** Dual-mode (MongoDB schemas with Mongoose models + resilient in-memory fallback)  

---

## 1. Core Domain Schema Specifications

### A. Tenant
```ts
interface Tenant {
  _id: string;
  name: string;
  legalName: string;
  code: string;                 // Unique slug, e.g. "ashvin-indore"
  phone: string;
  email: string;
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  timezone: string;             // e.g. "Asia/Kolkata"
  currency: string;             // e.g. "INR"
  settings: {
    allowOfferWithCoupon: boolean;
    allowCouponWithRewards: boolean;
    allowOfferWithRewards: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

### B. Branch
```ts
interface Branch {
  _id: string;
  tenantId: string;             // References Tenant
  name: string;
  code: string;                 // Branch code e.g. "IND-01"
  phone: string;
  email: string;
  address: {
    street: string;
    city: string;
    state: string;
    pincode: string;
    coordinates: { lat: number; lng: number };
  };
  serviceRadiusKm: number;      // e.g. 8.5 km
  deliveryMode: 'OWN_RIDER' | 'THIRD_PARTY' | 'PICKUP_ONLY';
  minimumOrderValue: number;    // e.g. 199
  freeDeliveryAbove: number;    // e.g. 499
  deliveryFee: number;          // e.g. 35
  operatingHours: {
    open: string;               // "08:00"
    close: string;              // "22:00"
  };
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
}
```

### C. TenantMembership
```ts
interface TenantMembership {
  _id: string;
  userId: string;               // Auth User ID
  tenantId: string;
  branchId?: string;            // Nullable for tenant-wide admins
  role: 'TENANT_OWNER' | 'TENANT_ADMIN' | 'PHARMACIST' | 'PHARMACY_STAFF' | 'ORDER_MANAGER' | 'INVENTORY_MANAGER' | 'DISPATCHER' | 'TENANT_RIDER';
  permissions: string[];
  status: 'ACTIVE' | 'REVOKED';
  createdAt: Date;
}
```

### D. Customer & CustomerTenantProfile
```ts
// Global Ashvin Customer Identity
interface Customer {
  _id: string;
  userId: string;               // Unique Auth User ID (Supabase / local)
  name: string;
  email: string;
  phone: string;
  status: 'ACTIVE' | 'SUSPENDED';
  savedAddresses: Array<{
    id: string;
    label: string;
    street: string;
    city: string;
    state: string;
    pincode: string;
    coordinates: { lat: number; lng: number };
    isDefault: boolean;
  }>;
  createdAt: Date;
}

// Tenant-Scoped Commercial Relationship
interface CustomerTenantProfile {
  _id: string;
  customerId: string;           // References Global Customer
  tenantId: string;             // References Tenant
  customerCode?: string;        // Pharmacy POS / CRM code
  totalOrders: number;
  totalSpent: number;
  loyaltyPointsBalance: number;
  firstOrderAt?: Date;
  lastOrderAt?: Date;
  status: 'ACTIVE' | 'BLOCKED';
  internalNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### E. Product, BranchProductListing & BranchInventory
```ts
// Global Master Catalog
interface Product {
  _id: string;
  name: string;
  genericName: string;
  composition: string;
  manufacturer: string;
  dosageForm: string;
  strength: string;
  packSize: string;
  barcode?: string;
  category: string;
  requiresPrescription: boolean;
  status: 'ACTIVE' | 'DISCONTINUED';
}

// Branch Commercial Offering
interface BranchProductListing {
  _id: string;
  tenantId: string;
  branchId: string;
  productId: string;            // References Product
  mrp: number;
  sellingPrice: number;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK';
  updatedAt: Date;
}

// Physical Stock Ledger
interface BranchInventory {
  _id: string;
  tenantId: string;
  branchId: string;
  productId: string;
  availableQuantity: number;
  reservedQuantity: number;
  batchNumber?: string;
  expiryDate?: Date;
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  source: 'ASHVIN' | 'CSQUARE' | 'MANUAL';
  lastSyncedAt?: Date;
}
```

### F. PricingRule, Offer, Coupon & RewardAccount
```ts
interface PricingRule {
  _id: string;
  tenantId: string;
  branchId?: string;
  name: string;
  ruleType: 'PERCENTAGE_DISCOUNT' | 'FIXED_DISCOUNT' | 'MARKUP_PERCENTAGE';
  value: number;
  minOrderValue?: number;
  status: 'ACTIVE' | 'INACTIVE';
}

interface Coupon {
  _id: string;
  tenantId: string;
  branchId?: string;
  code: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  customerId?: string;          // Customer-specific coupon
  minimumOrderValue: number;
  maximumDiscount?: number;
  validFrom: Date;
  validUntil: Date;
  usageLimit: number;
  perCustomerLimit: number;
  status: 'ACTIVE' | 'EXPIRED' | 'DISABLED';
}
```

### G. Order & FulfillmentOrder
```ts
interface OrderItem {
  productId: string;
  listingId: string;
  name: string;
  quantity: number;
  mrpSnapshot: number;
  sourceSellingPriceSnapshot: number;
  customerPriceSnapshot: number;
  discountSnapshot: number;
  finalUnitPrice: number;
  subtotal: number;
}

interface Order {
  _id: string;
  orderNumber: string;
  tenantId: string;
  branchId: string;
  customerId: string;
  customerName: string;
  customerMobile: string;
  items: OrderItem[];
  subtotal: number;
  offerDiscount: number;
  couponDiscount: number;
  rewardsDiscount: number;
  deliveryFee: number;
  tax: number;
  finalTotal: number;
  deliveryAddressSnapshot: {
    street: string;
    city: string;
    state: string;
    pincode: string;
    coordinates: { lat: number; lng: number };
  };
  paymentMethod: 'COD' | 'ONLINE' | 'UPI';
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED';
  orderStatus: 'SUBMITTED' | 'ACCEPTED' | 'PROCESSING' | 'READY_FOR_DISPATCH' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
  source: 'ONLINE_STORE' | 'MEDICINE_REQUEST';
  medicineRequestId?: string;
  createdAt: Date;
}

interface FulfillmentOrder {
  _id: string;
  orderId: string;
  tenantId: string;
  branchId: string;
  fulfillmentMode: 'VENDOR_FULFILLMENT' | 'ASHVIN_FULFILLMENT' | 'EXTERNAL_FULFILLMENT';
  status: 'PENDING' | 'ACCEPTED' | 'PACKED' | 'DISPATCHED' | 'COMPLETED';
  packedAt?: Date;
}
```

### H. BranchIntegration (C-Square / Third-Party POS)
```ts
interface BranchIntegration {
  _id: string;
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
  config: {
    apiUrl: string;
    clientId: string;
    storeId: string;
    encryptedApiKey?: string;
    syncIntervalMinutes: number;
  };
  lastSuccessfulSyncAt?: Date;
  lastFailedSyncAt?: Date;
  lastSyncError?: string;
  syncHistory: Array<{
    jobId: string;
    timestamp: Date;
    type: 'STOCK' | 'PRODUCT' | 'ORDER';
    status: 'SUCCESS' | 'FAILED';
    itemsProcessed: number;
    error?: string;
  }>;
}
```
