# Inventory Service boundary

Inventory Service owns tenant- and branch-scoped operational data: products, stock, batches, reservations, stock adjustments, inventory audit, and staged stock imports.

## Medicine Master integration

Inventory does not own or serve the shared Medicine Master catalogue. It must not mount catalogue routes, run catalogue import/reconciliation workers, or resolve medicine matches.

The only Medicine Master integration retained here is `src/medicine-match-queue.js`. Product create/update flows call `queueMedicineMatch` to enqueue an idempotent identity reference in the shared MongoDB `MedicineMatchReference` collection. The private Medicine Master Service owns resolution, matching workers, and cache invalidation.

Both services currently use the same MongoDB URI and `pharma_inventory` database to preserve existing collections and avoid a migration. Keep queue schema and identity normalization compatible until the queue is moved behind a dedicated internal API or shared versioned package.

## Security and deployment

- Keep Inventory Service private; API Gateway is its supported caller.
- Keep `SERVICE_AUTH_SECRET`, issuer, and audience aligned with API Gateway.
- Keep MongoDB credentials in Render secret environment variables only.
- Do not add Medicine Master credentials or catalogue mutation capabilities to Inventory.
- Verify Inventory readiness, stock operations, staged import publishing, and match-queue enqueueing independently of Medicine Master catalogue APIs.
