import express from 'express';
import crypto from 'node:crypto';
import { verifyDeliverySignature, processDeliveryEvent } from '../services/delivery/DeliveryEventService.js';
import { verifyRiderDeliveryActionToken } from '../services/payment/SignedPaymentActionService.js';
import { renderDeliveryActionPage } from '../views/deliveryActionPage.js';
import { getTransactionsSupported } from '../config/db.js';

const router = express.Router();

router.get('/actions', (req, res) => {
    if (process.env.WHATSAPP_DELIVERY_TRACKING_ENABLED !== 'true') return res.status(404).type('text').send('Delivery actions are unavailable.');
    try {
        const claims = verifyRiderDeliveryActionToken(req.query?.token);
        if (!claims) return res.status(401).type('text').send('This delivery action link is invalid or expired.');
        res.set('Cache-Control', 'no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        return res.type('html').send(renderDeliveryActionPage(String(req.query.token), claims.action));
    } catch (error) {
        if (error.code === 'SIGNED_ACTIONS_NOT_CONFIGURED') return res.status(503).type('text').send('Delivery actions are not configured.');
        return res.status(500).type('text').send('Could not open this delivery action.');
    }
});

router.post('/actions', async (req, res) => {
    if (process.env.WHATSAPP_DELIVERY_TRACKING_ENABLED !== 'true') return res.status(404).json({ success: false, code: 'FEATURE_DISABLED', message: 'Delivery actions are unavailable.' });
    if (process.env.MONGO_TRANSACTIONS_CONFIRMED !== 'true' || !getTransactionsSupported()) return res.status(503).json({ success: false, code: 'TRANSACTION_CAPABILITY_UNCONFIRMED', message: 'Delivery event integration is not enabled for this database deployment.' });
    try {
        const claims = verifyRiderDeliveryActionToken(req.body?.token);
        if (!claims || req.body?.action !== claims.action) return res.status(401).json({ success: false, code: 'INVALID_ACTION_TOKEN', message: 'This delivery action link is invalid or expired.' });
        const result = await processDeliveryEvent({
            eventId: claims.eventId,
            action: claims.action,
            orderId: claims.orderId,
            riderId: claims.riderId
        }, { requestId: req.requestId || crypto.randomUUID() });
        return res.json({ success: true, data: result, requestId: req.requestId || null });
    } catch (error) {
        if (error.code === 'SIGNED_ACTIONS_NOT_CONFIGURED') return res.status(503).json({ success: false, code: error.code, message: 'Delivery actions are not configured.' });
        const status = error.statusCode || 500;
        return res.status(status).json({ success: false, code: error.code || 'DELIVERY_ACTION_FAILED', message: status >= 500 ? 'Delivery action could not be processed.' : error.message, requestId: req.requestId || null });
    }
});

router.post('/', async (req, res) => {
    if (process.env.WHATSAPP_DELIVERY_TRACKING_ENABLED !== 'true') {
        return res.status(404).json({ success: false, code: 'FEATURE_DISABLED', message: 'Delivery event integration is unavailable.' });
    }
    if (process.env.MONGO_TRANSACTIONS_CONFIRMED !== 'true' || !getTransactionsSupported()) {
        return res.status(503).json({ success: false, code: 'TRANSACTION_CAPABILITY_UNCONFIRMED', message: 'Delivery event integration is not enabled for this database deployment.' });
    }
    const signature = req.get('x-delivery-signature');
    const timestamp = req.get('x-delivery-timestamp');
    try {
        if (!verifyDeliverySignature(req.rawBody, signature, timestamp)) {
            return res.status(401).json({ success: false, code: 'INVALID_SIGNATURE', message: 'Delivery event authentication failed.', requestId: req.requestId || null });
        }
        const requestId = req.requestId || crypto.randomUUID();
        const outcome = await processDeliveryEvent(req.body || {}, { requestId });
        return res.status(200).json({ success: true, data: outcome, requestId });
    } catch (error) {
        if (error.code === 'SIGNATURE_NOT_CONFIGURED') {
            return res.status(503).json({ success: false, code: error.code, message: 'Delivery event integration is not configured.', requestId: req.requestId || null });
        }
        const status = error.statusCode || 500;
        console.error('Delivery event processing failed:', {
            requestId: req.requestId || null,
            eventId: req.body?.eventId || null,
            action: req.body?.action || null,
            orderId: req.body?.orderId || null,
            code: error.code || 'INTERNAL_ERROR',
            errorName: error.name
        });
        return res.status(status).json({
            success: false,
            code: error.code || 'DELIVERY_EVENT_FAILED',
            message: status >= 500 ? 'Delivery event could not be processed.' : error.message,
            requestId: req.requestId || null
        });
    }
});

export default router;
