import http from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { startSharedEventConsumer } from './sharedEvents.js';

const PORT = Number(process.env.PORT || process.env.WS_PORT || 4000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.WS_HEARTBEAT_INTERVAL_MS || 25_000);
const PING_INTERVAL_MS = Number(process.env.WS_PING_INTERVAL_MS || 25_000);
const PING_TIMEOUT_MS = Number(process.env.WS_PING_TIMEOUT_MS || 20_000);
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const pharmaJwtPublicKey = String(process.env.PHARMA_JWT_PUBLIC_KEY || '').replace(/\\n/g, '\n').trim();
const pharmaJwtIssuer = process.env.PHARMA_JWT_ISSUER || 'pharma-auth';
const pharmaJwtAudience = process.env.PHARMA_JWT_AUDIENCE || 'pharma-api';
const authConfigured = pharmaJwtPublicKey.length >= 100;
const startedAt = Date.now();
let lastHeartbeatAt = null;
let heartbeatTimer = null;
let shuttingDown = false;
let stopSharedEventConsumer = async () => {};

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be an integer from 1 to 65535.');
}
for (const [name, value] of Object.entries({
  WS_HEARTBEAT_INTERVAL_MS: HEARTBEAT_INTERVAL_MS,
  WS_PING_INTERVAL_MS: PING_INTERVAL_MS,
  WS_PING_TIMEOUT_MS: PING_TIMEOUT_MS
})) {
  if (!Number.isInteger(value) || value < 1000) {
    throw new Error(`${name} must be an integer of at least 1000 milliseconds.`);
  }
}

const server = http.createServer((req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (req.method === 'GET' && (path === '/healthz' || path === '/health')) {
    const healthy = !shuttingDown && server.listening && (process.env.NODE_ENV !== 'production' || authConfigured);
    res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({
      status: healthy ? 'healthy' : 'shutting-down',
      service: 'websocket-service',
      uptimeSeconds: Math.floor(process.uptime()),
      activeConnections: io.engine.clientsCount,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      lastHeartbeatAt,
      authConfigured,
      timestamp: new Date().toISOString()
    }));
    return;
  }
  if (req.method === 'GET' && path === '/ready') {
    const ready = !shuttingDown && server.listening && (process.env.NODE_ENV !== 'production' || authConfigured);
    res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ status: ready ? 'ready' : 'not-ready', service: 'websocket-service' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'NOT_FOUND' }));
});

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      // Non-browser clients may omit Origin. Browser origins must be explicitly allowed in production.
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)
        || (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') && allowedOrigins.length === 0) {
        callback(null, true);
      } else {
        callback(new Error('Origin is not allowed by WebSocket CORS policy.'));
      }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Pharma-Client', 'X-Tenant-Id']
  },
  pingInterval: PING_INTERVAL_MS,
  pingTimeout: PING_TIMEOUT_MS,
  serveClient: true
});

io.use((socket, next) => {
  const authorization = socket.handshake.headers.authorization || '';
  const token = socket.handshake.auth?.token
    || (authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '');
  if (!authConfigured || !token) return next(new Error('Authentication is required for realtime connections.'));
  try {
    const claims = jwt.verify(token, pharmaJwtPublicKey, {
      algorithms: ['RS256'],
      issuer: pharmaJwtIssuer,
      audience: pharmaJwtAudience
    });
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

io.on('connection', socket => {
  console.info(JSON.stringify({ event: 'client_connected', socketId: socket.id, activeConnections: io.engine.clientsCount }));

  socket.on('heartbeat', (ack) => {
    const response = { service: 'websocket-service', timestamp: new Date().toISOString() };
    if (typeof ack === 'function') ack(response);
    socket.emit('heartbeat_ack', response);
  });

  socket.on('join_rider_room', riderId => {
    const identity = socket.data.identity;
    const ownRiderId = identity.riderId || identity.userId;
    if (typeof riderId === 'string' && riderId === ownRiderId) socket.join(`rider_${riderId}`);
    else socket.emit('authorization_error', { code: 'REALTIME_ROOM_FORBIDDEN' });
  });
  socket.on('join_order_tracking', orderId => {
    const identity = socket.data.identity;
    const elevated = ['super_admin', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'admin'].includes(identity.role)
      || identity.permissions.includes('orders.read.all');
    if (typeof orderId === 'string' && orderId.length > 0
      && (identity.orderIds.includes(orderId) || elevated)) socket.join(`order_tracking_${orderId}`);
    else socket.emit('authorization_error', { code: 'REALTIME_ROOM_FORBIDDEN' });
  });
  socket.on('join_bell_room', ({ userId, tenantId } = {}) => {
    const identity = socket.data.identity;
    const elevated = ['super_admin', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'admin'].includes(identity.role);
    if (typeof userId === 'string' && userId === identity.userId) socket.join(`bell_notifications_${identity.userId}`);
    else if (userId && elevated) socket.join(`bell_notifications_${userId}`);
    else if (userId) socket.emit('authorization_error', { code: 'REALTIME_ROOM_FORBIDDEN' });
    if (typeof tenantId === 'string' && tenantId === identity.tenantId) socket.join(`tenant_${identity.tenantId}`);
    else if (tenantId && elevated) socket.join(`tenant_${tenantId}`);
    else if (tenantId) socket.emit('authorization_error', { code: 'REALTIME_ROOM_FORBIDDEN' });
  });
  socket.on('update_location', ({ riderId, lat, lng } = {}) => {
    const identity = socket.data.identity;
    const ownRiderId = identity.riderId || identity.userId;
    const role = String(identity.role || '').toLowerCase();
    if (riderId !== ownRiderId || !['rider', 'delivery', 'delivery_partner'].includes(role)
      || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      socket.emit('authorization_error', { code: 'REALTIME_LOCATION_FORBIDDEN' });
      return;
    }
    io.to(`order_tracking_${riderId}`).emit('location_changed', { riderId, lat, lng, timestamp: new Date().toISOString() });
  });
  socket.on('disconnect', reason => {
    console.info(JSON.stringify({ event: 'client_disconnected', socketId: socket.id, reason }));
  });
});

server.on('error', error => {
  console.error(JSON.stringify({ event: 'server_error', name: error.name, code: error.code || null }));
  process.exitCode = 1;
});

function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    lastHeartbeatAt = new Date().toISOString();
    io.emit('server_heartbeat', { service: 'websocket-service', timestamp: lastHeartbeatAt, uptimeSeconds: Math.floor(process.uptime()) });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ event: 'shutdown_started', signal }));
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  await stopSharedEventConsumer();
  await new Promise(resolve => io.close(() => resolve()));
  if (server.listening) await new Promise(resolve => server.close(() => resolve()));
  process.exitCode = 0;
}

server.listen(PORT, '0.0.0.0', () => {
  console.info(JSON.stringify({
    event: 'service_started',
    service: 'websocket-service',
    port: PORT,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    pingIntervalMs: PING_INTERVAL_MS,
    pingTimeoutMs: PING_TIMEOUT_MS,
    allowedOrigins: allowedOrigins.length ? allowedOrigins : 'none-configured'
  }));
  startHeartbeat();
  stopSharedEventConsumer = startSharedEventConsumer(io);
});

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

export { server, io };
