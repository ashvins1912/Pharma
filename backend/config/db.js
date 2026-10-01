import mongoose from 'mongoose';
import { env } from './env.js';
import Rider from '../models/Rider.js';

let isConnected = false;
let connectionAttempt = null;
let reconnectTimer = null;

const scheduleReconnect = () => {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connectDB();
    }, 10_000);
    reconnectTimer.unref();
};

mongoose.connection.on('connected', () => {
    isConnected = true;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
});
mongoose.connection.on('disconnected', () => {
    isConnected = false;
    scheduleReconnect();
});

export const connectDB = async () => {
    if (connectionAttempt) return connectionAttempt;

    connectionAttempt = (async () => {
        try {
            if (!env.MONGO_URI) {
                console.warn('⚠️ No MONGO_URI provided - running with in-memory datastore fallback.');
                return false;
            }
            mongoose.set('bufferCommands', false);
            await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
            await Rider.init();
            isConnected = true;
            console.log("✅ Database connectivity successfully synchronized into MongoDB.");
            return true;
        } catch (err) {
            isConnected = false;
            const cause = err.reason?.servers
                ? [...err.reason.servers.values()].map(server => server.error?.message).find(Boolean)
                : null;
            console.error(
                'MongoDB connection failed; rider data is unavailable until the database is reachable.',
                cause || err.message
            );
            scheduleReconnect();
            return false;
        } finally {
            connectionAttempt = null;
        }
    })();

    return connectionAttempt;
};

export const getIsConnected = () => isConnected;

export default connectDB;
