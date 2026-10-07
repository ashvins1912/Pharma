# Prescription Service

The canonical prescription domain service. It is a standalone Python/FastAPI API
plus a background worker. No Node.js prescription implementation is used.

## Local development

API:

```bash
cd services/prescription-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Worker:

```bash
python -m app.workers
```

The API and worker share the same MongoDB, encryption key, and service-auth secret.
The worker consumes durable processing jobs created by the API.

## Production

Use the colocated `render.yaml`. The API is intended to be a private Render
service and the worker is a Render background worker. Browser traffic should
reach the service through the platform's authorized API paths rather than a
public service URL.

Required production secrets:
- `MONGO_URI`
- `PRESCRIPTION_ENCRYPTION_KEY` (>=32 characters)
- `SERVICE_AUTH_SECRET` (>=32 characters)

## Ownership

This service owns prescription upload, OCR/NLP extraction, processing state,
review, approval/rejection, replacement, audit, and durable processing jobs.
Order/Medicine Request workflows consume it through HTTP; they do not import
its implementation.
