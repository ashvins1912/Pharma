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
