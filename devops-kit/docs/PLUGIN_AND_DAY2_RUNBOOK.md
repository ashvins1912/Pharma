# DevOps Kit: Plugin Authoring Guide & Day-2 Operations Runbook

## 1. Authoring a Custom Plugin (Third-Party Extension)

External teams can extend `devops-kit` without modifying core repository code by publishing any Python package that declares standard `importlib.metadata` entry points in `pyproject.toml`.

### Step 1: Implement the Interface

```python
from devops_kit.contracts.models import AllocationPlan, ServiceEnvironmentContract
from devops_kit.core.interfaces import BaseIaasDriver, DriverExecutionResult

class BareMetalMaasDriver(BaseIaasDriver):
    driver_name = "maas-baremetal"

    def plan_infrastructure(
        self, contract: ServiceEnvironmentContract, plan: AllocationPlan
    ) -> DriverExecutionResult:
        return DriverExecutionResult(
            driver_name=self.driver_name,
            layer="iaas",
            status="planned",
            outputs={"machine_pool": plan.compute.instance_family},
        )

    def apply_infrastructure(
        self, contract: ServiceEnvironmentContract, plan: AllocationPlan
    ) -> DriverExecutionResult:
        return DriverExecutionResult(
            driver_name=self.driver_name,
            layer="iaas",
            status="applied",
            endpoints={"PRIVATE_VLAN_CIDR": contract.services.iaas.vpc_cidr},
        )

    def destroy_infrastructure(self, contract: ServiceEnvironmentContract) -> DriverExecutionResult:
        return DriverExecutionResult(
            driver_name=self.driver_name, layer="iaas", status="released"
        )
```

### Step 2: Register Entry Point in Your Plugin's `pyproject.toml`

```toml
[project.entry-points."devops_kit.drivers"]
"maas-baremetal" = "my_org_plugin.maas:BareMetalMaasDriver"
```

Once `pip install my-org-plugin` completes, verify discovery via:

```bash
kit plugins
```

Reference it in `env-contract.yaml` using `target.provider: custom` and `target.custom_driver_name: maas-baremetal`.

---

## 2. Day-2 Operations Runbook

### A. Progressive Canary Delivery & Instant Rollback
- **Shift 20% traffic to canary:** `kit route -c contracts/env-contract.yaml --canary 20`
- **Route ephemeral PR traffic via header:** `kit route -c contracts/env-contract.yaml --canary 0 --pr-header pr-418`
- **Immediate rollback on SLO burn:** `kit rollback -c contracts/env-contract.yaml --to-revision previous`

### B. FinOps Auto-Sleep (Non-Prod Only)
- Put dev/staging compute to sleep off-hours (preserves RDS/EBS volumes):
  `kit sleep -c contracts/env-contract.yaml`
- Production is protected by default (`PermissionError` unless `--force` is passed).

### C. Drift Detection & Reconciliation
- Hourly GitHub Action executes `kit drift-check --contract contracts/env-contract.yaml --iac-dir iac/opentofu`.
- Exit code `3` alerts SRE channels if console mutations diverge from `AllocationPlan` or OpenTofu state.

### D. Zero-Code vs Python SDK Mode
- **Zero-Code Mode (any language):** `kit apply` writes ConfigMaps + ExternalSecrets + Stakater Reloader annotations (`reloader.stakater.com/auto: "true"`) and `.env.resolved` for local Docker Compose parity.
- **Python SDK Mode:** Use `DynamicRuntime` (`with DynamicRuntime() as rt:`) for background polling, `@rt.inject_env()`, feature flags (`rt.flag("enable_instant_settlement")`), and circuit-breaker endpoint failover.
