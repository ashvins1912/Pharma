# Super Admin DevOps and Deployment Control Plane

## Purpose

The Super Admin Infrastructure & Resource Operations workspace now includes a DevOps Deployment Control Center. It is a governance and orchestration surface for generating deployment artifacts, versioning non-secret configuration, planning releases, collecting approvals, submitting typed deployment requests, tracking provider status, requesting rollback and applying LaunchDarkly-style feature-flag rollouts.

The control center does **not** expose a remote terminal, shell playground, arbitrary command runner, SQL console, generic HTTP proxy or browser-to-cloud credential path. The application creates declarative artifacts and submits narrowly typed jobs to a private control-plane adapter. Provider-side Terraform, Kubernetes, Ansible and cloud SDK execution belongs to that trusted adapter or a protected CI runner, not to an interactive browser session.

## Admin endpoints

All routes are mounted at `/api/v1/admin/devops`, behind API Gateway and authenticated Super Admin authorization.

| Endpoint | Purpose |
| --- | --- |
| `GET /catalog` | Supported runtimes, providers, templates, environments, rollout strategies and safety boundaries |
| `POST /artifacts/generate` | Generate a versioned deployment bundle and run initial policy checks |
| `GET /artifacts` | List generated artifact metadata |
| `GET /artifacts/:id` | Retrieve one artifact and generated files |
| `POST /artifacts/:id/validate` | Re-run artifact path, secret, Docker and rollout-policy checks |
| `POST /configurations` | Save a versioned non-secret configuration and external secret references |
| `GET /configurations` | List configuration versions |
| `POST /deployments/plan` | Create a deployment plan in `PENDING_APPROVAL` |
| `GET /deployments` | List deployment plans and provider execution states |
| `POST /deployments/:id/approve` | Approve a pending deployment; production requires a different Super Admin |
| `POST /deployments/:id/execute` | Submit an approved deployment to the private adapter |
| `GET /deployments/:id/status` | Refresh state from the provider adapter |
| `POST /deployments/:id/rollback` | Request provider rollback with typed confirmation |
| `POST /feature-flags/rollout` | Submit LaunchDarkly flag rollout/kill-switch request |
| `GET /audit` | Read recent DevOps audit events |

## Generated artifact bundle

The generator creates a digest-addressed artifact record with:

- `Dockerfile`: runtime-specific Node, Python, Go or Java image; non-root runtime user; production-oriented defaults.
- `docker-compose.yml`: bounded local/single-host service definition, read-only root filesystem, dropped capabilities and no-new-privileges.
- `kubernetes/<service>.yaml`: Deployment, Service and HorizontalPodAutoscaler; readiness/liveness probes, resource requests/limits, non-root security context, seccomp and secret references.
- `terraform/main.tf`: provider-specific starter resources for AWS ECS Fargate, Azure Container Apps or Google Cloud Run; Kubernetes/generic targets receive a provider-neutral contract scaffold.
- `ansible/deploy.yml`: Kubernetes API modules through `kubernetes.core`; no ad-hoc shell/SSH command task is generated.
- `config.schema.json`, `.env.example`: typed runtime configuration and empty secret placeholders only.
- `deployment/rollout-strategy.json`: rollout stages, health windows, explicit manual promotion and rollback triggers.
- `.github/workflows/<service>-deploy.yml`: PR validation, GHCR build/push and protected GitHub Environment deployment gate.

Generated Terraform is a starter module, not a complete account-specific network/IAM design. AWS requires an existing ECS cluster, execution role, subnets and security groups; Azure requires a Container Apps environment and resource group; GCP requires a project and deploy permissions. Review provider-specific requirements and run `terraform fmt/validate/plan` in a protected CI runner before approval. Pin and update provider/action versions through supply-chain review.

## Supported rollout patterns

| Strategy | Default stages | Intended use |
| --- | --- | --- |
| Rolling | 25 / 50 / 75 / 100% | Replace instances gradually with health checks |
| Canary | 5 / 25 / 50 / 100% | Expose a small cohort before widening |
| Progressive | 10 / 25 / 50 / 75 / 100% | Controlled traffic increase with health windows |
| Ring | 1 / 5 / 25 / 100% | Internal, pilot, selected tenants, broad release |
| Blue/green | 0 / 100% | Prepare green, verify, then switch traffic |
| Feature flag | 5 / 25 / 50 / 100% | Separate code deployment from user exposure |
| Kill switch | 0% | Immediately disable a risky feature |

Every generated stage has automatic promotion disabled. Production approval, monitoring and explicit promotion decisions remain required. A rollback is a provider action and must be verified by polling the resulting state.

## LaunchDarkly integration

Create an integration in **Infrastructure & Resource Operations → Credential Vault** with:

- provider ID `launchdarkly`;
- the matching environment;
- requested scope `manage` (or `operate` where the adapter maps that scope);
- requested capability `manage`;
- provider API credentials saved only in the encrypted credential vault;
- successful authentication and read-only discovery verification.

The DevOps route sends a typed `POST /v1/feature-flags/rollout` request to the private adapter. The adapter owns LaunchDarkly SDK/API integration and must map the rollout strategy to the LaunchDarkly project/environment/flag API, preserve targeting rules and segments, and return an accepted request ID. Do not put LaunchDarkly API keys in Vite variables, generated files, configuration values, logs or browser storage.

The app exposes canary, progressive, ring, blue/green and kill-switch requests. A provider adapter must validate flag existence, project/environment ownership, allowed variation/targeting semantics and current flag state before applying a change. Preserve existing targeting rules unless the request explicitly includes a reviewed targeting change.

## Private provider adapter contract

Configure on the Admin Control Plane backend only:

- `INFRASTRUCTURE_CONTROL_PLANE_URL`: fixed private adapter origin.
- `INFRASTRUCTURE_CONTROL_PLANE_TOKEN`: strong service-to-service bearer token (at least 32 characters in production).
- `INFRASTRUCTURE_CREDENTIAL_ENCRYPTION_KEYS`: active AES-256-GCM key ring already used by the provider credential vault.

Production requires HTTPS, certificate validation and private networking or an explicit network allow-list. The adapter must authenticate the service token, independently enforce cloud IAM and account/environment scope, validate every request, and audit provider operations. It must never accept a caller-provided URL, shell string, script, command, arbitrary Terraform source or generic HTTP destination.

Required adapter operations:

### Deployment execution

`POST /v1/deployments/execute`

Request includes a verified integration descriptor, server-decrypted credentials (in memory for this request only), deployment ID, provider, environment, strategy, change reference, artifact digest and declarative artifact files. The adapter must validate the artifact against an allow-list, persist an immutable job record, then execute through provider APIs or a protected CI/IaC runner. It returns `{ "accepted": true, "deploymentId": "...", "status": "ACCEPTED" }` only after durable job acceptance.

### Deployment status

`POST /v1/deployments/status`

Request identifies the integration and provider deployment ID. Return a state from `SUBMITTED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `ROLLBACK_REQUESTED`, `ROLLED_BACK`, plus a bounded error code where relevant. Never return secret values or unrestricted provider payloads.

### Rollback

`POST /v1/deployments/rollback`

Validate deployment ownership, target and rollback availability; use the provider's known-good revision/previous task definition/previous container revision. Return `accepted` only after a durable rollback job is recorded.

### LaunchDarkly rollout

`POST /v1/feature-flags/rollout`

Validate provider integration `launchdarkly`, project/environment, flag key, strategy and percentage. Use LaunchDarkly's supported flag/environment targeting API. Return `accepted`, a bounded status and request ID. The adapter must preserve unrelated flag rules and report provider-side conflicts instead of overwriting them.

The application never treats request acceptance as deployment success. It refreshes status from the adapter and records the resulting state.

## Credential and approval gates

- Integration secrets are encrypted at rest by the existing AES-256-GCM credential vault and are never returned to the browser.
- A deployment requires a non-revoked integration for the exact provider and environment, successful authentication/discovery, requested `deploy` capability, and verified `operate` or `manage` scope.
- Production also requires provider TLS verification, a change/ticket reference, and a second Super Admin approver who is not the requester.
- Execution requires `APPROVED` state and exact typed confirmation.
- Rollback requires an eligible submitted deployment and exact typed confirmation.
- Feature-flag changes require a verified LaunchDarkly integration with `manage` capability, a change reference and bounded rollout percentage.
- All artifact generation, configuration versioning, approval, execution, status refresh, rollout and rollback attempts are audited. Secret-like audit keys are redacted.

The credential vault currently records successful provider verification as `ACTIVE_READ_ONLY`; this DevOps API separately checks the saved requested capabilities and granted operational scope before allowing a typed deployment request. Provider IAM remains the final enforcement boundary.

## Configuration manager

Configuration versions are immutable records scoped to service and environment. The API accepts only allow-listed non-secret keys (`NODE_ENV`, `PORT`, `LOG_LEVEL`, `FEATURE_FLAG_ENVIRONMENT`, `CONFIG_VERSION`, `PUBLIC_BASE_URL`, `HEALTH_PATH`) and a map of environment-variable names to managed secret reference IDs. It rejects secret values and unknown keys. The secret reference is an identifier, not a credential; the provider adapter resolves it through the approved secret manager/workload identity.

Use one version per change. Production configuration requires a change reference. A follow-up migration should add independent approver approval for production configuration versions before automated activation.

## Infrastructure-as-code and CI/CD tool roles

- **Docker / Compose:** reproducible image build and developer/single-host composition.
- **Kubernetes:** declarative runtime, health probes, scaling, rollout and policy enforcement.
- **Terraform:** cloud infrastructure provisioning and drift/plan review.
- **Ansible:** repeatable configuration through provider APIs and approved modules; avoid ad-hoc shell tasks.
- **GitHub Actions:** CI validation, image build/publish, artifact provenance and protected environment approval.
- **LaunchDarkly:** decouple release from feature exposure, cohort targeting, progressive rollout and kill switches.

Do not execute Terraform/Ansible/Kubernetes locally inside the web request process. A protected runner or the private adapter must isolate job execution, lock state, capture plan/apply output, enforce timeouts, record provider identity and retain signed artifact provenance.

## Remaining activation requirements

The application-side generator, registry, approvals, audit and adapter client are implemented here. A real deployment still requires:
1. a deployed private adapter implementing the endpoints above;
2. cloud accounts and least-privilege workload identities/credentials;
3. GitHub Environment protection rules and CI checks;
4. LaunchDarkly integration credentials and adapter support;
5. provider-specific Terraform validation/plan and Kubernetes admission policy checks;
6. staging smoke tests and an approved rollback rehearsal.

No cloud resources were created or changed by this repository change. Do not enable production execution until these activation gates pass.
