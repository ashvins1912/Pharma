# Pharma Platform

## Canonical structure

```text
Pharma/
├── frontend/                        # only web application
├── api-gateway/                     # only public API entry point
├── backend/                         # private platform/orchestration API
└── services/
    ├── inventory-service/           # inventory authority
    ├── order-service/               # order authority
    └── prescription-service/        # Python API + background worker
```

There is no second frontend, no root Vite application, no Vercel Express adapter, and no second Inventory/Order/Prescription implementation.

## Runtime topology

```text
Browser -> Frontend -> Public API Gateway
                         |-> Private Backend Platform API
                         |-> Private Inventory Service
                         |-> Private Order Service -> Inventory Service
                                                  -> Prescription Service -> Prescription Worker
```

The browser never receives internal service URLs or service JWT secrets.

## Local development

```bash
npm install
npm run dev
```

This starts Frontend on 3000, API Gateway on 8080, and Backend on 8090.

Run Inventory and Order independently when working on a domain service:

```bash
npm --workspace services/inventory-service run dev
npm --workspace services/order-service run dev
```

Prescription Service:

```bash
cd services/prescription-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
python -m app.workers
```

The frontend Vite proxy targets the API Gateway, not the backend directly.

## API routing

```text
/api/v1/inventory/*    -> Inventory Service
/api/v1/orders/*       -> Order Service
/api/* legacy/compound -> private Backend Platform API
```

Medicine Request and PUID-sensitive prescription workflows remain backend orchestrated until their authorization model is service-owned. The standalone Prescription Service is independently deployable and is consumed by Backend/Order over authenticated HTTP.

## Deployment

Each deployable component has its own Render configuration:

```text
frontend/render.yaml
api-gateway/render.yaml
backend/render.yaml
services/inventory-service/render.yaml
services/order-service/render.yaml
services/prescription-service/render.yaml
```

Recommended Render topology: public static Frontend, public API Gateway, and private Backend, Inventory, Order, and Prescription API services; Prescription processing runs as a background worker.

Never put private service secrets in frontend `VITE_` variables.

## Tests

```bash
npm test
```
