import express from 'express';
import { validateLogin, sanitizeBodyMiddleware } from '../security/validator.js';
import { isDemoAdminEnabled, isInstantDemoAdminEnabled, issueDemoAdminToken, verifyDemoAdminPassword, getDemoAdminIdentity } from '../config/demoAdmin.js';
import { isDemoCustomerEnabled, issueDemoCustomerToken, getDemoCustomerIdentity } from '../config/demoCustomer.js';

const router = express.Router();
router.use(sanitizeBodyMiddleware);

router.post('/demo-admin', validateLogin, async (req, res) => {
  if (!isDemoAdminEnabled() || !verifyDemoAdminPassword(req.body?.email, req.body?.password)) {
    return res.status(404).json({ message: 'Local demo admin access is disabled.' });
  }
  const access_token = await issueDemoAdminToken();
  return res.json({ access_token, token_type: 'Bearer', expires_in: 3600, user: getDemoAdminIdentity() });
});

router.post('/demo-admin/instant', async (_req, res) => {
  if (!isDemoAdminEnabled() || !isInstantDemoAdminEnabled()) {
    return res.status(404).json({ message: 'Local demo admin access is disabled.' });
  }
  const access_token = await issueDemoAdminToken(true);
  return res.json({ access_token, token_type: 'Bearer', expires_in: 3600, user: getDemoAdminIdentity() });
});

router.post('/demo-customer', async (_req, res) => {
  if (!isDemoCustomerEnabled()) {
    return res.status(404).json({ message: 'Local demo customer access is disabled.' });
  }
  const access_token = await issueDemoCustomerToken();
  return res.json({ access_token, token_type: 'Bearer', expires_in: 3600, user: getDemoCustomerIdentity() });
});

export default router;
