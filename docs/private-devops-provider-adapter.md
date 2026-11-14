# Private DevOps Provider Adapter

This service extends the existing Admin DevOps control plane (PR #240) and reuses its MongoDB deployment records, Super Admin approvals, encrypted InfrastructureIntegration vault and audit trail. It is not a second admin UI or a remote shell.

## Service boundary

- Admin API: authenticates Super Admin, verifies integration provider/environment/scopes, decrypts the existing vault envelope server-side and calls the private adapter over its service token.
- Private adapter: authenticates the Admin service, accepts typed operations only, stores durable job metadata in MongoDB and dispatches to a provider-specific private driver.
- Provider drivers: perform provider-native identity and scope checks, IaC plan/apply, rollout health checks and rollback. The adapter does not run arbitrary commands or expose provider credentials to the browser.

The Admin-to-adapter request carries the existing encrypted-vault credential payload only in the authenticated private request body. The adapter does not persist it in job or evidence documents. Use TLS, network allowlists and short-lived least-privilege provider identities; avoid request-body logging at every proxy.

## Required driver contract

Each provider driver URL is configured independently with a 32+ character bearer token:
- `DEVOPS_DRIVER_AWS_URL/TOKEN`
- `DEVOPS_DRIVER_AZURE_URL/TOKEN`
- `DEVOPS_DRIVER_GCP_URL/TOKEN`
- `DEVOPS_DRIVER_KUBERNETES_URL/TOKEN`
- `DEVOPS_DRIVER_LAUNCHDARKLY_URL/TOKEN`

Drivers implement POST `/v1/preflight`, `/v1/deployments/execute`, `/v1/deployments/status`, `/v1/deployments/rollback`; LaunchDarkly also implements `/v1/feature-flags/rollout`. The driver must validate the supplied integration identity and enforce its own allowlisted account/project/cluster/environment. It must never trust the Admin payload as a substitute for provider authorization.

## Staging verification

Use Super Admin DevOps `POST /providers/preflight` with a saved integration ID and environment `staging`. This endpoint refuses other environments. A preflight is PASS only when adapter and driver configuration checks and all provider checks return PASS. Persisted evidence is available at adapter `GET /v1/evidence?environment=staging`.

Then create a validated artifact, approve and execute a small staging deployment, poll status until terminal, and perform rollback rehearsal. For LaunchDarkly, verify the flag's current configuration before change, apply only the requested targeting/percentage update, compare post-change state, and prove kill-switch recovery.

## Production lock

`ALLOW_PRODUCTION_OPERATIONS` defaults to disabled. Keep it false during staging. Production also remains subject to the Admin API's separate approval and separation-of-duties checks. Do not enable production based on a successful preflight alone; require all five staging evidence sets, deployment/rollback evidence, security review and a release approval.

## Important implementation boundary

This repository now contains the private adapter orchestration service and a typed driver protocol. The five provider-specific drivers are separately deployed integration components and are not magically supplied by this service. Until each driver is implemented/configured and returns real provider-side evidence, preflight correctly reports BLOCKED and no cloud or LaunchDarkly operation can be considered validated.
