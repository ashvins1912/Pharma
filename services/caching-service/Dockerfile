# Ultra-lightweight multi-process container for Render Free Tier (Redis 7 + FastAPI)
FROM python:3.11-alpine

# Install Redis Server 7.x natively via Alpine package manager
RUN apk add --no-cache redis curl

WORKDIR /app

# Copy dependency definition and install without caching wheels
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy configuration and application source
COPY redis.conf /usr/local/etc/redis/redis.conf
COPY server.py .

# Healthcheck configuration for container runtimes
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:8080/health || exit 1

EXPOSE 8080

# Dual-process sequence:
# 1. Daemonize redis-server in background with optimized 150MB LRU config
# 2. Exec uvicorn in foreground as PID 1 to gracefully capture termination signals
CMD ["sh", "-c", "redis-server /usr/local/etc/redis/redis.conf --daemonize yes && exec uvicorn server:app --host 0.0.0.0 --port 8080 --workers 1"]
