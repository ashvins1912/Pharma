# AI_CONTEXT.md — Ashvin Pharma Working Contract

**Purpose:** Compact context for future AI coding/modification tasks. Read this file first. Do not re-infer architecture from scratch.

## 1. Repository reality

Repo: `ashvins1912/Pharma`
Default branch: `main`

Current repository is a **hybrid/migration state**, not a fully consolidated microservice platform.

Important live paths:
- `frontend/` — React/Vite frontend
- `api-gateway/` — gateway
- `backend/` — legacy/active Express business platform plus extracted services
- `services/` — newer standalone services, including Python Prescription Service
- root `server.ts` — compatibility/full-stack runner still present
- `render.yaml` — current root Render blueprint

Do not assume existing architecture docs equal completed migration.

## 2. Core architecture rule

Target:

`Frontend → API Gateway → Domain Services → owned persistence`

No frontend-to-service direct business calls when gateway routing exists.
No service may directly mutate another service's database.

## 3. Domain ownership

- **Identity:** authentication, accounts, credentials, OAuth, activation, sessions, refresh tokens, MFA, auth audit.
- **Customer/Person:** Customer, Person, PUID, family relationships/invitations.
- **Tenant:** tenants, branches, memberships, branch policies.
- **Catalog/Pricing:** global product identity, branch listing, authoritative server pricing.
- **Inventory:** sole authority for stock, reservation, release, deduction, imports.
- **Order:** order record, lifecycle FSM, price/address snapshots, fulfillment decision.
- **Prescription:** prescription document, OCR/NLP/matching, review workflow, approval/rejection/removal.
- **Delivery:** riders, jobs, assignment, routes, delivery lifecycle.
- **Notification:** email/SMS/WhatsApp/in-app notification delivery.
- **Pharmacy Integration:** external POS/ERP provider adapters.
- **Vendor/Pricing/other services:** keep ownership explicit and avoid duplicate implementations.

## 4. Identity ≠ PUID

`userId` = authenticated account.

`PUID` = real person/patient identity.

One user can manage multiple PUIDs.

PUID:
- server-generated
- immutable
- never reused
- not derived from name/email/mobile/DOB
- not an authorization credential

Prescription/order must reference the patient PUID when patient identity is required.

## 5. Multi-tenant security

Every protected operation must derive trusted identity from authenticated context.

Important context:
- userId
- customerId
- tenantId
- branchId
- roles
- permissions
- platform-user status

Never trust request body/query values such as tenantId, branchId, userId, role, permissions for authorization.

Tenant and branch isolation are mandatory.

## 6. Prescription target flow

Prescription processing is asynchronous and must NOT synchronously block Order Service.

Target flow:

`UPLOAD → QUEUED → PROCESSING → OCR → NLP → MEDICINE MATCHING → confidence decision`

High confidence:
`AUTO_APPROVED → APPROVED`

Low confidence:
`REVIEW_REQUIRED → persistent admin review item`

Admin:
- Open
- Verify/Approve
- Reject (reason required)
- Wait (no state transition)

Prescription Service owns prescription state.
Order Service owns order state.
They coordinate through persisted state/integration records, not synchronous waiting.

## 7. DB-first integration model

Current design should work without Kafka/RabbitMQ/SQS.

Business state is authoritative in the domain DB.

Use a durable integration/outbox abstraction for propagation:

`Domain transaction → state change + outbox record → adapter`

Current adapter:
- `DATABASE`

Future adapters:
- Kafka
- RabbitMQ
- AWS SQS
- Webhook
- other providers

Business code must depend on an `IntegrationAdapter`/port, not a provider SDK.

Super Admin may configure/enable adapter providers and scope them globally/tenant/branch, but Super Admin must NOT override domain state-machine rules.

## 8. Important prescription persistence requirements

Production-critical state MUST NOT live only in in-memory Maps.

Needed durable records include:
- prescriptions
- processing jobs
- idempotency keys
- review queue/items
- audit records
- integration/outbox records

Processing jobs require:
- status
- attempts
- lease/lock
- next attempt time
- retry/backoff
- dead-letter/failure state

Use optimistic locking/versioning for manual review and concurrent updates.

## 9. Fulfillment gate model

Do NOT make order lifecycle depend on a synchronous “pending prescription review” blocking state.

Keep order lifecycle and fulfillment readiness separate.

Example:

`payment = PASSED`
`inventory = RESERVED`
`prescription = PENDING_REVIEW`
`customer = READY`
`delivery = NOT_STARTED`

Only fulfill when all required gates pass.

OTC orders:
`prescription = NOT_REQUIRED`

If inventory reservation expires during prescription review:
- release reservation
- on approval, re-reserve idempotently

Cancellation or prescription removal must win races against late approval.

## 10. Prescription security

- private document storage
- short-lived signed URLs
- authenticated admin/pharmacist access
- tenant/branch authorization
- permission such as `prescription.review`
- authenticated encryption such as AES-256-GCM where implemented
- no medical data in JWT
- no medical content in generic audit/event payloads unless required
- never log secrets, tokens, prescription images, or unnecessary medical details

Mandatory production secrets must not have insecure fallbacks.

## 11. Existing repo warnings

The current repo contains legacy/duplicate implementations and mixed deployment modes.

Known examples:
- old Node Prescription implementation under `backend/services/prescription-service/`
- newer Python Prescription Service under `services/prescription-service/`
- root compatibility runner `server.ts`
- legacy `/api/*` routes still coexist with `/api/v1/*`

When modifying a feature:
1. locate all implementations
2. identify the authoritative path
3. avoid dual business logic
4. migrate/redirect callers
5. remove obsolete duplicate code only after references are removed

## 12. Current repo documentation that may contain useful details

Read when needed:
- `docs/AI_SYSTEM_MAP.md`
- `docs/AI_IMPLEMENTATION_STATUS.md`
- `docs/MULTI_TENANT_ARCHITECTURE.md`
- `docs/AUTHORIZATION_MODEL.md`
- `docs/API_CONTRACTS.md`
- `docs/EVENT_CATALOG.md`
- `docs/DATA_MODEL.md`
- `docs/architecture/current-state.md`
- `docs/architecture/frontend-backend.md`
- `docs/DEPLOYMENT.md`
- `docs/BUG_AUDIT.md`
- `docs/PRODUCTION_READINESS_REPORT.md`

Treat status/readiness claims critically; verify code before declaring something production-ready.

## 13. Deployment model

Local development must support starting the complete required platform with one documented workflow.

Render deployment must:
- use Render-assigned `PORT`
- bind services to `0.0.0.0`
- expose health/readiness endpoints
- separate services when the target architecture requires separation
- use private service URLs for internal calls where supported
- use environment variables for secrets
- never commit real secrets

Current root Render config still represents the compatibility deployment, so verify the actual service topology before changing deployment.

## 14. Future enhancement rules

When adding any feature:
- prefer configuration over hardcoding
- prefer adapter/strategy interfaces for replaceable providers
- keep domain state authoritative
- keep integration provider replaceable
- add tenant/branch scope
- add idempotency for money/order/stock/medical workflow actions
- add optimistic locking where concurrent updates are possible
- add audit where business/security decisions matter
- add tests for duplicate requests and race conditions
- update this file only when architecture rules materially change

## 15. Compact AI task template

Use this instead of a long architecture prompt:

```
Read docs/AI_CONTEXT.md first.

Task: <feature/change>

Rules:
- preserve service ownership and tenant/branch isolation
- no direct cross-service DB mutation
- no critical in-memory persistence
- DB state is authoritative
- use IntegrationAdapter abstraction for replaceable integrations
- prescription/order remain asynchronous and independently owned
- preserve idempotency, optimistic locking, audit and security
- do not duplicate existing implementations

Before coding:
1. inspect current implementation and all callers
2. identify authoritative path
3. list impacted files/services

Implement:
- production-safe code
- migrations/indexes/config if required
- tests
- local startup impact
- Render/deployment impact

After coding:
- run targeted tests
- build/typecheck/lint as applicable
- report changed files, tests, risks, and remaining limitations
```

## 16. Source-of-truth principle

**This file is a compact working contract, not a substitute for code verification.**

When code conflicts with documentation:
- code is current reality
- this file defines target engineering rules
- inspect both and reconcile deliberately
