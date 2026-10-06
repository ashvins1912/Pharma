import express from 'express';
import mongoose from 'mongoose';
import { customerService } from '../CustomerService.js';

const port = Number(process.env.PORT || process.env.CUSTOMER_SERVICE_PORT || 5300);
const mongoUri = process.env.CUSTOMER_MONGO_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/pharma';

const app = express();
app.use(express.json({ limit: '1mb' }));

function authContext(req, _res, next) {
  // Trusted identity comes from gateway-injected headers / service JWT in production.
  req.userId = req.headers['x-user-id'] || req.user?.userId || null;
  req.tenantId = req.headers['x-tenant-id'] || null;
  next();
}

app.get('/health', (_req, res) => res.json({ status: 'UP', service: 'customer-service' }));
app.get('/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? 'READY' : 'NOT_READY' });
});

app.use(authContext);

app.post('/api/v1/customers/ensure', async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED' } });
    const customer = await customerService.ensureCustomerForUser(req.userId, {
      name: req.body?.name,
      email: req.body?.email,
      phone: req.body?.phone,
      tenantId: req.tenantId
    });
    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: { message: error.message } });
  }
});

app.get('/api/v1/persons', async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED' } });
    const persons = await customerService.listManagedPersons(req.userId);
    res.json({ success: true, data: persons });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: { message: error.message } });
  }
});

app.post('/api/v1/persons', async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED' } });
    const person = await customerService.createFamilyPerson(req.userId, {
      ...req.body,
      tenantId: req.tenantId
    });
    res.status(201).json({ success: true, data: person });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: { message: error.message } });
  }
});

app.post('/api/v1/family-invitations', async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED' } });
    const invitation = await customerService.createInvitation(req.userId, req.body || {});
    res.status(201).json({ success: true, data: invitation });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: { message: error.message } });
  }
});

await mongoose.connect(mongoUri);
app.listen(port, '0.0.0.0', () => {
  console.log(`customer-service listening on 0.0.0.0:${port}`);
});
