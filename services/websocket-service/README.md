# Pharma WebSocket Service

A standalone Node.js + Socket.IO service. It is deployed independently from the API and API Gateway from this directory, and does not import the backend's in-process cache.

## Local run

```bash
npm install
CORS_ALLOWED_ORIGINS=http://localhost:5173 npm start
```

The service binds to `0.0.0.0` and uses Render's `PORT` when provided.

## Endpoints

- `GET /healthz` or `GET /health`: process health, active connections, and heartbeat telemetry.
- `GET /ready`: readiness for load balancers and deployment checks.
- Socket.IO transport heartbeat: ping every `WS_PING_INTERVAL_MS` (default 25 seconds), disconnect timeout `WS_PING_TIMEOUT_MS` (default 20 seconds).
- Application heartbeat: emits `server_heartbeat` every `WS_HEARTBEAT_INTERVAL_MS` (default 25 seconds). Clients can emit `heartbeat` and receive `heartbeat_ack`.

## Render

Deploy as a Node web service with root directory `services/websocket-service`, build command `npm install --workspaces=false`, start command `npm start`, and health check path `/healthz`.

Set:
- `NODE_ENV=production`
- `CORS_ALLOWED_ORIGINS=https://pharma-ui.onrender.com` (comma-separated exact browser origins)
- Optional: `WS_HEARTBEAT_INTERVAL_MS=25000`, `WS_PING_INTERVAL_MS=25000`, `WS_PING_TIMEOUT_MS=20000`

Do not set a fixed `PORT`; Render injects it.

## Gateway monitoring

Set `WEBSOCKET_SERVICE_URL` on the API Gateway to the WebSocket service's private URL, for example `http://ashvin-pharma-websocket:10000` when both services are on the same Render private network. The Gateway health monitor probes `/healthz` and includes the WebSocket status in `GET /health` and the admin-only service health snapshot.

The browser should connect to the public service URL using Socket.IO; the Gateway's internal health check URL is separate from the browser URL.

## Compatibility events

- `join_rider_room`
- `join_order_tracking`
- `join_bell_room`
- `update_location` -> `location_changed`
- `server_heartbeat`, `heartbeat`, and `heartbeat_ack`

Room-join authorization should be enforced with verified user identity before exposing sensitive production events. This extraction preserves the existing event names but does not yet migrate backend notification publishing or shared-cache/pub-sub into this service.
