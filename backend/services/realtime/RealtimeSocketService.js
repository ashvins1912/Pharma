import { Server } from 'socket.io';
import Rider from '../../models/Rider.js';
import Order from '../../models/Order.js';

export class RealtimeSocketService {
    constructor(httpServer) {
        this.io = new Server(httpServer, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            }
        });
        this.setupListeners();
    }

    setupListeners() {
        this.io.on('connection', (socket) => {
            console.info(`[RealtimeSocket] Client connected: ${socket.id}`);

            // Rider joins private room
            socket.on('join_rider_room', (riderId) => {
                if (!riderId) return;
                socket.join(`rider_${riderId}`);
                console.info(`[RealtimeSocket] Rider ${riderId} joined room: rider_${riderId}`);
            });

            // Order monitoring room
            socket.on('join_order_tracking', (orderId) => {
                if (!orderId) return;
                socket.join(`order_tracking_${orderId}`);
                console.info(`[RealtimeSocket] Client joined order tracking room: order_tracking_${orderId}`);
            });

            // Real-time telemetry streaming from rider device
            socket.on('update_location', async ({ riderId, lat, lng }) => {
                try {
                    if (!riderId || lat === undefined || lng === undefined) return;
                    await Rider.findByIdAndUpdate(riderId, {
                        currentLocation: { type: 'Point', coordinates: [Number(lng), Number(lat)] }
                    });
                    this.io.to(`order_tracking_${riderId}`).emit('location_changed', { lat, lng });
                } catch (error) {
                    console.error('[RealtimeSocket] Error updating rider location:', error);
                }
            });

            socket.on('disconnect', () => {
                console.info(`[RealtimeSocket] Client disconnected: ${socket.id}`);
            });
        });
    }

    // Broadcast new order to nearest online riders using 2dsphere indexing
    async broadcastNewOrder(orderData) {
        try {
            const storeCoords = orderData.storeLocation?.coordinates || [77.5946, 12.9716];

            // 1. Query nearest online riders within 3000 meters using 2dsphere
            const nearbyRiders = await Rider.find({
                status: { $in: ['Available', 'online', 'available'] },
                currentLocation: {
                    $near: {
                        $geometry: { type: 'Point', coordinates: storeCoords },
                        $maxDistance: 3000
                    }
                }
            }).limit(5);

            // 2. Blast order notice to specific socket rooms
            nearbyRiders.forEach(rider => {
                this.io.to(`rider_${rider._id}`).emit('new_order_alert', {
                    orderId: orderData._id || orderData.id,
                    totalAmount: orderData.totalAmount || 350,
                    payout: 45,
                    distance: 1.8,
                    timer: 30
                });
            });

            console.info(`[RealtimeSocket] Broadcasted new order ${orderData._id} to ${nearbyRiders.length} nearby riders.`);
        } catch (error) {
            console.error('[RealtimeSocket] Broadcast new order error:', error);
        }
    }
}
