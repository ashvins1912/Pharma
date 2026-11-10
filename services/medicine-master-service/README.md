# Medicine Master Service

Private service for the shared Medicine Master catalogue, imports/reconciliation, audit history, GridFS files, and durable medicine-match resolution.

## Service boundary

- **Medicine Master owns:** shared catalogue records, matching/reference resolution, catalogue import batches, reconciliation, publication, provenance, audit history, and related workers.
- **Inventory owns:** tenant/branch products, stock, batches, reservations, inventory audit, and staged stock imports.
- Inventory retains only `src/medicine-match-queue.js` as a producer. It creates idempotent `MedicineMatchReference` records when tenant products change; it does not resolve matches or run catalogue/import workers.
- Both services intentionally use the same MongoDB database during this compatibility phase. Preserve the existing database and collection names.

## Authentication and authorization

Deploy as a **private Render service**. The API Gateway is the only supported caller; do not expose this service publicly or add browser CORS.

Every catalogue route requires a gateway-signed JWT: HS256 only, exact configured issuer and audience, subject `api-gateway`, short 60-second expiry, non-empty `userId` and `userRole`, and the route's exact scope. Accepted scopes are `inventory.catalogue.read` and `inventory.catalogue.import`.

The gateway authenticates the end user and enforces application permissions before issuing a service token. Import, reconciliation, publish, retry, merge, archive, edit, and audit operations require platform Super Admin authorization at the gateway; service-side checks repeat the platform-user requirement for import and catalogue mutations. Read-only catalogue operations require catalogue-read permission. Never trust tenant/branch headers as authorization claims; signed gateway claims are authoritative.

Missing, invalid, or expired credentials return 401. A valid caller without the required scope returns 403. Browser session tokens are not service credentials.

## API contract

All paths are API Gateway paths; the gateway preserves these paths while proxying to the private service.

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/inventory/catalogue/medicines` | Authenticated catalogue read |
| GET | `/api/v1/inventory/catalogue/medicines/:medicineId` | Authenticated catalogue read |
| GET | `/api/v1/inventory/catalogue/medicines/match` | Public, read-only storefront match |
| GET | `/api/v1/inventory/catalogue/imports/:batchId/mapping-queue` | Platform Super Admin; 100-row candidate review queue |
| POST | `/api/v1/inventory/catalogue/imports/:batchId/map` | Platform Super Admin; selected-field mapping and Store approval |
| POST | `/api/v1/inventory/catalogue/medicines/match/batch` | Platform Super Admin |
| PATCH | `/api/v1/inventory/catalogue/medicines/:medicineId` | Platform Super Admin; audited |
| DELETE | `/api/v1/inventory/catalogue/medicines/:medicineId` | Platform Super Admin; soft archive with provenance |
| GET | `/api/v1/inventory/catalogue/medicines/:medicineId/audit` | Platform Super Admin |
| POST | `/api/v1/inventory/catalogue/imports/preview` | Platform Super Admin; multipart field `jsonFile` |
| POST | `/api/v1/inventory/catalogue/imports/merge` | Platform Super Admin |
| POST | `/api/v1/inventory/catalogue/imports/remove-selected` | Platform Super Admin |
| GET | `/api/v1/inventory/catalogue/imports` | Platform Super Admin |
| GET | `/api/v1/inventory/catalogue/imports/jobs/:jobId` | Platform Super Admin |
| POST | `/api/v1/inventory/catalogue/imports/jobs/:jobId/retry` | Platform Super Admin |
| POST | `/api/v1/inventory/catalogue/imports/jobs/:jobId/restart` | Platform Super Admin |
| GET | `/api/v1/inventory/catalogue/imports/:batchId` | Platform Super Admin |
| GET | `/api/v1/inventory/catalogue/imports/:batchId/records` | Platform Super Admin |
| POST | `/api/v1/inventory/catalogue/imports/:batchId/approve` | Platform Super Admin |
| POST | `/api/v1/inventory/catalogue/imports/:batchId/publish` | Platform Super Admin |

The public match endpoint is read-only. Do not include credentials or customer personal data in catalogue search payloads.

## Application secrets

Set values in Render **Environment** settings only. Never commit real values, put them in frontend variables/build args, or print them in logs.

| Variable | Configuration |
| --- | --- |
| `MEDICINE_MASTER_MONGO_URI` | Exact same MongoDB URI as Inventory's `INVENTORY_MONGO_URI`; mark secret. |
| `MEDICINE_MASTER_DB_NAME` | Existing database name, currently `pharma_inventory`. |
| `SERVICE_AUTH_SECRET` | Exact same high-entropy secret as API Gateway and services validating its HS256 tokens; mark secret. |
| `SERVICE_JWT_ISSUER` | Same issuer as Gateway, currently `ashvin-pharmacy`. |
| `MEDICINE_MASTER_SERVICE_JWT_AUDIENCE` | `medicine-master-service`. |
| `MEDICINE_MASTER_IMPORT_MAX_FILE_BYTES` | Optional; default 115343360 (110 MiB). |
| `PORT` | Render supplied; blueprint sets 10000. |

Use at least 32 random bytes for service signing secrets; never reuse database passwords as JWT secrets. Restrict MongoDB credentials to the required database/operations, enable TLS, and use provider network controls.

**Rotation:** coordinate `SERVICE_AUTH_SECRET` changes across Gateway, Medicine Master, and Inventory in one deployment window; mismatched secrets invalidate service calls. For MongoDB rotation, add a replacement credential, update both services, verify readiness/traffic, then revoke the old credential. Never paste real values into PRs or issue comments.

## Deployment

1. Create the private service from `services/medicine-master-service/render.yaml`.
2. Configure the same MongoDB URI/database as Inventory and the same service JWT secret/issuer as Gateway.
3. Verify private networking and `/ready`.
4. Set Gateway `MEDICINE_MASTER_SERVICE_URL` to the private Render hostname and audience to `medicine-master-service`.
5. Deploy Gateway, then Inventory. Keep the previous Inventory release available for rollback until reads, imports, match resolution, and queue processing are verified.
6. Verify authenticated read, unauthenticated denial, non-admin mutation denial, Super Admin edit/archive, import preview/publish, and worker retry/restart. Confirm Inventory enqueues a reference and Medicine Master resolves it.
7. Monitor 401/403/5xx rates, queue depth, import failures, MongoDB connection saturation, and readiness.

## Health and operations

- `GET /health`: process liveness only.
- `GET /ready`: 200 only while MongoDB is connected; otherwise 503.
- Logs include request IDs, method, path, and status; never log authorization headers, JWTs, MongoDB URIs, or uploaded contents.
- Graceful shutdown stops workers before disconnecting MongoDB.

## Validation

Before deployment run `npm --workspace services/medicine-master-service test`, API Gateway tests, and root workspace test/build commands. A readiness probe alone is not an authorization or API acceptance test.


### Store catalogue approval boundary

Imported Medicine Master records are not eligible for storefront matching until `storeApproved` is set by the platform-admin mapping workflow. The mapping queue reviews published import batches in windows of up to 100 records, presents ranked candidate evidence, and records the selected target and approved field list. Mapping approval controls Store visibility; it does not certify clinical, prescription, licensing or regulatory claims.
