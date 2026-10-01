import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
dotenv.config();

import connectDB, { getIsConnected } from './config/db.js';
import apiRoutes from './routes/apiRoutes.js';
import internalGatewayRoutes from './routes/internalGatewayRoutes.js';
import { csrfProtection } from './security/sessionCookie.js';
import dataStore from './dataStore.js';
import DataMartRefreshService from './services/DataMartRefreshService.js';
import { recoverInventoryImports } from './services/InventoryImportService.js';
import { processOrderEvents, recoverOrderEvents, startOrderEventWorker } from './services/OrderEventService.js';
import { backfillOrderNumbers } from './services/OrderPublicIdMigration.js';
import { env } from './config/env.js';
import { corsErrorHandler, createCorsMiddleware } from './security/corsPolicy.js';
import { requestContext } from './security/requestContext.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
app.use(requestContext);
app.use(createCorsMiddleware(env.CORS_ALLOWED_ORIGINS));
app.use(express.json());
app.use(cookieParser());
app.use(csrfProtection);

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'backend' }));
app.get('/ready', (_req, res) => {
    const ready = env.NODE_ENV !== 'production' || getIsConnected();
    return res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'not-ready',
        database: getIsConnected() ? 'connected' : 'unavailable'
    });
});

const dataMartRefreshService = new DataMartRefreshService();
let isDataMartRefreshRunning = false;
const refreshDataMart = async () => {
    if (isDataMartRefreshRunning) return;
    isDataMartRefreshRunning = true;
    try {
        const result = await dataMartRefreshService.refresh();
        console.info('Medicine data mart refreshed:', result.refreshedCount);
    } catch (error) {
        console.error('Medicine data mart refresh failed:', error);
    } finally {
        isDataMartRefreshRunning = false;
    }
};

connectDB()
    .then(async connected => {
        if (!connected) return;
        await dataStore.ensureCatalogSeeded();
        await backfillOrderNumbers();
        await recoverInventoryImports();
        await recoverOrderEvents();
        void processOrderEvents();
        await refreshDataMart();
        const refreshTimer = setInterval(() => void refreshDataMart(), 15 * 60 * 1000);
        refreshTimer.unref();
    })
    .catch(error => console.error('MongoDB catalog initialization failed:', error));

startOrderEventWorker();
const inventoryImportRecoveryTimer = setInterval(() => {
    void recoverInventoryImports().catch(error => {
        console.error('Inventory import recovery check failed:', error.message);
    });
}, 30_000);
inventoryImportRecoveryTimer.unref();

app.use('/internal/gateway', internalGatewayRoutes);
app.use('/api', apiRoutes);

app.use(corsErrorHandler);
app.use(errorHandler);

export default app;
