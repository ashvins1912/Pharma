import express from 'express';
import { getIsConnected } from '../config/db.js';
import { authenticateUser } from '../middleware/auth.js';
import Proposal from '../models/Proposal.js';

const router = express.Router();

router.get('/my-proposals', authenticateUser, async (req, res) => {
    const role = req.user.app_metadata?.role || req.user.role || 'customer';
    if (role !== 'customer') {
        return res.status(403).json({ message: 'This proposal view is available to customers only.' });
    }
    if (!getIsConnected()) {
        return res.status(503).json({ message: 'Proposals are temporarily unavailable.' });
    }

    try {
        await Proposal.updateMany(
            { customerId: req.user.sub, status: 'reviewed', expiresAt: { $lt: new Date() } },
            { $set: { status: 'expired' } }
        );
        const proposals = await Proposal.find({
            customerId: req.user.sub,
            status: 'reviewed'
        }).sort({ createdAt: -1 }).lean();
        res.json({ proposals });
    } catch (error) {
        console.error('Customer proposal retrieval failed:', error);
        res.status(500).json({ message: 'Failed to fetch your proposals.' });
    }
});

export default router;
