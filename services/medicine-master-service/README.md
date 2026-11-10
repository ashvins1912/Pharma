# Medicine Master Service

Owns the shared Medicine Master catalogue, import/reconciliation batches, catalogue audit history, GridFS upload files, and persistent medicine-match reference processing.

## Data compatibility

The initial deployment deliberately uses the existing Inventory MongoDB database. Set `MEDICINE_MASTER_MONGO_URI` to the **same connection string** as Inventory Service's `INVENTORY_MONGO_URI`, and set `MEDICINE_MASTER_DB_NAME=pharma_inventory` (or the exact current `INVENTORY_DB_NAME`). No collection rename or data migration is performed. Existing MedicineMaster, catalogue import, audit, GridFS, and MedicineMatchReference collections remain in place.

Only this service starts the catalogue-import and medicine-match workers after its database connection and indexes are ready. Inventory Service continues to enqueue product identity changes into the shared MedicineMatchReference collection; it no longer runs the match worker or serves Medicine Master endpoints.

## Runtime configuration

- `MEDICINE_MASTER_MONGO_URI`: same MongoDB URI used by Inventory Service (required).
- `MEDICINE_MASTER_DB_NAME`: existing database name; defaults to `pharma_inventory`.
- `SERVICE_AUTH_SECRET`: same gateway/service signing secret (minimum 32 characters).
- `SERVICE_JWT_ISSUER`: same issuer configured in API Gateway.
- `MEDICINE_MASTER_SERVICE_JWT_AUDIENCE`: `medicine-master-service`.
- `PORT`: supplied by Render.

## Health

- `GET /health`: process liveness.
- `GET /ready`: MongoDB readiness.

Deploy the private service first. Set `MEDICINE_MASTER_SERVICE_URL` in API Gateway to its Render private-network URL (for example `http://ashvin-pharmacy-medicine-master:10000`) and keep the configured JWT audience as `medicine-master-service`. Set `MEDICINE_MASTER_MONGO_URI` to the exact same MongoDB URI currently configured as Inventory Service's `INVENTORY_MONGO_URI`. Do not use a different database. Then deploy API Gateway and Inventory Service from this branch. This branch keeps the public API paths unchanged.
