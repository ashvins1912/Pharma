# Shared Medicine Master Atlas Vector Search

Database: existing Atlas database (`pharma_inventory`). Catalogue: existing shared `MedicineMaster` collection. Embeddings: local ONNX inference via Transformers.js. Rollout: staged and disabled by default.

The additive projection is `medicine_master_vector_index`; its checkpoint is `medicine_master_vector_sync_state`. MedicineMaster remains the source of truth. Only shared catalogue text fields are embedded; tenant pricing, stock, batches, expiry, customer and prescription data are excluded. Inventory Service remains authoritative for tenant/branch availability and pricing.

Default model: `onnx-community/all-MiniLM-L6-v2-ONNX` (384 dimensions). It is downloaded from Hugging Face on first use; inference runs locally. Pin a reviewed immutable model revision and persistent model cache for production. Evaluate English, Hindi, Kannada, transliteration and actual pharmacy query relevance before enabling customer-facing traffic.

Create Atlas Vector Search index `medicine_master_vector_idx` on `medicine_master_vector_index`:
```json
{"fields":[{"type":"vector","path":"embedding","numDimensions":384,"similarity":"cosine"},{"type":"filter","path":"isArchived"}]}
```
Check cluster compatibility and combined Search/Vector Search index quota first. The shared catalogue is global, so do not add tenant filters. Vector similarity is discovery only, never proof of clinical equivalence or authority to substitute medicine.

Environment on the private Medicine Master service:
- `MEDICINE_VECTOR_SEARCH_ENABLED=false`
- `MEDICINE_VECTOR_MODEL=onnx-community/all-MiniLM-L6-v2-ONNX`
- `MEDICINE_VECTOR_DIMENSIONS=384`
- `MEDICINE_VECTOR_COLLECTION=medicine_master_vector_index`
- `MEDICINE_VECTOR_STATE_COLLECTION=medicine_master_vector_sync_state`
- `MEDICINE_VECTOR_INDEX=medicine_master_vector_idx`
- `MEDICINE_VECTOR_SYNC_INTERVAL_MS=30000`

Rollout: deploy disabled; create Atlas index; run `npm --workspace services/medicine-master-service run vector:reindex` (dry-run); apply in staging with `npm --workspace services/medicine-master-service run vector:reindex -- --apply`; verify checkpoint READY, model/dimensions and Atlas index; enable in staging; compare against keyword results; release internal readers, then limited storefront traffic only after quality review. Roll back immediately by setting the feature flag false. Keyword fallback remains active.

API: `GET /api/v1/inventory/catalogue/medicines/search?q=paracetamol%20650&limit=15`. Requires `inventory.catalogue.read`. Existing catalogue list and match endpoints remain unchanged. Results contain only shared catalogue metadata; use Inventory Service for tenant pricing/stock and preserve pharmacist/prescription workflows.

Monitor vector index status, fallback rate, latency, empty-result rate, model startup, CPU/memory and relevance. Rebuild the projection when model or dimensions change; never mix model vectors.
