import { Server } from 'socket.io';
import http from 'http';
import { cacheService } from '../cache/CacheService.js';

export class DecoupledWebsocketServer {
    constructor(port = 4000) {
        this.port = Number(port);
        this.server = http.createServer((req, res) => {
            if (req.url === '/healthz' || req.url === '/ready') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'healthy',
                    service: 'websocket-service',
                    telemetry: cacheService.getTelemetry(),
                    timestamp: new Date().toISOString()
                }));
                return;
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        });

        this.io = new Server(this.server, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST', 'OPTIONS'],
                allowedHeaders: ['Content-Type', 'Authorization', 'X-Pharma-Client', 'X-Tenant-Id']
            }
        });

        this.setupEventHandlers();
        this.setupCacheSubscription();
    }

    setupEventHandlers() {
        this.io.on('connection', (socket) => {
            console.info(`[DecoupledWS] Client connected: ${socket.id}`);

            socket.on('join_rider_room', async (riderId) => {
                if (!riderId) return;
                socket.join(`rider_${riderId}`);
                // Flush backlog upon rider login / joining room
                await cacheService.flushPendingMessagesForUser(riderId, null, (channel, payload) => {
                    socket.emit(channel, payload);
                });
            });

            socket.on('join_order_tracking', (orderId) => {
                if (!orderId) return;
                socket.join(`order_tracking_${orderId}`);
            });

            socket.on('join_bell_room', async ({ userId, tenantId } = {}) => {
                const targetId = typeof userId === 'string' ? userId : userId?.userId || userId;
                if (!targetId && !tenantId) return;
                if (targetId) socket.join(`bell_notifications_${targetId}`);
                if (tenantId) socket.join(`tenant_${tenantId}`);

                // Flush offline backlog queued messages upon login / joining room
                await cacheService.flushPendingMessagesForUser(targetId, tenantId, (channel, payload) => {
                    socket.emit(channel, payload);
                });
            });

            socket.on('update_location', ({ riderId, lat, lng }) => {
                if (!riderId || lat === undefined || lng === undefined) return;
                this.io.to(`order_tracking_${riderId}`).emit('location_changed', { lat, lng });
            });

            socket.on('disconnect', () => {
                console.info(`[DecoupledWS] Client disconnected: ${socket.id}`);
            });
        });
    }

    setupCacheSubscription() {
        cacheService.subscribe((envelope) => {
            const { channel, payload } = envelope;
            console.info(`[DecoupledWS] Received cache pub/sub event on channel [${channel}]`);
            this.io.emit(channel, payload);
            if (payload?.userId) {
                this.io.to(`bell_notifications_${payload.userId}`).emit(channel, payload);
            }
            if (payload?.tenantId) {
                this.io.to(`tenant_${payload.tenantId}`).emit(channel, payload);
            }
        });
    }

    publishNotification(targetId, eventName, payload) {
        if (!targetId || !eventName) return;
        this.io.to(`bell_notifications_${targetId}`).emit(eventName, payload);
        cacheService.publishEvent(eventName, payload, { userId: targetId });
    }

    broadcastNewOrder(orderData, riderIds = []) {
        riderIds.forEach(riderId => {
            this.io.to(`rider_${riderId}`).emit('new_order_alert', {
                orderId: orderData._id || orderData.id,
                totalAmount: orderData.totalAmount || 350,
                payout: 45,
                distance: 1.8,
                timer: 30
            });
            cacheService.publishEvent('new_order_alert', orderData, { userId: riderId });
        });
    }

    start() {
        this.server.listen(this.port, '0.0.0.0', () => {
            console.info(`[DecoupledWS] Decoupled WebSocket microservice running on port ${this.port} with telemetry & queue flush flow.`);
        });
    }
}

if (process.argv[1] && process.argv[1].endsWith('WebsocketServer.js')) {
    const wsServer = new DecoupledWebsocketServer(process.env.WS_PORT || 4000);
    wsServer.start();
}
