import mongoose from 'mongoose';
import { env } from './env.js';
import Rider from '../models/Rider.js';

let isConnected = false;

mongoose.connection.on('connected', () => {
    isConnected = true;
});
mongoose.connection.on('disconnected', () => {
    isConnected = false;
});

export const connectDB = async () => {
    try {
        mongoose.set('bufferCommands', false);
        await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 2500 });
        await Rider.createCollection();
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
