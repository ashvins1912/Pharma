import express from 'express';
import { getIsConnected } from '../config/db.js';
import { verifyPaymentSnoozeToken } from '../services/payment/SignedPaymentActionService.js';
import { applySnoozeActionOnce } from '../services/payment/PaymentActionService.js';
import { renderPaymentSnoozePage } from '../views/paymentActionPage.js';

const router = express.Router();

router.get('/snooze', (req, res) => {
    if (process.env.PAYMENT_REMINDER_ENABLED !== 'true' && process.env.PAYMENT_REMINDER_ENGINE_ENABLED !== 'true') {
        return res.status(404).type('text').send('Payment actions are unavailable.');
    }
    try {
        if (!verifyPaymentSnoozeToken(req.query?.token)) return res.status(401).type('text').send('This payment action link is invalid or expired.');
    } catch (error) {
        if (error.code === 'SIGNED_ACTIONS_NOT_CONFIGURED') return res.status(503).type('text').send('Payment actions are not configured.');
        throw error;
    }
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.type('html').send(renderPaymentSnoozePage(String(req.query.token)));
});

router.post('/snooze', async (req, res) => {
    if (process.env.PAYMENT_REMINDER_ENABLED !== 'true' && process.env.PAYMENT_REMINDER_ENGINE_ENABLED !== 'true') {
        return res.status(404).json({ success: false, code: 'FEATURE_DISABLED', message: 'Payment actions are unavailable.' });
    }
    if (!getIsConnected()) {
        return res.status(503).json({ success: false, code: 'SERVICE_UNAVAILABLE', message: 'Payment action is temporarily unavailable.' });
    }
    let verified;
    try {
        verified = verifyPaymentSnoozeToken(req.body?.token);
    } catch (error) {
        if (error.code === 'SIGNED_ACTIONS_NOT_CONFIGURED') {
            return res.status(503).json({ success: false, code: error.code, message: 'Payment actions are not configured.' });
        }
        throw error;
    }
    if (!verified) {
        return res.status(401).json({ success: false, code: 'INVALID_ACTION_TOKEN', message: 'This payment action link is invalid or expired.' });
    }
    try {
        const result = await applySnoozeActionOnce(verified);
        if (result.status === 'PROCESSING') return res.status(409).json({ success: false, code: 'ACTION_IN_PROGRESS', message: 'This payment action is already being processed.', requestId: req.requestId || null });
        if (result.status === 'INVALID') return res.status(401).json({ success: false, code: 'INVALID_ACTION_TOKEN', message: 'This payment action link is invalid or expired.', requestId: req.requestId || null });
        return res.json({ success: true, data: { snoozedUntil: result.snoozedUntil, applied: result.applied }, requestId: req.requestId || null });
    } catch (error) {
        console.error('Payment snooze action failed:', { code: error.code || 'INTERNAL_ERROR' });
        return res.status(500).json({ success: false, code: 'PAYMENT_ACTION_FAILED', message: 'Could not update reminder preferences.', requestId: req.requestId || null });
    }
});

export default router;
