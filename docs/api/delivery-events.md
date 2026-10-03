# Delivery event integration

The delivery action routes extend the existing MongoDB `Order` lifecycle. Actions are accepted only while the order is `Dispatched` and the supplied rider matches the assigned rider. Successful delivery maps to the existing `Delivered` status; `not_reachable` preserves `Dispatched` and increments `deliveryAttempts`.

## Rider WhatsApp action links

When both `WHATSAPP_DELIVERY_TRACKING_ENABLED=true` and `MONGO_TRANSACTIONS_CONFIRMED=true`, the existing WhatsApp adapter appends short-lived rider action links to the rider's dispatch message. `DELIVERY_ACTION_BASE_URL` must point to `/api/v1/delivery/events/actions`. Opening a link only displays a confirmation screen. The explicit button submits the action.

## Server callback

`POST /api/v1/delivery/events` also accepts server-to-server callbacks. Set `X-Delivery-Timestamp` to the current Unix timestamp in seconds. Sign `${timestamp}.${rawBody}` with HMAC-SHA256 using `DELIVERY_EVENT_SECRET`, and send the lowercase hexadecimal digest in `X-Delivery-Signature`. Timestamps outside a five-minute window are rejected.

```json
{
  "eventId": "provider-or-rider-event-id",
  "action": "cash_received",
  "orderId": "MongoDB order object ID",
  "riderId": "assigned rider ID"
}
```

Allowed actions are `cash_received`, `payment_pending`, and `not_reachable`. The unique event identity is `eventId + action`. `cash_received` is accepted only for COD/cash orders and records order payment, the rider cash ledger entry, the delivery audit, and the existing order-delivered outbox event in one MongoDB transaction. A failed attempt leaves order status unchanged. Once `DELIVERY_MAX_ATTEMPTS` is reached, the response marks the delivery for manual review; the existing order lifecycle has no return-to-origin state to transition into.

Before enabling callbacks, verify that the production MongoDB deployment supports transactions. Startup checks MongoDB's `hello` response for replica-set or sharded-cluster topology; callbacks also require operator confirmation with `MONGO_TRANSACTIONS_CONFIRMED=true`. Unsupported deployments fail closed without applying the event.
