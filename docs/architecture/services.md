# Service boundaries

| Capability | Current owner | Database/access status |
| --- | --- | --- |
| Customer authentication/profile | Backend | Existing app database and Supabase |
| Medicine Request and Proposal | Backend | Not extracted |
| Legacy Orders/checkout | Backend | Existing main MongoDB |
| Versioned Order API | API Gateway routes to Order Service when configured; backend is fallback | Dedicated Order DB exists; most live checkout/order workflows remain in backend |
| Inventory | API Gateway routes to Inventory Service when configured | Dedicated Inventory DB exists; current catalog, admin UI, and checkout workflows remain in backend |
| Rider assignment/delivery | Backend | Not extracted |
| WhatsApp/notifications | Backend | Existing notifications/outbox processing retained |
| Search metrics/product discovery/data mart | Backend | Existing main database; product/discovery read model |

The Order Service must access inventory through the Inventory HTTP API, never
its MongoDB. The frontend accesses functionality through the public API
Gateway and does not import server implementation code.

Do not create placeholder microservices merely to match a diagram. Move a
capability directly to its service owner only when its API, persistence
ownership, authentication, and existing business behavior can be preserved
and tested. This development restructuring does not require production data
migration, dual writes, or legacy database synchronization.
