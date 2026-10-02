# API Contracts & Gateway Routing

**Specification:** Ashvin Platform API Gateway (v1)  
**Base URL:** `/api/v1`  
**Authentication:** HttpOnly Session Cookie or `Authorization: Bearer <token>`  
**Tenant Context Headers:**
- `x-tenant-id`: Target Tenant ID (e.g., `tenant-ashvin-main`)
- `x-branch-id`: Target Branch ID (e.g., `branch-indore-central`)
- `x-request-id`: Traceability Request ID (auto-generated if omitted)

---

## 1. Standard Error Envelope
All error responses adhere to the standard error contract:
```json
{
  "success": false,
  "error": {
    "code": "TENANT_ACCESS_DENIED",
    "message": "You do not have access to this tenant.",
    "requestId": "req-98f24b80"
  }
}
```

Standard Error Codes:
- `UNAUTHENTICATED`: Missing or invalid session.
- `FORBIDDEN`: Insufficient role or permission.
- `TENANT_ACCESS_DENIED`: User is not a member of the requested tenant.
- `BRANCH_ACCESS_DENIED`: User is not authorized for the requested branch.
- `OUT_OF_SERVICE_RADIUS`: Customer location is beyond branch service radius.
- `INSUFFICIENT_STOCK`: Requested quantity exceeds available inventory.
- `INVALID_COUPON`: Coupon does not exist, expired, or violates minimum order requirements.
- `STACKING_RULE_VIOLATION`: Conflicting combination of offer, coupon, or reward points.
- `IDEMPOTENCY_CONFLICT`: Concurrent or duplicate request with the same idempotency key.
- `INTEGRATION_UNAVAILABLE`: Branch external POS provider is offline or unreachable.

---

## 2. API Endpoints

### A. Tenant & Branch Management (`/api/v1/tenants`, `/api/v1/branches`)
- `GET /api/v1/tenants`: List accessible tenants.
- `POST /api/v1/tenants`: Create a new pharmacy tenant (Platform Super Admin).
- `GET /api/v1/tenants/:tenantId`: Get tenant profile and settings.
- `PUT /api/v1/tenants/:tenantId`: Update tenant profile.
- `GET /api/v1/tenants/:tenantId/branches`: List branches for a tenant.
- `POST /api/v1/tenants/:tenantId/branches`: Create a branch (service radius, delivery mode, minimum order value).
- `GET /api/v1/branches/:branchId`: Get specific branch details and delivery policy.
- `PUT /api/v1/branches/:branchId`: Update branch settings.

### B. Global Customer & Tenant Profiles (`/api/v1/customers`)
- `GET /api/v1/customers/me`: Get current authenticated customer profile and saved addresses.
- `GET /api/v1/customers/me/tenant-profiles`: List customer's relationship across all visited tenants.
- `GET /api/v1/customers/me/tenant-profile?tenantId=...`: Get profile, order history, and rewards at a specific pharmacy.

### C. Catalog & Branch Listings (`/api/v1/catalog`)
- `GET /api/v1/catalog/products`: Search global master pharmaceutical catalog.
- `GET /api/v1/catalog/listings?branchId=...`: Browse active product listings for a branch with prices and stock status.
- `GET /api/v1/catalog/listings/:id`: Get listing details.

### D. Branch Inventory & Bulk Import (`/api/v1/inventory`)
- `GET /api/v1/inventory?branchId=...`: List inventory levels for a branch.
- `POST /api/v1/inventory/adjust`: Adjust physical stock (reconciliation, manual correction).
- `POST /api/v1/inventory/bulk-import`: High-capacity chunked import (>5,000 items) with partial failure reporting.
- `GET /api/v1/inventory/bulk-import/:jobId`: Get import progress, status, and download failure report.

### E. Authoritative Pricing & Coupons (`/api/v1/pricing`)
- `POST /api/v1/pricing/calculate`: Authoritatively compute order pricing, discounts, and stacking rules.
- `GET /api/v1/pricing/coupons?branchId=...`: List applicable coupons for current customer.
- `POST /api/v1/pricing/coupons/validate`: Validate coupon code against cart items and stacking rules.

### F. Orders & Fulfillment (`/api/v1/orders`, `/api/v1/fulfillment`)
- `POST /api/v1/orders`: Create branch order with atomic stock reservation and immutable price/address snapshot.
- `GET /api/v1/orders`: List orders scoped by customer or tenant/branch staff.
- `GET /api/v1/orders/:id`: Get order detail with fulfillment status and delivery tracking.
- `POST /api/v1/fulfillment/:orderId/accept`: Branch staff accepts order for preparation.
- `POST /api/v1/fulfillment/:orderId/ready`: Order packed and marked ready for rider pickup.

### G. Delivery & Fleet Management (`/api/v1/delivery`)
- `POST /api/v1/delivery/check-serviceability`: Check if customer coordinates fall within branch service radius.
- `GET /api/v1/delivery/riders?branchId=...`: List branch fleet riders and availability.
- `POST /api/v1/delivery/assign`: Assign order delivery to a rider.
- `PUT /api/v1/delivery/jobs/:id/status`: Update delivery job (`PICKED_UP`, `OUT_FOR_DELIVERY`, `DELIVERED`).

### H. Medicine Requests & Proposals (`/api/v1/medicine-requests`)
- `POST /api/v1/medicine-requests`: Customer submits uncatalogued/out-of-stock medicine request.
- `GET /api/v1/medicine-requests`: List customer or branch requests.
- `POST /api/v1/medicine-requests/:id/proposal`: Pharmacist formulates pricing and delivery slot proposal.
- `POST /api/v1/medicine-requests/:id/approve`: Customer approves proposal (idempotently converts to order).
- `POST /api/v1/medicine-requests/:id/reject`: Customer declines proposal.

### I. Branch POS & C-Square Integration (`/api/v1/integrations`)
- `GET /api/v1/integrations?branchId=...`: Get integration settings and sync status.
- `PUT /api/v1/integrations?branchId=...`: Configure provider credentials (masked) and sync toggles.
- `POST /api/v1/integrations/test-connection`: Ping external POS / C-Square endpoint.
- `POST /api/v1/integrations/sync`: Trigger immediate on-demand inventory / catalog sync.
- `GET /api/v1/integrations/history?branchId=...`: View sync audit logs.
