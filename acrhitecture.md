# ASHVIN PHARMACY

# Repository-Aware Architecture Transformation — Master AI Engineering Prompt

## 0. SOURCE REPOSITORY

This task must be performed against the actual GitHub repository and branch:

```text
Repository:
https://github.com/ashvins1912/Pharma

Branch:
new-architecture
```

The repository is the **source of truth** for the existing implementation.

Do NOT assume that the current folder structure, framework, routes, services, models, database schemas, or workflows are exactly as described in this document.

First inspect the repository.

Use the actual source code to determine:

* Current frontend architecture
* Current backend architecture
* Current database architecture
* Existing API routes
* Existing controllers
* Existing services
* Existing repositories
* Existing models
* Existing authentication
* Existing authorization
* Existing middleware
* Existing CORS implementation
* Existing environment configuration
* Existing inventory implementation
* Existing Excel ingestion
* Existing Order implementation
* Existing Medicine Request implementation
* Existing Proposal implementation
* Existing Rider/Delivery implementation
* Existing notification implementation
* Existing WhatsApp integration
* Existing deployment configuration
* Existing Docker configuration
* Existing tests

Never fabricate file names or architecture details when they can be discovered from the repository.

---

# 1. PRIMARY OBJECTIVE

Transform the existing Ashvin Pharmacy codebase into a clean, scalable, production-ready service-oriented architecture.

The target architecture must support:

```text
Web
Mobile
Admin
POS
ERP
Partner Applications
External APIs
```

without requiring those clients to directly access databases or internal services.

The final architecture should provide:

```text
Frontend
    ↓
API Gateway
    ↓
Domain Services
    ↓
Dedicated Databases
```

while preserving existing business behavior.

---

# 2. MOST IMPORTANT PRINCIPLE

## CHANGE ARCHITECTURE — DO NOT CHANGE BUSINESS BEHAVIOR

The purpose of this work is architectural separation.

Do not redesign business workflows simply because the code is being reorganized.

Preserve existing behavior for:

* Authentication
* Authorization
* Admin
* Customer
* Pharmacy
* Medicine Request
* Proposal
* Order
* Inventory
* Prescription
* Order status
* Inventory reservation
* Inventory release
* Inventory deduction
* Rider assignment
* Delivery
* Rider notifications
* WhatsApp notifications
* Alerts
* Dashboards
* Validations
* Existing UI behavior
* Existing API business semantics

If an existing behavior is unclear, inspect the code and tests before changing it.

---

# 3. IMPORTANT — NO DATA MIGRATION

This project is currently in the **initial development phase**.

There are no production customers or production datasets that require migration.

Therefore:

## DO NOT BUILD:

* Production data migration
* Legacy database migration
* Legacy-to-new database synchronization
* Dual-write architecture
* Historical production-data conversion
* Production cutover strategy
* Blue/green migration solely for database migration
* Temporary legacy/new database synchronization
* Migration compatibility layers

This is NOT a legacy migration project.

This is:

```text
CURRENT DEVELOPMENT CODE
        ↓
ARCHITECTURAL RESTRUCTURING
        ↓
FINAL TARGET ARCHITECTURE
```

Create the final architecture directly.

If a new service requires a dedicated database, configure the dedicated database directly.

Do not maintain the old database architecture merely for migration compatibility.

---

# 4. PHASE 0 — REPOSITORY DISCOVERY

Before modifying code, inspect the entire repository.

Start with:

```bash
git clone https://github.com/ashvins1912/Pharma.git
cd Pharma
git checkout new-architecture
```

Then inspect:

```bash
git status
git branch
git log --oneline -20
find .
```

Use the appropriate commands for the repository's technology.

Inspect:

```text
package.json
package-lock.json
pnpm-lock.yaml
yarn.lock
README.md
.env.example
Dockerfile
docker-compose.yml
tsconfig.json
vite.config.*
next.config.*
webpack config
backend configuration
frontend configuration
database configuration
```

Do not assume all of these exist.

---

# 5. CREATE AN ARCHITECTURE INVENTORY BEFORE CODING

Before changing the codebase, produce an internal inventory containing:

## Frontend

Identify:

* Framework
* Build system
* Entry point
* Routing
* Authentication state
* API clients
* Pages
* Components
* Forms
* Upload functionality
* Dashboard
* Admin screens
* Customer screens
* Pharmacy screens

## Backend

Identify:

* Framework
* Entry point
* Routes
* Controllers
* Services
* Repositories
* Models
* Middleware
* Validators
* Error handling
* Authentication
* Authorization

## Database

Identify:

* MongoDB/PostgreSQL/etc.
* Connection initialization
* Database names
* Collections/tables
* Models
* Indexes
* Transactions
* Direct database access from routes/controllers

## Integrations

Identify:

* WhatsApp
* Email
* SMS
* Push
* File storage
* Cloud storage
* Payment providers
* Delivery integrations
* External APIs

## Deployment

Identify:

* Docker
* Nginx
* Load balancer
* Kubernetes
* Cloud configuration
* Environment variables
* CI/CD

---

# 6. IDENTIFY CURRENT DEPENDENCIES

Build a dependency map.

For example:

```text
Frontend
   ↓
Route
   ↓
Controller
   ↓
Service
   ↓
Repository
   ↓
MongoDB
```

Identify any problematic dependencies such as:

```text
Frontend
   ↓
Backend source file
```

or:

```text
Frontend
   ↓
MongoDB
```

or:

```text
Order Service
   ↓
Inventory MongoDB
```

or:

```text
Medicine Request
   ↓
Order database directly
```

These must be removed.

---

# 7. TARGET REPOSITORY STRUCTURE

Move toward:

```text
ashvin-pharmacy/
│
├── frontend/
│
├── backend/
│
├── api-gateway/
│
├── services/
│   ├── inventory-service/
│   ├── order-service/
│   ├── medicine-request-service/
│   ├── notification-service/
│   └── delivery-service/
│
├── docs/
│
├── docker/
│
├── docker-compose.yml
│
├── README.md
└── .gitignore
```

Do not blindly create every service.

First determine which functionality already exists and which service boundary can safely be introduced.

---

# 8. FRONTEND SEPARATION

The frontend must become a completely independent project.

The frontend must NOT:

```text
Import backend source files
Import backend controllers
Import backend services
Import backend repositories
Import backend models
Access MongoDB
Access service databases
Access backend filesystem
Contain backend business logic
Contain service credentials
Contain database credentials
```

The correct architecture is:

```text
Frontend
    ↓
Frontend API Client
    ↓
API Gateway
    ↓
Backend / Services
```

---

# 9. FRONTEND API LAYER

Create or refactor toward a centralized API layer.

Conceptually:

```text
frontend/
└── src/
    └── api/
        ├── client
        ├── auth
        ├── orders
        ├── inventory
        ├── medicineRequests
        ├── proposals
        ├── riders
        ├── notifications
        └── dashboard
```

Use the actual project conventions.

Do not create duplicate API clients unnecessarily.

---

# 10. API GATEWAY

Create a public API Gateway.

Architecture:

```text
Web
Mobile
Admin
POS
ERP
Partner
External API
      |
      v
+----------------+
| API Gateway    |
+----------------+
      |
      +-------------------+
      |                   |
      v                   v
Order Service       Inventory Service
      |
      +-------------------+
      |
      v
Other Services
```

The API Gateway should handle:

* Authentication
* JWT validation
* Authorization where appropriate
* Routing
* CORS
* Rate limiting
* Request size limits
* Request ID
* Correlation ID
* API versioning
* Security headers
* Logging
* Controlled error handling

---

# 11. PUBLIC API VERSIONING

Use:

```text
/api/v1/
```

Examples:

```text
/api/v1/auth
/api/v1/orders
/api/v1/inventory
/api/v1/medicine-requests
/api/v1/proposals
/api/v1/riders
/api/v1/notifications
```

Do not expose internal service URLs to browsers.

---

# 12. INVENTORY SERVICE

Inventory should become an independent service.

Inventory Service owns:

```text
Product/inventory data required by inventory
Stock
Availability
Reservations
Releases
Deductions
Adjustments
Bulk inventory ingestion
Import jobs
Import failures
Inventory audit
```

Architecture:

```text
Order Service
      |
      | authenticated API
      v
Inventory Service
      |
      v
Dedicated Inventory Database
```

No other service may directly access the Inventory database.

---

# 13. INVENTORY DATABASE

Create a dedicated inventory database according to the actual technology.

Conceptual collections/tables:

```text
products
inventory
stock_reservations
inventory_import_jobs
inventory_import_batches
inventory_import_failures
inventory_audit
```

Use actual naming conventions from the codebase where appropriate.

Do not duplicate unrelated customer/order data into Inventory Service.

---

# 14. ORDER SERVICE

Order Service becomes the authoritative owner of Orders.

It owns:

```text
Order
Order Items
Order Status
Order Lifecycle
Order Audit
Order Events
Order Pricing Snapshot
Prescription Reference
Inventory Reservation Reference
Delivery Reference
```

It must not directly access the Inventory database.

---

# 15. ORDER ITEM SNAPSHOT

When an Order is created, preserve the relevant product information as an immutable snapshot.

Conceptually:

```json
{
  "productId": "MED123",
  "productVersion": 7,
  "sku": "ABC123",
  "name": "Paracetamol 500mg",
  "genericName": "Paracetamol",
  "strength": "500mg",
  "form": "Tablet",
  "manufacturer": "XYZ Pharma",
  "quantity": 2,
  "unitPrice": 45,
  "tax": 5,
  "discount": 0,
  "totalPrice": 90,
  "snapshotAt": "2026-10-01T12:30:00Z"
}
```

Adapt fields to the actual repository.

Historical Orders must not change merely because the current product record changes.

---

# 16. ORDER ↔ INVENTORY

Order Service communicates with Inventory Service using APIs.

Required capabilities:

```text
Check Availability
Reserve
Release
Deduct
```

Example conceptual APIs:

```text
GET  /api/v1/inventory/:productId
POST /api/v1/inventory/check-availability
POST /api/v1/inventory/reservations
POST /api/v1/inventory/reservations/:id/release
POST /api/v1/inventory/reservations/:id/deduct
POST /api/v1/inventory/adjust
```

Use actual naming conventions where appropriate.

Order must store the reservation reference.

---

# 17. INVENTORY FAILURE SAFETY

If Inventory Service is unavailable:

DO NOT:

```text
Assume stock exists
Confirm an Order incorrectly
Deduct stock locally
Write directly into Inventory DB
```

Use controlled failure/retry/reconciliation.

---

# 18. BULK INVENTORY EXCEL INGESTION

Inspect the existing implementation first.

Identify:

* Excel parser
* Existing upload endpoint
* Validation
* Data transformation
* Database insertion
* Duplicate handling
* Error handling

Then refactor it into Inventory Service.

---

# 19. BULK IMPORT REQUIREMENTS

The system must support files larger than 5,000 records.

The current failure where uploads above approximately 5,000 records fail must be addressed.

Do NOT simply increase an HTTP timeout.

Implement proper application-level processing.

Requirements:

* Streaming/chunking
* Configurable batch size
* Configurable worker concurrency
* MongoDB `bulkWrite` or equivalent where appropriate
* Partial success
* Retry transient failures
* Idempotency
* Duplicate handling
* Import job tracking
* Failure tracking
* Failed record download

---

# 20. BULK IMPORT MUST NOT FAIL COMPLETELY BECAUSE OF ONE RECORD

For example:

```text
10,000 records
9,850 successful
150 failed
```

The import must complete with:

```text
COMPLETED_WITH_ERRORS
```

The successful records remain inserted/updated.

The failed records must be available for download.

---

# 21. IMPORT JOB STATES

Use appropriate states such as:

```text
QUEUED
VALIDATING
PROCESSING
COMPLETED
COMPLETED_WITH_ERRORS
FAILED
CANCELLED
```

Track:

```text
total
processed
successful
inserted
updated
failed
retries
duration
```

---

# 22. FAILED RECORD FILE

Generate a downloadable failed-record file.

It should contain:

```text
Original input columns
Row number
Product/SKU
Failure reason
Failure type
Retryable flag
```

Example:

```text
rowNumber | sku | name | failureType | reason | retryable
```

Do not lose the original record.

---

# 23. RETRY

Retry only retryable/transient failures.

Use:

```text
bounded exponential backoff
maximum retry count
```

Do not infinitely retry permanent validation errors.

---

# 24. IMPORT IDEMPOTENCY

The same import must not accidentally create duplicate inventory records.

Support:

```text
jobId
idempotencyKey
stable product identifier
```

Use the actual unique business key from the repository.

Do NOT assume medicine name is unique.

Prefer SKU/product code or another verified unique identifier.

---

# 25. LARGE FILE MEMORY MANAGEMENT

Do not load unnecessarily large Excel files entirely into memory.

Use:

```text
streaming
chunking
bounded concurrency
batch writes
```

Benchmark at minimum:

```text
1,000
5,000
10,000
25,000
50,000
100,000
```

where practical.

Record:

```text
processing time
memory usage
throughput
failure rate
```

---

# 26. MEDICINE REQUEST

Preserve:

```text
Customer
    ↓
Medicine Request
    ↓
Pharmacy Review
    ↓
Proposal
    ↓
Customer Approval / Rejection
```

Medicine Request is NOT an Order.

Proposal is NOT an Order.

Only customer approval/conversion creates the Order.

---

# 27. MEDICINE REQUEST SERVICE

Medicine Request Service owns:

```text
Medicine Requests
Request status
Prescription reference
Product image reference
Pharmacy review
Proposal
Proposal status
Customer decision
```

It must not directly write into Order database.

---

# 28. MEDICINE REQUEST → ORDER

Use an API:

```text
POST /api/v1/orders/from-medicine-request
```

or equivalent based on existing conventions.

The conversion must be idempotent using:

```text
medicineRequestId
proposalId
idempotencyKey
```

A repeated approval must not create duplicate Orders.

---

# 29. ORDER STATUS

Preserve actual existing statuses.

At minimum, maintain the existing business lifecycle around:

```text
Pending Review
Approved
Processing
Ready to Dispatch
Dispatched
Delivered
```

Also preserve current:

```text
Cancelled
Rejected
```

or equivalent statuses found in the repository.

Do not rename statuses merely for aesthetic reasons if doing so breaks existing behavior.

---

# 30. DELIVERY / RIDER

Inspect the existing rider implementation before changing it.

Preserve:

* Automatic assignment
* Manual assignment
* Rider availability
* Assignment strategy
* Rider alerts
* Dispatch
* Delivery state
* Existing notifications

Future architecture:

```text
Order Service
      |
      v
Delivery Service
      |
      v
Rider Database
```

If extracting Delivery Service immediately would create unnecessary risk, keep the existing Delivery implementation temporarily within the appropriate backend boundary while ensuring it is isolated enough to extract later.

Do not break the existing workflow merely to achieve microservice purity.

---

# 31. NOTIFICATION SERVICE

Inspect all existing notification triggers.

Preserve current behavior.

Long-term architecture:

```text
Order Service
      |
      | Events
      v
Notification Service
      |
      +---- WhatsApp
      +---- Push
      +---- SMS
      +---- Email
      +---- Webhooks
```

Do not remove or change notification triggers without verifying existing behavior.

---

# 32. BUSINESS EVENTS

Prepare event boundaries such as:

```text
OrderCreated
OrderApproved
OrderProcessing
OrderReadyForDispatch
OrderAssigned
OrderReassigned
OrderDispatched
OrderDelivered
OrderCancelled
OrderRejected
OrderInventoryReserved
OrderInventoryReleased
OrderInventoryDeducted
```

System events:

```text
InventoryReservationFailed
InventoryServiceUnavailable
RiderAssignmentFailed
NotificationFailed
ExternalIntegrationFailed
OrderProcessingFailed
```

Use an outbox pattern where appropriate.

Do not introduce Kafka/RabbitMQ merely because it sounds scalable.

Use the simplest reliable mechanism appropriate to the current application.

---

# 33. NOTIFICATION FAILURE

If notification delivery fails:

```text
Order state must remain correct.
Notification must be retryable.
Failure must be observable.
```

Do not roll back a successful Order transaction merely because WhatsApp failed.

---

# 34. FUTURE CLIENTS

The architecture must support:

```text
WEB
MOBILE
ADMIN
POS
ERP
PARTNER
API
```

Every client must use APIs.

No client may access:

```text
MongoDB
Internal service database
Private service endpoints
Service credentials
```

---

# 35. API IDEMPOTENCY

Transaction APIs should support idempotency where retries can create duplicates.

Examples:

```text
Order creation
Medicine Request approval
Inventory reservation
Inventory deduction
External integrations
Webhook processing
```

Example:

```http
POST /api/v1/orders
Idempotency-Key: 8f3d...
```

Repeated request with the same key must not create a duplicate transaction.

---

# 36. CORS

Fix the existing:

```text
Request origin is not allowed by CORS
```

issue properly.

CORS must be centralized at the public API boundary.

Use:

```env
CORS_ALLOWED_ORIGINS=
```

Development:

```env
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

Staging:

```env
CORS_ALLOWED_ORIGINS=https://staging-app.example.com
```

Production:

```env
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

Never use unrestricted:

```text
*
```

in production.

---

# 37. CORS REQUIREMENTS

Support:

```text
GET
POST
PUT
PATCH
DELETE
OPTIONS
```

where required.

Handle preflight correctly.

Allowed origins must be exact configured origins.

No-Origin requests must work for:

```text
health checks
internal service calls
CLI clients
server-to-server calls
```

---

# 38. CORS ERROR RESPONSE

A rejected origin must return a controlled response.

Example:

```json
{
  "success": false,
  "error": {
    "code": "CORS_ORIGIN_NOT_ALLOWED",
    "message": "Request origin is not allowed."
  },
  "requestId": "..."
}
```

Do not throw an unhandled exception.

---

# 39. CORS DEPLOYMENT

The implementation must work behind:

```text
Nginx
AWS ALB
Cloud Load Balancer
Kubernetes Ingress
Cloudflare
API Gateway
Docker reverse proxy
```

Avoid duplicate CORS headers.

One layer must be authoritative for browser CORS.

---

# 40. FRONTEND DEPLOYMENT URL

Use environment configuration.

Example:

```env
VITE_API_BASE_URL=http://localhost:8080/api/v1
```

Production:

```env
VITE_API_BASE_URL=https://api.example.com/api/v1
```

Do not hardcode production URLs.

---

# 41. AUTHENTICATION

Preserve the current authentication model unless the repository demonstrates a specific architectural reason to change it.

Do not introduce unnecessary authentication rewrites.

Browser:

```text
Frontend
   ↓
API Gateway
```

Internal services:

```text
Service
   ↓
Authenticated service-to-service request
   ↓
Another Service
```

Service credentials must never reach the browser.

---

# 42. SERVICE-TO-SERVICE SECURITY

Use an appropriate mechanism supported by the current stack:

```text
Service JWT
mTLS
Internal API credentials
Private network
```

Never expose service credentials in frontend environment variables.

---

# 43. DATABASE OWNERSHIP

Each service must own its data.

Example:

```text
Order Service
    ↓
Order DB

Inventory Service
    ↓
Inventory DB

Medicine Request Service
    ↓
Medicine Request DB
```

Services communicate through APIs/events, not shared database writes.

---

# 44. ORDER DATABASE

Conceptually:

```text
orders
order_items
order_events
order_audits
order_ratings
outbox_events
```

Use actual schema conventions.

---

# 45. FUTURE EXTERNAL API

Prepare APIs such as:

```text
GET /api/v1/orders
GET /api/v1/orders/:id
GET /api/v1/orders?from=...&to=...
```

For large exports:

```text
Create Export Job
    ↓
Background Processing
    ↓
Download Export
```

Do not create large synchronous requests that can timeout.

---

# 46. WEBHOOK READINESS

Future outbound integrations should support:

```text
Signed payloads
Retry
Exponential backoff
Delivery logs
Idempotency
Replay
Dead-letter handling
```

Do not implement unnecessarily if not required now, but do not design the architecture in a way that prevents it.

---

# 47. ERROR HANDLING

Use consistent error responses.

Support:

```text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Validation/Business Error
429 Rate Limited
500 Internal Error
502 Bad Gateway
503 Service Unavailable
504 Gateway Timeout
```

Do not expose stack traces in production.

---

# 48. REQUEST / CORRELATION ID

Support:

```text
X-Request-ID
X-Correlation-ID
```

Propagate through:

```text
Frontend
    ↓
API Gateway
    ↓
Order Service
    ↓
Inventory Service
```

Logs should contain request/correlation IDs.

Never log:

```text
passwords
tokens
cookies
secrets
full sensitive request bodies
```

---

# 49. HEALTH AND READINESS

Each independently deployed service should expose:

```text
/health
/ready
```

These endpoints should work without a browser Origin.

---

# 50. ENVIRONMENT CONFIGURATION

Each service must have an appropriate `.env.example`.

Examples:

```text
frontend/.env.example
api-gateway/.env.example
backend/.env.example
services/inventory-service/.env.example
services/order-service/.env.example
services/medicine-request-service/.env.example
services/notification-service/.env.example
services/delivery-service/.env.example
```

Only create files for services actually implemented.

Never commit production secrets.

---

# 51. DOCKER

If Docker is already used, preserve it and refactor it.

If Docker is not used, introduce it only if it materially improves the architecture/deployment.

Do not force Docker changes unrelated to the objective.

Services should be independently buildable where required.

---

# 52. TESTING STRATEGY

The AI must inspect existing tests before changing them.

Add/update:

## Unit tests

For:

* Business rules
* Validation
* Inventory calculations
* Order transitions
* Assignment logic
* Idempotency

## Integration tests

For:

```text
Order → Inventory
Medicine Request → Order
Order → Delivery
Order → Notification
```

## API tests

For:

```text
Authentication
Authorization
CORS
Preflight
Validation
Error responses
```

## End-to-end tests

At least validate:

```text
Customer flow
Medicine Request flow
Proposal flow
Order creation
Inventory reservation
Order processing
Rider assignment
Dispatch
Delivery
Notification
```

---

# 53. CRITICAL FAILURE TESTS

Explicitly test:

### Scenario 1

Inventory unavailable.

Expected:

```text
No false stock confirmation.
Controlled error/retry.
```

### Scenario 2

Duplicate Order request.

Expected:

```text
One Order only.
```

### Scenario 3

Duplicate Medicine Request approval.

Expected:

```text
One Order only.
```

### Scenario 4

Inventory reservation timeout.

Expected:

```text
No silent inconsistency.
Controlled retry/reconciliation.
```

### Scenario 5

Order cancellation.

Expected:

```text
Inventory release exactly once.
```

### Scenario 6

Rider assignment failure.

Expected:

```text
Controlled Order/Delivery state.
Admin alert.
```

### Scenario 7

WhatsApp failure.

Expected:

```text
Order remains correct.
Notification retry/failure tracking.
```

### Scenario 8

External client retry.

Expected:

```text
No duplicate transaction.
```

---

# 54. OBSERVABILITY

Add or preserve:

```text
Structured logs
Request ID
Correlation ID
Error logs
Service health
Import metrics
Import duration
Order processing metrics
Notification failures
Inventory failures
```

Do not introduce a large observability stack unless required.

---

# 55. BULK IMPORT MONITORING

For every import job, expose enough information to understand:

```text
Job ID
Status
Started At
Completed At
Total Rows
Processed Rows
Inserted
Updated
Failed
Retries
Duration
Failure File
```

---

# 56. ADMIN EXPERIENCE

Preserve current Admin functionality.

For Medicine Requests / Proposals:

If there are:

```text
Pending
Under Review
```

items, show the appropriate pending count.

Provide the existing admin notification behavior that opens the relevant Medicine Requests & Proposals screen.

Do not expose customer-only actions to Admin if the current business rule prohibits them.

---

# 57. MEDICINE REQUEST CUSTOMER OWNERSHIP

Preserve ownership rules.

Customer should only see their own Medicine Requests.

Admin/Pharmacy users should see requests according to their authorization.

If an address is required and the current workflow allows the address from the request form to become the user's address, preserve that behavior.

---

# 58. PROPOSAL CUSTOMER ACTIONS

After Pharmacy Review creates a Proposal:

Customer actions should remain:

```text
CUSTOMER APPROVED
CUSTOMER REJECTED
```

Do not expose inappropriate customer-decision actions to Admin unless the existing application explicitly requires it.

---

# 59. UI REGRESSION

Do not unnecessarily redesign the UI.

Verify:

```text
Desktop
Tablet
Mobile
```

Maintain:

* Navigation
* Forms
* Modals
* Tables
* Filters
* Search
* Notifications
* Loading states
* Error states

---

# 60. VIEW DETAILS MODAL

If the current implementation contains the Medicine Request/Proposal View Details modal issue, verify:

* Header exists
* Background overlay/opacity is correct
* Close action works
* Content is readable
* Mobile layout works
* Keyboard/accessibility behavior is preserved where supported

Only modify if the repository actually contains this workflow/issue.

---

# 61. DOCUMENTATION

Create/update documentation based on the actual repository.

Recommended:

```text
docs/
├── architecture/
│   ├── overview.md
│   ├── service-boundaries.md
│   ├── frontend.md
│   ├── api-gateway.md
│   ├── order-service.md
│   ├── inventory-service.md
│   ├── medicine-request-service.md
│   ├── notification-service.md
│   └── delivery-service.md
│
├── api/
├── deployment/
├── development/
└── troubleshooting/
```

Do not document services that were not actually implemented.

---

# 62. ARCHITECTURE DIAGRAM

Create an accurate architecture diagram based on the final implementation.

Target conceptual architecture:

```text
                         CLIENTS
                            |
        +-------------------+-------------------+
        |                   |                   |
        v                   v                   v
      WEB                MOBILE          EXTERNAL SYSTEMS
                                            POS / ERP /
                                            PARTNERS
        |                   |                   |
        +-------------------+-------------------+
                            |
                            v
                    +---------------+
                    | API GATEWAY   |
                    +-------+-------+
                            |
          +-----------------+------------------+
          |                 |                  |
          v                 v                  v
   +-------------+   +-------------+   +------------------+
   | ORDER       |   | INVENTORY   |   | MEDICINE REQUEST |
   | SERVICE     |   | SERVICE     |   | SERVICE          |
   +------+------+   +------+------+   +--------+---------+
          |                 |                  |
          v                 v                  v
       Order DB        Inventory DB       Request DB
          |
          +---------------------+
                                |
                    +-----------+-----------+
                    |                       |
                    v                       v
             Delivery Service       Notification Service
                    |                       |
                 Rider DB              Channels
                                      WhatsApp
                                      Push
                                      SMS
                                      Email
                                      Webhooks
```

The final diagram must be updated to match the actual implementation.

---

# 63. DO NOT OVER-ENGINEER

Do not introduce technologies simply because they are commonly used in microservices.

Avoid unnecessary:

```text
Kafka
RabbitMQ
Redis
Kubernetes
Service Mesh
Event Bus
CQRS
Event Sourcing
Distributed Transactions
```

unless the actual requirements and repository justify them.

Prefer:

```text
Clear APIs
Strong service boundaries
Idempotency
Reliable transactions
Good error handling
Observability
Simple deployment
```

---

# 64. DO NOT REWRITE EVERYTHING

Before creating a new implementation, search the repository for existing functionality.

For example, before implementing Order assignment:

```text
Search existing assignment logic.
```

Before implementing notifications:

```text
Search existing WhatsApp logic.
```

Before implementing inventory:

```text
Search existing inventory repositories/services/models.
```

Before implementing authentication:

```text
Search existing auth middleware and authorization.
```

Reuse proven logic where possible.

---

# 65. FILE-BY-FILE CHANGE PLAN

Before making large modifications, determine:

```text
FILES TO MOVE
FILES TO CREATE
FILES TO MODIFY
FILES TO DELETE
FILES TO KEEP
```

For every significant change, understand the dependency impact.

Do not delete files until all references are updated.

---

# 66. KEEP THE CODE BUILDABLE

After each logical architectural phase:

```text
Install dependencies
Run lint
Run type checking
Run tests
Build
Start application
```

Do not make hundreds of changes and only discover at the end that the repository no longer builds.

---

# 67. RECOMMENDED IMPLEMENTATION ORDER

Follow this order unless repository-specific constraints require another sequence.

## Phase 1

Repository discovery.

## Phase 2

Document existing architecture.

## Phase 3

Separate Frontend project.

## Phase 4

Create API client layer.

## Phase 5

Create API Gateway.

## Phase 6

Implement deployment-safe CORS.

## Phase 7

Establish Inventory Service boundary.

## Phase 8

Move/refactor bulk inventory processing.

## Phase 9

Establish Order Service boundary.

## Phase 10

Connect Order → Inventory APIs.

## Phase 11

Establish Medicine Request → Proposal → Order API boundary.

## Phase 12

Preserve Delivery/Rider functionality.

## Phase 13

Establish Notification boundary.

## Phase 14

Add observability and request IDs.

## Phase 15

Update deployment configuration.

## Phase 16

Run unit/integration/E2E tests.

## Phase 17

Perform final architecture audit.

---

# 68. FINAL ARCHITECTURE AUDIT

Before declaring completion, verify:

### Frontend

```text
[ ] Independent project
[ ] No backend imports
[ ] No database access
[ ] API client exists
[ ] Environment-based API URL
```

### API Gateway

```text
[ ] Public entry point
[ ] API versioning
[ ] Authentication
[ ] CORS
[ ] Rate limiting
[ ] Request IDs
[ ] Error handling
```

### Inventory

```text
[ ] Independent ownership
[ ] Dedicated DB
[ ] Reservation
[ ] Release
[ ] Deduction
[ ] Bulk import
[ ] Partial success
[ ] Failed records
[ ] Retry
[ ] Idempotency
```

### Orders

```text
[ ] Independent ownership
[ ] Dedicated DB
[ ] Order lifecycle
[ ] Product snapshot
[ ] Inventory reference
[ ] Idempotency
```

### Medicine Requests

```text
[ ] Request separate from Order
[ ] Proposal separate from Order
[ ] Customer approval
[ ] Idempotent conversion
```

### Delivery

```text
[ ] Existing assignment preserved
[ ] Rider notification preserved
[ ] Dispatch preserved
[ ] Delivery preserved
```

### Notifications

```text
[ ] WhatsApp preserved
[ ] Rider notifications preserved
[ ] Failure handling
[ ] Retry capability
```

### Deployment

```text
[ ] Dev works
[ ] Staging configuration works
[ ] Production configuration works
[ ] CORS works behind proxy
[ ] No wildcard production CORS
[ ] No secrets committed
```

---

# 69. REQUIRED FINAL REPORT FROM THE AI CODING TOOL

After implementation, do NOT simply say:

```text
"Done"
```

Provide a detailed implementation report.

Include:

## 1. Repository Analysis

What was found in the original repository.

## 2. Final Architecture

What architecture was implemented.

## 3. Files Created

List actual paths.

## 4. Files Modified

List actual paths and what changed.

## 5. Files Moved

List old → new paths.

## 6. Files Deleted

Only list files actually deleted and why.

## 7. Service Boundaries

Explain ownership of:

```text
Order
Inventory
Medicine Request
Delivery
Notification
```

## 8. Database Boundaries

Explain which service owns which database/collections.

## 9. API Changes

List:

```text
New endpoints
Changed endpoints
Removed endpoints
Internal endpoints
```

## 10. CORS

Explain:

```text
Allowed origins
Environment configuration
Preflight
Production behavior
Proxy compatibility
```

## 11. Bulk Import

Report:

```text
Batch size
Concurrency
Retry count
Partial success behavior
Failure file
Idempotency
```

## 12. Testing

Report exact commands and results.

Example:

```text
npm test
npm run build
npm run lint
```

Do not claim tests passed unless they were actually executed.

## 13. Known Limitations

Clearly list anything not completed.

## 14. Migration

Explicitly state:

```text
No production data migration was implemented because the repository is in the initial development phase and no production customer/data migration is required.
```

---

# 70. FINAL ENGINEERING RULE

The AI coding agent must always prefer:

```text
Inspect actual code
        ↓
Understand existing behavior
        ↓
Define boundary
        ↓
Refactor incrementally
        ↓
Test
        ↓
Verify
```

over:

```text
Assume architecture
        ↓
Rewrite everything
        ↓
Hope existing behavior still works
```

The repository is the source of truth.

Do not invent existing functionality.

Do not silently remove existing behavior.

Do not introduce unnecessary infrastructure.

Do not build migration infrastructure when migration is not required.

Do not expose internal services or databases.

Do not leave the frontend coupled to backend source code.

Do not consider the task complete merely because the directory structure looks correct.

The task is complete only when the **actual application works through the new architecture and existing business workflows continue to function correctly.**
