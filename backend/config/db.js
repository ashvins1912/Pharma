import mongoose from 'mongoose';
import { env } from './env.js';
import Rider from '../models/Rider.js';
import DeliveryAction from '../models/DeliveryAction.js';
import RiderLedger from '../models/RiderLedger.js';
import PaymentSnooze from '../models/PaymentSnooze.js';
import PaymentReminder from '../models/PaymentReminder.js';
import PaymentActionNonce from '../models/PaymentActionNonce.js';
import TenantBranch from '../models/TenantBranch.js';

mongoose.set('bufferCommands', false);

let isConnected = false;
let supportsTransactions = false;
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
            const hello = await mongoose.connection.db.admin().command({ hello: 1 });
            // Keep split-order confirmation IDs unique only when present. The legacy
            // sparse unique index also indexed explicit null values and could block
            // otherwise unrelated orders that had no confirmation ID.
            try {
                const ordersCollection = mongoose.connection.db.collection('orders');
                const orderIndexes = await ordersCollection.indexes();
                const legacyConfirmationIndex = orderIndexes.find(index =>
                    index.key?.fulfillmentConfirmationId === 1 && index.unique && index.sparse
                );
                if (legacyConfirmationIndex) {
                    await ordersCollection.dropIndex(legacyConfirmationIndex.name);
                }
                const validConfirmationIndex = orderIndexes.find(index =>
                    index.key?.fulfillmentConfirmationId === 1
                    && index.unique
                    && index.partialFilterExpression?.fulfillmentConfirmationId?.$type === 'string'
                );
                if (!validConfirmationIndex) {
                    await ordersCollection.createIndex(
                        { fulfillmentConfirmationId: 1 },
                        {
                            unique: true,
                            partialFilterExpression: { fulfillmentConfirmationId: { $type: 'string' } },
                            name: 'fulfillmentConfirmationId_unique_string'
                        }
                    );
                }
            } catch (indexError) {
                console.warn('⚠️ Could not reconcile the split-order confirmation index:', indexError.message);
            }

            supportsTransactions = Boolean(hello.setName || hello.msg === 'isdbgrid');
            await Promise.all([
                Rider.init(),
                DeliveryAction.init(),
                RiderLedger.init(),
                PaymentSnooze.init(),
                PaymentReminder.init(),
                PaymentActionNonce.init(),
                TenantBranch.init()
            ]);
            try {
                const customersCol = mongoose.connection.db.collection('customers');
                const indexes = await customersCol.indexes();
                const badIndex = indexes.find(i => i.name === 'supabaseId_1' || (i.key && i.key.supabaseId !== undefined));
                if (badIndex && !badIndex.sparse) {
                    await customersCol.dropIndex(badIndex.name);
                    console.log('✅ Dropped legacy non-sparse supabaseId index from customers.');
                }
            } catch {}
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
export const getTransactionsSupported = () => supportsTransactions;

export default connectDB;
