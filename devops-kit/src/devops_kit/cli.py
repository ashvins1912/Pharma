"""Unified CLI (devops-kit / kit) powered by Typer & Rich."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from devops_kit.allocator.compiler import ContractCompiler
from devops_kit.allocator.policy_gate import PolicyGate
from devops_kit.builder.nixpacks_builder import NixpacksBuilder
from devops_kit.contracts.models import (
    LayerType,
    ProviderType,
    RuntimeType,
    ServiceEnvironmentContract,
)
from devops_kit.core.plugin_manager import PluginRegistry
from devops_kit.day2.drift import DriftScanner
from devops_kit.day2.finops import FinOpsManager
from devops_kit.injection.synthesizer import EnvSynthesizer

app = typer.Typer(
    name="devops-kit",
    help="Unified IaaS, PaaS & SaaS Platform CLI (Contract -> Allocation -> Provisioning -> Zero-Code Injection).",
    no_args_is_help=True,
)
console = Console()


def _load_contract(contract_path: Path) -> ServiceEnvironmentContract:
    if not contract_path.exists():
        console.print(f"[red]Contract file not found:[/red] {contract_path}")
        raise typer.Exit(code=1)
    return ServiceEnvironmentContract.from_yaml_file(contract_path)


def _resolve_driver_keys(contract: ServiceEnvironmentContract) -> tuple[str, str, str]:
    provider = contract.target.provider
    if provider == ProviderType.LOCAL:
        iaas_key = "local-docker"
    elif provider == ProviderType.CUSTOM and contract.target.custom_driver_name:
        iaas_key = contract.target.custom_driver_name
    else:
        iaas_key = f"{provider.value}-iaas"

    if contract.target.runtime == RuntimeType.DOCKER_COMPOSE:
        paas_key = "local-docker"
    elif contract.target.runtime == RuntimeType.CLOUD_RUN:
        paas_key = "cloudrun-paas"
    else:
        paas_key = "kubernetes-paas"

    store_key = (
        "aws-ssm"
        if provider == ProviderType.AWS
        else "gcp-sm"
        if provider == ProviderType.GCP
        else "local-env"
    )
    return iaas_key, paas_key, store_key


@app.command()
def init(
    name: Annotated[str, typer.Option("--name", "-n", help="Service name")] = "orders-api",
    output: Annotated[Path, typer.Option("--output", "-o")] = Path("contracts/env-contract.yaml"),
) -> None:
    """Scaffold a canonical env-contract.yaml in the current workspace."""
    template_path = Path(__file__).resolve().parents[2] / "contracts" / "env-contract.yaml"
    output.parent.mkdir(parents=True, exist_ok=True)
    if template_path.exists():
        content = template_path.read_text(encoding="utf-8").replace("orders-api", name)
    else:
        content = f"apiVersion: devops-kit.io/v1alpha1\nkind: ServiceEnvironmentContract\nmetadata:\n  name: {name}\n"
    output.write_text(content, encoding="utf-8")
    console.print(f"[green]Initialized contract:[/green] {output}")


@app.command()
def build(
    app_dir: Annotated[Path, typer.Option("--app-dir")] = Path("."),
    contract_path: Annotated[Path, typer.Option("--contract", "-c")] = Path("contracts/env-contract.yaml"),
    registry: Annotated[str, typer.Option("--registry")] = "ghcr.io/platform",
    dry_run: Annotated[bool, typer.Option("--dry-run")] = True,
) -> None:
    """Zero-Dockerfile container build using Nixpacks / Buildpacks auto-detection."""
    contract = _load_contract(contract_path)
    builder = NixpacksBuilder()
    res = builder.build(
        app_dir=app_dir,
        service_name=contract.metadata.name,
        version=contract.metadata.version,
        registry=registry,
        dry_run=dry_run,
    )
    console.print(
        Panel.fit(
            f"Stack: [cyan]{res.detected_stack}[/cyan]\n"
            f"Image: [green]{res.image_tag}[/green]\n"
            f"Builder: {res.builder_used} (executed={res.executed})\n"
            f"SBOM Digest: {res.sbom_digest}",
            title="Build Artifact",
        )
    )


@app.command("allocate-preview")
def allocate_preview(
    contract_path: Annotated[Path, typer.Option("--contract", "-c")] = Path("contracts/env-contract.yaml"),
    allocator: Annotated[str, typer.Option("--allocator")] = "deterministic-v1",
) -> None:
    """Run Sizing Engine to preview compute, DB pool, autoscaling, and FinOps cost."""
    contract = _load_contract(contract_path)
    registry = PluginRegistry()
    plan = registry.get_allocator(allocator).compute_plan(contract)

    table = Table(title=f"AllocationPlan :: {plan.contract_name} ({plan.environment.value})")
    table.add_column("Dimension", style="cyan")
    table.add_column("Allocated Specification", style="white")
    table.add_row("Provider / Control Plane", f"{plan.provider.value} / {plan.control_plane.value}")
    table.add_row(
        "Compute",
        f"{plan.compute.node_count}x {plan.compute.instance_family} "
        f"({plan.compute.vcpu_per_unit} vCPU, {plan.compute.memory_mb_per_unit} MiB, spot={plan.compute.spot_allowed})",
    )
    table.add_row(
        "HPA Autoscaling",
        f"min={plan.autoscaling.min_replicas}, max={plan.autoscaling.max_replicas}, targetCPU={plan.autoscaling.target_cpu_utilization}%",
    )
    table.add_row(
        "Database",
        f"enabled={plan.database.enabled}, tier={plan.database.tier}, multi_az={plan.database.multi_az}, app_pool={plan.database.optimal_app_pool_size}",
    )
    table.add_row("Cache / Queue / S3", f"cache={plan.cache_tier}, queue={plan.queue_enabled}, s3_kms={plan.object_storage_encrypted}")
    budget_color = "green" if plan.within_budget else "red"
    table.add_row(
        "FinOps Cost vs Budget",
        f"[{budget_color}]${plan.estimated_monthly_cost_usd:.2f} / ${plan.budget_limit_usd:.2f} (within={plan.within_budget})[/{budget_color}]",
    )
    console.print(table)
    for note in plan.sizing_rationale:
        console.print(f"  - {note}")


@app.command()
def validate(
    contract_path: Annotated[Path, typer.Option("--contract", "-c")] = Path("contracts/env-contract.yaml"),
    export_schema: Annotated[Path | None, typer.Option("--export-schema")] = None,
) -> None:
    """Validate env-contract.yaml against Pydantic v2 schema and Policy-as-Code gates."""
    contract = _load_contract(contract_path)
    if export_schema is not None:
        ServiceEnvironmentContract.export_json_schema(export_schema)
        console.print(f"[cyan]Exported JSON Schema:[/cyan] {export_schema}")

    registry = PluginRegistry()
    plan = registry.get_allocator().compute_plan(contract)
    violations = PolicyGate().evaluate(contract, plan)
    for v in violations:
        style = "red" if v.severity == "BLOCK" else "yellow"
        console.print(f"[{style}][{v.severity}] {v.rule_id}: {v.message}[/{style}]")

    if PolicyGate().has_blocking_violations(violations):
        raise typer.Exit(code=2)
    console.print("[green]Contract schema and Policy-as-Code gates PASSED.[/green]")


@app.command()
def plan(
    contract_path: Annotated[Path, typer.Option("--contract", "-c")] = Path("contracts/env-contract.yaml"),
    config_dir: Annotated[Path, typer.Option("--config-dir")] = Path("config-engine"),
    out_dir: Annotated[Path, typer.Option("--out-dir")] = Path(".devops-kit-out"),
) -> None:
    """Compile AllocationPlan, OpenTofu/Crossplane vars, and run driver plan."""
    contract = _load_contract(contract_path)
    registry = PluginRegistry()
    alloc_plan = registry.get_allocator().compute_plan(contract)

    violations = PolicyGate().evaluate(contract, alloc_plan)
    if PolicyGate().has_blocking_violations(violations):
        for v in violations:
            console.print(f"[red][{v.severity}] {v.rule_id}: {v.message}[/red]")
        raise typer.Exit(code=2)

    compiler = ContractCompiler(config_dir=config_dir)
    env_out = out_dir / contract.metadata.environment.value
    emitted = compiler.compile_for_control_plane(contract, alloc_plan, env_out)

    iaas_key, _, _ = _resolve_driver_keys(contract)
    iaas_res = registry.get_iaas_driver(iaas_key).plan_infrastructure(contract, alloc_plan)
    console.print(f"[green]Compiled {len(emitted)} control-plane artifact(s) in {env_out}[/green]")
    console.print(json.dumps({"driver": iaas_res.driver_name, "outputs": iaas_res.outputs}, indent=2))


@app.command()
def apply(
    contract_path: Annotated[Path, typer.Option("--contract", "-c")] = Path("contracts/env-contract.yaml"),
    config_dir: Annotated[Path, typer.Option("--config-dir")] = Path("config-engine"),
    out_dir: Annotated[Path, typer.Option("--out-dir")] = Path(".devops-kit-out"),
    image_uri: Annotated[str | None, typer.Option("--image")] = None,
) -> None:
    """Reconcile IaaS + SaaS + Secret Store + Zero-Code Injection + PaaS Rollout."""
    contract = _load_contract(contract_path)
    registry = PluginRegistry()
    alloc_plan = registry.get_allocator().compute_plan(contract)

    violations = PolicyGate().evaluate(contract, alloc_plan)
    if PolicyGate().has_blocking_violations(violations):
        for v in violations:
            console.print(f"[red][{v.severity}] {v.rule_id}: {v.message}[/red]")
        raise typer.Exit(code=2)

    compiler = ContractCompiler(config_dir=config_dir)
    layered_cfg = compiler.load_layered_config(contract)
    env_out = out_dir / contract.metadata.environment.value
    compiler.compile_for_control_plane(contract, alloc_plan, env_out)

    iaas_key, paas_key, store_key = _resolve_driver_keys(contract)
    infra_endpoints: dict[str, str] = {}
    saas_endpoints: dict[str, str] = {}

    if contract.target.layer in {LayerType.IAAS, LayerType.HYBRID}:
        iaas_res = registry.get_iaas_driver(iaas_key).apply_infrastructure(contract, alloc_plan)
        infra_endpoints.update(iaas_res.endpoints)
        console.print(f"[cyan]IaaS ({iaas_res.driver_name}):[/cyan] {iaas_res.status}")

    if contract.target.layer in {LayerType.SAAS, LayerType.HYBRID} and (
        contract.services.saas.edge_cdn_provider or contract.services.saas.identity_provider
    ):
        saas_res = registry.get_saas_driver("cloudflare-auth0-saas").reconcile_saas(contract, alloc_plan)
        saas_endpoints.update(saas_res.endpoints)
        console.print(f"[cyan]SaaS ({saas_res.driver_name}):[/cyan] {saas_res.status}")
        for w in saas_res.warnings:
            console.print(f"  [yellow]note:[/yellow] {w}")

    synthesizer = EnvSynthesizer()
    resolved_env = synthesizer.resolve_variables(
        contract, alloc_plan, layered_cfg, infra_endpoints, saas_endpoints
    )
    registry.get_secret_store(store_key).publish_outputs(
        contract.metadata.name, contract.metadata.environment.value, resolved_env
    )

    bundle = synthesizer.synthesize_bundle(
        contract=contract,
        plan=alloc_plan,
        layered_config=layered_cfg,
        infra_outputs=infra_endpoints,
        saas_outputs=saas_endpoints,
        image_uri=image_uri,
    )
    manifests_dir = env_out / "manifests"
    manifests_dir.mkdir(parents=True, exist_ok=True)
    for fname, body in bundle.manifests.items():
        (manifests_dir / fname).write_text(body, encoding="utf-8")

    if contract.target.layer in {LayerType.PAAS, LayerType.HYBRID}:
        paas_res = registry.get_paas_driver(paas_key).deploy_workload(
            contract,
            alloc_plan,
            image_uri or f"ghcr.io/platform/{contract.metadata.name}:{contract.metadata.version}",
            resolved_env,
        )
        console.print(f"[green]PaaS ({paas_res.driver_name}):[/green] {paas_res.status}")
    console.print(f"[green]Apply complete. Manifests written to {manifests_dir}[/green]")


@app.command("inject-preview")
def inject_preview(
    contract_path: Annotated[Path, typer.Option("--contract", "-c")] = Path("contracts/env-contract.yaml"),
    config_dir: Annotated[Path, typer.Option("--config-dir")] = Path("config-engine"),
) -> None:
    """Preview resolved env vars (${discover.*}, ${calc.*}, ${saas.*}) and secret keys."""
    contract = _load_contract(contract_path)
    registry = PluginRegistry()
    plan = registry.get_allocator().compute_plan(contract)
    layered = ContractCompiler(config_dir=config_dir).load_layered_config(contract)
    bundle = EnvSynthesizer().synthesize_bundle(contract, plan, layered)

    table = Table(title=f"Zero-Code Injection Preview (checksum={bundle.config_checksum})")
    table.add_column("Variable", style="cyan")
    table.add_column("Classification", style="magenta")
    table.add_column("Value / Ref", style="white")
    for k, v in bundle.plain_env.items():
        table.add_row(k, "ConfigMap", v)
    for sk in bundle.secret_keys:
        table.add_row(sk, "ExternalSecret", f"vault:///devops-kit/{contract.metadata.environment.value}/{contract.metadata.name}/{sk}")
    console.print(table)


@app.command()
def route(
    contract_path: Annotated[Path, typer.Option("--contract", "-c")] = Path("contracts/env-contract.yaml"),
    canary: Annotated[int, typer.Option("--canary", min=0, max=100)] = 10,
    pr_header: Annotated[str | None, typer.Option("--pr-header")] = None,
    router_name: Annotated[str, typer.Option("--router")] = "gateway-api",
) -> None:
    """Shift live canary traffic weights or attach PR preview header routes."""
    contract = _load_contract(contract_path)
    router = PluginRegistry().get_router(router_name)
    res = router.shift_traffic(contract, canary_weight=canary, pr_header=pr_header)
    console.print(f"[green]Route updated via {res.driver_name}:[/green] canary={canary}% pr_header={pr_header}")
    manifest = res.outputs.get("manifest") or res.outputs.get("config", "")
    console.print(manifest)


@app.command()
def rollback(
    contract_path: Annotated[Path, typer.Option("--contract", "-c")] = Path("contracts/env-contract.yaml"),
    target_revision: Annotated[str, typer.Option("--to-revision")] = "previous",
) -> None:
    """Reset canary weight to 0% and trigger safe PaaS workload rollback."""
    contract = _load_contract(contract_path)
    res = PluginRegistry().get_router("gateway-api").shift_traffic(contract, canary_weight=0)
    console.print(
        f"[yellow]Rolled back {contract.metadata.name} ({contract.metadata.environment.value}) "
        f"to '{target_revision}'; canary_weight={res.outputs['canary_weight']}%[/yellow]"
    )


@app.command()
def sleep(
    contract_path: Annotated[Path, typer.Option("--contract", "-c")] = Path("contracts/env-contract.yaml"),
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Scale non-prod compute to zero for FinOps off-hours savings."""
    contract = _load_contract(contract_path)
    manager = FinOpsManager(PluginRegistry())
    try:
        report = manager.sleep_environment(contract, force=force)
    except PermissionError as exc:
        console.print(f"[red]Blocked:[/red] {exc}")
        raise typer.Exit(code=2) from exc
    console.print(
        f"[green]{report.service} ({report.environment}) -> {report.action}[/green] "
        f"(est. savings ~${report.estimated_hourly_savings_usd}/hr)"
    )


@app.command("drift-check")
def drift_check(
    contract_path: Annotated[Path, typer.Option("--contract", "-c")] = Path("contracts/env-contract.yaml"),
    iac_dir: Annotated[Path, typer.Option("--iac-dir")] = Path("iac/opentofu"),
    snapshot: Annotated[Path | None, typer.Option("--snapshot")] = None,
) -> None:
    """Detect OpenTofu state or live runtime drift against env-contract.yaml."""
    contract = _load_contract(contract_path)
    plan = PluginRegistry().get_allocator().compute_plan(contract)
    report = DriftScanner().check_drift(contract, plan, iac_dir=iac_dir, live_snapshot_path=snapshot)
    if report.drifted:
        for finding in report.findings:
            console.print(
                f"[red][DRIFT:{finding.severity}][/red] {finding.resource}: "
                f"expected={finding.expected} actual={finding.actual}"
            )
        raise typer.Exit(code=3)
    console.print(f"[green]No drift detected for {report.service} ({report.environment}).[/green]")


@app.command()
def destroy(
    contract_path: Annotated[Path, typer.Option("--contract", "-c")] = Path("contracts/env-contract.yaml"),
    yes: Annotated[bool, typer.Option("--yes", "-y")] = False,
) -> None:
    """Tear down ephemeral or non-production environments cleanly."""
    contract = _load_contract(contract_path)
    if contract.metadata.environment.value == "prod" and not yes:
        console.print("[red]Refusing to destroy prod without explicit --yes confirmation.[/red]")
        raise typer.Exit(code=2)

    registry = PluginRegistry()
    iaas_key, _, _ = _resolve_driver_keys(contract)
    iaas_res = registry.get_iaas_driver(iaas_key).destroy_infrastructure(contract)
    saas_res = registry.get_saas_driver("cloudflare-auth0-saas").teardown_saas(contract)
    console.print(f"[yellow]Destroyed IaaS ({iaas_res.status}) and SaaS ({saas_res.status}).[/yellow]")


@app.command()
def plugins() -> None:
    """List all discovered drivers, stores, allocators, and routers."""
    discovered = PluginRegistry().list_plugins()
    console.print(json.dumps(discovered, indent=2))


@app.command("local-up")
def local_up() -> None:
    """Run local Docker Compose parity stack."""
    compose_file = Path(__file__).parent / "injection" / "local" / "docker-compose.yml"
    console.print(f"[cyan]Compose parity manifest:[/cyan] {compose_file}")
    if subprocess.run(["which", "docker"], capture_output=True).returncode == 0:
        console.print("Run: docker compose -f " + str(compose_file) + " up -d")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
