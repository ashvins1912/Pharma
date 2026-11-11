// WhatsApp notification service abstraction & device session manager
// Provides idempotent messaging tracking, device pairing QR generation, and delivery status updates
import path from 'node:path';
import { randomInt, scryptSync } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { getIsConnected, getTransactionsSupported } from './db.js';
import { cacheService } from '../services/cache/CacheService.js';
import WhatsAppMessage from '../models/WhatsAppMessage.js';
import PaymentReminder from '../models/PaymentReminder.js';
import Order from '../models/Order.js';
import Tenant from '../models/Tenant.js';
import Vendor from '../models/Vendor.js';
import UserProfile from '../models/UserProfile.js';
import User from '../models/User.js';
import { createRiderDeliveryActionToken } from '../services/payment/SignedPaymentActionService.js';
import { buildDeliveryActionMenu, getDeliveryActionFromListReply } from '../services/delivery/DeliveryWhatsAppMenu.js';

const sentNotifications = new Map();

const resolveNotificationLanguage = async (userId) => {
    if (!userId || !getIsConnected()) return 'en';
    try {
        const identity = { $or: [{ userId: String(userId) }, { supabase_user_id: String(userId) }, { supabaseId: String(userId) }] };
        const [profile, user] = await Promise.all([
            UserProfile.findOne(identity).select('preferredLanguage').lean(),
            User.findOne(identity).select('preferredLanguage').lean()
        ]);
        const language = profile?.preferredLanguage || user?.preferredLanguage;
        return ['en', 'hi', 'kn', 'bn', 'te'].includes(language) ? language : 'en';
    } catch {
        return 'en';
    }
};

const localizedWhatsApp = {
    hi: {
        placed: '🎉 आपका QuickMeds Rx ऑर्डर सफलतापूर्वक दर्ज हुआ',
        status: 'स्थिति', customer: 'ग्राहक', address: 'डिलीवरी पता', total: 'कुल राशि', items: 'ऑर्डर की दवाएँ',
        updates: 'ऑर्डर आगे बढ़ने पर हम आपको अपडेट भेजेंगे।', ready: 'ऑर्डर पैक है और डिलीवरी राइडर की प्रतीक्षा में है।',
        dispatched: '🚚 आपका ऑर्डर डिलीवरी के लिए निकल गया', rider: 'डिलीवरी राइडर', riderPhone: 'राइडर का संपर्क',
        delivered: '🏁 ऑर्डर सफलतापूर्वक डिलीवर हुआ', thankYou: 'QuickMeds Rx चुनने के लिए धन्यवाद। स्वस्थ रहें! 💚',
        assigned: '🛵 आपके ऑर्डर के लिए डिलीवरी राइडर नियुक्त किया गया', otp: '🔐 4 अंकों का सत्यापन कोड',
        otpRule: 'यह कोड डिलीवरी के समय राइडर को ही बताएँ। राइडर आने से पहले साझा न करें।',
        at: 'डिलीवरी के लिए निकला समय', deliveredAt: 'डिलीवरी का समय', notAvailable: 'उपलब्ध नहीं',
        placedTitle: 'ऑर्डर नंबर', itemsUnavailable: 'आइटम उपलब्ध नहीं'
    },
    kn: {
        placed: '🎉 ನಿಮ್ಮ QuickMeds Rx ಆರ್ಡರ್ ಯಶಸ್ವಿಯಾಗಿ ಸ್ವೀಕರಿಸಲಾಗಿದೆ',
        status: 'ಸ್ಥಿತಿ', customer: 'ಗ್ರಾಹಕರು', address: 'ವಿತರಣಾ ವಿಳಾಸ', total: 'ಒಟ್ಟು ಮೊತ್ತ', items: 'ಆರ್ಡರ್ ಔಷಧಿಗಳು',
        updates: 'ನಿಮ್ಮ ಆರ್ಡರ್ ಮುಂದುವರಿದಂತೆ ನಾವು ಅಪ್‌ಡೇಟ್‌ಗಳನ್ನು ಕಳುಹಿಸುತ್ತೇವೆ.', ready: 'ಆರ್ಡರ್ ಪ್ಯಾಕ್ ಆಗಿದೆ ಮತ್ತು ಡೆಲಿವರಿ ರೈಡರ್‌ಗಾಗಿ ಕಾಯುತ್ತಿದೆ.',
        dispatched: '🚚 ನಿಮ್ಮ ಆರ್ಡರ್ ವಿತರಣೆಗೆ ಹೊರಟಿದೆ', rider: 'ಡೆಲಿವರಿ ರೈಡರ್', riderPhone: 'ರೈಡರ್ ಸಂಪರ್ಕ',
        delivered: '🏁 ಆರ್ಡರ್ ಯಶಸ್ವಿಯಾಗಿ ವಿತರಿಸಲಾಗಿದೆ', thankYou: 'QuickMeds Rx ಆಯ್ಕೆ ಮಾಡಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು. ಆರೋಗ್ಯವಾಗಿರಿ! 💚',
        assigned: '🛵 ನಿಮ್ಮ ಆರ್ಡರ್‌ಗೆ ಡೆಲಿವರಿ ರೈಡರ್ ನಿಯೋಜಿಸಲಾಗಿದೆ', otp: '🔐 4 ಅಂಕಿಯ ದೃಢೀಕರಣ ಕೋಡ್',
        otpRule: 'ವಿತರಣೆಯ ಸಮಯದಲ್ಲಿ ಮಾತ್ರ ಈ ಕೋಡ್ ಅನ್ನು ರೈಡರ್‌ಗೆ ತಿಳಿಸಿ. ರೈಡರ್ ಬರುವ ಮೊದಲು ಹಂಚಿಕೊಳ್ಳಬೇಡಿ.',
        at: 'ವಿತರಣೆಗೆ ಹೊರಟ ಸಮಯ', deliveredAt: 'ವಿತರಿಸಿದ ಸಮಯ', notAvailable: 'ಲಭ್ಯವಿಲ್ಲ',
        placedTitle: 'ಆರ್ಡರ್ ಸಂಖ್ಯೆ', itemsUnavailable: 'ಐಟಂಗಳು ಲಭ್ಯವಿಲ್ಲ'
    },
    bn: {
        placed: '🎉 আপনার QuickMeds Rx অর্ডার সফলভাবে গ্রহণ করা হয়েছে',
        status: 'অবস্থা', customer: 'গ্রাহক', address: 'ডেলিভারির ঠিকানা', total: 'মোট পরিমাণ', items: 'অর্ডারের ওষুধ',
        updates: 'অর্ডারের অগ্রগতি অনুযায়ী আমরা আপনাকে আপডেট পাঠাব।', ready: 'অর্ডার প্যাক করা হয়েছে এবং ডেলিভারি রাইডারের অপেক্ষায় আছে।',
        dispatched: '🚚 আপনার অর্ডার ডেলিভারির পথে', rider: 'ডেলিভারি রাইডার', riderPhone: 'রাইডারের যোগাযোগ',
        delivered: '🏁 অর্ডার সফলভাবে ডেলিভার হয়েছে', thankYou: 'QuickMeds Rx বেছে নেওয়ার জন্য ধন্যবাদ। সুস্থ থাকুন! 💚',
        assigned: '🛵 আপনার অর্ডারের জন্য ডেলিভারি রাইডার নিয়োগ করা হয়েছে', otp: '🔐 ৪ সংখ্যার যাচাইকরণ কোড',
        otpRule: 'হস্তান্তরের সময় শুধু রাইডারকে এই কোডটি জানান। রাইডার আসার আগে শেয়ার করবেন না।',
        at: 'ডেলিভারির জন্য রওনা হওয়ার সময়', deliveredAt: 'ডেলিভারির সময়', notAvailable: 'পাওয়া যাচ্ছে না',
        placedTitle: 'অর্ডার নম্বর', itemsUnavailable: 'আইটেম পাওয়া যাচ্ছে না'
    },
    te: {
        placed: '🎉 మీ QuickMeds Rx ఆర్డర్ విజయవంతంగా స్వీకరించబడింది',
        status: 'స్థితి', customer: 'కస్టమర్', address: 'డెలివరీ చిరునామా', total: 'మొత్తం', items: 'ఆర్డర్ మందులు',
        updates: 'మీ ఆర్డర్ పురోగతిని బట్టి మేము అప్‌డేట్‌లు పంపుతాము.', ready: 'ఆర్డర్ ప్యాక్ చేయబడింది; డెలివరీ రైడర్ కోసం వేచి ఉంది.',
        dispatched: '🚚 మీ ఆర్డర్ డెలివరీకి బయలుదేరింది', rider: 'డెలివరీ రైడర్', riderPhone: 'రైడర్ సంప్రదింపు',
        delivered: '🏁 ఆర్డర్ విజయవంతంగా డెలివరీ అయింది', thankYou: 'QuickMeds Rxను ఎంచుకున్నందుకు ధన్యవాదాలు. ఆరోగ్యంగా ఉండండి! 💚',
        assigned: '🛵 మీ ఆర్డర్‌కు డెలివరీ రైడర్ కేటాయించబడ్డారు', otp: '🔐 4 అంకెల ధృవీకరణ కోడ్',
        otpRule: 'డెలివరీ అప్పగించే సమయంలో మాత్రమే ఈ కోడ్‌ను రైడర్‌కు చెప్పండి. రైడర్ రాకముందు పంచుకోవద్దు.',
        at: 'డెలివరీకి బయలుదేరిన సమయం', deliveredAt: 'డెలివరీ సమయం', notAvailable: 'అందుబాటులో లేదు',
        placedTitle: 'ఆర్డర్ నంబర్', itemsUnavailable: 'వస్తువులు అందుబాటులో లేవు'
    }
};

const buildLocalizedCustomerOrderMessage = (order, status, language, { deliveryOtp = null } = {}) => {
    const words = localizedWhatsApp[language];
    if (!words) return null;
    const orderId = order?.orderNumber || (order?._id?.toString() || order?.id?.toString() || 'UNKNOWN').slice(-6).toUpperCase();
    const items = (order.items || []).map(item => `• ${item.name || words.itemsUnavailable} x${item.quantity || 1}`).join('\n');
    const address = getCompleteAddress(order);
    const total = `₹${order.finalTotal}`;
    const rider = order.rider?.riderName || words.notAvailable;
    const riderPhone = order.rider?.riderMobile || words.notAvailable;
    const when = order.outForDeliveryAt ? new Date(order.outForDeliveryAt).toLocaleString() : new Date().toLocaleString();
    switch (normalizeOrderStatus(status)) {
        case 'Placed':
            return [words.placed + ` — #${orderId}`, `${words.status}: ${order.orderStatus || 'Processing'}`, `${words.customer}: ${order.addressDetails?.fullName || order.customerName || words.notAvailable}`, `${words.address}: ${address}`, `${words.total}: ${total}`, items && `${words.items}:\n${items}`, words.updates].filter(Boolean).join('\n');
        case 'Ready to Dispatch':
            return [`🔬 ${words.status}: Ready to Dispatch — #${orderId}`, words.ready, `${words.total}: ${total}`, items && `${words.items}:\n${items}`].filter(Boolean).join('\n');
        case 'Dispatched':
            return [words.dispatched + ` — #${orderId}`, `${words.status}: Out for Delivery`, deliveryOtp ? `${words.otp}: ${deliveryOtp}` : null, deliveryOtp ? words.otpRule : null, `${words.rider}: ${rider}`, `${words.riderPhone}: ${riderPhone}`, `${words.address}: ${address}`, `${words.at}: ${when}`, `${words.total}: ${total}`, items && `${words.items}:\n${items}`].filter(Boolean).join('\n');
        case 'Assigned':
            return [words.assigned + ` — #${orderId}`, `${words.rider}: ${rider}`, `${words.riderPhone}: ${riderPhone}`, words.ready, `${words.address}: ${address}`].join('\n');
        case 'Delivered':
            return [words.delivered + ` — #${orderId}`, `${words.deliveredAt}: ${order.deliveredAt ? new Date(order.deliveredAt).toLocaleString() : new Date().toLocaleString()}`, `${words.items}:\n${items || words.itemsUnavailable}`, `${words.total}: ${total}`, words.thankYou].join('\n');
        default:
            return null;
    }
};

const buildLocalizedCustomerMedicineRequestMessage = (request, eventType, language) => {
    const words = {
        hi: { created:'आपका दवा अनुरोध QuickMeds Rx को मिल गया है। हमारी फ़ार्मेसी टीम जल्द समीक्षा करेगी।', proposal:'आपके दवा अनुरोध के लिए फ़ार्मेसी का प्रस्ताव तैयार है। कृपया ऐप में समीक्षा करके मंज़ूर करें।', approved:'आपका प्रस्ताव मंज़ूर हो गया है और ऑर्डर पूर्ति के लिए बना दिया गया है। QuickMeds Rx चुनने के लिए धन्यवाद।', cancelled:'आपका दवा अनुरोध रद्द कर दिया गया है। दवा चाहिए तो नया अनुरोध भेजें।', rejected:'आपका दवा अनुरोध/प्रस्ताव स्वीकार नहीं हुआ। ज़रूरत होने पर नया अनुरोध भेजें या सहायता से संपर्क करें।', expired:'आपके दवा अनुरोध का प्रस्ताव समाप्त हो गया है। ज़रूरत होने पर नया अनुरोध भेजें।', medicine:'दवा', quantity:'मात्रा', price:'कीमत', delivery:'डिलीवरी', note:'फ़ार्मेसी नोट', number:'अनुरोध' },
        kn: { created:'ನಿಮ್ಮ ಔಷಧಿ ವಿನಂತಿ QuickMeds Rx ಗೆ ಬಂದಿದೆ. ನಮ್ಮ ಔಷಧಾಲಯ ತಂಡ ಶೀಘ್ರದಲ್ಲೇ ಪರಿಶೀಲಿಸುತ್ತದೆ.', proposal:'ನಿಮ್ಮ ಔಷಧಿ ವಿನಂತಿಗೆ ಔಷಧಾಲಯದ ಪ್ರಸ್ತಾವನೆ ಸಿದ್ಧವಾಗಿದೆ. ದಯವಿಟ್ಟು ಆ್ಯಪ್‌ನಲ್ಲಿ ಪರಿಶೀಲಿಸಿ ಅನುಮೋದಿಸಿ.', approved:'ನಿಮ್ಮ ಪ್ರಸ್ತಾವನೆ ಅನುಮೋದಿಸಲಾಗಿದೆ ಮತ್ತು ಪೂರೈಕೆಗಾಗಿ ಆರ್ಡರ್ ರಚಿಸಲಾಗಿದೆ. QuickMeds Rx ಆಯ್ಕೆ ಮಾಡಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು.', cancelled:'ನಿಮ್ಮ ಔಷಧಿ ವಿನಂತಿ ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ. ಇನ್ನೂ ಅಗತ್ಯವಿದ್ದರೆ ಹೊಸ ವಿನಂತಿ ಕಳುಹಿಸಿ.', rejected:'ನಿಮ್ಮ ಔಷಧಿ ವಿನಂತಿ/ಪ್ರಸ್ತಾವನೆ ಸ್ವೀಕರಿಸಲಾಗಿಲ್ಲ. ಅಗತ್ಯವಿದ್ದರೆ ಹೊಸ ವಿನಂತಿ ಕಳುಹಿಸಿ ಅಥವಾ ಸಹಾಯ ಸಂಪರ್ಕಿಸಿ.', expired:'ನಿಮ್ಮ ಔಷಧಿ ವಿನಂತಿಯ ಪ್ರಸ್ತಾವನೆ ಅವಧಿ ಮುಗಿದಿದೆ. ಅಗತ್ಯವಿದ್ದರೆ ಹೊಸ ವಿನಂತಿ ಸಲ್ಲಿಸಿ.', medicine:'ಔಷಧಿ', quantity:'ಪ್ರಮಾಣ', price:'ಬೆಲೆ', delivery:'ವಿತರಣೆ', note:'ಔಷಧಾಲಯದ ಟಿಪ್ಪಣಿ', number:'ವಿನಂತಿ' },
        bn: { created:'আপনার ওষুধের অনুরোধ QuickMeds Rx পেয়েছে। আমাদের ফার্মেসি টিম শীঘ্রই পর্যালোচনা করবে।', proposal:'আপনার ওষুধের অনুরোধের জন্য ফার্মেসির প্রস্তাব প্রস্তুত। অনুগ্রহ করে অ্যাপে পর্যালোচনা করে অনুমোদন করুন।', approved:'আপনার প্রস্তাব অনুমোদিত হয়েছে এবং পূরণের জন্য অর্ডার তৈরি হয়েছে। QuickMeds Rx বেছে নেওয়ার জন্য ধন্যবাদ।', cancelled:'আপনার ওষুধের অনুরোধ বাতিল হয়েছে। এখনও প্রয়োজন হলে নতুন অনুরোধ পাঠান।', rejected:'আপনার ওষুধের অনুরোধ/প্রস্তাব গ্রহণ করা হয়নি। প্রয়োজন হলে নতুন অনুরোধ পাঠান বা সহায়তায় যোগাযোগ করুন।', expired:'আপনার ওষুধের অনুরোধের প্রস্তাবের মেয়াদ শেষ হয়েছে। প্রয়োজন হলে নতুন অনুরোধ পাঠান।', medicine:'ওষুধ', quantity:'পরিমাণ', price:'দাম', delivery:'ডেলিভারি', note:'ফার্মেসির নোট', number:'অনুরোধ' },
        te: { created:'మీ మందుల అభ్యర్థన QuickMeds Rxకు అందింది. మా ఫార్మసీ బృందం త్వరలో పరిశీలిస్తుంది.', proposal:'మీ మందుల అభ్యర్థనకు ఫార్మసీ ప్రతిపాదన సిద్ధంగా ఉంది. దయచేసి యాప్‌లో పరిశీలించి ఆమోదించండి.', approved:'మీ ప్రతిపాదన ఆమోదించబడింది మరియు పూర్తి చేయడానికి ఆర్డర్ సృష్టించబడింది. QuickMeds Rxను ఎంచుకున్నందుకు ధన్యవాదాలు.', cancelled:'మీ మందుల అభ్యర్థన రద్దు చేయబడింది. ఇంకా అవసరమైతే కొత్త అభ్యర్థన పంపండి.', rejected:'మీ మందుల అభ్యర్థన/ప్రతిపాదన అంగీకరించబడలేదు. అవసరమైతే కొత్త అభ్యర్థన పంపండి లేదా సహాయాన్ని సంప్రదించండి.', expired:'మీ మందుల అభ్యర్థన ప్రతిపాదన గడువు ముగిసింది. అవసరమైతే కొత్త అభ్యర్థన పంపండి.', medicine:'మందు', quantity:'పరిమాణం', price:'ధర', delivery:'డెలివరీ', note:'ఫార్మసీ గమనిక', number:'అభ్యర్థన' }
    }[language];
    if (!words) return null;
    const reqNum = request?.requestNumber || 'MR-REQ';
    const items = (request?.requestedItems || []).map(i => `${i.requestedName || words.medicine}${i.strength ? ' ' + i.strength : ''} (x${i.quantity || 1})`).join(', ') || words.medicine;
    const proposal = request?.pharmacyProposal || {};
    let message = '';
    switch (eventType) {
        case 'MedicineRequestCreated':
        case 'NEW_REQUEST': message = words.created; break;
        case 'MedicineProposalReady':
        case 'PROPOSAL_SENT': message = [words.proposal, `${words.medicine}: ${proposal.proposedMedicineName || proposal.medicineName || items}`, `${words.quantity}: ${proposal.proposedQuantity || proposal.quantity || 1}`, `${words.price}: ₹${proposal.finalPrice ?? proposal.totalPrice ?? proposal.approximatePrice ?? 0}`, `${words.delivery}: ${proposal.deliverySlot?.label || proposal.deliverySlot?.date || '—'}`, (proposal.pharmacyNote || proposal.pharmacyNotes) ? `${words.note}: ${proposal.pharmacyNote || proposal.pharmacyNotes}` : null].filter(Boolean).join('\n'); break;
        case 'MedicineRequestApproved':
        case 'CUSTOMER_APPROVED': message = words.approved; break;
        case 'MedicineRequestCancelled': message = words.cancelled; break;
        case 'MedicineRequestRejected':
        case 'CUSTOMER_REJECTED':
        case 'PHARMACY_REJECTED': message = words.rejected; break;
        case 'MedicineProposalExpired':
        case 'EXPIRED': message = words.expired; break;
        default: return null;
    }
    return [`📋 ${words.number} #${reqNum}`, `${words.medicine}: ${items}`, message].join('\n');
};


const publishWhatsAppRealtimeStatus = (record, { userId = null, tenantId = null, orderId = null, medicineRequestId = null, audience = 'customer' } = {}) => {
    if (!userId && !tenantId) return;
    const deliveryState = String(record?.status || 'UNKNOWN').toUpperCase();
    const referenceId = String(orderId || medicineRequestId || record?.orderId || 'unknown');
    void cacheService.publishEvent('whatsapp_notification', {
        id: `whatsapp-status:${referenceId}:${record?.eventType || 'update'}:${audience}`,
        title: deliveryState === 'SENT' ? 'WhatsApp notification sent'
            : deliveryState === 'FAILED' || deliveryState === 'MISSING_RECIPIENT' ? 'WhatsApp notification failed'
                : 'WhatsApp notification update',
        body: `WhatsApp ${record?.eventType || 'notification'} status: ${deliveryState}.`,
        eventType: 'WHATSAPP_DELIVERY_STATUS',
        deliveryState,
        orderId: orderId ? String(orderId) : null,
        medicineRequestId: medicineRequestId ? String(medicineRequestId) : null,
        channels: ['WHATSAPP'],
        source: 'whatsapp-service',
        tenantId,
        audience
    }, { userId: userId ? String(userId) : null, tenantId: tenantId ? String(tenantId) : null })
        .catch(error => console.warn('[WhatsApp] Failed to publish realtime delivery status:', error?.message));
};
const authDirectory = process.env.WHATSAPP_AUTH_DIR || path.resolve('data/whatsapp-auth');
const qrLifetimeMs = 20_000;
const messageRetentionMs = 24 * 60 * 60 * 1000;

let whatsappState = {
    isConnected: true,
    phone: process.env.WHATSAPP_SIMULATE_PHONE || '+91 98450 12345',
    deviceName: 'QuickMeds Rx Cloud Gateway',
    lastConnectedAt: new Date().toISOString(),
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
    if (process.env.WHATSAPP_SIMULATE_GATEWAY !== 'false') {
        whatsappState = {
            isConnected: true,
            phone: process.env.WHATSAPP_SIMULATE_PHONE || '+91 98450 12345',
            deviceName: 'QuickMeds Rx Cloud Gateway',
            lastConnectedAt: whatsappState.lastConnectedAt || new Date().toISOString(),
            qrCode: null,
            expiresAt: null
        };
        return getWhatsAppStatus();
    }
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

export const buildWhatsAppMessageBody = (order, status, audience, { deliveryActionLinks = [], deliveryOtp = null, language = 'en' } = {}) => {
    if (audience === 'customer' && language !== 'en') {
        const localized = buildLocalizedCustomerOrderMessage(order, status, language, { deliveryOtp });
        if (localized) return localized;
    }
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
        const links = (deliveryActionLinks && deliveryActionLinks.length)
            ? deliveryActionLinks
            : createDeliveryActionLinks(order, normalizedStatus);
        const displayOrderId = order?.orderNumber ? order.orderNumber : shortId;
        return [
            `🚚 ${normalizedStatus === 'Assigned' ? 'NEW DELIVERY ASSIGNED' : 'ORDER OUT FOR DELIVERY'} — Order #${displayOrderId}`,
            `Rider: ${order.rider?.riderName || 'Assigned Rider'}`,
            `Customer: ${order.addressDetails?.fullName || order.customerName || 'Customer'}`,
            `Customer contact: ${order.customerMobile || order.addressDetails?.mobile || 'Not provided'}`,
            `Complete delivery address: ${getCompleteAddress(order)}`,
            mapsLink && `Google Maps: ${mapsLink}`,
            normalizedStatus === 'Assigned'
                ? `Assigned at: ${order.assignmentDetails?.assignedAt ? new Date(order.assignmentDetails.assignedAt).toLocaleString() : new Date().toLocaleString()}`
                : `Out for delivery at: ${order.outForDeliveryAt ? new Date(order.outForDeliveryAt).toLocaleString() : new Date().toLocaleString()}`,
            `COD amount: ₹${order.finalTotal}`,
            links.length ? `Delivery actions (confirm each action):\n${links.map(l => `[ ${l} ]`).join('\n')}` : '',
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
            deliveryOtp ? `🔐 4-Digit Verification Code: ${deliveryOtp}` : null,
            deliveryOtp ? 'Share this code with your delivery person at handover. Never share it before the rider arrives.' : null,
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

export const buildWhatsAppMedicineRequestBody = (request, eventType, language = 'en') => {
    if (language !== 'en') {
        const localized = buildLocalizedCustomerMedicineRequestMessage(request, eventType, language);
        if (localized) return localized;
    }
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

        case 'MedicineRequestCancelled':
            return [
                `🚫 MEDICINE REQUEST CANCELLED — #${reqNum}`,
                `Medicine: ${items}`,
                'Your medicine request was cancelled. If you still need this medicine, please create a new request in Ashvin Pharmacy.'
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
        if (process.env.WHATSAPP_SIMULATE_GATEWAY !== 'false') {
            await updateNotification(record, mongoRecord, {
                status: 'SENT',
                sentAt: new Date(),
                messageId: `wamid.simulated.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`
            });
            await updateReminder();
            return record;
        }
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

export const createDeliveryActionLinks = (order, stage = 'Dispatched') => {
    const baseUrl = process.env.DELIVERY_ACTION_BASE_URL || (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/api/delivery/events/actions` : '/api/delivery/events/actions');
    const orderId = order?._id?.toString() || order?.id?.toString() || 'ORD';
    const riderId = order?.rider?.riderId || 'rider-assigned';

    const coordinates = order?.coordinates || {};
    const hasCoordinates = Number.isFinite(Number(coordinates.lat))
        && Number.isFinite(Number(coordinates.lng))
        && coordinates.lat !== null && coordinates.lng !== null;
    const addressQuery = order?.deliveryAddress || getCompleteAddress(order);
    const mapsLink = hasCoordinates
        ? `https://www.google.com/maps/search/?api=1&query=${coordinates.lat},${coordinates.lng}`
        : addressQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressQuery)}` : null;

    let actions = [];
    if (stage === 'Assigned') {
        actions = [
            ['accept', 'Accept Delivery'],
            ['view_delivery', 'View Delivery']
        ];
    } else {
        actions = [
            ['cash_received', 'Cash received'],
            ['cash_not_received', 'Cash not received'],
            ['payment_pending', 'Payment pending'],
            ['not_reachable', 'Customer not reachable']
        ];
    }

    try {
        const links = actions.map(([action, label]) => {
            let token = '';
            try {
                token = createRiderDeliveryActionToken({ orderId: String(order?._id || order?.id || orderId), riderId: String(riderId), action });
            } catch {
                token = `action-${action}-${orderId}`;
            }
            let actionUrl = baseUrl;
            try {
                const url = new URL(baseUrl, 'http://localhost:3000');
                if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
                    throw new Error('Delivery action links must use HTTPS in production.');
                }
                url.searchParams.set('token', token);
                actionUrl = url.toString();
            } catch {
                actionUrl = `${baseUrl}?token=${token}`;
            }
            return `${label}: ${actionUrl}`;
        });
        if (stage === 'Assigned' && mapsLink) {
            links.push(`Navigate: ${mapsLink}`);
        }
        return links;
    } catch (error) {
        console.error('Rider action links error:', { code: error.code || 'INVALID_ACTION_LINK_CONFIG' });
        return [];
    }
};

const createDeliveryActionMenu = (order, stage = 'Dispatched') => {
    if (process.env.WHATSAPP_DELIVERY_TRACKING_ENABLED !== 'true'
        || process.env.MONGO_TRANSACTIONS_CONFIRMED !== 'true'
        || !getTransactionsSupported()) return null;
    const orderId = order?._id?.toString() || order?.id?.toString();
    const riderId = order?.rider?.riderId;
    if (!orderId || !riderId || !order?.rider?.riderMobile) return null;
    return buildDeliveryActionMenu(order, stage);
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
    let selectedTenantPhone = '';
    if (normalizedStatus === 'Placed' && order.tenantId && getIsConnected()) {
        const [vendor, tenant] = await Promise.all([
            Vendor.findOne({ tenantId: String(order.tenantId), status: 'ACTIVE' }).select('mobile').lean(),
            Tenant.findOne({ _id: String(order.tenantId), status: 'ACTIVE' }).select('contactPhone').lean()
        ]);
        selectedTenantPhone = vendor?.mobile || tenant?.contactPhone || '';
    }
    const customerLanguage = await resolveNotificationLanguage(order.userId || order.customerUserId || order.customerId);
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
            ...(normalizedStatus === 'Placed' && selectedTenantPhone
                ? [{ audience: 'admin', phone: selectedTenantPhone }]
                : [])
        ];
    const records = [];
    let customerDeliveryOtp = null;
    if (normalizedStatus === 'Dispatched' && getIsConnected() && customerPhone) {
        const customerRecipient = normalizeWhatsAppNumber(customerPhone);
        const customerDedupeKey = `${orderId}:${normalizedStatus}:customer:${customerRecipient || 'missing'}`;
        if (!sentNotifications.has(customerDedupeKey)) {
            const existingMessage = await WhatsAppMessage.findOne({ dedupeKey: customerDedupeKey, expiresAt: { $gt: new Date() } });
            if (existingMessage) {
                sentNotifications.set(customerDedupeKey, existingMessage.toObject());
            } else {
                const otpOrder = await Order.findById(orderId).select('+deliveryVerification.otpHash +deliveryVerification.expiresAt +deliveryVerification.attempts');
                if (otpOrder) {
                    customerDeliveryOtp = String(randomInt(0, 10000)).padStart(4, '0');
                    otpOrder.deliveryVerification = {
                        otpHash: scryptSync(customerDeliveryOtp, String(orderId), 32).toString('hex'),
                        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                        attempts: 0,
                        verifiedAt: null
                    };
                    await otpOrder.save();
                    await cacheService.set(`delivery_otp:${orderId}`, customerDeliveryOtp, 86400);
                }
            }
        }
    }

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
                deliveryActionLinks: audience === 'rider' && ['Assigned', 'Dispatched'].includes(normalizedStatus)
                    ? createDeliveryActionLinks(order, normalizedStatus)
                    : [],
                deliveryOtp: audience === 'customer' ? customerDeliveryOtp : null,
                language: audience === 'customer' ? customerLanguage : 'en'
            }),
            deliveryMenu: audience === 'rider' && ['Assigned', 'Dispatched'].includes(normalizedStatus)
                ? createDeliveryActionMenu(order, normalizedStatus)
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
        const targetUserId = audience === 'rider'
            ? (order.rider?.userId || order.rider?.riderId || null)
            : audience === 'customer'
                ? (order.userId || order.customerUserId || order.customerId || null)
                : null;
        publishWhatsAppRealtimeStatus(record, {
            userId: targetUserId,
            tenantId: order.tenantId || null,
            orderId,
            audience
        });

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
    const customerLanguage = await resolveNotificationLanguage(request?.customerUserId || request?.userId || request?.customerId);
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
            messageBody: buildWhatsAppMedicineRequestBody(request, eventType, audience === 'customer' ? customerLanguage : 'en'),
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
        publishWhatsAppRealtimeStatus(record, {
            userId: audience === 'customer' ? (request.customerUserId || request.userId || request.customerId || null) : null,
            tenantId: request.tenantId || null,
            medicineRequestId: requestId,
            audience
        });
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
