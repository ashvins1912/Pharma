"""
Resilient Async HTTP Cache Client for caching-services on Render.

Designed to fail fast and fall back gracefully during Render cold starts.
"""

import os
import logging
from typing import Any, Optional
import httpx

logger = logging.getLogger("app.cache_client")

# Render internal microservice URL or fallback to localhost
CACHE_SERVICE_URL = os.getenv("CACHE_SERVICE_URL", "http://caching-services:8080").rstrip("/")

# Aggressive 3-second network boundary: 1.0s connect, 2.0s read/write
CACHE_TIMEOUT = httpx.Timeout(
    connect=1.0,
    read=2.0,
    write=2.0,
    pool=3.0,
)

# Persistent connection pool limits
CACHE_LIMITS = httpx.Limits(
    max_keepalive_connections=20,
    max_connections=50,
    keepalive_expiry=30.0,
)


class CacheClient:
    """
    Singleton-friendly async cache client.
    Never raises network exceptions to the caller; failures degrade to cache misses.
    """

    def __init__(self, base_url: str = CACHE_SERVICE_URL, timeout: httpx.Timeout = CACHE_TIMEOUT):
        self.base_url = base_url
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                limits=CACHE_LIMITS,
                headers={"Accept": "application/json"},
            )
        return self._client

    async def get(self, key: str) -> Optional[Any]:
        """
        Retrieves a cached item by key.
        Returns the native deserialized data on hit, or None on miss/cold-start error.
        """
        try:
            client = await self.get_client()
            response = await client.get(f"/get/{key}")
            if response.status_code == 200:
                payload = response.json()
                if payload.get("status") == "hit":
                    return payload.get("data")
            return None
        except (httpx.TimeoutException, httpx.NetworkError, httpx.ConnectError) as exc:
            # Circuit breaker fallback: log warning and silently miss
            logger.warning(
                "Cache service unavailable or waking up from cold start (key: '%s'): %s",
                key,
                exc,
            )
            return None
        except Exception as exc:
            logger.error("Unexpected error querying cache for key '%s': %s", key, exc)
            return None

    async def set(self, key: str, value: Any, ttl_seconds: int = 3600) -> bool:
        """
        Pipes data to the cache service with specified TTL.
        Fails safely without raising if the cache is unreachable.
        """
        try:
            client = await self.get_client()
            response = await client.post(
                "/set",
                json={"key": key, "value": value, "ttlSeconds": ttl_seconds},
            )
            return response.status_code == 200
        except (httpx.TimeoutException, httpx.NetworkError, httpx.ConnectError) as exc:
            logger.warning(
                "Unable to populate cache for key '%s' due to network condition: %s",
                key,
                exc,
            )
            return False
        except Exception as exc:
            logger.error("Unexpected error writing cache for key '%s': %s", key, exc)
            return False

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()


# Default global instance
cache = CacheClient()
