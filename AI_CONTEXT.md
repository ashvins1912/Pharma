# Pharma — AI Agent Context

> Canonical source of truth for AI coding agents. Read this file before changing code.
> Repository: ashvins1912/Pharma | Branch: main | Verified: 2026-10-07

## 1. Agent rules
1. Read this file first.
2. Inspect actual code and callers for the requested feature.
3. Identify the authoritative owner before changing anything.
4. Search for duplicate/legacy implementations before creating new logic.
5. Preserve business behavior unless explicitly changed by the task.
6. Make the smallest safe change.
7. Preserve auth, authorization, tenant isolation, idempotency, locking, auditability and service ownership.
8. Run relevant tests/build/typecheck/lint where available.
9. Never claim a test or deployment passed unless it was actually executed.
10. Report changed files, behavior change, tests, deployment/config impact and remaining risks.

This is Phase-0/greenfield development. There is no production-data migration requirement. Do not invent migration infrastructure, dual writes or legacy cutovers.

## 2. Current architecture
~~~text
Browser
  -> Frontend (React/Vite)
  -> API Gateway (public boundary)
       -> private Backend platform API
       -> private Inventory Service
       -> private Order Service
       -> private Prescription API
                              <-> Prescription Worker
~~~

Canonical paths:

| Path | Owner |
|---|---|
| frontend/ | React/Vite UI and API client |
| api-gateway/ | Public routing, auth, CORS, service credentials |
| backend/ | Identity/auth, tenant/platform workflows and compound orchestration |
| services/inventory-service/ | Stock and inventory lifecycle |
| services/order-service/ | Orders and fulfillment lifecycle |
| services/prescription-service/ | Prescription API, processing, review, verification |

Rules:
- Browser never accesses internal services directly.
- Browser never accesses MongoDB.
- A service never writes another service's database.
- Domain state belongs to its owning service.
- Do not delete backend code merely because a standalone service exists; trace callers first.

## 3. Authentication
Pharma application sessions use a first-party RS256 JWT.

Implementation:
- backend/security/pharmaToken.js — issue/verify
- backend/middleware/auth.js — application authentication
- HttpOnly access_token cookie — browser credential
- Default TTL: 10 minutes
- Issuer: pharma-auth
- Audience: pharma-api
- Algorithm: RS256

Production requires:
~~~text
PHARMA_JWT_PRIVATE_KEY
PHARMA_JWT_PUBLIC_KEY
PHARMA_JWT_ISSUER=pharma-auth
PHARMA_JWT_AUDIENCE=pharma-api
PHARMA_ACCESS_TOKEN_TTL=10m
~~~

Never expose the private key to frontend or GitHub.

### Google authentication
Supabase is only an upstream Google identity broker:
~~~text
Google OAuth
 -> Supabase verifies identity
 -> /api/v1/auth/google
 -> Pharma verifies the Supabase exchange JWT
 -> Pharma creates/loads user
 -> Pharma issues RS256 token
 -> HttpOnly Pharma cookie
~~~
A Supabase JWT is not accepted as the normal application API session. Frontend clears the temporary local Supabase session after successful exchange.

### Email/password
Email/password login is first-party Pharma auth and establishes the same Pharma HttpOnly session.

### MFA
MFA challenge tokens are separate from normal API access tokens. Never accept a challenge token as an API session.

## 4. Google onboarding
Google users may require profile completion.

Current fields:
- first name: required
- last name: supported, optional
- gender: required
- DOB: required
- Indian mobile: required

Gender:
~~~text
MALE
FEMALE
OTHER
PREFER_NOT_TO_SAY
~~~

DOB is the source of truth; age is calculated dynamically.

Accepted Indian mobile forms:
~~~text
9876543210
09876543210
919876543210
+919876543210
~~~
Canonical form: +91XXXXXXXXXX.

## 5. Authorization and tenancy
Authentication = who the user is.
Authorization = what the user can do.

Authorization context commonly contains:
~~~text
userId/sub
role + roles
permissions
permissionVersion
tenantId
branchId
scope
sessionId
~~~

Never use request body/query values as the trusted source for tenantId, branchId, userId, customerId, role, permissions or PUID.

Resolve tenant/branch access from authenticated identity + verified membership.

HTTP contract:
- 401 = missing/invalid/expired identity
- 403 = authenticated but not authorized
- 404 may be used for cross-tenant resource existence protection

Current roles include:
~~~text
SUPER_ADMIN
PLATFORM_SUPER_ADMIN
TENANT_OWNER
TENANT_ADMIN
PHARMACIST
PHARMACY_STAFF
INVENTORY_MANAGER
ORDER_MANAGER
CUSTOMER / customer
~~~

Current permissions include:
~~~text
inventory.read
inventory.write
inventory.import
orders.read
orders.create
orders.manage
prescription.read
prescription.write
prescription.review
~~~

Important gap: backend/authorization/AuthorizationService.js still has a hard-coded role-to-permission baseline and api-gateway/src/serviceRoutes.js has aliases. Do not keep expanding that map for every new feature. Long-term design is Feature -> Permission -> Role -> RolePermission plus TenantMembership and optional overrides.

## 6. Domain ownership

### Identity
Authentication, accounts, credentials, OAuth identities, activation, sessions, MFA and auth audit.

### Tenant
Tenants, branches, memberships and tenant/branch policies.

### Inventory
Only authority for availability, reserve, release, deduct, adjustment and imports.
Never mutate inventory quantities from Order or UI code.

### Order
Owns order lifecycle/state, order items, immutable product/pricing snapshots, order audit/events, fulfillment gates, prescription references and inventory reservation references.

### Prescription
Owns prescription document, OCR/NLP extraction, processing jobs, reviews, approval/rejection/removal and prescription verification.

### Customer/Person
userId = authenticated account.
PUID = person/patient identity.
PUID is opaque, server-generated, immutable, never reused, not derived from name/email/mobile/DOB, and is not an authorization credential.

## 7. Service-to-service security
Gateway creates short-lived service JWTs.
Important files:
- api-gateway/src/serviceAuth.js
- api-gateway/src/serviceRoutes.js
- service-specific auth/config modules

Internal services validate service credentials and must not trust arbitrary client-supplied internal headers.
Service credentials never reach the browser.

## 8. Prescription behavior
Authoritative implementation: services/prescription-service/ (Python FastAPI + worker).

Lifecycle:
~~~text
UPLOADED -> QUEUED -> PROCESSING
  high confidence -> AUTO_APPROVED -> APPROVED
  low confidence  -> REVIEW_REQUIRED
  manual reject    -> REJECTED
  removed          -> INACTIVE
  failure          -> FAILED/RETRY/DEAD_LETTER
~~~

Durable state includes prescriptions, processing jobs, reviews, audit, idempotency keys, integration outbox and document access tokens.

Worker requirements:
- atomic lease claim
- heartbeat for long OCR/NLP work
- retry/backoff
- lease-loss protection
- restart safety
- dead-letter handling

Do not reintroduce backend/services/prescription-service/PrescriptionService.js as a second authoritative implementation.

## 9. Medicine Request -> Prescription -> Order
Current flow:
~~~text
Customer
 -> Medicine Request
 -> optional manual medicines + prescription upload
 -> Python Prescription Service
 -> durable processing
 -> extraction
 -> REVIEW_REQUIRED or APPROVED
 -> pharmacist proposal
 -> customer approval
 -> Order conversion
 -> medicine-level verification
 -> fulfillment gate
~~~

Rules:
- Empty manual rows are ignored.
- Extraction provides medicine text, strength, dose, frequency, duration/course and confidence.
- Exact productId is preferred when available; otherwise normalized medicine name/strength matching is used.
- Quantity checks apply when prescription quantity is explicit/calculable.
- MATCHED is required before prescription fulfillment can become APPROVED.
- PROCESSING, REVIEW_REQUIRED and PARTIAL_MATCH keep an order confirmed but not fulfillable.
- MISMATCH is a safety block.
- Cancellation/removal/replacement races must beat late approval.
- Replacement/re-upload is versioned and keeps the same prescriptionId blocked until the new version is approved/matched.
- Order Service has DB-backed prescription reconciliation; correctness must not depend on browser polling.

## 10. Inventory imports
Inventory Service supports batching/chunking, configurable concurrency, bulk DB operations, partial success, retries, idempotency, import job tracking and failed-record tracking/download.

Current deployment defaults:
~~~text
batch size = 250
worker concurrency = 1
max retries = 3
max file size = 100 MiB
~~~

One bad row must not fail unrelated rows.

## 11. Integration/outbox
Shared abstraction: backend/shared/integration/
Current provider: DB-backed integration outbox.

Business services should use the adapter/registry abstraction rather than provider SDKs directly.
Domain state remains authoritative. Outbox state is not business truth.
Do not put full prescription documents or unnecessary sensitive data into events.

## 12. Frontend
Frontend is React/Vite.

Important:
- frontend/src/api/apiClient.js
- frontend/src/context/AuthContext.jsx

API behavior:
- withCredentials = true
- Pharma auth is the HttpOnly cookie
- browser JS does not manage Pharma bearer tokens
- CSRF header is sent when available
- Production browser API calls must stay on the frontend origin (`/api/*`) and use the Render rewrite to the API Gateway so HttpOnly refresh cookies remain first-party.
- VITE_API_URL is used for local/development routing; production apiClient intentionally uses same-origin relative URLs.

Scripts:
~~~text
npm run dev
npm run lint
npm run build
~~~

Frontend must not import backend code, access DBs or contain service credentials.

## 13. Gateway
api-gateway/ is the public API boundary.

Responsibilities:
- authentication
- authorization
- routing
- CORS
- request IDs
- controlled errors
- service JWT creation
- health/configuration

Public APIs primarily use /api/v1/*.
Internal service URLs must not be exposed to browsers.

## 14. Reliability/security rules
Use appropriate HTTP errors: 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504.

Use idempotency for retry-sensitive writes:
- order creation
- request approval -> order
- inventory reserve/deduct
- external integrations
- webhooks

Use optimistic locking/versioning for concurrent state transitions.
Propagate X-Request-ID and X-Correlation-ID where supported.
Never log passwords, tokens, cookies, secrets or unnecessary sensitive payloads.

## 15. Current known gaps
1. Authorization baseline is partly hard-coded; move future work toward DB-backed features/permissions.
2. Backend still contains orchestration and extraction-era code; trace ownership before deletion.
3. Render manifests exist for Gateway, Inventory, Order and Prescription API/worker, but live production routing must be verified.
4. Some prescription document paths retain compatibility storage; consolidate deliberately.
5. Medicine Request conversion still has legacy backend involvement in some flows.
6. DB outbox is durable, but not every event necessarily has an external broker consumer.
7. Do not call the architecture fully production-independent until live builds, routing, health checks and end-to-end flows are verified.

## 16. Adding future features
For billing, referrals, platform fees, subscriptions, branch features, etc.:
~~~text
Requirement
 -> domain owner
 -> Feature + Permission
 -> tenant/branch scope
 -> API contract
 -> owning service
 -> Gateway authorization/routing
 -> DB transaction + idempotency
 -> audit/event if required
 -> UI
 -> tests
 -> deployment config
~~~

Preferred authorization model:
~~~text
User
  -> UserIdentity

Tenant
  -> TenantMembership
       -> roleId
       -> branchId

Role
  -> RolePermission

Permission
  -> Feature + Action

Feature
  -> enabled/status
~~~

Do not create a permanently growing permission blob on each user.

## 17. Minimal prompt
~~~text
Read AI_CONTEXT.md first.

Task: <feature/fix>

Inspect current implementation and callers. Identify the authoritative domain/service.
Preserve auth, authorization, tenant/branch isolation, service ownership, DB authority,
idempotency, locking and auditability. Do not create duplicate business logic or
critical in-memory persistence.

Implement the smallest safe change. Test the affected path and build/typecheck where
available. Verify deployment/config impact.

Report changed files, behavior/flow change, tests actually run, deployment/config
impact and remaining risks.
~~~
