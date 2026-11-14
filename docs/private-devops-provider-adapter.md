# Private DevOps Provider Adapter

This service extends the existing Admin DevOps control plane and reuses its MongoDB deployment records, Super Admin approvals, encrypted InfrastructureIntegration vault and audit trail. It is not a second admin UI or a remote shell.

## Service boundary

- Admin API: authenticates Super Admin, verifies integration provider/environment/scopes, decrypts the existing vault envelope server-side and calls the private adapter over its service token.
- Private adapter: authenticates the Admin service, performs native read-only identity checks, stores durable job metadata and dispatches typed deployment operations.
- Native drivers: Terraform plan/apply for AWS/Azure/GCP, Kubernetes API dry-run/apply/rollout/undo, and LaunchDarkly API rollout plus captured-state restoration.
- Optional external runner URLs can override native drivers for isolated enterprise execution environments. They are not required for the native path.

No arbitrary shell, remote terminal, arbitrary HTTP proxy or browser-held provider credential is exposed.

## Native identity and execution

- AWS: SigV4-signed STS GetCallerIdentity; target account is checked against the configured ECS cluster.
- Azure: OAuth client-credential exchange and ARM subscription visibility/scope check; tenant must match the target.
- GCP: service-account JWT exchange and Cloud Resource Manager project lookup.
- Kubernetes: API server version and namespace read; API hostname must be in `KUBERNETES_API_ALLOWED_HOSTS`.
- LaunchDarkly: project/environment read; rollout changes preserve unspecified targeting rules and capture the previous `on` and `fallthrough` values for rollback.

AWS/Azure/GCP execution uses the generated provider-specific Terraform module and requires an existing remote state backend. AWS requires S3 plus DynamoDB locking, Azure uses an existing Azure Blob backend, and GCP uses an existing GCS backend. Terraform plans are run before apply. The adapter will not create or guess remote state resources.

Kubernetes execution uses the generated manifest with a temporary mode-0600 kubeconfig, server-side dry-run, apply and rollout health check. Rollback uses Deployment revision history.

Cloud rollback reapplies the previous successful immutable artifact using the same remote state. A first deployment without a prior successful release cannot claim automatic rollback. LaunchDarkly rollback restores the captured prior environment flag state. Each LaunchDarkly request applies one approved percentage step; progression to another stage is a separate reviewed change, not an unattended timer.

## Target configuration

Non-secret resource identifiers and allowlists are saved separately from the encrypted credentials on the `InfrastructureIntegration` record. Super Admins configure them through:

`PUT /api/v1/admin/infrastructure/security/integrations/:id/target-config`

Supported target fields and examples are in `services/private-devops-adapter/README.md`. Target changes invalidate prior verification and require the integration to be verified again. Cloud providers require explicit allowed service names; Kubernetes requires allowed deployment names; LaunchDarkly requires allowed flag keys.

Deployment requires a pinned image tag. Floating `latest` and generated `CHANGE_ME` placeholders are rejected.

## Staging verification

Use Super Admin DevOps `POST /providers/preflight` with a saved integration ID and a validated staging artifact for AWS/Azure/GCP/Kubernetes. LaunchDarkly preflight verifies the saved project/environment. The endpoint refuses non-staging environments. Cloud preflight runs Terraform init/validate/plan against the configured remote state; Kubernetes preflight runs server-side dry-run.

Persisted evidence is available at adapter `GET /v1/evidence?environment=staging`. After preflight, create and approve a staging deployment, execute it, verify terminal status, and rehearse rollback. LaunchDarkly rollout/rollback must also be verified against the real flag.

## Production lock

`ALLOW_PRODUCTION_OPERATIONS` defaults to disabled. Keep it false during staging. Production also remains subject to the Admin API's separate approval and separation-of-duties checks. Do not enable production based on identity preflight alone; require all five staging evidence sets, deployment/rollback evidence, security review and release approval.

## Validation boundary

Repository CI covers adapter syntax/tests and builds the provider execution container; control-plane CI covers generated artifacts and frontend build. These checks do not substitute for provider credentials or live staging infrastructure. No AWS/Azure/GCP account, Kubernetes cluster or LaunchDarkly environment was accessed during this repository change. Live staging preflight, deployment and rollback evidence remains outstanding; production stays locked.


## Enforced five-provider release gate

The Admin API persists each staging preflight with its artifact digest (where applicable), provider integration ID, and SHA-256 digest of the verified non-secret target configuration. A target change or revoked/unverified staging integration makes the saved preflight stale.

- Staging deployment planning requires a passing preflight for the exact artifact and selected staging integration.
- Production deployment planning, approval and execution require the same artifact to have completed successfully in staging against the preflighted integration.
- LaunchDarkly staging rollout planning requires a passing preflight for the allowlisted flag. Production rollout planning, approval and execution require the same flag strategy and percentage to have completed in staging.
- A separate adapter readiness check requires fresh staging preflight, successful deployment/rollout and a completed rollback rehearsal for each of AWS, Azure, GCP, Kubernetes and LaunchDarkly.
- Super Admin can inspect the five-provider readiness matrix at `GET /api/v1/admin/devops/release-readiness`. The UI displays preflight, deployment and rollback status per provider.
- Production execution remains independently disabled unless `ALLOW_PRODUCTION_OPERATIONS=true`. Even after that release switch is explicitly enabled, existing separate Super Admin approval and typed confirmation are still required.
- Emergency rollback endpoints remain available while new production deployment and flag rollout operations are locked.

Terraform artifact validation rejects provisioners, external data sources/providers, null resources, terraform_data execution hooks and unreviewed modules. Remote provider driver URLs and the Admin-to-adapter connection require HTTPS (loopback HTTP is permitted only outside production).

## Local service startup

The adapter listens on port `8092` by default, separate from the main backend on `8090`. Root scripts are available as `npm run dev:private-devops-adapter` and `npm run start:private-devops-adapter`. The all-service runner starts it automatically in development when both `PRIVATE_DEVOPS_ADAPTER_TOKEN` (32+ characters) and `ADAPTER_MONGO_URI` or `MONGO_URI` are configured. Set `START_PRIVATE_DEVOPS_ADAPTER=true` to require local startup. An explicitly configured remote `PRIVATE_DEVOPS_ADAPTER_URL` is used without starting a second local adapter. Production requires an explicit internal HTTPS adapter URL and a TLS-terminated private service endpoint; loopback HTTP startup is rejected.
