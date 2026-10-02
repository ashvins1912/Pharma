# Domain Event Catalog

**System:** Ashvin Platform Domain Events  
**Pattern:** In-process Event Emitter with Extensible Async Dispatcher  

---

## 1. Domain Event Envelope
Every event emitted within the system adheres to a consistent envelope:

```ts
interface DomainEvent<T = any> {
  eventId: string;              // Unique event UUID
  eventType: string;            // Standardized event code
  tenantId?: string;            // Scoped tenant ID
  branchId?: string;            // Scoped branch ID
  entityId: string;             // ID of the mutated entity
  timestamp: string;            // ISO8601 timestamp
  actor: {
    userId: string;
    role: string;
  };
  payload: T;
}
```

---

## 2. Event Registry

### A. Tenant & Branch Events
- `TENANT_CREATED`: Fired when a new pharmacy tenant is onboarded.
- `BRANCH_CREATED`: Fired when a new branch location is registered.
- `BRANCH_SETTINGS_UPDATED`: Fired when delivery radius, minimum order, or operating hours change.

### B. Catalog & Inventory Events
- `PRODUCT_CREATED`: Fired when a new master drug is added to the global catalog.
- `LISTING_CREATED`: Fired when a product is listed by a branch.
- `LISTING_PRICE_CHANGED`: Fired when branch selling price or MRP is updated.
- `INVENTORY_ADJUSTED`: Fired when physical stock is counted or reconciled.
- `INVENTORY_RESERVED`: Fired upon order placement checkout.
- `INVENTORY_RELEASED`: Fired upon order cancellation or checkout expiration.
- `STOCK_SYNC_COMPLETED`: Fired after C-Square / POS stock synchronization.
- `STOCK_SYNC_FAILED`: Fired when C-Square / POS sync encounters an error.

### C. Order & Fulfillment Events
- `ORDER_CREATED`: Fired when customer completes checkout.
- `ORDER_ACCEPTED`: Fired when pharmacy confirms order preparation.
- `ORDER_READY`: Fired when pharmacist packs and marks order ready for dispatch.
- `ORDER_CANCELLED`: Fired when order is cancelled.
- `ORDER_DELIVERED`: Fired when courier completes proof of delivery.

### D. Delivery & Rider Events
- `RIDER_ASSIGNED`: Fired when dispatcher assigns a branch rider to an order.
- `RIDER_PICKED_UP`: Fired when courier takes possession of packed medicine.
- `RIDER_OUT_FOR_DELIVERY`: Fired when courier departs the branch towards customer.

### E. Medicine Request & Proposal Events
- `MEDICINE_REQUEST_CREATED`: Fired when customer requests an uncatalogued drug.
- `PROPOSAL_CREATED`: Fired when pharmacist formulates price and delivery slot.
- `PROPOSAL_APPROVED`: Fired when customer approves proposal (triggers order creation).
- `PROPOSAL_REJECTED`: Fired when customer declines proposal.
- `PROPOSAL_EXPIRED`: Fired when proposal valid duration passes without approval.

### F. Integration & Health Events
- `INTEGRATION_CONNECTED`: Fired when external POS test connection succeeds.
- `INTEGRATION_ERROR`: Fired when external POS communication fails.
