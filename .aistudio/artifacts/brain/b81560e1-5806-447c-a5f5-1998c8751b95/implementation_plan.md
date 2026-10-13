# Implementation Plan - Dynamic Dispensary Caching, WebSocket Pub/Sub Delivery & Profile Persistence

## 1. Overview & Objectives
- **Dynamic Dispensary Selection**: Remove hardcoded branch data. Fetch available branches/dispensaries dynamically from DB, cache them using `CacheService` (`puts`/`gets` with 15-minute TTL and reload mechanism), and sort by GPS proximity.
- **WebSocket Pub/Sub Delivery**: Fix WebSocket pub/sub connection and event propagation so customers automatically subscribe to their private `bell_notifications_${userId}` room upon connection and reliably receive live order and medicine request notifications.
- **Customer Profile Persistence**: Implement robust authenticated profile update flow that saves customer details securely to MongoDB.

---

## 2. Proposed Architectural Changes

### A. Dynamic Dispensary Cache & Proximity Engine (`backend/services/DispensaryService.js` or `backend/gateway/routes/tenants.js`)
- Fetch tenants/branches from database.
- Utilize `cacheService.set()` (`put`) with 15-minute TTL and automatic reload/refresh on start or update.
- Expose `/api/dispensaries` endpoint with Haversine distance sorting based on user GPS coordinates.

### B. WebSocket Pub/Sub Client & Room Subscription (`frontend/src/context/AppContext.jsx` or `frontend/src/App.jsx`)
- Ensure the frontend WebSocket client establishes connection, emits `join_bell_room` with the authenticated `userId`, and listens for `new_order_alert`, `order_update`, and notification events.

### C. Customer Profile Persistence (`backend/routes/profileRoutes.js` & `frontend/src/components/UserProfileModal.jsx`)
- Ensure `/api/user/profile` (or equivalent profile update route) correctly validates the authenticated user session, persists updates to MongoDB (`UserProfile` / `UserIdentity`), and returns updated profile data.

---

## 3. Verification Plan
- Run `compile_applet` and `lint_applet` to verify zero compilation or lint errors.
- Test dispensary proximity sorting, cache retrieval, WebSocket notification delivery, and profile saving.
