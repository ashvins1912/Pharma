# Ashvin Pharmacy — AI Coding Rules

## Repository

GitHub repository:

`https://github.com/ashvins1912/Pharma`

Primary architecture branch:

`new-architecture`

---

## How to Work

Before changing code:

1. Inspect the repository.
2. Read `docs/AI_CONTEXT.md`.
3. Read only the relevant phase from `docs/AI_TASKS.md`.
4. Identify the exact files/modules involved.
5. Understand existing behavior and dependencies.
6. Make the smallest safe architectural change.
7. Run relevant tests/build/lint.
8. Report exactly what changed.

Do not guess repository structure.

The repository source code is the source of truth for existing implementation.

---

## Core Principle

> Change architecture, not business behavior.

Preserve existing:

* Authentication
* Authorization
* Admin
* Customer
* Pharmacy
* Medicine Requests
* Proposals
* Orders
* Inventory
* Prescription workflows
* Order statuses
* Inventory reservation
* Inventory release
* Inventory deduction
* Rider assignment
* Delivery
* Rider notifications
* WhatsApp notifications
* Alerts
* Dashboards
* Validation
* Existing UI behavior

Do not rewrite working business logic unnecessarily.

---

## No Migration

This project is currently in initial development.

There are no production customers/data requiring migration.

Therefore DO NOT create:

* Production data migration
* Legacy migration
* Dual writes
* Legacy/new database synchronization
* Production database cutover
* Historical data conversion
* Migration compatibility layers

Directly restructure the development codebase into the target architecture.

---

## Frontend Boundary

Frontend must not:

* Import backend source files
* Import backend controllers/services/repositories/models
* Access MongoDB
* Access service databases
* Access backend filesystem
* Contain backend business logic
* Contain service credentials

Use:

```text
Frontend
   ↓
Frontend API Client
   ↓
API Gateway
   ↓
Services
```

---

## API Gateway

The API Gateway is the public API boundary.

Use versioned APIs:

```text
/api/v1/*
```

The browser must not directly call internal services.

Gateway responsibilities include:

* Authentication
* Authorization
* Routing
* CORS
* Rate limiting
* Request ID
* Correlation ID
* API versioning
* Security headers
* Controlled errors

---

## Service Ownership

### Order Service

Owns:

* Orders
* Order Items
* Order Status
* Order Lifecycle
* Order Audit
* Order Events
* Pricing snapshots
* Prescription references
* Inventory reservation references
* Delivery references

### Inventory Service

Owns:

* Inventory
* Availability
* Reservations
* Releases
* Deductions
* Adjustments
* Bulk imports
* Import jobs
* Import failures
* Inventory audit

### Medicine Request Service

Owns:

* Medicine Requests
* Pharmacy Review
* Proposals
* Customer approval/rejection

Medicine Request is NOT an Order.

Proposal is NOT an Order.

Customer approval creates the Order.

### Delivery Service

Future ownership:

* Riders
* Rider assignment
* Delivery lifecycle
* Dispatch
* Delivery location

Preserve current delivery behavior during restructuring.

### Notification Service

Future ownership:

* WhatsApp
* Push
* SMS
* Email
* Webhooks

Preserve existing notification behavior.

---

## Database Rule

Services must own their own data.

Never solve service separation by allowing:

```text
Order Service → Inventory MongoDB
Medicine Request → Order DB
Frontend → MongoDB
```

Use authenticated APIs/events instead.

---

## Inventory Rule

Inventory is the authoritative source for stock.

Order Service must communicate with Inventory Service for:

```text
Availability
Reserve
Release
Deduct
```

Never duplicate inventory mutations inside Order Service.

---

## Order Rule

Order is the authoritative source for Order state.

Order items should preserve an immutable product snapshot so historical Orders do not depend on changing current product data.

---

## Idempotency

Use idempotency for operations where retries could create duplicates.

Especially:

* Order creation
* Medicine Request approval → Order
* Inventory reservation
* Inventory deduction
* External integrations
* Webhooks

---

## Bulk Inventory Import

Large Excel files must support:

* Chunking/streaming
* Configurable batch size
* Configurable concurrency
* Bulk database operations
* Partial success
* Retry
* Idempotency
* Duplicate handling
* Import job tracking
* Failed-record tracking
* Failed-record download

One failed row must not fail the entire import.

---

## CORS

CORS must be environment based.

Never use unrestricted wildcard CORS in production.

Use:

```text
CORS_ALLOWED_ORIGINS
```

Development, staging and production origins must be configurable.

CORS rejection must be a controlled API response, not an unhandled server error.

Preflight OPTIONS must work.

---

## Security

Never expose:

* Database credentials
* Service credentials
* JWT secrets
* API secrets
* Passwords
* Tokens

to the frontend.

Do not commit production secrets.

---

## Error Handling

Use consistent errors:

```text
400
401
403
404
409
422
429
500
502
503
504
```

Never expose production stack traces.

---

## Observability

Use:

```text
X-Request-ID
X-Correlation-ID
```

where appropriate.

Do not log:

* Passwords
* Tokens
* Cookies
* Secrets
* Sensitive request bodies

---

## Testing

After meaningful changes:

* Run tests
* Run type checking if applicable
* Run lint if applicable
* Run build
* Verify affected workflows

Never claim a test passed unless it was actually executed.

---

## Change Discipline

Do not:

* Rewrite unrelated code
* Rename things unnecessarily
* Introduce unnecessary infrastructure
* Introduce Kafka/RabbitMQ/etc. without need
* Delete working functionality
* Change business rules without explicit requirement

Prefer:

```text
Inspect
→ Understand
→ Plan
→ Implement
→ Test
→ Verify
```

---

## Final Reporting

After each task report:

1. What was inspected
2. What changed
3. Files created
4. Files modified
5. Files deleted/moved
6. Tests executed
7. Test results
8. Known limitations
9. Recommended next phase

Do not simply say "Done".
