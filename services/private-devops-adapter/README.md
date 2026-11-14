# Private DevOps Provider Adapter

This service is the private execution boundary for the Admin DevOps control plane. It stores durable job metadata in MongoDB, performs built-in provider identity checks, and dispatches typed deployment operations to separately configured execution drivers. It never exposes a shell, terminal, arbitrary URL proxy, or cloud credential endpoint.

## Runtime configuration

- `ADAPTER_MONGO_URI` (or existing `MONGO_URI`)
- `PRIVATE_DEVOPS_ADAPTER_TOKEN` (32+ random characters; shared only with the Admin control plane)
- Per-provider `DEVOPS_DRIVER_<PROVIDER>_URL` and `DEVOPS_DRIVER_<PROVIDER>_TOKEN` for AWS, AZURE, GCP, KUBERNETES and LAUNCHDARKLY
- `ALLOW_PRODUCTION_OPERATIONS=false` until release governance explicitly enables it

## Built-in identity preflight

The adapter now performs native read-only identity checks before it reports a provider preflight result:

| Provider | Required credential fields | Read-only verification |
|---|---|---|
| AWS | `accessKeyId`, `secretAccessKey`, optional `sessionToken`, optional `region` | Signed STS GetCallerIdentity |
| Azure | `tenantId`, `clientId`, `clientSecret`, optional `subscriptionId` | OAuth client credentials and ARM subscription visibility |
| GCP | `clientEmail`, `privateKey`, `projectId` | Service-account JWT exchange and Cloud Resource Manager project lookup |
| Kubernetes | `token`, `namespace`; API server URL in the integration endpoint or `server` | API server version and namespace read |
| LaunchDarkly | `apiKey`, `projectKey`, `environmentKey` | Project/environment read using LaunchDarkly API |

Credential field names are the adapter's input contract. Existing vault entries must be mapped to this shape by the trusted Admin service before staging checks. Credentials are used in memory only and must never be written to logs or job/evidence records. Kubernetes API hosts must be listed in `KUBERNETES_API_ALLOWED_HOSTS` in production; LaunchDarkly defaults to `app.launchdarkly.com` and any additional host must be explicitly listed in `LAUNCHDARKLY_API_ALLOWED_HOSTS`.

## Deployment execution drivers

Identity verification is not deployment execution. The separately configured provider execution drivers must implement:
- `POST /v1/preflight`
- `POST /v1/deployments/execute`
- `POST /v1/deployments/status`
- `POST /v1/deployments/rollback`
- LaunchDarkly additionally implements `POST /v1/feature-flags/rollout`

The five execution drivers must enforce provider-native target allowlists, least-privilege deployment scopes, reviewed IaC plans, idempotent apply, health checks, rollback and provider-side evidence. A preflight remains BLOCKED unless both native identity verification and the configured execution driver checks pass. Provider acceptance is SUBMITTED, never proof of successful completion.

## Staging

Configure staging-scoped identities and execution drivers first. Call `POST /v1/preflight` for each provider and require every check to PASS. Run a non-production deployment and rollback rehearsal, then verify the provider operation reaches a terminal state through status reconciliation. LaunchDarkly drivers must preserve unspecified targeting rules and support a kill-switch recovery path.

## Production safety

Production requests are rejected unless `ALLOW_PRODUCTION_OPERATIONS=true`. Keep this unset/false during staging. The Admin control plane must continue enforcing its independent two-person approval and typed confirmation gates. Production enablement is an infrastructure release action, not an Admin UI setting.
