/**
 * Multi-Tenant Medicine Request & Proposal Lifecycle Service
 * Rule: Medicine Request is NOT an Order. Proposal is NOT an Order.
 * Only customer approval converts it idempotently into an Order.
 */
import crypto from 'node:crypto';
import { orderService } from '../order-service/OrderService.js';
import { domainEvents } from '../../shared/events/DomainEvents.js';
import { logger } from '../../shared/observability/logger.js';
import { MedicineRequestStatus } from '../../shared/contracts/index.js';

export class MedicineRequestService {
    constructor() {
        this.requests = new Map(); // requestId -> MedicineRequest
        this.reqSeq = 5000;
        this._seedSampleRequests();
    }

    _seedSampleRequests() {
        const sample = {
            id: 'mr-seed-01',
            requestNumber: 'MR-5001',
            tenantId: 'tenant-ashvin-main',
            branchId: 'branch-indore-central',
            customerId: 'cust-demo-ashvin',
            customerName: 'Ashvin Singh',
            customerPhone: '+91 95899 16475',
            medicineName: 'Ursocol 300mg Tablet',
            requestedQuantity: 2,
            dosageForm: 'Tablet',
            strength: '300mg',
            customerNote: 'Need for chronic liver care, currently out of stock.',
            deliveryAddress: {
                label: 'Home',
                addressLine1: 'B-102, Silver Springs, AB Road',
                city: 'Indore',
                state: 'Madhya Pradesh',
                pincode: '452001',
                coordinates: { lat: 22.7210, lng: 75.8600 }
            },
            preferredDeliveryTiming: 'Evening',
            status: MedicineRequestStatus.PROPOSAL_SENT,
            pharmacyProposal: {
                productId: 'prod-ursocol-300',
                medicineName: 'Ursocol 300mg Tablet (Abbott)',
                quantity: 2,
                unitPrice: 420.0,
                totalPrice: 840.0,
                priceType: 'FINAL',
                pharmacyNote: 'Arranged fresh batch directly from certified Abbott depot.',
                deliverySlot: {
                    date: 'Tomorrow',
                    slotType: 'EVENING',
                    startTime: '18:00',
                    endTime: '21:00',
                    label: 'Tomorrow Evening (6:00 PM - 9:00 PM)'
                },
                prescriptionStatus: 'Verified'
            },
            convertedOrderId: null,
            createdAt: new Date(Date.now() - 7200000).toISOString()
        };
        this.requests.set(sample.id, sample);
    }

    async createRequest({
        tenantId,
        branchId,
        customerId,
        customerName,
        customerPhone,
        medicineName,
        requestedQuantity = 1,
        dosageForm = 'Tablet',
        strength = '',
        manufacturer = '',
        customerNote = '',
        prescriptionUrl = null,
        productImageUrl = null,
        deliveryAddress = null,
        preferredDeliveryTiming = 'Flexible',
        actor = null
    }) {
        const id = `mr-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
        const requestNumber = `MR-${++this.reqSeq}`;

        const reqDoc = {
            id,
            requestNumber,
            tenantId,
            branchId,
            customerId,
            customerName: customerName || 'Valued Customer',
            customerPhone: customerPhone || '',
            medicineName: String(medicineName).trim(),
            requestedQuantity: Math.max(1, Number(requestedQuantity) || 1),
            dosageForm,
            strength,
            manufacturer,
            customerNote: String(customerNote || '').trim(),
            prescriptionUrl,
            productImageUrl,
            deliveryAddress,
            preferredDeliveryTiming,
            status: MedicineRequestStatus.REQUESTED,
            pharmacyProposal: null,
            customerResponse: null,
            convertedOrderId: null,
            createdAt: new Date().toISOString(),
            auditTrail: [
                {
                    action: 'REQUEST_CREATED',
                    timestamp: new Date().toISOString(),
                    actor: actor?.role || 'Customer',
                    notes: `Requested ${medicineName} (x${requestedQuantity})`
                }
            ]
        };

        this.requests.set(id, reqDoc);
        domainEvents.emitDomainEvent('MEDICINE_REQUEST_CREATED', id, { requestNumber, medicineName }, actor, tenantId, branchId);
        logger.info(`New medicine request created #${requestNumber}`, { requestId: id, tenantId });
        return reqDoc;
    }

    async getRequests({ tenantId = null, branchId = null, customerId = null, status = null }) {
        let list = Array.from(this.requests.values());

        if (tenantId) list = list.filter(r => r.tenantId === tenantId);
        if (branchId) list = list.filter(r => r.branchId === branchId);
        if (customerId) list = list.filter(r => r.customerId === customerId);
        if (status) list = list.filter(r => r.status === status);

        return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    async getRequestById(id, tenantId = null, customerId = null) {
        const req = this.requests.get(String(id));
        if (!req) return null;

        if (tenantId && req.tenantId !== tenantId) return null;
        if (customerId && req.customerId !== customerId) return null;

        return req;
    }

    async createOrUpdateProposal(id, proposalData, actor = null) {
        const request = this.requests.get(String(id));
        if (!request) throw new Error('Medicine request not found');

        if (request.status === MedicineRequestStatus.CONVERTED_TO_ORDER) {
            throw new Error('Cannot modify proposal for a request that has already been converted to an order.');
        }

        const quantity = Number(proposalData.quantity || proposalData.proposedQuantity || request.requestedQuantity) || 1;
        const unitPrice = Number(proposalData.unitPrice ?? 0);
        const priceType = proposalData.priceType === 'APPROXIMATE' ? 'APPROXIMATE' : 'FINAL';
        const totalPrice = Number(
            (priceType === 'APPROXIMATE'
                ? proposalData.approximatePrice
                : proposalData.finalPrice)
            ?? proposalData.totalPrice
            ?? (unitPrice * quantity)
        );
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
            throw new Error('Unit price must be a valid non-negative amount.');
        }
        if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
            throw new Error(priceType === 'APPROXIMATE'
                ? 'Approximate total must be greater than zero.'
                : 'A valid final price must be specified.');
        }

        const proposal = {
            productId: proposalData.productId || null,
            medicineName: String(proposalData.medicineName || proposalData.proposedMedicineName || request.medicineName).trim(),
            manufacturer: proposalData.manufacturer || proposalData.proposedManufacturer || request.manufacturer || '',
            strength: proposalData.strength || request.strength || '',
            dosageForm: proposalData.dosageForm || request.dosageForm || 'Tablet',
            quantity,
            unitPrice,
            totalPrice,
            priceType,
            pharmacyNote: String(proposalData.pharmacyNote || proposalData.pharmacyNotes || '').trim(),
            deliverySlot: proposalData.deliverySlot || {
                date: 'Tomorrow',
                slotType: 'EVENING',
                startTime: '18:00',
                endTime: '21:00',
                label: 'Tomorrow Evening (6:00 PM - 9:00 PM)'
            },
            prescriptionStatus: proposalData.prescriptionStatus || (request.prescriptionUrl ? 'Verified' : 'Not Required')
        };

        request.pharmacyProposal = proposal;
        request.status = MedicineRequestStatus.PROPOSAL_SENT;
        request.auditTrail.push({
            action: 'PROPOSAL_SENT',
            timestamp: new Date().toISOString(),
            actor: actor?.role || 'Pharmacist',
            notes: `Formulated proposal: ₹${totalPrice} (${proposal.priceType})`
        });

        domainEvents.emitDomainEvent('PROPOSAL_CREATED', id, { proposal }, actor, request.tenantId, request.branchId);
        logger.info(`Pharmacy proposal sent for request #${request.requestNumber}`, { requestId: id });
        return request;
    }

    async approveProposalAndConvertToOrder(id, customerId, note = '', actor = null) {
        const request = this.requests.get(String(id));
        if (!request) throw new Error('Medicine request not found');

        // Customer isolation guard
        if (request.customerId !== customerId) {
            throw new Error('Unauthorized access to this medicine request');
        }

        // Idempotency: If already converted, return existing order
        if (request.convertedOrderId) {
            const existingOrder = await orderService.getOrderById(request.convertedOrderId);
            return {
                success: true,
                order: existingOrder,
                request,
                alreadyConverted: true,
                message: 'Proposal was already approved and converted into an order.'
            };
        }

        if (request.status !== MedicineRequestStatus.PROPOSAL_SENT) {
            throw new Error(`Cannot approve proposal in '${request.status}' status`);
        }

        const proposal = request.pharmacyProposal;
        if (!proposal) throw new Error('No proposal attached to this request');

        // Create standard Order through OrderService
        const orderItems = [
            {
                productId: proposal.productId || 'prod-custom-arranged',
                quantity: proposal.quantity
            }
        ];

        const { order } = await orderService.createOrder({
            tenantId: request.tenantId,
            branchId: request.branchId,
            customerId: request.customerId,
            customerName: request.customerName,
            customerMobile: request.customerPhone,
            items: orderItems,
            deliveryAddress: request.deliveryAddress,
            source: 'MEDICINE_REQUEST',
            medicineRequestId: request.id,
            idempotencyKey: `idemp-prop-conv-${request.id}`,
            actor: actor || { role: 'Customer' }
        });

        request.status = MedicineRequestStatus.CONVERTED_TO_ORDER;
        request.convertedOrderId = order.id;
        request.customerResponse = {
            approved: true,
            respondedAt: new Date().toISOString(),
            note: note || 'Customer approved pharmacy proposal'
        };
        request.auditTrail.push({
            action: 'CUSTOMER_APPROVED',
            timestamp: new Date().toISOString(),
            actor: 'Customer',
            notes: `Converted to Order #${order.orderNumber}`
        });

        domainEvents.emitDomainEvent('PROPOSAL_APPROVED', id, { orderId: order.id }, actor, request.tenantId, request.branchId);
        logger.info(`Request #${request.requestNumber} converted to Order #${order.orderNumber}`, { orderId: order.id });

        return {
            success: true,
            order,
            request,
            alreadyConverted: false,
            message: `Proposal approved! Order #${order.orderNumber} placed for fulfillment.`
        };
    }

    async rejectProposal(id, customerId, reason = '', actor = null) {
        const request = this.requests.get(String(id));
        if (!request) throw new Error('Medicine request not found');

        if (request.customerId !== customerId) {
            throw new Error('Unauthorized access to this medicine request');
        }

        request.status = MedicineRequestStatus.CUSTOMER_REJECTED;
        request.customerResponse = {
            approved: false,
            respondedAt: new Date().toISOString(),
            reason: reason || 'Declined proposal'
        };
        request.auditTrail.push({
            action: 'CUSTOMER_REJECTED',
            timestamp: new Date().toISOString(),
            actor: 'Customer',
            notes: reason || 'Customer declined proposal'
        });

        domainEvents.emitDomainEvent('PROPOSAL_REJECTED', id, { reason }, actor, request.tenantId, request.branchId);
        return request;
    }
}

export const medicineRequestService = new MedicineRequestService();
export default medicineRequestService;
