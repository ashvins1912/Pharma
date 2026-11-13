# Shared Medicine Master Atlas Vector Search

## Architecture and safety

The customer-facing Medicine Master process does **not** load ONNX, download models, or run a vector synchronization worker. Query embeddings are requested from a separately deployed, self-hosted ONNX inference service. The service is supported on either a separate Render Web Service or Google Cloud Run. The same service/model/configuration is used by the scheduled GitHub Actions catalogue indexer, so query and catalogue vectors cannot silently drift into different embedding spaces.

The search endpoint, response shape, gateway capability and existing catalogue list/match routes remain unchanged. If the inference service is missing, times out, returns an error, or reports a model/dimension mismatch, the endpoint returns keyword results using the existing contract. Keep `MEDICINE_VECTOR_SEARCH_ENABLED=false` until Atlas and inference are staged and validated.

MedicineMaster in the existing Atlas database (`pharma_inventory`) remains the source of truth. Projection: `medicine_master_vector_index`; state: `medicine_master_vector_sync_state`. Only allowlisted shared catalogue fields are embedded. Tenant pricing, branch stock, batches, expiry, customer details and prescription data are excluded. Inventory Service remains authoritative for stock and pricing.

Default model: `onnx-community/all-MiniLM-L6-v2-ONNX`, 384 dimensions. Set `MEDICINE_VECTOR_MODEL_REVISION` to an immutable Hugging Face commit SHA in the inference service, Medicine Master, and GitHub repository variable `MEDICINE_VECTOR_MODEL_REVISION`; keep it identical across environments. The indexer records and validates the revision so a model upgrade cannot silently mix vector spaces. Never mix vectors from different model revisions.

## Isolated inference service

Required environment:
- `MEDICINE_VECTOR_MODEL` (default above)
- `MEDICINE_VECTOR_MODEL_REVISION` (pin to reviewed immutable commit SHA)
- `MEDICINE_VECTOR_DIMENSIONS=384`
- `MEDICINE_EMBEDDING_TOKEN` (long random secret; same value in caller and service)
- `HF_HOME=/var/cache/huggingface` (or another writable cache path)

The service exposes authenticated `POST /v1/embeddings` and health/readiness endpoints. Requests are bounded to 32 short texts. It must be reachable over HTTPS only. Do not expose the token to the browser or frontend.

### Option A: separate Render service

Deploy `deploy/medicine-embedding-service` as its own Render Web Service using its Dockerfile (or import the service blueprint in `deploy/medicine-embedding-service/render.yaml`). Use a paid always-on instance for predictable production latency. Render Free is supported for staging/low-volume trials only: it may sleep, cold-start while downloading/loading the model, and has tight CPU/RAM limits. A Free inference service must never be a dependency for checkout/order writes; search falls back to keyword mode.

Set on Medicine Master:
- `MEDICINE_VECTOR_INFERENCE_URL=https://<your-render-embedding-service>`
- `MEDICINE_VECTOR_INFERENCE_TOKEN=<same secret>`
- `MEDICINE_VECTOR_INFERENCE_TIMEOUT_MS=1800`

### Option B: Google Cloud Run

Build and deploy the same Dockerfile:
```bash
gcloud builds submit deploy/medicine-embedding-service --tag REGION-docker.pkg.dev/PROJECT/pharma/medicine-embedding:VERSION
gcloud run deploy pharma-medicine-embedding \
  --image REGION-docker.pkg.dev/PROJECT/pharma/medicine-embedding:VERSION \
  --region REGION --port 8080 --no-allow-unauthenticated \
  --memory 2Gi --cpu 2 --concurrency 8 --min 0 --max 5 \\
  --set-env-vars MEDICINE_VECTOR_MODEL_REVISION=REVISION
```
Configure `MEDICINE_EMBEDDING_TOKEN` through Secret Manager (for example `--set-secrets MEDICINE_EMBEDDING_TOKEN=pharma-medicine-embedding-token:latest`), never as a literal command-line value. This deployment uses Cloud Run HTTPS plus the service's constant-time-checked high-entropy bearer token at the application layer; the endpoint is not unauthenticated even though Cloud Run invocation is public. Rotate the token in Secret Manager and the Medicine Master environment together. For organizations requiring Cloud Run IAM-only ingress, add an OIDC ID-token transport adapter before switching to `--no-allow-unauthenticated`. Set `MEDICINE_VECTOR_INFERENCE_URL` to the Cloud Run URL.

## GitHub Actions catalogue indexing

Workflow: `.github/workflows/medicine-vector-index.yml`. It supports manual dispatch and a scheduled run. Configure repository secrets:
- `MEDICINE_MASTER_MONGO_URI`: restricted Atlas user with read access to MedicineMaster and write access only to vector projection/state collections
- `MEDICINE_VECTOR_INFERENCE_URL`
- `MEDICINE_VECTOR_INFERENCE_TOKEN`

The workflow runs the existing reindex script from a GitHub-hosted runner and sends batches to the isolated local-ONNX service. It is not a real-time queue. Run manually after shared catalogue imports/updates and keep a weekly scheduled full reconciliation (the current script rebuilds the full projection; it is not an incremental event consumer). Atlas network access must be restricted; if GitHub-hosted runner IP allowlisting is not feasible, use a self-hosted ephemeral runner with a stable egress IP rather than opening Atlas broadly.

Dry-run:
```bash
npm --workspace services/medicine-master-service run vector:reindex
```
Apply only after the Atlas Search index exists and is queryable:
```bash
npm --workspace services/medicine-master-service run vector:reindex -- --apply
```
The script refuses to mark the projection READY unless Atlas reports the configured Vector Search index as queryable. It records FAILED on indexing errors. Re-run is idempotent by medicineId.

## Atlas index

Create `medicine_master_vector_idx` on `medicine_master_vector_index`:
```json
{"fields":[{"type":"vector","path":"embedding","numDimensions":384,"similarity":"cosine"},{"type":"filter","path":"isArchived"}]}
```
Check Atlas M0 Search/Vector Search index quota, storage, operation throughput and query latency before enabling. Vector projection storage can be material on M0; measure actual BSON size. Do not store patient/tenant information in this projection.

## Rollout and rollback

1. Deploy the inference service separately and verify authenticated health/readiness.
2. Create the Atlas Vector Search index and wait until queryable.
3. Configure GitHub Actions secrets; run dry-run, then manual apply.
4. Verify checkpoint model, revision, dimensions, count and READY status.
5. Keep `MEDICINE_VECTOR_SEARCH_ENABLED=false` for initial canary; then enable only in staging and compare with keyword results.
6. Release limited search traffic after relevance, security and performance checks.
7. Roll back by setting `MEDICINE_VECTOR_SEARCH_ENABLED=false`; keyword fallback remains available. No order, fulfilment, checkout, prescription or inventory write flow depends on vector search.

API remains `GET /api/v1/inventory/catalogue/medicines/search?q=paracetamol%20650&limit=15`, capability `inventory.catalogue.read`. Similarity is discovery-only and does not establish clinical equivalence or authorize substitution.

## 40-concurrent-user acceptance

Run `k6 run tests/load/medicine-search-40-vus.js` against staging with `MEDICINE_SEARCH_URL` and an authorized `MEDICINE_SEARCH_TOKEN`. This harness sustains 40 virtual users for 3 minutes. Proposed gates: HTTP failures <0.5%, p95 <1.5s, p99 <3s. Record actual results; a script or configured threshold is not evidence of a pass.

Also run end-to-end customer journeys concurrently: storefront search, product detail, branch selection, cart, checkout quote/confirm, order history, medicine request, prescription upload/review, and fulfilment. Assert no regression in authorization/tenant isolation and no changes in order/inventory state caused by search. Capture Render/Cloud Run CPU, memory, cold starts, inference saturation, Atlas ops/sec, connections, storage, vector fallback rate, and p95/p99. Atlas M0 and Render Free have tight shared-resource limits; 40 VUs is a test target, not a capacity guarantee. If thresholds fail, keep vector disabled and use keyword search until capacity is upgraded or optimized.
