/**
 * API Gateway Multi-Tenant Medicine Request Routes (/api/v1/medicine-requests)
 */
import express from 'express';
import { medicineRequestService } from '../../services/medicine-request-service/MedicineRequestService.js';
import { identityService } from '../../services/identity-service/IdentityService.js';
import { authenticateUser } from '../../middleware/auth.js';
import { requireTenantScope, requireTenantStaff } from '../../middleware/context.js';

const router = express.Router();

// List requests (Customer queries own, or Pharmacy queries branch/tenant)
router.get('/', authenticateUser, async (req, res, next) => {
    try {
        let filter = {};
        if (req.context.isPlatformUser) {
            filter.tenantId = req.query.tenantId || null;
        } else if (req.context.tenantMembership) {
            filter.tenantId = req.context.tenantId;
            if (req.context.tenantMembership.branchId) {
                filter.branchId = req.context.tenantMembership.branchId;
            }
        } else {
            const customer = await identityService.getOrCreateCustomer(req.context.userId);
            filter.customerId = customer.id;
        }

        const requests = await medicineRequestService.getRequests(filter);
        res.json({ success: true, data: requests });
    } catch (err) {
        next(err);
    }
});

// Get request details
router.get('/:id', authenticateUser, async (req, res, next) => {
    try {
        const customer = req.context.isPlatformUser || req.context.tenantMembership
            ? null
            : await identityService.getOrCreateCustomer(req.context.userId);

        const request = await medicineRequestService.getRequestById(
            req.params.id,
            req.context.tenantMembership ? req.context.tenantId : null,
            customer?.id || null
        );

        if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
        res.json({ success: true, data: request });
    } catch (err) {
        next(err);
    }
});

// Customer submits medicine request
router.post('/', authenticateUser, async (req, res, next) => {
    try {
        const customer = await identityService.getOrCreateCustomer(req.context.userId, {
            name: req.body.customerName || req.user.user_metadata?.name,
            phone: req.body.customerPhone || req.user.user_metadata?.mobile
        });

        const targetTenantId = req.body.tenantId || req.context.tenantId || 'tenant-ashvin-main';
        const targetBranchId = req.body.branchId || req.context.branchId || 'branch-indore-central';

        const request = await medicineRequestService.createRequest({
            tenantId: targetTenantId,
            branchId: targetBranchId,
            customerId: customer.id,
            customerName: customer.name,
            customerPhone: customer.phone,
            medicineName: req.body.medicineName,
            requestedQuantity: req.body.requestedQuantity || 1,
            dosageForm: req.body.dosageForm || 'Tablet',
            strength: req.body.strength || '',
            manufacturer: req.body.manufacturer || '',
            customerNote: req.body.customerNote || '',
            deliveryAddress: req.body.deliveryAddress,
            preferredDeliveryTiming: req.body.preferredDeliveryTiming || 'Flexible',
            actor: req.context
        });

        res.status(201).json({ success: true, data: request });
    } catch (err) {
        next(err);
    }
});

// Pharmacist formulates proposal
router.post('/:id/proposal', authenticateUser, requireTenantScope, requireTenantStaff, async (req, res, next) => {
    try {
        const updated = await medicineRequestService.createOrUpdateProposal(
            req.params.id,
            req.body,
            req.context
        );
        res.json({ success: true, data: updated });
    } catch (err) {
        next(err);
    }
});

// Customer approves proposal -> Idempotently converts to Order
router.post('/:id/approve', authenticateUser, async (req, res, next) => {
    try {
        const customer = await identityService.getOrCreateCustomer(req.context.userId);
        const result = await medicineRequestService.approveProposalAndConvertToOrder(
            req.params.id,
            customer.id,
            req.body.note || '',
            req.context
        );
        res.json(result);
    } catch (err) {
        next(err);
    }
});

// Customer rejects proposal
router.post('/:id/reject', authenticateUser, async (req, res, next) => {
    try {
        const customer = await identityService.getOrCreateCustomer(req.context.userId);
        const request = await medicineRequestService.rejectProposal(
            req.params.id,
            customer.id,
            req.body.reason || '',
            req.context
        );
        res.json({ success: true, data: request });
    } catch (err) {
        next(err);
    }
});

// Customer cancels request
router.post('/:id/cancel', authenticateUser, async (req, res, next) => {
    try {
        const customer = await identityService.getOrCreateCustomer(req.context.userId);
        const request = await medicineRequestService.cancelRequest(
            req.params.id,
            customer.id,
            req.body.reason || '',
            req.context
        );
        res.json({ success: true, data: request });
    } catch (err) {
        next(err);
    }
});

export default router;
