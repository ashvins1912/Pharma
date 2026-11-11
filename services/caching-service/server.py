import hmac
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
import redis.asyncio as aioredis

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("pharma-shared-cache")
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
PORT = int(os.getenv("PORT", "8080"))
CACHE_SERVICE_TOKEN = os.getenv("CACHE_SERVICE_TOKEN", "")
EVENT_STREAM = "pharma:shared-events"
MAX_STREAM_LENGTH = int(os.getenv("CACHE_EVENT_STREAM_MAXLEN", "10000"))
EVENT_CURSOR_KEY = "pharma:shared-events:websocket-cursor"
redis_client: Optional[aioredis.Redis] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    redis_client = aioredis.from_url(
        REDIS_URL, decode_responses=True, max_connections=50,
        socket_timeout=3.0, socket_connect_timeout=3.0,
    )
    try:
        await redis_client.ping()
        logger.info("Redis connection established")
    except Exception:
        logger.exception("Redis unavailable during startup")
    yield
    if redis_client:
        await redis_client.aclose()


app = FastAPI(
    title="Pharma Shared Cache",
    description="Internal Redis cache and event stream for API and WebSocket services",
    version="2.0.0",
    lifespan=lifespan,
)


class CacheSetPayload(BaseModel):
    key: str = Field(..., min_length=1, max_length=512)
    value: Any
    ttlSeconds: int = Field(default=3600, ge=1, le=2592000)


class EventPayload(BaseModel):
    channel: str = Field(..., min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9:_-]+$")
    payload: Any
    userId: Optional[str] = Field(default=None, max_length=128)
    tenantId: Optional[str] = Field(default=None, max_length=128)
    riderId: Optional[str] = Field(default=None, max_length=128)


def require_internal_token(x_cache_service_token: Optional[str]) -> None:
    if not CACHE_SERVICE_TOKEN or len(CACHE_SERVICE_TOKEN) < 32:
        raise HTTPException(status_code=503, detail="Internal cache service token is not configured")
    if not x_cache_service_token or not hmac.compare_digest(x_cache_service_token, CACHE_SERVICE_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid cache service credentials")


def get_redis() -> aioredis.Redis:
    if redis_client is None:
        raise HTTPException(status_code=503, detail="Redis client unavailable")
    return redis_client


@app.get("/health", status_code=status.HTTP_200_OK)
async def health():
    try:
        if not CACHE_SERVICE_TOKEN or len(CACHE_SERVICE_TOKEN) < 32:
            raise HTTPException(status_code=503, detail="CACHE_SERVICE_TOKEN is not configured")
        await get_redis().ping()
        return {"status": "healthy", "service": "shared-cache"}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Cache health probe failed")
        raise HTTPException(status_code=503, detail="Redis is unavailable")


@app.get("/ready")
async def ready():
    return await health()


@app.get("/v1/cache")
async def get_cache(key: str = Query(..., min_length=1, max_length=512),
                    x_cache_service_token: Optional[str] = Header(default=None)):
    require_internal_token(x_cache_service_token)
    try:
        value = await get_redis().get("cache:" + key)
        if value is None:
            return {"hit": False, "value": None}
        return {"hit": True, "value": json.loads(value)}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Cache read failed")
        raise HTTPException(status_code=503, detail="Cache read failed")


@app.put("/v1/cache")
@app.post("/v1/cache")  # Backward compatibility for older deployed clients.
async def set_cache(payload: CacheSetPayload,
                    x_cache_service_token: Optional[str] = Header(default=None)):
    require_internal_token(x_cache_service_token)
    try:
        encoded = json.dumps(payload.value, separators=(",", ":"), ensure_ascii=False)
        await get_redis().set("cache:" + payload.key, encoded, ex=payload.ttlSeconds)
        return {"status": "ok", "key": payload.key, "ttlSeconds": payload.ttlSeconds}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Cache write failed")
        raise HTTPException(status_code=503, detail="Cache write failed")


@app.delete("/v1/cache")
async def delete_cache(key: str = Query(..., min_length=1, max_length=512),
                       x_cache_service_token: Optional[str] = Header(default=None)):
    require_internal_token(x_cache_service_token)
    try:
        deleted = await get_redis().delete("cache:" + key)
        return {"status": "ok", "deleted": bool(deleted)}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Cache delete failed")
        raise HTTPException(status_code=503, detail="Cache delete failed")


@app.post("/v1/events")
async def publish_event(payload: EventPayload,
                        x_cache_service_token: Optional[str] = Header(default=None)):
    require_internal_token(x_cache_service_token)
    try:
        event = {
            "channel": payload.channel,
            "payload": payload.payload,
            "userId": payload.userId,
            "tenantId": payload.tenantId,
            "riderId": payload.riderId,
        }
        stream_id = await get_redis().xadd(
            EVENT_STREAM, {"event": json.dumps(event, separators=(",", ":"), ensure_ascii=False)},
            maxlen=MAX_STREAM_LENGTH, approximate=True,
        )
        return {"status": "published", "id": stream_id}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Event publish failed")
        raise HTTPException(status_code=503, detail="Event publish failed")


@app.get("/v1/events/cursor")
async def get_event_cursor(x_cache_service_token: Optional[str] = Header(default=None)):
    require_internal_token(x_cache_service_token)
    try:
        redis = get_redis()
        cursor = await redis.get(EVENT_CURSOR_KEY)
        if cursor:
            return {"cursor": cursor}
        latest = await redis.xrevrange(EVENT_STREAM, count=1)
        cursor = latest[0][0] if latest else "0-0"
        await redis.set(EVENT_CURSOR_KEY, cursor)
        return {"cursor": cursor}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Event cursor initialization failed")
        raise HTTPException(status_code=503, detail="Event cursor initialization failed")


@app.post("/v1/events/ack")
async def acknowledge_events(payload: dict,
                             x_cache_service_token: Optional[str] = Header(default=None)):
    require_internal_token(x_cache_service_token)
    cursor = payload.get("cursor")
    if not isinstance(cursor, str) or not cursor or len(cursor) > 64:
        raise HTTPException(status_code=400, detail="A valid stream cursor is required")
    try:
        await get_redis().set(EVENT_CURSOR_KEY, cursor)
        return {"status": "acknowledged", "cursor": cursor}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Event cursor acknowledgement failed")
        raise HTTPException(status_code=503, detail="Event cursor acknowledgement failed")


@app.get("/v1/events/poll")
async def poll_events(cursor: str = Query(default="0-0", max_length=64),
                      blockMs: int = Query(default=5000, ge=1000, le=10000),
                      x_cache_service_token: Optional[str] = Header(default=None)):
    require_internal_token(x_cache_service_token)
    try:
        streams = await get_redis().xread({EVENT_STREAM: cursor}, count=100, block=blockMs)
        events = []
        next_cursor = cursor
        for _stream_name, entries in streams:
            for stream_id, fields in entries:
                next_cursor = stream_id
                raw_event = fields.get("event")
                if raw_event:
                    events.append({"id": stream_id, **json.loads(raw_event)})
        return {"events": events, "cursor": next_cursor}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Event poll failed")
        raise HTTPException(status_code=503, detail="Event poll failed")


# Compatibility endpoints for existing internal scripts. These are protected too.
@app.post("/set")
async def legacy_set(payload: CacheSetPayload, x_cache_service_token: Optional[str] = Header(default=None)):
    return await set_cache(payload, x_cache_service_token)


@app.get("/get/{key:path}")
async def legacy_get(key: str, x_cache_service_token: Optional[str] = Header(default=None)):
    result = await get_cache(key, x_cache_service_token)
    return {"status": "hit" if result["hit"] else "miss", "data": result["value"]}


@app.delete("/del/{key:path}")
async def legacy_delete(key: str, x_cache_service_token: Optional[str] = Header(default=None)):
    return await delete_cache(key, x_cache_service_token)
