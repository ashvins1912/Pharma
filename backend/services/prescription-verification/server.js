import express from 'express';
import http from 'http';
import { verifyPrescriptionAgainstItems } from './PrescriptionVerificationService.js';

const app = express();
app.use(express.json());

const PORT = process.env.PRESCRIPTION_PORT || 3001;

app.get('/ready', (_req, res) => {
    res.status(200).json({
        status: 'ready',
        service: 'prescription-verification-service',
        timestamp: new Date().toISOString()
    });
});

app.post('/api/prescriptions/verify', async (req, res) => {
    try {
        const { prescriptionId, items, userId, patientPuid, tenantId, branchId, isAdmin } = req.body;
        const result = await verifyPrescriptionAgainstItems({
            prescriptionId,
            items,
            userId,
            patientPuid,
            tenantId,
            branchId,
            isAdmin
        });
        res.json({ success: true, verification: result });
    } catch (error) {
        console.error('[PrescriptionService] Verification error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const server = http.createServer(app);
server.listen(PORT, '0.0.0.0', () => {
    console.info(`[PrescriptionVerificationService] Started and initialized on port ${PORT}`);
});

export default server;
