import express from 'express';
import { authenticateUser, requireAdmin, requireInventoryImportPermission } from './authenticateUser.js';
import { config } from './config.js';
import { proxyRequest } from './proxy.js';
import { createServiceToken } from './serviceAuth.js';

function createServiceHandler({ audience, getScope, target, includeCustomerProfile = false }, gatewayConfig) {
  return (req, res) => {
    if (!target) {
      return res.status(503).json({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is not configured.' },
        requestId: req.requestId
      });
    }
    let token;
    try {
      token = createServiceToken({
        audience,
        scope: getScope(req),
        user: req.user,
        includeCustomerProfile
      }, gatewayConfig);
    } catch (error) {
      console.error('Gateway could not create a service credential:', {
        requestId: req.requestId,
        service: audience,
        code: error.code || error.name
      });
      return res.status(503).json({
        success: false,
        error: { code: 'SERVICE_AUTHENTICATION_UNAVAILABLE', message: 'Service authentication is unavailable.' },
        requestId: req.requestId
      });
    }
    return proxyRequest(req, res, target, `Bearer ${token}`, gatewayConfig, audience);
  };
}

export function createServiceRouters(gatewayConfig = config) {
  const inventoryRouter = express.Router();
  inventoryRouter.use((req, res, next) => {
    if (!gatewayConfig.inventoryServiceUrl) {
      req.inventoryServiceUnavailable = true;
      return next();
    }
    return authenticateUser(req, res, next, gatewayConfig);
  });
  const inventory = scope => createServiceHandler({
    audience: gatewayConfig.inventoryJwtAudience,
    getScope: () => scope,
    target: gatewayConfig.inventoryServiceUrl
  }, gatewayConfig);
  inventoryRouter.post('/bulk/lookup', inventory('inventory.read'));
  inventoryRouter.post('/check-availability', inventory('inventory.read'));
  inventoryRouter.get('/products/:productId', inventory('inventory.read'));
  const inventoryAdmin = (req, res, next) => req.inventoryServiceUnavailable
    ? next()
    : requireAdmin(req, res, next);
  const inventoryImportAuth = (req, res, next) => req.inventoryServiceUnavailable
    ? next()
    : requireInventoryImportPermission(req, res, next);
  inventoryRouter.post('/adjust', inventoryAdmin, inventory('inventory.adjust'));
  inventoryRouter.post('/imports', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.get('/imports/:jobId/failures/download', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.get('/imports/:jobId/failures', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.post('/imports/:jobId/retry', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.get('/imports/:jobId', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.get('/:productId', inventory('inventory.read'));
  inventoryRouter.all('*', (req, res) => res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Inventory route was not found.' },
    requestId: req.requestId
  }));

  const orderRouter = express.Router();
  orderRouter.use((req, res, next) => gatewayConfig.orderServiceUrl
    ? authenticateUser(req, res, next, gatewayConfig)
    : next('router'));
  const order = scope => createServiceHandler({
    audience: gatewayConfig.orderJwtAudience,
    getScope: () => scope,
    target: gatewayConfig.orderServiceUrl,
    includeCustomerProfile: true
  }, gatewayConfig);
  orderRouter.post('/', order('orders.create'));
  orderRouter.get('/', order('orders.read'));
  orderRouter.get('/:orderNumber/events', requireAdmin, order('orders.read'));
  orderRouter.get('/:orderNumber', order('orders.read'));
  orderRouter.patch('/:orderNumber/status', requireAdmin, order('orders.manage'));
  orderRouter.all('*', (req, res) => res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Order route was not found.' },
    requestId: req.requestId
  }));

  return { inventoryRouter, orderRouter };
}
