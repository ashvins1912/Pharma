import deliveryContainer from '../container.js';
import { sendCustomWhatsAppAlert } from '../../../config/whatsapp.js';

/**
 * Controller: Order Automated Assignment & Engine Monitoring
 */
export const autoAssignOrder = async (req, res) => {
    try {
        deliveryContainer.refreshDataLayer();
        const { orderId } = req.params;

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
        res.status(500).json({ message: error.message || 'Automated assignment failed.' });
    }
};

export const manualAssignOrder = async (req, res) => {
    try {
        deliveryContainer.refreshDataLayer();
        const { orderId } = req.params;
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
        res.status(400).json({ message: error.message || 'Manual assignment failed.' });
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
