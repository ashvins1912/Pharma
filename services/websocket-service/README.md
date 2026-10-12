# Pharma WebSocket Service

Independent Node.js + Socket.IO service. It uses the authenticated shared cache HTTP API; Redis Streams carries API events to this process. It does not import backend in-process state.

## Deployed service

The current Render WebSocket URL supplied for this integration is `https://websockt.onrender.com`. The health route is `GET /healthz` (not `/helathz`, which is a spelling error).

## Local run

Run from the repository root after `npm install`. Set `CACHE_SERVICE_URL`, `CACHE_SERVICE_TOKEN`, and the same `PHARMA_JWT_PUBLIC_KEY` used by the backend. Then start with:

```bash
CORS_ALLOWED_ORIGINS=http://localhost:5173 npm --workspace services/websocket-service start
```

## Health and heartbeat

- `GET /healthz` or `GET /health`: process health, active connections, heartbeat telemetry, and whether JWT verification is configured.
- `GET /ready`: in production it is not ready until the Pharma public key is configured.
- Socket.IO transport ping interval defaults to 25 seconds; timeout defaults to 20 seconds.
- Application heartbeat emits `server_heartbeat` every 25 seconds.

## Security and event routing

Clients connect using `auth: { token: <Pharma RS256 access token> }`. The service verifies signature, issuer, audience, and `token_type=pharma_access`. Browser-supplied user and tenant IDs are not treated as identity; room joins are checked against verified claims.

- User bell events are restricted to the authenticated user.
- Tenant events are restricted to the authenticated tenant.
- Fulfillment events are routed to authorized user/tenant/order rooms.
- Events without an explicit audience are dropped; they are never globally broadcast.
- The UI uses Socket.IO to update bell notifications, medicine requests, and order views. WhatsApp status events contain only status metadata—never recipient phone numbers or message bodies.

## Render environment

Set on the deployed `websockt` service:
- `NODE_ENV=production`
- `CORS_ALLOWED_ORIGINS=https://pharma-ui.onrender.com` (exact browser origins only)
- `CACHE_SERVICE_URL=https://caching-v0et.onrender.com`
- `CACHE_SERVICE_TOKEN`: the same random secret configured on the cache and API (minimum 32 characters)
- `PHARMA_JWT_PUBLIC_KEY`: the backend RS256 public key, with PEM newlines preserved or escaped as `\\n`
- `PHARMA_JWT_ISSUER=pharma-auth`
- `PHARMA_JWT_AUDIENCE=pharma-api`

Do not expose the cache token or JWT private key to the browser. Do not set a fixed `PORT`; Render injects it. Redeploy this service from the repository-root build so it includes `packages/shared-cache` and `services/websocket-service/src/sharedEvents.js`.
