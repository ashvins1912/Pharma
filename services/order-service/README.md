# Order Service

The canonical standalone Order Service. It owns Order records, price/item
snapshots, idempotency, order lifecycle, fulfillment gates, and Order events.

## Run locally

```bash
cd services/order-service
npm install
cp .env.example .env
npm run dev
```

The service listens on port `5200` by default.

It requires:
- a dedicated Order MongoDB database;
- Inventory Service URL;
- Prescription Service URL for prescription verification;
- the shared service-auth secret.

The Order Service never imports Inventory or Prescription implementation code.
It calls both services over authenticated HTTP.

## Deployment

Use the colocated `render.yaml`. The service is a Render Private Service.
The public API Gateway routes `/api/v1/orders/*` here.

Browser clients never receive the Order Service URL or service JWT.

## Prescription behavior

Prescription verification is performed against the canonical Python
Prescription Service. Orders remain blocked from fulfillment until required
prescription medicines are matched.
