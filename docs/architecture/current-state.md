# Existing application flows and boundaries

## Dependency findings

- Frontend entrypoints: `index.html`, `src/main.jsx`, and the root Vite config;
  now organized under `frontend/`.
- Frontend pages/components, app/auth/toast state, API clients, Supabase browser
  client, and Vite environment validation are browser code.
- The existing shared Axios client centralizes auth headers, CSRF headers,
  timeout, credentials, and API errors. Existing feature-specific API modules
  build on it.
- Backend entrypoints: `backend/server.js` (Express app), root `server.ts`
  (combined Vite/API runner), and `api/[...path].js` (Vercel API adapter).
- Backend owns Mongo/Mongoose models and access, authentication validation,
  prescription GridFS storage, inventory imports, Order checkout/lifecycle,
  Medicine Request/Proposal, riders/delivery, WhatsApp, and admin APIs.
- Frontend imports from backend or extracted-service implementation files:
  none found during the source import audit.
- Backend imports from frontend: none. The root compatibility runner serves
  frontend assets but the backend API package itself does not require them.
- Existing web checkout still uses `/api/orders/checkout`; the optional
  versioned Order Service path is separate and does not yet replace that route.
- Uploads (prescriptions and inventory spreadsheets) go through backend API
  handlers; no frontend filesystem access was found.

## Current data/behavior flows

```text
Web → /api/orders/checkout → backend reserveOrder → main MongoDB
Web → /api/medicines → backend catalog; search impressions → daily metric model
Backend startup/15 min → refresh data mart from medicines + delivered orders + search metrics
Web → /api/medicines/discovery → ProductDiscoveryService → MedicineDataMart
```

The root compatibility deployment remains available. The `frontend/`,
`api-gateway/`, and `backend/` projects run independently; the Gateway routes
legacy traffic to the private backend and configured versioned APIs directly
to Inventory/Order services. The extracted services do not yet own every live
workflow.

## Required follow-up before full acceptance

- Install and run each project independently from a clean checkout.
- Configure separate frontend/backend deployment origins and verify CORS,
  authentication cookies, file uploads, and every critical operational flow.
- Complete direct development-time ownership changes so Inventory and Order
  workflows use their service APIs; no production data migration or dual-write
  process is required.
- Continue migrating legacy `/api/*` routes to versioned public contracts
  without breaking existing UI clients.
- Add end-to-end browser/API tests for login, checkout, prescription upload,
  Medicine Request → Proposal → Order, imports, rider assignment, dispatch,
  delivery, WhatsApp, and failure behavior.
