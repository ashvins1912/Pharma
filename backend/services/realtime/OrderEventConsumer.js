import { EventEmitter } from 'node:events';

export class OrderEventConsumer extends EventEmitter {
    constructor(realtimeSocketService) {
        super();
        this.socketService = realtimeSocketService;
        this.registerEventHandlers();
    }

    registerEventHandlers() {
        // Event listener for newly placed orders
        this.on('order:created', async (orderData) => {
            try {
                console.info(`[OrderEventConsumer] Consumed event [order:created] for order: ${orderData?._id || orderData?.id}`);
                if (this.socketService && orderData) {
                    await this.socketService.broadcastNewOrder(orderData);
                }
            } catch (error) {
                console.error('[OrderEventConsumer] Error handling order:created event:', error);
            }
        });

        // Event listener for rider location updates
        this.on('rider:location_updated', async ({ riderId, lat, lng }) => {
            try {
                console.info(`[OrderEventConsumer] Consumed event [rider:location_updated] for rider: ${riderId}`);
            } catch (error) {
                console.error('[OrderEventConsumer] Error handling rider:location_updated:', error);
            }
        });

        // Event listener for delivery completion
        this.on('order:delivered', async ({ orderId, riderId }) => {
            try {
                console.info(`[OrderEventConsumer] Consumed event [order:delivered] for order: ${orderId}`);
            } catch (error) {
                console.error('[OrderEventConsumer] Error handling order:delivered:', error);
            }
        });
    }

    publish(eventName, payload) {
        this.emit(eventName, payload);
    }
}

export const orderEventConsumer = new OrderEventConsumer(null);
