# Inventory Service

This is an independently deployable Node.js service with its own MongoDB
database. It owns inventory product metadata, stock, reservations, adjustments,
import jobs, failures, and audit records. It must not be configured with the
main application's `MONGO_URI`.

## Run locally

From this directory, run `npm install` and configure:

```text
INVENTORY_MONGO_URI=mongodb://localhost:27017
INVENTORY_DB_NAME=pharma_inventory
SERVICE_AUTH_SECRET=<random secret of at least 32 characters>
SERVICE_JWT_ISSUER=ashvin-pharmacy
SERVICE_JWT_AUDIENCE=inventory-service
INVENTORY_SERVICE_PORT=5100
INVENTORY_BATCH_SIZE=250
INVENTORY_WORKER_CONCURRENCY=1
INVENTORY_MAX_RETRIES=3
INVENTORY_IMPORT_MAX_FILE_BYTES=104857600
INVENTORY_IMPORT_STORAGE=./data/imports
```

`SERVICE_AUTH_SECRET`, issuer, and audience must match the API Gateway's
server-side configuration. Never use a `VITE_` variable for these values. Keep
the service on a private network or behind HTTPS and firewall it so browsers
cannot call it directly.

Run `npm start` to start the service. `GET /health` is a liveness check;
`GET /ready` returns `503` until MongoDB is connected. MongoDB must be a
replica set or sharded cluster because reservation state transitions and import
batches use MongoDB transactions.

`render.yaml` can deploy the service independently and mounts persistent import
storage. The Inventory MongoDB cluster is still provisioned and backed up
separately; provide a dedicated replica-set URI when configuring
`INVENTORY_MONGO_URI`.

## API

All `/api/v1/inventory` routes require a short-lived HS256 service JWT with the
configured issuer, audience, caller identity, and operation scope:

| Caller | Scopes |
| --- | --- |
| `order-service` | `inventory.read`, `inventory.reserve`, `inventory.release`, `inventory.deduct` |
| `medicine-request-service` | `inventory.read` |
| `api-gateway` | `inventory.read`, `inventory.import`, `inventory.adjust` |

The application API Gateway authenticates user requests before forwarding
catalog reads, admin adjustments, or imports. Reservation mutation routes
accept only tokens from the `order-service` identity and are deliberately not
proxied to browser clients.

Implemented operations include bulk lookup and availability, reservation,
release, deduction, stock adjustment, queued Excel imports, job status,
failed-row download, and bounded retry of transient failures. Reservation
updates are conditional and transactional; repeat operations with the same
idempotency key do not reserve or deduct stock twice. Imports use SKU identity,
reject duplicate SKUs in one workbook, retain valid rows when other rows fail,
and write stock quantities as absolute upserts so replaying a job does not add
stock twice. Import creation, retry, adjustment, and reservation APIs require
an `Idempotency-Key` header (reservation also accepts the key in its JSON body).

## Import and deployment limits

The worker bounds database operations by `INVENTORY_BATCH_SIZE` and caps
`INVENTORY_WORKER_CONCURRENCY` at three. The workbook is staged on disk and
processed asynchronously, but the current `xlsx` parser materializes a
workbook in memory; the upload limit is therefore also a memory-safety limit.
Benchmark representative workbooks and choose an appropriately sized service
before increasing the limit or worker count. `INVENTORY_IMPORT_STORAGE` must
be a persistent, private writable volume in production so queued files survive
process restarts. Run one service instance per Inventory database until a
distributed worker lease/queue is deployed.

MongoDB backups, restore testing, TLS/network policy, secret rotation, and
capacity/load benchmarks are deployment responsibilities and are not
configured by this repository.

## Current ownership status

The standalone Gateway issues authenticated, scoped service JWTs for Inventory
operations. The main application's existing catalog, order fulfillment,
Medicine Request conversion, and legacy admin import still use the backend
datastore; those workflows have not yet been reimplemented against this
service. This initial-development restructuring does not require data
migration, dual writes, or synchronization. Create service-owned development
data directly in this database, and do not configure this service with the
main application's `MONGO_URI`.
