# Ashvin Pharmacy — AI Architecture Context

## 1. Target Architecture

```text
                         CLIENTS
                            |
        +-------------------+-------------------+
        |                   |                   |
       WEB                MOBILE          EXTERNAL
                                            POS/ERP/
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
   ORDER SERVICE     INVENTORY SERVICE   MEDICINE REQUEST
          |                 |                  |
       Order DB        Inventory DB       Request DB
          |
          +---------------------+
                                |
                    +-----------+-----------+
                    |                       |
                    v                       v
             DELIVERY SERVICE       NOTIFICATION SERVICE
                    |                       |
                 Rider DB              Channels
                                      WhatsApp
                                      Push
                                      SMS
                                      Email
                                      Webhooks
```

The actual implementation may evolve, but this is the target boundary.

---

# 2. Frontend

Frontend is an independent project.

It communicates only through the API Gateway.

```text
Frontend
   ↓
API Client
   ↓
API Gateway
```

It must never access:

* MongoDB
* Internal service databases
* Backend source files
* Internal service credentials

---

# 3. API Gateway

Public entry point:

```text
/api/v1/*
```

Responsibilities:

```text
Authentication
Authorization
Routing
CORS
Rate limiting
Request IDs
Correlation IDs
Security headers
API versioning
Error handling
```

Internal service URLs must not be exposed to browsers.

---

# 4. Order Service

Order Service is the authoritative owner of Orders.

Own:

```text
Orders
Order Items
Order Status
Order Lifecycle
Order Audit
Order Events
Pricing Snapshot
Prescription Reference
Inventory Reservation Reference
Delivery Reference
```

Order database should be independent.

---

# 5. Inventory Service

Inventory Service is the authoritative owner of stock.

Own:

```text
Inventory
Availability
Reservations
Releases
Deductions
Adjustments
Bulk Imports
Import Jobs
Import Failures
Inventory Audit
```

Dedicated Inventory database.

No other service directly modifies Inventory DB.

---

# 6. Order ↔ Inventory

Use APIs:

```text
Check Availability
Reserve
Release
Deduct
```

Conceptually:

```text
Order Service
      |
      v
Inventory Service
      |
      v
Inventory DB
```

Store reservation reference in Order.

If Inventory Service fails, never assume stock is available.

---

# 7. Medicine Request Flow

Business flow:

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
   ↓
Order
```

Important:

```text
Medicine Request != Order
Proposal != Order
```

Only customer approval/conversion creates an Order.

Conversion must be idempotent.

---

# 8. Order Lifecycle

Preserve the repository's actual statuses.

Target conceptual flow:

```text
Pending Review
     ↓
Approved
     ↓
Processing
     ↓
Ready to Dispatch
     ↓
Dispatched
     ↓
Delivered
```

Also preserve current rejection/cancellation states.

Do not rename statuses without checking the repository.

---

# 9. Delivery

Current behavior must remain functional.

Preserve:

* Rider assignment
* Automatic assignment
* Manual assignment
* Rider alerts
* Dispatch
* Delivery

Future boundary:

```text
Order Service
      ↓
Delivery Service
      ↓
Rider DB
```

---

# 10. Notification

Preserve all existing notification triggers.

Future architecture:

```text
Order Events
     ↓
Notification Service
     ↓
WhatsApp / Push / SMS / Email / Webhooks
```

Notification failure must not incorrectly change Order state.

---

# 11. Inventory Bulk Import

Large Excel imports must not depend on a single giant synchronous request.

Use:

```text
Upload
  ↓
Import Job
  ↓
Validation
  ↓
Chunked Processing
  ↓
Bulk Writes
  ↓
Success + Failure Report
```

Required:

```text
Partial success
Retry
Idempotency
Failure reasons
Failed file download
```

Example:

```text
10,000 rows
9,850 successful
150 failed
```

Result:

```text
COMPLETED_WITH_ERRORS
```

The 9,850 successful records remain processed.

---

# 12. Import Job

Track:

```text
jobId
status
total
processed
successful
inserted
updated
failed
retries
startedAt
completedAt
duration
```

Possible states:

```text
QUEUED
VALIDATING
PROCESSING
COMPLETED
COMPLETED_WITH_ERRORS
FAILED
CANCELLED
```

---

# 13. Failed Import Records

Failed file should contain:

```text
Original input columns
Row number
SKU/Product ID
Failure reason
Failure type
Retryable
```

Do not discard the original input.

---

# 14. Product Snapshot

Orders should preserve product information at purchase time.

Conceptually:

```json
{
  "productId": "MED123",
  "sku": "ABC123",
  "name": "Paracetamol 500mg",
  "quantity": 2,
  "unitPrice": 45,
  "tax": 5,
  "discount": 0,
  "totalPrice": 90,
  "snapshotAt": "..."
}
```

Use fields appropriate to the actual repository.

---

# 15. External Clients

Future clients:

```text
Web
Mobile
Admin
POS
ERP
Partner
External API
```

All use APIs.

No direct database access.

Support where appropriate:

```text
source
externalReference
idempotencyKey
```

---

# 16. Events

Business events may include:

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

Do not add a message broker unless justified.

---

# 17. CORS

Use:

```text
CORS_ALLOWED_ORIGINS
```

Development:

```text
http://localhost:3000
http://localhost:5173
```

Production must use exact configured origins.

Never use unrestricted:

```text
*
```

in production.

CORS must work through reverse proxies/load balancers.

Rejected origins must produce controlled errors.

---

# 18. No Migration

This is initial development.

There is no production data migration requirement.

Do not implement:

```text
Legacy migration
Dual writes
Database synchronization
Production cutover
Historical conversion
```

Directly build the target architecture.

---

# 19. Architectural Decision Principle

When deciding where code belongs:

Ask:

> Which service owns this business data and business rule?

Then keep the database and mutation logic inside that service.

Other services communicate through:

```text
API
Event
```

not direct database access.

---

# 20. Simplicity Principle

Do not introduce infrastructure just because it is common in microservices.

Prefer simple, reliable architecture over unnecessary complexity.

The system should be:

```text
Independent
Secure
Observable
Testable
Deployable
API-first
Future-ready
```
