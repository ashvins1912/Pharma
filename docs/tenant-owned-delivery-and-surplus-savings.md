# Tenant-owned delivery and Exclusive Surplus Savings

## Rider tenant migration

Rider records are now owned by a pharmacy tenant. The API deliberately rejects a rider read, update, or assignment when the tenant context is missing. Do not enable tenant dispatch against legacy rider records until the migration has completed.

1. Take a MongoDB backup and deploy the backend code to a staging environment.
2. Run the migration from the `backend` directory:

   ```bash
   npm run rider:migrate-tenants
   ```

3. The script derives ownership only when all historical assigned orders for a rider point to exactly one tenant. Riders with no unambiguous history are reported and are not guessed.
4. For unassigned or ambiguous riders, provide an explicit map from rider Mongo IDs to tenant IDs:

   ```bash
   RIDER_TENANT_MAPPING_JSON='{"<riderObjectId>":"<tenantId>"}' npm run rider:migrate-tenants
   ```

5. Re-run until the output has no unresolved records. The script then replaces the old global unique mobile index with the tenant/mobile unique index.
6. Verify rider counts and assignments per tenant before enabling tenant staff dispatch in production.

A rider that has historical orders assigned to multiple tenants must be resolved manually. Do not map it to one tenant until the order/rider ownership conflict is corrected.

## Tenant rider lifecycle

- Rider creation, list, profile lookup, status changes, enable/disable, and GPS updates are tenant-scoped.
- A rider mobile number is unique within a tenant, not globally.
- Manual and automatic assignment, order clubbing, route optimization, and batch dispatch use the order tenant as the scope.
- Delivery OTP verification checks that the signed-in rider or staff-selected rider belongs to the same tenant as the order and is the rider assigned to that order.
- Assignment-engine telemetry is filtered to the selected tenant.
- Platform administrators must select a tenant when managing riders or optimizing a route.

## Exclusive Surplus Savings

Tenant administrators with `promotions.manage` can create, activate, and pause campaigns from the admin workspace. Campaigns are tied to medicine IDs belonging to the same active tenant.

- Public offer lookup requires a selected active pharmacy and only returns that pharmacy's active campaign products.
- Discounts are recalculated from database medicine prices during checkout; browser prices are never trusted.
- Campaign start/end dates, minimum basket amount, stock availability, redemption limits, and customer redemption history are checked server-side.
- A campaign redemption and its usage counter are recorded in the same order transaction.
- The default policy does not stack surplus savings with coupon codes or reward points. A tenant must explicitly enable `settings.allowOfferWithCoupon` or `settings.allowOfferWithRewards` to permit stacking.
- Pausing a campaign does not rewrite discounts already snapshotted on existing orders.

## Main API paths

- `GET /api/surplus-savings?tenantId=<tenant>`
- `GET /api/surplus-savings/admin?tenantId=<tenant>`
- `POST /api/surplus-savings/admin`
- `PATCH /api/surplus-savings/admin/:campaignId`
- `DELETE /api/surplus-savings/admin/:campaignId` (soft pause)

The checkout quote and final order-creation path both apply the campaign rules. The final transactional order reservation remains authoritative.
