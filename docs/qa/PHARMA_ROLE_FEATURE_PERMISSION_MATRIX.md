# PHARMA – MASTER ROLE-PERMISSION-FEATURE MATRIX & RBAC GOVERNANCE

## 1. Executive Summary & Architecture Standard

This matrix serves as the authoritative, production-audited specification for Role-Based Access Control (RBAC), Multi-Tenant & Branch Scoping, Gateway Capabilities, and Blocker Intelligence across the Pharma platform.

The system enforces defense-in-depth across 4 architectural layers:
1. **Frontend Visibility**: Declarative UI checks via `hasPermission()`, `hasAnyPermission()`, `canAccessOperations`, and `isSuperAdmin`. Hiding UI is an ergonomics convention only; security is never assumed on the client.
2. **Gateway Capability Enforcement**: Centralized edge reverse-proxy matching route patterns against `@pharma/service-kernel` permission trees (`api-gateway/src/apiCapabilityRegistry.js`). Rejects unauthorized traffic with `403 FORBIDDEN` or unauthenticated requests with `401 UNAUTHORIZED`.
3. **Backend Authorization & Tenant/Branch Scoping**: Domain middleware (`withTenantSecurity`, `AuthorizationService`, `tenantScope`, `deliveryScope`) verifying active tenant membership, branch boundaries, and permission versioning.
4. **Data-Level Isolation & Audit Logging**: MongoDB / Memory DataStore queries explicitly parameterized by `tenantId` and `branchId`, coupled with immutable mutation audit logging.

---

## 2. Master Role Classification

| Role Code | Role Name | System Scope | Default Description |
|---|---|---|---|
| `SUPER_ADMIN` / `admin` | Platform Super Administrator | `PLATFORM` | Global system governor with platform-wide observability, tenant onboarding, approval, role-permission catalog management, and emergency diagnostics. |
| `TENANT_OWNER` | Pharmacy Tenant Owner | `TENANT` | Legal entity owner with full authority over dispensary profile, branch networks, bank accounts, staff memberships, and pricing policies. |
| `TENANT_ADMIN` | Pharmacy Tenant Administrator | `TENANT` | Operational administrator managing inventory batches, fulfillment orders, staff assignments, customer proposals, and branch delivery fleets. |
| `PHARMACIST` / `pharmacy` | Licensed Pharmacist / Manager | `TENANT` | Clinical specialist reviewing digital prescriptions, creating custom medicine proposals, validating dispensing safety, and managing emergency stock. |
| `PHARMACY_STAFF` / `STAFF` | Dispensary Operations Staff | `TENANT` (Branch) | Operational personnel restricted to assigned dispensary branch inventory, order packing, and customer delivery handoffs. |
| `INVENTORY_MANAGER` | Inventory & Batch Manager | `TENANT` | Warehouse specialist managing wholesale purchase receipts, expiry monitoring, and stock reconciliation. |
| `ORDER_MANAGER` | Dispatch & Logistics Manager | `TENANT` | Logistics supervisor overseeing delivery routing, order clubbing, and rider fleet assignments. |
| `RIDER` / `rider` | Delivery Courier Agent | `TENANT` (Fleet) | Field courier receiving route assignments, updating live GPS pins, validating delivery OTPs, and collecting COD payments. |
| `CUSTOMER` / `customer` | End Customer / Patient | `CUSTOMER` | Self-service patient browsing medicines, saving delivery drop-offs, uploading prescriptions, and tracking order dispatches. |

---

## 3. Centralized Role-Permission-Feature Matrix

| Feature | Customer | Tenant Owner | Tenant Admin | Pharmacist / Staff | Super Admin | Required Permission | Required Scope | Gateway Capability Rule |
|---|---|---|---|---|---|---|---|---|
| **Customer Cart & Checkout** | **Allow** | Restricted (Unless patient) | Restricted (Unless patient) | Restricted (Unless patient) | Restricted (Unless patient) | `orders.create` | `CUSTOMER` | `POST /api/orders/checkout` |
| **Storefront Catalog & Discovery** | **Allow** (Public) | **Allow** | **Allow** | **Allow** | **Allow** | *Public Path* | `PUBLIC` | `GET /api/medicines` |
| **Saved Addresses & GPS Delivery Pins**| **Allow** (Own) | Deny by default | Deny by default | Deny by default | Deny by default | `profile.read`, `profile.write` | `CUSTOMER` | `/api/user/addresses` |
| **Customer Medicine Requests** | **Allow** (Own) | Deny by default | Deny by default | Deny by default | Deny by default | `medicine_requests.create` | `CUSTOMER` | `POST /api/medicine-requests` |
| **Dispensary Profile & Legal KYC** | Deny (`403`) | **Allow** (Manage) | **Allow** (Read/Write) | Deny (`403`) | **Allow** (Governance) | `tenant.profile.read`, `tenants.manage` | `TENANT` | `/api/v1/vendor/profile` |
| **Dispensary Branch Management** | Deny (`403`) | **Allow** (Full) | **Allow** (Assigned) | Deny (`403`) | **Allow** (Platform) | `tenant.branches.manage` | `TENANT` | `/api/v1/tenant/branches` |
| **Members & Staff Access Governance** | Deny (`403`) | **Allow** (Invite/Role) | **Allow** (Non-Admin) | Deny (`403`) | **Allow** (Global) | `users.read`, `users.manage` | `TENANT` | `/api/v1/tenants/:id/memberships` |
| **Tenant Stock Inventory & Batches** | Deny (`403`) | **Allow** (Tenant) | **Allow** (Tenant) | **Allow** (Branch-Scoped) | **Allow** (All) | `inventory.read`, `inventory.write` | `TENANT` | `/api/medicines/admin/inventory` |
| **Fulfillment Kanban & Order Pipeline**| Deny (`403`) | **Allow** (Tenant) | **Allow** (Tenant) | **Allow** (Branch-Scoped) | **Allow** (All) | `orders.read`, `orders.manage` | `TENANT` | `/api/orders/admin/all` |
| **Prescription Review & AI OCR** | Deny (`403`) | **Allow** | **Allow** | **Allow** (Pharmacist) | **Allow** | `prescription.review` | `TENANT` | `/api/v1/prescriptions/:id/review` |
| **Pharmacist Proposals** | Customer Accepts | **Allow** | **Allow** | **Allow** | **Allow** | `medicine_requests.proposal` | `TENANT` | `/api/medicine-requests/:id/proposal` |
| **Surplus Savings & Offer Campaigns** | View & Redeem | **Allow** | **Allow** | Deny by default | **Allow** | `promotions.read`, `promotions.manage` | `TENANT` | `/api/surplus-savings/admin` |
| **Rider Fleet & Logistics Routing** | Deny (`403`) | **Allow** | **Allow** | Restricted | **Allow** | `delivery.read`, `delivery.manage` | `TENANT` | `/api/admin/riders`, `/api/admin/assignment` |
| **Payment Reminders & Signed Nonces** | Direct Nonce Pay | **Allow** | **Allow** | Deny (`403`) | **Allow** | `billing.read`, `billing.write` | `TENANT` | `/api/v1/admin/payments` |
| **C-Square ERP Integration** | Deny (`403`) | **Allow** | **Allow** | **Allow** (Sync) | **Allow** | `csquare.read`, `csquare.manage`, `csquare.sync` | `TENANT` | `/api/v1/integrations` |
| **Platform Tenant Lifecycle & Onboarding**| Deny (`403`) | Deny (`403`) | Deny (`403`) | Deny (`403`) | **Allow** (Super Admin Only) | `tenants.read`, `tenants.manage` | `PLATFORM` | `/api/v1/admin/tenants` |
| **Global SMTP & Email Governance** | Deny (`403`) | Tenant SMTP Only | Tenant SMTP Only | Deny (`403`) | **Allow** (Platform SMTP) | `tenants.manage` / SuperAdmin | `PLATFORM` | `/api/v1/admin/tenants/smtp/config` |
| **Service Activity Audit Logs** | Deny (`403`) | Tenant Activity | Tenant Activity | Deny (`403`) | **Allow** (Platform Logs) | `users.read`, `inventory.read` | `TENANT` / `PLATFORM` | `/api/medicines/audits`, `/api/v1/activity` |
| **Live Telemetry & Feature Health** | Deny (`403`) | Deny (`403`) | Deny (`403`) | Deny (`403`) | **Allow** (Super Admin Only) | `platform.*` / SuperAdmin | `PLATFORM` | `/api/v1/admin/feature-health` |

---

## 4. Blocker Classification Taxonomy

Every operational anomaly detected by automated test suites or live health probes must be categorized into one of the 8 canonical blocker taxonomies:

1. **`RBAC_BLOCKER`**: Missing permission keys, role assignment mismatch, defective wildcard resolution, or unhandled permission revocation.
2. **`TENANT_ISOLATION_BLOCKER`**: Cross-tenant data leakage, leaking branch records across boundaries, or missing tenant scoping in query criteria.
3. **`AUTHENTICATION_BLOCKER`**: Expired sessions, rejected JWT claims, invalid CSRF double-submit cookies, or failed Google OAuth token exchange.
4. **`API_BLOCKER`**: Upstream HTTP errors (401, 403, 404, 429, 500, 502, 503), missing gateway capability mappings, or route schema mismatches.
5. **`DATABASE_BLOCKER`**: MongoDB disconnections, query buffering timeouts, index collisions, or unhandled in-memory fallback transitions.
6. **`SERVICE_BLOCKER`**: Microservice unresponsiveness, WebSocket stream disconnects, cold-start latency spikes (>60s), or external ERP adapter dropouts.
7. **`UI_BLOCKER`**: Uncaught React component rendering errors, blank screens, persistent loading spinners, broken button click handlers, or focus trap locks.
8. **`BUSINESS_WORKFLOW_BLOCKER`**: Fulfillment state machine illegal transitions, broken price formulas, stock under-allocation, or failed OTP verifications.

---

## 5. Blocker Severity & Impact Matrix

- **P0 – Critical Outage / Security Breach**: Cross-tenant data exposure, unauthorized Super Admin escalation, customer checkout completely down, or severe data corruption.
- **P1 – High Priority Blocker**: Tenant administrator cannot dispatch orders, prescription verification worker halted, inventory reconciliation blocked, or customer login failure.
- **P2 – Medium Operational Degradation**: Delayed telemetry streams, non-critical filter failure, temporary analytics chart lag, or optional notification failure.
- **P3 – Low Priority / Cosmetic**: Minor layout misalignment, translated copy typo, or harmless non-blocking console warning.
