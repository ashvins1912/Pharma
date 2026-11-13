# Universal infrastructure and remote-service adapters

Super Admin infrastructure operations use a provider-neutral adapter model. Render is supported natively. Any additional cloud, hosting platform, VPS, container platform, managed database, remote compute service or other operational service can be integrated behind one private remote control-plane adapter.

## Configuration

Set these secrets on the backend service or approved secrets manager only:

| Variable | Purpose |
| --- | --- |
| `RENDER_API_KEY` | Enables native Render service discovery, metrics and supported lifecycle operations. |
| `INFRASTRUCTURE_CONTROL_PLANE_URL` | Fixed base URL of your private universal adapter service. |
| `INFRASTRUCTURE_CONTROL_PLANE_TOKEN` | Backend-to-control-plane bearer credential. |

Production requires HTTPS and a strong, rotated service credential. Never put credentials in frontend/Vite variables, resource records, URLs, browser requests, logs or source control. Prefer a managed secret store with workload identity where supported. Restart/redeploy after secret changes and verify that old credentials have been revoked.

## Universal adapter protocol

The application does not hardcode a list of cloud vendors. The adapter may return any provider identifier matching `[a-z][a-z0-9_-]{0,63}` (except `render`, reserved for the native adapter). It can represent AWS, Azure, GCP, DigitalOcean, Hetzner, Fly.io, Kubernetes, Docker hosts, VPS providers, PaaS platforms, managed databases or an internal service.

Implement:

- `GET /v1/resources` — return `{ "resources": [ ... ] }`.
- `POST /v1/resources/:resourceId/actions` — accept `{ "provider": "provider-id", "action": "start|stop|restart" }` when supported.

Example resource:

```json
{
  "id": "stable-provider-resource-id",
  "provider": "my-hosting-platform",
  "name": "production-api",
  "type": "web_service",
  "region": "ap-south-1",
  "plan": "standard",
  "status": "RUNNING",
  "dashboardUrl": "https://provider.example/console/resource",
  "capabilities": { "start": false, "stop": true, "restart": true },
  "usage": {
    "cpu": 12.4,
    "cpuUnit": "%",
    "memoryBytes": 536870912,
    "memoryLimitBytes": 1073741824,
    "outboundBytes": 123456789,
    "bandwidthWindow": "24h",
    "diskBytes": 4294967296,
    "estimatedCost": 18.5,
    "costCurrency": "USD",
    "costWindow": "current billing month",
    "observedAt": "2026-11-13T12:00:00.000Z",
    "source": "Provider Metrics API"
  }
}
```

All usage fields are optional. Unknown or unavailable measurements must be omitted or null, never represented as zero. Costs must be provider-reported estimates with ISO-4217 currency codes. Keep units explicit and consistent. IDs must be stable within a provider; provider + resource ID form the identity.

## Authentication and authorisation

Every integration must have its own connection identity and independently verified permissions. Support only explicitly implemented authentication strategies, for example:

- API token / bearer token;
- OAuth 2.0 authorisation code or client credentials;
- service account / workload identity;
- basic authentication only where the provider requires it and policy permits it;
- SSH key authentication only for a dedicated, constrained remote agent;
- custom provider adapter authentication with a documented schema.

The configuration workflow must collect only fields required by the selected method. Secrets must be write-only after submission (masked; never returned by read APIs), encrypted with a managed key or stored in a secrets manager, and referenced by secret ID. Never store raw credentials in ordinary configuration documents. Do not accept secrets in URL query strings.

Permission tiers must be explicit and independently selectable:
- **Read:** list authorised resources and metadata.
- **Monitor:** read telemetry, logs or billing data explicitly granted.
- **Operate:** execute individually enabled typed actions.
- **Manage:** change configuration or manage backups where explicitly supported.
- **Credential administration:** rotate, test, disable or revoke integration credentials.

Default to read-only. A provider connection is not authorised for every action merely because authentication succeeded. Verify granted scopes/roles, display missing permissions, and fail closed when an action is not explicitly granted. Enforce authorisation in the backend and again in the adapter/provider account; hiding a UI button is not an access control.

Separate application-user identity from provider credentials. Bind each operation to the authenticated Super Admin actor, tenant/account boundary, integration ID, resource ID and approved action. Use short-lived scoped tokens where supported. Support credential expiry, rotation, revocation and emergency disable.

## Security baseline (mandatory)

- **Transport:** TLS 1.2+ (prefer TLS 1.3), certificate validation, HTTPS in production, and no insecure downgrade. Use private networking or IP restrictions where practical.
- **Service identity:** authenticate backend-to-adapter calls with scoped service identity; rotate credentials; use mutual TLS or workload identity where supported. Do not reuse a human login token as a machine credential.
- **Secrets:** managed secret storage, envelope encryption, least-privilege secret access, masking, rotation and revocation. Redact secrets, authorization headers, cookies, private keys and sensitive payloads from all logs and errors.
- **Access control:** deny by default; least privilege; role- and scope-based checks; tenant/account isolation; separation of duties for high-impact operations; re-check permissions at execution time.
- **Input validation:** schema-validate every request and provider response; bound string/array sizes; reject unknown actions and malformed identifiers; prevent path traversal and injection.
- **Network safety / SSRF:** use a fixed server-side control-plane URL and provider endpoints from trusted adapter configuration. Never fetch caller-supplied URLs, dashboard URLs, arbitrary webhook targets or metadata URLs. Apply egress allow-lists and DNS/IP protections to connectors.
- **Execution safety:** no arbitrary shell, SQL, code, command, generic HTTP proxy or unrestricted remote execution endpoints. Use provider SDKs and narrow typed operations only.
- **Resilience:** connection and request timeouts, bounded response bodies, rate limits, concurrency limits, retry only safe/idempotent operations, circuit breakers and graceful failure. Do not retry non-idempotent lifecycle actions blindly.
- **Data protection:** minimise collected telemetry and metadata; classify sensitive fields; define retention and deletion periods; encrypt data in transit and at rest; restrict exports and redact personal or secret data.
- **Auditability:** immutable or tamper-evident audit trail for connection creation, tests, permission changes, secret rotation/revocation, reads of sensitive configuration and every operational action. Record actor, integration, provider, resource, action, approval, outcome, timestamp and correlation ID; never record secret values.
- **Monitoring:** alert on authentication failures, permission denials, unusual action volume, privilege changes, credential expiry, adapter health and policy violations.
- **Supply chain:** pin and review dependencies, scan for known vulnerabilities and secrets, sign/review release artifacts where supported, and restrict who can publish provider connectors.
- **Incident response:** provide immediate integration disable/revoke, credential rotation, audit export, incident timeline and documented recovery procedure.

## Compliance and governance controls

Compliance is a configurable governance process, not a claim that the platform is automatically certified. Before production activation, each integration should have:

1. **Data classification:** document what data is collected, its sensitivity, purpose, region, owner and whether personal, financial, health or other regulated data is involved.
2. **Data residency and transfers:** record provider region, storage/processing locations, subprocessors and cross-border transfer requirements; block regions that violate the organisation's policy.
3. **Retention and deletion:** configure telemetry/log retention, credential lifecycle, backup retention and deletion evidence. Apply legal holds where required.
4. **Vendor assessment:** record provider identity, security documentation, DPA/contract status, subprocessors, breach notification terms, availability commitments and risk owner.
5. **Policy mapping:** allow organisation-defined controls mapped to applicable obligations (for example ISO 27001, SOC 2, GDPR, applicable Indian DPDP requirements, and sector-specific rules where relevant). Applicability must be assessed by the organisation's compliance/legal owner; do not represent a mapping as certification or legal advice.
6. **Change governance:** require approval and change/ticket reference for production integrations and high-impact actions; maintain separation between requester and approver where configured.
7. **Periodic review:** schedule access recertification, provider risk review, secret rotation checks, permission drift checks and evidence export.
8. **Evidence:** retain timestamped verification results, granted-scope snapshots, policy decisions, approvals, audit events, incident records and remediation status.
9. **Exception management:** require documented reason, owner, compensating controls, expiry date and approval for every policy exception. Expired exceptions must fail closed or return to review.
10. **Security posture:** show compliance state as `NOT_ASSESSED`, `PENDING`, `PASS`, `FAIL`, or `EXCEPTION`; never display a pass when evidence is missing or stale.

Recommended activation gates:
- authentication test passed;
- granted permissions match the requested permission set;
- read-only discovery test passed;
- TLS and secret-storage checks passed;
- required policy assessments and approvals completed;
- no unresolved critical/high security finding, unless an explicitly approved, time-bounded exception exists.

## Verification and operational lifecycle

The administrator workflow should be: configure service → validate fields → authenticate → inspect granted scopes → verify read-only discovery → run policy checks → approve requested capabilities → activate. Keep operational capabilities disabled until separately authorised.

A successful action response means accepted, not completed; poll resource status to verify the final state. For production-changing actions, require explicit confirmation and, where policy demands, a second approver and change reference. Record both approval and execution outcomes.

Provide connection states such as `NOT_CONFIGURED`, `PENDING_VERIFICATION`, `AUTHENTICATION_FAILED`, `AUTHENTICATED`, `AUTHORIZATION_FAILED`, `POLICY_BLOCKED`, `ACTIVE_READ_ONLY`, `ACTIVE`, `DEGRADED`, `REVOKED` and `EXPIRED`. Show last verification time, last successful sync, granted scopes, policy status and actionable error without exposing secrets.

## Security and safety requirements for adapter implementers

- The adapter is a private service with its own provider SDKs, API clients and credentials.
- It must independently enforce least-privilege IAM and tenant/account boundaries.
- Validate provider/resource pairs and allow-list lifecycle actions; never implement arbitrary shell, SQL, HTTP proxy, URL fetch, or command execution endpoints.
- Return only resources the connected principal is authorized to inspect or operate.
- The app backend uses a fixed configured base URL (not a URL supplied by the browser), bearer authentication, request timeout, normalized provider IDs, resource re-discovery, capability checks and typed confirmation.
- Audit each action in the adapter, including actor/context passed by a trusted server-side identity mechanism, target, provider, action, result and timestamp.
- Treat dashboard URLs as display metadata only; never fetch them server-side.

The initial protocol exposes start/stop/restart. Other operations (deploy, scale, pause, resume, rotate credentials, backup, restore, purge) should be added as explicit typed capabilities and validated action schemas, not arbitrary action strings.

## Metrics

Render uses its native metrics endpoints for CPU, memory and outbound bandwidth. The universal adapter returns normalized metrics for all other services. Each provider can report CPU, memory, memory limit, outbound bandwidth and its measurement window, disk, cost and observation timestamp. Missing metrics remain visibly unreported. Totals include only comparable reported samples.

## MongoDB and databases

The existing MongoDB integration reads stats from the application's active Mongoose connection and is observational. Other managed databases can be surfaced as resources through the universal adapter with provider-reported storage, metrics and explicitly supported lifecycle capabilities. Database deletion, cleanup, backup and restore must be separate retention/approval workflows; do not expose them as generic stop/start actions.

## Adding a new service provider

Implement the protocol endpoints and normalized resource records in the adapter, register its credentials in managed secret storage, and return its provider ID in each resource. No application code change or provider allow-list update is required for a new provider. Only add a new typed action to the app when the UI needs to expose an operation beyond start/stop/restart.
