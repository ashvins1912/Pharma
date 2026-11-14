"""Lightweight Python SDK for hot-reloadable runtime config, feature flags, and failover."""

from __future__ import annotations

import functools
import inspect
import json
import os
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, ParamSpec, TypeVar

import httpx

P = ParamSpec("P")
R = TypeVar("R")


class CircuitBreakerOpenError(RuntimeError):
    """Raised when all upstream failover endpoints are currently tripped."""


class _EndpointCircuit:
    def __init__(self, failure_threshold: int = 3, reset_timeout_sec: float = 30.0) -> None:
        self.failure_threshold = failure_threshold
        self.reset_timeout_sec = reset_timeout_sec
        self.failures = 0
        self.opened_at: float | None = None

    def is_available(self) -> bool:
        if self.opened_at is None:
            return True
        if (time.monotonic() - self.opened_at) >= self.reset_timeout_sec:
            # Half-open retry allowed
            self.opened_at = None
            self.failures = 0
            return True
        return False

    def record_success(self) -> None:
        self.failures = 0
        self.opened_at = None

    def record_failure(self) -> None:
        self.failures += 1
        if self.failures >= self.failure_threshold:
            self.opened_at = time.monotonic()


class DynamicRuntime:
    """Thread-safe runtime config/secret client with background hot-reload & circuit-breaker routing."""

    def __init__(
        self,
        service: str | None = None,
        environment: str | None = None,
        secret_file: Path | None = None,
        poll_url: str | None = None,
        poll_interval_sec: float = 15.0,
    ) -> None:
        self.service = service or os.getenv("APP_NAME", "orders-api")
        self.environment = environment or os.getenv("APP_ENV", "local")
        self.secret_file = secret_file or Path(
            os.getenv("DEVOPS_KIT_RUNTIME_FILE", ".devops-kit-out/secret-store")
        ) / self.environment / f"{self.service}.json"
        self.poll_url = poll_url or os.getenv("DEVOPS_KIT_FLAGD_URL")
        self.poll_interval_sec = poll_interval_sec

        self._lock = threading.RLock()
        self._cache: dict[str, str] = {}
        self._circuits: dict[str, _EndpointCircuit] = {}
        self._stop_event = threading.Event()
        self._poller: threading.Thread | None = None
        self.reload()

    def reload(self) -> dict[str, str]:
        """Refresh configuration from OS env, mounted secret store JSON, and optional HTTP endpoint."""
        merged: dict[str, str] = {k: v for k, v in os.environ.items()}

        if self.secret_file.exists():
            try:
                loaded = json.loads(self.secret_file.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    for k, v in loaded.items():
                        merged[str(k)] = str(v)
            except (OSError, json.JSONDecodeError):
                pass

        if self.poll_url:
            try:
                with httpx.Client(timeout=2.0) as client:
                    resp = client.get(self.poll_url)
                    if resp.status_code == 200:
                        data = resp.json()
                        if isinstance(data, dict):
                            for k, v in data.items():
                                merged[str(k)] = str(v)
            except httpx.HTTPError:
                pass

        with self._lock:
            self._cache = merged
            return dict(self._cache)

    def start_background_reload(self) -> None:
        if self._poller and self._poller.is_alive():
            return
        self._stop_event.clear()

        def _loop() -> None:
            while not self._stop_event.wait(self.poll_interval_sec):
                self.reload()

        self._poller = threading.Thread(target=_loop, name="devops-kit-hot-reload", daemon=True)
        self._poller.start()

    def stop_background_reload(self) -> None:
        self._stop_event.set()
        if self._poller and self._poller.is_alive():
            self._poller.join(timeout=2.0)

    def get(self, key: str, default: str | None = None) -> str | None:
        with self._lock:
            return self._cache.get(key, default)

    def require(self, key: str) -> str:
        val = self.get(key)
        if val is None:
            raise KeyError(f"Required runtime config key '{key}' is not set.")
        return val

    def flag(self, flag_name: str, default: bool = False) -> bool:
        raw = self.get(f"FF_{flag_name.upper()}")
        if raw is None:
            return default
        return raw.strip().lower() in {"1", "true", "yes", "on"}

    def inject_env(
        self, mapping: dict[str, str] | None = None
    ) -> Callable[[Callable[P, R]], Callable[P, R]]:
        """Decorator injecting live runtime keys into matching function keyword arguments."""

        def decorator(func: Callable[P, R]) -> Callable[P, R]:
            sig = inspect.signature(func)

            @functools.wraps(func)
            def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
                if mapping:
                    for param_name, env_key in mapping.items():
                        if param_name not in kwargs and param_name in sig.parameters:
                            val = self.get(env_key)
                            if val is not None:
                                kwargs[param_name] = val  # type: ignore[assignment]
                else:
                    for param_name in sig.parameters:
                        if param_name not in kwargs:
                            val = self.get(param_name.upper())
                            if val is not None:
                                kwargs[param_name] = val  # type: ignore[assignment]
                return func(*args, **kwargs)

            return wrapper

        return decorator

    def resolve_endpoint_with_failover(self, primary_key: str, fallback_key: str) -> str:
        """Select primary URL unless its circuit breaker is open, otherwise fail over cleanly."""
        primary = self.get(primary_key)
        fallback = self.get(fallback_key)
        candidates = [url for url in (primary, fallback) if url]
        if not candidates:
            raise CircuitBreakerOpenError(
                f"Neither '{primary_key}' nor '{fallback_key}' is configured."
            )

        with self._lock:
            for url in candidates:
                circuit = self._circuits.setdefault(url, _EndpointCircuit())
                if circuit.is_available():
                    return url
        raise CircuitBreakerOpenError(f"All endpoints tripped for {primary_key}/{fallback_key}.")

    def report_endpoint_outcome(self, url: str, success: bool) -> None:
        with self._lock:
            circuit = self._circuits.setdefault(url, _EndpointCircuit())
            if success:
                circuit.record_success()
            else:
                circuit.record_failure()

    def __enter__(self) -> DynamicRuntime:
        self.start_background_reload()
        return self

    def __exit__(self, *_: Any) -> None:
        self.stop_background_reload()
