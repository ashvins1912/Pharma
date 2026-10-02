import mongoose from 'mongoose';
import { env } from './env.js';
import Rider from '../models/Rider.js';

let isConnected = false;
let connectionAttempt = null;
let reconnectTimer = null;
let hasLoggedInitialStatus = false;

const scheduleReconnect = () => {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connectDB({ silent: true });
    }, 20_000);
    reconnectTimer.unref();
};

mongoose.connection.on('connected', () => {
    isConnected = true;
    console.log("✅ Database connectivity successfully synchronized into MongoDB.");
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
});
mongoose.connection.on('disconnected', () => {
    isConnected = false;
    scheduleReconnect();
});

export const connectDB = async ({ silent = false } = {}) => {
    if (connectionAttempt) return connectionAttempt;

    connectionAttempt = (async () => {
        try {
            if (!env.MONGO_URI) {
                console.warn('⚠️ No MONGO_URI provided - running with in-memory datastore fallback.');
                return false;
            }
            mongoose.set('bufferCommands', false);
            await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
            await Rider.init();
            isConnected = true;
            console.log("✅ Database connectivity successfully synchronized into MongoDB.");
            return true;
        } catch (err) {
            isConnected = false;
            if (!hasLoggedInitialStatus && !silent) {
                hasLoggedInitialStatus = true;
                console.info(
                    'ℹ️ MongoDB is offline at',
                    env.MONGO_URI,
                    '- operating seamlessly with in-memory resilient storage.'
                );
            }
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
