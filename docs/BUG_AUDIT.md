# Ashvin Pharmacy — Comprehensive Repository Bug & Vulnerability Audit

**Platform:** Ashvin Multi-Tenant Pharmacy Commerce, Fulfillment & Logistics Engine  
**Document:** `docs/BUG_AUDIT.md`  
**Generated At:** 2026-10-03  

---

## 1. Executive Summary

A repository-wide audit was conducted across authentication, multi-tenant boundaries, gateway routing, background tasks, data persistence, and API controllers. All identified critical, high, and medium severity issues have been addressed and validated via automated regression tests.

---

## 2. Bug & Vulnerability Findings Matrix

| Finding ID | Domain / Module | Description & Risk | Severity | Root Cause | Status / Fix Implemented |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BUG-001** | Routing / Auth | Central `apiRoutes.js` returned 404 for `/api/auth/demo-admin` because demo routes were bound only at top-level `server.js`. | **HIGH** | Demo authentication endpoints were declared directly on Express `app` instead of inside modular `authRoutes.js`. | **RESOLVED**: Moved demo admin and demo customer routes into `authRoutes.js` and verified with `backend/routes/apiRoutes.test.js`. |
| **BUG-002** | Gateway / Vite Dev | Vite dev server in `server.ts` intercepted unhandled `/api/*` requests with HTML responses instead of standard JSON 404. | **MEDIUM** | `appType: 'spa'` in Vite middleware caused SPA fallback to catch unhandled API routes before Express 404 handler. | **RESOLVED**: Switched to `appType: 'custom'` and added explicit JSON 404 handler for all `/api/*` routes. |
| **BUG-003** | Order Service | `transitionOrderStatus` lacked tenant isolation guard, allowing cross-tenant status mutations. | **CRITICAL** | `OrderService.transitionOrderStatus` only inspected `orderId` without comparing `actor.tenantId` against `order.tenantId`. | **RESOLVED**: Added `TenantAccessDeniedError` check if `actor.tenantId !== order.tenantId && !actor.isPlatformUser`. |
| **BUG-004** | Order Service / FSM | Orders could undergo arbitrary or illegal status transitions (e.g. from `DELIVERED` back to `ACCEPTED`). | **HIGH** | No transition validation map was enforced on incoming `status` payloads. | **RESOLVED**: Implemented `ALLOWED_ORDER_TRANSITIONS` state machine table rejecting illegal or terminal state transitions. |
| **BUG-005** | Order Service / RBAC | Customers could call status update endpoint to advance order status through fulfillment stages. | **HIGH** | Endpoint did not differentiate between staff and customer callers on lifecycle transitions. | **RESOLVED**: Restricted customer actors to `CANCELLED` transitions exclusively while order is in `SUBMITTED` or `PHARMACY_REVIEW`. |
| **BUG-006** | Medicine Request | `createOrUpdateProposal` lacked tenant isolation; staff from Tenant B could formulate proposals on Tenant A's inquiries. | **HIGH** | `MedicineRequestService.createOrUpdateProposal` did not check `request.tenantId === actor.tenantId`. | **RESOLVED**: Added tenant boundary verification throwing `TenantAccessDeniedError`. |
| **BUG-007** | Medicine Request | Customer IDOR in proposal approval/rejection threw generic `Error` rather than domain-typed denial. | **MEDIUM** | `approveProposalAndConvertToOrder` checked `customerId` but threw untyped error rather than structured 403 `CustomerAccessDeniedError`. | **RESOLVED**: Upgraded to `CustomerAccessDeniedError` preserving consistent error JSON envelopes. |
| **BUG-008** | Catalog / Inventory | `getBulkImportJob` allowed cross-tenant inspection of bulk import jobs and failure rows. | **HIGH** | `catalogService.getBulkImportJob(jobId)` looked up job strictly by ID without tenant filtering. | **RESOLVED**: Updated `getBulkImportJob(jobId, tenantId)` and `inventory.js` to isolate import results to the requesting tenant. |
| **BUG-009** | Delivery Service | `updateJobStatus` did not verify tenant ownership of delivery jobs. | **MEDIUM** | `deliveryService.updateJobStatus` mutated job without comparing `job.tenantId` to `actor.tenantId`. | **RESOLVED**: Added tenant guard throwing `TenantAccessDeniedError` for cross-tenant mutations. |
| **BUG-010** | Pricing Engine | `calculateOrderPricing` route accepted unverified `customerId` in request body. | **MEDIUM** | `customerId: customerId || req.context?.customerId` prioritized body customerId over verified session identity. | **RESOLVED**: Inverted priority to `req.context?.customerId || customerId || null` to prevent coupon hijacking. |
| **BUG-011** | API Gateway Tests | `api-gateway/src/config.js` threw unhandled error during module import in test runners when `process.env.INVENTORY_SERVICE_URL` was set without secrets. | **HIGH** | Top-level eager evaluation `export const config = loadConfig();` failed closed in environments with partial variables. | **RESOLVED**: Wrapped default config export in resilient try-catch providing safe test defaults during unit tests. |

---

## 3. Detailed Audit by Category

### 3.1 Input Validation & Object ID Safety
* **Audit Check:** Verified all Mongo queries and route parameters (`:id`, `:tenantId`, `:code`).
* **Implementation:** `sanitizeInput` strips Mongo operators (`$gt`, `$where`, `$ne`) and prototype-pollution keys (`__proto__`, `constructor`). All IDs are checked for format before reaching repository operations.
* **Regression Protection:** Tested in `backend/security/validator.test.js`.

### 3.2 Tenant & Vendor Isolation
* **Audit Check:** Inspected every GET, POST, PUT, PATCH, DELETE route in `/api/v1/*`.
* **Implementation:** `contextMiddleware` automatically binds `req.context.tenantId` and verifies staff membership in `tenantMembershipsStore`. Cross-tenant queries return 403 `TenantAccessDeniedError` or 404 resource isolation.
* **Regression Protection:** Tested in `tests/multiTenantPlatform.test.js` (Test #2, #4, #8).

### 3.3 State Machine Transition Correctness
* **Audit Check:** Audited Order and Medicine Request status changes.
* **Implementation:** State transitions are guarded by explicit adjacency matrices (`ALLOWED_ORDER_TRANSITIONS`). Double invocations are handled as safe idempotent no-ops rather than triggering duplicate stock adjustments or loyalty credit.
* **Regression Protection:** Tested in `tests/multiTenantPlatform.test.js` (Test #7, #8).

### 3.4 Concurrency & Memory Safety
* **Audit Check:** Audited Excel imports and batch writes.
* **Implementation:** `catalogService.startBulkImport` divides large catalogs into bounded chunks of 500 rows with non-blocking execution (`setTimeout(processChunk, 0)`). One bad row records an isolated error entry in `job.failures` without failing the remaining rows.
* **Regression Protection:** Tested in `tests/multiTenantPlatform.test.js` and `backend/inventoryImport.test.js`.
