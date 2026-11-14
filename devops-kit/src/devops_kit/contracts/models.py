"""Pydantic v2 schema definitions for env-contract.yaml and AllocationPlan."""

from __future__ import annotations

import json
import re
from enum import Enum
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class EnvironmentType(str, Enum):
    LOCAL = "local"
    DEV = "dev"
    STAGING = "staging"
    PROD = "prod"
    EPHEMERAL = "ephemeral"


class LayerType(str, Enum):
    IAAS = "iaas"
    PAAS = "paas"
    SAAS = "saas"
    HYBRID = "hybrid"


class ProviderType(str, Enum):
    AWS = "aws"
    GCP = "gcp"
    AZURE = "azure"
    ONPREM = "onprem"
    LOCAL = "local"
    CUSTOM = "custom"


class ControlPlaneType(str, Enum):
    OPENTOFU = "opentofu"
    CROSSPLANE = "crossplane"
    PULUMI = "pulumi"
    COMPOSE = "compose"


class RuntimeType(str, Enum):
    KUBERNETES = "kubernetes"
    ECS = "ecs"
    CLOUD_RUN = "cloud-run"
    DOCKER_COMPOSE = "docker-compose"


class WorkloadProfile(str, Enum):
    API_REALTIME = "api-realtime"
    BATCH_WORKER = "batch-worker"
    EVENT_STREAM = "event-stream"
    ML_INFERENCE = "ml-inference"


class AvailabilitySla(str, Enum):
    SLA_99_9 = "99.9"
    SLA_99_95 = "99.95"
    SLA_99_99 = "99.99"


class ComplianceTier(str, Enum):
    STANDARD = "standard"
    PCI = "pci"
    HIPAA = "hipaa"
    GDPR = "gdpr"


class StatefulNeed(str, Enum):
    RELATIONAL_DB = "relational-db"
    IN_MEMORY_CACHE = "in-memory-cache"
    OBJECT_STORAGE = "object-storage"
    MESSAGE_QUEUE = "message-queue"


class TrafficStrategy(str, Enum):
    ROLLING = "rolling"
    CANARY_10_90 = "canary-10-90"
    BLUE_GREEN = "blue-green"


class ContractMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=2, max_length=63, pattern=r"^[a-z0-9-]+$")
    owner: str = Field(..., min_length=2)
    cost_center: str = Field(..., min_length=2)
    environment: EnvironmentType
    version: str = Field(default="1.0.0")


class TargetSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    layer: LayerType = LayerType.HYBRID
    provider: ProviderType
    region: str = Field(default="us-east-1", min_length=2)
    control_plane: ControlPlaneType = ControlPlaneType.OPENTOFU
    runtime: RuntimeType = RuntimeType.KUBERNETES
    custom_driver_name: str | None = None

    @model_validator(mode="after")
    def validate_custom_provider(self) -> TargetSpec:
        if self.provider == ProviderType.CUSTOM and not self.custom_driver_name:
            raise ValueError("custom_driver_name is required when provider is 'custom'")
        if self.provider == ProviderType.LOCAL and self.runtime not in {
            RuntimeType.DOCKER_COMPOSE,
            RuntimeType.KUBERNETES,
        }:
            raise ValueError("local provider only supports docker-compose or kubernetes runtime")
        return self


class RequirementsSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workload_profile: WorkloadProfile = WorkloadProfile.API_REALTIME
    expected_rps: int = Field(..., ge=1, le=2_000_000)
    p99_latency_ms: int = Field(default=150, ge=5, le=30_000)
    availability_sla: AvailabilitySla = AvailabilitySla.SLA_99_9
    compliance_tier: ComplianceTier = ComplianceTier.STANDARD
    stateful_needs: list[StatefulNeed] = Field(default_factory=list)


class IaasServiceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vpc_cidr: str = Field(default="10.40.0.0/16")
    multi_az: bool = True
    private_subnets_only: bool = True
    kms_cmk_rotation: bool = True

    @field_validator("vpc_cidr")
    @classmethod
    def validate_cidr(cls, value: str) -> str:
        if not re.match(r"^\d{1,3}(\.\d{1,3}){3}/\d{1,2}$", value):
            raise ValueError(f"Invalid CIDR block: {value}")
        return value


class PaasServiceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kubernetes_namespace: str = Field(default="default", pattern=r"^[a-z0-9-]+$")
    service_mesh: str = Field(default="istio")
    ingress_class: str = Field(default="gateway-api")
    enable_hpa: bool = True


class SaasServiceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    edge_cdn_provider: str | None = Field(default=None)
    identity_provider: str | None = Field(default=None)
    observability_sink: str | None = Field(default="opentelemetry")
    managed_domains: list[str] = Field(default_factory=list)


class ServicesMatrix(BaseModel):
    model_config = ConfigDict(extra="forbid")

    iaas: IaasServiceConfig = Field(default_factory=IaasServiceConfig)
    paas: PaasServiceConfig = Field(default_factory=PaasServiceConfig)
    saas: SaasServiceConfig = Field(default_factory=SaasServiceConfig)


class RoutingAndInjectionSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    public_domain: str = Field(..., min_length=3)
    path_prefix: str = Field(default="/", pattern=r"^/.*")
    traffic_strategy: TrafficStrategy = TrafficStrategy.ROLLING
    canary_weight_percent: int = Field(default=10, ge=0, le=100)
    rate_limit_rpm: int = Field(default=60_000, ge=100)
    dependencies: list[str] = Field(default_factory=list)
    dynamic_env_rules: dict[str, str] = Field(default_factory=dict)
    feature_flags: dict[str, bool] = Field(default_factory=dict)


class Day2Config(BaseModel):
    model_config = ConfigDict(extra="forbid")

    auto_sleep_schedule: str = Field(default="never")
    max_monthly_budget_usd: float = Field(..., gt=0.0)
    secret_rotation_days: int = Field(default=30, ge=1, le=365)
    auto_reload: bool = True
    drift_check_interval_minutes: int = Field(default=60, ge=5, le=1440)


class ServiceEnvironmentContract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    apiVersion: str = Field(default="devops-kit.io/v1alpha1")
    kind: str = Field(default="ServiceEnvironmentContract")
    metadata: ContractMetadata
    target: TargetSpec
    requirements: RequirementsSpec
    services: ServicesMatrix = Field(default_factory=ServicesMatrix)
    routing_and_injection: RoutingAndInjectionSpec
    day2: Day2Config

    @model_validator(mode="after")
    def validate_prod_safety(self) -> ServiceEnvironmentContract:
        if self.metadata.environment == EnvironmentType.PROD:
            if self.requirements.compliance_tier in {ComplianceTier.PCI, ComplianceTier.HIPAA}:
                if not self.services.iaas.private_subnets_only:
                    raise ValueError("PCI/HIPAA prod workloads require private_subnets_only=true")
                if not self.services.iaas.kms_cmk_rotation:
                    raise ValueError("PCI/HIPAA prod workloads require kms_cmk_rotation=true")
            if self.day2.auto_sleep_schedule != "never":
                raise ValueError("Production environments cannot configure auto_sleep_schedule")
        return self

    @classmethod
    def from_yaml_file(cls, path: Path) -> ServiceEnvironmentContract:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"Expected YAML mapping in {path}")
        return cls.model_validate(raw)

    @classmethod
    def export_json_schema(cls, output_path: Path | None = None) -> dict[str, Any]:
        schema = cls.model_json_schema()
        if output_path is not None:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(json.dumps(schema, indent=2), encoding="utf-8")
        return schema


class ComputeSpec(BaseModel):
    instance_family: str
    vcpu_per_unit: float
    memory_mb_per_unit: int
    node_count: int
    gpu_count: int = 0
    spot_allowed: bool = False


class AutoscalingSpec(BaseModel):
    min_replicas: int
    max_replicas: int
    target_cpu_utilization: int
    scale_down_stabilization_sec: int


class DatabaseSpec(BaseModel):
    enabled: bool
    engine: str = "postgresql-16"
    tier: str = "db.t4g.medium"
    multi_az: bool = False
    storage_gb: int = 50
    max_connections: int = 100
    optimal_app_pool_size: int = 20
    encrypted_at_rest: bool = True


class AllocationPlan(BaseModel):
    """Normalized output passed directly to OpenTofu, Crossplane, and Injection Managers."""

    contract_name: str
    environment: EnvironmentType
    provider: ProviderType
    control_plane: ControlPlaneType
    runtime: RuntimeType
    region: str
    compute: ComputeSpec
    autoscaling: AutoscalingSpec
    database: DatabaseSpec
    cache_tier: str | None = None
    queue_enabled: bool = False
    object_storage_encrypted: bool = False
    estimated_monthly_cost_usd: float
    budget_limit_usd: float
    within_budget: bool
    encryption_policies: dict[str, Any] = Field(default_factory=dict)
    saas_bindings: dict[str, Any] = Field(default_factory=dict)
    sizing_rationale: list[str] = Field(default_factory=list)
