# AI_CONTEXT.md — Ashvin Pharma Working Contract

**Purpose:** Compact source-of-truth for future AI coding/modification tasks.
**Last verified against `main`:** 2026-10-07
**Latest verified HEAD:** `7a21b631ebe4faf05b98b5ca233f015330738644`

## 1. Current repository reality

Repository: `ashvins1912/Pharma`

The repo is still a **hybrid migration platform**, but the latest `main` has moved further toward durable service architecture.

Important paths:
- `frontend/` — React/Vite application
- `api-gateway/` — centralized gateway
- `backend/` — legacy/active Express platform plus extracted services
- `backend/shared/integration/` — integration adapter/outbox abstraction
- `backend/services/` — extracted Node services, including Customer/Person and legacy Prescription
- `services/prescription-service/` — Python FastAPI Prescription Service + durable worker
- `render.yaml` — root Render compatibility deployment
- root `server.ts` — compatibility runner

**Do not assume every architecture document describes completed migration. Verify code before changing ownership or deployment.**

## 2. Core target architecture

`Frontend → API Gateway → Domain Service → owned persistence`

Rules:
- Gateway is the public API boundary.
- Services own their domain data.
- No direct cross-service DB mutation.
- Prefer internal authenticated service-to-service calls.
- Legacy routes may remain during migration, but do not create a second business implementation.

## 3. Domain ownership

- **Identity:** authentication, accounts, credentials, OAuth, activation, sessions, refresh tokens, MFA, auth audit.
- **Customer/Person:** Customer, Person, PUID, family relationships/invitations.
- **Tenant:** tenants, branches, memberships, branch policies.
- **Catalog/Pricing:** global product identity, branch listing, authoritative pricing.
- **Inventory:** sole stock authority; reservation/release/deduction/imports.
- **Order:** order lifecycle/state machine, price/address snapshots, fulfillment decision/gates.
- **Prescription:** document, OCR/NLP/matching, processing jobs, review, approval/rejection/removal.
- **Delivery:** riders, delivery jobs, assignment, routes, lifecycle.
- **Notification:** notification delivery/fanout.
- **Pharmacy Integration:** external POS/ERP adapters.
- Keep any other service ownership explicit; never duplicate domain ownership.

## 4. Identity ≠ PUID

`userId` = authenticated account.

`PUID` = real person/patient identity.

One user can manage multiple PUIDs.

PUID is:
- server generated
- immutable
- never reused
- opaque
- not derived from name/email/mobile/DOB
- not an authorization credential

Healthcare authorization must be checked separately from possession of a PUID.

## 5. Multi-tenant security contract

Trusted authorization context must come from authenticated identity and verified membership.

Typical context:
`userId, customerId, tenantId, branchId, roles, permissions, isPlatformUser`

Never use request body/query values as the source of authorization for:
`tenantId, branchId, userId, customerId, role, permissions, PUID`

Every tenant-scoped read/write must enforce tenant/branch isolation.

## 6. Current Customer/Person direction

A Customer/Person Service now exists under:
`backend/services/customer-service/`

Current capabilities include:
- durable Customer profile
- Person/PUID creation
- family relationship records
- family invitation record
- managed-person listing
- PUID access check
- masked PUID responses
- `/health` and `/ready`

Current implementation is still an incremental extraction path. Review gateway authentication/service-JWT enforcement before treating the standalone service as fully hardened.

## 7. Prescription — current target and latest implementation

Authoritative target implementation: Python FastAPI service at:
`services/prescription-service/`

The latest `main` now includes durable Mongo-backed Prescription state, processing jobs, review records, audit, idempotency, integration outbox support, document tokens, and a lease-based worker.

Critical lifecycle:

`UPLOADED → QUEUED → PROCESSING → confidence decision`

Then:
- high confidence → `AUTO_APPROVED → APPROVED`
- low confidence → `REVIEW_REQUIRED`
- rejected manually → `REJECTED`
- removed → `INACTIVE`
- infrastructure failure → `FAILED/RETRY/DEAD_LETTER`

Admin review actions:
- Open
- Verify/Approve
- Reject (reason required)
- Wait = no business state transition

Production rules:
- no fake OCR/extraction data
- no critical Prescription state in in-memory Maps
- no synchronous waiting by Order Service
- optimistic locking for review updates
- durable idempotency
- private document access via short-lived token/URL
- audit without unnecessary medical content

### Important remaining Prescription warning

A legacy Node Prescription implementation still exists under:
`backend/services/prescription-service/PrescriptionService.js`

Do not reintroduce or extend it as a second authoritative implementation.
Before changing Prescription, trace all callers and move/redirect them deliberately to the Python service.

## 8. Durable processing model

Prescription processing uses a DB-backed job model with lease semantics.

Conceptual records:
- `prescriptions`
- `processing_jobs`
- `prescription_reviews`
- `prescription_audit`
- `idempotency_keys`
- `integration_outbox`
- document access tokens

Worker requirements:
- atomic claim
- lease/lock
- retry/backoff
- heartbeat where processing duration requires it
- restart safety
- dead-letter handling
- indexed polling

## 9. DB-first integration / Adapter model

The integration abstraction is now present.

Node shared integration:
`backend/shared/integration/`

Current provider:
- `DATABASE`

Future provider extension points:
- Kafka
- RabbitMQ
- AWS SQS
- Webhook

Current DB Adapter writes durable `integration_outbox` records and supports lease-based batch claiming/retry state.

Provider configuration supports:
- GLOBAL / TENANT / BRANCH scope
- enabled flag
- priority
- event-type filtering
- config/secret references

Business services must call the adapter/registry abstraction, not provider SDKs directly.

**Domain state remains authoritative. The outbox/integration record is not the business truth.**

Super Admin may configure integration providers but must not override domain state-machine rules.

## 10. Fulfillment architecture

Order lifecycle and fulfillment readiness are separate.

For prescription-required orders:

`payment = PASSED`
`inventory = RESERVED`
`prescription = PENDING_REVIEW`
`customer = READY`
`delivery = NOT_STARTED`

Only the fulfillment gate evaluator may decide readiness.

OTC:
`prescription = NOT_REQUIRED`

Never implement:
`Create Order → wait for Prescription → continue`

If inventory reservation expires while waiting:
- release it
- after approval, re-reserve idempotently

Cancellation and prescription removal must win races against late approval.

## 11. Inventory

Latest `main` includes reservation expiry support:
- `expiresAt`
- TTL-aware configuration
- reservation status/index support

Inventory remains the only stock authority.

Never write inventory quantities directly from Order/Prescription/Admin UI code.

## 12. Integration event envelope

Logical integration events may include:

`UserActivated, PuidCreated, PrescriptionUploaded, PrescriptionProcessingCompleted, PrescriptionReviewRequired, PrescriptionApproved, PrescriptionRejected, PrescriptionRemoved, OrderCreated, OrderConfirmed, OrderCancelled, InventoryReserved, InventoryReleased, InventoryDeducted, DeliveryAssigned, DeliveryCompleted`

Envelope fields:
`eventId, eventType, aggregateId, aggregateType, tenantId, branchId, timestamp, schemaVersion, correlationId, aggregateVersion, payload`

Do not place full prescription/medical documents in event payloads.

## 13. Security

Required:
- JWT issuer/audience/signature/expiry validation
- RBAC/permissions
- tenant/branch checks
- service-to-service authentication
- secure secrets
- idempotency
- optimistic locking where concurrent writes are possible
- input validation
- rate limiting/CSRF as applicable
- no sensitive logging

Never commit or use production fallback secrets.

Prescription encryption must use authenticated encryption and production-managed keys.
Private prescription files must not be permanently public.

## 14. Deployment — current reality

The repo still has a compatibility root Render deployment, and the current root `render.yaml` is still a single Node web-service definition.

Therefore:

**Do not claim “all services deploy independently on Render” until the Render topology is actually changed and validated.**

Target deployment:
- explicit web/background service definitions where required
- Render `PORT`
- bind `0.0.0.0`
- health/readiness checks
- private internal service URLs
- service-specific environment variables/secrets
- separate Prescription API and Prescription worker deployment if required by runtime

Local development target:
- one documented command to start required services
- deterministic ports
- health checks
- no hidden legacy process dependency

## 15. Current known migration gaps

Before declaring production-complete, verify:
1. all critical live flows are routed to authoritative extracted services
2. legacy Node Prescription callers are removed/re-routed
3. standalone Customer Service uses authenticated internal service credentials, not trust of arbitrary public headers
4. no critical in-memory fallback remains in migrated business paths
5. Order ↔ Prescription fulfillment-gate integration is fully wired
6. DB outbox consumer/dispatcher is complete for all required consumers
7. Render deploys every required service/worker
8. local full-stack orchestration works from a clean checkout
9. end-to-end tests cover prescription review + order fulfillment races

## 16. Safe modification rules

For every future feature/fix:
1. Read this file.
2. Inspect current code and all callers.
3. Identify authoritative implementation.
4. Search for duplicate/legacy implementations.
5. Make the smallest compatible production-safe change.
6. Preserve ownership, tenant isolation, RBAC, idempotency, locking and audit.
7. Use adapters for replaceable infrastructure/providers.
8. Do not add critical in-memory persistence.
9. Add/modify tests.
10. Validate local startup and Render impact.
11. Update architecture docs only when the architecture actually changes.

## 17. Source-of-truth hierarchy

When information conflicts:
1. **Current code/database behavior** = current reality
2. **This file** = target engineering rules + verified known state
3. Other architecture/status docs = supporting documentation

Always resolve conflicts deliberately; never silently assume migration is complete.

## 18. Minimal future AI prompt

```
Read docs/AI_CONTEXT.md first.

Task: <feature/fix>

Inspect current implementation + callers and identify the authoritative path.
Preserve service ownership, tenant/branch isolation, RBAC, DB authority,
idempotency, optimistic locking, audit and Adapter abstraction.
Do not create duplicate business logic or critical in-memory persistence.
Implement, test, build/typecheck as applicable, and verify local + Render impact.

Report: changed files, flow change, tests/results, deployment/config impact,
and remaining risks.
```


## 19. Latest Prescription → Medicine Request → Order flow

Current implemented flow:

`Customer → Medicine Request → optional manual medicines + prescription upload → Python Prescription Service → durable processing job → OCR/NLP/dose/course extraction → REVIEW_REQUIRED or APPROVED → persisted prescriptionVerification → pharmacist proposal → customer approval → Order conversion → order-level medicine verification → fulfillment gate reconciliation`

Rules:
- Prescription upload is sent to the Python service; fake legacy scan responses are no longer authoritative.
- Manual medicine entries are optional when a prescription is uploaded.
- Empty manual rows are ignored.
- Customer/admin UI shows extracted medicine name, strength, dose, frequency, duration/course and confidence/status.
- Prescription verification against an order checks every included order medicine independently.
- Verification uses exact productId when available, otherwise normalized medicine-name/strength matching plus quantity checks where prescription quantity is explicit/calculable.
- `MATCHED` is required before prescription fulfillment gate can become `APPROVED`.
- `PROCESSING`, `REVIEW_REQUIRED`, and `PARTIAL_MATCH` keep the order confirmed but not fulfillable.
- `MISMATCH` is a safety block; it does not grant dispensing authorization.
- Prescription approval/removal/cancellation races are resolved by current authoritative state.

## 20. Latest Order prescription reconciliation

The standalone Order Service now runs a DB-backed reconciliation loop:
- claims `PENDING_REVIEW` prescription-gated orders with a lease
- calls the Python Prescription Service
- re-verifies all included order medicines
- sets fulfillment prescription gate to `APPROVED` only on `MATCHED`
- preserves `PENDING_REVIEW` for processing/review/partial-match states
- marks `REJECTED` / `INACTIVE` when the authoritative prescription reaches those terminal states
- re-reserves inventory through the existing fulfillment-gate path if the previous reservation expired
- uses idempotent gate events and order versioning

This makes frontend polling optional; correctness does not depend on the browser.

## 21. Latest worker safety

Python Prescription Worker now uses:
- atomic lease ownership
- heartbeat extension while OCR/NLP runs
- worker-owned completion/failure updates
- lease-loss detection before applying extraction results

A worker that loses its lease must not overwrite a newer worker's result.

## 22. Current remaining production gaps

- The root Render blueprint is still a compatibility/single-service deployment; the standalone Order + Prescription API/worker topology must still be deployed and validated end-to-end on Render.
- The integration outbox is durable, but the current order gate is completed by DB reconciliation rather than an external broker.
- Python extraction intentionally does not claim Catalog-level medicine identity; it reports extracted text. Order-level matching is the current safety boundary.
- Medicine Request conversion still uses the legacy backend Order creation path; full migration to the standalone Order Service for all Medicine Request conversions remains a future architecture step.
- The request document is currently stored in both legacy GridFS compatibility storage and the Python encrypted document store; consolidate storage after migration.
- Prescription replacement/re-upload is now versioned: the old extraction/review is cancelled, the new document is queued, and the same prescriptionId remains blocked until the new extraction is approved/matched.


## 23. Latest security/deployment fixes

The API Gateway authentication chain now forwards the requested tenant/branch context to the backend identity check. The backend resolves and validates that context, and the Gateway includes the verified tenant/branch claims in service credentials.

Standalone Order Service now:
- consumes verified tenantId/branchId claims,
- rejects mismatched client tenant/branch values,
- includes tenant/branch in idempotency fingerprints,
- passes patientPuid into prescription verification.

Prescription Render configuration now has:
- web/API service
- separate background worker
- shared MongoDB/encryption/service-auth configuration



## 24. Recent main merge/review status

Commit `776e707` introduced and retained:
- COD cash collection states `CASH_RECEIVED`, `CASH_NOT_RECEIVED`, `NOT_APPLICABLE`
- rider WhatsApp action links/buttons
- Fulfillment Order ID/status search improvements

That commit also removed/reverted several Prescription integration pieces. Those pieces have now been restored selectively without reverting the delivery/cash/search changes.

Current main validation:
- active frontend AdminProposalModal JSX is structurally balanced
- fabricated prescription scan responses are removed from active backend scan routes
- Prescription Service/client/verification/reconciliation files are restored
- prescription-only Medicine Requests are supported
- customer PUID access is checked before prescription association
- order conversion requires medicine-level prescription MATCHED status
- fulfillment transitions remain blocked until prescription MATCHED
- Prescription API + worker Render configuration is restored
- Order reconciliation configuration is restored

The repository still requires a real Render deployment/build smoke test; GitHub Actions did not expose a workflow run for the validation commit, and local clone/build was unavailable in the execution environment.

## Canonical independent-service layout (2026-10-07)

The repository restructuring uses one canonical deployment surface:
- `frontend/` — only frontend
- `api-gateway/` — only public Gateway
- `backend/` — private platform/orchestration API
- `services/inventory-service/` — canonical Inventory Service
- `services/order-service/` — canonical Order Service
- `services/prescription-service/` — canonical Python Prescription API + worker

Removed from the restructuring branch:
- root React/Vite application and root Vite config
- root combined Express/Vite runner
- root Vercel API adapter
- root combined Render blueprint
- duplicate Inventory service trees under `backend/`
- legacy Node Prescription implementation
- legacy backend internal Inventory/Order/Prescription gateway routes

The public Gateway directly routes authoritative versioned Inventory and Order
APIs to their private services. Backend remains the private platform boundary
for compound/PUID-sensitive workflows until their authorization and persistence
ownership can move without weakening security.

Order Service no longer imports backend Prescription implementation. It calls
the standalone Prescription Service over HTTP. No service may import another
standalone service's implementation or write another service's database.
