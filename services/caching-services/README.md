# Caching Services Microservice

Production-grade in-memory caching microservice tailored for Render's Free Tier constraints. It encapsulates Redis 7 and an async FastAPI REST gateway inside a single lightweight Docker container (< 80MB image).

## Key Architecture & Memory Boundaries
- **512MB Render Hard Ceiling**: Redis configured with `maxmemory 150mb` and `maxmemory-policy allkeys-lru`.
- **Zero Disk Overhead**: Disk snapshotting disabled (`save ""`, `appendonly no`).
- **Single Container Dual-Process**: Redis daemon runs in the background on localhost:6379; FastAPI runs as PID 1 on 0.0.0.0:8080.
- **Fail-Safe HTTP Client**: Enforces 3s maximum timeout (1s connect, 2s read) with silent fallback to database miss.

## Local Testing with Docker Compose
```bash
cd services/caching-services
docker compose up --build
```

Test endpoints:
```bash
# Health check
curl http://localhost:8080/health

# Set a key
curl -X POST http://localhost:8080/set \
  -H "Content-Type: application/json" \
  -d '{"key": "user:123", "value": {"name": "Alice", "role": "admin"}, "ttlSeconds": 300}'

# Get key
curl http://localhost:8080/get/user:123
```
