# Order Service

This is an independently deployable Node.js service with its own MongoDB
database. It owns versioned Order records, immutable product/price snapshots,
idempotency, lifecycle transitions, and a persistent event outbox. It never
connects directly to the Inventory database: product lookup and stock
reservation/release/deduction use the authenticated Inventory API.

## Run locally

Configure a dedicated MongoDB replica-set URI and the following values:

```text
ORDER_MONGO_URI=mongodb://localhost:27017
ORDER_DB_NAME=pharma_orders
SERVICE_AUTH_SECRET=<same private secret used by the API Gateway and Inventory Service>
SERVICE_JWT_ISSUER=ashvin-pharmacy
ORDER_SERVICE_JWT_AUDIENCE=order-service
SERVICE_JWT_AUDIENCE=inventory-service
INVENTORY_SERVICE_URL=https://<private-inventory-service-origin>
ORDER_SERVICE_PORT=5200
```

Install dependencies and run `npm start` from this directory. `GET /health`
is a liveness check; `GET /ready` returns `503` until MongoDB is connected.
Order create and lifecycle-event writes use MongoDB transactions, so a replica
set or sharded cluster is required. Keep this service on a private network and
do not expose its service JWT credentials to browser clients.

## API

The `/api/v1/orders` endpoints require short-lived HS256 service JWTs from the
`api-gateway` identity and an operation scope:

| Operation | Scope | Additional authorization |
| --- | --- | --- |
| Create order | `orders.create` | Gateway-authenticated user identity |
| List/retrieve | `orders.read` | Users see only their orders; admins can list all |
| Change lifecycle status | `orders.manage` | Admin role |
| Read event history | `orders.read` | Admin role |

Order creation requires an `Idempotency-Key` header or `externalReference`.
The service reads current product metadata and prices from Inventory, reserves
stock, and stores an order item snapshot before returning the public `orderId`.
Repeated matching requests return the existing order; reused references with
different order data conflict. Cancellation/rejection releases a reservation,
and dispatch deducts it. Inventory calls are idempotent; the service attempts
a compensating release if the local order/event transaction fails and uses a
deterministic order identity so a retried request can recover a reservation if
the service restarts between reservation and local Order persistence. A client
that never retries after such a restart can leave a reservation pending; a
reservation recovery worker remains operational reliability work.

Lifecycle records are written to the Order Service outbox. The event API is
available to administrators for operational inspection. This repository has
not yet moved WhatsApp notification consumption or rider assignment into
independent services; those existing behaviors remain on the main application.

## Deployment

`../../render.yaml` deploys this service independently. Configure `ORDER_MONGO_URI`,
the shared `SERVICE_AUTH_SECRET`, and a private `INVENTORY_SERVICE_URL`.
Configure `ORDER_SERVICE_URL` and the same service secret on the API Gateway
to route `/api/v1/orders` here. The Gateway validates users through the private
backend identity endpoint and mints scoped service JWTs. When the service URL
is unset, requests continue using the backend's existing versioned Order API.
Create development records directly in this service's database; no production
migration or dual-write workflow is required. Legacy checkout, Medicine
Request conversion, rider assignment, and notifications remain in the backend
until those workflows are implemented here.

MongoDB backups, restore testing, TLS/network policy, secret rotation, and
capacity/load benchmarks remain deployment responsibilities.
