import deliveryContainer from '../container.js';
import { publishOrderEvent } from '../../../services/OrderEventService.js';

/**
 * Controller: Order Automated Assignment & Engine Monitoring
 */
export const autoAssignOrder = async (req, res) => {
    try {
        deliveryContainer.refreshDataLayer();
        const { orderId } = req.params;

        const result = await deliveryContainer.assignmentEngine.assignOrder(orderId, req.body || {});

        if (result.success && result.order?.rider && result.strategyUsed !== 'AlreadyAssigned') {
            await publishOrderEvent(
                result.order.toJSON ? result.order.toJSON() : result.order,
                'OrderAssigned',
                { payload: { riderMobile: result.rider?.mobile || result.order.rider.riderMobile } }
            );
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

        const previousOrder = await deliveryContainer.orderRepository.findById(orderId);
        const wasAssigned = Boolean(previousOrder?.rider?.riderId);
        const result = await deliveryContainer.manualAssignOrderUseCase.execute(orderId, riderId, notes);

        if (result.order?.rider) {
            await publishOrderEvent(
                result.order.toJSON ? result.order.toJSON() : result.order,
                wasAssigned ? 'OrderReassigned' : 'OrderAssigned',
                { payload: { riderMobile: result.rider?.mobile || result.order.rider.riderMobile } }
            );
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
