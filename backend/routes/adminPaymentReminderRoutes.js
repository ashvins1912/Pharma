import express from 'express';
import { authenticateUser, isAdmin } from '../middleware/auth.js';
import { getOutstandingPayments, dispatchPaymentReminder } from '../services/payment/PaymentReminderService.js';

const router = express.Router();
const enabled = (req, res) => {
    if (process.env.PAYMENT_REMINDER_ENABLED === 'true' || process.env.PAYMENT_REMINDER_ENGINE_ENABLED === 'true') return true;
    res.status(404).json({ success: false, code: 'FEATURE_DISABLED', message: 'Payment reminders are unavailable.', requestId: req.requestId || null });
    return false;
};

router.use(authenticateUser, isAdmin);

router.get('/outstanding', async (req, res) => {
    if (!enabled(req, res)) return;
    try {
        const data = await getOutstandingPayments({ customerId: req.query.customerId, limit: req.query.limit });
        return res.json({ success: true, data, requestId: req.requestId || null });
    } catch (error) {
        const status = error.statusCode || 500;
        console.error('Outstanding payment query failed:', { requestId: req.requestId || null, code: error.code || 'PAYMENT_QUERY_FAILED', name: error.name });
        return res.status(status).json({
            success: false,
            code: error.code || 'PAYMENT_QUERY_FAILED',
            message: status >= 500 ? 'Could not retrieve outstanding payments.' : error.message,
            requestId: req.requestId || null
        });
    }
});

router.post('/reminders/dispatch', async (req, res) => {
    if (!enabled(req, res)) return;
    try {
        const data = await dispatchPaymentReminder({
            customerId: req.body?.customerId,
            orderIds: req.body?.orderIds,
            requestedBy: req.user.sub || req.user.id,
            requestId: req.requestId || null
        });
        return res.status(data.duplicate ? 200 : 202).json({ success: true, data, requestId: req.requestId || null });
    } catch (error) {
        const status = error.statusCode || 500;
        console.error('Payment reminder dispatch failed:', { requestId: req.requestId || null, code: error.code || 'REMINDER_DISPATCH_FAILED', name: error.name });
        return res.status(status).json({
            success: false,
            code: error.code || 'REMINDER_DISPATCH_FAILED',
            message: status >= 500 ? 'Could not dispatch payment reminder.' : error.message,
            requestId: req.requestId || null
        });
    }
});

export default router;
