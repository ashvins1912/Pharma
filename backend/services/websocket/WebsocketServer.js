import { Server } from 'socket.io';
import http from 'node:http';
import { cacheService } from '../cache/CacheService.js';
import jwt from 'jsonwebtoken';

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

        const publicKey = String(process.env.PHARMA_JWT_PUBLIC_KEY || '').replace(/\\n/g, '\n').trim();
        const issuer = process.env.PHARMA_JWT_ISSUER || 'pharma-auth';
        const audience = process.env.PHARMA_JWT_AUDIENCE || 'pharma-api';
        this.io.use((socket, next) => {
            const authorization = socket.handshake.headers.authorization || '';
            const token = socket.handshake.auth?.token
                || (authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '');
            if (!publicKey || !token) return next(new Error('Authentication is required for realtime connections.'));
            try {
                const claims = jwt.verify(token, publicKey, { algorithms: ['RS256'], issuer, audience });
                if (claims.token_type !== 'pharma_access' || typeof claims.sub !== 'string' || !claims.sub) {
                    return next(new Error('A valid Pharma access token is required.'));
                }
                socket.data.identity = {
                    userId: claims.sub,
                    tenantId: claims.tenantId || claims.app_metadata?.tenantId || null,
                    branchId: claims.branchId || claims.app_metadata?.branchId || null,
                    riderId: claims.riderId || null,
                    role: claims.role || claims.app_metadata?.role || 'customer',
                    permissions: Array.isArray(claims.permissions) ? claims.permissions : [],
                    orderIds: Array.isArray(claims.orderIds) ? claims.orderIds : []
                };
                return next();
            } catch {
                return next(new Error('Realtime access token is invalid or expired.'));
            }
        });

        this.setupEventHandlers();
        this.setupCacheSubscription();
    }

    setupEventHandlers() {
        this.io.on('connection', (socket) => {
            const identity = socket.data.identity;
            const role = String(identity.role || '').toUpperCase();
            const elevated = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role)
                || identity.permissions.includes('orders.read.all');
            socket.join(`bell_notifications_${identity.userId}`);
            if (identity.tenantId) socket.join(`tenant_${identity.tenantId}`);
            console.info(`[DecoupledWS] Authenticated client connected: ${socket.id}`);

            socket.on('join_rider_room', async (riderId) => {
                const ownRiderId = identity.riderId || identity.userId;
                if (typeof riderId !== 'string' || riderId !== ownRiderId) {
                    socket.emit('authorization_error', { code: 'REALTIME_ROOM_FORBIDDEN' });
                    return;
                }
                socket.join(`rider_${riderId}`);
                await cacheService.flushPendingMessagesForUser(riderId, null, (channel, payload) => {
                    socket.emit(channel, payload);
                });
            });

            socket.on('join_order_tracking', (orderId) => {
                if (typeof orderId === 'string' && orderId.length > 0
                    && (identity.orderIds.includes(orderId) || elevated)) {
                    socket.join(`order_tracking_${orderId}`);
                } else {
                    socket.emit('authorization_error', { code: 'REALTIME_ROOM_FORBIDDEN' });
                }
            });

            socket.on('join_bell_room', async ({ userId, tenantId } = {}) => {
                const targetId = typeof userId === 'string' ? userId : userId?.userId || userId;
                if (targetId && (targetId === identity.userId || elevated)) {
                    socket.join(`bell_notifications_${targetId}`);
                } else if (targetId) {
                    socket.emit('authorization_error', { code: 'REALTIME_ROOM_FORBIDDEN' });
                }
                if (tenantId && (String(tenantId) === String(identity.tenantId) || elevated)) {
                    socket.join(`tenant_${tenantId}`);
                } else if (tenantId) {
                    socket.emit('authorization_error', { code: 'REALTIME_ROOM_FORBIDDEN' });
                }
                const authorizedTenantId = tenantId && (String(tenantId) === String(identity.tenantId) || elevated)
                    ? tenantId
                    : identity.tenantId;
                await cacheService.flushPendingMessagesForUser(identity.userId, authorizedTenantId, (channel, payload) => {
                    socket.emit(channel, payload);
                });
            });

            socket.on('update_location', ({ riderId, lat, lng } = {}) => {
                const ownRiderId = identity.riderId || identity.userId;
                const actorRole = String(identity.role || '').toLowerCase();
                if (riderId !== ownRiderId || !['rider', 'delivery', 'delivery_partner'].includes(actorRole)
                    || !Number.isFinite(lat) || !Number.isFinite(lng)
                    || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                    socket.emit('authorization_error', { code: 'REALTIME_LOCATION_FORBIDDEN' });
                    return;
                }
                this.io.to(`order_tracking_${riderId}`).emit('location_changed', {
                    riderId, lat, lng, timestamp: new Date().toISOString()
                });
            });

            socket.on('disconnect', () => {
                console.info(`[DecoupledWS] Client disconnected: ${socket.id}`);
            });
        });
    }

    setupCacheSubscription() {
        this.unsubscribeCache = cacheService.subscribe((envelope) => {
            const { channel, payload } = envelope;
            // Private user notifications must never be broadcast to every socket
            // or to a tenant room shared with unrelated customers.
            if (payload?.userId) {
                this.io.to(`bell_notifications_${payload.userId}`).emit(channel, payload);
            } else if (payload?.tenantId) {
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
