# API Gateway

The independently runnable API Gateway is the browser/mobile/external-client
entry point. It enforces environment-configured CORS, assigns request and
correlation IDs, and proxies legacy API traffic to the private backend API.
When Order or Inventory Service URLs are configured, it authenticates the
user through the backend's private identity endpoint, applies Gateway
authorization, mints a short-lived scoped service JWT, and routes requests
directly to the selected service. It streams request and response bodies,
including multipart uploads, without buffering them.

Run locally with:

```bash
npm install
npm run dev
```

Configure `BACKEND_API_URL` to the private backend origin and
`CORS_ALLOWED_ORIGINS` to exact origins. Production requires both configuration
values, requires HTTPS CORS origins, and never uses a wildcard. Production
also requires `GATEWAY_AUTH_SECRET`. Requests without an Origin header are
allowed. Health and readiness endpoints are `/health` and `/ready`.

For Render, use `api-gateway/render.yaml` as a blueprint. Set
`BACKEND_API_URL` to the backend's private-network URL; do not point it at a
publicly exposed service when the platform supports private services. Configure
the public frontend origins in `CORS_ALLOWED_ORIGINS`.

Set `GATEWAY_AUTH_SECRET` identically on the Gateway and backend. It protects
the Gateway-only identity-verification endpoint; the backend remains the
authority for the existing Supabase, demo, and MFA-aware user token validation.
Set a separate `SERVICE_AUTH_SECRET` identically on the Gateway and the
Inventory/Order services. The Gateway signs scoped service JWTs with a
60-second lifetime; user cookies and user bearer tokens are never forwarded
to those services.

The services independently validate Gateway identity, token audience,
expiration, and operation scope. Administrator authorization for Inventory
adjustments/imports and Order status changes is enforced before service
requests. If `ORDER_SERVICE_URL` is unset, versioned Order requests continue
to the backend's existing versioned implementation. Inventory returns a
controlled unavailable response until its service URL is configured. Rate
limiting, partner API credentials, and independent Medicine Request, Delivery,
or Notification services are not implemented by this proxy.
