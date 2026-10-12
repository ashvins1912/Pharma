import express from 'express';
const app = express();
const PORT = process.env.PORT || 8092;

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'order-service' }));
app.get('/api/v1/orders', (req, res) => res.json({ orders: [] }));

app.listen(PORT, '0.0.0.0', () => console.log(`Order Service running on port ${PORT}`));
