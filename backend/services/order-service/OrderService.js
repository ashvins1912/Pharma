/**
 * Multi-Tenant Order Management & Fulfillment Service
 */
import crypto from 'node:crypto';
import { catalogService } from '../catalog-service/CatalogService.js';
import { pricingEngine } from '../pricing-service/PricingEngine.js';
import { deliveryService } from '../delivery-service/DeliveryService.js';
import { identityService } from '../identity-service/IdentityService.js';
import { tenantService } from '../tenant-service/TenantService.js';
import { domainEvents } from '../../shared/events/DomainEvents.js';
import { logger } from '../../shared/observability/logger.js';
import { IdempotencyConflictError } from '../../shared/errors/DomainErrors.js';
import { MultiTenantOrderStatus, FulfillmentMode } from '../../shared/contracts/index.js';

export class OrderService {
    constructor() {
        this.orders = new Map(); // orderId -> Order
        this.fulfillments = new Map(); // orderId -> FulfillmentOrder
        this.idempotencyIndex = new Map(); // key: idempotencyKey -> orderId
        this.orderSeq = 1000;
        this._seedSampleOrders();
    }

    _seedSampleOrders() {
        const sampleOrder = {
            id: 'ord-seed-01',
            orderNumber: 'ASH-1001',
            tenantId: 'tenant-ashvin-main',
            branchId: 'branch-indore-central',
            customerId: 'cust-demo-ashvin',
            customerName: 'Ashvin Singh',
            customerMobile: '+91 95899 16475',
            items: [
                {
                    productId: 'prod-pcm-650',
                    listingId: 'list-prod-pcm-650',
                    name: 'Dolo 650mg Tablet',
                    quantity: 2,
                    mrpSnapshot: 34.0,
                    sourceSellingPriceSnapshot: 29.5,
                    customerPriceSnapshot: 29.5,
                    discountSnapshot: 4.5,
                    finalUnitPrice: 29.5,
                    subtotal: 59.0
                },
                {
                    productId: 'prod-pantop-40',
                    listingId: 'list-prod-pantop-40',
                    name: 'Pan 40mg Tablet',
                    quantity: 1,
                    mrpSnapshot: 155.0,
                    sourceSellingPriceSnapshot: 132.0,
                    customerPriceSnapshot: 132.0,
                    discountSnapshot: 23.0,
                    finalUnitPrice: 132.0,
                    subtotal: 132.0
                }
            ],
            subtotal: 191.0,
            offerDiscount: 0,
            couponDiscount: 0,
            rewardsDiscount: 0,
            deliveryFee: 30.0,
            tax: 0,
            finalTotal: 221.0,
            deliveryAddressSnapshot: {
                label: 'Home',
                addressLine1: 'B-102, Silver Springs, AB Road',
                city: 'Indore',
                state: 'Madhya Pradesh',
                pincode: '452001',
                coordinates: { lat: 22.7210, lng: 75.8600 }
            },
            paymentMethod: 'COD',
            paymentStatus: 'PENDING',
            orderStatus: MultiTenantOrderStatus.PROCESSING,
            source: 'ONLINE_STORE',
            createdAt: new Date(Date.now() - 3600000).toISOString()
        };
        this.orders.set(sampleOrder.id, sampleOrder);

        const sampleFulfillment = {
            id: 'ful-seed-01',
            orderId: sampleOrder.id,
            tenantId: sampleOrder.tenantId,
            branchId: sampleOrder.branchId,
            fulfillmentMode: FulfillmentMode.ASHVIN_FULFILLMENT,
            status: 'ACCEPTED',
            acceptedAt: new Date(Date.now() - 3500000).toISOString()
        };
        this.fulfillments.set(sampleOrder.id, sampleFulfillment);
    }

    async createOrder({
        tenantId,
        branchId,
        customerId,
        customerName,
        customerMobile,
        items = [],
        deliveryAddress,
        couponCode = null,
        redeemPoints = 0,
        paymentMethod = 'COD',
        idempotencyKey = null,
        source = 'ONLINE_STORE',
        medicineRequestId = null,
        actor = null
    }) {
        // 1. Idempotency Check
        if (idempotencyKey) {
            const existingId = this.idempotencyIndex.get(idempotencyKey);
            if (existingId && this.orders.has(existingId)) {
                logger.info(`Idempotent order returned for key ${idempotencyKey}`, { orderId: existingId });
                return {
                    order: this.orders.get(existingId),
                    isDuplicate: true
                };
            }
        }

        // 2. Validate Branch Serviceability
        if (deliveryAddress?.coordinates) {
            await deliveryService.validateServiceabilityOrThrow(branchId, deliveryAddress.coordinates);
        }

        // 3. Atomically Reserve Inventory (shelf inventory for standard orders)
        if (source !== 'MEDICINE_REQUEST') {
            await catalogService.reserveStock(tenantId, branchId, items);
        }

        // 4. Authoritative Pricing Calculation
        let pricing;
        try {
            pricing = await pricingEngine.calculateOrderPricing({
                tenantId,
                branchId,
                customerId,
                items,
                couponCode,
                redeemPoints
            });
        } catch (err) {
            // Rollback stock reservation on pricing failure
            if (source !== 'MEDICINE_REQUEST') {
                await catalogService.releaseStock(tenantId, branchId, items);
            }
            throw err;
        }

        // 5. Construct Order Entity
        const orderId = `ord-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
        const orderNumber = `ASH-${++this.orderSeq}`;

        const order = {
            id: orderId,
            orderNumber,
            tenantId,
            branchId,
            customerId,
            customerName: customerName || 'Valued Customer',
            customerMobile: customerMobile || '',
            items: pricing.itemSnapshots,
            subtotal: pricing.subtotal,
            offerDiscount: pricing.offerDiscount,
            couponDiscount: pricing.couponDiscount,
            rewardsDiscount: pricing.rewardsDiscount,
            deliveryFee: pricing.deliveryFee,
            tax: pricing.tax,
            finalTotal: pricing.finalTotal,
            deliveryAddressSnapshot: {
                label: deliveryAddress?.label || 'Delivery Address',
                addressLine1: deliveryAddress?.addressLine1 || deliveryAddress?.street || 'Customer Address',
                city: deliveryAddress?.city || 'Indore',
                state: deliveryAddress?.state || 'Madhya Pradesh',
                pincode: deliveryAddress?.pincode || '',
                coordinates: deliveryAddress?.coordinates || null
            },
            paymentMethod,
            paymentStatus: paymentMethod === 'COD' ? 'PENDING' : 'PAID',
            orderStatus: MultiTenantOrderStatus.SUBMITTED,
            source,
            medicineRequestId: medicineRequestId || null,
            idempotencyKey,
            createdAt: new Date().toISOString(),
            statusHistory: [
                {
                    status: MultiTenantOrderStatus.SUBMITTED,
                    timestamp: new Date().toISOString(),
                    actor: actor?.role || 'Customer'
                }
            ]
        };

        this.orders.set(orderId, order);
        if (idempotencyKey) {
            this.idempotencyIndex.set(idempotencyKey, orderId);
        }

        // Create initial Fulfillment Record
        const fulfillment = {
            id: `ful-${crypto.randomUUID().slice(0, 8)}`,
            orderId,
            tenantId,
            branchId,
            fulfillmentMode: FulfillmentMode.ASHVIN_FULFILLMENT,
            status: 'PENDING',
            createdAt: new Date().toISOString()
        };
        this.fulfillments.set(orderId, fulfillment);

        domainEvents.emitDomainEvent('ORDER_CREATED', orderId, {
            orderNumber,
            finalTotal: order.finalTotal,
            itemCount: items.length
        }, actor, tenantId, branchId);

        logger.info(`New order placed #${orderNumber}`, { orderId, tenantId, branchId });

        return { order, isDuplicate: false };
    }

    async getOrderById(orderId, tenantId = null, customerId = null) {
        const order = this.orders.get(String(orderId));
        if (!order) return null;

        // Tenant isolation guard
        if (tenantId && order.tenantId !== tenantId) {
            return null;
        }

        // Customer isolation guard
        if (customerId && order.customerId !== customerId) {
            return null;
        }

        return order;
    }

    async getOrders({ tenantId = null, branchId = null, customerId = null, status = null }) {
        let list = Array.from(this.orders.values());

        if (tenantId) list = list.filter(o => o.tenantId === tenantId);
        if (branchId) list = list.filter(o => o.branchId === branchId);
        if (customerId) list = list.filter(o => o.customerId === customerId);
        if (status) list = list.filter(o => o.orderStatus === status);

        return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    async transitionOrderStatus(orderId, newStatus, actor = null) {
        const order = this.orders.get(orderId);
        if (!order) throw new Error('Order not found');

        const prevStatus = order.orderStatus;
        order.orderStatus = newStatus;
        order.statusHistory.push({
            status: newStatus,
            previousStatus: prevStatus,
            timestamp: new Date().toISOString(),
            actor: actor?.role || 'Staff'
        });

        const fulfillment = this.fulfillments.get(orderId);
        if (fulfillment) {
            if (newStatus === MultiTenantOrderStatus.ACCEPTED) fulfillment.status = 'ACCEPTED';
            if (newStatus === MultiTenantOrderStatus.READY_FOR_DISPATCH) fulfillment.status = 'PACKED';
            if (newStatus === MultiTenantOrderStatus.OUT_FOR_DELIVERY) fulfillment.status = 'DISPATCHED';
            if (newStatus === MultiTenantOrderStatus.DELIVERED) fulfillment.status = 'COMPLETED';
        }

        // If order delivered, deduct stock permanently and reward points
        if (newStatus === MultiTenantOrderStatus.DELIVERED) {
            await catalogService.deductStock(order.tenantId, order.branchId, order.items);
            const pointsEarned = Math.floor(order.finalTotal / 10);
            await identityService.recordOrderCompletion(
                order.customerId,
                order.tenantId,
                order.finalTotal,
                pointsEarned,
                order.rewardsDiscount * 10
            );
            domainEvents.emitDomainEvent('ORDER_DELIVERED', orderId, { orderNumber: order.orderNumber }, actor, order.tenantId, order.branchId);
        } else if (newStatus === MultiTenantOrderStatus.CANCELLED) {
            // Release reserved stock on cancellation
            await catalogService.releaseStock(order.tenantId, order.branchId, order.items);
            domainEvents.emitDomainEvent('ORDER_CANCELLED', orderId, { orderNumber: order.orderNumber }, actor, order.tenantId, order.branchId);
        }

        return order;
    }
}

export const orderService = new OrderService();
export default orderService;
