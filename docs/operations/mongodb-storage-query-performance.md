# MongoDB storage and query performance

## Scope and safety

This repository uses separate MongoDB connections for the legacy backend, inventory, medicine-master and order services. Inventory and medicine-master default to the same `pharma_inventory` database; their connection pools therefore add together. The legacy backend previously used the MongoDB driver's default pool ceiling, while the three dedicated services each configured a pool ceiling of 20.

This optimization keeps each service's pool bounded and configurable. It does not change collection ownership, tenant/branch predicates, write semantics, transaction boundaries, or API response contracts.

## Changes in this release

- All four MongoDB clients use `MONGO_MAX_POOL_SIZE`, default 10, validated from 2 to 50.
- Dedicated services set `minPoolSize: 0` and `maxIdleTimeMS: 30000` so idle connections can drain instead of remaining open indefinitely.
- The legacy backend now uses the same bounded pool policy.
- Medicine data-mart refresh only transitions stale records that are currently active to inactive. Previously already-inactive records were rewritten every 15 minutes, updating `refreshId` and `metricsComputedAt` repeatedly. The new update is idempotent and avoids that recurring write amplification.

Set `MONGO_MAX_POOL_SIZE` consistently on Render services sharing the same MongoDB cluster. Start with 10; increase only after measuring connection wait time and database connection limits. The value is per process/service, not a cluster-wide total.

## Existing query/index observations

### Inventory

- Product catalogue indexes are tenant-scoped and cover active/name, category/name and prescription/name sort paths.
- Stock indexes cover tenant + branch + product + batch uniqueness and expiry ordering.
- Import job, batch, snapshot and failure collections have tenant/branch scoped indexes.
- Do not add indexes to every filter automatically: each additional index consumes storage and increases insert/update cost. Validate actual query plans first.

### Orders

- Order queries have several legacy and service-owned schemas. Some duplicate fields/status representations are compatibility fields and must not be removed until all callers and migrations are mapped.
- The data-mart's delivered-order aggregation filters by `orderStatus` and `createdAt`; the legacy Order schema already declares an `orderStatus + createdAt` index.
- Preserve idempotency and partial unique indexes. Never replace them with non-unique indexes as a space-saving measure.

### Daily metrics and data mart

- Daily metrics have a unique `skuId + metricDate` index and a `metricDate + skuId` index for date-range aggregation.
- The data mart has category, active, price-tier, velocity, pair lookup and text-search indexes. These improve discovery but have a measurable storage/write cost; remove only after explain-plan and usage evidence shows an index is redundant.
- Data mart refresh currently reads a bounded 30-day order window and uses bulk writes for output. Keep this behavior until equivalence tests prove a narrower incremental refresh produces identical metrics.

### Audit, notifications and events

- Activity audit, notification and delivery event collections are operational/history data. They can grow continuously.
- No TTL policy is added automatically: deleting records can violate audit, financial, delivery, prescription or customer-support requirements.
- Establish retention periods with the business/compliance owner first. Then archive eligible records and apply TTL only to explicitly approved ephemeral collections (for example, expired one-time nonces, which already have a TTL index).

## Safe database maintenance procedure

1. Take a verified backup/snapshot before index or retention migrations.
2. Capture collection stats, index sizes, document counts and MongoDB Atlas/cluster connection metrics.
3. Run `explain("executionStats")` on representative high-volume queries with real tenant/branch predicates.
4. Compare `totalKeysExamined`, `totalDocsExamined`, `nReturned`, execution time and winning plan before/after.
5. Add one compound index at a time, ordered by equality predicates, sort keys, then range predicates where appropriate.
6. Check index build impact and duplicate-key failures before enforcing uniqueness.
7. Archive before deleting. Keep financial, prescription, order and audit retention policies explicit.
8. Re-run repository tests, tenant-isolation tests and service integration tests before deployment.

## Next measurement-led work

- Add query-duration and examined/returned document telemetry for the highest-volume catalogue, order, notification and audit queries without logging personal or prescription data.
- Capture per-collection storage/index-size snapshots and identify oversized documents.
- Review pagination for unbounded `find()`, deep `skip()`, and unrestricted `populate()`; migrate to stable cursor pagination only where the endpoint contract can preserve page semantics.
- Review order and prescription snapshots for duplicate historical fields. Compact only after consumers are mapped and a migration/backfill plus compatibility tests exist.
- Consider archive/TTL for explicitly ephemeral import staging and delivery telemetry only after approved retention requirements and restore tests.
- Use aggregation projections early, `lean()` for read-only Mongoose queries, and `bulkWrite()` for independent batch updates. Preserve transaction and idempotency guarantees for stock and payments.

## Rollback

- Set `MONGO_MAX_POOL_SIZE` to the previous value (20 for dedicated services) if connection queueing or latency regresses.
- Revert the data-mart stale-record update change if a consumer is found to depend on inactive records receiving a refreshed `metricsComputedAt` timestamp.
- No data is deleted or migrated by this release.
