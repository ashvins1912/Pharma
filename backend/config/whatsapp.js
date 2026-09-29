// WhatsApp notification service abstraction & device session manager
// Provides idempotent messaging tracking, device pairing QR generation, and delivery status updates
import path from 'node:path';
import { rm } from 'node:fs/promises';
import QRCode from 'qrcode';
import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState
} from '@whiskeysockets/baileys';

const sentNotifications = new Map();
const authDirectory = process.env.WHATSAPP_AUTH_DIR || path.resolve('data/whatsapp-auth');
const qrLifetimeMs = 20_000;

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

export const sendCustomWhatsAppAlert = async (order, statusUpdateText, deliveryMobile = null) => {
    try {
        const orderId = order?._id ? order._id.toString() : 'UNKNOWN';
        const eventKey = `${orderId}:${statusUpdateText}`;

        // Idempotency check: prevent duplicate notifications
        if (sentNotifications.has(eventKey)) {
            console.log(`[Messaging Provider] Skipping duplicate alert for ${eventKey}`);
            return sentNotifications.get(eventKey);
        }

        const shortId = orderId.slice(-6);
        let messageBody = "";

        switch (statusUpdateText) {
            case 'Placed':
                messageBody = `🎉 ORDER PLACED SUCCESSFULLY!\nOrder #${shortId}\nTotal: ₹${order.finalTotal}\nStatus: Processing COD Delivery`;
                break;
            case 'Ready to Dispatch':
                messageBody = `🔬 ORDER VERIFIED & SECURED\nOrder #${shortId} has been verified by the pharmacist and is Ready to Dispatch!`;
                break;
            case 'Dispatched':
                messageBody = `🚚 OUT FOR DELIVERY!\nOrder #${shortId} is on its way with courier ${deliveryMobile || 'Assigned Rider'}.\nCOD Amount: ₹${order.finalTotal}`;
                break;
            case 'Delivered':
                messageBody = `🏁 ORDER SAFELY DELIVERED\nThank you for choosing Ashvin Pharmacy! Order #${shortId} has been delivered and payment collected.`;
                break;
            default:
                messageBody = `ℹ️ Order #${shortId} status update: ${statusUpdateText}`;
        }

        const notificationRecord = {
            orderId,
            eventType: statusUpdateText,
            recipient: deliveryMobile || order.customerMobile || "Customer",
            messageBody,
            status: whatsappState.isConnected ? "SENT" : "QUEUED_OFFLINE",
            channel: "WHATSAPP",
            sentAt: new Date().toISOString(),
            attempts: 1,
            messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        };

        sentNotifications.set(eventKey, notificationRecord);
        console.log(`[Messaging Provider] Dispatched ${statusUpdateText} notification for Order #${shortId} (WhatsApp ${whatsappState.isConnected ? 'Connected' : 'DISCONNECTED - queued'})`);
        return notificationRecord;
    } catch (err) {
        console.error("Messaging Provider delivery issue:", err.message);
        return null;
    }
};

export const getNotificationLog = () => Array.from(sentNotifications.values());
