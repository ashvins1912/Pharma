import { Server } from 'socket.io';
import http from 'node:http';
import { cacheService } from '../cache/CacheService.js';

export class DecoupledWebsocketServer {
    constructor(port = process.env.PORT || process.env.WS_PORT || 4000) {
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
                origin: process.env.CORS_ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean) || '*',
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
                await cacheService.flushPendingMessagesForUser(targetId, tenantId, (channel, payload) => {
                    socket.emit(channel, payload);
                });
            });

            socket.on('update_location', ({ riderId, lat, lng } = {}) => {
                if (!riderId || lat === undefined || lng === undefined) return;
                this.io.to(`order_tracking_${riderId}`).emit('location_changed', { lat, lng });
            });

            socket.on('disconnect', () => {
                console.info(`[DecoupledWS] Client disconnected: ${socket.id}`);
            });
        });
    }

    setupCacheSubscription() {
        this.unsubscribeCache = cacheService.subscribe((envelope) => {
            const { channel, payload } = envelope;
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
        void cacheService.publishEvent(eventName, payload, { userId: targetId });
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
            void cacheService.publishEvent('new_order_alert', orderData, { userId: riderId });
        });
    }

    start() {
        this.server.listen(this.port, '0.0.0.0', () => {
            console.info(`[DecoupledWS] WebSocket service listening on 0.0.0.0:${this.port}`);
        });
        this.server.on('error', (error) => {
            console.error('[DecoupledWS] Server failed to start:', error);
            process.exitCode = 1;
        });
    }

    async stop() {
        this.unsubscribeCache?.();
        await new Promise((resolve, reject) => {
            this.io.close((error) => error ? reject(error) : resolve());
        });
    }
}

if (process.argv[1] && process.argv[1].endsWith('WebsocketServer.js')) {
    const wsServer = new DecoupledWebsocketServer();
    wsServer.start();
    const shutdown = async () => {
        try {
            await wsServer.stop();
            process.exit(0);
        } catch (error) {
            console.error('[DecoupledWS] Shutdown failed:', error);
            process.exit(1);
        }
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
}
