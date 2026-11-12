# API Gateway

The standalone Express Gateway in `api-gateway/` is the public HTTP entrypoint.
It validates browser origins, handles preflight, and assigns
request/correlation IDs. Legacy `/api/*` requests are streamed to the private
Express application in `backend/`. For configured Order and Inventory
services, the Gateway asks the backend to validate the existing user token,
applies Gateway authorization, and issues a short-lived scoped service JWT.
User credentials are not sent to those services.

When configured, Gateway routes send authenticated requests directly to
services with short-lived server-signed service JWTs:

- `/api/v1/inventory` → Inventory Service (`INVENTORY_SERVICE_URL`)
- `/api/v1/orders` → Order Service (`ORDER_SERVICE_URL`)

When `ORDER_SERVICE_URL` is unset, `/api/v1/orders` falls through to the
backend's existing versioned implementation. Inventory returns a controlled
503 until its service URL is configured. `GATEWAY_AUTH_SECRET` is shared only
between Gateway and backend for protected identity verification;
`SERVICE_AUTH_SECRET` is shared only between Gateway and internal services.
Browser requests must not call service origins directly.

For local development, Vite runs on port 3000, the Gateway on port 8080, and
the backend on port 8090. The Vite development proxy forwards `/api` to the
Gateway; the Gateway forwards to the backend.
Configure `CORS_ALLOWED_ORIGINS` as a comma-separated list of exact origins.
Production requires the setting and accepts HTTPS origins only; there is no
wildcard fallback. Development defaults to localhost ports 3000 and 5173.
Requests without an `Origin` header are allowed. CORS preflight is handled
before route authentication and returns the configured methods/headers and
credential policy.

Rejected origins return a controlled `403` JSON error with
`CORS_ORIGIN_NOT_ALLOWED` and a request ID; only the request ID and rejected
origin are logged. Reverse proxies must preserve the browser's `Origin` header
to the gateway and must not add a competing CORS policy.

The Gateway is independently runnable and exposes `/health` and `/ready`.
The readiness probe checks backend readiness. Partner OAuth/API keys,
centralized rate limiting, and all-route API versioning remain future work.
