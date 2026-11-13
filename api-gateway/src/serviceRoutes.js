import { isPermissionGranted } from '@pharma/service-kernel';
import express from 'express';
import { authenticateUser, requireAdmin, requireInventoryImportPermission, requireSuperAdmin } from './authenticateUser.js';
import { config } from './config.js';
import { proxyRequest } from './proxy.js';
import { createBackendAuthToken, createServiceToken } from './serviceAuth.js';

function hasScopePermission(user, scope) {
  const aliases = {
    'inventory.read': ['inventory.view'],
    'inventory.catalogue.read': ['inventory.read'],
    'inventory.write': ['inventory.update'],
    'inventory.adjust': ['inventory.write'],
    'orders.read': ['orders.view'],
    'prescription.read': ['prescriptions.view'],
    'prescription.write': ['prescriptions.write'],
    'prescription.review': ['prescriptions.review']
  };
  const customerDefaults = scope.startsWith('customer.profile.')
    || ['orders.create', 'orders.read', 'prescription.read', 'prescription.write'].includes(scope)
    ? [scope]
    : [];
  return isPermissionGranted({
    subject: user,
    permission: scope,
    aliases,
    customerDefaultPermissions: customerDefaults
  });
}

function createServiceHandler({ audience, getScope, target, includeCustomerProfile = false, validateTenantBranch = false, allowPublic = false }, gatewayConfig) {
  return async (req, res) => {
    if (!target) {
      return res.status(503).json({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is not configured.' },
        requestId: req.requestId
      });
    }
    const scope = getScope(req);
    if (!allowPublic && !hasScopePermission(req.user, scope)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: `Permission required: ${scope}` },
        requestId: req.requestId
      });
    }
    if (validateTenantBranch) {
      const role = req.user?.app_metadata?.role || req.user?.role || 'customer';
      const isPlatformUser = ['admin', 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
      const tenantId = String((isPlatformUser ? req.get('x-tenant-id') : req.user?.tenantId || req.user?.app_metadata?.tenantId) || '').trim();
      const signedBranchId = req.user?.branchId || req.user?.app_metadata?.branchId;
      // The UI may select a different branch within the user's tenant. Prefer
      // that explicit selection, then verify it server-side against tenant
      // ownership and active membership before forwarding anything.
      const branchId = String(req.get('x-branch-id') || signedBranchId || '').trim();
      if (!tenantId || !branchId) {
        return res.status(403).json({ success: false, error: { code: 'TENANT_BRANCH_REQUIRED', message: 'Select a valid tenant and branch before using inventory imports.' }, requestId: req.requestId });
      }
      if (!gatewayConfig.backendApiUrl) {
        return res.status(503).json({ success: false, error: { code: 'TENANT_REGISTRY_UNAVAILABLE', message: 'Tenant and branch registry is unavailable.' }, requestId: req.requestId });
      }
      try {
        const assertion = createBackendAuthToken(gatewayConfig, 'tenant:branch:verify', {
          userId: String(req.user?.sub || ''),
          role,
          tenantId,
          branchId
        });
        const validation = await fetch(`${gatewayConfig.backendApiUrl}/internal/gateway/validate-tenant-branch`, {
          method: 'POST',
          headers: { 'x-gateway-authorization': `Bearer ${assertion}`, 'content-type': 'application/json' }
        });
        if (!validation.ok) {
          const body = await validation.json().catch(() => ({}));
          return res.status(validation.status).json({
            success: false,
            error: { code: validation.status === 404 ? 'TENANT_BRANCH_NOT_FOUND' : validation.status === 403 ? 'TENANT_BRANCH_FORBIDDEN' : 'TENANT_REGISTRY_UNAVAILABLE', message: body.message || 'Tenant and branch could not be verified.' },
            requestId: req.requestId
          });
        }
      } catch (error) {
        console.error('Gateway tenant/branch validation failed:', { requestId: req.requestId, code: error.code || error.name });
        return res.status(503).json({ success: false, error: { code: 'TENANT_REGISTRY_UNAVAILABLE', message: 'Tenant and branch could not be verified.' }, requestId: req.requestId });
      }
    }
    let token;
    try {
      token = createServiceToken({
        audience,
        scope,
        user: req.user || (allowPublic ? { sub: 'public-storefront', role: 'customer', roles: ['customer'], permissions: [] } : null),
        targetTenantId: req.get('x-tenant-id'),
        targetBranchId: req.get('x-branch-id'),
        // Only import routes set this after Backend API has verified the
        // selected branch belongs to the authenticated tenant and membership.
        preferTargetBranch: validateTenantBranch,
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
  const customerRead = createServiceHandler({
    audience: gatewayConfig.customerJwtAudience,
    getScope: () => 'customer.profile.read',
    target: gatewayConfig.customerServiceUrl,
    includeCustomerProfile: false
  }, gatewayConfig);
  const customerWrite = createServiceHandler({
    audience: gatewayConfig.customerJwtAudience,
    getScope: () => 'customer.profile.write',
    target: gatewayConfig.customerServiceUrl,
    includeCustomerProfile: false
  }, gatewayConfig);
  customerRouter.post('/ensure', customerWrite);
  customerRouter.get('/persons', customerRead);
  customerRouter.post('/persons', customerWrite);
  customerRouter.patch('/persons/:puid', customerWrite);
  customerRouter.delete('/persons/:puid', customerWrite);
  customerRouter.post('/family-invitations', customerWrite);

  const inventoryRouter = express.Router();
  inventoryRouter.use((req, res, next) => {
    req.matchedServiceRouter = 'inventory';
    if (!gatewayConfig.inventoryServiceUrl) {
      req.inventoryServiceUnavailable = true;
      return next();
    }
    return authenticateUser(req, res, next, gatewayConfig);
  });
  const medicineMasterRouter = express.Router();
  medicineMasterRouter.use((req, res, next) => {
    req.matchedServiceRouter = 'medicine-master';
    if (req.method === 'GET' && req.path === '/medicines/match') return next();
    return authenticateUser(req, res, next, gatewayConfig);
  });
  const medicineMaster = scope => createServiceHandler({
    audience: gatewayConfig.medicineMasterJwtAudience,
    getScope: () => scope,
    target: gatewayConfig.medicineMasterServiceUrl
  }, gatewayConfig);
  const catalogueImportAuth = (req, res, next) => requireSuperAdmin(req, res, next);
  medicineMasterRouter.get('/medicines/match', createServiceHandler({
    audience: gatewayConfig.medicineMasterJwtAudience,
    getScope: () => 'inventory.catalogue.read',
    target: gatewayConfig.medicineMasterServiceUrl,
    allowPublic: true
  }, gatewayConfig));
  medicineMasterRouter.post('/medicines/match/batch', catalogueImportAuth, medicineMaster('inventory.catalogue.import'));
  medicineMasterRouter.get('/matches/review', catalogueImportAuth, medicineMaster('inventory.catalogue.import'));
  medicineMasterRouter.post('/matches/discover', catalogueImportAuth, medicineMaster('inventory.catalogue.import'));
  medicineMasterRouter.post('/matches/:identityHash/map', catalogueImportAuth, medicineMaster('inventory.catalogue.import'));
  medicineMasterRouter.get('/medicines', medicineMaster('inventory.catalogue.read'));
  medicineMasterRouter.get('/medicines/:medicineId', medicineMaster('inventory.catalogue.read'));
  medicineMasterRouter.patch('/medicines/:medicineId', catalogueImportAuth, medicineMaster('inventory.catalogue.import'));
  medicineMasterRouter.delete('/medicines/:medicineId', catalogueImportAuth, medicineMaster('inventory.catalogue.import'));
  medicineMasterRouter.get('/medicines/:medicineId/audit', catalogueImportAuth, medicineMaster('inventory.catalogue.import'));

  const catalogueImportCleanup = medicineMaster('inventory.catalogue.import');
  medicineMasterRouter.get('/admin/database-cleanup/status', catalogueImportAuth, catalogueImportCleanup);
  medicineMasterRouter.post('/admin/database-cleanup/preview', catalogueImportAuth, catalogueImportCleanup);
  medicineMasterRouter.post('/admin/database-cleanup/execute', catalogueImportAuth, catalogueImportCleanup);
  const catalogueImport = medicineMaster('inventory.catalogue.import');
  medicineMasterRouter.get('/imports', catalogueImportAuth, catalogueImport);
  medicineMasterRouter.post('/imports/merge', catalogueImportAuth, catalogueImport);
  medicineMasterRouter.post('/imports/preview', catalogueImportAuth, catalogueImport);
  medicineMasterRouter.post('/imports/remove-selected', catalogueImportAuth, catalogueImport);
  medicineMasterRouter.get('/imports/jobs/:jobId', catalogueImportAuth, catalogueImport);
  medicineMasterRouter.post('/imports/jobs/:jobId/retry', catalogueImportAuth, catalogueImport);
  medicineMasterRouter.post('/imports/jobs/:jobId/restart', catalogueImportAuth, catalogueImport);
  medicineMasterRouter.get('/imports/:batchId/records', catalogueImportAuth, catalogueImport);
  medicineMasterRouter.get('/imports/:batchId', catalogueImportAuth, catalogueImport);
  medicineMasterRouter.post('/imports/:batchId/approve', catalogueImportAuth, catalogueImport);
  medicineMasterRouter.post('/imports/:batchId/publish', catalogueImportAuth, catalogueImport);

  const inventory = scope => createServiceHandler({
    audience: gatewayConfig.inventoryJwtAudience,
    getScope: () => scope,
    target: gatewayConfig.inventoryServiceUrl,
    validateTenantBranch: scope === 'inventory.import'
  }, gatewayConfig);
  const inventoryCleanup = inventory('platform.database.cleanup');
  inventoryRouter.get('/admin/database-cleanup/status', requireSuperAdmin, inventoryCleanup);
  inventoryRouter.post('/admin/database-cleanup/preview', requireSuperAdmin, inventoryCleanup);
  inventoryRouter.post('/admin/database-cleanup/execute', requireSuperAdmin, inventoryCleanup);
  inventoryRouter.get('/alerts', inventory('inventory.read'));
  inventoryRouter.get('/alerts/summary', inventory('inventory.read'));
  inventoryRouter.get('/suggest-restock', inventory('inventory.read'));
  inventoryRouter.get('/admin/suggest-restock', inventory('inventory.read'));
  inventoryRouter.get('/audits', inventory('inventory.read'));
  inventoryRouter.post('/bulk/lookup', inventory('inventory.read'));
  inventoryRouter.post('/check-availability', inventory('inventory.read'));
  inventoryRouter.get('/products/:productId', inventory('inventory.read'));
  const inventoryAdmin = (req, res, next) => req.inventoryServiceUnavailable
    ? next()
    : requireAdmin(req, res, next);
  inventoryRouter.post('/apply-restock', inventoryAdmin, inventory('inventory.write'));
  inventoryRouter.post('/admin/apply-restock', inventoryAdmin, inventory('inventory.write'));
  const inventoryImportAuth = (req, res, next) => req.inventoryServiceUnavailable
    ? next()
    : requireInventoryImportPermission(req, res, next);
  inventoryRouter.post('/adjust', inventoryAdmin, inventory('inventory.adjust'));
  inventoryRouter.post('/imports/preview', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.post('/imports', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.get('/imports/batches', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.get('/imports/batches/:batchId', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.get('/imports/batches/:batchId/rows', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.patch('/imports/batches/:batchId/rows/:rowId', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.post('/imports/batches/:batchId/rows/edit-selected', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.post('/imports/batches/:batchId/publish', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.post('/imports/batches/:batchId/rows/:rowId/publish', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.post('/imports/batches/:batchId/unpublish', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.post('/imports/batches/:batchId/rollback', inventoryImportAuth, inventory('inventory.import'));
  inventoryRouter.get('/imports/batches/:batchId/invalid-records/download', inventoryImportAuth, inventory('inventory.import'));
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
  prescriptionRouter.post('/scan-product-label', prescription('prescription.write'));
  prescriptionRouter.post('/upload', prescription('prescription.write'));
  prescriptionRouter.put('/:prescriptionId/document', prescription('prescription.write'));
  prescriptionRouter.get('/reviews/queue', prescription('prescription.review'));
  prescriptionRouter.get('/:prescriptionId/document', prescription('prescription.read'));
  prescriptionRouter.get('/:prescriptionId', prescription('prescription.read'));
  prescriptionRouter.post('/:prescriptionId/review/claim', prescriptionReview, prescription('prescription.review'));
  prescriptionRouter.post('/:prescriptionId/review/approve', prescriptionReview, prescription('prescription.review'));
  prescriptionRouter.post('/:prescriptionId/review/reject', prescriptionReview, prescription('prescription.review'));
  prescriptionRouter.post('/:prescriptionId/review/wait', prescriptionReview, prescription('prescription.review'));
  prescriptionRouter.post('/:prescriptionId/link-order', prescription('prescription.write'));
  prescriptionRouter.post('/:prescriptionId/convert-to-order', prescription('prescription.write'));
  prescriptionRouter.post('/:prescriptionId/review', prescriptionReview, prescription('prescription.review'));
  prescriptionRouter.post('/:prescriptionId/remove', prescription('prescription.write'));
  prescriptionRouter.get('/:prescriptionId/document-url', prescription('prescription.review'));
  prescriptionRouter.post('/hospitals', prescription('prescription.write'));

  return { customerRouter, inventoryRouter, medicineMasterRouter, orderRouter, prescriptionRouter, legacyPrescriptionRouter };
}
