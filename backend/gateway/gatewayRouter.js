/**
 * API Gateway Master Router (/api/v1/*)
 * Enforces centralized context extraction, structured error format, and domain routing
 */
import express from 'express';
import { contextMiddleware } from '../middleware/context.js';
import { DomainError } from '../shared/errors/DomainErrors.js';
import tenantsRouter from './routes/tenants.js';
import customersRouter from './routes/customers.js';
import catalogRouter from './routes/catalog.js';
import inventoryRouter from './routes/inventory.js';
import pricingRouter from './routes/pricing.js';
import ordersRouter from './routes/orders.js';
import deliveryRouter from './routes/delivery.js';
import medicineRequestsRouter from './routes/medicineRequests.js';
import integrationsRouter from './routes/integrations.js';
import notificationsRouter from './routes/notifications.js';

const gateway = express.Router();

// 1. Gateway Pre-processing Middleware: RequestContext Injection
gateway.use(contextMiddleware);

// 2. Health Check
gateway.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'UP',
        version: 'v1',
        architecture: 'Multi-Tenant Pharmacy Platform & Branch Architecture',
        requestId: req.context?.requestId,
        timestamp: new Date().toISOString()
    });
});

// 3. Domain Subrouters
gateway.use('/tenants', tenantsRouter);
gateway.use('/branches', tenantsRouter);
gateway.use('/customers', customersRouter);
gateway.use('/catalog', catalogRouter);
gateway.use('/inventory', inventoryRouter);
gateway.use('/pricing', pricingRouter);
gateway.use('/orders', ordersRouter);
gateway.use('/delivery', deliveryRouter);
gateway.use('/medicine-requests', medicineRequestsRouter);
gateway.use('/integrations', integrationsRouter);
gateway.use('/notifications', notificationsRouter);

// 4. Gateway Standard Error Response Middleware
gateway.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    const requestId = req.context?.requestId || req.headers['x-request-id'] || 'req-unknown';

    if (err instanceof DomainError) {
        return res.status(err.status).json(err.toJSON(requestId));
    }

    const status = err.status || err.statusCode || 500;
    const code = err.code || 'INTERNAL_SERVER_ERROR';

    res.status(status).json({
        success: false,
        error: {
            code,
            message: err.message || 'An unexpected error occurred.',
            requestId
        }
    });
});

export default gateway;
