# Super Admin infrastructure operations

The Super Admin workspace is provider-neutral. The initial lifecycle adapter is Render; the normalized resource contract is designed for additional AWS, Azure, GCP and other provider adapters. MongoDB usage is read from the gateway's active Mongoose connection.

## Backend secrets and configuration

Configure these in the backend API service's secret environment (for Render, the backend service's Environment page). Never put provider credentials in Vite/frontend variables.

| Variable | Purpose |
| --- | --- |
| `RENDER_API_KEY` | Render API key. Enables listing Render services and service lifecycle actions. |
| `INFRASTRUCTURE_METRICS_ENDPOINT` | Optional HTTPS endpoint returning normalized resource metrics JSON. |
| `INFRASTRUCTURE_METRICS_TOKEN` | Optional bearer token sent to the metrics endpoint. |
| `INFRASTRUCTURE_METRICS_PROVIDER` | Optional display label for the configured metrics source. |

After changing backend environment variables, redeploy/restart the backend API service.

## Normalized metrics adapter response

The metrics endpoint must return JSON in this shape:

```json
{
  "resources": [
    {
      "provider": "render",
      "resourceId": "srv-xxxxxxxx",
      "cpu": 23.4,
      "memoryBytes": 536870912,
      "memoryLimitBytes": 1073741824,
      "outboundBytes": 104857600,
      "diskBytes": 209715200,
      "observedAt": "2026-11-13T12:00:00.000Z",
      "source": "OpenTelemetry"
    }
  ]
}
```

`outboundBytes` should represent bandwidth consumed over the measurement window, not a cumulative counter unless the adapter computes a delta. Unknown metrics must be omitted/null, never reported as zero. Resource IDs must match provider resource IDs.

Render's service-list API does not return live CPU/RAM/egress samples. Render documents CPU, memory, disk and outbound bandwidth metrics and supports streaming metrics to OpenTelemetry-compatible destinations on eligible plans. Connect that stream to an authenticated normalizer that serves the response above. See https://render.com/docs/service-metrics and https://render.com/docs/metrics-streams.

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