import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 8090;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Health & readiness
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'backend', timestamp: new Date().toISOString() });
});

app.get('/ready', (req, res) => {
  res.json({ status: 'ready', service: 'backend', timestamp: new Date().toISOString() });
});

// Auth endpoints
app.get('/api/v1/auth/me', (req, res) => {
  res.json({
    user: {
      id: 'demo-user-1',
      email: 'ashvinsingh25@gmail.com',
      role: 'admin',
      permissions: ['*']
    }
  });
});

app.get('/api/v1/auth/csrf', (req, res) => {
  res.json({ csrfToken: 'mock-csrf-token-12345' });
});

// Medicines catalog endpoint
app.get('/api/medicines', (req, res) => {
  const medicines = [
    { id: 'med-1', name: 'Paracetamol 500mg', category: 'Pain Relief', price: 25, stock: 150, requiresPrescription: false, description: 'Effective relief for fever and mild to moderate pain.' },
    { id: 'med-2', name: 'Amoxicillin 250mg', category: 'Antibiotics', price: 120, stock: 80, requiresPrescription: true, description: 'Broad-spectrum antibiotic for bacterial infections.' },
    { id: 'med-3', name: 'Cetirizine 10mg', category: 'Allergy', price: 45, stock: 200, requiresPrescription: false, description: 'Antihistamine for allergy relief and runny nose.' },
    { id: 'med-4', name: 'Omeprazole 20mg', category: 'Gastrointestinal', price: 85, stock: 120, requiresPrescription: false, description: 'Reduces stomach acid for acid reflux and ulcers.' },
    { id: 'med-5', name: 'Ibuprofen 400mg', category: 'Pain Relief', price: 50, stock: 95, requiresPrescription: false, description: 'Anti-inflammatory pain reliever and fever reducer.' }
  ];
  const search = req.query.search ? String(req.query.search).toLowerCase() : '';
  const category = req.query.category;
  
  let filtered = medicines;
  if (search) {
    filtered = filtered.filter(m => m.name.toLowerCase().includes(search) || m.description.toLowerCase().includes(search));
  }
  if (category && category !== 'All') {
    filtered = filtered.filter(m => m.category === category);
  }

  res.json({
    medicines: filtered,
    total: filtered.length,
    totalPages: 1,
    isSearching: Boolean(search)
  });
});

// Coupons endpoint
app.get('/api/coupons/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  if (code === 'HEALTH10') {
    res.json({ valid: true, discountPercent: 10, code: 'HEALTH10' });
  } else {
    res.status(400).json({ valid: false, message: 'Invalid or expired coupon code.' });
  }
});

// Riders endpoints
app.post('/api/riders', (req, res) => {
  res.status(201).json({ rider: { id: 'rider-1', ...req.body, status: 'active' } });
});

app.get('/api/riders/profile', (req, res) => {
  res.json({ rider: { id: 'rider-1', name: 'Courier Partner', phone: '+919876543210', status: 'active' } });
});

// Inventory service endpoint
app.get('/api/v1/inventory', (req, res) => {
  res.json({ items: [{ id: 'inv-1', name: 'Paracetamol 500mg', quantity: 150 }] });
});

// Orders endpoints
app.get('/api/orders', (req, res) => {
  res.json({
    orders: [
      { id: 'ord-1', total: 450, status: 'completed', createdAt: new Date().toISOString() },
      { id: 'ord-2', total: 1200, status: 'pending', createdAt: new Date().toISOString() }
    ]
  });
});

app.post('/api/orders', (req, res) => {
  const newOrder = { id: `ord-${Date.now()}`, ...req.body, status: 'pending', createdAt: new Date().toISOString() };
  res.status(201).json({ order: newOrder });
});

// Medicine Requests endpoints
app.get('/api/medicine-requests', (req, res) => {
  res.json({
    requests: [
      { id: 'req-1', medicineName: 'Paracetamol 500mg', status: 'pending', createdAt: new Date().toISOString() }
    ]
  });
});

app.post('/api/medicine-requests', (req, res) => {
  const newReq = { id: `req-${Date.now()}`, ...req.body, status: 'pending', createdAt: new Date().toISOString() };
  res.status(201).json({ request: newReq });
});

app.get('/api/admin/medicine-requests', (req, res) => {
  res.json({
    requests: [
      { id: 'req-1', customerName: 'Ashvin Singh', medicineName: 'Paracetamol 500mg', status: 'pending', createdAt: new Date().toISOString() }
    ],
    pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 }
  });
});

app.get('/api/admin/medicine-requests/metrics/overview', (req, res) => {
  res.json({ totalRequests: 1, pendingReview: 1, approved: 0, rejected: 0 });
});

app.get('/api/admin/medicine-requests/pending-count', (req, res) => {
  res.json({ count: 1 });
});

// Profile endpoints
app.get('/api/profile', (req, res) => {
  res.json({
    profile: { id: 'demo-user-1', name: 'Ashvin Singh', email: 'ashvinsingh25@gmail.com', phone: '+919876543210' },
    addresses: [
      { id: 'addr-1', label: 'Home', address: '123 Main Street, City' }
    ]
  });
});

app.put('/api/profile', (req, res) => {
  res.json({ profile: { id: 'demo-user-1', ...req.body } });
});

app.post('/api/profile/addresses', (req, res) => {
  res.status(201).json({ address: { id: `addr-${Date.now()}`, ...req.body } });
});

app.delete('/api/profile/addresses/:id', (req, res) => {
  res.json({ success: true, deletedId: req.params.id });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT}`);
});
