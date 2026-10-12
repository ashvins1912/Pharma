# Pharma WebSocket Service

Independent Node.js + Socket.IO service. It uses the same authenticated shared cache HTTP API as the backend; Redis Streams carries API events to this process. It does not import backend in-process state.

## Local run

Run from the repository root after `npm install`. Set `CACHE_SERVICE_URL`, `CACHE_SERVICE_TOKEN`, and the same `PHARMA_JWT_PUBLIC_KEY` used by the backend. Then start with:

```bash
CORS_ALLOWED_ORIGINS=http://localhost:5173 npm --workspace services/websocket-service start
```

The service binds to `0.0.0.0` and uses Render's `PORT` when provided.

## Endpoints and heartbeat

- `GET /healthz` or `GET /health`: process health, active connections, heartbeat telemetry, and whether JWT verification is configured.
- `GET /ready`: readiness for deployment checks. In production it is not ready until the Pharma public key is configured.
- Socket.IO transport ping interval defaults to 25 seconds; timeout defaults to 20 seconds.
- Application heartbeat emits `server_heartbeat` every 25 seconds; clients can emit `heartbeat` and receive `heartbeat_ack`.

## Authentication and rooms

Clients must connect with `auth: { token: <Pharma RS256 access token> }`. The service verifies the token signature, issuer, audience, and `token_type=pharma_access`. It does not accept a browser-supplied user or tenant ID as identity.

- User notification rooms are limited to the authenticated user, unless an elevated platform role is verified.
- Tenant rooms are limited to the authenticated tenant, unless an elevated platform role is verified.
- Order tracking requires the order ID in verified `orderIds` claims or the `orders.read.all` permission.
- Location updates require a verified rider identity and rider/delivery role.

Do not expose the cache service token or the JWT private key to the browser. Only the JWT access token belongs in the Socket.IO handshake.

## Shared cache/event stream

Set the same `CACHE_SERVICE_URL=http://ashvin-pharma-shared-cache:8080` and `CACHE_SERVICE_TOKEN` on the backend and WebSocket service. The backend publishes domain notifications to the shared Redis Stream; the WebSocket consumer long-polls it and persists its cursor after delivery. If the WebSocket process restarts, unacknowledged events can be delivered again, so client handlers should be idempotent.

The cache service is an independent deployment. If it is unavailable, the WebSocket process remains running and retries event consumption; cross-service events pause until it recovers.

## Render

The service must build from the repository root so it can import `packages/shared-cache`:

- Build: `npm install`
- Start: `npm --workspace services/websocket-service start`
- Health check: `/healthz`

Set:
- `NODE_ENV=production`
- `CORS_ALLOWED_ORIGINS=https://pharma-ui.onrender.com` (comma-separated exact browser origins)
- `CACHE_SERVICE_URL=http://ashvin-pharma-shared-cache:8080`
- `CACHE_SERVICE_TOKEN`: the exact same random secret as on the cache and backend API services (minimum 32 characters)
- `PHARMA_JWT_PUBLIC_KEY`: same RS256 public key as backend, with PEM newlines preserved or escaped as `\\n`
- `PHARMA_JWT_ISSUER=pharma-auth`
- `PHARMA_JWT_AUDIENCE=pharma-api`

Do not set a fixed `PORT`; Render injects it.
