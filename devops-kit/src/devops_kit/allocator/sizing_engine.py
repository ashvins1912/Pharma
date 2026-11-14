"""Deterministic requirement-to-infrastructure sizing engine."""

from __future__ import annotations

import math

from devops_kit.contracts.models import (
    AllocationPlan,
    AutoscalingSpec,
    AvailabilitySla,
    ComplianceTier,
    ComputeSpec,
    DatabaseSpec,
    EnvironmentType,
    ProviderType,
    ServiceEnvironmentContract,
    StatefulNeed,
    WorkloadProfile,
)
from devops_kit.core.interfaces import BaseSizingEngine


_INSTANCE_CATALOG: dict[ProviderType, dict[WorkloadProfile, tuple[str, float, int, float]]] = {
    # provider -> profile -> (instance_family, vcpu, memory_mb, monthly_usd)
    ProviderType.AWS: {
        WorkloadProfile.API_REALTIME: ("c7g.large", 2.0, 4096, 52.5),
        WorkloadProfile.BATCH_WORKER: ("m7g.large", 2.0, 8192, 60.0),
        WorkloadProfile.EVENT_STREAM: ("r7g.large", 2.0, 16384, 78.0),
        WorkloadProfile.ML_INFERENCE: ("g5.xlarge", 4.0, 16384, 735.0),
    },
    ProviderType.GCP: {
        WorkloadProfile.API_REALTIME: ("c3-standard-4", 4.0, 8192, 98.0),
        WorkloadProfile.BATCH_WORKER: ("n2-standard-2", 2.0, 8192, 68.0),
        WorkloadProfile.EVENT_STREAM: ("n2-highmem-2", 2.0, 16384, 88.0),
        WorkloadProfile.ML_INFERENCE: ("g2-standard-4", 4.0, 16384, 620.0),
    },
    ProviderType.AZURE: {
        WorkloadProfile.API_REALTIME: ("Standard_F4s_v2", 4.0, 8192, 95.0),
        WorkloadProfile.BATCH_WORKER: ("Standard_D2s_v5", 2.0, 8192, 69.0),
        WorkloadProfile.EVENT_STREAM: ("Standard_E2s_v5", 2.0, 16384, 90.0),
        WorkloadProfile.ML_INFERENCE: ("Standard_NC4as_T4_v3", 4.0, 28672, 385.0),
    },
    ProviderType.ONPREM: {
        WorkloadProfile.API_REALTIME: ("kvm-compute-2c4g", 2.0, 4096, 15.0),
        WorkloadProfile.BATCH_WORKER: ("kvm-general-2c8g", 2.0, 8192, 18.0),
        WorkloadProfile.EVENT_STREAM: ("kvm-mem-2c16g", 2.0, 16384, 24.0),
        WorkloadProfile.ML_INFERENCE: ("kvm-gpu-l4-4c16g", 4.0, 16384, 140.0),
    },
    ProviderType.LOCAL: {
        WorkloadProfile.API_REALTIME: ("docker-container-2c2g", 2.0, 2048, 0.0),
        WorkloadProfile.BATCH_WORKER: ("docker-container-2c4g", 2.0, 4096, 0.0),
        WorkloadProfile.EVENT_STREAM: ("docker-container-2c4g", 2.0, 4096, 0.0),
        WorkloadProfile.ML_INFERENCE: ("docker-container-4c8g", 4.0, 8192, 0.0),
    },
    ProviderType.CUSTOM: {
        WorkloadProfile.API_REALTIME: ("custom-compute-2c4g", 2.0, 4096, 50.0),
        WorkloadProfile.BATCH_WORKER: ("custom-general-2c8g", 2.0, 8192, 60.0),
        WorkloadProfile.EVENT_STREAM: ("custom-mem-2c16g", 2.0, 16384, 80.0),
        WorkloadProfile.ML_INFERENCE: ("custom-gpu-4c16g", 4.0, 16384, 500.0),
    },
}

_RPS_PER_REPLICA: dict[WorkloadProfile, int] = {
    WorkloadProfile.API_REALTIME: 450,
    WorkloadProfile.BATCH_WORKER: 200,
    WorkloadProfile.EVENT_STREAM: 1200,
    WorkloadProfile.ML_INFERENCE: 80,
}

_SLA_MIN_REPLICAS: dict[AvailabilitySla, int] = {
    AvailabilitySla.SLA_99_9: 2,
    AvailabilitySla.SLA_99_95: 3,
    AvailabilitySla.SLA_99_99: 4,
}


class DeterministicSizingEngine(BaseSizingEngine):
    """Converts SLA, RPS, latency, and stateful requirements into an AllocationPlan."""

    engine_name = "deterministic-v1"

    def compute_plan(self, contract: ServiceEnvironmentContract) -> AllocationPlan:
        req = contract.requirements
        env = contract.metadata.environment
        provider = contract.target.provider

        family, vcpu, mem_mb, unit_cost = _INSTANCE_CATALOG[provider][req.workload_profile]
        gpu_count = 1 if req.workload_profile == WorkloadProfile.ML_INFERENCE else 0

        # Adjust effective RPS per replica for tighter latency budgets (< 100ms p99)
        latency_factor = 0.7 if req.p99_latency_ms < 100 else 1.0
        effective_rps_per_replica = max(10.0, _RPS_PER_REPLICA[req.workload_profile] * latency_factor)
        desired_replicas = math.ceil(req.expected_rps / effective_rps_per_replica)

        if env in {EnvironmentType.LOCAL, EnvironmentType.EPHEMERAL, EnvironmentType.DEV}:
            min_replicas = 1
            max_replicas = max(2, min(desired_replicas + 1, 6))
            spot_allowed = env != EnvironmentType.LOCAL
        elif env == EnvironmentType.STAGING:
            min_replicas = max(2, min(desired_replicas, 3))
            max_replicas = max(min_replicas + 2, desired_replicas * 2)
            spot_allowed = True
        else:
            min_replicas = max(_SLA_MIN_REPLICAS[req.availability_sla], desired_replicas)
            max_replicas = max(min_replicas + 2, math.ceil(min_replicas * 2.5))
            spot_allowed = False

        # Compute cluster nodes assuming 2 pods per node for isolation + headroom
        node_count = 1 if provider == ProviderType.LOCAL else max(min_replicas, math.ceil(min_replicas / 2) + 1)
        if env == EnvironmentType.PROD and contract.services.iaas.multi_az:
            node_count = max(3, node_count)

        compute_cost = 0.0 if provider == ProviderType.LOCAL else round(
            node_count * unit_cost * (0.45 if spot_allowed else 1.0), 2
        )

        # Database sizing
        needs_db = StatefulNeed.RELATIONAL_DB in req.stateful_needs
        if needs_db:
            if env == EnvironmentType.PROD and req.expected_rps >= 2500:
                db_tier, db_max_conn, db_cost = "db.r6g.large", 450, 295.0
            elif env == EnvironmentType.PROD:
                db_tier, db_max_conn, db_cost = "db.t4g.large", 200, 145.0
            else:
                db_tier, db_max_conn, db_cost = "db.t4g.small", 80, 28.0
            if provider == ProviderType.LOCAL:
                db_tier, db_cost = "postgres:16-alpine", 0.0

            db_multi_az = env == EnvironmentType.PROD and req.availability_sla in {
                AvailabilitySla.SLA_99_95,
                AvailabilitySla.SLA_99_99,
            }
            if db_multi_az:
                db_cost *= 1.85

            # Leave 20% headroom for migrations/admin connections, divide evenly across max replicas
            usable_conns = int(db_max_conn * 0.8)
            optimal_pool = max(4, min(32, usable_conns // max(1, max_replicas)))
            database_spec = DatabaseSpec(
                enabled=True,
                engine="postgresql-16",
                tier=db_tier,
                multi_az=db_multi_az,
                storage_gb=200 if env == EnvironmentType.PROD else 20,
                max_connections=db_max_conn,
                optimal_app_pool_size=optimal_pool,
                encrypted_at_rest=True,
            )
        else:
            db_cost = 0.0
            database_spec = DatabaseSpec(enabled=False, storage_gb=0, max_connections=0, optimal_app_pool_size=0)

        # Cache / Queue / Object Storage
        needs_cache = StatefulNeed.IN_MEMORY_CACHE in req.stateful_needs
        cache_tier = None
        cache_cost = 0.0
        if needs_cache:
            if provider == ProviderType.LOCAL:
                cache_tier, cache_cost = "redis:7-alpine", 0.0
            elif env == EnvironmentType.PROD:
                cache_tier, cache_cost = "cache.r6g.large", 165.0
            else:
                cache_tier, cache_cost = "cache.t4g.micro", 14.0

        needs_queue = StatefulNeed.MESSAGE_QUEUE in req.stateful_needs
        queue_cost = 18.0 if (needs_queue and provider != ProviderType.LOCAL) else 0.0

        needs_storage = StatefulNeed.OBJECT_STORAGE in req.stateful_needs
        storage_cost = 12.0 if (needs_storage and provider != ProviderType.LOCAL) else 0.0

        total_cost = round(compute_cost + db_cost + cache_cost + queue_cost + storage_cost, 2)
        budget = contract.day2.max_monthly_budget_usd

        strict_compliance = req.compliance_tier in {ComplianceTier.PCI, ComplianceTier.HIPAA}
        encryption_policies = {
            "kms_cmk_required": strict_compliance or contract.services.iaas.kms_cmk_rotation,
            "tls_min_version": "1.3",
            "enforce_mtls": strict_compliance or env == EnvironmentType.PROD,
            "audit_logging": strict_compliance,
            "compliance_tier": req.compliance_tier.value,
        }

        saas_bindings = {
            "edge_cdn": contract.services.saas.edge_cdn_provider,
            "identity_provider": contract.services.saas.identity_provider,
            "observability_sink": contract.services.saas.observability_sink,
            "managed_domains": contract.services.saas.managed_domains,
        }

        rationale = [
            f"Profile '{req.workload_profile.value}' mapped to {family} ({vcpu} vCPU, {mem_mb} MiB).",
            f"Expected {req.expected_rps} RPS @ p99={req.p99_latency_ms}ms requires {desired_replicas} active replicas; HPA bounded [{min_replicas}..{max_replicas}].",
            f"SLA {req.availability_sla.value}% on {env.value} scheduled across {node_count} node(s) (spot_allowed={spot_allowed}).",
        ]
        if needs_db:
            rationale.append(
                f"PostgreSQL {database_spec.tier} (max_conn={database_spec.max_connections}, multi_az={database_spec.multi_az}) -> optimal per-pod pool size = {database_spec.optimal_app_pool_size}."
            )

        return AllocationPlan(
            contract_name=contract.metadata.name,
            environment=env,
            provider=provider,
            control_plane=contract.target.control_plane,
            runtime=contract.target.runtime,
            region=contract.target.region,
            compute=ComputeSpec(
                instance_family=family,
                vcpu_per_unit=vcpu,
                memory_mb_per_unit=mem_mb,
                node_count=node_count,
                gpu_count=gpu_count,
                spot_allowed=spot_allowed,
            ),
            autoscaling=AutoscalingSpec(
                min_replicas=min_replicas,
                max_replicas=max_replicas,
                target_cpu_utilization=65 if req.p99_latency_ms < 100 else 75,
                scale_down_stabilization_sec=300 if env == EnvironmentType.PROD else 60,
            ),
            database=database_spec,
            cache_tier=cache_tier,
            queue_enabled=needs_queue,
            object_storage_encrypted=needs_storage,
            estimated_monthly_cost_usd=total_cost,
            budget_limit_usd=budget,
            within_budget=total_cost <= budget,
            encryption_policies=encryption_policies,
            saas_bindings=saas_bindings,
            sizing_rationale=rationale,
        )
