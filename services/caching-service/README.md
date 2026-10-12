# Pharma Shared Cache Service

This is the internal shared cache and event transport used by the backend API and independent Socket.IO service.

## Architecture

- FastAPI exposes internal cache operations; Redis stores values with TTL.
- Redis Streams carries cross-process events from the backend API to WebSocket service instances.
- Redis binds to loopback inside this container only. Other services connect to the authenticated HTTP API, never to Redis directly.
- `/health` is public for Render health checks. Cache and event endpoints require `X-Cache-Service-Token`.

## Required environment

- `PORT=8080`
- `REDIS_URL=redis://127.0.0.1:6379/0`
- `CACHE_SERVICE_TOKEN`: a randomly generated secret with at least 32 characters. Set the exact same value on the cache, backend API, and WebSocket services.
- API and WebSocket services: `CACHE_SERVICE_URL=http://ashvin-pharma-cache:8080`.

Do not expose `CACHE_SERVICE_TOKEN` to Vite or any browser bundle.

## Endpoints

- `GET /health` — Redis health probe.
- `GET /v1/cache?key=...` — cache read.
- `POST /v1/cache` — body `{"key":"catalog:all","value":[],"ttlSeconds":15}`.
- `DELETE /v1/cache?key=...` — invalidation.
- `POST /v1/events` — publish an event into the shared stream.
- `GET /v1/events/poll?cursor=$&blockMs=5000` — long-poll stream consumer.

All endpoints other than health/readiness require the internal token. Cache values are volatile and may be evicted; MongoDB remains the source of truth.

## Local run

```bash
docker build -t pharma-shared-cache services/caching-service
docker run --rm -p 8080:8080 -e PORT=8080 -e CACHE_SERVICE_TOKEN="$(openssl rand -hex 32)" pharma-shared-cache
```

For multi-service local development, pass the same token and reachable `CACHE_SERVICE_URL` to both backend and WebSocket processes.
