# Ashvin Pharmacy — Complete API Inventory

**Platform:** Ashvin Multi-Tenant Pharmacy Commerce, Fulfillment & Logistics Engine  
**Document:** `docs/API_INVENTORY.md`  
**Generated At:** 2026-10-03  

---

## 1. Version 1 Multi-Tenant Platform Gateway APIs (`/api/v1/*`)

| Method | Path | Auth | Roles Allowed | Tenant Scope | Idempotency | Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **GET** | `/api/v1/health` | Public | Any | None | Safe | Gateway health check & service status |
| **GET** | `/api/v1/tenants` | Public | Any | Global | Safe | List all active pharmacy tenants |
| **GET** | `/api/v1/tenants/:tenantId` | Public | Any | Specific Tenant | Safe | Get tenant profile & settings |
| **POST** | `/api/v1/tenants` | Bearer Token | `PLATFORM_SUPER_ADMIN` | Global | Safe | Register new pharmacy tenant |
| **GET** | `/api/v1/tenants/branches/all` | Public | Any | Global | Safe | List all active dispensary branches |
| **GET** | `/api/v1/tenants/:tenantId/branches` | Public | Any | Tenant Scoped | Safe | List branches belonging to tenant |
| **POST** | `/api/v1/tenants/:tenantId/branches` | Bearer Token | `PLATFORM_SUPER_ADMIN`, `TENANT_OWNER`, `TENANT_ADMIN` | Tenant Scoped | Header Key | Create new physical branch under tenant |
| **PUT** | `/api/v1/tenants/branches/:branchId` | Bearer Token | `PLATFORM_SUPER_ADMIN`, `TENANT_OWNER`, `TENANT_ADMIN` | Branch Scoped | Safe | Update branch delivery radius, fees, timings |
| **GET** | `/api/v1/customers/me` | Bearer Token | Authenticated Customer | Caller Bound | Safe | Retrieve authenticated customer profile |
| **GET** | `/api/v1/customers/me/tenant-profiles` | Bearer Token | Authenticated Customer | Caller Bound | Safe | List tenant relationships, points & spend |
| **GET** | `/api/v1/customers/me/tenant-profile` | Bearer Token | Authenticated Customer | Tenant Scoped | Safe | Get customer points & history at tenant |
| **GET** | `/api/v1/customers/me/addresses` | Bearer Token | Authenticated Customer | Caller Bound | Safe | List customer saved delivery addresses |
| **POST** | `/api/v1/customers/me/addresses` | Bearer Token | Authenticated Customer | Caller Bound | Header Key | Add verified delivery pin with coordinates |
| **GET** | `/api/v1/catalog/products` | Public | Any | Global | Safe | Search universal master pharmaceutical catalog |
| **GET** | `/api/v1/catalog/listings` | Public | Any | Branch Scoped | Safe | Browse branch products with live prices & stock |
| **GET** | `/api/v1/inventory` | Bearer Token | Pharmacy Staff / Admin | Tenant & Branch | Safe | Fetch warehouse shelf stock counts |
| **POST** | `/api/v1/inventory/adjust` | Bearer Token | Pharmacy Staff / Admin | Tenant & Branch | Header Key | Manual stock count adjustment |
| **POST** | `/api/v1/inventory/bulk-import` | Bearer Token | Pharmacy Staff / Admin | Tenant & Branch | Job ID | High-capacity chunked import (>5K items) |
| **GET** | `/api/v1/inventory/bulk-import/:jobId` | Bearer Token | Pharmacy Staff / Admin | Tenant Scoped | Safe | Check progress & error breakdown of import job |
| **POST** | `/api/v1/pricing/calculate` | Optional Auth | Any | Tenant & Branch | Safe | Server-side authoritative price & discount calculation |
| **GET** | `/api/v1/pricing/coupons` | Public | Any | Tenant Scoped | Safe | List active coupons applicable to tenant |
| **GET** | `/api/v1/orders` | Bearer Token | Customer / Staff / Admin | Tenant / Customer | Safe | List orders (staff sees tenant; customer sees own) |
| **GET** | `/api/v1/orders/:id` | Bearer Token | Customer / Staff / Admin | Tenant / Customer | Safe | Get order details with immutable price breakdown |
| **POST** | `/api/v1/orders` | Bearer Token | Customer / Staff / Admin | Tenant & Branch | `Idempotency-Key` | Create order with atomic reservation |
| **PATCH** | `/api/v1/orders/:id/status` | Bearer Token | Staff / Admin / Customer | Tenant Scoped | Safe | Validated state machine status update |
| **POST** | `/api/v1/delivery/check-serviceability` | Public | Any | Branch Scoped | Safe | Validate customer GPS against branch radius |
| **GET** | `/api/v1/delivery/riders` | Bearer Token | Pharmacy Staff / Admin | Tenant & Branch | Safe | List active delivery fleet for branch |
| **POST** | `/api/v1/delivery/assign` | Bearer Token | Dispatcher / Staff / Admin | Tenant & Branch | Safe | Assign rider to order |
| **GET** | `/api/v1/medicine-requests` | Bearer Token | Customer / Staff / Admin | Tenant / Customer | Safe | List unlisted medicine requests |
| **GET** | `/api/v1/medicine-requests/:id` | Bearer Token | Customer / Staff / Admin | Tenant / Customer | Safe | Get request details & attached prescription |
| **POST** | `/api/v1/medicine-requests` | Bearer Token | Authenticated Customer | Tenant & Branch | Header Key | Submit unlisted medicine request |
| **POST** | `/api/v1/medicine-requests/:id/proposal` | Bearer Token | Pharmacist / Staff / Admin | Tenant Scoped | Safe | Formulate verified proposal with pricing |
| **POST** | `/api/v1/medicine-requests/:id/approve` | Bearer Token | Request Customer | Customer Bound | Domain Key | Customer approves proposal -> Converts to Order |
| **POST** | `/api/v1/medicine-requests/:id/reject` | Bearer Token | Request Customer | Customer Bound | Safe | Customer declines proposal |
| **GET** | `/api/v1/integrations` | Bearer Token | Pharmacy Staff / Admin | Tenant & Branch | Safe | Get POS / C-Square integration configuration |
| **PUT** | `/api/v1/integrations` | Bearer Token | Pharmacy Staff / Admin | Tenant & Branch | Safe | Update POS API URLs and credentials |
| **POST** | `/api/v1/integrations/test-connection` | Bearer Token | Pharmacy Staff / Admin | Tenant & Branch | Safe | Ping external POS endpoint |
| **POST** | `/api/v1/integrations/sync` | Bearer Token | Pharmacy Staff / Admin | Tenant & Branch | Job ID | Trigger manual inventory/pricing synchronization |
| **GET** | `/api/v1/notifications` | Bearer Token | Authenticated User | Caller Bound | Safe | Retrieve user in-app notifications |
| **PATCH** | `/api/v1/notifications/:id/read` | Bearer Token | Authenticated User | Caller Bound | Safe | Mark in-app notification as read |

---

## 2. Core Authentication & Profile APIs (`/api/auth/*` & `/api/user/*`)

| Method | Path | Auth | Roles Allowed | Tenant Scope | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **GET** | `/api/auth/csrf` | Public | Any | Global | Issues anti-CSRF token & sets HttpOnly cookie |
| **POST** | `/api/auth/login` | Public | Any | Global | Step 1 credential verification; issues token or MFA challenge |
| **POST** | `/api/auth/mfa/verify` | Challenge Token | Any | Global | Step 2 TOTP code verification; upgrades session to AAL2 |
| **POST** | `/api/auth/mfa/enroll` | Bearer Token | Authenticated User | Global | Generates RFC 6238 Base32 secret & QR code data URL |
| **POST** | `/api/auth/mfa/confirm-enroll` | Bearer Token | Authenticated User | Global | Validates 6-digit TOTP code and activates 2FA |
| **POST** | `/api/auth/mfa/mfa-disable` | Bearer Token | Authenticated User | Global | Deactivates 2FA on user account |
| **POST** | `/api/auth/signup` | Public | Any | Global | Registers customer profile with AES-256-GCM encrypted PII |
| **POST** | `/api/auth/logout` | Public | Any | Global | Clears session cookies & invalidates client auth |
| **GET** | `/api/auth/session` | Bearer Token | Authenticated User | Global | Returns verified session, roles, and MFA level |
| **POST** | `/api/auth/demo-admin` | Public | Any | Global | Development demo admin sign-in |
| **POST** | `/api/auth/demo-admin/instant` | Public | Any | Global | Development instant access admin login |
| **POST** | `/api/auth/demo-customer` | Public | Any | Global | Development demo customer sign-in |
| **GET** | `/api/user/profile` | Bearer Token | Authenticated User | Caller Bound | Get user profile details |
| **POST** | `/api/user/profile` | Bearer Token | Authenticated User | Caller Bound | Update name/mobile |
| **GET** | `/api/user/addresses` | Bearer Token | Authenticated User | Caller Bound | List delivery addresses |
| **POST** | `/api/user/addresses` | Bearer Token | Authenticated User | Caller Bound | Create delivery address with map pin |
| **PATCH** | `/api/user/addresses/:id` | Bearer Token | Authenticated User | Caller Bound | Update address details |
| **DELETE** | `/api/user/addresses/:id` | Bearer Token | Authenticated User | Caller Bound | Delete address |

---

## 3. Legacy Catalog, Orders & Payment Action Routes (`/api/*`)

| Method | Path | Auth | Roles Allowed | Description |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/api/medicines` | Public | Any | Public search & paginated catalog browsing |
| **GET** | `/api/medicines/:id` | Public | Any | Single medicine details with composition & manufacturer |
| **GET** | `/api/orders` | Bearer Token | Customer / Admin | Order history (paginated delivered tab, active kanban) |
| **GET** | `/api/orders/:id` | Bearer Token | Customer / Admin | Order details & live rider tracking |
| **POST** | `/api/orders` | Bearer Token | Customer / Admin | Direct order placement |
| **GET** | `/api/coupons/:code` | Public | Any | Validate coupon code against cart total |
| **GET** | `/api/coupons/validate/:code` | Public | Any | Validate coupon code with discount breakdown |
| **POST** | `/api/coupons` | Bearer Token | Administrator | Create promotional coupon code |
| **GET** | `/api/public/payments/action` | Signed Token | Recipient | One-click signed payment reminder action |
| **POST** | `/api/public/payments/action` | Signed Token | Recipient | Execute payment status confirmation |
| **GET** | `/api/admin/payments/reminders` | Bearer Token | Administrator | View pending digital payment reminders |
| **POST** | `/api/admin/payments/reminders/send` | Bearer Token | Administrator | Trigger automated WhatsApp payment reminder |
| **GET** | `/api/admin/audit-logs` | Bearer Token | Administrator | View immutable security & operational audit trail |
