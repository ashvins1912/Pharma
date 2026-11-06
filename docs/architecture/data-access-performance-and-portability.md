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

### Indexes

`services/inventory-service/src/models.js` adds compound indexes for:
- tenant + active + name ordering;
- tenant + active + category + name ordering;
- tenant + active + prescription flag + name ordering;
- tenant + branch + product + expiry ordering for stock-batch lookup.

These are workload-aligned candidates. Validate them against production query plans and collection cardinality before adding more indexes; every extra index increases write and storage cost.

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
