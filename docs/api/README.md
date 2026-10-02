# API compatibility and versioning

The current browser continues using legacy compatibility endpoints under
`/api/*`; the public Gateway streams those requests to the backend. Versioned
Order and Inventory endpoints are routed to their services by the Gateway
when configured.

| Capability | Current browser/API route | Versioned gateway route |
| --- | --- | --- |
| Catalog and search | `/api/medicines` | Not fully extracted |
| Product discovery | `/api/medicines/discovery` | Not yet versioned |
| Order create/list/lifecycle | `/api/orders/*` | `/api/v1/orders` (Order Service when configured; backend fallback) |
| Inventory gateway | Existing `/api/medicines/*` admin/import APIs | `/api/v1/inventory` (Inventory Service when configured) |
| Medicine Request / Proposal | `/api/medicine-requests`, `/api/proposals` | Not yet versioned |
| Rider/delivery | `/api/admin/riders`, `/api/admin/assignment`, order routes | Not yet versioned |

The frontend calls the public API Gateway through
`frontend/src/api/apiClient.js`. The Vite development server proxies `/api` to
the Gateway. Do not expose internal service URLs or service tokens to the
browser. Use documented API DTOs and versioned routes for new clients; avoid
sharing Mongoose models or database identifiers as contracts.

The order v1 contract supports sources, external references, and idempotency.
The Inventory gateway is admin/user-facing only; reservation mutation is
service-to-service and is not proxied to browser clients.

## Render free tier deployment

For a low-traffic demo on Render's free tier, deploy the root compatibility app
as a single **Web Service**. It serves the browser build and `/api/*` routes in
one process, so the browser can use the same-origin API without exposing
internal service URLs. Do not deploy the API Gateway, backend, Order Service,
and Inventory Service as four always-on free services: free web services share
the workspace's monthly instance-hour allowance, and the separate backend
blueprint is a private service rather than a free public web service.

Configure the root service with:

| Render setting | Value |
| --- | --- |
| Root Directory | repository root |
| Build Command | `npm install --include=dev && npm run build` |
| Start Command | `./node_modules/.bin/tsx server.ts` |
| Health Check Path | `/api/v1/health` |

Set the required `MONGO_URI`, Supabase values, `ENCRYPTION_SECRET_KEY`, and
`CORS_ALLOWED_ORIGINS` in Render's Environment settings. Set
`CORS_ALLOWED_ORIGINS` to the exact deployed app origin. Keep demo access
disabled. Never put server secrets in `VITE_` variables.

The free tier currently provides 512 MiB RAM per web service, spins an idle
service down after 15 minutes, and does not support persistent disks. The root
`render.yaml` blueprint attaches a disk for WhatsApp credentials, so it is for
a paid instance; create the free web service from the Dashboard without that
disk. Local files, including WhatsApp linked-device credentials, are lost when
the free service restarts or spins down. WhatsApp pairing may need to be
repeated, so do not rely on this setup for dependable notifications. Free
services also have cold starts and are suitable for demos, not production.

The free instance-hour allowance is shared across the workspace. Keep only the
services needed for the demo running, and check Render's current limits before
deployment because plan details can change: [Render free services](https://render.com/docs/free)
and [Render compute plans](https://render.com/docs/compute-plans).
