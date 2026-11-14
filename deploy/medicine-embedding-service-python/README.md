# Python ONNX inference service (parallel rollout)

This is an isolated Python implementation of the Medicine Master embedding inference contract. It is intentionally deployed beside the existing Node inference service first; it does not replace the JS Medicine Master API, change the MongoDB schema, or alter the existing vector index.

## Contract

- Authenticated `POST /v1/embeddings` with `{"texts":["..."]}`.
- Response fields exactly match the existing JS caller: `model`, `revision`, `dimensions`, and `embeddings`.
- Maximum 32 texts per request, 4,000 characters per text, 256 tokenizer tokens.
- `GET /health` is process liveness; `GET /ready` is model readiness.
- Bearer token is compared in constant time. The token is never returned or logged.
- ONNX Runtime CPU execution; one Uvicorn worker to avoid loading duplicate model copies.
- Mean pooling uses the attention mask and L2 normalization, matching the existing feature-extraction pipeline's intended output.

## Deploy as a canary

1. Create a separate Render service from this directory's `render.yaml` (or deploy the Dockerfile to Cloud Run).
2. Pin `MEDICINE_VECTOR_MODEL_REVISION` to the same immutable model commit used by the existing indexer and current inference service. Do not use `main` in production.
3. Set `MEDICINE_EMBEDDING_TOKEN` to a new high-entropy secret. Do not reuse or expose it in frontend variables.
4. Configure the Medicine Master service's `MEDICINE_VECTOR_INFERENCE_URL` and `MEDICINE_VECTOR_INFERENCE_TOKEN` to the canary URL and token in staging only.
5. Keep `MEDICINE_VECTOR_SEARCH_ENABLED=false` until the model revision, output dimensions, relevance, and latency have been verified. Enable vector search only in staging first.
6. Compare Python and existing JS embeddings for the same fixture set. Confirm vector cosine similarity and top-K result overlap before routing production traffic.
7. Roll back by restoring the existing JS inference URL/token. No API, catalogue, order, inventory, or vector-index migration is required.

The current JS caller already validates model ID, revision, dimensions, row count, and numeric values. It will reject an incompatible response and safely use keyword search.

## Local validation

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
MEDICINE_EMBEDDING_TOKEN=test-secret-token-with-at-least-32-chars python -m unittest discover -s tests -v
uvicorn app.main:app --host 127.0.0.1 --port 8080
```

A successful unit test does not prove model compatibility or production capacity. Run the existing `tests/load/medicine-search-40-vus.js` against staging and record p95/p99, error rate, memory, cold-start time, and top-K relevance before any production cutover.
