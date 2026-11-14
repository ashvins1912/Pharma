# Polyglot persistence and service database registry

## Decision

Pharma uses polyglot persistence: SQL and NoSQL are both first-class platform capabilities, but each service owns one authoritative database for its transactional domain. PostgreSQL is the preferred relational store for strongly related transactional records; MongoDB remains appropriate for flexible documents, source payloads and document-oriented processing. Redis is a cache/coordination layer, not an authoritative system of record.

A service must not write the same aggregate to two databases as independent sources of truth. Cross-service data is exchanged through authenticated APIs or durable events/read models, never by querying another service's database.

## Ownership and current provider readiness

| Service | Data ownership | Current provider | SQL readiness |
|---|---|---|---|
| Inventory Service | Products, branch stock, batches, reservations and stock movements | MongoDB | Not yet; Mongoose models and atomic stock workflows need repository ports |
| Medicine Master | Catalogue imports, source metadata, reconciliation and catalogue processing | MongoDB | Not yet; import workers and Mongoose models need repository ports |
| Order Service | Order lifecycle, idempotency and order events | MongoDB | Not yet; order/event repositories and transaction contracts need migration |
| Prescription Service | Prescription documents and verification lifecycle | MongoDB / PyMongo | Not yet; Python repository and document lifecycle need migration |
| Legacy backend | Remaining platform bounded contexts | Existing MongoDB datastore | Per-context assessment required |

The Medicine Master service currently has a legacy fallback to the Inventory Mongo URI/database. Preserve that compatibility until catalogue/import ownership and all cross-service reads have been separated and reconciled. Do not point it at a new empty database.

## Implemented foundation

`@pharma/database-kernel` provides:

- A central service database registry with explicit data ownership and provider readiness.
- Per-service provider selection (`<SERVICE>_DATABASE_PROVIDER`) with a global `DATABASE_PROVIDER` fallback.
- Backward-compatible Mongo URI resolution from existing service-specific variables.
- A Mongoose connection lifecycle adapter used by Inventory, Medicine Master and Order services.
- A PostgreSQL Pool adapter with health checks, parameterized queries and transaction/rollback handling for future SQL-ready services.
- Fail-closed provider validation. A PostgreSQL driver adapter existing in the platform does not automatically make a Mongoose-backed service PostgreSQL-compatible.

The PostgreSQL adapter accepts the `Pool` constructor from the service composition root. This keeps the kernel independent of a particular driver version and allows each SQL-ready service to own its driver/dependency and pool configuration.

## Configuration

Existing services continue using their current variables. Optional provider selectors:

- `INVENTORY_DATABASE_PROVIDER=mongodb`
- `MEDICINE_MASTER_DATABASE_PROVIDER=mongodb`
- `ORDER_DATABASE_PROVIDER=mongodb`
- `PRESCRIPTION_DATABASE_PROVIDER` is reserved in the registry for the future Python adapter; the current PyMongo process does not yet consume this selector.

`DATABASE_PROVIDER=mongodb` is a global default only for Node services wired to this kernel; service-specific values take precedence. The Prescription Python service remains on its current PyMongo configuration until a Python adapter is added. Do not set a service to `postgresql` until its registry entry explicitly lists PostgreSQL as supported and its repository contract tests pass.

Connection strings remain service-scoped secrets (`INVENTORY_MONGO_URI`, `ORDER_MONGO_URI`, `MEDICINE_MASTER_MONGO_URI`, etc.). For future SQL adapters use service-specific `*_DATABASE_URL` secrets. Never store credentials in the registry, manifests, source control or logs.

## SQL vs NoSQL data placement

Recommended targets, subject to domain migration and operational verification:

- PostgreSQL: tenants/memberships, identity and permissions, orders, payment ledger, stock ledger, inventory reservations, notification delivery state and structured audit metadata.
- MongoDB: imported catalogue source payloads, flexible medicine attributes, staged import rows/chunks, reconciliation snapshots, external integration payloads and variable provider metadata.
- Redis: cache, ephemeral coordination and rate limiting only; never the sole store for orders, stock, prescriptions or audit evidence.
- Object storage: prescription binaries, import files and immutable evidence attachments, with database records holding metadata, access policy and checksums.

Some data should be split by lifecycle: canonical catalogue and inventory/stock transactions are not the same thing as raw external catalogue source records. Keep the authoritative owner explicit.

## Required migration sequence

1. **Foundation (this commit):** registry, provider adapters, tests and existing Mongo connection lifecycle integration.
2. **Inventory:** define repository ports for stock, reservation, batch, product and import workflows. Preserve atomic reservations, FEFO allocation, idempotency, tenant/branch predicates and current API DTOs. Migrate transactional stock/reservation data to PostgreSQL only after concurrency and rollback contract tests pass. Keep raw import staging/source documents in MongoDB if that remains the better fit.
3. **Orders and payments:** migrate order lifecycle, idempotency and event/outbox tables to PostgreSQL as one coherent aggregate boundary. Preserve unique constraints, optimistic concurrency, idempotency and event replay semantics.
4. **Medicine Master:** keep flexible source/import documents in MongoDB; introduce repository ports and decide whether canonical catalogue records should move to a relational projection. Reconcile IDs, versions and references before any cutover.
5. **Prescription:** assess document metadata and lifecycle separately from encrypted binary/object storage. Preserve patient access controls, retention/deletion policy and audit evidence. No prescription payloads should enter analytics or general-purpose caches.
6. **Legacy backend:** migrate bounded contexts one at a time. Do not create a shared database adapter that bypasses service ownership.
7. **Cutover:** use expand/backfill/dual-read verification/cutover/rollback. Avoid uncontrolled dual writes. Compare record counts, business totals, unique keys, checksums, tenant scopes and representative reads before switching traffic. Keep a tested rollback window.
8. **Operations:** add per-service pool limits, TLS, least-privilege credentials, encrypted secret storage, migrations, backups/PITR, restore drills, health/readiness checks, query metrics and audit trails.

## Safety invariants

- A provider selector is not a migration tool.
- No production connection string or credential is written to source control.
- Never silently fall back from a failed SQL connection to MongoDB for writes.
- Do not claim cross-database ACID transactions. Use outbox/inbox and saga patterns between services.
- Tenant and branch predicates remain mandatory in repository methods.
- Database changes require migration evidence, backup/restore verification and explicit activation approval.
- PostgreSQL adapter availability does not imply existing services are SQL-ready.
