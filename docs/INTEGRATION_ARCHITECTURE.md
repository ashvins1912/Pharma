# Pharmacy POS & C-Square Integration Architecture

**System:** Pharmacy Integration Service  
**Architecture:** Provider Adapter Pattern  
**Status:** Optional Integration Layer (Ashvin operates natively with or without C-Square)  

---

## 1. Provider Adapter Abstraction

The core platform interacts exclusively with the generic `PharmacyAdapter` interface:

```ts
export interface PharmacyAdapter {
  providerName: string;
  testConnection(config: ProviderConfig): Promise<{ success: boolean; latencyMs: number; message?: string }>;
  getBranches(config: ProviderConfig): Promise<ExternalBranch[]>;
  syncProducts(config: ProviderConfig, sinceDate?: Date): Promise<SyncResult<ProductSyncItem>>;
  syncInventory(config: ProviderConfig): Promise<SyncResult<StockSyncItem>>;
  syncPricing(config: ProviderConfig): Promise<SyncResult<PriceSyncItem>>;
  checkAvailability(config: ProviderConfig, items: Array<{ sku: string; quantity: number }>): Promise<AvailabilityResult>;
  createOrder(config: ProviderConfig, order: ExternalOrderPayload): Promise<ExternalOrderResult>;
  getOrderStatus(config: ProviderConfig, externalOrderId: string): Promise<ExternalOrderStatus>;
  cancelOrder(config: ProviderConfig, externalOrderId: string, reason?: string): Promise<{ success: boolean }>;
  getInvoice(config: ProviderConfig, externalOrderId: string): Promise<ExternalInvoice>;
}
```

---

## 2. C-Square Concrete Adapter (`CSquareAdapter`)

The `CSquareAdapter` implements the `PharmacyAdapter` interface for pharmacy stores utilizing C-Square Pharma POS/ERP.

### Operational Principles
1. **No Invented Endpoints:** All mock/stub implementations accurately represent enterprise REST conventions (`/api/v1/store/branches`, `/api/v1/inventory/stock-snapshot`, `/api/v1/orders/push`).
2. **Credential Security:** Client IDs, API Keys, and Secrets stored in `BranchIntegration` are masked before returning over the network.
3. **Idempotency Guarantee:** Outbound order pushes generate a deterministic `Idempotency-Key` header (`idemp-ord-${orderId}-${retryCount}`) ensuring that transient network retries never produce duplicate orders in C-Square.
4. **Resilient Failure Handling:** When C-Square is unreachable, the branch integration status updates to `ERROR` and logs the failure to `syncHistory`. Ashvin's local inventory snapshot continues to safely serve customers without crashing.

---

## 3. Physical vs. Commercial Truth

```text
  [ C-Square POS ]
        | (Physical Stock, Batch, Expiry, MRP, Purchase Cost)
        v
  [ CSquareAdapter ]
        |
        v
  [ Ashvin Inventory Snapshot ] (Physical Available Qty, Reserved Qty)
        |
        v
  [ Branch Listing & Pricing Engine ] (Selling Price, Offers, Coupons, Rewards)
        |
        v
  [ Customer Cart & Order Checkout ]
```

Ashvin remains the authoritative source of truth for customer-facing listings, pricing promotions, coupon discounts, order lifecycles, and rider deliveries.
