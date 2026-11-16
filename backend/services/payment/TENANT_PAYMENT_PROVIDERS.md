# Tenant payment provider operations

Supported configuration adapters: Razorpay, Cashfree PG and PayU India. Settings routes (through trusted API Gateway):
- GET /api/v1/payments/providers
- PUT /api/v1/payments/providers/:provider (body: environment sandbox|production, credentials object)
- PUT /api/v1/payments/providers/:provider/default (body: environment sandbox|production)

Tenant owner/admin access is required for provider configuration. Provider secrets are encrypted using AES-256-GCM and excluded from response serialization. Configure PAYMENT_CREDENTIAL_ENCRYPTION_KEY as 64 hex characters (32 bytes) and PAYMENT_CREDENTIAL_KEY_VERSION for rotation. Each provider requires its own webhook signing secret in the merchant dashboard; never place credentials in frontend code or source control.

Checkout: POST /api/v1/payments/intents (Idempotency-Key header, body orderNumber and returnUrl). The backend derives tenant, customer and amount from the persisted order. Razorpay returns an Orders API order id, Cashfree a payment_session_id, and PayU hosted checkout form fields.

Safety gate: This increment does not enable payment settlement. A redirect/checkout callback is not proof of payment. Provider-specific webhook signature verification, payment status fetch/reconciliation, refund handling, UI SDK wiring, and sandbox tests are separate mandatory rollout gates. Keep production provider disabled until these are implemented and tested.
