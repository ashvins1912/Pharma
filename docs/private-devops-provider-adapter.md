# Private DevOps Provider Adapter

This service extends the existing Admin DevOps control plane and reuses its MongoDB deployment records, Super Admin approvals, encrypted InfrastructureIntegration vault and audit trail. It is not a second admin UI or a remote shell.

## Service boundary

- Admin API: authenticates Super Admin, verifies integration provider/environment/scopes, decrypts the existing vault envelope server-side and calls the private adapter over its service token.
- Private adapter: authenticates the Admin service, performs native read-only identity checks for AWS/Azure/GCP/Kubernetes/LaunchDarkly, stores durable job metadata and dispatches typed deployment operations.
- Provider execution drivers: perform provider-native target authorization, IaC plan/apply, rollout health checks and rollback. The adapter does not run arbitrary commands or expose provider credentials to the browser.

## Native identity preflight

The adapter includes built-in identity checks:
- AWS: SigV4-signed STS GetCallerIdentity.
- Azure: OAuth client-credential exchange and ARM subscription visibility/scope check.
- GCP: service-account JWT exchange and Cloud Resource Manager project lookup.
- Kubernetes: API server version and namespace read.
- LaunchDarkly: project/environment read.

The credential payload contract is documented in `services/private-devops-adapter/README.md`. Map the existing encrypted vault record to that shape server-side; never add credential fields to browser responses or persistent deployment/evidence records.

## Required deployment-driver contract

Each provider execution driver URL is configured independently with a 32+ character bearer token:
- `DEVOPS_DRIVER_AWS_URL/TOKEN`
- `DEVOPS_DRIVER_AZURE_URL/TOKEN`
- `DEVOPS_DRIVER_GCP_URL/TOKEN`
- `DEVOPS_DRIVER_KUBERNETES_URL/TOKEN`
- `DEVOPS_DRIVER_LAUNCHDARKLY_URL/TOKEN`

Drivers implement POST `/v1/preflight`, `/v1/deployments/execute`, `/v1/deployments/status`, and `/v1/deployments/rollback`; LaunchDarkly also implements POST `/v1/feature-flags/rollout`. Each driver must validate account/project/cluster/environment allowlists independently and enforce least privilege. Do not trust Admin payloads as provider authorization.

## Staging verification

Use Super Admin DevOps `POST /providers/preflight` with a saved integration ID and environment `staging`. This endpoint refuses other environments. A preflight is PASS only when native identity verification and configured execution-driver checks all pass. Persisted evidence is available at adapter `GET /v1/evidence?environment=staging`.

Then create a validated artifact, approve and execute a small staging deployment, poll status until terminal, and perform rollback rehearsal. For LaunchDarkly, verify the current flag configuration before change, apply only the requested targeting/percentage update, compare post-change state, and prove kill-switch recovery.

## Production lock

`ALLOW_PRODUCTION_OPERATIONS` defaults to disabled. Keep it false during staging. Production also remains subject to the Admin API's separate approval and separation-of-duties checks. Do not enable production based on identity preflight alone; require all five staging evidence sets, deployment/rollback evidence, security review and release approval.

## Remaining integration boundary

Native provider identity preflight is implemented in this repository. Provider deployment execution still requires the five configured provider execution drivers and explicit allowlisted target configuration. Until those drivers are deployed and return real provider-side evidence, preflight correctly reports BLOCKED and no cloud or LaunchDarkly operation can be considered validated.
