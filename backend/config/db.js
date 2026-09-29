import mongoose from 'mongoose';

let isConnected = false;

export const connectDB = async () => {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
        console.warn('⚠️ No MONGO_URI provided — operating in resilient in-memory mode.');
        return false;
    }
    try {
        mongoose.set('bufferCommands', false);
        await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2500 });
        isConnected = true;
        console.log("✅ Database connectivity successfully synchronized into MongoDB.");
        return true;
    } catch (err) {
        console.warn("⚠️ MongoDB connection error (using in-memory fallback):", err.message);
        return false;
    }
};

export const getIsConnected = () => isConnected;

export default connectDB;
