"""Zero-code environment variable & secret manifest synthesizer."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from string import Template
from typing import Any

import yaml

from devops_kit.contracts.models import AllocationPlan, ServiceEnvironmentContract

_EXPR_PATTERN = re.compile(r"\$\{([a-zA-Z0-9_.-]+)\}")


@dataclass(frozen=True, slots=True)
class SynthesizedBundle:
    plain_env: dict[str, str]
    secret_keys: list[str]
    config_checksum: str
    manifests: dict[str, str]


class EnvSynthesizer:
    """Evaluates layered configs, ${discover.*} / ${calc.*} / ${saas.*} tokens, and renders manifests."""

    def __init__(self, templates_dir: Path | None = None) -> None:
        self.templates_dir = templates_dir or (Path(__file__).parent / "k8s")

    def resolve_variables(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        layered_config: dict[str, Any],
        infra_outputs: dict[str, str],
        saas_outputs: dict[str, str],
    ) -> dict[str, str]:
        env_map: dict[str, str] = {
            "APP_NAME": contract.metadata.name,
            "APP_ENV": contract.metadata.environment.value,
            "APP_VERSION": contract.metadata.version,
            "CLOUD_PROVIDER": contract.target.provider.value,
            "CLOUD_REGION": contract.target.region,
            "PUBLIC_DOMAIN": contract.routing_and_injection.public_domain,
            "PATH_PREFIX": contract.routing_and_injection.path_prefix,
        }

        # Flatten layered YAML keys into UPPER_SNAKE_CASE runtime defaults
        runtime_cfg = layered_config.get("runtime", {})
        if isinstance(runtime_cfg, dict):
            for k, v in runtime_cfg.items():
                env_map[f"RUNTIME_{k.upper()}"] = str(v)

        # Inject feature flags as FF_<NAME>
        for flag_name, flag_val in contract.routing_and_injection.feature_flags.items():
            env_map[f"FF_{flag_name.upper()}"] = "true" if flag_val else "false"

        # Inject raw infrastructure & SaaS endpoints
        for k, v in infra_outputs.items():
            env_map[k.upper()] = str(v)
        for k, v in saas_outputs.items():
            env_map[k.upper()] = str(v)

        # Build expression resolver table
        namespace = contract.services.paas.kubernetes_namespace
        discovery_table: dict[str, str] = {
            f"discover.{dep}.internal_url": f"http://{dep}.{namespace}.svc.cluster.local:8080"
            for dep in contract.routing_and_injection.dependencies
        }
        calc_table: dict[str, str] = {
            "calc.optimal_db_pool": str(plan.database.optimal_app_pool_size),
            "calc.min_replicas": str(plan.autoscaling.min_replicas),
            "calc.max_replicas": str(plan.autoscaling.max_replicas),
        }
        saas_table: dict[str, str] = {
            f"saas.{k.lower().replace('_', '.')}": str(v) for k, v in saas_outputs.items()
        }
        # Normalize common saas shorthand keys
        if "CLOUDFLARE_WAF_MODE" in saas_outputs:
            saas_table["saas.cloudflare.waf_mode"] = saas_outputs["CLOUDFLARE_WAF_MODE"]
        if "AUTH0_ISSUER_URL" in saas_outputs:
            saas_table["saas.auth0.issuer_url"] = saas_outputs["AUTH0_ISSUER_URL"]

        lookup = {**discovery_table, **calc_table, **saas_table}

        def _replace(match: re.Match[str]) -> str:
            token = match.group(1)
            return lookup.get(token, match.group(0))

        for env_key, rule_expr in contract.routing_and_injection.dynamic_env_rules.items():
            env_map[env_key] = _EXPR_PATTERN.sub(_replace, rule_expr)

        return dict(sorted(env_map.items()))

    def synthesize_bundle(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        layered_config: dict[str, Any],
        infra_outputs: dict[str, str] | None = None,
        saas_outputs: dict[str, str] | None = None,
        image_uri: str | None = None,
    ) -> SynthesizedBundle:
        infra = infra_outputs or self._default_infra_outputs(contract, plan)
        saas = saas_outputs or self._default_saas_outputs(contract)
        resolved = self.resolve_variables(contract, plan, layered_config, infra, saas)

        secret_markers = ("SECRET", "PASSWORD", "TOKEN", "KEY", "DATABASE_URL", "REDIS_URL")
        secret_keys = [k for k in resolved if any(m in k for m in secret_markers)]
        plain_env = {k: v for k, v in resolved.items() if k not in secret_keys}

        checksum_payload = json.dumps(resolved, sort_keys=True).encode("utf-8")
        checksum = hashlib.sha256(checksum_payload).hexdigest()[:16]

        manifests = self._render_k8s_manifests(
            contract=contract,
            plan=plan,
            plain_env=plain_env,
            secret_keys=secret_keys,
            checksum=checksum,
            image_uri=image_uri
            or f"ghcr.io/platform/{contract.metadata.name}:{contract.metadata.version}",
        )

        # Include local .env parity artifact
        dotenv_lines = [f"{k}={v}" for k, v in resolved.items()]
        manifests[".env.resolved"] = "\n".join(dotenv_lines) + "\n"

        return SynthesizedBundle(
            plain_env=plain_env,
            secret_keys=secret_keys,
            config_checksum=checksum,
            manifests=manifests,
        )

    def _default_infra_outputs(
        self, contract: ServiceEnvironmentContract, plan: AllocationPlan
    ) -> dict[str, str]:
        svc = contract.metadata.name
        env = contract.metadata.environment.value
        outputs: dict[str, str] = {}
        if plan.database.enabled:
            outputs["DATABASE_URL"] = (
                f"postgresql://app_user:${{SECRET_DB_PASS}}@{svc}-{env}-pg.internal:5432/{svc}?sslmode=require"
            )
        if plan.cache_tier:
            outputs["REDIS_URL"] = f"rediss://{svc}-{env}-redis.internal:6379/0"
        if plan.object_storage_encrypted:
            outputs["S3_BUCKET_NAME"] = f"{svc}-{env}-{contract.target.region}-artifacts"
        if plan.queue_enabled:
            outputs["QUEUE_ENDPOINT"] = f"https://sqs.{contract.target.region}.amazonaws.com/000000000000/{svc}-{env}"
        return outputs

    def _default_saas_outputs(self, contract: ServiceEnvironmentContract) -> dict[str, str]:
        outputs: dict[str, str] = {}
        if contract.services.saas.edge_cdn_provider:
            outputs["CLOUDFLARE_WAF_MODE"] = (
                "block" if contract.metadata.environment.value == "prod" else "simulate"
            )
            outputs["EDGE_ZONE_HOST"] = contract.routing_and_injection.public_domain
        if contract.services.saas.identity_provider:
            outputs["AUTH0_ISSUER_URL"] = (
                f"https://{contract.metadata.environment.value}.auth.acme-commerce.io/"
            )
        return outputs

    def _render_k8s_manifests(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        plain_env: dict[str, str],
        secret_keys: list[str],
        checksum: str,
        image_uri: str,
    ) -> dict[str, str]:
        ns = contract.services.paas.kubernetes_namespace
        svc = contract.metadata.name
        env = contract.metadata.environment.value

        # ConfigMap YAML
        config_map = {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {
                "name": f"{svc}-runtime-config",
                "namespace": ns,
                "labels": {"app.kubernetes.io/name": svc, "devops-kit.io/env": env},
            },
            "data": plain_env,
        }

        subs = {
            "SERVICE_NAME": svc,
            "NAMESPACE": ns,
            "ENVIRONMENT": env,
            "IMAGE_URI": image_uri,
            "REPLICAS": str(plan.autoscaling.min_replicas),
            "CPU_REQUEST": f"{int(plan.compute.vcpu_per_unit * 250)}m",
            "MEM_REQUEST": f"{max(256, plan.compute.memory_mb_per_unit // 4)}Mi",
            "CPU_LIMIT": f"{int(plan.compute.vcpu_per_unit * 500)}m",
            "MEM_LIMIT": f"{max(512, plan.compute.memory_mb_per_unit // 2)}Mi",
            "CONFIG_CHECKSUM": checksum,
            "RELOAD_ANNOTATIONS": (
                'reloader.stakater.com/auto: "true"'
                if contract.day2.auto_reload
                else 'reloader.stakater.com/auto: "false"'
            ),
            "SECRET_STORE_NAME": f"{contract.target.provider.value}-secret-store",
            "REFRESH_INTERVAL": f"{max(1, contract.day2.secret_rotation_days)}h",
            "SECRET_DATA_ITEMS": "\n".join(
                f"    - secretKey: {k}\n      remoteRef:\n        key: /devops-kit/{env}/{svc}/{k}"
                for k in (secret_keys or ["APP_PLACEHOLDER_KEY"])
            ),
            "PUBLIC_DOMAIN": contract.routing_and_injection.public_domain,
            "PATH_PREFIX": contract.routing_and_injection.path_prefix,
            "STABLE_WEIGHT": str(100 - contract.routing_and_injection.canary_weight_percent),
            "CANARY_WEIGHT": str(contract.routing_and_injection.canary_weight_percent),
        }

        rendered: dict[str, str] = {
            "configmap.yaml": yaml.safe_dump(config_map, sort_keys=False),
        }

        for tmpl_name, out_name in (
            ("deployment.yaml.tmpl", "deployment.yaml"),
            ("external-secret.yaml.tmpl", "external-secret.yaml"),
            ("httproute.yaml.tmpl", "httproute.yaml"),
        ):
            tmpl_path = self.templates_dir / tmpl_name
            if tmpl_path.exists():
                rendered[out_name] = Template(tmpl_path.read_text(encoding="utf-8")).safe_substitute(
                    subs
                )
        return rendered
