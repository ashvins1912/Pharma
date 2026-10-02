# Authorization Model & Scoped Context

**Security Architecture:** Multi-Tenant Role-Based Access Control (RBAC) with Branch Scoping  
**Protocol:** RequestContext Injection via Gateway Middleware  

---

## 1. Centralized Request Context
Every incoming HTTP request passing through the API Gateway is resolved into an immutable `RequestContext`:

```ts
interface RequestContext {
  requestId: string;            // Traceability UUID
  userId: string;               // Authenticated user ID (Supabase sub or demo)
  customerId?: string;          // Global customer ID if user is a customer
  tenantId?: string;            // Resolved & verified target tenant
  branchId?: string;            // Resolved & verified target branch
  isPlatformUser: boolean;      // True for Ashvin Platform Super Admins
  platformRole?: string;
  tenantMembership?: {
    role: string;
    branchId?: string;          // Specific branch or null for all branches in tenant
    permissions: string[];
  };
}
```

---

## 2. Platform Roles vs. Tenant Roles

### Platform Roles (Ashvin Operators)
- `PLATFORM_SUPER_ADMIN`: Full cross-tenant read/write, tenant onboarding, system diagnostics.
- `PLATFORM_OPERATIONS`: Cross-tenant health monitoring, centralized dispatch escalation.
- `PLATFORM_SUPPORT`: Customer profile assistance and cross-tenant dispute resolution.
- `PLATFORM_FINANCE`: Billing, commission reconciliation, and subscription management.
- `PLATFORM_FULFILLMENT_ADMIN`: Centralized rider fleet and delivery SLA monitoring.

### Tenant Roles (Staff of a Specific Pharmacy)
- `TENANT_OWNER`: Pharmacy legal owner; manages billing, branches, and staff memberships.
- `TENANT_ADMIN`: Branch manager; manages inventory, pricing, coupons, and staff.
- `PHARMACIST`: Reviews prescriptions, reviews medicine requests, creates proposals, approves dispensing.
- `PHARMACY_STAFF`: Packs orders, updates inventory, assists in stock intake.
- `ORDER_MANAGER`: Accepts orders, verifies payment status, updates fulfillment states.
- `INVENTORY_MANAGER`: Configures bulk uploads, reconciles stock with POS, configures C-Square integration.
- `DISPATCHER`: Assigns branch riders, tracks order transit, monitors delivery SLA.
- `TENANT_RIDER`: Dedicated branch courier; receives assignments, updates drop-off status.

### Customer Role
- `CUSTOMER`: Global customer account; can search any pharmacy, place orders, submit requests, and maintain multiple tenant profiles.

---

## 3. Scope Resolution & Isolation Rules

1. **Header Verification:**
   - When a request supplies `x-tenant-id`, the middleware verifies that the user holds an active `TenantMembership` for that tenant (or has `isPlatformUser: true`).
   - If not verified, the request is immediately rejected with:
     ```json
     { "success": false, "error": { "code": "TENANT_ACCESS_DENIED" } }
     ```
2. **Branch Isolation:**
   - If a staff member has `branchId: "branch-indore-01"` in their membership, any attempt to access data for `"branch-indore-02"` is rejected with:
     ```json
     { "success": false, "error": { "code": "BRANCH_ACCESS_DENIED" } }
     ```
3. **Customer Isolation:**
   - Customer endpoints (`/api/v1/customers/me/*`, `/api/v1/orders/my-orders`, `/api/v1/medicine-requests/my-requests`) strictly query by `customerId = req.context.customerId`.
   - Customer C001 cannot query or inspect orders, addresses, or requests belonging to Customer C002.
4. **No Trust of Client Body:**
   - Controller handlers never read `req.body.tenantId` or `req.query.tenantId` to establish authorization. The authoritative tenant ID comes exclusively from `req.context.tenantId`.
