"""Abstract Base Classes defining the DevOps Kit Plugin Interfaces."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from devops_kit.contracts.models import AllocationPlan, ServiceEnvironmentContract


@dataclass(slots=True)
class DriverExecutionResult:
    driver_name: str
    layer: str
    status: str
    outputs: dict[str, Any] = field(default_factory=dict)
    endpoints: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


class BaseSizingEngine(ABC):
    """Converts workload intent into normalized infrastructure specifications."""

    engine_name: str = "base"

    @abstractmethod
    def compute_plan(self, contract: ServiceEnvironmentContract) -> AllocationPlan:
        """Compute deterministic or ML-assisted sizing plan from contract."""


class BaseIaasDriver(ABC):
    """Provisions raw VPCs, VMs, KMS keys, databases, and storage primitives."""

    driver_name: str = "base-iaas"

    @abstractmethod
    def plan_infrastructure(
        self, contract: ServiceEnvironmentContract, plan: AllocationPlan
    ) -> DriverExecutionResult:
        """Generate an execution plan without mutating cloud state."""

    @abstractmethod
    def apply_infrastructure(
        self, contract: ServiceEnvironmentContract, plan: AllocationPlan
    ) -> DriverExecutionResult:
        """Provision or reconcile IaaS resources and return infra outputs."""

    @abstractmethod
    def destroy_infrastructure(self, contract: ServiceEnvironmentContract) -> DriverExecutionResult:
        """Tear down IaaS resources for the environment."""


class BasePaasDriver(ABC):
    """Deploys workloads onto managed container/serverless runtimes (K8s, ECS, Cloud Run)."""

    driver_name: str = "base-paas"

    @abstractmethod
    def render_manifests(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        resolved_env: dict[str, str],
    ) -> dict[str, str]:
        """Return filename -> manifest YAML/JSON content for deployment."""

    @abstractmethod
    def deploy_workload(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        image_uri: str,
        resolved_env: dict[str, str],
    ) -> DriverExecutionResult:
        """Deploy workload artifact to the target PaaS runtime."""

    @abstractmethod
    def scale_to_zero(self, contract: ServiceEnvironmentContract) -> DriverExecutionResult:
        """Suspend compute replicas for FinOps auto-sleep."""


class BaseSaasDriver(ABC):
    """Provisions third-party SaaS edges (Cloudflare DNS/WAF, Auth0 OIDC, Datadog)."""

    driver_name: str = "base-saas"

    @abstractmethod
    def reconcile_saas(
        self, contract: ServiceEnvironmentContract, plan: AllocationPlan
    ) -> DriverExecutionResult:
        """Idempotently reconcile external SaaS APIs and return injected outputs."""

    @abstractmethod
    def teardown_saas(self, contract: ServiceEnvironmentContract) -> DriverExecutionResult:
        """Clean up ephemeral SaaS routes, tenants, or DNS records."""


class BaseSecretStore(ABC):
    """Publishes and retrieves encrypted runtime configuration and secrets."""

    store_name: str = "base-store"

    @abstractmethod
    def publish_outputs(
        self, service: str, environment: str, outputs: dict[str, str]
    ) -> None:
        """Write Terraform/SaaS outputs to centralized parameter/secret store."""

    @abstractmethod
    def fetch_secrets(self, service: str, environment: str) -> dict[str, str]:
        """Read secrets for runtime injection or SDK polling."""


class BaseRouteManager(ABC):
    """Manages Gateway API / Ingress / Envoy dynamic traffic shifting & rate limits."""

    router_name: str = "base-router"

    @abstractmethod
    def generate_route_config(
        self, contract: ServiceEnvironmentContract, canary_weight: int | None = None
    ) -> str:
        """Render declarative route configuration YAML."""

    @abstractmethod
    def shift_traffic(
        self,
        contract: ServiceEnvironmentContract,
        canary_weight: int,
        pr_header: str | None = None,
    ) -> DriverExecutionResult:
        """Shift live traffic percentage or attach ephemeral PR header routing."""
