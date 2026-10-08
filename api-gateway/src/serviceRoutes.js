import express from 'express';
import { authenticateUser, requireAdmin, requireInventoryImportPermission } from './authenticateUser.js';
import { config } from './config.js';
import { proxyRequest } from './proxy.js';
import { createServiceToken } from './serviceAuth.js';

function hasScopePermission(user, scope) {
  const role = user?.app_metadata?.role || user?.role || 'customer';
  if (['admin', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN'].includes(role)) return true;
  if (role === 'customer' && scope.startsWith('customer.profile.')) return true;
  const permissions = Array.isArray(user?.permissions) ? user.permissions : (user?.app_metadata?.permissions || []);
  if (permissions.includes('*') || permissions.includes(scope)) return true;
  const aliases = {
    'inventory.read': ['inventory.view'],
    'inventory.write': ['inventory.update'],
    'orders.read': ['orders.view'],
    'prescription.read': ['prescriptions.view'],
    'prescription.write': ['prescriptions.write'],
    'prescription.review': ['prescriptions.review']
  };
  return (aliases[scope] || []).some(permission => permissions.includes(permission));
}

function createServiceHandler({ audience, getScope, target, includeCustomerProfile = false }, gatewayConfig) {
  return (req, res) => {
    if (!target) {
      return res.status(503).json({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is not configured.' },
        requestId: req.requestId
      });
    }
    const scope = getScope(req);
    if (!hasScopePermission(req.user, scope)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: `Permission required: ${scope}` },
        requestId: req.requestId
      });
    }
    let token;
    try {
      token = createServiceToken({
        audience,
        scope,
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
  const customerRouter = express.Router();
  customerRouter.use((req, res, next) => gatewayConfig.customerServiceUrl
    ? authenticateUser(req, res, next, gatewayConfig)
    : next('router'));
  const customer = createServiceHandler({
    audience: gatewayConfig.customerJwtAudience,
    getScope: () => 'customer.profile.write',
    target: gatewayConfig.customerServiceUrl,
    includeCustomerProfile: false
  }, gatewayConfig);
  customerRouter.post('/ensure', customer);
  customerRouter.get('/persons', customer);
  customerRouter.post('/persons', customer);
  customerRouter.patch('/persons/:puid', customer);
  customerRouter.delete('/persons/:puid', customer);
  customerRouter.post('/family-invitations', customer);

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


  // Keep legacy URLs used by orders created before the Prescription Service migration.
  const legacyPrescriptionRouter = express.Router();
  legacyPrescriptionRouter.use((req, res, next) => gatewayConfig.prescriptionServiceUrl
    ? authenticateUser(req, res, next, gatewayConfig)
    : next('router'));
  const legacyPrescription = createServiceHandler({
    audience: gatewayConfig.prescriptionJwtAudience,
    getScope: () => 'prescription.read',
    target: gatewayConfig.prescriptionServiceUrl,
    includeCustomerProfile: true
  }, gatewayConfig);
  legacyPrescriptionRouter.get('/prescriptions/:fileId', (req, res, next) => {
    req.url = `/api/v1/prescriptions/${encodeURIComponent(req.params.fileId)}/document`;
    req.originalUrl = req.url;
    return legacyPrescription(req, res, next);
  });

  const prescriptionRouter = express.Router();
  prescriptionRouter.use((req, res, next) => gatewayConfig.prescriptionServiceUrl
    ? authenticateUser(req, res, next, gatewayConfig)
    : next('router'));
  const prescription = scope => createServiceHandler({
    audience: gatewayConfig.prescriptionJwtAudience,
    getScope: () => scope,
    target: gatewayConfig.prescriptionServiceUrl,
    includeCustomerProfile: true
  }, gatewayConfig);
  const prescriptionReview = (req, res, next) => requireAdmin(req, res, next);
  prescriptionRouter.post('/upload', prescription('prescription.write'));
  prescriptionRouter.put('/:prescriptionId/document', prescription('prescription.write'));
  prescriptionRouter.get('/reviews/queue', prescription('prescription.review'));
  prescriptionRouter.get('/:prescriptionId/document', prescription('prescription.read'));
  prescriptionRouter.get('/:prescriptionId', prescription('prescription.read'));
  prescriptionRouter.post('/:prescriptionId/review/claim', prescriptionReview, prescription('prescription.review'));
  prescriptionRouter.post('/:prescriptionId/review/approve', prescriptionReview, prescription('prescription.review'));
  prescriptionRouter.post('/:prescriptionId/review/reject', prescriptionReview, prescription('prescription.review'));
  prescriptionRouter.post('/:prescriptionId/review/wait', prescriptionReview, prescription('prescription.review'));
  prescriptionRouter.post('/:prescriptionId/review', prescriptionReview, prescription('prescription.review'));
  prescriptionRouter.post('/:prescriptionId/remove', prescription('prescription.write'));
  prescriptionRouter.get('/:prescriptionId/document-url', prescription('prescription.review'));
  prescriptionRouter.post('/hospitals', prescription('prescription.write'));

  return { customerRouter, inventoryRouter, orderRouter, prescriptionRouter, legacyPrescriptionRouter };
}
