import express from 'express';
import { Order, OrderEvent } from './models.js';
import { requireOrderScope } from './service-auth.js';
import { createOrder, getOrder, listOrders, transitionOrder } from './orders.js';

const router = express.Router();
const asyncHandler = handler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
const requireAdmin = (req, res, next) => {
  if (req.service.userRole !== 'admin') return res.status(403).json({ message: 'Administrator access is required.' });
  return next();
};

router.post('/', requireOrderScope('orders.create'), asyncHandler(async (req, res) => {
  const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey;
  const result = await createOrder({ ...req.body, idempotencyKey }, req.service);
  return res.status(result.replayed ? 200 : 201).json(result);
}));

router.get('/', requireOrderScope('orders.read'), asyncHandler(async (req, res) => {
  const admin = req.service.userRole === 'admin';
  return res.json(await listOrders({
    userId: req.service.userId,
    admin,
    query: req.query
  }));
}));

router.get('/:orderNumber', requireOrderScope('orders.read'), asyncHandler(async (req, res) => {
  const order = await getOrder(req.params.orderNumber, req.service.userId, req.service.userRole === 'admin');
  return order ? res.json({ order }) : res.status(404).json({ message: 'Order was not found.' });
}));

router.patch('/:orderNumber/status', requireOrderScope('orders.manage'), requireAdmin, asyncHandler(async (req, res) => {
  const order = await transitionOrder(req.params.orderNumber, req.body?.newStatus, req.service);
  return order ? res.json({ order }) : res.status(404).json({ message: 'Order was not found.' });
}));

router.get('/:orderNumber/events', requireOrderScope('orders.read'), asyncHandler(async (req, res) => {
  if (req.service.userRole !== 'admin') return res.status(403).json({ message: 'Administrator access is required.' });
  const exists = await Order.exists({ orderNumber: req.params.orderNumber });
  if (!exists) return res.status(404).json({ message: 'Order was not found.' });
  const events = await OrderEvent.find({ orderId: req.params.orderNumber })
    .sort({ occurredAt: 1 }).limit(100).lean();
  return res.json({ events });
}));

export default router;
