# Data access performance and database portability

## Current service ownership

Pharma already has service-owned persistence boundaries: the platform backend, Inventory Service and Order Service use separate database configuration and own their domain data. The public API Gateway and frontend must remain independent of those stores. A service must never read or write another service's database; cross-service data is obtained through authenticated service APIs.

This is an incremental architecture rule, not a claim that every existing backend module has already been migrated. The platform backend still contains a large legacy `dataStore.js` and Mongoose model usage, while the Inventory and Order services also have Mongoose-specific domain persistence code.

## Stable boundary

The intended dependency direction is:

```text
HTTP route / API contract
        |
Application use case (domain inputs and outputs)
        |
Repository port (domain-oriented methods)
        |
Persistence adapter (MongoDB today; another store later)
        |
Database
```

Rules for new and refactored code:

1. Routes validate transport input and serialize stable DTOs; they do not build database queries.
2. Application services depend on repository interfaces, not Mongoose models, collection names, ObjectIds, aggregation operators or sessions.
3. Repository methods accept domain identifiers and scoped filters, and return plain objects. Do not return hydrated ODM documents to the API layer.
4. Persistence adapters own projections, indexes, query plans, transactions and database-specific error translation.
5. Transactions are exposed as a capability/use-case boundary. Do not leak a Mongo session into an HTTP handler or domain contract.
6. Tenant and branch scope is derived from verified service identity. A repository must require that scope for tenant-owned reads and writes.
7. DTOs and API response schemas are versioned independently of database schemas. Never serialize raw database documents.
8. No service may query another service's database to avoid an API call. Use the owning service's internal API or a separately owned read model/event projection.

A future database replacement should implement the same repository ports and pass the same repository contract tests. API routes, frontend DTOs and business use cases should not need changes.

## Implemented in this pass

### Inventory catalogue search

`services/inventory-service/src/inventory.js` now performs catalogue filtering, branch-stock lookup, stock calculations, sorting, count and page slicing in one database aggregation:

- Applies tenant, active, category, prescription and search filters before joining stock.
- Joins only the requested tenant and branch's inventory batches.
- Projects only fields required by the current catalogue response before and after the join.
- Computes active/expired batch quantities and availability in the database.
- Applies out-of-stock filtering, stable sorting, count and pagination before returning rows to Node.
- Returns at most 100 catalogue rows per request (existing API limit retained).
- Preserves the existing response fields and stock/expiry behavior, including optional expired-batch detail.

Previously the service loaded all matching products and all branch batches into Node, built maps, sorted the complete catalogue and only then paginated. This made application memory and response latency grow with the full catalogue size.

The bounded bulk lookup path now selects only its required product and inventory fields and sorts batches at the database.

### Order list and detail reads

`services/order-service/src/orders.js` now uses an explicit projection matching the existing order response serializer for list and detail reads. Internal reconciliation leases, idempotency fingerprints, worker state and other non-response fields are no longer transferred for those GET requests. Order lists use a deterministic `createdAt DESC, _id DESC` order so records sharing a timestamp do not jump between pages.

`services/order-service/src/models.js` aligns the user, status, source and tenant/branch timestamp indexes with the list sort and adds the stable `_id` tie-breaker. These indexes should still be validated with explain plans and production cardinalities.

### Indexes

`services/inventory-service/src/models.js` adds compound indexes for:
- tenant + active + name ordering;
- tenant + active + category + name ordering;
- tenant + active + prescription flag + name ordering;
- tenant + branch + product + expiry ordering for stock-batch lookup.

These are workload-aligned candidates. Validate them against production query plans and collection cardinality before adding more indexes; every extra index increases write and storage cost.

### Delivery Mongo repositories

The delivery-specific Mongo adapters now use explicit domain projections and `lean()` for read-only order and rider queries. Order list reads can constrain branch/status/assignment and accept a bounded limit; proximity candidate reads are capped at 1,000 and transfer only fields used by the delivery domain. Rider list reads are tenant/branch scoped, use escaped search input, deterministic sorting and a bounded limit; nearby-rider reads project only the rider domain fields.

These changes reduce document hydration and payload size. The proximity query still computes exact distances in application code because the order model does not currently have a verified 2dsphere index. Do not add a geo index until legacy location data has been audited for valid GeoJSON coordinates and the index can be safely built.

### Legacy backend delivery repository

The legacy backend's shared `dataStore.getAllOrders()` previously returned the full order collection for every caller. It now accepts optional, backward-compatible query options for tenant, branch, customer/user, status, assignment, rider, date range, projection, skip and bounded limit. Existing no-argument callers retain their full-list behavior so unrelated workflows are not silently changed.

The delivery order repository now:
- passes tenant and branch predicates into the datastore rather than loading every order first;
- requests only fields needed to construct its delivery-domain entity;
- uses a scoped `getOrderById` call for tenant-owned detail reads;
- delegates updates to `updateOrderForTenant`, which applies the tenant predicate in the database query before mutation/save;
- retains defensive tenant checks for injected test adapters and backward compatibility.

This is an incremental seam: the legacy datastore remains MongoDB-aware, but delivery application/repository consumers no longer need to know its query mechanics. The next stage is to move this adapter behind a fully separate Mongo repository and introduce the same contract for any non-Mongo adapter.

## Remaining migration work

This commit does not claim a complete repository-port migration across the entire platform. The following work must be done service by service, preserving each service's existing contract:

1. Inventory writes/reservations/imports: move all direct model operations behind inventory repository ports; retain atomic stock reservation, FEFO allocation, idempotency and transaction behavior.
2. Order reads/writes/events: introduce order and event repository ports; add purpose-built list/detail projections and cursor pagination for deep order histories.
3. Platform backend: split the legacy `dataStore.js` by domain ownership, first moving reads behind repositories and then writes with contract tests. Do not move inventory or order ownership back into this database.
4. Prescription service: preserve its independent persistence and document lifecycle; expose only metadata needed by other services.
5. API/UI contracts: inventory list, admin inventory, customer catalogue, order list/detail and dashboard endpoints each need explicit DTO projections. Keep existing aliases until all current frontend consumers are migrated.
6. Query/index verification: capture explain plans for top catalogue, inventory, order, audit and tenant queries; detect COLLSCAN, blocking SORT, N+1 patterns and unbounded reads.
7. Migration verification: run repository contract tests against each adapter and API contract tests against the same use cases. A database migration is not complete until data reconciliation, indexes/constraints, transaction semantics and rollback are verified.

## Performance guardrails

- Every collection/list endpoint must have a bounded page size and deterministic sort.
- Prefer cursor/keyset pagination for long-running histories; keep page-number pagination for existing UI contracts until clients are migrated.
- Use `select`/`project` to return only fields consumed by the view.
- Batch related lookups; do not issue one query per row.
- Use aggregation for server-side filtering/counting/pagination when it avoids loading full collections into application memory.
- Cache only derived, non-authoritative reads with explicit invalidation/TTL. Never cache stock availability or authorization decisions without a consistency design.
- Use lean/plain read models for read-only operations.
- Keep tenant and branch predicates in every repository query, not only in route middleware.
- Measure query latency, documents examined, keys examined, response bytes and service memory before/after. Do not claim speedup without measurements.

## Rollout

The changes in this pass are backward-compatible at the HTTP response level and require no environment variable or data migration. New indexes are created by the existing Mongoose model initialization on service startup. Review index build impact on a populated database before production rollout.
