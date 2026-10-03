# Ashvin Pharmacy — API Final Security Matrix

**Platform:** Ashvin Multi-Tenant Pharmacy Commerce, Fulfillment & Logistics Engine  
**Document:** `docs/API_FINAL_SECURITY_MATRIX.md`  
**Generated At:** 2026-10-03  

---

## 1. Gateway & Multi-Tenant Endpoint Security Matrix

| HTTP Method & Endpoint | Auth Required | Allowed Roles / Identities | Tenant Scope | Input Validation | Rate Limit | Idempotency | Audit Trail | Expected Status Codes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET /api/v1/health` | None | Public | Global | None | Standard (100/min) | Safe Read | None | 200 |
| `GET /api/v1/tenants` | None | Public | Global | Query filters | Standard (60/min) | Safe Read | None | 200 |
| `GET /api/v1/tenants/:tenantId` | None | Public | Tenant Scoped | Params (`:tenantId`) | Standard (60/min) | Safe Read | None | 200, 404 |
| `POST /api/v1/tenants` | Bearer Token | `PLATFORM_SUPER_ADMIN` | Global | Zod schema body | Strict (10/min) | Header Key | Admin Log | 201, 400, 401, 403 |
| `GET /api/v1/tenants/branches/all` | None | Public | Global | Query filters | Standard (60/min) | Safe Read | None | 200 |
| `GET /api/v1/tenants/:tenantId/branches` | None | Public | Tenant Scoped | Params (`:tenantId`) | Standard (60/min) | Safe Read | None | 200, 404 |
| `POST /api/v1/tenants/:tenantId/branches` | Bearer Token | `PLATFORM_SUPER_ADMIN`, `TENANT_OWNER`, `TENANT_ADMIN` | Tenant Scoped | Zod schema body | Strict (15/min) | Header Key | Admin Log | 201, 400, 401, 403 |
| `PUT /api/v1/tenants/branches/:branchId` | Bearer Token | `PLATFORM_SUPER_ADMIN`, `TENANT_OWNER`, `TENANT_ADMIN` | Branch Scoped | Zod schema body | Strict (15/min) | Safe Put | Admin Log | 200, 400, 401, 403, 404 |
| `GET /api/v1/customers/me` | Bearer Token | Authenticated Customer | Caller Bound | None | Standard (60/min) | Safe Read | None | 200, 401 |
| `GET /api/v1/customers/me/tenant-profiles` | Bearer Token | Authenticated Customer | Caller Bound | None | Standard (60/min) | Safe Read | None | 200, 401 |
| `GET /api/v1/customers/me/tenant-profile` | Bearer Token | Authenticated Customer | Tenant Scoped | Query (`tenantId`) | Standard (60/min) | Safe Read | None | 200, 400, 401 |
| `GET /api/v1/customers/me/addresses` | Bearer Token | Authenticated Customer | Caller Bound | None | Standard (60/min) | Safe Read | None | 200, 401 |
| `POST /api/v1/customers/me/addresses` | Bearer Token | Authenticated Customer | Caller Bound | Coordinates & Address | Standard (30/min) | Header Key | Customer Log | 201, 400, 401 |
| `GET /api/v1/catalog/products` | None | Public | Global | Query string (`q`) | Standard (120/min) | Safe Read | None | 200 |
| `GET /api/v1/catalog/listings` | None | Public | Branch Scoped | Query (`branchId`) | Standard (120/min) | Safe Read | None | 200, 404 |
| `GET /api/v1/inventory` | Bearer Token | `INVENTORY_MANAGER`, `TENANT_ADMIN`, `PHARMACIST` | Tenant & Branch | Query (`branchId`) | Standard (60/min) | Safe Read | Staff Log | 200, 400, 401, 403 |
| `POST /api/v1/inventory/adjust` | Bearer Token | `INVENTORY_MANAGER`, `TENANT_ADMIN`, `PHARMACIST` | Tenant & Branch | Stock number & Product | Strict (30/min) | Header Key | Stock Audit | 200, 400, 401, 403, 404 |
| `POST /api/v1/inventory/bulk-import` | Bearer Token | `INVENTORY_MANAGER`, `TENANT_ADMIN` | Tenant & Branch | Array of records | Strict (5/min) | Job ID | Bulk Audit | 202, 400, 401, 403 |
| `GET /api/v1/inventory/bulk-import/:jobId` | Bearer Token | `INVENTORY_MANAGER`, `TENANT_ADMIN` | Tenant Scoped | Params (`:jobId`) | Standard (60/min) | Safe Read | None | 200, 401, 403, 404 |
| `POST /api/v1/pricing/calculate` | Optional Auth | Any | Tenant & Branch | Items array & Coupon | Standard (120/min) | Safe Read | None | 200, 400, 422 |
| `GET /api/v1/pricing/coupons` | None | Public | Tenant Scoped | Query (`tenantId`) | Standard (60/min) | Safe Read | None | 200 |
| `GET /api/v1/orders` | Bearer Token | Customer (own), Staff (tenant), SuperAdmin | Tenant / Customer | Query (`status`, `page`) | Standard (60/min) | Safe Read | None | 200, 401 |
| `GET /api/v1/orders/:id` | Bearer Token | Customer (own), Staff (tenant), SuperAdmin | Tenant / Customer | Params (`:id`) | Standard (60/min) | Safe Read | None | 200, 401, 403, 404 |
| `POST /api/v1/orders` | Bearer Token | Customer, Staff, SuperAdmin | Tenant & Branch | Items, Address, Coupon | Strict (20/min) | `Idempotency-Key` | Order Audit | 200 (dup), 201, 400, 401, 409, 422 |
| `PATCH /api/v1/orders/:id/status` | Bearer Token | Staff, SuperAdmin, Customer (cancel only) | Tenant Scoped | Target status string | Strict (30/min) | Safe Transition | Status FSM Log | 200, 400, 401, 403, 404 |
| `POST /api/v1/delivery/check-serviceability` | None | Public | Branch Scoped | Coordinates `{lat, lng}` | Standard (60/min) | Safe Read | None | 200, 400, 404 |
| `GET /api/v1/delivery/riders` | Bearer Token | Staff, Dispatcher, SuperAdmin | Tenant & Branch | Query (`branchId`) | Standard (60/min) | Safe Read | None | 200, 401, 403 |
| `POST /api/v1/delivery/assign` | Bearer Token | Dispatcher, Staff, SuperAdmin | Tenant & Branch | Order & Rider ID | Strict (30/min) | Safe Assign | Dispatch Log | 200, 400, 401, 403, 404 |
| `GET /api/v1/medicine-requests` | Bearer Token | Customer (own), Staff (tenant) | Tenant / Customer | Query (`status`) | Standard (60/min) | Safe Read | None | 200, 401 |
| `GET /api/v1/medicine-requests/:id` | Bearer Token | Customer (own), Staff (tenant) | Tenant / Customer | Params (`:id`) | Standard (60/min) | Safe Read | None | 200, 401, 403, 404 |
| `POST /api/v1/medicine-requests` | Bearer Token | Customer | Tenant & Branch | Medicine details & note | Strict (15/min) | Header Key | Request Audit | 201, 400, 401 |
| `POST /api/v1/medicine-requests/:id/proposal` | Bearer Token | Pharmacist, Staff, SuperAdmin | Tenant Scoped | Proposal pricing & slot | Strict (30/min) | Safe Update | Proposal Audit | 200, 400, 401, 403, 404 |
| `POST /api/v1/medicine-requests/:id/approve` | Bearer Token | Request Customer | Customer Bound | Approval note | Strict (15/min) | `idemp-prop-conv` | Conversion Audit | 200, 400, 401, 403, 404 |
| `POST /api/v1/medicine-requests/:id/reject` | Bearer Token | Request Customer | Customer Bound | Decline reason | Strict (15/min) | Safe Decline | Decline Audit | 200, 400, 401, 403, 404 |
| `GET /api/v1/integrations` | Bearer Token | Tenant Owner / Admin | Tenant & Branch | Query (`branchId`) | Standard (30/min) | Safe Read | Masked Secret | 200, 401, 403, 404 |
| `PUT /api/v1/integrations` | Bearer Token | Tenant Owner / Admin | Tenant & Branch | Provider, API URLs, Keys | Strict (10/min) | Safe Update | Config Audit | 200, 400, 401, 403 |
| `POST /api/v1/integrations/test-connection` | Bearer Token | Tenant Owner / Admin | Tenant & Branch | Body (`branchId`) | Strict (10/min) | Safe Ping | Outbound Ping | 200, 401, 403, 503 |
| `POST /api/v1/integrations/sync` | Bearer Token | Tenant Owner / Admin | Tenant & Branch | Sync type (`STOCK`/`PRICE`)| Strict (5/min) | Job ID | Sync Audit | 200, 401, 403, 503 |
| `GET /api/v1/notifications` | Bearer Token | Authenticated User | Caller Bound | None | Standard (60/min) | Safe Read | None | 200, 401 |
| `PATCH /api/v1/notifications/:id/read` | Bearer Token | Authenticated User | Caller Bound | Params (`:id`) | Standard (60/min) | Safe Update | Read Ack | 200, 401, 404 |

---

## 2. Authentication & Credential Security Matrix

| Endpoint | Method | Credentials Required | Session Cookies Set | MFA Elevation | Protection Mechanisms | Expected Status Codes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/auth/csrf` | GET | None | `XSRF-TOKEN` | N/A | Anti-CSRF Cookie Generation | 200 |
| `/api/auth/login` | POST | Email, Password | `sb-access-token` (if no MFA) | AAL1 or Challenge | Scrypt Salt & Hash, Rate Limiting, Timing Safe Compare | 200, 400, 401 |
| `/api/auth/mfa/verify` | POST | 6-Digit TOTP, Challenge Token | `sb-access-token` (AAL2) | AAL2 Upgrade | RFC 6238 TOTP window drift check (±1 step) | 200, 400, 401 |
| `/api/auth/mfa/enroll` | POST | Authenticated Session | None | Requires AAL1 | 160-bit Base32 Secret, DataURL QR Code | 200, 401, 500 |
| `/api/auth/mfa/confirm-enroll` | POST | Authenticated Session, Code | None | Confirms Enrollment | AES-256-GCM Secret Encryption at rest | 200, 400, 401 |
| `/api/auth/mfa/mfa-disable` | POST | Authenticated Session | None | Removes 2FA | Immediate Secret Purge | 200, 401 |
| `/api/auth/signup` | POST | Email, Password, Name, Mobile | `sb-access-token` | Immediate Login | AES-256-GCM PII Encryption, Scrypt Hashing | 201, 400, 500 |
| `/api/auth/logout` | POST | None | Cleared (Expires=1970) | Clears Session | HttpOnly Cookie Erasure, SameSite=Lax | 200 |
| `/api/auth/session` | GET | Session Cookie / Bearer Token | None | Returns AAL | Supabase / Local JWT verification | 200, 401 |
