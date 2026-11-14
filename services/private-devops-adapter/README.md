# Private DevOps Provider Adapter

The adapter is the private execution boundary for the Super Admin DevOps control plane. It persists job metadata and immutable artifact snapshots in MongoDB, performs provider identity checks, and runs native typed operations. It does not expose a shell, terminal, arbitrary HTTP proxy, or browser-held credentials.

## Runtime

Default listen port: `8092` (override with `PORT` or `PRIVATE_DEVOPS_ADAPTER_PORT`). The repository service runner starts this workspace automatically when the private adapter token and MongoDB URI are configured; otherwise it remains an optional service.

Required:
- ADAPTER_MONGO_URI (or the existing MONGO_URI)
- PRIVATE_DEVOPS_ADAPTER_TOKEN (at least 32 random characters, shared only with the Admin API)

Bundled tools:
- Terraform 1.9.8 for AWS/Azure/GCP
- kubectl 1.32.2 for Kubernetes

Optional:
- TERRAFORM_BIN, KUBECTL_BIN
- KUBERNETES_API_ALLOWED_HOSTS: comma-separated exact Kubernetes API hostnames; required for every environment
- LAUNCHDARKLY_API_ALLOWED_HOSTS: comma-separated exact LaunchDarkly API hostnames; defaults to app.launchdarkly.com
- DEVOPS_DRIVER_<PROVIDER>_URL/TOKEN: optional isolated external runner override; remote runner URLs must use HTTPS
- ALLOW_PRODUCTION_OPERATIONS=false: keep disabled until all release gates and approvals are complete

## Native provider contracts

| Provider | Identity verification | Execution |
|---|---|---|
| AWS | SigV4 STS GetCallerIdentity; target ECS account must match | Terraform ECS/Fargate plan/apply using S3 remote state and DynamoDB locking |
| Azure | OAuth client credentials; configured tenant and subscription scope | Terraform Azure Container Apps using existing Azure Blob state |
| GCP | Service-account JWT and Cloud Resource Manager project lookup | Terraform Cloud Run using existing GCS state |
| Kubernetes | HTTPS API /version and namespace read; exact hostname allowlist | Server-side dry-run, manifest apply, rollout health check and Deployment revision undo |
| LaunchDarkly | Project/environment and allowlisted flag read | Approved percentage/kill-switch update preserving targeting rules; capture and restore prior flag state |

Credentials are decrypted only by the trusted Admin API and sent to the adapter over the private authenticated channel. The adapter uses them in memory and never stores them in job or evidence documents.

## Target configuration

Super Admins store non-secret target identifiers and allowlists on the existing InfrastructureIntegration record through:

PUT /api/v1/admin/infrastructure/security/integrations/:id/target-config

Target changes invalidate verification and operational scopes. Re-verify credentials and rerun staging preflight after every target change.

- AWS: region, ECS cluster ARN, task execution role ARN, subnet/security-group allowlists, allowed service names, and an existing S3 backend plus DynamoDB lock table.
- Azure: tenant, subscription, resource group, location, Container Apps environment ID, allowed service names, and an existing Azure Blob backend.
- GCP: project, region, allowed service names, and an existing GCS backend.
- Kubernetes: namespace, allowed Deployment names, and an API hostname in KUBERNETES_API_ALLOWED_HOSTS.
- LaunchDarkly: project key, environment key, and allowed flag keys.

The adapter never creates or guesses accounts, subscriptions, projects, clusters, namespaces, services, feature flags, or Terraform state resources.

## Artifact and execution safety

- Artifacts must pass Admin validation and their SHA-256 digest is verified again by the adapter before preflight and execution.
- Container images require an explicit non-floating tag; latest and generated CHANGE_ME placeholders are rejected.
- Terraform artifacts containing provisioners, external data sources/providers, null resources, terraform_data execution hooks, or unreviewed modules are rejected.
- Terraform uses fixed argument arrays with shell:false, isolated temporary workspaces, remote state and a plan before apply.
- Kubernetes uses a temporary mode-0600 kubeconfig. Temporary credentials and workspace files are removed after execution.
- Cloud rollback reapplies the previous successful immutable artifact. Kubernetes rollback uses Deployment revision history. LaunchDarkly rollback restores the captured prior state.
- The first deployment without a prior known-good snapshot is not rollback-eligible.

## Staging and production release gate

Run Super Admin POST /providers/preflight for each provider in staging. AWS/Azure/GCP preflight runs Terraform init/validate/plan; Kubernetes performs server-side dry-run; LaunchDarkly verifies the configured environment and allowlisted flag. The Admin API stores evidence bound to the artifact digest and exact verified target configuration.

Complete a staging deployment and rollback rehearsal for AWS, Azure, GCP and Kubernetes. For LaunchDarkly, complete an approved staging flag rollout and restore the captured prior state.

The adapter POST /v1/release-readiness and Admin GET /api/v1/admin/devops/release-readiness report the five-provider gate. Production planning, approval and execution remain blocked until every provider has passing staging preflight, deployment and rollback evidence. Evidence must be newer than the latest preflight; target changes invalidate the evidence. Emergency rollback remains available while new production deployments are locked.

After the five-provider gate passes, production still requires:
1. Explicit infrastructure release approval to set ALLOW_PRODUCTION_OPERATIONS=true.
2. The existing separate Super Admin approval and separation-of-duties controls.
3. Typed confirmation at execution time.

## Validation boundary

CI checks syntax, adapter tests, generated-artifact policies, frontend build and Docker image construction. CI does not access real provider accounts. Live staging preflight, deployment and rollback require the organization's own verified credentials and explicitly allowlisted target identifiers. No cloud resource, Kubernetes cluster or LaunchDarkly flag is changed by CI.
