"""Plugin discovery and instantiation via importlib.metadata entry_points."""

from __future__ import annotations

from importlib import metadata
from typing import Any, TypeVar

from devops_kit.core.interfaces import (
    BaseIaasDriver,
    BasePaasDriver,
    BaseRouteManager,
    BaseSaasDriver,
    BaseSecretStore,
    BaseSizingEngine,
)

TPlugin = TypeVar("TPlugin")

ENTRY_POINT_GROUPS = {
    "drivers": "devops_kit.drivers",
    "stores": "devops_kit.stores",
    "allocators": "devops_kit.allocators",
    "routers": "devops_kit.routers",
}


class PluginRegistry:
    """Discovers built-in and third-party plugins via standard Python entry points."""

    def __init__(self) -> None:
        self._cache: dict[str, dict[str, type[Any]]] = {
            group: {} for group in ENTRY_POINT_GROUPS
        }
        self._loaded = False

    def discover(self, force: bool = False) -> None:
        if self._loaded and not force:
            return

        # 1. Load entry points registered in installed packages
        for alias, group_name in ENTRY_POINT_GROUPS.items():
            eps = metadata.entry_points()
            selected = eps.select(group=group_name) if hasattr(eps, "select") else []
            for ep in selected:
                try:
                    loaded_cls = ep.load()
                    self._cache[alias][ep.name] = loaded_cls
                except Exception:
                    # Defer optional extra dependency failures until explicit lookup
                    continue

        # 2. Ensure built-in fallback registrations work even in editable/uninstalled mode
        self._register_builtin_fallbacks()
        self._loaded = True

    def _register_builtin_fallbacks(self) -> None:
        from devops_kit.allocator.sizing_engine import DeterministicSizingEngine
        from devops_kit.injection.route_manager import (
            EnvoyRouteManager,
            GatewayApiRouteManager,
        )
        from devops_kit.plugins.builtin_drivers import (
            AwsIaasDriver,
            AwsSsmSecretStore,
            AzureIaasDriver,
            CloudRunPaasDriver,
            GcpIaasDriver,
            GcpSecretManagerStore,
            HashiCorpVaultStore,
            KubernetesPaasDriver,
            LocalDockerDriver,
            LocalFileSecretStore,
        )
        from devops_kit.plugins.saas_cloudflare_auth0 import CloudflareAuth0SaasDriver

        self._cache["drivers"].setdefault("aws-iaas", AwsIaasDriver)
        self._cache["drivers"].setdefault("gcp-iaas", GcpIaasDriver)
        self._cache["drivers"].setdefault("azure-iaas", AzureIaasDriver)
        self._cache["drivers"].setdefault("kubernetes-paas", KubernetesPaasDriver)
        self._cache["drivers"].setdefault("cloudrun-paas", CloudRunPaasDriver)
        self._cache["drivers"].setdefault("local-docker", LocalDockerDriver)
        self._cache["drivers"].setdefault("cloudflare-auth0-saas", CloudflareAuth0SaasDriver)

        self._cache["stores"].setdefault("aws-ssm", AwsSsmSecretStore)
        self._cache["stores"].setdefault("gcp-sm", GcpSecretManagerStore)
        self._cache["stores"].setdefault("vault", HashiCorpVaultStore)
        self._cache["stores"].setdefault("local-env", LocalFileSecretStore)

        self._cache["allocators"].setdefault("deterministic-v1", DeterministicSizingEngine)
        self._cache["routers"].setdefault("gateway-api", GatewayApiRouteManager)
        self._cache["routers"].setdefault("envoy-proxy", EnvoyRouteManager)

    def get_plugin(self, group: str, name: str, expected_base: type[TPlugin]) -> TPlugin:
        self.discover()
        group_map = self._cache.get(group, {})
        if name not in group_map:
            available = ", ".join(sorted(group_map.keys()))
            raise KeyError(
                f"Plugin '{name}' not found in group '{group}'. Available: [{available}]"
            )
        cls = group_map[name]
        instance = cls()
        if not isinstance(instance, expected_base):
            raise TypeError(
                f"Plugin '{name}' ({cls.__name__}) does not implement {expected_base.__name__}"
            )
        return instance

    def get_iaas_driver(self, name: str) -> BaseIaasDriver:
        return self.get_plugin("drivers", name, BaseIaasDriver)

    def get_paas_driver(self, name: str) -> BasePaasDriver:
        return self.get_plugin("drivers", name, BasePaasDriver)

    def get_saas_driver(self, name: str) -> BaseSaasDriver:
        return self.get_plugin("drivers", name, BaseSaasDriver)

    def get_secret_store(self, name: str) -> BaseSecretStore:
        return self.get_plugin("stores", name, BaseSecretStore)

    def get_allocator(self, name: str = "deterministic-v1") -> BaseSizingEngine:
        return self.get_plugin("allocators", name, BaseSizingEngine)

    def get_router(self, name: str = "gateway-api") -> BaseRouteManager:
        return self.get_plugin("routers", name, BaseRouteManager)

    def list_plugins(self) -> dict[str, list[str]]:
        self.discover()
        return {group: sorted(items.keys()) for group, items in self._cache.items()}
