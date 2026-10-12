# Pharma Shared Cache Service

This independent service backs the Pharma Node shared-cache adapter and the API-to-Socket.IO event stream.

## Deployed service

The current Render service URL supplied for this integration is `https://caching-v0et.onrender.com`. The health probe is `GET /health`. The health probe is intentionally unauthenticated; cache and event operations require `X-Cache-Service-Token`.

## Required environment on the cache service

- `PORT=8080`
- `REDIS_URL=redis://127.0.0.1:6379/0`
- `CACHE_SERVICE_TOKEN`: a cryptographically random secret with at least 32 characters.
- `CACHE_EVENT_STREAM_MAXLEN=10000` (optional).

Set the exact same `CACHE_SERVICE_TOKEN` on the backend API and WebSocket service. Never expose this token to Vite or a browser.

## Architecture and endpoints

- FastAPI exposes cache operations; Redis stores values with TTL.
- Redis Streams carries events between the API and independent Socket.IO process.
- Redis binds to loopback inside this container. Other services communicate through authenticated HTTPS endpoints, not Redis directly.
- `GET /health` — Redis and internal-token configuration health.
- `GET /v1/cache?key=...` — cache read.
- `POST /v1/cache` — body `{"key":"catalog:all","value":[],"ttlSeconds":15}`.
- `DELETE /v1/cache?key=...` — invalidation.
- `POST /v1/events` — publish a scoped event.
- `GET /v1/events/cursor`, `GET /v1/events/poll`, and `POST /v1/events/ack` — stream consumption and cursor persistence.

The existing Render service must be redeployed with this repository's `services/caching-service` code for these versioned endpoints to exist. A successful `/health` alone does not prove the event API is deployed.

## Local run

```bash
docker build -t pharma-shared-cache services/caching-service
docker run --rm -p 8080:8080 -e PORT=8080 -e CACHE_SERVICE_TOKEN="$(openssl rand -hex 32)" pharma-shared-cache
```
