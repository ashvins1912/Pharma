# Pharma — Deployment & Operations Runbook

> Canonical deployment source of truth. Application architecture belongs in AI_CONTEXT.md.
> Repository: ashvins1912/Pharma | Branch: main | Verified: 2026-10-07

## 1. Topology
~~~text
Internet
  -> Frontend
  -> API Gateway
       -> private Backend platform API
       -> private Inventory Service
       -> private Order Service
       -> private Prescription API
                              <-> Prescription Worker
~~~

Current Render manifests:
- api-gateway/render.yaml — public Node web service
- services/inventory-service/render.yaml — private Node service + persistent disk
- services/order-service/render.yaml — private Node service
- services/prescription-service/render.yaml — Python API + Python worker

There is no current root Render blueprint for the complete platform. Do not recreate the old combined/root deployment unless explicitly requested.

## 2. Known environment URLs
~~~text
Frontend:    https://pharma-ui.onrender.com
API Gateway: https://pharma-api-gateway.onrender.com
~~~
Treat these as deployment values, not source-code constants. Verify live availability before claiming a service is healthy.

## 3. API Gateway Render
File: api-gateway/render.yaml

~~~text
runtime: node
rootDir: api-gateway
buildCommand: npm install
startCommand: npm start
healthCheckPath: /ready
proxy timeout: 120000 ms
auth timeout: 15000 ms
~~~

Required/configured environment:
~~~text
BACKEND_API_URL=http://ashvin-pharmacy-platform:10000
GATEWAY_AUTH_SECRET
SERVICE_AUTH_SECRET
INVENTORY_SERVICE_URL
ORDER_SERVICE_URL
PRESCRIPTION_SERVICE_URL
CORS_ALLOWED_ORIGINS
SERVICE_JWT_ISSUER=ashvin-pharmacy
SERVICE_JWT_AUDIENCE=inventory-service
ORDER_SERVICE_JWT_AUDIENCE=order-service
PRESCRIPTION_SERVICE_JWT_AUDIENCE=prescription-service
~~~

## 4. Inventory Render
File: services/inventory-service/render.yaml

~~~text
runtime: node
type: private service
rootDir: services/inventory-service
healthCheckPath: /ready
database: pharma_inventory
disk: /var/data (2 GB)
batch size: 250
worker concurrency: 1
max retries: 3
max file size: 104857600 bytes
~~~

Required:
~~~text
INVENTORY_MONGO_URI
SERVICE_AUTH_SECRET
~~~
The Render disk is for import/work files, not the authoritative inventory database.

### Inventory import publishing and production safety
- `INVENTORY_IMPORTS_ENABLED` defaults to `false` in application code. The Render Inventory Service manifest explicitly enables publishing for the deployed service.
- Before deploying that setting, confirm `INVENTORY_MONGO_URI` points to the dedicated Inventory database on a MongoDB replica set or sharded cluster. Publishing and rollback fail closed on standalone MongoDB because they require transactions.
- The preview endpoint is read-only and displays the verified tenant + branch target. Publishing requires explicit preview-fingerprint confirmation and rejects stale stock/catalogue snapshots.
- Import upload, review, row editing, publish, unpublish and rollback are routed through API Gateway and require the signed tenant/branch scope plus `inventory.import`.
- Each uploaded workbook is staged without changing live stock. Explicit publish applies product and inventory changes atomically and records before/after snapshots, import batch/row provenance and audit history.
- Stock reads, availability checks, reservations, release and deduction all use Inventory Service. Availability is summed across non-expired lots for the selected tenant + branch; reservations allocate FEFO across lots and persist exact allocations for safe release/deduction.
- Public storefront and admin inventory catalogues, plus single-product create/update/archive operations, use Inventory Service. The legacy `/api/medicines` bulk-upload mutation endpoints return HTTP 410; use the staged `/api/v1/inventory/imports` workflow.
- Batch rollback refuses to overwrite inventory, reservations or catalogue records changed after publication. Use unpublish/rollback only after checking the batch audit history.

Production rollout verification:
1. Confirm the Inventory MongoDB deployment supports transactions and that the Render service uses the intended dedicated database.
2. Deploy Inventory Service and API Gateway together; confirm both readiness checks are healthy.
3. Upload a small reviewed workbook for one test SKU and the intended tenant/branch.
4. Publish the row, then verify the same summed available quantity appears in the catalogue and medicine-request/order availability checks.
5. Create a test order whose quantity spans two lots; verify FEFO reservation allocation, then cancel and confirm each lot's reserved quantity is restored.
6. Verify dispatch deducts the exact allocated quantities. Finally, test unpublish/rollback against the test batch and confirm no newer inventory changes are overwritten.

### Authentication
- Email login creates Pharma HttpOnly session.
- Google exchange creates Pharma session.
- Direct Supabase JWT is rejected by application APIs.
- Expired/invalid Pharma token returns 401.
- Missing session returns 401.

### Authorization
- Allowed permission succeeds.
- Missing permission returns 403.
- Cross-tenant access is denied.
- Wrong branch context is denied.
- Internal calls require valid service credentials.

### Inventory
- Availability
- reserve
- release
- deduct
- import job creation
- partial import failure
- retry/failure download

### Prescription
- upload
- durable job
- worker claim
- OCR/NLP processing
- lease heartbeat
- review/approve/reject
- private document access
- lease-loss protection

### Order
- idempotent creation
- authoritative inventory reservation
- prescription gate remains blocked until MATCHED
- DB reconciliation works without browser polling
- cancellation/rejection races are safe

## 15. Local ports
~~~text
Frontend             3000
API Gateway           8080
Backend               8090
Inventory             5100
Order                 5200
Prescription API      8000
~~~

Typical commands:
~~~bash
cd frontend && npm install && npm run dev
cd api-gateway && npm install && npm run dev
cd backend && npm install && npm run dev
cd services/inventory-service && npm install && npm run dev
cd services/order-service && npm install && npm run dev
cd services/prescription-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
python -m app.workers
~~~

Run only services required by the feature.

## 16. Test/build commands
~~~bash
cd frontend && npm run lint && npm run build
cd api-gateway && npm test
cd backend && npm test
cd services/inventory-service && npm test
cd services/order-service && npm test
cd services/prescription-service && python -m pytest
~~~
Only report a command as passed if actually executed.

## 17. Troubleshooting

### Gateway 503
Check target URL, private service health, service networking, SERVICE_AUTH_SECRET and JWT issuer/audience.

### 401
Check Pharma cookie, RS256 keys, issuer/audience, expiry and service credentials.

### 403
Check role, permission name, tenant membership, branch context, permission version and Gateway scope mapping.

### CORS
Check exact frontend origin, CORS_ALLOWED_ORIGINS, preflight response and duplicate proxy headers.

### Prescription jobs stuck
Check worker process, Mongo connectivity, lease timestamps, PROCESSING_LEASE_SECONDS, HEARTBEAT_INTERVAL_SECONDS, retry/dead-letter state and worker logs.

### Inventory import failure
Check /var/data capacity, Mongo connectivity, batch/concurrency values and failed-record job state.

## 18. Rollback
Rollback the smallest affected component.

- Frontend-only issue -> frontend rollback.
- Gateway-only issue -> Gateway rollback.
- Service contract issue -> coordinate compatible provider + Gateway versions.
- Prescription API/worker contract issue -> coordinate API + worker rollback.

Never use production data deletion as rollback.

## 19. Security release checklist
- [ ] RS256 production keys configured
- [ ] No secrets committed
- [ ] Supabase service-role key is server-only
- [ ] Exact CORS origins configured
- [ ] Internal services private
- [ ] Prescription worker private
- [ ] HttpOnly session cookies enabled
- [ ] Service authentication enabled
- [ ] Tenant/branch authorization verified
- [ ] Health checks passing
- [ ] Sensitive logging disabled
- [ ] Prescription documents private
- [ ] Encryption key configured and securely backed up

## 20. Release principle
~~~text
main
 -> build/test
 -> private services healthy
 -> Gateway routing verified
 -> frontend configured
 -> authentication verified
 -> authorization + tenant isolation verified
 -> critical business smoke tests
 -> production release
~~~

Do not call a deployment production-ready merely because Render says the process is running.
