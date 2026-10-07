# Inventory Service

The canonical standalone Inventory Service. It owns product metadata, stock,
reservations, adjustments, imports, failures, and inventory audit records.

## Run locally

```bash
cd services/inventory-service
npm install
cp .env.example .env
npm run dev
```

The service listens on port `5100` by default.

Required configuration:

```text
INVENTORY_MONGO_URI=mongodb://localhost:27017
INVENTORY_DB_NAME=pharma_inventory
SERVICE_AUTH_SECRET=<shared private service secret>
SERVICE_JWT_ISSUER=ashvin-pharmacy
SERVICE_JWT_AUDIENCE=inventory-service
```

MongoDB transactions are required for reservation/import consistency.

## Deployment

Use the colocated `render.yaml`. The service is a Render Private Service.
The public API Gateway calls it over the private network with a short-lived
service JWT.

Never expose service credentials or this service URL to the browser.

## Ownership

No second Inventory implementation exists under `backend/`. Legacy backend
workflows that have not yet migrated should call Inventory over HTTP rather
than importing Inventory implementation files.
