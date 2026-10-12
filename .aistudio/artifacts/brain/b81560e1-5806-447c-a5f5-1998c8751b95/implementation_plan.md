# Implementation Plan - Decoupled WebSocket Service & Multi-Service Render Deployment

## 1. Overview & Objectives
- **CORS Review**: Harden and standardize universal CORS middleware across all backend and gateway endpoints, preventing preflight failures for custom multi-tenant headers (`X-Pharma-Client`, `X-Tenant-Id`, etc.).
- **Decoupled WebSocket Service**: Create an independent, standalone WebSocket microservice with multi-service proxy routing support.
- **Live Bell Icon & Fulfillment Notifications**: Connect the frontend notification bell icon and order fulfillment dashboard directly to the decoupled WebSocket event stream for real-time order updates and rider assignments.
- **Render Deployment Configuration**: Provide comprehensive `render.yaml` and service definitions for all microservices (including backend API, decoupled WebSocket service, prescription verification service, and Redis/in-memory cache service).

---

## 2. Proposed Architectural Changes

### A. CORS Standardization (`backend/security/corsPolicy.js`)
- Standardize allowed origins, credentials, and allowed headers (`Content-Type`, `Authorization`, `X-Pharma-Client`, `X-Tenant-Id`, `X-Correlation-ID`, `Idempotency-Key`).
- Ensure preflight (`OPTIONS`) handling is permissive across all gateway and backend routes.

### B. Decoupled WebSocket Service (`backend/services/websocket/`)
- Create an independent WebSocket microservice (`websocket-service/server.js` or `backend/services/websocket/WebsocketServer.js`) handling real-time rooms (`rider_${riderId}`, `order_tracking_${orderId}`, `tenant_${tenantId}`, `bell_notifications`).
- Support proxy routing and multi-service event publishing.

### C. Frontend Notification Bell & Order Stream Integration (`frontend/src/`)
- Update `NotificationBell.jsx` and `AdminAlertBell.jsx` to listen to live WebSocket events for bell icon badges and fulfillment alerts.
- Connect `useOrders` / `useOrderDashboard` to live WebSocket event emitters.

### D. Render Deployment Manifest (`render.yaml`)
- Define Render services:
  1. `ashvin-pharma-api` (Node.js backend API)
  2. `ashvin-pharma-websocket` (Decoupled WebSocket server)
  3. `ashvin-pharma-prescription` (Prescription verification service)
  4. `ashvin-pharma-cache` (Redis / Cache service)
  5. `ashvin-pharma-frontend` (Vite React frontend)

---

## 3. Verification Plan
- Run `compile_applet` and `lint_applet` to ensure zero compilation or TypeScript errors.
- Verify WebSocket client-server connection and CORS preflight headers.
