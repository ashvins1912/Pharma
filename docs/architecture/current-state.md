# Current architecture state

## Canonical projects

- `frontend/` — only frontend
- `api-gateway/` — only public gateway
- `backend/` — private platform/orchestration API
- `services/inventory-service/` — canonical Inventory Service
- `services/order-service/` — canonical Order Service
- `services/prescription-service/` — canonical Python Prescription Service plus worker

## Removed duplicate surfaces

The restructuring removes the root Vite/React application, root combined Express/Vite runner, Vercel Express adapter, root combined Render deployment, duplicate Inventory service trees, legacy Node Prescription implementation, and legacy internal Inventory/Order/Prescription gateway routes.

## Routing

The public Gateway directly routes versioned Inventory and Order APIs to their private authoritative services. Compound workflows and PUID-sensitive Prescription workflows remain backend orchestrated until their service-level authorization is complete.

## Persistence

- Inventory Service owns Inventory MongoDB.
- Order Service owns Order MongoDB.
- Prescription Service owns Prescription MongoDB.
- Backend owns only platform data it has not yet extracted.
- Cross-service database access is prohibited.

## Validation

A real clean-checkout build/test and Render smoke test is still required before merging to main. The repository boundary is now explicit, but end-to-end checkout, Medicine Request, Prescription, Order, Delivery and WhatsApp flows should be exercised against the deployed topology.