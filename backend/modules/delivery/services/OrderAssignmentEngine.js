/**
 * OrderAssignmentEngine (Clean Architecture Service)
 * Orchestrates the expandable pipeline of assignment strategies.
 * Strictly adheres to the Open/Closed Principle:
 * - Closed for modification: Core evaluation loop and state persistence remain unchanged.
 * - Open for extension: New strategies are added via `registerStrategy()`.
 */
import { isSameTenant } from '../../../authorization/tenantScope.js';

export class OrderAssignmentEngine {
    /**
     * @param {object} dependencies
     * @param {import('../ports/IRiderRepository.js').IRiderRepository} dependencies.riderRepository
     * @param {import('../ports/IOrderRepository.js').IOrderRepository} dependencies.orderRepository
     * @param {import('../ports/IAssignmentStrategy.js').IAssignmentStrategy[]} [dependencies.strategies]
     */
    constructor({ riderRepository, orderRepository, strategies = [] }) {
        this.riderRepository = riderRepository;
        this.orderRepository = orderRepository;
        this.strategies = [];
        this.executionLogs = []; // In-memory ring buffer for audit and dashboard monitoring

        for (const strategy of strategies) {
            this.registerStrategy(strategy);
        }
    }

    /**
     * Register a new strategy into the pipeline (Open for extension)
     * @param {import('../ports/IAssignmentStrategy.js').IAssignmentStrategy} strategy
     */
    registerStrategy(strategy) {
        if (!strategy || typeof strategy.execute !== 'function') {
            throw new Error('Strategy must implement IAssignmentStrategy interface.');
        }
        // Avoid duplicate strategy names
        this.strategies = this.strategies.filter(s => s.name !== strategy.name);
        this.strategies.push(strategy);
        // Sort by priority ascending (lower priority numbers run first)
        this.strategies.sort((a, b) => a.priority - b.priority);
        return this;
    }

    /**
     * Remove a strategy from the pipeline
     */
    removeStrategy(strategyName) {
        this.strategies = this.strategies.filter(s => s.name !== strategyName);
        return this;
    }

    /**
     * List active strategies in execution order
     */
    getActiveStrategies() {
        return this.strategies.map(s => ({
            name: s.name,
            priority: s.priority
        }));
    }

    /**
     * Assigns an order by executing the strategy pipeline
     * @param {string|import('../domain/entities/Order.js').Order} orderOrId
     * @param {object} [options]
     * @returns {Promise<{ success: boolean, order: any, rider: any, strategyUsed: string, auditTrail: any[] }>}
     */
    async assignOrder(orderOrId, options = {}) {
        const startTime = Date.now();

        // 1. Resolve order domain entity
        let order;
        if (typeof orderOrId === 'string') {
            order = await this.orderRepository.findById(orderOrId, options.tenantId);
            if (!order) {
                throw new Error(`Order #${orderOrId} not found in database.`);
            }
        } else {
            order = orderOrId;
        }

        if (!order?.tenantId || (options.tenantId && !isSameTenant(options.tenantId, order.tenantId))) {
            throw new Error('Order tenant ownership is required and must match the assignment context.');
        }
        options = { ...options, tenantId: String(order.tenantId) };

        const existingRiderId = order.rider?.riderId || order.assignedRiderId;
        if (existingRiderId) {
            const existingRider = await this.riderRepository.findById(existingRiderId, options.tenantId || order.tenantId);
            if (!existingRider) {
                return {
                    success: false,
                    order,
                    rider: null,
                    strategyUsed: 'INVALID_TENANT_RIDER',
                    reason: 'The assigned rider is not owned by the order pharmacy tenant.',
                    auditTrail: []
                };
            }
            return {
                success: true,
                order,
                rider: existingRider,
                strategyUsed: 'AlreadyAssigned',
                reason: 'Order already has an assigned rider.',
                auditTrail: []
            };
        }

        const auditTrail = [];
        let matchedResult = null;

        // 2. Iterate through strategies in pipeline (Chain of Responsibility)
        for (const strategy of this.strategies) {
            const stepStart = Date.now();
            try {
                const result = await strategy.execute({
                    order,
                    riderRepository: this.riderRepository,
                    orderRepository: this.orderRepository,
                    options: { ...options, tenantId: options.tenantId || order.tenantId }
                });

                const stepDuration = Date.now() - stepStart;
                auditTrail.push({
                    strategy: strategy.name,
                    matched: result.matched,
                    reason: result.reason,
                    durationMs: stepDuration,
                    details: result.metadata
                });

                if (result.matched && result.rider) {
                    matchedResult = result;
                    break; // Stop evaluating further strategies
                }
            } catch (err) {
                console.error(`[AssignmentEngine] Strategy ${strategy.name} threw error:`, err);
                auditTrail.push({
                    strategy: strategy.name,
                    matched: false,
                    error: err.message,
                    durationMs: Date.now() - stepStart
                });
            }
        }

        // 3. Fulfill Assignment if resolved
        if (matchedResult) {
            const assignedRider = matchedResult.rider;

            // Update domain entities
            assignedRider.assignOrder(order.id);
            order.assignToRider(
                assignedRider,
                matchedResult.strategyName,
                matchedResult.reason,
                matchedResult.distanceInKm,
                true // Auto
            );

            // Persist changes through repository ports
            const [savedRider, savedOrder] = await Promise.all([
                this.riderRepository.update(assignedRider.id, {
                    status: assignedRider.status,
                    activeOrderIds: assignedRider.activeOrderIds,
                    updatedAt: new Date()
                }, options.tenantId || order.tenantId),
                this.orderRepository.update(order.id, {
                    orderStatus: order.orderStatus,
                    assignmentType: order.assignmentType,
                    rider: order.rider,
                    assignmentDetails: order.assignmentDetails,
                    updatedAt: new Date()
                }, options.tenantId || order.tenantId)
            ]);

            const logEntry = {
                id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                orderId: order.id,
                tenantId: order.tenantId || options.tenantId || null,
                customerName: order.customerName,
                status: 'ASSIGNED',
                strategyUsed: matchedResult.strategyName,
                assignedRider: {
                    id: assignedRider.id,
                    name: assignedRider.name,
                    mobile: assignedRider.mobile
                },
                distanceInKm: matchedResult.distanceInKm,
                reason: matchedResult.reason,
                totalDurationMs: Date.now() - startTime,
                auditTrail,
                timestamp: new Date()
            };

            this._recordLog(logEntry);

            return {
                success: true,
                order: savedOrder,
                rider: savedRider,
                strategyUsed: matchedResult.strategyName,
                reason: matchedResult.reason,
                auditTrail
            };
        }

        // 4. No strategy matched — Order remains pending manual dispatcher assignment
        await this.orderRepository.update(order.id, {
            assignmentType: 'Unassigned',
            assignmentDetails: {
                strategyUsed: 'NONE',
                note: 'All automated assignment strategies exhausted. Awaiting dispatcher.',
                attemptedAt: new Date()
            }
        }, options.tenantId || order.tenantId);

        const failedLogEntry = {
            id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            orderId: order.id,
            tenantId: order.tenantId || options.tenantId || null,
            customerName: order.customerName,
            status: 'UNASSIGNED',
            strategyUsed: 'NONE',
            reason: 'No suitable rider found in service radius.',
            totalDurationMs: Date.now() - startTime,
            auditTrail,
            timestamp: new Date()
        };

        this._recordLog(failedLogEntry);

        return {
            success: false,
            order,
            rider: null,
            strategyUsed: 'NONE',
            reason: 'All automated assignment strategies exhausted.',
            auditTrail
        };
    }

    _recordLog(log) {
        this.executionLogs.unshift(log);
        if (this.executionLogs.length > 100) {
            this.executionLogs.pop();
        }
    }

    getExecutionLogs(limit = 20) {
        return this.executionLogs.slice(0, limit);
    }
}
