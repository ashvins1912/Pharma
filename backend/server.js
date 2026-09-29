const express = require('express');
const cors = require('cors');
require('dotenv').config();

const connectDB = require('./config/db');
const medicineRoutes = require('./routes/medicineRoutes');
const orderRoutes = require('./routes/orderRoutes');
const couponRoutes = require('./routes/couponRoutes');
const UserProfile = require('./models/UserProfile');
const { authenticateUser } = require('./middleware/auth');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

connectDB();

app.use('/api/medicines', medicineRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/coupons', couponRoutes);

app.post('/api/user/profile', authenticateUser, async (req, res) => {
    const profile = await UserProfile.findOneAndUpdate({ userId: req.user.sub }, { mobile: req.body.mobile, addresses: req.body.addresses }, { upsert: true, new: true });
    res.json(profile);
});

app.get('/api/user/profile', authenticateUser, async (req, res) => {
    res.json(await UserProfile.findOne({ userId: req.user.sub }) || { mobile: '', addresses: [] });
});

app.post('/api/test/seed-medicines', async (req, res) => {
    try {
        const Medicine = require('./models/Medicine'); // Pulls the unified model mapping layer

        await Medicine.deleteMany({}); // Clears out broken placeholder entries
        await Medicine.insertMany([
            {
                name: "Paracetamol 650mg",
                brand: "Calpol",
                composition: "Paracetamol Basic Formulation",
                price: 30,
                quantity: 100,
                expiryDate: new Date("2027-12-31"), // Valid expiration threshold
                requiresPrescription: false,
                imageUrl: "https://placehold.co"
            },
            {
                name: "Amoxicillin 250mg",
                brand: "Novamox",
                composition: "Amoxicillin Trihydrate Compound",
                price: 112,
                quantity: 45,
                expiryDate: new Date("2027-10-15"),
                requiresPrescription: true, // Triggers Rx badges checks
                imageUrl: "https://placehold.co"
            },
            {
                name: "Cetirizine 10mg",
                brand: "Zyrtec",
                composition: "Cetirizine Hydrochloride Layer",
                price: 25,
                quantity: 1, // Triggers real-time low-stock alarm parameters
                expiryDate: new Date("2026-10-10"), // Near-expiry validation window trigger
                requiresPrescription: false,
                imageUrl: "https://placehold.co"
            }
        ]);

        res.status(201).json({ message: "✅ Mock pharmacy catalog with images, stock counts, and expiry dates safely seeded!" });
    } catch (err) {
        res.status(500).json({ message: "Seeding script execution crashed.", error: err.message });
    }
});
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`🚀 Master Application backend server active on port ${PORT}`));
