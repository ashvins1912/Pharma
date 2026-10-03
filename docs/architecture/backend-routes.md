# Backend HTTP route architecture

## Request flow

```text
Public API Gateway
  -> backend/server.js (process configuration and infrastructure startup)
  -> backend/routes/apiRoutes.js (public URL composition)
  -> route authentication and authorization
  -> existing domain services/dataStore or persistence adapters
  -> response DTO
```

`server.js` owns application middleware, health checks, infrastructure
initialization, the private Gateway identity endpoint, and the global error
boundary. `apiRoutes.js` is the only registry for public `/api/*` routes.
Domain route modules own their URL-specific authorization and HTTP response
contract. The internal identity route is deliberately outside the public API
router.

Legacy URL contracts are preserved while routing definitions move out of the
process entrypoint:

| Public routes | Route module |
| --- | --- |
| `/api/auth/*` | `authRoutes.js` |
| `/api/medicines/*` | `medicineRoutes.js` |
| `/api/orders/*`, `/api/v1/orders/*` | `orderRoutes.js`, `versionedOrderRoutes.js` |
| `/api/profile/*`, `/api/user/*` | `profileRoutes.js` (current and compatibility APIs) |
| `/api/riders/*` | `riderProfileRoutes.js` |
| `/api/coupons/*` | `couponRoutes.js` |
| `/api/medicine-requests/*`, `/api/admin/medicine-requests/*` | `medicineRequestRoutes.js` |
| `/api/proposals/*` | `proposalRoutes.js` |
| `/api/admin/whatsapp/*` | `whatsappRoutes.js` |
| `/api/admin/audit-logs` | `adminRoutes.js` |
| `/api/test/seed-medicines` | `testRoutes.js` |
| `/internal/gateway/authenticate` | `internalGatewayRoutes.js` |

The medicine-request route receives its customer/staff audience from the route
composition layer; it does not infer authorization from a URL substring.

## Current architecture assessment

The HTTP composition and error boundary are centralized, but these modules are
not yet uniformly Clean Architecture controllers. Several still contain
business rules and directly call Mongoose models or `dataStore`: notably auth,
coupon, medicine catalog/import, order, profile, rider, proposal, and
versioned-order routes. Medicine Request also combines upload handling,
authorization, workflow calls, and persistence. Preserve these contracts while
extracting use cases and repositories incrementally; do not add abstractions
that merely wrap a single Mongoose call.

Target the following direction for future domain work:

```text
Express router
  -> thin controller (input/output mapping only)
  -> application use case (business policy)
  -> repository/storage/payment/notification ports
  -> Mongoose, Supabase, GridFS, WhatsApp adapters
```

Keep user authentication in the backend's existing identity provider adapter.
The API Gateway consumes the private, verified principal and performs service
authorization/token issuance; domain routes should not mint service tokens.
The common error middleware is for unexpected failures only. Expected
validation and business outcomes should retain their established status codes
and response shapes at their route/controller boundary.
