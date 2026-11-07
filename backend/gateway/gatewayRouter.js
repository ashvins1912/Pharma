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
import deliveryRouter from './routes/delivery.js';
// Both legacy and versioned medicine-request URLs share one MongoDB-backed domain router.
import medicineRequestsRouter from '../routes/medicineRequestRoutes.js';
import integrationsRouter from './routes/integrations.js';
import notificationsRouter from './routes/notifications.js';
import authRouter from './routes/auth.js';
import profileRouter from './routes/profile.js';
import adminTenantsRouter from './routes/adminTenants.js';
import vendorRouter from './routes/vendorRoutes.js';
import paymentActionRoutes from '../routes/paymentActionRoutes.js';
import adminPaymentReminderRoutes from '../routes/adminPaymentReminderRoutes.js';
import deliveryEventRoutes from '../routes/deliveryEventRoutes.js';
import activityRouter from './routes/activity.js';
import adminServiceLogsRouter from './routes/adminServiceLogs.js';
import ServiceLog from '../models/ServiceLog.js';

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
gateway.use('/admin/service-logs', adminServiceLogsRouter);
gateway.use('/vendors', vendorRouter);
gateway.use('/vendor', vendorRouter);
gateway.use('/tenants', tenantsRouter);
gateway.use('/tenant', tenantsRouter);
gateway.use('/branches', tenantsRouter);
gateway.use('/customers', customersRouter);
gateway.use('/catalog', catalogRouter);
gateway.use('/pricing', pricingRouter);
gateway.use('/delivery', deliveryRouter);
gateway.use('/medicine-requests', medicineRequestsRouter);
gateway.use('/integrations', integrationsRouter);
gateway.use('/notifications', notificationsRouter);
gateway.use('/public/payments', paymentActionRoutes);
gateway.use('/admin/payments', adminPaymentReminderRoutes);
gateway.use('/delivery/events', deliveryEventRoutes);
gateway.use('/activity', activityRouter);

// 4. Gateway Standard Error Response Middleware
gateway.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    const requestId = req.context?.requestId || req.headers['x-request-id'] || 'req-unknown';
    const status = err instanceof DomainError ? err.status : (err.status || err.statusCode || 500);
    const code = err.code || 'INTERNAL_SERVER_ERROR';

    // Persist only service failures/throttling metadata. Never store request
    // bodies, headers, cookies, access tokens or patient/order payloads.
    if (status >= 500 || status === 429) {
        const safeMessage = String(err.message || 'Unexpected service error.')
            .replace(/Bearer\\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
            .replace(/(authorization|token|password|secret)\\s*[:=]\\s*[^,\\s]+/gi, '$1=[REDACTED]')
            .slice(0, 2000);
        void ServiceLog.create({
            service: 'backend-api',
            level: status >= 500 ? 'ERROR' : 'WARN',
            message: safeMessage,
            code: String(code).slice(0, 120),
            statusCode: status,
            method: String(req.method || 'GET').slice(0, 12),
            path: String(req.path || '/').slice(0, 500),
            requestId: String(requestId).slice(0, 120)
        }).catch(logError => console.warn('[ServiceLogs] Could not persist service failure:', logError.message));
    }

    if (err instanceof DomainError) {
        return res.status(err.status).json(err.toJSON(requestId));
    }

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
