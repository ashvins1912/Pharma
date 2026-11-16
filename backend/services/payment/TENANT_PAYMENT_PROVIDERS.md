# Tenant payment provider operations

Supported configuration adapters: Razorpay, Cashfree PG and PayU India. Settings routes (through trusted API Gateway):
- GET /api/v1/payments/providers
- PUT /api/v1/payments/providers/:provider (body: environment sandbox|production, credentials object)
- PUT /api/v1/payments/providers/:provider/default (body: environment sandbox|production)

Tenant owner/admin access is required for provider configuration. Provider secrets are encrypted using AES-256-GCM and excluded from response serialization. Configure PAYMENT_CREDENTIAL_ENCRYPTION_KEY as 64 hex characters (32 bytes) and PAYMENT_CREDENTIAL_KEY_VERSION for rotation. Each provider requires its own webhook signing secret in the merchant dashboard; never place credentials in frontend code or source control.

Checkout: POST /api/v1/payments/intents (Idempotency-Key header, body orderNumber and returnUrl). The backend derives tenant, customer and amount from the persisted order. Razorpay returns an Orders API order id, Cashfree a payment_session_id, and PayU hosted checkout form fields.

Webhook ingress: Razorpay HMAC-SHA256, Cashfree timestamped HMAC-SHA256, and PayU reverse SHA-512 callback hash are verified against the tenant's encrypted credentials before the normalized capture event enters the idempotent journal/outbox transaction. Raw JSON and urlencoded callback bodies are captured before CSRF middleware. A browser redirect is never treated as payment confirmation. Reconciliation APIs, refund handling, UI SDK wiring, and full sandbox end-to-end tests remain mandatory rollout gates. Live checkout is disabled unless PAYMENT_PROVIDER_LIVE_CHECKOUT_ENABLED=true; keep it disabled until sandbox tests and reconciliation are complete.
