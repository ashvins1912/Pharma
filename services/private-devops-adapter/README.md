# Private DevOps Provider Adapter

This service is the private execution boundary for the Admin DevOps control plane. It stores durable job metadata in MongoDB and dispatches typed operations to separately configured provider drivers. It never exposes a shell, terminal, arbitrary URL proxy, or cloud credential endpoint.

## Runtime configuration

- `ADAPTER_MONGO_URI` (or existing `MONGO_URI`)
- `PRIVATE_DEVOPS_ADAPTER_TOKEN` (32+ random characters; shared only with the Admin control plane)
- Per-provider `DEVOPS_DRIVER_<PROVIDER>_URL` and `DEVOPS_DRIVER_<PROVIDER>_TOKEN` for AWS, AZURE, GCP, KUBERNETES and LAUNCHDARKLY
- `ALLOW_PRODUCTION_OPERATIONS=false` until release governance explicitly enables it

Driver endpoints must implement:
- `POST /v1/preflight`
- `POST /v1/deployments/execute`
- `POST /v1/deployments/status`
- `POST /v1/deployments/rollback`
- LaunchDarkly additionally implements `POST /v1/feature-flags/rollout`

Each driver is responsible for provider-native identity verification, least-privilege scope enforcement, IaC plan review, apply, health checks, rollback and provider-specific evidence. The adapter treats provider acceptance as SUBMITTED, never as successful completion.

## Staging

Configure only staging-scoped driver identities first. Call `POST /v1/preflight` for each provider and require every check to PASS. Run a non-production deployment and rollback rehearsal, then verify the provider operation reaches a terminal state through status reconciliation. LaunchDarkly drivers must preserve unspecified targeting rules and support a kill-switch recovery path.

## Production safety

Production requests are rejected unless `ALLOW_PRODUCTION_OPERATIONS=true`. Keep this unset/false during staging. Enabling it is an infrastructure release action, not an Admin UI setting. The Admin control plane must continue enforcing its independent two-person approval and typed confirmation gates.

## Driver protocol

All requests are authenticated with a per-driver bearer token over HTTPS in production. Driver responses use JSON and status values SUBMITTED, RUNNING, SUCCEEDED or FAILED (ROLLED_BACK for reconciliation). Do not return credentials, raw plans containing secrets, or unredacted provider output.
