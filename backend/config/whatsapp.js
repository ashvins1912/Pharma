// WhatsApp notification service abstraction & device session manager
// Provides idempotent messaging tracking, device pairing QR generation, and delivery status updates
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { getIsConnected, getTransactionsSupported } from './db.js';
import WhatsAppMessage from '../models/WhatsAppMessage.js';
import PaymentReminder from '../models/PaymentReminder.js';
import { createRiderDeliveryActionToken } from '../services/payment/SignedPaymentActionService.js';
import { buildDeliveryActionMenu, getDeliveryActionFromListReply } from '../services/delivery/DeliveryWhatsAppMenu.js';

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
        const [{ DisconnectReason, fetchLatestBaileysVersion, makeWASocket, useMultiFileAuthState }, QRCode] =
            await Promise.all([
                import('@whiskeysockets/baileys'),
                import('qrcode').then(module => module.default)
            ]);
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
        client.ev.on('messages.upsert', ({ messages = [] }) => {
            for (const incoming of messages) {
                if (incoming?.key?.fromMe) continue;
                const senderJid = String(incoming?.key?.remoteJid || '');
                // Delivery choices are private one-to-one rider actions only.
                if (!senderJid.endsWith('@s.whatsapp.net')) continue;
                const response = getDeliveryActionFromListReply(incoming);
                const action = response?.singleSelectReply?.selectedRowId;
                const messageId = response?.contextInfo?.stanzaId;
                if (!action || !messageId) continue;
                void import('../services/delivery/WhatsAppDeliverySelectionService.js')
                    .then(({ processWhatsAppDeliverySelection }) => processWhatsAppDeliverySelection({
                        messageId,
                        action,
                        senderPhone: senderJid.slice(0, -'@s.whatsapp.net'.length),
                        normalizePhone: normalizeWhatsAppNumber
                    })).then(outcome => {
                    if (outcome.processed) {
                        console.info('WhatsApp delivery action accepted', JSON.stringify({
                            messageId,
                            action,
                            orderId: outcome.result?.result?.orderId || null,
                            duplicate: outcome.result?.duplicate === true
                        }));
                    }
                }).catch(error => {
                    console.warn('WhatsApp delivery action rejected', JSON.stringify({
                        messageId,
                        action,
                        code: error.code || 'DELIVERY_ACTION_FAILED'
                    }));
                });
            }
        });

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

export const normalizeWhatsAppNumber = (phone) => {
    let digits = String(phone || '').replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 10) digits = `91${digits}`;
    return digits;
};

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

const getOrderItems = (order) => (order.items || [])
    .map(item => `• ${item.name || 'Item'} x${item.quantity || 1}`)
    .join('\n');

export const normalizeOrderStatus = (rawStatus) => {
    const s = String(rawStatus || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (['PLACED', 'ORDER_CREATED', 'SUBMITTED', 'PENDING_REVIEW', 'ORDERCREATED'].includes(s)) return 'Placed';
    if (['READY_TO_DISPATCH', 'READY_FOR_DISPATCH', 'PACKED', 'ORDERREADYFORDISPATCH'].includes(s)) return 'Ready to Dispatch';
    if (['ASSIGNED', 'RIDER_ASSIGNED', 'ORDERASSIGNED', 'ORDERREASSIGNED'].includes(s)) return 'Assigned';
    if (['DISPATCHED', 'OUT_FOR_DELIVERY', 'ORDERDISPATCHED'].includes(s)) return 'Dispatched';
    if (['DELIVERED', 'COMPLETED', 'ORDERDELIVERED'].includes(s)) return 'Delivered';
    if (['CANCELLED', 'CANCELED', 'ORDERCANCELLED'].includes(s)) return 'Cancelled';
    return rawStatus;
};

export const buildWhatsAppMessageBody = (order, status, audience, { deliveryActionLinks = [] } = {}) => {
    const normalizedStatus = normalizeOrderStatus(status);
    const orderId = order?._id?.toString() || order?.id?.toString() || 'UNKNOWN';
    const shortId = orderId.slice(-6).toUpperCase();
    const items = getOrderItems(order);

    if (audience === 'rider' && ['Assigned', 'Dispatched'].includes(normalizedStatus)) {
        const coordinates = order.coordinates || {};
        const hasCoordinates = Number.isFinite(Number(coordinates.lat))
            && Number.isFinite(Number(coordinates.lng))
            && coordinates.lat !== null && coordinates.lng !== null;
        const mapsLink = hasCoordinates
            ? `https://www.google.com/maps/search/?api=1&query=${coordinates.lat},${coordinates.lng}`
            : null;
        return [
            `🚚 ${normalizedStatus === 'Assigned' ? 'NEW DELIVERY ASSIGNED' : 'ORDER OUT FOR DELIVERY'} — Order #${shortId}`,
            `Rider: ${order.rider?.riderName || 'Assigned Rider'}`,
            `Customer: ${order.addressDetails?.fullName || order.customerName || 'Customer'}`,
            `Customer contact: ${order.customerMobile || order.addressDetails?.mobile || 'Not provided'}`,
            `Complete delivery address: ${getCompleteAddress(order)}`,
            mapsLink && `Google Maps: ${mapsLink}`,
            normalizedStatus === 'Assigned'
                ? `Assigned at: ${order.assignmentDetails?.assignedAt ? new Date(order.assignmentDetails.assignedAt).toLocaleString() : new Date().toLocaleString()}`
                : `Out for delivery at: ${order.outForDeliveryAt ? new Date(order.outForDeliveryAt).toLocaleString() : new Date().toLocaleString()}`,
            `COD amount: ₹${order.finalTotal}`,
            deliveryActionLinks.length ? `Delivery actions (confirm each action):\n${deliveryActionLinks.join('\n')}` : '',
            items && `Order items:\n${items}`
        ].filter(Boolean).join('\n');
    }

    if (audience === 'admin' && normalizedStatus === 'Placed') {
        return [
            `🛎️ NEW ORDER RECEIVED — #${shortId}`,
            `Customer: ${order.addressDetails?.fullName || order.customerName || 'Customer'}`,
            `Customer contact: ${order.customerMobile || order.addressDetails?.mobile || 'Not provided'}`,
            `Complete delivery address: ${getCompleteAddress(order)}`,
            `Total: ₹${order.finalTotal} (${order.paymentMethod || 'Cash on Delivery'})`,
            items && `Order items:\n${items}`
        ].filter(Boolean).join('\n');
    }

    if (normalizedStatus === 'Dispatched') {
        return [
            `🚚 YOUR ORDER IS OUT FOR DELIVERY — #${shortId}`,
            `Status: Out for Delivery`,
            `Rider: ${order.rider?.riderName || 'Assigned Rider'}`,
            `Rider contact: ${order.rider?.riderMobile || 'Not provided'}`,
            `Delivery address: ${getCompleteAddress(order)}`,
            `Out for delivery at: ${order.outForDeliveryAt ? new Date(order.outForDeliveryAt).toLocaleString() : new Date().toLocaleString()}`,
            `COD amount: ₹${order.finalTotal}`,
            items && `Order items:\n${items}`
        ].filter(Boolean).join('\n');
    }

    if (normalizedStatus === 'Assigned') {
        return [
            `🛵 DELIVERY RIDER ASSIGNED — #${shortId}`,
            `Rider: ${order.rider?.riderName || 'Assigned Rider'}`,
            `Rider contact: ${order.rider?.riderMobile || 'Not provided'}`,
            'Your order is packed and waiting for dispatch.',
            `Complete delivery address: ${getCompleteAddress(order)}`
        ].join('\n');
    }

    switch (normalizedStatus) {
        case 'Placed':
            return [
                `🎉 ORDER PLACED SUCCESSFULLY — #${shortId}`,
                `Status: ${order.orderStatus || 'Processing Order'}`,
                `Customer: ${order.addressDetails?.fullName || order.customerName || 'Customer'}`,
                `Delivery address: ${getCompleteAddress(order)}`,
                `Total: ₹${order.finalTotal} (${order.paymentMethod || 'Cash on Delivery'})`,
                items && `Order items:\n${items}`,
                'We will send you updates as your order progresses.'
            ].filter(Boolean).join('\n');
        case 'Ready to Dispatch':
            return `🔬 ORDER UPDATE — #${shortId}\nStatus: Ready to Dispatch\nYour order is packed and awaiting a delivery rider.\nTotal: ₹${order.finalTotal}\n${items ? `Order items:\n${items}` : ''}`;
        case 'Delivered':
            return [
                `🏁 ORDER DELIVERED — #${shortId}`,
                `Delivered at: ${order.deliveredAt ? new Date(order.deliveredAt).toLocaleString() : new Date().toLocaleString()}`,
                `Order items:\n${items || 'Items not available'}`,
                `Total: ₹${order.finalTotal}`,
                'Thank you for choosing Ashvin Pharmacy! We appreciate your trust.',
                'Please visit us again for your healthcare needs. 💚'
            ].join('\n');
        default:
            return `ℹ️ Order #${shortId} status update: ${normalizedStatus || status}`;
    }
};

export const buildWhatsAppMedicineRequestBody = (request, eventType) => {
    const reqNum = request?.requestNumber || 'MR-REQ';
    const items = (request?.requestedItems || [])
        .map(i => `${i.requestedName || 'Medicine'}${i.strength ? ' ' + i.strength : ''} (x${i.quantity || 1})`)
        .join(', ') || 'Requested Medicine';
    const proposal = request?.pharmacyProposal;

    switch (eventType) {
        case 'MedicineRequestCreated':
        case 'NEW_REQUEST':
            return [
                `📋 NEW MEDICINE REQUEST RECEIVED — #${reqNum}`,
                `Customer: ${request?.customerName || 'Valued Customer'}`,
                `Requested: ${items}`,
                `Delivery Preference: ${request?.preferredDeliveryPreference || 'Flexible'}`,
                'Your medicine request has been received by Ashvin Pharmacy. Our pharmacy team will review it and update you with a proposal shortly.'
            ].join('\n');

        case 'MedicineProposalReady':
        case 'PROPOSAL_SENT': {
            const priceLabel = proposal?.priceType === 'APPROXIMATE' ? 'Approximate Price' : 'Final Price';
            const priceVal = proposal?.finalPrice ?? proposal?.totalPrice ?? proposal?.approximatePrice ?? 0;
            const slotLabel = proposal?.deliverySlot?.label
                || `${proposal?.deliverySlot?.slotType || 'Flexible'} (${proposal?.deliverySlot?.date || 'Available date'})`;
            return [
                `💊 PHARMACY PROPOSAL READY — #${reqNum}`,
                `Medicine: ${proposal?.proposedMedicineName || proposal?.medicineName || items}`,
                `Quantity: ${proposal?.proposedQuantity || proposal?.quantity || 1}`,
                `${priceLabel}: ₹${priceVal}`,
                `Proposed Delivery: ${slotLabel}`,
                proposal?.pharmacyNote || proposal?.pharmacyNotes ? `Pharmacy Note: ${proposal.pharmacyNote || proposal.pharmacyNotes}` : '',
                'Please sign in to your Ashvin Pharmacy account to review and approve your proposal.'
            ].filter(Boolean).join('\n');
        }

        case 'MedicineRequestApproved':
        case 'CUSTOMER_APPROVED':
            return [
                `🎉 PROPOSAL APPROVED & ORDER CREATED — #${reqNum}`,
                `Medicine: ${proposal?.proposedMedicineName || proposal?.medicineName || items}`,
                'Your proposal has been approved and converted to an active pharmacy order for fulfillment! Thank you for choosing Ashvin Pharmacy.'
            ].join('\n');

        case 'MedicineRequestRejected':
        case 'CUSTOMER_REJECTED':
        case 'PHARMACY_REJECTED':
            return [
                `ℹ️ MEDICINE REQUEST UPDATE — #${reqNum}`,
                `Medicine: ${items}`,
                'This medicine request/proposal was declined. If you still require this medication, please submit a new request or contact Ashvin Pharmacy support.'
            ].join('\n');

        case 'MedicineProposalExpired':
        case 'EXPIRED':
            return [
                `⏳ PROPOSAL EXPIRED — #${reqNum}`,
                `Medicine: ${items}`,
                'The proposal for your medicine request has expired. Please submit a new request if you still need this medication.'
            ].join('\n');

        default:
            return `ℹ️ Medicine request #${reqNum} update: ${eventType}`;
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
    const updateReminder = async () => {
        if (record.eventType !== 'PaymentReminder' || !String(record.orderId).startsWith('PAYMENT:') || !getIsConnected()) return;
        const reminderId = String(record.orderId).slice('PAYMENT:'.length);
        if (!/^[a-f\d]{24}$/i.test(reminderId)) return;
        const status = record.status === 'SENT' ? 'SENT'
            : record.status === 'QUEUED_OFFLINE' ? 'QUEUED_OFFLINE'
                : record.status === 'FAILED' || record.status === 'MISSING_RECIPIENT' ? 'FAILED' : 'SENDING';
        await PaymentReminder.updateOne({ _id: reminderId }, { $set: {
            status,
            providerMessageId: record.messageId || null,
            sentAt: status === 'SENT' ? record.sentAt || new Date() : null,
            failureReason: record.error || (status === 'FAILED' ? 'WhatsApp recipient is unavailable.' : null)
        } });
    };
    const number = normalizeWhatsAppNumber(record.recipient);
    if (number.length < 8) {
        await updateNotification(record, mongoRecord, { status: 'MISSING_RECIPIENT' });
        await updateReminder();
        return record;
    }
    if (!whatsappState.isConnected || !socket) {
        await updateNotification(record, mongoRecord, { status: 'QUEUED_OFFLINE' });
        await updateReminder();
        return record;
    }

    try {
        let result;
        if (record.deliveryMenu) {
            try {
                const { generateWAMessageFromContent, proto } = await import('@whiskeysockets/baileys');
                const jid = `${number}@s.whatsapp.net`;
                const message = generateWAMessageFromContent(
                    jid,
                    proto.Message.fromObject({ listMessage: record.deliveryMenu }),
                    { userJid: socket.user?.id }
                );
                const providerMessageId = await socket.relayMessage(jid, message.message, { messageId: message.key.id });
                result = { key: { id: providerMessageId || message.key.id } };
            } catch (menuError) {
                // Preserve the established signed-link delivery path if this
                // WhatsApp client/provider rejects an interactive list.
                console.warn('Interactive WhatsApp delivery menu unavailable; sending signed action links.', {
                    orderId: record.orderId,
                    errorName: menuError?.name || 'Error'
                });
                result = await socket.sendMessage(`${number}@s.whatsapp.net`, { text: record.messageBody });
            }
        } else {
            result = await socket.sendMessage(`${number}@s.whatsapp.net`, { text: record.messageBody });
        }
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
    await updateReminder();
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
            if (record.eventType === 'Delivered' && record.status === 'SENT') {
                await clearOrderNotifications(record.orderId);
            }
        }
        return;
    }

    for (const record of sentNotifications.values()) {
        if (record.status === 'QUEUED_OFFLINE' && new Date(record.expiresAt) > new Date()) {
            await transmitWhatsAppMessage(record, null);
            if (record.eventType === 'Delivered' && record.status === 'SENT') {
                await clearOrderNotifications(record.orderId);
            }
        }
    }
};

const createDeliveryActionLinks = (order) => {
    if (process.env.WHATSAPP_DELIVERY_TRACKING_ENABLED !== 'true'
        || process.env.MONGO_TRANSACTIONS_CONFIRMED !== 'true'
        || !getTransactionsSupported()) return [];
    const baseUrl = process.env.DELIVERY_ACTION_BASE_URL;
    const orderId = order?._id?.toString() || order?.id?.toString();
    const riderId = order?.rider?.riderId;
    if (!baseUrl || !orderId || !riderId) return [];
    const actions = [
        ['cash_received', 'Cash received'],
        ['payment_pending', 'Payment pending'],
        ['not_reachable', 'Customer not reachable']
    ];
    try {
        return actions.map(([action, label]) => {
            const token = createRiderDeliveryActionToken({ orderId, riderId: String(riderId), action });
            const url = new URL(baseUrl);
            if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
                throw new Error('Delivery action links must use HTTPS in production.');
            }
            url.searchParams.set('token', token);
            return `${label}: ${url.toString()}`;
        });
    } catch (error) {
        console.error('Rider action links are not configured:', { code: error.code || 'INVALID_ACTION_LINK_CONFIG' });
        return [];
    }
};

const createDeliveryActionMenu = order => {
    if (process.env.WHATSAPP_DELIVERY_TRACKING_ENABLED !== 'true'
        || process.env.MONGO_TRANSACTIONS_CONFIRMED !== 'true'
        || !getTransactionsSupported()) return null;
    const orderId = order?._id?.toString() || order?.id?.toString();
    const riderId = order?.rider?.riderId;
    if (!orderId || !riderId || !order?.rider?.riderMobile) return null;
    return buildDeliveryActionMenu(order);
};

const clearOrderNotifications = async (orderId) => {
    if (getIsConnected()) await WhatsAppMessage.deleteMany({ orderId: String(orderId) });
    for (const [key, notification] of sentNotifications.entries()) {
        if (notification.orderId === String(orderId)) sentNotifications.delete(key);
    }
};

export const sendCustomWhatsAppAlert = async (order, statusUpdateText, deliveryMobile = null) => {
    const normalizedStatus = normalizeOrderStatus(statusUpdateText);
    const orderId = order?._id?.toString() || order?.id?.toString() || 'UNKNOWN';
    const customerPhone = order.customerMobile || order.addressDetails?.mobile || '';
    const riderPhone = deliveryMobile || order.rider?.riderMobile || '';
    const recipients = normalizedStatus === 'Assigned'
        ? [
            { audience: 'customer', phone: customerPhone },
            ...(riderPhone ? [{ audience: 'rider', phone: riderPhone }] : [])
        ]
        : [
            { audience: 'customer', phone: customerPhone },
            ...(normalizedStatus === 'Dispatched' && riderPhone
                ? [{ audience: 'rider', phone: riderPhone }]
                : []),
            ...(normalizedStatus === 'Placed' && whatsappState.isConnected && whatsappState.phone
                ? [{ audience: 'admin', phone: whatsappState.phone }]
                : [])
        ];
    const records = [];

    for (const { audience, phone } of recipients) {
        const recipient = normalizeWhatsAppNumber(phone);
        const dedupeKey = `${orderId}:${normalizedStatus}:${audience}:${recipient || 'missing'}`;
        if (sentNotifications.has(dedupeKey)) {
            records.push(sentNotifications.get(dedupeKey));
            continue;
        }

        if (getIsConnected()) {
            const existing = await WhatsAppMessage.findOne({
                dedupeKey,
                expiresAt: { $gt: new Date() }
            });
            if (existing) {
                const record = existing.toObject();
                sentNotifications.set(dedupeKey, record);
                records.push(record);
                continue;
            }
        }

        const createdAt = new Date();
        const record = {
            orderId,
            eventType: normalizedStatus,
            recipient: recipient || 'Not provided',
            dedupeKey,
            messageBody: buildWhatsAppMessageBody(order, normalizedStatus, audience, {
                deliveryActionLinks: audience === 'rider' && normalizedStatus === 'Dispatched'
                    ? createDeliveryActionLinks(order)
                    : []
            }),
            deliveryMenu: audience === 'rider' && normalizedStatus === 'Dispatched'
                ? createDeliveryActionMenu(order)
                : null,
            status: 'PENDING',
            channel: 'WHATSAPP',
            sentAt: null,
            attempts: 1,
            messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            createdAt,
            expiresAt: new Date(createdAt.getTime() + messageRetentionMs)
        };

        const mongoRecord = getIsConnected() ? await WhatsAppMessage.create(record) : null;
        sentNotifications.set(dedupeKey, record);
        records.push(record);
        await transmitWhatsAppMessage(record, mongoRecord);

        if (normalizedStatus === 'Delivered') {
            if (record.status === 'SENT' || record.status === 'MISSING_RECIPIENT') {
                await clearOrderNotifications(orderId);
            } else if (getIsConnected()) {
                await WhatsAppMessage.deleteMany({ orderId, _id: { $ne: mongoRecord?._id } });
            } else {
                for (const [key, notification] of sentNotifications.entries()) {
                    if (notification.orderId === orderId && notification.eventType !== 'Delivered') {
                        sentNotifications.delete(key);
                    }
                }
            }
        }
    }

    return records;
};

// Stateless direct-message entry point for domain notifications such as payment reminders.
// Provider/session state remains owned by this existing WhatsApp adapter.
export const sendWhatsAppDirectMessage = async ({ recipient, message, dedupeKey, referenceId }) => {
    const normalizedRecipient = normalizeWhatsAppNumber(recipient);
    if (normalizedRecipient.length < 8) {
        return { status: 'FAILED', error: 'Recipient phone number is invalid.' };
    }
    if (typeof message !== 'string' || !message.trim() || typeof dedupeKey !== 'string' || !dedupeKey) {
        return { status: 'FAILED', error: 'Message and idempotency key are required.' };
    }
    if (getIsConnected()) {
        const existing = await WhatsAppMessage.findOne({ dedupeKey, expiresAt: { $gt: new Date() } });
        if (existing) return {
            status: existing.status,
            providerMessageId: existing.messageId,
            error: existing.error || null
        };
    }
    const createdAt = new Date();
    const record = {
        orderId: String(referenceId || 'PAYMENT_REMINDER'),
        eventType: 'PaymentReminder',
        recipient: normalizedRecipient,
        dedupeKey,
        messageBody: message,
        status: 'PENDING',
        channel: 'WHATSAPP',
        sentAt: null,
        attempts: 1,
        messageId: `msg-${createdAt.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + messageRetentionMs)
    };
    let mongoRecord = null;
    if (getIsConnected()) {
        try {
            mongoRecord = await WhatsAppMessage.create(record);
        } catch (error) {
            if (error.code === 11000) {
                const existing = await WhatsAppMessage.findOne({ dedupeKey }).lean();
                if (existing) return { status: existing.status, providerMessageId: existing.messageId, error: existing.error || null };
            }
            throw error;
        }
    }
    await transmitWhatsAppMessage(record, mongoRecord);
    return { status: record.status, providerMessageId: record.messageId, error: record.error || null };
};

export const sendWhatsAppMedicineRequestAlert = async (request, eventType) => {
    const requestId = request?._id?.toString() || request?.id?.toString() || 'UNKNOWN';
    const customerPhone = request?.customerPhone || '';
    const recipients = [
        { audience: 'customer', phone: customerPhone },
        ...(eventType === 'MedicineRequestCreated' && whatsappState.isConnected && whatsappState.phone
            ? [{ audience: 'admin', phone: whatsappState.phone }]
            : [])
    ];
    const records = [];

    for (const { audience, phone } of recipients) {
        const recipient = normalizeWhatsAppNumber(phone);
        const dedupeKey = `MR:${requestId}:${eventType}:${audience}:${recipient || 'missing'}`;
        if (sentNotifications.has(dedupeKey)) {
            records.push(sentNotifications.get(dedupeKey));
            continue;
        }

        if (getIsConnected()) {
            const existing = await WhatsAppMessage.findOne({
                dedupeKey,
                expiresAt: { $gt: new Date() }
            });
            if (existing) {
                const record = existing.toObject();
                sentNotifications.set(dedupeKey, record);
                records.push(record);
                continue;
            }
        }

        const createdAt = new Date();
        const record = {
            orderId: `MR-${requestId}`,
            eventType,
            recipient: recipient || 'Not provided',
            dedupeKey,
            messageBody: buildWhatsAppMedicineRequestBody(request, eventType),
            status: 'PENDING',
            channel: 'WHATSAPP',
            sentAt: null,
            attempts: 1,
            messageId: `msg-mr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            createdAt,
            expiresAt: new Date(createdAt.getTime() + messageRetentionMs)
        };

        const mongoRecord = getIsConnected() ? await WhatsAppMessage.create(record) : null;
        sentNotifications.set(dedupeKey, record);
        records.push(record);
        await transmitWhatsAppMessage(record, mongoRecord);
    }

    return records;
};

export const getNotificationLog = async () => {
    if (getIsConnected()) {
        return WhatsAppMessage.find({ expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).lean();
    }
    return Array.from(sentNotifications.values())
        .filter(notification => new Date(notification.expiresAt) > new Date());
};
