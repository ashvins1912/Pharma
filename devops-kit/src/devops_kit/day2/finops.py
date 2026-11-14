"""Day-2 FinOps automation: auto-sleep schedules and scale-to-zero safety checks."""

from __future__ import annotations

from dataclasses import dataclass

from devops_kit.contracts.models import EnvironmentType, ServiceEnvironmentContract
from devops_kit.core.plugin_manager import PluginRegistry


@dataclass(frozen=True, slots=True)
class SleepExecutionReport:
    service: str
    environment: str
    action: str
    estimated_hourly_savings_usd: float
    details: str


class FinOpsManager:
    """Manages off-hours hibernation across PaaS runtimes with Prod protection."""

    def __init__(self, registry: PluginRegistry) -> None:
        self.registry = registry

    def sleep_environment(
        self, contract: ServiceEnvironmentContract, force: bool = False
    ) -> SleepExecutionReport:
        env = contract.metadata.environment
        if env == EnvironmentType.PROD and not force:
            raise PermissionError(
                "Refusing to scale-to-zero production environment without --force override."
            )

        driver_key = (
            "local-docker"
            if contract.target.runtime.value == "docker-compose"
            else "cloudrun-paas"
            if contract.target.runtime.value == "cloud-run"
            else "kubernetes-paas"
        )
        paas_driver = self.registry.get_paas_driver(driver_key)
        result = paas_driver.scale_to_zero(contract)
        savings = round(contract.day2.max_monthly_budget_usd / 730.0 * 0.7, 2)
        return SleepExecutionReport(
            service=contract.metadata.name,
            environment=env.value,
            action=result.status,
            estimated_hourly_savings_usd=savings,
            details=f"Scaled replicas to 0 via {driver_key}; stateful volumes preserved.",
        )
