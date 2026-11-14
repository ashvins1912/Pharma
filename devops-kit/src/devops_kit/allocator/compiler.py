"""Compiles layered config overlays and AllocationPlan into control-plane artifacts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from devops_kit.contracts.models import (
    AllocationPlan,
    ControlPlaneType,
    ServiceEnvironmentContract,
)


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


class ContractCompiler:
    """Resolves base -> region -> env overlays and generates OpenTofu/Crossplane vars."""

    def __init__(self, config_dir: Path | None = None) -> None:
        self.config_dir = config_dir

    def load_layered_config(self, contract: ServiceEnvironmentContract) -> dict[str, Any]:
        merged: dict[str, Any] = {}
        if self.config_dir and self.config_dir.exists():
            candidates = [
                self.config_dir / "base.yaml",
                self.config_dir / f"region.{contract.target.region}.yaml",
                self.config_dir / f"env.{contract.metadata.environment.value}.yaml",
            ]
            for file_path in candidates:
                if file_path.exists():
                    data = yaml.safe_load(file_path.read_text(encoding="utf-8")) or {}
                    if isinstance(data, dict):
                        merged = _deep_merge(merged, data)
        return merged

    def write_allocation_plan(self, plan: AllocationPlan, output_dir: Path) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        plan_path = output_dir / "allocation-plan.json"
        plan_path.write_text(plan.model_dump_json(indent=2), encoding="utf-8")
        return plan_path

    def compile_opentofu_tfvars(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        output_dir: Path,
    ) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        tfvars = {
            "service_name": contract.metadata.name,
            "environment": contract.metadata.environment.value,
            "owner": contract.metadata.owner,
            "cost_center": contract.metadata.cost_center,
            "provider_name": contract.target.provider.value,
            "region": contract.target.region,
            "vpc_cidr": contract.services.iaas.vpc_cidr,
            "multi_az": contract.services.iaas.multi_az,
            "private_subnets_only": contract.services.iaas.private_subnets_only,
            "kms_cmk_rotation": contract.services.iaas.kms_cmk_rotation,
            "compute_instance_family": plan.compute.instance_family,
            "compute_node_count": plan.compute.node_count,
            "db_enabled": plan.database.enabled,
            "db_tier": plan.database.tier,
            "db_multi_az": plan.database.multi_az,
            "db_storage_gb": plan.database.storage_gb,
            "cache_tier": plan.cache_tier or "",
            "queue_enabled": plan.queue_enabled,
            "object_storage_encrypted": plan.object_storage_encrypted,
            "compliance_tier": contract.requirements.compliance_tier.value,
        }
        tfvars_path = output_dir / "terraform.tfvars.json"
        tfvars_path.write_text(json.dumps(tfvars, indent=2), encoding="utf-8")
        return tfvars_path

    def compile_crossplane_claim(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        output_dir: Path,
    ) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        claim = {
            "apiVersion": "platform.devops-kit.io/v1alpha1",
            "kind": "ServiceStackClaim",
            "metadata": {
                "name": f"{contract.metadata.name}-{contract.metadata.environment.value}",
                "namespace": contract.services.paas.kubernetes_namespace,
                "labels": {
                    "devops-kit.io/owner": contract.metadata.owner,
                    "devops-kit.io/cost-center": contract.metadata.cost_center,
                },
            },
            "spec": {
                "provider": contract.target.provider.value,
                "region": contract.target.region,
                "parameters": {
                    "computeInstanceFamily": plan.compute.instance_family,
                    "nodeCount": plan.compute.node_count,
                    "databaseEnabled": plan.database.enabled,
                    "databaseTier": plan.database.tier,
                    "cacheTier": plan.cache_tier,
                    "complianceTier": contract.requirements.compliance_tier.value,
                },
                "writeConnectionSecretToRef": {
                    "name": f"{contract.metadata.name}-infra-conn",
                },
            },
        }
        claim_path = output_dir / "crossplane-claim.yaml"
        claim_path.write_text(yaml.safe_dump(claim, sort_keys=False), encoding="utf-8")
        return claim_path

    def compile_for_control_plane(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        output_dir: Path,
    ) -> list[Path]:
        generated = [self.write_allocation_plan(plan, output_dir)]
        if contract.target.control_plane == ControlPlaneType.CROSSPLANE:
            generated.append(self.compile_crossplane_claim(contract, plan, output_dir))
        else:
            generated.append(self.compile_opentofu_tfvars(contract, plan, output_dir))
        return generated
