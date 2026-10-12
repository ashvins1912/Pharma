import os
import json
import logging
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field
import redis.asyncio as aioredis

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("caching-services")

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
PORT = int(os.getenv("PORT", "8080"))

# Global redis connection reference
redis_client: Optional[aioredis.Redis] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    logger.info("Initializing Redis connection pool at %s", REDIS_URL)
    redis_client = aioredis.from_url(
        REDIS_URL,
        decode_responses=True,
        max_connections=50,
        socket_timeout=2.0,
        socket_connect_timeout=2.0,
    )
    try:
        await redis_client.ping()
        logger.info("Redis connection established successfully.")
    except Exception as e:
        logger.warning("Initial Redis ping failed: %s (will retry on health checks)", e)
    
    yield

    logger.info("Closing Redis connection pool.")
    if redis_client:
        await redis_client.aclose()


app = FastAPI(
    title="caching-services",
    description="Internal High-Performance In-Memory Redis Microservice for Render",
    version="1.0.0",
    lifespan=lifespan,
)


class CacheSetPayload(BaseModel):
    key: str = Field(..., min_length=1, description="Unique cache key")
    value: Any = Field(..., description="Data payload to cache (primitives, dicts, lists)")
    ttlSeconds: Optional[int] = Field(default=3600, ge=1, description="Time-to-live in seconds")


@app.get("/health", status_code=status.HTTP_200_OK)
async def health():
    """
    Render health check probe endpoint.
    Verifies that FastAPI is running and the underlying Redis engine responds to PING.
    """
    if not redis_client:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis client not initialized"
        )
    try:
        is_alive = await redis_client.ping()
        if not is_alive:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Redis ping returned non-truthy response"
            )
        return {"status": "healthy"}
    except Exception as exc:
        logger.error("Health probe failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Service unhealthy: {str(exc)}"
        )


@app.post("/set", status_code=status.HTTP_200_OK)
async def set_cache(payload: CacheSetPayload):
    """
    Persists key-value pairs into Redis with automatic JSON serialization and TTL enforcement.
    """
    if not redis_client:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis client unavailable"
        )

    try:
        # Transparently serialize composite objects (dict, list) to JSON strings
        if isinstance(payload.value, (dict, list)):
            stored_val = json.dumps(payload.value, separators=(",", ":"))
        elif isinstance(payload.value, (str, int, float, bool)):
            stored_val = json.dumps(payload.value)
        else:
            stored_val = str(payload.value)

        ttl = payload.ttlSeconds if payload.ttlSeconds is not None else 3600
        await redis_client.set(name=payload.key, value=stored_val, ex=ttl)
        return {"status": "ok", "key": payload.key, "ttlSeconds": ttl}
    except Exception as exc:
        logger.error("Failed to set key '%s': %s", payload.key, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Cache write error: {str(exc)}"
        )


@app.get("/get/{key}", status_code=status.HTTP_200_OK)
async def get_cache(key: str):
    """
    Retrieves key from Redis. Deserializes JSON strings to native data structures.
    Returns:
      Hit:  {"status": "hit", "data": <deserialized_data>}
      Miss: {"status": "miss", "data": None}
    """
    if not redis_client:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis client unavailable"
        )

    try:
        raw_val = await redis_client.get(name=key)
        if raw_val is None:
            return {"status": "miss", "data": None}

        try:
            parsed = json.loads(raw_val)
            return {"status": "hit", "data": parsed}
        except (json.JSONDecodeError, TypeError):
            return {"status": "hit", "data": raw_val}
    except Exception as exc:
        logger.error("Failed to read key '%s': %s", key, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Cache read error: {str(exc)}"
        )


@app.delete("/del/{key}", status_code=status.HTTP_200_OK)
async def delete_cache(key: str):
    """
    Utility endpoint to invalidate specific cache entries on demand.
    """
    if not redis_client:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis client unavailable"
        )

    try:
        deleted = await redis_client.delete(key)
        return {"status": "ok", "deleted": bool(deleted)}
    except Exception as exc:
        logger.error("Failed to delete key '%s': %s", key, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Cache delete error: {str(exc)}"
        )
