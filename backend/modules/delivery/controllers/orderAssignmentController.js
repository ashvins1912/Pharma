import deliveryContainer from '../container.js';
import { sendCustomWhatsAppAlert } from '../../../config/whatsapp.js';
import mongoose from 'mongoose';
import OrderModel from '../../../models/Order.js';

const validOrderId = value => typeof value === 'string'
    && value !== 'undefined'
    && value !== 'null'
    && mongoose.isValidObjectId(value);
const invalidOrderId = (req, res) => res.status(400).json({
    success: false,
    error: {
        code: 'INVALID_ORDER_ID',
        message: 'A valid order ID is required.',
        retryable: false,
        requestId: req.requestId || null
    }
});

/**
 * Controller: Order Automated Assignment & Engine Monitoring
 */
const validateAssignmentEligibility = async (req, res, orderId) => {
    const order = await OrderModel.findById(orderId).lean();
    if (!order) {
        res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Order not found.', retryable: false, requestId: req.requestId || null }
        });
        return null;
    }

    const role = req.user?.app_metadata?.role || req.user?.role || req.context?.role || 'customer';
    const globalAdmin = ['admin', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
    const tenantId = req.user?.tenantId || req.user?.app_metadata?.tenantId || req.context?.tenantId || null;
    const branchId = req.user?.branchId || req.user?.app_metadata?.branchId || req.context?.branchId || null;
    if (!globalAdmin && (!tenantId || !order.tenantId || String(order.tenantId) !== String(tenantId))) {
        res.status(403).json({
            success: false,
            error: { code: 'TENANT_SCOPE_VIOLATION', message: 'This order is outside your tenant scope.', retryable: false, requestId: req.requestId || null }
        });
        return null;
    }
    if (!globalAdmin && branchId && (!order.branchId || String(order.branchId) !== String(branchId))) {
        res.status(403).json({
            success: false,
            error: { code: 'BRANCH_SCOPE_VIOLATION', message: 'This order is outside your branch scope.', retryable: false, requestId: req.requestId || null }
        });
        return null;
    }
    if (!['Approved', 'Ready to Dispatch'].includes(order.orderStatus)) {
        res.status(409).json({
            success: false,
            error: {
                code: 'ORDER_NOT_READY_FOR_ASSIGNMENT',
                message: `Order must be approved and ready for dispatch before courier assignment. Current status: ${order.orderStatus || 'UNKNOWN'}.`,
                retryable: false,
                requestId: req.requestId || null
            }
        });
        return null;
    }
    if (order.prescriptionRequired && order.prescriptionVerification?.status !== 'MATCHED') {
        res.status(409).json({
            success: false,
            error: {
                code: 'PRESCRIPTION_VERIFICATION_REQUIRED',
                message: `Prescription verification must be MATCHED before courier assignment. Current status: ${order.prescriptionVerification?.status || 'REVIEW_REQUIRED'}.`,
                retryable: false,
                requestId: req.requestId || null
            }
        });
        return null;
    }
    return order;
};

export const autoAssignOrder = async (req, res) => {
    try {
        deliveryContainer.refreshDataLayer();
        const { orderId } = req.params;
        if (!validOrderId(orderId)) return invalidOrderId(req, res);
        const eligibleOrder = await validateAssignmentEligibility(req, res, orderId);
        if (!eligibleOrder) return;

        const result = await deliveryContainer.assignmentEngine.assignOrder(orderId, req.body || {});

        // If assigned, trigger WhatsApp alert if rider info is available
        if (result.success && result.order?.rider) {
            try {
                await sendCustomWhatsAppAlert(
                    result.order.toJSON ? result.order.toJSON() : result.order,
                    'Assigned',
                    result.rider?.mobile || result.order.rider.riderMobile
                );
            } catch (waErr) {
                console.warn('[AutoAssign] WhatsApp notification non-blocking warning:', waErr.message);
            }
        }

        if (!result.success && result.reason?.toLowerCase().includes('not found')) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found.', retryable: false, requestId: req.requestId || null } });
        }
        res.json({
            message: result.success
                ? `Order successfully assigned via ${result.strategyUsed} to ${result.rider.name}.`
                : result.reason,
            ...result,
            order: result.order?.toJSON ? result.order.toJSON() : result.order,
            rider: result.rider?.toJSON ? result.rider.toJSON() : result.rider
        });
    } catch (error) {
        console.error('Auto assignment error:', error);
        const notFound = /not found/i.test(error.message || '');
        const status = notFound ? 404 : ['MongoNetworkError', 'MongooseError', 'MongoServerError'].includes(error.name) ? 503 : 500;
        res.status(status).json({
            success: false,
            error: {
                code: notFound ? 'NOT_FOUND' : status === 503 ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR',
                message: notFound ? 'Order not found.' : status === 503 ? 'Delivery assignment is temporarily unavailable. Please try again.' : 'Unable to assign delivery for this order. Please try again.',
                retryable: status >= 500,
                requestId: req.requestId || null
            }
        });
    }
};

export const manualAssignOrder = async (req, res) => {
    try {
        deliveryContainer.refreshDataLayer();
        const { orderId } = req.params;
        if (!validOrderId(orderId)) return invalidOrderId(req, res);
        const eligibleOrder = await validateAssignmentEligibility(req, res, orderId);
        if (!eligibleOrder) return;
        const { riderId, notes } = req.body;

        if (!riderId) {
            return res.status(400).json({ message: 'riderId is required for manual assignment.' });
        }

        const result = await deliveryContainer.manualAssignOrderUseCase.execute(orderId, riderId, notes);

        if (result.order?.rider) {
            try {
                await sendCustomWhatsAppAlert(
                    result.order.toJSON ? result.order.toJSON() : result.order,
                    'Assigned',
                    result.rider?.mobile || result.order.rider.riderMobile
                );
            } catch (waErr) {
                console.warn('[ManualAssign] WhatsApp notification warning:', waErr.message);
            }
        }

        res.json({
            message: `Order manually assigned to ${result.rider.name}.`,
            order: result.order.toJSON ? result.order.toJSON() : result.order,
            rider: result.rider.toJSON ? result.rider.toJSON() : result.rider
        });
    } catch (error) {
        console.error('Manual assignment error:', error);
        const notFound = /not found/i.test(error.message || '');
        const status = notFound ? 404 : ['MongoNetworkError', 'MongooseError', 'MongoServerError'].includes(error.name) ? 503 : 400;
        res.status(status).json({
            success: false,
            error: {
                code: notFound ? 'NOT_FOUND' : status === 503 ? 'SERVICE_UNAVAILABLE' : 'ASSIGNMENT_FAILED',
                message: notFound ? 'Order or rider not found.' : status === 503 ? 'Delivery assignment is temporarily unavailable. Please try again.' : 'Unable to assign delivery for this order. Please check the details and try again.',
                retryable: status >= 500,
                requestId: req.requestId || null
            }
        });
    }
};

export const getEngineStatus = async (req, res) => {
    try {
        const strategies = deliveryContainer.assignmentEngine.getActiveStrategies();
        const logs = deliveryContainer.assignmentEngine.getExecutionLogs(30);

        res.json({
            pipeline: strategies,
            logs,
            totalEvaluations: logs.length
        });
    } catch (error) {
        console.error('Engine status error:', error);
        res.status(500).json({ message: 'Failed to retrieve assignment engine status.' });
    }
};
