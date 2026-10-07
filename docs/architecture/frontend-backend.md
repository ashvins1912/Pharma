# Frontend and backend separation

## Frontend

The only frontend is `frontend/`.

```bash
cd frontend
npm install
npm run dev
npm run build
```

All browser HTTP calls use the shared API client and go to the public API Gateway. The frontend must not import backend modules, service implementation files, database models or private secrets.

## API Gateway

The only browser-facing API boundary. It enforces CORS, assigns request/correlation IDs, authenticates the user through the private backend identity boundary, mints short-lived scoped service JWTs, and routes authoritative versioned APIs to private services.

## Backend

The backend is a private Express platform service. It does not serve frontend assets. It owns remaining compound workflows and authorization boundaries such as Customer/Person/PUID and Medicine Request.

## Domain services

Each standalone service under `services/` has its own runtime, environment configuration, deployment file, health endpoint and persistence boundary. Services communicate over HTTP and never import another service's implementation.

## Deployment

Public: Frontend and API Gateway. Private: Backend, Inventory, Order and Prescription API. Background worker: Prescription Worker.