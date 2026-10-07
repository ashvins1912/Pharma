# Architecture

## Canonical deployment

Browser -> Frontend -> Public API Gateway
                          |-> Private Backend Platform API
                          |-> Private Inventory Service
                          |-> Private Order Service
                                |-> Inventory Service
                                |-> Prescription Service -> Prescription Worker

### Ownership

- Frontend: the only browser application.
- API Gateway: the only public API boundary; CORS, request IDs, authentication handoff and scoped service-token issuance.
- Backend: private platform/orchestration boundary for Customer/Person/PUID, tenant/vendor capabilities, Medicine Request, Delivery, WhatsApp, notifications and other compound workflows.
- Inventory Service: authoritative owner of product metadata, stock, reservations and imports.
- Order Service: authoritative owner of Order records, idempotency, lifecycle, fulfillment gates and events.
- Prescription Service: authoritative owner of documents, OCR/NLP extraction, review, approval and processing jobs.

### Public routes

| Route | Target |
| --- | --- |
| `/api/v1/inventory/*` | Inventory Service |
| `/api/v1/orders/*` | Order Service |
| other `/api/*` | Backend Platform API |

The Gateway is a router and security boundary, not a business-logic layer.

### Service-to-service

Order calls Inventory and Prescription through authenticated HTTP. Backend calls Prescription through the Prescription client. No service imports another service's implementation code, and no cross-service MongoDB writes are allowed.

### Deployment rule

Deploy Frontend and API Gateway publicly. Deploy Backend, Inventory, Order and Prescription API privately. Deploy the Prescription Worker as a background worker.

Direct browser routing to Prescription is intentionally not enabled yet because PUID ownership authorization is still owned by Customer/Person/Backend. This avoids weakening authorization during the extraction.