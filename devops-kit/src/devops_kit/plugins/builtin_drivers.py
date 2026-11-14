"""Built-in IaaS, PaaS, Local, and SecretStore plugin implementations."""

from __future__ import annotations

import json
from pathlib import Path

from devops_kit.contracts.models import AllocationPlan, ServiceEnvironmentContract
from devops_kit.core.interfaces import (
    BaseIaasDriver,
    BasePaasDriver,
    BaseSecretStore,
    DriverExecutionResult,
)


class _CloudIaasBase(BaseIaasDriver):
    provider_label = "generic"

    def plan_infrastructure(
        self, contract: ServiceEnvironmentContract, plan: AllocationPlan
    ) -> DriverExecutionResult:
        return DriverExecutionResult(
            driver_name=self.driver_name,
            layer="iaas",
            status="planned",
            outputs={
                "control_plane": contract.target.control_plane.value,
                "vpc_cidr": contract.services.iaas.vpc_cidr,
                "instance_family": plan.compute.instance_family,
                "node_count": plan.compute.node_count,
                "db_tier": plan.database.tier if plan.database.enabled else "disabled",
            },
        )

    def apply_infrastructure(
        self, contract: ServiceEnvironmentContract, plan: AllocationPlan
    ) -> DriverExecutionResult:
        svc = contract.metadata.name
        env = contract.metadata.environment.value
        endpoints = {
            "VPC_ID": f"vpc-{self.provider_label}-{env}-{svc[:6]}",
        }
        if plan.database.enabled:
            endpoints["DATABASE_URL"] = (
                f"postgresql://app_user@${{SECRET_DB_PASS}}@{svc}-{env}-db.{self.provider_label}.internal:5432/{svc}"
            )
        if plan.cache_tier:
            endpoints["REDIS_URL"] = (
                f"rediss://{svc}-{env}-cache.{self.provider_label}.internal:6379/0"
            )
        if plan.object_storage_encrypted:
            endpoints["S3_BUCKET_NAME"] = f"{svc}-{env}-{contract.target.region}-bucket"
        if plan.queue_enabled:
            endpoints["QUEUE_ENDPOINT"] = (
                f"https://queue.{contract.target.region}.{self.provider_label}.internal/{svc}-{env}"
            )
        return DriverExecutionResult(
            driver_name=self.driver_name,
            layer="iaas",
            status="applied",
            outputs={"region": contract.target.region, "multi_az": contract.services.iaas.multi_az},
            endpoints=endpoints,
        )

    def destroy_infrastructure(self, contract: ServiceEnvironmentContract) -> DriverExecutionResult:
        return DriverExecutionResult(
            driver_name=self.driver_name,
            layer="iaas",
            status="destroyed",
            outputs={"service": contract.metadata.name, "env": contract.metadata.environment.value},
        )


class AwsIaasDriver(_CloudIaasBase):
    driver_name = "aws-iaas"
    provider_label = "aws"


class GcpIaasDriver(_CloudIaasBase):
    driver_name = "gcp-iaas"
    provider_label = "gcp"


class AzureIaasDriver(_CloudIaasBase):
    driver_name = "azure-iaas"
    provider_label = "azure"


class KubernetesPaasDriver(BasePaasDriver):
    driver_name = "kubernetes-paas"

    def render_manifests(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        resolved_env: dict[str, str],
    ) -> dict[str, str]:
        return {"namespace": contract.services.paas.kubernetes_namespace}

    def deploy_workload(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        image_uri: str,
        resolved_env: dict[str, str],
    ) -> DriverExecutionResult:
        return DriverExecutionResult(
            driver_name=self.driver_name,
            layer="paas",
            status="rolled-out",
            outputs={
                "namespace": contract.services.paas.kubernetes_namespace,
                "image": image_uri,
                "min_replicas": plan.autoscaling.min_replicas,
                "max_replicas": plan.autoscaling.max_replicas,
            },
            endpoints={
                "INTERNAL_URL": (
                    f"http://{contract.metadata.name}.{contract.services.paas.kubernetes_namespace}.svc.cluster.local:8080"
                )
            },
        )

    def scale_to_zero(self, contract: ServiceEnvironmentContract) -> DriverExecutionResult:
        return DriverExecutionResult(
            driver_name=self.driver_name,
            layer="paas",
            status="scaled-to-zero",
            outputs={
                "deployment": contract.metadata.name,
                "namespace": contract.services.paas.kubernetes_namespace,
                "replicas": 0,
            },
        )


class CloudRunPaasDriver(BasePaasDriver):
    driver_name = "cloudrun-paas"

    def render_manifests(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        resolved_env: dict[str, str],
    ) -> dict[str, str]:
        return {"service": f"{contract.metadata.name}-{contract.metadata.environment.value}"}

    def deploy_workload(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        image_uri: str,
        resolved_env: dict[str, str],
    ) -> DriverExecutionResult:
        url = (
            f"https://{contract.metadata.name}-{contract.metadata.environment.value}"
            f".{contract.target.region}.run.app"
        )
        return DriverExecutionResult(
            driver_name=self.driver_name,
            layer="paas",
            status="deployed",
            outputs={"image": image_uri, "concurrency": 80},
            endpoints={"INTERNAL_URL": url},
        )

    def scale_to_zero(self, contract: ServiceEnvironmentContract) -> DriverExecutionResult:
        return DriverExecutionResult(
            driver_name=self.driver_name,
            layer="paas",
            status="min-instances-zero",
            outputs={"service": contract.metadata.name},
        )


class LocalDockerDriver(BaseIaasDriver, BasePaasDriver):
    """Unified Local IaaS + PaaS driver for Docker Compose developer parity."""

    driver_name = "local-docker"

    def plan_infrastructure(
        self, contract: ServiceEnvironmentContract, plan: AllocationPlan
    ) -> DriverExecutionResult:
        return DriverExecutionResult(
            driver_name=self.driver_name,
            layer="local",
            status="planned",
            outputs={"compose_services": ["app", "postgres", "redis"]},
        )

    def apply_infrastructure(
        self, contract: ServiceEnvironmentContract, plan: AllocationPlan
    ) -> DriverExecutionResult:
        return DriverExecutionResult(
            driver_name=self.driver_name,
            layer="local",
            status="running",
            endpoints={
                "DATABASE_URL": "postgresql://app_user:local_dev_password@localhost:5432/orders_api",
                "REDIS_URL": "redis://localhost:6379/0",
            },
        )

    def destroy_infrastructure(self, contract: ServiceEnvironmentContract) -> DriverExecutionResult:
        return DriverExecutionResult(driver_name=self.driver_name, layer="local", status="stopped")

    def render_manifests(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        resolved_env: dict[str, str],
    ) -> dict[str, str]:
        return {"compose": "docker-compose.yml"}

    def deploy_workload(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        image_uri: str,
        resolved_env: dict[str, str],
    ) -> DriverExecutionResult:
        return DriverExecutionResult(
            driver_name=self.driver_name,
            layer="local",
            status="started",
            endpoints={"INTERNAL_URL": "http://localhost:8080"},
        )

    def scale_to_zero(self, contract: ServiceEnvironmentContract) -> DriverExecutionResult:
        return DriverExecutionResult(driver_name=self.driver_name, layer="local", status="paused")


class LocalFileSecretStore(BaseSecretStore):
    """Stores outputs in .devops-kit-out/secret-store/<env>/<service>.json for local parity."""

    store_name = "local-env"

    def __init__(self, root_dir: Path | None = None) -> None:
        self.root_dir = root_dir or Path(".devops-kit-out/secret-store")

    def _target_file(self, service: str, environment: str) -> Path:
        return self.root_dir / environment / f"{service}.json"

    def publish_outputs(self, service: str, environment: str, outputs: dict[str, str]) -> None:
        target = self._target_file(service, environment)
        target.parent.mkdir(parents=True, exist_ok=True)
        existing = self.fetch_secrets(service, environment)
        existing.update(outputs)
        target.write_text(json.dumps(existing, indent=2), encoding="utf-8")

    def fetch_secrets(self, service: str, environment: str) -> dict[str, str]:
        target = self._target_file(service, environment)
        if not target.exists():
            return {}
        data = json.loads(target.read_text(encoding="utf-8"))
        return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}


class AwsSsmSecretStore(LocalFileSecretStore):
    store_name = "aws-ssm"


class GcpSecretManagerStore(LocalFileSecretStore):
    store_name = "gcp-sm"


class HashiCorpVaultStore(LocalFileSecretStore):
    store_name = "vault"
