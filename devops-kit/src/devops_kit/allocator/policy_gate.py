"""Policy-as-Code compliance and FinOps guardrail checks."""

from __future__ import annotations

from dataclasses import dataclass

from devops_kit.contracts.models import (
    AllocationPlan,
    ComplianceTier,
    EnvironmentType,
    ServiceEnvironmentContract,
)


@dataclass(frozen=True, slots=True)
class PolicyViolation:
    rule_id: str
    severity: str  # "BLOCK" | "WARN"
    message: str


class PolicyGate:
    """Enforces FinOps budgets, encryption, network isolation, and zero-trust guardrails."""

    def evaluate(
        self, contract: ServiceEnvironmentContract, plan: AllocationPlan
    ) -> list[PolicyViolation]:
        violations: list[PolicyViolation] = []

        # 1. FinOps Budget Check
        if not plan.within_budget:
            violations.append(
                PolicyViolation(
                    rule_id="FINOPS-001",
                    severity="BLOCK",
                    message=(
                        f"Estimated monthly cost ${plan.estimated_monthly_cost_usd:.2f} exceeds "
                        f"max_monthly_budget_usd ${plan.budget_limit_usd:.2f}."
                    ),
                )
            )

        # 2. PCI / HIPAA Encryption & Network Isolation
        if contract.requirements.compliance_tier in {ComplianceTier.PCI, ComplianceTier.HIPAA}:
            if not contract.services.iaas.private_subnets_only:
                violations.append(
                    PolicyViolation(
                        rule_id="SEC-001",
                        severity="BLOCK",
                        message="PCI/HIPAA compliance requires private_subnets_only=true.",
                    )
                )
            if not plan.encryption_policies.get("kms_cmk_required"):
                violations.append(
                    PolicyViolation(
                        rule_id="SEC-002",
                        severity="BLOCK",
                        message="PCI/HIPAA compliance requires KMS CMK encryption.",
                    )
                )

        # 3. Secret rotation & auto-reload guardrails in Prod
        if contract.metadata.environment == EnvironmentType.PROD:
            if contract.day2.secret_rotation_days > 90:
                violations.append(
                    PolicyViolation(
                        rule_id="SEC-003",
                        severity="BLOCK",
                        message="Production secret_rotation_days must be <= 90 days.",
                    )
                )
            if not contract.services.iaas.multi_az:
                violations.append(
                    PolicyViolation(
                        rule_id="REL-001",
                        severity="WARN",
                        message="Production workload has multi_az=false; single-AZ outage risk.",
                    )
                )

        # 4. Object Storage Encryption
        if plan.object_storage_encrypted and not plan.encryption_policies.get("kms_cmk_required"):
            violations.append(
                PolicyViolation(
                    rule_id="SEC-004",
                    severity="BLOCK",
                    message="Object storage must enforce KMS encryption and block public ACLs.",
                )
            )

        return violations

    def has_blocking_violations(self, violations: list[PolicyViolation]) -> bool:
        return any(v.severity == "BLOCK" for v in violations)
