# Architecture

## Current deployment shape

```text
Browser
  ├── Vite frontend (`frontend/`)
  │     └── `/api/*` HTTP requests through the shared API client
  └── API Gateway (`api-gateway/`)
        ├── legacy API routes → Backend (`backend/`)
        ├── `/api/v1/inventory` → Inventory Service when configured
        └── `/api/v1/orders` → Order Service when configured

API Gateway ── short-lived user identity verification ──> Backend
API Gateway ── scoped service JWT ──> Inventory / Order Services

Inventory Service (`services/inventory-service/`) → Inventory MongoDB
Order Service (`services/order-service/`) → Order MongoDB
Order Service ── service JWT / HTTP ──> Inventory Service
```

The independent public Gateway in `api-gateway/` routes legacy requests to
the backend and, when configured, routes versioned Order/Inventory requests
directly to those services. The root compatibility deployment still combines
the frontend and backend. Medicine Request/Proposal, Rider/Delivery,
WhatsApp/notification, and most inventory/order workflows remain modules in
the backend. The extracted services do not yet own all live workflows. This
is an initial development restructuring: no production data migration, dual
writes, or legacy synchronization is required.

## Project boundaries

- `frontend/`: independently buildable Vite/React app; browser-safe config and
  HTTP API clients only.
- `backend/`: Express API, user authentication and identity verification,
  database access, and legacy business modules.
- `api-gateway/`: public CORS boundary, service authentication/authorization,
  request IDs, and HTTP routing.
- `services/inventory-service/`: extracted inventory API and dedicated
  Inventory database.
- `services/order-service/`: extracted versioned Order API and dedicated Order
  database; Inventory accessed only over the Inventory API.
- `api/`: Vercel adapter for the Express backend.

Medicine Request/Proposal, rider/delivery, notifications, and product
discovery are not represented by empty service directories because they have
not been independently extracted.
