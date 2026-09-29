// WhatsApp notification service abstraction & device session manager
// Provides idempotent messaging tracking, device pairing QR generation, and delivery status updates
import path from 'node:path';
import { rm } from 'node:fs/promises';
import QRCode from 'qrcode';
import { getIsConnected } from './db.js';
import WhatsAppMessage from '../models/WhatsAppMessage.js';
import {
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeWASocket,
    useMultiFileAuthState
} from '@whiskeysockets/baileys';

const sentNotifications = new Map();
const authDirectory = process.env.WHATSAPP_AUTH_DIR || path.resolve('data/whatsapp-auth');
const qrLifetimeMs = 20_000;
const messageRetentionMs = 24 * 60 * 60 * 1000;

let whatsappState = {
    isConnected: false,
    phone: null,
    deviceName: null,
    lastConnectedAt: null,
    qrCode: null,
    expiresAt: null
};

let socket = null;
let sessionGeneration = 0;
let sessionPromise = null;

export const getWhatsAppStatus = () => {
    return {
        isConnected: whatsappState.isConnected,
        phone: whatsappState.phone,
        deviceName: whatsappState.deviceName,
        lastConnectedAt: whatsappState.lastConnectedAt,
        qrCode: whatsappState.qrCode,
        expiresAt: whatsappState.expiresAt
    };
};

const startWhatsAppSession = async (forceRefresh = false) => {
    if (whatsappState.isConnected && !forceRefresh) return getWhatsAppStatus();
    if (!forceRefresh && whatsappState.qrCode && new Date(whatsappState.expiresAt).getTime() > Date.now()) {
        return getWhatsAppStatus();
    }
    if (!forceRefresh && sessionPromise) return sessionPromise;

    const previousSocket = socket;
    const generation = ++sessionGeneration;
    socket = null;
    sessionPromise = null;
    previousSocket?.end(new Error('WhatsApp QR session replaced'));

    whatsappState = {
        ...whatsappState,
        isConnected: false,
        qrCode: null,
        expiresAt: null
    };

    const pendingSession = (async () => {
        const { state, saveCreds } = await useMultiFileAuthState(authDirectory);
        if (generation !== sessionGeneration) return getWhatsAppStatus();

        const { version } = await fetchLatestBaileysVersion({ timeout: 5000 });
        if (generation !== sessionGeneration) return getWhatsAppStatus();

        const client = makeWASocket({
            auth: state,
            version,
            printQRInTerminal: false
        });
        socket = client;
        client.ev.on('creds.update', saveCreds);

        return new Promise((resolve, reject) => {
            let settled = false;
            let qrUpdateSequence = 0;
            const timeout = setTimeout(() => {
                if (generation !== sessionGeneration) return;
                client.end(new Error('Timed out waiting for WhatsApp QR code'));
                reject(new Error('Timed out waiting for WhatsApp QR code'));
            }, 40_000);

            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                callback(value);
            };

            client.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
                if (generation !== sessionGeneration) return;

                if (qr) {
                    const currentQrUpdate = ++qrUpdateSequence;
                    try {
                        const qrCode = await QRCode.toDataURL(qr, {
                            errorCorrectionLevel: 'M',
                            margin: 2,
                            width: 280
                        });
                        if (generation !== sessionGeneration || currentQrUpdate !== qrUpdateSequence) return;
                        whatsappState = {
                            ...whatsappState,
                            isConnected: false,
                            qrCode,
                            expiresAt: new Date(Date.now() + qrLifetimeMs)
                        };
                        finish(resolve, getWhatsAppStatus());
                    } catch (error) {
                        finish(reject, error);
                    }
                }

                if (connection === 'open') {
                    whatsappState = {
                        ...whatsappState,
                        isConnected: true,
                        phone: client.user?.id?.split('@')[0]?.split(':')[0] || null,
                        deviceName: 'WhatsApp Linked Device',
                        lastConnectedAt: new Date().toISOString(),
                        qrCode: null,
                        expiresAt: null
                    };
                    flushQueuedNotifications().catch(error => {
                        console.error('Failed to flush queued WhatsApp notifications:', error);
                    });
                    finish(resolve, getWhatsAppStatus());
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    socket = null;
                    whatsappState = {
                        ...whatsappState,
                        isConnected: false,
                        qrCode: null,
                        expiresAt: null
                    };
                    if (statusCode === DisconnectReason.loggedOut) {
                        await rm(authDirectory, { recursive: true, force: true });
                    }
                    finish(reject, new Error(`WhatsApp connection closed (${statusCode ?? 'unknown reason'})`));
                }
            });
        });
    })();

    sessionPromise = pendingSession;
    try {
        return await pendingSession;
    } finally {
        if (generation === sessionGeneration) sessionPromise = null;
    }
};

export const generateWhatsAppQR = async () => startWhatsAppSession(true);

export const ensureWhatsAppSession = async () => {
    if (whatsappState.isConnected) return getWhatsAppStatus();
    if (whatsappState.qrCode && new Date(whatsappState.expiresAt).getTime() > Date.now()) {
        return getWhatsAppStatus();
    }
    return startWhatsAppSession();
};

export const disconnectWhatsApp = async () => {
    const currentSocket = socket;
    sessionGeneration += 1;
    socket = null;
    sessionPromise = null;
    if (currentSocket) await currentSocket.logout();
    await rm(authDirectory, { recursive: true, force: true });
    whatsappState = {
        isConnected: false,
        phone: null,
        deviceName: null,
        lastConnectedAt: null,
        qrCode: null,
        expiresAt: null
    };

    return getWhatsAppStatus();
};

const normalizeWhatsAppNumber = (phone) => String(phone || '').replace(/\D/g, '');

const getCompleteAddress = (order) => {
    const details = order.addressDetails || {};
    const streetAddress = [
        details.addressLine1,
        details.addressLine2,
        details.landmark
    ].filter(part => String(part || '').trim());
    const locality = [
        details.city,
        details.state,
        details.pincode
    ].filter(part => String(part || '').trim());
    if (streetAddress.length) return [...streetAddress, ...locality].join(', ');
    return order.deliveryAddress || locality.join(', ') || 'Address not provided';
};

const buildMessageBody = (order, status, recipientPhone) => {
    const orderId = order?._id?.toString() || 'UNKNOWN';
    const shortId = orderId.slice(-6).toUpperCase();

    if (status === 'Dispatched') {
        const coordinates = order.coordinates || {};
        const hasCoordinates = Number.isFinite(Number(coordinates.lat))
            && Number.isFinite(Number(coordinates.lng))
            && coordinates.lat !== null && coordinates.lng !== null;
        const mapsLink = hasCoordinates
            ? `https://www.google.com/maps/search/?api=1&query=${coordinates.lat},${coordinates.lng}`
            : null;
        const items = (order.items || []).map(item => `• ${item.name || 'Item'} x${item.quantity || 1}`).join('\n');
        const outForDeliveryAt = order.outForDeliveryAt
            ? new Date(order.outForDeliveryAt).toLocaleString()
            : new Date().toLocaleString();
        return [
            `🚚 ORDER OUT FOR DELIVERY — #${shortId}`,
            `Rider: ${order.rider?.riderName || 'Assigned Rider'}`,
            `Rider contact: ${recipientPhone || 'Not provided'}`,
            `Customer: ${order.addressDetails?.fullName || order.customerName || 'Customer'}`,
            `Customer contact: ${order.customerMobile || order.addressDetails?.mobile || 'Not provided'}`,
            `Complete delivery address: ${getCompleteAddress(order)}`,
            mapsLink && `Google Maps: ${mapsLink}`,
            `Out for delivery at: ${outForDeliveryAt}`,
            `COD amount: ₹${order.finalTotal}`,
            items && `Order items:\n${items}`
        ].filter(Boolean).join('\n');
    }

    switch (status) {
        case 'Placed':
            return `🎉 ORDER PLACED SUCCESSFULLY!\nOrder #${shortId}\nTotal: ₹${order.finalTotal}\nStatus: Processing COD Delivery`;
        case 'Ready to Dispatch':
            return `🔬 ORDER VERIFIED & SECURED\nOrder #${shortId} has been verified by the pharmacist and is Ready to Dispatch!`;
        case 'Delivered':
            return `🏁 ORDER SAFELY DELIVERED\nThank you for choosing Ashvin Pharmacy! Order #${shortId} was delivered at ${order.deliveredAt ? new Date(order.deliveredAt).toLocaleString() : new Date().toLocaleString()}.`;
        default:
            return `ℹ️ Order #${shortId} status update: ${status}`;
    }
};

const updateNotification = async (record, mongoRecord, updates) => {
    Object.assign(record, updates);
    if (mongoRecord) {
        Object.assign(mongoRecord, updates);
        await mongoRecord.save();
    }
};

const transmitWhatsAppMessage = async (record, mongoRecord) => {
    const number = normalizeWhatsAppNumber(record.recipient);
    if (number.length < 8) {
        await updateNotification(record, mongoRecord, { status: 'MISSING_RECIPIENT' });
        return record;
    }
    if (!whatsappState.isConnected || !socket) {
        await updateNotification(record, mongoRecord, { status: 'QUEUED_OFFLINE' });
        return record;
    }

    try {
        const result = await socket.sendMessage(`${number}@s.whatsapp.net`, { text: record.messageBody });
        await updateNotification(record, mongoRecord, {
            status: 'SENT',
            sentAt: new Date(),
            messageId: result?.key?.id || record.messageId
        });
    } catch (error) {
        console.error(`WhatsApp send failed for order ${record.orderId}:`, error);
        await updateNotification(record, mongoRecord, {
            status: 'FAILED',
            error: error.message || 'WhatsApp send failed'
        });
    }
    return record;
};

const flushQueuedNotifications = async () => {
    if (!whatsappState.isConnected || !socket) return;

    if (getIsConnected()) {
        const queued = await WhatsAppMessage.find({
            status: 'QUEUED_OFFLINE',
            expiresAt: { $gt: new Date() }
        });
        for (const mongoRecord of queued) {
            const record = mongoRecord.toObject();
            sentNotifications.set(record.dedupeKey, record);
            await transmitWhatsAppMessage(record, mongoRecord);
        }
        return;
    }

    for (const record of sentNotifications.values()) {
        if (record.status === 'QUEUED_OFFLINE' && new Date(record.expiresAt) > new Date()) {
            await transmitWhatsAppMessage(record, null);
        }
    }
};

export const sendCustomWhatsAppAlert = async (order, statusUpdateText, deliveryMobile = null) => {
    const orderId = order?._id ? order._id.toString() : 'UNKNOWN';
    const recipient = statusUpdateText === 'Dispatched'
        ? deliveryMobile || order.rider?.riderMobile || ''
        : order.customerMobile || order.addressDetails?.mobile || '';
    const dedupeKey = `${orderId}:${statusUpdateText}:${normalizeWhatsAppNumber(recipient) || 'missing'}`;

    if (sentNotifications.has(dedupeKey)) return sentNotifications.get(dedupeKey);

    if (getIsConnected()) {
        const existing = await WhatsAppMessage.findOne({
            dedupeKey,
            expiresAt: { $gt: new Date() }
        });
        if (existing) {
            const record = existing.toObject();
            sentNotifications.set(dedupeKey, record);
            return record;
        }
    }

    const createdAt = new Date();
    const record = {
        orderId,
        eventType: statusUpdateText,
        recipient: recipient || 'Not provided',
        dedupeKey,
        messageBody: buildMessageBody(order, statusUpdateText, recipient),
        status: 'PENDING',
        channel: 'WHATSAPP',
        sentAt: null,
        attempts: 1,
        messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + messageRetentionMs)
    };

    let mongoRecord = null;
    if (getIsConnected()) {
        mongoRecord = await WhatsAppMessage.create(record);
    }
    sentNotifications.set(dedupeKey, record);

    if (statusUpdateText === 'Delivered') {
        try {
            await transmitWhatsAppMessage(record, mongoRecord);
        } finally {
            if (getIsConnected()) await WhatsAppMessage.deleteMany({ orderId });
            for (const [key, notification] of sentNotifications.entries()) {
                if (notification.orderId === orderId) sentNotifications.delete(key);
            }
        }
        return record;
    }

    await transmitWhatsAppMessage(record, mongoRecord);
    return record;
};

export const getNotificationLog = async () => {
    if (getIsConnected()) {
        return WhatsAppMessage.find({ expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).lean();
    }
    return Array.from(sentNotifications.values())
        .filter(notification => new Date(notification.expiresAt) > new Date());
};
