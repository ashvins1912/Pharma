import express from 'express';
const app = express();
const PORT = process.env.PORT || 8091;

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'inventory-service' }));
app.get('/api/v1/inventory', (req, res) => res.json({ items: [] }));

app.listen(PORT, '0.0.0.0', () => console.log(`Inventory Service running on port ${PORT}`));
