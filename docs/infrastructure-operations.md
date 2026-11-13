# Universal infrastructure and remote-service adapters

Super Admin infrastructure operations use a provider-neutral adapter model. Render is supported natively. Any additional cloud, hosting platform, VPS, container platform, managed database, remote compute service or other operational service can be integrated behind one private remote control-plane adapter.

## Configuration

Set these secrets on the backend service only:

| Variable | Purpose |
| --- | --- |
| `RENDER_API_KEY` | Enables native Render service discovery, metrics and supported lifecycle operations. |
| `INFRASTRUCTURE_CONTROL_PLANE_URL` | Fixed base URL of your private universal adapter service. |
| `INFRASTRUCTURE_CONTROL_PLANE_TOKEN` | Bearer token used by the backend to authenticate to that adapter. |

Production requires HTTPS and a token. Never put credentials in frontend/Vite variables, resource records, URLs, or browser requests. Restart/redeploy the backend after changing secrets.

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

## Security and safety requirements for adapter implementers

- The adapter is a private service with its own provider SDKs, API clients and credentials.
- It must independently enforce least-privilege IAM and tenant/account boundaries.
- Validate provider/resource pairs and allow-list lifecycle actions; never implement arbitrary shell, SQL, HTTP proxy, URL fetch, or command execution endpoints.
- Return only resources the connected principal is authorized to inspect or operate.
- The app backend uses a fixed configured base URL (not a URL supplied by the browser), bearer authentication, request timeout, normalized provider IDs, resource re-discovery, capability checks and typed confirmation.
- Audit each action in the adapter, including actor/context passed by a trusted server-side identity mechanism, target, provider, action, result and timestamp.
- A successful action response means accepted, not completed; poll resource status to verify the final state.
- Treat dashboard URLs as display metadata only; never fetch them server-side.

The initial protocol exposes start/stop/restart. Other operations (deploy, scale, pause, resume, rotate credentials, backup, restore, purge) should be added as explicit typed capabilities and validated action schemas, not arbitrary action strings.

## Metrics

Render uses its native metrics endpoints for CPU, memory and outbound bandwidth. The universal adapter returns normalized metrics for all other services. Each provider can report CPU, memory, memory limit, outbound bandwidth and its measurement window, disk, cost and observation timestamp. Missing metrics remain visibly unreported. Totals include only comparable reported samples.

## MongoDB and databases

The existing MongoDB integration reads stats from the application's active Mongoose connection and is observational. Other managed databases can be surfaced as resources through the universal adapter with provider-reported storage, metrics and explicitly supported lifecycle capabilities. Database deletion, cleanup, backup and restore must be separate retention/approval workflows; do not expose them as generic stop/start actions.

## Adding a new service provider

Implement the two protocol endpoints and normalized resource records in the adapter, register its credentials there, and return its provider ID in each resource. No application code change or provider allow-list update is required for a new provider. Only add a new typed action to the app when the UI needs to expose an operation beyond start/stop/restart.
