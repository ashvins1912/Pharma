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
import pricingRouter from './routes/pricing.js';
import ordersRouter from './routes/orders.js';
import deliveryRouter from './routes/delivery.js';
import medicineRequestsRouter from './routes/medicineRequests.js';
import integrationsRouter from './routes/integrations.js';
import notificationsRouter from './routes/notifications.js';
import authRouter from './routes/auth.js';
import profileRouter from './routes/profile.js';
import adminTenantsRouter from './routes/adminTenants.js';
import vendorRouter from './routes/vendorRoutes.js';
import prescriptionsRouter from './routes/prescriptions.js';
import paymentActionRoutes from '../routes/paymentActionRoutes.js';
import adminPaymentReminderRoutes from '../routes/adminPaymentReminderRoutes.js';
import deliveryEventRoutes from '../routes/deliveryEventRoutes.js';

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
gateway.use('/auth', authRouter);
gateway.use('/profile', profileRouter);
gateway.use('/admin/tenants', adminTenantsRouter);
gateway.use('/vendors', vendorRouter);
gateway.use('/vendor', vendorRouter);
gateway.use('/tenants', tenantsRouter);
gateway.use('/branches', tenantsRouter);
gateway.use('/customers', customersRouter);
gateway.use('/catalog', catalogRouter);
gateway.use('/pricing', pricingRouter);
gateway.use('/orders', ordersRouter);
gateway.use('/delivery', deliveryRouter);
gateway.use('/prescriptions', prescriptionsRouter);
gateway.use('/medicine-requests', medicineRequestsRouter);
gateway.use('/integrations', integrationsRouter);
gateway.use('/notifications', notificationsRouter);
gateway.use('/public/payments', paymentActionRoutes);
gateway.use('/admin/payments', adminPaymentReminderRoutes);
gateway.use('/delivery/events', deliveryEventRoutes);

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
