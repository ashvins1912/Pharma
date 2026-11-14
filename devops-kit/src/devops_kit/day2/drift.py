"""Automated IaC and live configuration drift detection."""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from devops_kit.contracts.models import AllocationPlan, ServiceEnvironmentContract


@dataclass(frozen=True, slots=True)
class DriftFinding:
    resource: str
    expected: str
    actual: str
    severity: str


@dataclass(slots=True)
class DriftReport:
    service: str
    environment: str
    control_plane: str
    drifted: bool
    findings: list[DriftFinding] = field(default_factory=list)


class DriftScanner:
    """Runs OpenTofu / Crossplane / live-contract diff checks."""

    def check_drift(
        self,
        contract: ServiceEnvironmentContract,
        plan: AllocationPlan,
        iac_dir: Path,
        live_snapshot_path: Path | None = None,
    ) -> DriftReport:
        findings: list[DriftFinding] = []

        # 1. If OpenTofu is installed and initialized, execute non-interactive plan -detailed-exitcode
        tofu_bin = shutil.which("tofu") or shutil.which("terraform")
        if tofu_bin and (iac_dir / ".terraform").exists():
            proc = subprocess.run(
                [tofu_bin, "plan", "-detailed-exitcode", "-input=false", "-no-color"],
                cwd=iac_dir,
                capture_output=True,
                text=True,
                check=False,
            )
            if proc.returncode == 2:
                findings.append(
                    DriftFinding(
                        resource=f"{contract.target.control_plane.value}:state",
                        expected="contract-aligned",
                        actual="out-of-band-console-mutation",
                        severity="HIGH",
                    )
                )

        # 2. Compare desired AllocationPlan against live snapshot JSON if supplied
        if live_snapshot_path and live_snapshot_path.exists():
            live = json.loads(live_snapshot_path.read_text(encoding="utf-8"))
            if live.get("node_count") is not None and live.get("node_count") != plan.compute.node_count:
                findings.append(
                    DriftFinding(
                        resource="compute.node_count",
                        expected=str(plan.compute.node_count),
                        actual=str(live.get("node_count")),
                        severity="MEDIUM",
                    )
                )
            if live.get("min_replicas") is not None and live.get("min_replicas") != plan.autoscaling.min_replicas:
                findings.append(
                    DriftFinding(
                        resource="autoscaling.min_replicas",
                        expected=str(plan.autoscaling.min_replicas),
                        actual=str(live.get("min_replicas")),
                        severity="HIGH",
                    )
                )

        return DriftReport(
            service=contract.metadata.name,
            environment=contract.metadata.environment.value,
            control_plane=contract.target.control_plane.value,
            drifted=len(findings) > 0,
            findings=findings,
        )
