# Super Admin infrastructure operations

The Super Admin workspace is provider-neutral. The initial lifecycle adapter is Render; the normalized resource contract is designed for additional AWS, Azure, GCP and other provider adapters. MongoDB usage is read from the gateway's active Mongoose connection.

## Backend secrets and configuration

Configure these in the backend API service's secret environment (for Render, the backend service's Environment page). Never put provider credentials in Vite/frontend variables.

| Variable | Purpose |
| --- | --- |
| `RENDER_API_KEY` | Render API key. Enables listing Render services and service lifecycle actions. |
| `INFRASTRUCTURE_CONTROL_PLANE_URL` | Optional HTTPS base URL for the normalized AWS/Azure/GCP adapter service. |
| `INFRASTRUCTURE_CONTROL_PLANE_TOKEN` | Optional bearer token for that control-plane service. |

After changing backend environment variables, redeploy/restart the backend API service.

## Native Render metrics

When `RENDER_API_KEY` is configured, the backend reads Render's native Metrics API:
- CPU: `/v1/metrics/cpu`
- Memory: `/v1/metrics/memory`
- Outbound bandwidth: `/v1/metrics/bandwidth`

CPU and memory display the latest available sample. Bandwidth sums available hourly data points across the last 24 hours. Render's bandwidth graph has hourly resolution and its samples can arrive with a delay, so the current 24-hour total may be incomplete. Memory limit and disk usage are left unreported unless a future adapter supplies them; the UI does not invent plan limits. See https://render.com/docs/service-metrics and https://api-docs.render.com/reference/get-memory.

## AWS, Azure and GCP control-plane adapter

For multi-cloud support, deploy a small private adapter service that owns the AWS/Azure/GCP SDK clients and credentials. Configure its base URL and bearer token using the two environment variables above. Production requires HTTPS and a bearer token. The app backend calls only this fixed server-side URL; cloud credentials are never sent to the browser.

The adapter must implement:

- `GET /v1/resources` → `{ "resources": [ ...normalized resources... ] }`
- `POST /v1/resources/:resourceId/actions` with `{ "provider": "aws|azure|gcp", "action": "start|stop|restart" }`

Each resource should have `id`, `provider`, `name`, `type`, `region`, `plan`, `status`, `capabilities`, and a `usage` object containing optional `cpu`, `cpuUnit`, `memoryBytes`, `memoryLimitBytes`, `outboundBytes`, `bandwidthWindow`, `diskBytes`, `observedAt`, and `source`. Unknown measurements must be null/omitted, not zero. The backend filters providers to AWS, Azure and GCP, re-fetches the resource before every action, checks the advertised capability, requires typed confirmation, and writes a structured audit log.

The adapter service must independently enforce least-privilege cloud IAM, validate the requested provider/resource pair, reject unsupported lifecycle actions, and return only resources the connected account is authorized to manage. Do not expose a generic arbitrary-command endpoint.

## Lifecycle safety

- Start/stop/restart actions are Super Admin only and require typed confirmation.
- Render lifecycle controls currently apply only to supported compute services (web/private services and background workers); databases and static sites are not stopped through this UI.
- The API re-fetches the provider resource list and checks action capability before issuing a lifecycle request.
- A successful API response means the provider accepted the request, not that the resource reached its final state. Refresh status to verify.
- Keep production databases and dependencies running while stopping application services. MongoDB itself is read-only in this module.

## MongoDB

MongoDB status is read from the gateway's active Mongoose connection. The UI reports database data, storage, index sizes and collection-level counts/footprints. This is observational; it does not compact the cluster or guarantee reclaimed Atlas disk allocation. Use the separate Database Cleanup task for retention-controlled cleanup.

## Adding another cloud provider

Implement a server-side adapter exposing a common resource shape (`id`, `name`, `provider`, `type`, `region`, `plan`, `status`, `capabilities`, `usage`) and lifecycle methods. Register it in the infrastructure route without exposing credentials to the browser. Provider actions must be allow-listed, capability-checked, audited, and require explicit confirmation.